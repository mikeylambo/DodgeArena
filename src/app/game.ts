import type Phaser from "phaser";
import {
  AudioLifecycleCoordinator, DeterministicRng, DeterministicRngRegistry, PoseGhostPlayer, PoseGhostRecorder,
  TelemetryRecorder, stableHashString, type GhostRecording,
} from "@slu/web-shell";
import { createRun, step, SIM_DT, SIM_HZ, type Run } from "../sim/step.js";
import { TickInputRecorder } from "../sim/replay.js";
import { TUNING } from "../sim/tuning.js";
import type { Orientation, RunConfig } from "../sim/types.js";
import { ArenaView } from "../view/arena.js";
import { FxSystem } from "../view/fx.js";
import { Hud, type Mode } from "../view/hud.js";
import { PALETTE } from "../view/palette.js";
import { InputController } from "./input.js";
import { SynthAudio } from "./audio.js";
import { Persistence, boardFor } from "./persistence.js";

type Phase = "card" | "ready" | "playing" | "paused" | "dying" | "over";

const params = new URLSearchParams(location.search);
const DEV = params.get("dev") === "1";
const STRESS = Number(params.get("stress") ?? 0); // e.g. ?dev=1&stress=40 → high level, no death
const RESTART_GUARD_MS = 350;
const HUD_INSET_CSS = 72;

/** Owns the run lifecycle and wires sim ⇄ view ⇄ shell services. */
export class Game {
  private phase: Phase = "card";
  private run!: Run;
  private board = "endless";
  private mode: Mode = "endless";
  private acc = 0;
  private dpr = 1;
  private viewW = 0;
  private viewH = 0;
  private arena!: ArenaView;
  private fx!: FxSystem;
  private flashRect!: Phaser.GameObjects.Rectangle;
  private dimTimer = 0;
  private overAt = 0;
  private recorder: TickInputRecorder | null = null;
  private ghostRec: PoseGhostRecorder | null = null;
  private ghostPlay: PoseGhostPlayer | null = null;
  private playerPop = 1;
  private restartTapAt = 0;
  private lastRestartMs = 0;
  private fps = 60;
  private runStartedWithHint = false;

  readonly telemetry = new TelemetryRecorder({ context: { game: "dodge-arena-proto", build: "0.1.0" } });
  private readonly audio = new SynthAudio();
  private readonly audioLifecycle = new AudioLifecycleCoordinator(this.audio);
  private readonly hud: Hud;
  private readonly input: InputController;

  constructor(private readonly persistence: Persistence, inputSurface: HTMLElement) {
    this.hud = new Hud({
      onPlay: m => { this.audio.unlock(); this.setMode(m); this.startRun(performance.now()); },
      onPause: () => this.togglePause(),
      onMute: () => this.toggleMute(),
      onMode: m => { this.setMode(m); if (this.phase === "over") this.startRun(performance.now()); },
    });
    this.input = new InputController(inputSurface);
    this.input.onPress = e => this.onPress(e.time);
    this.input.onPause = () => this.togglePause();
    this.audioLifecycle.installVisibility();
    document.addEventListener("visibilitychange", () => { if (document.hidden && this.phase === "playing") this.togglePause(); });
    this.audio.setMuted(persistence.data.muted);
    this.hud.setMuted(persistence.data.muted);
  }

  /** Called from the Phaser scene's create(). */
  attach(scene: Phaser.Scene): void {
    this.arena = new ArenaView(scene);
    this.fx = new FxSystem(this.arena.fxG, new DeterministicRng(1));
    this.flashRect = scene.add.rectangle(0, 0, 10, 10, PALETTE.white, 0).setOrigin(0, 0);
    this.prepareRun();
    if (this.persistence.data.firstRunDone) { this.phase = "ready"; this.hud.showCard(false); }
    else { this.phase = "card"; this.hud.showCard(true); }
    this.hud.showHint(false);
  }

  resize(cssW: number, cssH: number, dpr: number): void {
    this.dpr = dpr; this.viewW = cssW * dpr; this.viewH = cssH * dpr;
    this.flashRect?.setSize(this.viewW, this.viewH);
    this.layout();
  }

  private layout(): void {
    if (!this.arena || !this.run) return;
    const s = this.run.state;
    this.arena.layout(this.viewW, this.viewH, s.arena.w, s.arena.h, HUD_INSET_CSS * this.dpr, 10 * this.dpr);
  }

