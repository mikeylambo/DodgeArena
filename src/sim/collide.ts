import type { Hazard, Shape } from "./types.js";

/**
 * Signed separation between an axis-aligned player box (center px,py, half-extent h)
 * and a hazard shape. < 0 means overlap (a hit).
 *
 * For box/obb this is the SAT max-axis separation: exact in sign, and a lower bound
 * on true Euclidean distance when separated — i.e. conservative for fairness checks.
 */
export function gapToShape(px: number, py: number, h: number, shape: Shape, sx: number, sy: number, angle: number): number {
  switch (shape.type) {
    case "box": {
      return Math.max(Math.abs(px - sx) - (h + shape.hw), Math.abs(py - sy) - (h + shape.hh));
    }
    case "circle": {
      const cx = clamp(sx, px - h, px + h);
      const cy = clamp(sy, py - h, py + h);
      const dx = sx - cx, dy = sy - cy;
      return Math.sqrt(dx * dx + dy * dy) - shape.r;
    }
    case "obb": {
      const c = Math.cos(angle), s = Math.sin(angle);
      const dx = sx - px, dy = sy - py;
      const ac = Math.abs(c), as = Math.abs(s);
      // Axis X (player)
      const g1 = Math.abs(dx) - (h + shape.hw * ac + shape.hh * as);
      // Axis Y (player)
      const g2 = Math.abs(dy) - (h + shape.hw * as + shape.hh * ac);
      // OBB local axis u = (c, s)
      const g3 = Math.abs(dx * c + dy * s) - (shape.hw + h * (ac + as));
      // OBB local axis v = (-s, c)
      const g4 = Math.abs(-dx * s + dy * c) - (shape.hh + h * (as + ac));
      return Math.max(g1, g2, g3, g4);
    }
  }
}

export function gapToHazard(px: number, py: number, h: number, hz: Hazard): number {
  return gapToShape(px, py, h, hz.shape, hz.x, hz.y, hz.angle);
}

/** Closest point on a hazard's shape to point (px,py). Used by the bot and FX. */
export function closestPointOnHazard(px: number, py: number, hz: Hazard, ox = 0, oy = 0): { x: number; y: number } {
  const sx = hz.x + ox, sy = hz.y + oy;
  const shape = hz.shape;
  switch (shape.type) {
    case "box":
      return { x: clamp(px, sx - shape.hw, sx + shape.hw), y: clamp(py, sy - shape.hh, sy + shape.hh) };
    case "circle": {
      const dx = px - sx, dy = py - sy;
      const d = Math.sqrt(dx * dx + dy * dy) || 1;
      const k = Math.min(1, shape.r / d);
      return { x: sx + dx * k, y: sy + dy * k };
    }
    case "obb": {
      const c = Math.cos(hz.angle), s = Math.sin(hz.angle);
      const dx = px - sx, dy = py - sy;
      const lu = clamp(dx * c + dy * s, -shape.hw, shape.hw);
      const lv = clamp(-dx * s + dy * c, -shape.hh, shape.hh);
      return { x: sx + lu * c - lv * s, y: sy + lu * s + lv * c };
    }
  }
}

/** Is the hazard currently able to kill? */
export function isLethal(hz: Hazard): boolean {
  return hz.age >= hz.telegraph && hz.age < hz.life - hz.fadeSafe;
}

export function clamp(v: number, lo: number, hi: number): number { return v < lo ? lo : v > hi ? hi : v; }
