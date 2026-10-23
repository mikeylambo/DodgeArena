import { TUNING } from "./tuning.js";
import { RunRng } from "./rng.js";
import { moveHazard } from "./hazards.js";
import { runSpawner, clearOfHazards } from "./spawner.js";
import { gapToHazard, isLethal, clamp } from "./collide.js";
import type { RunConfig, RunState, StepInput } from "./types.js";

export const SIM_HZ = TUNING.sim.hz;
export const SIM_DT = 1 / SIM_HZ;

/** A run = immutable config + mutable state + its RNG streams. */
export interface Run { config: RunConfig; state: RunState; rng: RunRng }

export function createRun(config: RunConfig): Run {
  const dims = TUNING.arena[config.orientation];
  const size = TUNING.player.size;
  const rng = new RunRng(config.seed);
  const startLevel = Math.max(1, config.startLevel ?? 1);
  const state: RunState = {
    seed: config.seed,
    orientation: config.orientation,
    arena: { w: dims.width, h: dims.height },
    tick: 0, time: 0,
    level: startLevel, levelTimer: 0, coinsThisLevel: 0,
    breather: 0.6, // brief settle-in before the first spawn
    spawnTimer: 0,
    score: 0, coinsCollected: 0, combo: 0, lastCoinTime: -Infinity, nearMisses: 0,
    player: { x: dims.width / 2, y: dims.height / 2, size, hit: (size * TUNING.player.hitboxScale) / 2, pendingX: 0, pendingY: 0 },
    coins: [], coinRespawns: [],
    hazards: [], nextId: 1,
    alive: true, deathKind: null,
    events: [],
  };
  for (let i = 0; i < TUNING.coins.onScreen; i++) state.coinRespawns.push(0);
  return { config, state, rng };
}

/** step(state, input, dt) — fixed-step, deterministic. Mutates and returns run.state. */
export function step(run: Run, input: StepInput, dt: number = SIM_DT): RunState {
  const s = run.state;
  s.events.length = 0;
  if (!s.alive) return s;

  movePlayer(s, input, dt);

  // Hazards
  for (let i = s.hazards.length - 1; i >= 0; i--) {
    if (!moveHazard(s.hazards[i]!, s, dt)) s.hazards.splice(i, 1);
  }

  // Level curve
  s.levelTimer += dt;
  if (s.levelTimer >= TUNING.levels.secondsPerLevel || s.coinsThisLevel >= TUNING.levels.coinsPerLevel) {
    s.level++;
    s.levelTimer = 0;
    s.coinsThisLevel = 0;
    s.breather = TUNING.fairness.breatherAfterLevelUp;
    s.events.push({ type: "level_up", level: s.level });
  }
  runSpawner(s, run.rng, dt);

  updateCoins(run, dt);
  checkHazards(s);

  s.tick++;
  s.time = s.tick * SIM_DT;
  return s;
}

function movePlayer(s: RunState, input: StepInput, dt: number): void {
  const p = s.player;
  const P = TUNING.player;
  let kx = input.kx, ky = input.ky;
  const kl = Math.sqrt(kx * kx + ky * ky);
  if (kl > 1) { kx /= kl; ky /= kl; }
  p.x += kx * P.keySpeed * dt;
  p.y += ky * P.keySpeed * dt;

  if (input.dx !== 0 || input.dy !== 0) {
    p.pendingX += input.dx * P.dragGain;
    p.pendingY += input.dy * P.dragGain;
    const pl = Math.sqrt(p.pendingX * p.pendingX + p.pendingY * p.pendingY);
    if (pl > P.dragMaxPending) { p.pendingX *= P.dragMaxPending / pl; p.pendingY *= P.dragMaxPending / pl; }
  }
  const pl = Math.sqrt(p.pendingX * p.pendingX + p.pendingY * p.pendingY);
  if (pl > 0) {
    const m = Math.min(pl, P.dragMaxSpeed * dt);
    const mx = (p.pendingX / pl) * m, my = (p.pendingY / pl) * m;
    p.x += mx; p.y += my;
    p.pendingX -= mx; p.pendingY -= my;
    if (pl - m < 1e-6) { p.pendingX = 0; p.pendingY = 0; }
  }
  const half = p.size / 2;
  const nx = clamp(p.x, half, s.arena.w - half), ny = clamp(p.y, half, s.arena.h - half);
  // Pushing into a wall shouldn't bank drag distance.
  if (nx !== p.x) p.pendingX = 0;
  if (ny !== p.y) p.pendingY = 0;
  p.x = nx; p.y = ny;
}

