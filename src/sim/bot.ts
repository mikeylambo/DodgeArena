import { closestPointOnHazard, gapToHazard, isLethal } from "./collide.js";
import type { RunState, StepInput } from "./types.js";

export interface BotOptions {
  /** Seconds a hazard must exist before the bot "notices" it (human reaction). */
  reaction: number;
  /** Ticks between decisions (human decision rate). */
  decideEvery: number;
  /** Seconds of motion lookahead on moving hazards. */
  lookahead: number;
  /** Radius within which hazards repel. */
  range: number;
  /** Coin greed weight. */
  greed: number;
}

/** Tuned to stand in for an average player: ~12 Hz decisions, ~300 ms reaction, local awareness only. */
export const AVERAGE_BOT: BotOptions = { reaction: 0.3, decideEvery: 10, lookahead: 0.18, range: 85, greed: 1.0 };

/**
 * Simple potential-field dodge bot: repel from red, attract to coins.
 * Stateless apart from its held decision, so it is deterministic per run.
 */
export class DodgeBot {
  private held: StepInput = { kx: 0, ky: 0, dx: 0, dy: 0 };
  constructor(private readonly opts: BotOptions = AVERAGE_BOT) {}

  decide(s: RunState): StepInput {
    if (s.tick % this.opts.decideEvery !== 0) return this.held;
    const p = s.player;
    const o = this.opts;
    if (s.frenzy > 0) return (this.held = this.hunt(s));
    let fx = 0, fy = 0;

    for (const hz of s.hazards) {
      if (hz.age < o.reaction) continue;
      const lethalSoon = isLethal(hz) || hz.telegraph - hz.age < 0.25;
      const look = isLethal(hz) ? o.lookahead : 0;
      const cp = closestPointOnHazard(p.x, p.y, hz, hz.vx * look, hz.vy * look);
      let dx = p.x - cp.x, dy = p.y - cp.y;
      let d = Math.sqrt(dx * dx + dy * dy);
      if (d < 1e-3) { dx = p.x - hz.x; dy = p.y - hz.y; d = Math.sqrt(dx * dx + dy * dy) || 1; }
      const gap = d - p.hit;
      if (gap > o.range) continue;
      const wgt = (lethalSoon ? 1 : 0.35) * Math.pow((o.range - Math.max(gap, 0)) / o.range, 2) * 6;
      fx += (dx / d) * wgt; fy += (dy / d) * wgt;
    }

    // Walls
    const wallRange = 70;
    if (p.x < wallRange) fx += (wallRange - p.x) / wallRange * 1.5;
    if (s.arena.w - p.x < wallRange) fx -= (wallRange - (s.arena.w - p.x)) / wallRange * 1.5;
    if (p.y < wallRange) fy += (wallRange - p.y) / wallRange * 1.5;
    if (s.arena.h - p.y < wallRange) fy -= (wallRange - (s.arena.h - p.y)) / wallRange * 1.5;

    // Coins: nearest coin that isn't hugging a hazard
    let best = Infinity, tx = s.arena.w / 2, ty = s.arena.h / 2, hasTarget = false;
    for (const c of s.coins) {
      let risky = false;
      for (const hz of s.hazards) if (gapToHazard(c.x, c.y, c.r, hz) < 20) { risky = true; break; }
      if (risky) continue;
      const dx = c.x - p.x, dy = c.y - p.y;
      const d2 = dx * dx + dy * dy;
      if (d2 < best) { best = d2; tx = c.x; ty = c.y; hasTarget = true; }
    }
    const ax = tx - p.x, ay = ty - p.y;
    const ad = Math.sqrt(ax * ax + ay * ay) || 1;
    const pull = hasTarget ? o.greed : 0.15;
    fx += (ax / ad) * pull; fy += (ay / ad) * pull;

    const fl = Math.sqrt(fx * fx + fy * fy);
    this.held = fl > 1e-6 ? { kx: fx / fl, ky: fy / fl, dx: 0, dy: 0 } : { kx: 0, ky: 0, dx: 0, dy: 0 };
    return this.held;
  }

  /** Frenzy: chase the nearest hazard that's at least `reaction` old. */
  private hunt(s: RunState): StepInput {
    const p = s.player;
    let best = Infinity, tx = 0, ty = 0;
    for (const hz of s.hazards) {
      if (hz.age < this.opts.reaction) continue;
      const dx = hz.x - p.x, dy = hz.y - p.y, d2 = dx * dx + dy * dy;
      if (d2 < best) { best = d2; tx = dx; ty = dy; }
    }
    const d = Math.sqrt(best);
    return Number.isFinite(d) && d > 1e-3 ? { kx: tx / d, ky: ty / d, dx: 0, dy: 0 } : { kx: 0, ky: 0, dx: 0, dy: 0 };
  }
}
