import Phaser from "phaser";
import { PALETTE } from "./palette.js";
import { isLethal } from "../sim/collide.js";
import { TUNING } from "../sim/tuning.js";
import type { Hazard, RunState } from "../sim/types.js";

const TAU = Math.PI * 2;
const easeOut = (t: number) => 1 - (1 - t) * (1 - t);

/**
 * Draws the arena from sim state. Read-only view of RunState; all drawing happens in
 * world units inside `root`, which is scaled/positioned to fit the viewport.
 */
export class ArenaView {
  readonly root: Phaser.GameObjects.Container;
  private readonly gridG: Phaser.GameObjects.Graphics;
  private readonly coinG: Phaser.GameObjects.Graphics;
  private readonly hazG: Phaser.GameObjects.Graphics;
  private readonly ghostG: Phaser.GameObjects.Graphics;
  private readonly playerG: Phaser.GameObjects.Graphics;
  private readonly frameG: Phaser.GameObjects.Graphics;
  private readonly warpG: Phaser.GameObjects.Graphics;
  /** Grid ripples (world units). amp > 0 pushes out, < 0 pulls in. */
  private readonly ripples: { x: number; y: number; t: number; life: number; amp: number; speed: number }[] = [];
  private lastPX = NaN;
  private lastPY = NaN;
  private speed = 0;
  private arenaW = 0;
  private arenaH = 0;
  private readonly popups: { t: Phaser.GameObjects.Text; life: number; x: number; y: number }[] = [];
  readonly fxG: Phaser.GameObjects.Graphics;
  scale = 1;
  ox = 0;
  oy = 0;
  private gridKey = "";
  /** Bouncer impact squash, keyed by hazard id (view-only). */
  private readonly squash = new Map<number, { svx: number; svy: number; axis: "x" | "y"; t: number }>();
  private clock = 0;

  constructor(scene: Phaser.Scene) {
    this.gridG = scene.add.graphics();
    this.coinG = scene.add.graphics();
    this.hazG = scene.add.graphics();
    this.ghostG = scene.add.graphics();
    this.playerG = scene.add.graphics();
    this.fxG = scene.add.graphics();
    this.frameG = scene.add.graphics();
    this.warpG = scene.add.graphics();

    const texts = [];
    for (let i = 0; i < 8; i++) {
      const t = scene.add.text(0, 0, "", { fontFamily: "ui-sans-serif, system-ui, sans-serif", fontSize: "34px", fontStyle: "900", color: "#ffffff", stroke: "#0d0e14", strokeThickness: 6 })
        .setOrigin(0.5).setVisible(false).setResolution(2);
      this.popups.push({ t, life: 0, x: 0, y: 0 });
      texts.push(t);
    }
    this.root = scene.add.container(0, 0, [this.gridG, this.warpG, this.frameG, this.coinG, this.ghostG, this.hazG, this.playerG, this.fxG, ...texts]);
  }

  /** Fit an arena of w×h world units into the viewport (device px), below `topInset`. */
  layout(viewW: number, viewH: number, w: number, h: number, topInset: number, pad: number): void {
    const availW = viewW - pad * 2, availH = viewH - topInset - pad * 2;
    this.scale = Math.max(0.05, Math.min(availW / w, availH / h));
    this.ox = Math.round((viewW - w * this.scale) / 2);
    this.oy = Math.round(topInset + pad + (availH - h * this.scale) / 2);
    this.root.setScale(this.scale);
    this.root.setPosition(this.ox, this.oy);
    const key = `${w}x${h}`;
    if (key !== this.gridKey) { this.gridKey = key; this.drawGrid(w, h); }
  }

  setShake(dx: number, dy: number): void { this.root.setPosition(this.ox + dx, this.oy + dy); }

  private drawGrid(w: number, h: number): void {
    const g = this.gridG;
    this.arenaW = w; this.arenaH = h;
    g.clear();
    g.fillStyle(PALETTE.bg, 1).fillRect(0, 0, w, h);
    g.lineStyle(3, PALETTE.border, 1).strokeRect(0, 0, w, h);
  }

  private frameDt = 0;