  private setMode(m: Mode): void { this.mode = m; this.hud.setMode(m); }

  private orientation(): Orientation { return this.viewH > this.viewW * 1.1 ? "portrait" : "landscape"; }

  /** Build (but don't start) the next run so the arena is visible behind the card / ready state. */
  private prepareRun(): void {
    const { board, seed } = boardFor(this.mode, () => DeterministicRngRegistry.freshSeed(8));
    this.board = board;
    const config: RunConfig = { seed, orientation: this.orientation(), ...(STRESS ? { startLevel: 20 } : {}) };
    this.run = createRun(config);
    this.fx.setRng(new DeterministicRng(stableHashString(`${seed}:view-fx`)));
    this.fx.clear();
    this.layout();
    this.hud.stats(0, this.persistence.best(board), this.run.state.level);
  }

  private startRun(tapTime: number): void {
    this.prepareRun();
    this.input.flush();
    this.input.moved = false;
    this.acc = 0;
    this.playerPop = 1;
    this.recorder = new TickInputRecorder(this.run.config);
    const clock = () => this.run.state.time * 1000;
    this.ghostRec = new PoseGhostRecorder({ sampleHz: 20, positionScale: 10, clock });
    this.ghostPlay = null;
    const ghostId = `${this.board}:${this.run.config.orientation}`;
    void this.persistence.loadGhost(ghostId).then(g => {
      if (g && this.run.state.tick < 30) this.ghostPlay = new PoseGhostPlayer(g, 10);
    });
    this.phase = "playing";
    this.hud.showCard(false);
    this.hud.showOver(false);
    this.hud.showPaused(false);
    this.runStartedWithHint = !this.persistence.data.firstRunDone;
    this.hud.showHint(this.runStartedWithHint);
    this.restartTapAt = tapTime;
    this.lastRestartMs = -1;
    this.audio.playSfx("start");
    this.telemetry.record("run_start", { mode: this.mode, board: this.board, seed: this.run.config.seed, orientation: this.run.config.orientation });
  }

  private onPress(time: number): void {
    this.audio.unlock();
    if (this.phase === "ready") this.startRun(time);
    else if (this.phase === "over" && time - this.overAt > RESTART_GUARD_MS) this.startRun(time);
    else if (this.phase === "paused") this.togglePause();
  }

  private togglePause(): void {
    if (this.phase === "playing") {
      this.phase = "paused"; this.hud.showPaused(true); this.audioLifecycle.setGamePaused(true);
    } else if (this.phase === "paused") {
      this.phase = "playing"; this.hud.showPaused(false); this.audioLifecycle.setGamePaused(false);
      this.input.flush(); this.acc = 0;
    }
  }

  private toggleMute(): void {
    const m = !this.persistence.data.muted;
    this.persistence.data.muted = m;
    this.audio.setMuted(m); this.hud.setMuted(m);
    void this.persistence.save();
  }

