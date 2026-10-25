import type Phaser from "phaser";
import { PALETTE } from "./palette.js";
import type { DeterministicRng } from "@slu/web-shell";

interface Particle { x: number; y: number; vx: number; vy: number; life: number; max: number; color: number; size: number }
interface Ring { x: number; y: number; r0: number; r1: number; life: number; max: number; color: number; width: number }

const MAX_PARTICLES = 400;

/** Pooled particles/rings in world units, plus screen shake and flash state. Uses the run's "fx" RNG stream. */
export class FxSystem {
  private readonly particles: Particle[] = [];
  private readonly rings: Ring[] = [];
  shakeT = 0;
  private shakeMag = 0;
  flash = 0;
  private flashColor: number = PALETTE.white;

  constructor(private readonly g: Phaser.GameObjects.Graphics, private rng: DeterministicRng) {}

  setRng(rng: DeterministicRng): void { this.rng = rng; }
  clear(): void { this.particles.length = 0; this.rings.length = 0; this.shakeT = 0; this.flash = 0; }

  burst(x: number, y: number, n: number, color: number, speed: [number, number], life: [number, number], size: [number, number]): void {
    for (let i = 0; i < n && this.particles.length < MAX_PARTICLES; i++) {
      const a = this.rng.range(0, Math.PI * 2), sp = this.rng.range(speed[0], speed[1]);
      const l = this.rng.range(life[0], life[1]);
      this.particles.push({ x, y, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp, life: l, max: l, color, size: this.rng.range(size[0], size[1]) });
    }
  }
  ring(x: number, y: number, r0: number, r1: number, life: number, color: number, width = 3): void {
    this.rings.push({ x, y, r0, r1, life, max: life, color, width });
  }
  shake(mag: number, t: number): void { this.shakeMag = Math.max(this.shakeMag, mag); this.shakeT = Math.max(this.shakeT, t); }
  flashScreen(alpha: number, color: number = PALETTE.white): void { this.flash = Math.max(this.flash, alpha); this.flashColor = color; }
  get flashTint(): number { return this.flashColor; }

  coin(x: number, y: number): void {
    this.ring(x, y, 6, 34, 0.28, PALETTE.coin, 3);
    this.burst(x, y, 10, PALETTE.coin, [80, 240], [0.18, 0.35], [2.5, 4.5]);
  }
  nearMiss(x: number, y: number): void {
    this.burst(x, y, 7, PALETTE.white, [140, 320], [0.1, 0.22], [1.5, 3]);
    this.ring(x, y, 10, 30, 0.16, PALETTE.player, 2);
  }
  death(x: number, y: number): void {
    this.burst(x, y, 46, PALETTE.red, [120, 620], [0.35, 0.9], [3, 7]);
    this.burst(x, y, 18, PALETTE.player, [80, 360], [0.3, 0.7], [2.5, 5]);
    this.ring(x, y, 10, 140, 0.45, PALETTE.red, 5);
    this.shake(14, 0.35);
  }
  eat(x: number, y: number, chain: number): void {
    const k = Math.min(chain, 6);
    this.burst(x, y, 16 + k * 4, PALETTE.prey, [140, 460 + k * 40], [0.25, 0.55], [3, 6]);
    this.burst(x, y, 8, PALETTE.red, [60, 220], [0.2, 0.4], [2.5, 4.5]);
    this.ring(x, y, 12, 60 + k * 10, 0.3, PALETTE.preyHot, 4);
    this.shake(4 + k, 0.16);
  }
  frenzyStart(x: number, y: number, w: number, h: number): void {
    this.flashScreen(0.35, PALETTE.red);
    this.ring(x, y, 20, Math.max(w, h), 0.55, PALETTE.red, 8);
    this.ring(x, y, 10, Math.max(w, h) * 0.6, 0.45, PALETTE.redHot, 4);
    this.shake(8, 0.25);
  }
  frenzyEnd(x: number, y: number): void {
    this.ring(x, y, 70, 18, 0.3, PALETTE.player, 3);
  }
  levelUp(w: number, h: number): void {
    this.flashScreen(0.22);
    this.ring(w / 2, h / 2, 20, Math.max(w, h) * 0.7, 0.6, 0x5ff5ff, 4);
  }

  /** Advance and draw. Returns current shake offset in world units. */
  update(dt: number): { dx: number; dy: number } {
    const g = this.g;
    g.clear();
    for (let i = this.particles.length - 1; i >= 0; i--) {
      const p = this.particles[i]!;
      p.life -= dt;
      if (p.life <= 0) { this.particles.splice(i, 1); continue; }
      p.x += p.vx * dt; p.y += p.vy * dt;
      p.vx *= 1 - 3 * dt; p.vy *= 1 - 3 * dt;
      const k = p.life / p.max;
      g.fillStyle(p.color, k).fillRect(p.x - p.size / 2, p.y - p.size / 2, p.size * k + 1, p.size * k + 1);
    }
    for (let i = this.rings.length - 1; i >= 0; i--) {
      const r = this.rings[i]!;
      r.life -= dt;
      if (r.life <= 0) { this.rings.splice(i, 1); continue; }
      const k = 1 - r.life / r.max;
      g.lineStyle(r.width * (1 - k) + 0.5, r.color, 1 - k).strokeCircle(r.x, r.y, r.r0 + (r.r1 - r.r0) * (1 - (1 - k) * (1 - k)));
    }
    this.flash = Math.max(0, this.flash - dt * 1.2);
    if (this.shakeT > 0) {
      this.shakeT -= dt;
      const m = this.shakeMag * Math.max(0, this.shakeT) / 0.35;
      return { dx: (Math.random() * 2 - 1) * m, dy: (Math.random() * 2 - 1) * m }; // presentation-only randomness
    }
    this.shakeMag = 0;
    return { dx: 0, dy: 0 };
  }
}