  draw(s: RunState, dtMs: number, opts: { ghost: { x: number; y: number } | null; playerPop: number; showPlayer: boolean }): void {
    this.clock += dtMs / 1000;
    const dt = dtMs / 1000;
    this.frameDt = dt;
    this.trackSpeed(s, dt);
    this.drawWarpGrid(s, dt);
    this.drawFrame(s);

    this.drawCoins(s);
    this.drawHazards(s);
    this.drawGhost(opts.ghost, s.player.size);
    this.drawPlayer(s, opts.playerPop, opts.showPlayer);
    this.updatePopups(dtMs / 1000);
  }

  /** Floating score text in world units. */
  popup(x: number, y: number, text: string, color: string, scale = 1): void {
    const p = this.popups.reduce((a, b) => (b.life < a.life ? b : a));
    p.x = x; p.y = y; p.life = 0.8;
    p.t.setText(text).setColor(color).setScale(scale).setPosition(x, y).setAlpha(1).setVisible(true);
  }

  /** Shockwave through the grid. */
  ripple(x: number, y: number, amp: number, life = 0.7, speed = 900): void {
    if (this.ripples.length >= 6) this.ripples.shift();
    this.ripples.push({ x, y, t: 0, life, amp, speed });
  }

  private trackSpeed(s: RunState, dt: number): void {
    const p = s.player;
    if (dt > 0 && Number.isFinite(this.lastPX)) {
      const v = Math.hypot(p.x - this.lastPX, p.y - this.lastPY) / dt;
      // Teleports between runs shouldn't spike the warp.
      this.speed += (Math.min(v, 2000) - this.speed) * Math.min(1, dt / 0.08);
    }
    this.lastPX = p.x; this.lastPY = p.y;
  }

  /**
   * The grid is a membrane: the cube bulges it (more when moving fast) and events send
   * ripples through it. Drawn as polylines each frame; ~2–3k points at 1600×900.
   */
  private drawWarpGrid(s: RunState, dt: number): void {
    const g = this.warpG, cell = TUNING.arena.cell, step = cell / 2;
    const w = this.arenaW, h = this.arenaH;
    g.clear();
    for (let i = this.ripples.length - 1; i >= 0; i--) {
      const r = this.ripples[i]!;
      r.t += dt;
      if (r.t >= r.life) this.ripples.splice(i, 1);
    }
    const p = s.player, alive = s.alive;
    const bulge = alive ? 5 + 15 * Math.min(1, this.speed / 1400) : 0;
    const sig2 = 2 * 85 * 85;
    const rip = this.ripples;
    const warp = (x: number, y: number, out: { x: number; y: number }) => {
      let ox = 0, oy = 0;
      if (bulge > 0) {
        const dx = x - p.x, dy = y - p.y, d2 = dx * dx + dy * dy;
        if (d2 < 90000) {
          const d = Math.sqrt(d2) || 1, k = bulge * Math.exp(-d2 / sig2);
          ox += (dx / d) * k; oy += (dy / d) * k;
        }
      }
      for (const r of rip) {
        const dx = x - r.x, dy = y - r.y, d = Math.sqrt(dx * dx + dy * dy) || 1;
        // Negative speed = implosion: the front starts wide and contracts onto the point.
        const front = r.speed < 0 ? -r.speed * r.life + r.t * r.speed : r.t * r.speed, z = (d - front) / 45;
        if (z < -3 || z > 3) continue;
        const k = r.amp * Math.exp(-z * z) * (1 - r.t / r.life);
        ox += (dx / d) * k; oy += (dy / d) * k;
      }
      // Pin the border so the arena edge never wobbles.
      const edge = Math.min(1, x / cell, (w - x) / cell, y / cell, (h - y) / cell);
      out.x = x + ox * edge; out.y = y + oy * edge;
    };
    const color = s.frenzy > 0 ? 0x2c1820 : PALETTE.grid;
    g.lineStyle(1.5, color, 1);
    const q = { x: 0, y: 0 };
    for (let x = cell; x < w; x += cell) {
      g.beginPath();
      for (let y = 0; y <= h; y += step) { warp(x, y, q); if (y === 0) g.moveTo(q.x, q.y); else g.lineTo(q.x, q.y); }
      g.strokePath();
    }
    for (let y = cell; y < h; y += cell) {
      g.beginPath();
      for (let x = 0; x <= w; x += step) { warp(x, y, q); if (x === 0) g.moveTo(q.x, q.y); else g.lineTo(q.x, q.y); }
      g.strokePath();
    }
  }

  clearPopups(): void { for (const p of this.popups) { p.life = 0; p.t.setVisible(false); } }