function updateCoins(run: Run, _dt: number): void {
  const s = run.state;
  const C = TUNING.coins;
  const p = s.player;
  // Respawn
  for (let i = s.coinRespawns.length - 1; i >= 0; i--) {
    if (s.coinRespawns[i]! > s.time) continue;
    const r = run.rng.coins;
    let placed = false;
    for (let a = 0; a < 20 && !placed; a++) {
      const x = r.range(C.edgeMargin, s.arena.w - C.edgeMargin);
      const y = r.range(C.edgeMargin, s.arena.h - C.edgeMargin);
      const dx = x - p.x, dy = y - p.y;
      if (dx * dx + dy * dy < C.minDistFromPlayer * C.minDistFromPlayer) continue;
      if (!clearOfHazards(s, x, y, C.radius, C.hazardClearance)) continue;
      let crowd = false;
      for (const c of s.coins) { const ex = c.x - x, ey = c.y - y; if (ex * ex + ey * ey < 120 * 120) { crowd = true; break; } }
      if (crowd) continue;
      s.coins.push({ id: s.nextId++, x, y, r: C.radius });
      placed = true;
    }
    if (placed) s.coinRespawns.splice(i, 1);
    else s.coinRespawns[i] = s.time + 0.1;
  }
  // Pickup (generous: visual box, not hitbox)
  const half = p.size / 2;
  for (let i = s.coins.length - 1; i >= 0; i--) {
    const c = s.coins[i]!;
    const cx = clamp(c.x, p.x - half, p.x + half), cy = clamp(c.y, p.y - half, p.y + half);
    const dx = c.x - cx, dy = c.y - cy;
    if (dx * dx + dy * dy > c.r * c.r) continue;
    s.coins.splice(i, 1);
    s.coinRespawns.push(s.time + C.respawnDelay);
    s.combo = s.time - s.lastCoinTime <= C.comboWindow ? s.combo + 1 : 0;
    s.lastCoinTime = s.time;
    s.coinsCollected++;
    s.coinsThisLevel++;
    s.score += C.value;
    s.events.push({ type: "coin", x: c.x, y: c.y, combo: s.combo, score: s.score });
  }
}

function checkHazards(s: RunState): void {
  const p = s.player;
  const nearDist = p.size * TUNING.juice.nearMissPlayerWidths;
  for (const hz of s.hazards) {
    if (!isLethal(hz)) continue;
    const g = gapToHazard(p.x, p.y, p.hit, hz);
    if (g < 0) {
      s.alive = false;
      s.deathKind = hz.kind;
      s.events.push({ type: "death", kind: hz.kind, hazardId: hz.id, x: p.x, y: p.y });
      return;
    }
    if (g < nearDist && s.time - hz.lastNearMiss > TUNING.juice.nearMissCooldown) {
      hz.lastNearMiss = s.time;
      s.nearMisses++;
      s.events.push({ type: "near_miss", hazardId: hz.id, kind: hz.kind, x: p.x, y: p.y });
    }
  }
}

/** Stable hash of everything that defines a run's outcome. */
export function hashRun(run: Run): string {
  const s = run.state;
  const json = JSON.stringify({
    tick: s.tick, level: s.level, score: s.score, alive: s.alive, death: s.deathKind,
    p: [s.player.x, s.player.y, s.player.pendingX, s.player.pendingY],
    hz: s.hazards.map(h => [h.id, h.kind, h.x, h.y, h.angle, h.age]),
    coins: s.coins.map(c => [c.id, c.x, c.y]),
    rng: run.rng.states(),
  });
  let h = 0x811c9dc5;
  for (let i = 0; i < json.length; i++) { h ^= json.charCodeAt(i); h = Math.imul(h, 0x01000193); }
  return (h >>> 0).toString(16).padStart(8, "0");
}