  /** Per render frame. */
  frame(deltaMs: number): void {
    if (!this.arena) return;
    const dt = Math.min(deltaMs, 100);
    this.fps = this.fps * 0.95 + (1000 / Math.max(1, deltaMs)) * 0.05;
    const s = this.run.state;

    if (this.phase === "playing") {
      this.acc += dt;
      const tickMs = 1000 / SIM_HZ;
      const cssPxPerWorld = this.arena.scale / this.dpr;
      while (this.acc >= tickMs && this.phase === "playing") {
        this.acc -= tickMs;
        const input = this.input.consume(cssPxPerWorld);
        this.recorder?.record(s.tick, input);
        step(this.run, input, SIM_DT);
        this.ghostRec?.sample({ x: s.player.x, y: s.player.y, z: 0 });
        if (STRESS && !s.alive) { s.alive = true; s.deathKind = null; }
        this.handleEvents();
      }
      if (this.runStartedWithHint && this.input.moved && s.time > 0.6) { this.runStartedWithHint = false; this.hud.showHint(false); }
    } else if (this.phase === "dying") {
      this.dimTimer += dt;
      if (this.dimTimer >= TUNING.juice.hitstopMs && this.dimTimer - dt < TUNING.juice.hitstopMs) {
        this.fx.death(s.player.x, s.player.y);
      }
      if (this.dimTimer >= 520) this.showOver();
    }

    const frozen = this.phase === "dying" && this.dimTimer < TUNING.juice.hitstopMs;
    const fxDt = frozen || this.phase === "paused" ? 0 : dt / 1000;
    const shake = this.fx.update(fxDt);
    this.arena.setShake(shake.dx * this.arena.scale, shake.dy * this.arena.scale);
    this.playerPop += (1 - this.playerPop) * Math.min(1, dt / 70);
    const ghost = this.ghostPlay && this.phase === "playing" ? this.ghostPlay.poseAt(s.time * 1000) : null;
    this.arena.draw(s, frozen || this.phase === "paused" ? 0 : dt, {
      ghost: ghost && !ghost.done ? ghost : null,
      playerPop: this.playerPop,
      showPlayer: s.alive || (this.phase === "dying" && this.dimTimer < TUNING.juice.hitstopMs),
    });
    this.flashRect.setFillStyle(this.fx.flashTint, this.fx.flash);
    this.hud.stats(s.score, Math.max(s.score, this.persistence.best(this.board)), s.level);

    if (this.phase === "playing" && this.lastRestartMs < 0) {
      this.lastRestartMs = performance.now() - this.restartTapAt;
      this.telemetry.record("restart_ms", { ms: Math.round(this.lastRestartMs) });
    }
    if (DEV) {
      this.hud.devText(`fps ${this.fps.toFixed(0)}  hazards ${s.hazards.length}  t ${s.time.toFixed(1)}s  restart ${Math.max(0, this.lastRestartMs).toFixed(0)}ms  seed ${s.seed}${STRESS ? "  STRESS" : ""}`);
    }
  }

  private handleEvents(): void {
    const s = this.run.state;
    for (const ev of s.events) {
      switch (ev.type) {
        case "coin":
          this.fx.coin(ev.x, ev.y);
          this.playerPop = 1.28;
          this.audio.playSfx("coin", { pitch: Math.pow(2, Math.min(ev.combo, 12) / 12) });
          this.hud.punchScore();
          this.telemetry.record("coin", { score: ev.score, combo: ev.combo, t: +s.time.toFixed(2) });
          break;
        case "near_miss":
          this.fx.nearMiss(ev.x, ev.y);
          this.audio.playSfx("near_miss");
          this.telemetry.record("near_miss", { kind: ev.kind, t: +s.time.toFixed(2) });
          break;
        case "level_up":
          this.fx.levelUp(s.arena.w, s.arena.h);
          this.audio.playSfx("level_up");
          this.telemetry.record("level_up", { level: ev.level, t: +s.time.toFixed(2) });
          break;
        case "death":
          this.onDeath(ev.kind);
          break;
        default:
          break;
      }
    }
  }

  private onDeath(kind: string): void {
    const s = this.run.state;
    this.phase = "dying";
    this.dimTimer = 0;
    this.audio.playSfx("death");
    this.hud.showHint(false);
    this.telemetry.record("death", { level: s.level, hazardKind: kind, survivedMs: Math.round(s.time * 1000), score: s.score });
    void this.persistRun();
  }

  private lastResult = { score: 0, best: 0, level: 1, newBest: false };

  private async persistRun(): Promise<void> {
    const s = this.run.state;
    const p = this.persistence;
    const prevBest = p.best(this.board);
    const newBest = s.score > prevBest;
    p.data.runs++;
    p.data.firstRunDone = true;
    if (newBest) p.data.best[this.board] = s.score;
    this.lastResult = { score: s.score, best: Math.max(prevBest, s.score), level: s.level, newBest };
    const replay = this.recorder?.finish(s.tick);
    this.ghostRec?.finish({ x: s.player.x, y: s.player.y, z: 0 });
    const ghost: GhostRecording | undefined = this.ghostRec?.serialize({ seed: s.seed, levelId: this.board, score: s.score });
    await p.save();
    if (newBest || prevBest === 0) {
      if (ghost) await p.saveGhost(`${this.board}:${s.orientation}`, ghost);
      if (replay) await p.saveReplay(this.board, { config: this.run.config, data: replay, score: s.score });
    }
    if (s.score > 0) {
      await p.leaderboard.submit(this.board, { playerId: p.data.playerId, displayName: "You", score: s.score, metadata: { level: s.level, ms: Math.round(s.time * 1000) } });
    }
  }

  private showOver(): void {
    this.phase = "over";
    this.overAt = performance.now();
    this.hud.showOver(true, this.lastResult);
  }
}