  private updatePopups(dt: number): void {
    for (const p of this.popups) {
      if (p.life <= 0) continue;
      p.life -= dt;
      if (p.life <= 0) { p.t.setVisible(false); continue; }
      const k = 1 - p.life / 0.8;
      p.t.setPosition(p.x, p.y - 60 * easeOut(k)).setAlpha(k < 0.6 ? 1 : 1 - (k - 0.6) / 0.4);
    }
  }

  /** True while a frenzy's final seconds should flash prey back to red. */
  private warnBlink(s: RunState): boolean {
    return s.frenzy > 0 && s.frenzy < TUNING.frenzy.warn && Math.floor(s.frenzy * 10) % 2 === 0;
  }

  /** Arena border: pulses red during a frenzy. */
  private drawFrame(s: RunState): void {
    const g = this.frameG;
    g.clear();
    if (s.frenzy <= 0) return;
    const fade = Math.min(1, s.frenzy / 0.25, (TUNING.frenzy.duration - s.frenzy) / 0.12);
    const pulse = 0.5 + 0.5 * Math.sin(this.clock * TAU * 4);
    g.fillStyle(PALETTE.red, 0.05 * fade).fillRect(0, 0, s.arena.w, s.arena.h);
    for (let i = 0; i < 3; i++) {
      g.lineStyle(10 - i * 3, PALETTE.red, (0.18 + 0.3 * pulse) * fade * (1 - i * 0.25));
      g.strokeRect(i * 7, i * 7, s.arena.w - i * 14, s.arena.h - i * 14);
    }
  }

  private drawCoins(s: RunState): void {
    const g = this.coinG;
    g.clear();
    for (const c of s.coins) {
      const r = c.r * (1 + 0.1 * Math.sin(this.clock * 6 + c.id));
      g.fillStyle(PALETTE.coin, 0.12).fillCircle(c.x, c.y, r + 9);
      g.fillStyle(PALETTE.coin, 0.25).fillCircle(c.x, c.y, r + 4);
      g.fillStyle(PALETTE.coin, 1).fillCircle(c.x, c.y, r);
      g.fillStyle(PALETTE.coinCore, 1).fillCircle(c.x - r * 0.25, c.y - r * 0.25, r * 0.4);
    }
  }

  private drawGhost(pose: { x: number; y: number } | null, size: number): void {
    const g = this.ghostG;
    g.clear();
    if (!pose) return;
    g.lineStyle(2, PALETTE.ghost, 0.35).strokeRoundedRect(pose.x - size / 2, pose.y - size / 2, size, size, size * 0.22);
  }

  private drawPlayer(s: RunState, pop: number, show: boolean): void {
    const g = this.playerG;
    g.clear();
    if (!show) return;
    const p = s.player;
    const hunting = s.frenzy > 0 && !this.warnBlink(s);
    const body = hunting ? PALETTE.red : PALETTE.player, core = hunting ? PALETTE.redHot : PALETTE.playerCore;
    // Grace: a quick flicker says "you're safe, but not for long".
    const a = s.grace > 0 && Math.floor(s.grace * 16) % 2 === 0 ? 0.35 : 1;
    const sz = p.size * pop * (s.frenzy > 0 ? 1.12 + 0.05 * Math.sin(this.clock * TAU * 6) : 1);
    const x = p.x - sz / 2, y = p.y - sz / 2, rad = sz * 0.22;
    if (s.frenzy > 0) {
      const k = (this.clock * 2.5) % 1;
      g.lineStyle(3 * (1 - k), body, 0.7 * (1 - k)).strokeRoundedRect(x - 6 - 22 * k, y - 6 - 22 * k, sz + 12 + 44 * k, sz + 12 + 44 * k, rad + 8 + 10 * k);
    }
    g.fillStyle(body, 0.1 * a).fillRoundedRect(x - 10, y - 10, sz + 20, sz + 20, rad + 10);
    g.fillStyle(body, 0.22 * a).fillRoundedRect(x - 5, y - 5, sz + 10, sz + 10, rad + 5);
    g.fillStyle(body, a).fillRoundedRect(x, y, sz, sz, rad);
    g.lineStyle(2, core, 0.9 * a).strokeRoundedRect(x + 2, y + 2, sz - 4, sz - 4, Math.max(1, rad - 2));
  }

  private drawHazards(s: RunState): void {
    const g = this.hazG;
    g.clear();
    for (const hz of s.hazards) this.drawHazard(g, hz, s);
    if (this.squash.size > 64) for (const id of this.squash.keys()) if (!s.hazards.some(h => h.id === id)) this.squash.delete(id);
  }

  private drawHazard(g: Phaser.GameObjects.Graphics, hz: Hazard, s: RunState): void {
    const prey = s.frenzy > 0 && !this.warnBlink(s);
    const RED = prey ? PALETTE.prey : PALETTE.red, HOT = prey ? PALETTE.preyHot : PALETTE.redHot;
    if (s.frenzy > 0) {
      // Prey trembles. Presentation-only offset; the sim position is untouched.
      const j = 1.6;
      hz = { ...hz, x: hz.x + Math.sin(this.clock * 61 + hz.id * 7) * j, y: hz.y + Math.cos(this.clock * 53 + hz.id * 3) * j };
    }
    const lethal = isLethal(hz) || s.frenzy > 0;
    const telegraphing = hz.age < hz.telegraph;
    let alpha = 1;
    if (!telegraphing && hz.age > hz.life - hz.fadeSafe) alpha = Math.max(0, (hz.life - hz.age) / hz.fadeSafe) * 0.6;

    if (hz.kind === "laser") { this.drawLaser(g, hz, s, telegraphing); return; }

    // Telegraph: grows in, blinks faster as it approaches lethal.
    let grow = 1, fillA = alpha, strokeA = 0;
    if (telegraphing) {
      const k = hz.age / hz.telegraph;
      grow = 0.55 + 0.45 * easeOut(Math.min(1, hz.age / 0.22));
      const pulse = 0.5 + 0.5 * Math.sin(hz.age * TAU * (2.5 + 5 * k));
      fillA = 0.14 + 0.22 * pulse * k;
      strokeA = 0.55 + 0.45 * pulse;
    }

    if (hz.kind === "rotor" && telegraphing) {
      const sh = hz.shape as { hw: number };
      g.lineStyle(2, RED, 0.18).strokeCircle(hz.x, hz.y, sh.hw);
    }

    if (hz.shape.type === "circle") {
      const r = hz.shape.r * grow;
      if (hz.kind === "bouncer" && !telegraphing) {
        // Impact squash: flatten along the wall normal for a beat. Reads "it bounces" instantly.
        const q = this.squash.get(hz.id) ?? { svx: Math.sign(hz.vx), svy: Math.sign(hz.vy), axis: "x" as const, t: 0 };
        if (Math.sign(hz.vx) !== q.svx) { q.axis = "x"; q.t = 0.16; }
        else if (Math.sign(hz.vy) !== q.svy) { q.axis = "y"; q.t = 0.16; }
        q.svx = Math.sign(hz.vx); q.svy = Math.sign(hz.vy);
        q.t = Math.max(0, q.t - this.frameDt);
        this.squash.set(hz.id, q);
        const k = Math.sin((q.t / 0.16) * Math.PI) * 0.22;
        const ex = r * 2 * (q.axis === "x" ? 1 - k : 1 + k * 0.6), ey = r * 2 * (q.axis === "y" ? 1 - k : 1 + k * 0.6);
        g.fillStyle(RED, 0.12 * alpha).fillEllipse(hz.x, hz.y, ex + 18, ey + 18);
        g.fillStyle(RED, 0.25 * alpha).fillEllipse(hz.x, hz.y, ex + 8, ey + 8);
        g.fillStyle(RED, fillA).fillEllipse(hz.x, hz.y, ex, ey);
        g.fillStyle(HOT, 0.6 * alpha).fillCircle(hz.x - r * 0.3, hz.y - r * 0.3, r * 0.28);
        return;
      }
      if (hz.kind === "seeker" && !telegraphing) {
        // Comet tail behind the heading: shows it's hunting and where it's turning.
        for (let i = 3; i >= 1; i--) {
          const d = r * 0.9 * i;
          g.fillStyle(RED, 0.16 * alpha * (1 - i / 4)).fillCircle(hz.x - Math.cos(hz.angle) * d, hz.y - Math.sin(hz.angle) * d, r * (1 - i * 0.2));
        }
      }
      if (lethal || !telegraphing) {
        g.fillStyle(RED, 0.12 * alpha).fillCircle(hz.x, hz.y, r + 9);
        g.fillStyle(RED, 0.25 * alpha).fillCircle(hz.x, hz.y, r + 4);
      }
      g.fillStyle(RED, fillA).fillCircle(hz.x, hz.y, r);
      if (strokeA > 0) g.lineStyle(2.5, RED, strokeA).strokeCircle(hz.x, hz.y, r);
      if (hz.kind === "seeker") {
        // A dark "eye" that looks at its heading: reads as alive/homing without colour.
        const ex = hz.x + Math.cos(hz.angle) * r * 0.42, ey = hz.y + Math.sin(hz.angle) * r * 0.42;
        g.fillStyle(PALETTE.bg, telegraphing ? 0.5 : 0.85 * alpha).fillCircle(ex, ey, r * 0.34);
        g.lineStyle(2, HOT, 0.6 * (telegraphing ? strokeA : alpha)).strokeCircle(hz.x, hz.y, r + 5);
      } else if (hz.kind === "bouncer") {
        g.fillStyle(HOT, 0.6 * (telegraphing ? fillA : alpha)).fillCircle(hz.x - r * 0.3, hz.y - r * 0.3, r * 0.28);
      }
      return;
    }

    // Boxes (axis-aligned) and OBBs share a polygon path.
    const sh = hz.shape;
    const hw = sh.hw * grow, hh = sh.hh * grow;
    const ang = sh.type === "obb" ? hz.angle : 0;
    if (lethal || !telegraphing) {
      g.fillStyle(RED, 0.12 * alpha); this.fillRot(g, hz.x, hz.y, hw + 8, hh + 8, ang);
      g.fillStyle(RED, 0.25 * alpha); this.fillRot(g, hz.x, hz.y, hw + 4, hh + 4, ang);
    }
    g.fillStyle(RED, fillA); this.fillRot(g, hz.x, hz.y, hw, hh, ang);
    if (strokeA > 0) { g.lineStyle(2.5, RED, strokeA); this.strokeRot(g, hz.x, hz.y, hw, hh, ang); }
    if (hz.kind === "rotor") {
      // Motion blur: ghost blades trailing the spin direction.
      if (!telegraphing) for (let i = 1; i <= 3; i++) {
        g.fillStyle(RED, 0.13 * alpha * (1 - i / 4)); this.fillRot(g, hz.x, hz.y, hw, hh, ang - hz.angularVel * 0.035 * i);
      }
      g.fillStyle(HOT, alpha).fillCircle(hz.x, hz.y, hh * 0.7);
      g.fillStyle(PALETTE.bg, 0.8 * alpha).fillCircle(hz.x, hz.y, hh * 0.28);
    }
    if (hz.kind === "static") {
      // Segmented "mine bar": dark rivets along the long axis say "inert, but don't touch".
      const horiz = hw > hh, n = 3, len = horiz ? hw : hh, rv = Math.min(hw, hh) * 0.32;
      g.fillStyle(PALETTE.bg, 0.55 * (telegraphing ? fillA * 2 : alpha));
      for (let i = 0; i < n; i++) {
        const o = (i - (n - 1) / 2) * (len * 2 / n);
        g.fillRect(hz.x + (horiz ? o : 0) - rv, hz.y + (horiz ? 0 : o) - rv, rv * 2, rv * 2);
      }
    }
    if (hz.kind === "slider" && !telegraphing) {
      // Printed chevrons + a speed streak: direction is readable mid-motion, not just at telegraph.
      const len = Math.hypot(hz.vx, hz.vy) || 1, ux = hz.vx / len, uy = hz.vy / len, vx = -uy, vy = ux;
      const across = Math.abs(ux) * hw + Math.abs(uy) * hh, side = Math.abs(vx) * hw + Math.abs(vy) * hh;
      g.fillStyle(RED, 0.1 * alpha);
      this.fillRot(g, hz.x - ux * (across + 22), hz.y - uy * (across + 22), Math.abs(ux) * 22 + Math.abs(vx) * side * 0.7, Math.abs(uy) * 22 + Math.abs(vy) * side * 0.7, 0);
      const c = Math.min(side * 0.55, 10);
      g.lineStyle(3, PALETTE.bg, 0.6 * alpha);
      for (const off of side > 20 ? [-side * 0.45, side * 0.45] : [0]) {
        const cx = hz.x + vx * off + ux * c * 0.4, cy = hz.y + vy * off + uy * c * 0.4;
        g.beginPath(); g.moveTo(cx - ux * c + vx * c, cy - uy * c + vy * c); g.lineTo(cx, cy); g.lineTo(cx - ux * c - vx * c, cy - uy * c - vy * c); g.strokePath();
      }
    }

    if (hz.kind === "slider" && telegraphing) {
      // Chevrons point where it will travel.
      const len = Math.hypot(hz.vx, hz.vy) || 1;
      const ux = hz.vx / len, uy = hz.vy / len;
      const vx = -uy, vy = ux;
      g.lineStyle(3, RED, strokeA);
      for (let i = 1; i <= 2; i++) {
        const d = Math.abs(ux) * hw + Math.abs(uy) * hh + 6 + i * 14;
        const cx = hz.x + ux * d, cy = hz.y + uy * d;
        g.beginPath();
        g.moveTo(cx - ux * 8 + vx * 9, cy - uy * 8 + vy * 9);
        g.lineTo(cx, cy);
        g.lineTo(cx - ux * 8 - vx * 9, cy - uy * 8 - vy * 9);
        g.strokePath();
      }
    }
  }

  private drawLaser(g: Phaser.GameObjects.Graphics, hz: Hazard, s: RunState, telegraphing: boolean): void {
    const sh = hz.shape as { hw: number; hh: number };
    const horiz = sh.hw > sh.hh;
    if (telegraphing) {
      const k = hz.age / hz.telegraph;
      const pulse = 0.5 + 0.5 * Math.sin(hz.age * TAU * (3 + 8 * k));
      const a = 0.25 + 0.55 * pulse;
      // Thin aim line + faint beam envelope + edge emitters.
      g.fillStyle(PALETTE.red, 0.06 + 0.1 * k);
      g.fillRect(hz.x - sh.hw, hz.y - sh.hh, sh.hw * 2, sh.hh * 2);
      g.lineStyle(2, PALETTE.red, a);
      if (horiz) g.lineBetween(0, hz.y, s.arena.w, hz.y); else g.lineBetween(hz.x, 0, hz.x, s.arena.h);
      g.fillStyle(PALETTE.red, a);
      const m = 14;
      if (horiz) {
        g.fillTriangle(0, hz.y - m, 0, hz.y + m, m, hz.y);
        g.fillTriangle(s.arena.w, hz.y - m, s.arena.w, hz.y + m, s.arena.w - m, hz.y);
      } else {
        g.fillTriangle(hz.x - m, 0, hz.x + m, 0, hz.x, m);
        g.fillTriangle(hz.x - m, s.arena.h, hz.x + m, s.arena.h, hz.x, s.arena.h - m);
      }
      return;
    }
    const t = (hz.age - hz.telegraph) / Math.max(0.001, hz.life - hz.telegraph);
    const a = 1 - t * 0.5;
    g.fillStyle(PALETTE.red, 0.2 * a).fillRect(hz.x - sh.hw - 6, hz.y - sh.hh - 6, sh.hw * 2 + 12, sh.hh * 2 + 12);
    g.fillStyle(PALETTE.red, a).fillRect(hz.x - sh.hw, hz.y - sh.hh, sh.hw * 2, sh.hh * 2);
    g.fillStyle(PALETTE.white, 0.85 * a);
    if (horiz) g.fillRect(hz.x - sh.hw, hz.y - sh.hh * 0.25, sh.hw * 2, sh.hh * 0.5);
    else g.fillRect(hz.x - sh.hw * 0.25, hz.y - sh.hh, sh.hw * 0.5, sh.hh * 2);
  }

  private corners(x: number, y: number, hw: number, hh: number, a: number): Phaser.Types.Math.Vector2Like[] {
    const c = Math.cos(a), s = Math.sin(a);
    return [[-hw, -hh], [hw, -hh], [hw, hh], [-hw, hh]].map(([u, v]) => ({ x: x + u! * c - v! * s, y: y + u! * s + v! * c }));
  }
  private fillRot(g: Phaser.GameObjects.Graphics, x: number, y: number, hw: number, hh: number, a: number): void {
    if (a === 0) g.fillRect(x - hw, y - hh, hw * 2, hh * 2);
    else g.fillPoints(this.corners(x, y, hw, hh, a), true);
  }
  private strokeRot(g: Phaser.GameObjects.Graphics, x: number, y: number, hw: number, hh: number, a: number): void {
    if (a === 0) g.strokeRect(x - hw, y - hh, hw * 2, hh * 2);
    else g.strokePoints(this.corners(x, y, hw, hh, a), true);
  }
}
