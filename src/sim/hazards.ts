import { TUNING, type Range } from "./tuning.js";
import type { DeterministicRng } from "@slu/web-shell";
import type { Hazard, HazardKind, RunState, Shape } from "./types.js";

const range = (rng: DeterministicRng, r: Range) => rng.range(r[0], r[1]);

/** A candidate hazard before it is accepted by the spawner. */
export type HazardDraft = Omit<Hazard, "id" | "age" | "lastNearMiss">;

/**
 * Geometry used for safe-spawn checks. For hazards that sweep (rotor) this is the
 * full sweep disc, so the player can never be inside the swept area at spawn.
 */
export function spawnFootprint(d: HazardDraft): Shape {
  if (d.kind === "rotor" && d.shape.type === "obb") return { type: "circle", r: d.shape.hw };
  return d.shape;
}

function telegraphFor(base: number): number {
  return Math.max(base, TUNING.fairness.minTelegraph);
}

/** Draft a hazard of `kind` at a random placement. Spawner validates fairness. */
export function draftHazard(kind: HazardKind, s: RunState, rng: DeterministicRng, speedMul: number): HazardDraft {
  const { w, h } = s.arena;
  const fadeSafe = TUNING.fairness.fadeOutSafe;
  const base = { vx: 0, vy: 0, angle: 0, angularVel: 0, speed: 0, turnRate: 0, fadeSafe };
  switch (kind) {
    case "static": {
      const c = TUNING.hazards.static;
      const horiz = rng.chance(0.5);
      const hw = (horiz ? c.length : c.thickness) / 2, hh = (horiz ? c.thickness : c.length) / 2;
      return {
        ...base, kind, shape: { type: "box", hw, hh },
        x: rng.range(hw + 10, w - hw - 10), y: rng.range(hh + 10, h - hh - 10),
        telegraph: telegraphFor(c.telegraph), life: telegraphFor(c.telegraph) + range(rng, c.life),
      };
    }
    case "slider": {
      const c = TUNING.hazards.slider;
      const edge = rng.int(0, 3); // 0 left, 1 right, 2 top, 3 bottom
      const movesX = edge < 2;
      // Bars broadside to their motion read as sweeping walls; edge-on ones as darts.
      const broadside = rng.chance(0.65);
      const longAlongY = movesX ? broadside : !broadside;
      const hw = (longAlongY ? c.thickness : c.length) / 2, hh = (longAlongY ? c.length : c.thickness) / 2;
      const sp = range(rng, c.speed) * speedMul;
      let x: number, y: number, vx = 0, vy = 0;
      if (movesX) {
        y = rng.range(hh + 10, h - hh - 10);
        x = edge === 0 ? c.edgeInset + hw : w - c.edgeInset - hw;
        vx = edge === 0 ? sp : -sp;
      } else {
        x = rng.range(hw + 10, w - hw - 10);
        y = edge === 2 ? c.edgeInset + hh : h - c.edgeInset - hh;
        vy = edge === 2 ? sp : -sp;
      }
      return { ...base, kind, shape: { type: "box", hw, hh }, x, y, vx, vy, telegraph: telegraphFor(c.telegraph), life: Infinity, fadeSafe: 0 };
    }
    case "bouncer": {
      const c = TUNING.hazards.bouncer;
      const a = rng.range(0, Math.PI * 2);
      const sp = range(rng, c.speed) * speedMul;
      return {
        ...base, kind, shape: { type: "circle", r: c.radius },
        x: rng.range(c.radius + 10, w - c.radius - 10), y: rng.range(c.radius + 10, h - c.radius - 10),
        vx: Math.cos(a) * sp, vy: Math.sin(a) * sp,
        telegraph: telegraphFor(c.telegraph), life: telegraphFor(c.telegraph) + range(rng, c.life),
      };
    }
    case "rotor": {
      const c = TUNING.hazards.rotor;
      const hw = c.length / 2, hh = c.thickness / 2;
      const dir = rng.chance(0.5) ? 1 : -1;
      return {
        ...base, kind, shape: { type: "obb", hw, hh },
        x: rng.range(hw * 0.6, w - hw * 0.6), y: rng.range(hw * 0.6, h - hw * 0.6),
        angle: rng.range(0, Math.PI), angularVel: dir * range(rng, c.angularSpeed) * speedMul,
        telegraph: telegraphFor(c.telegraph), life: telegraphFor(c.telegraph) + range(rng, c.life),
      };
    }
    case "seeker": {
      const c = TUNING.hazards.seeker;
      return {
        ...base, kind, shape: { type: "circle", r: c.radius },
        x: rng.range(c.radius + 10, w - c.radius - 10), y: rng.range(c.radius + 10, h - c.radius - 10),
        speed: c.speed * speedMul, turnRate: c.turnRate, angle: rng.range(0, Math.PI * 2),
        telegraph: telegraphFor(c.telegraph), life: telegraphFor(c.telegraph) + range(rng, c.life),
      };
    }
    case "laser": {
      const c = TUNING.hazards.laser;
      const horiz = rng.chance(w >= h ? 0.6 : 0.4);
      const t = c.thickness / 2;
      const telegraph = telegraphFor(c.telegraph);
      // Half the time, aim the beam just beside the player so it carves their space.
      const safe = TUNING.player.size * TUNING.fairness.safeSpawnPlayerWidths + TUNING.player.size / 2 + t;
      const near = (p: number, max: number) => {
        const off = (safe + rng.range(4, 140)) * (rng.chance(0.5) ? 1 : -1);
        return Math.min(max - t - 20, Math.max(t + 20, p + off));
      };
      const aimed = rng.chance(0.5);
      return {
        ...base, kind, fadeSafe: 0,
        shape: horiz ? { type: "box", hw: w / 2, hh: t } : { type: "box", hw: t, hh: h / 2 },
        x: horiz ? w / 2 : aimed ? near(s.player.x, w) : rng.range(t + 20, w - t - 20),
        y: horiz ? (aimed ? near(s.player.y, h) : rng.range(t + 20, h - t - 20)) : h / 2,
        telegraph, life: telegraph + c.beam,
      };
    }
  }
}

/** Advance one hazard by dt seconds. Returns false when it should despawn. */
export function moveHazard(hz: Hazard, s: RunState, dt: number): boolean {
  hz.age += dt;
  if (hz.age >= hz.life) return false;
  if (hz.age < hz.telegraph) return true; // frozen while telegraphing
  const { w, h } = s.arena;
  switch (hz.kind) {
    case "static":
    case "laser":
      return true;
    case "slider": {
      hz.x += hz.vx * dt; hz.y += hz.vy * dt;
      const sh = hz.shape as { hw: number; hh: number };
      return !(hz.x + sh.hw < 0 || hz.x - sh.hw > w || hz.y + sh.hh < 0 || hz.y - sh.hh > h);
    }
    case "bouncer": {
      const r = (hz.shape as { r: number }).r;
      hz.x += hz.vx * dt; hz.y += hz.vy * dt;
      if (hz.x < r) { hz.x = r; hz.vx = Math.abs(hz.vx); }
      else if (hz.x > w - r) { hz.x = w - r; hz.vx = -Math.abs(hz.vx); }
      if (hz.y < r) { hz.y = r; hz.vy = Math.abs(hz.vy); }
      else if (hz.y > h - r) { hz.y = h - r; hz.vy = -Math.abs(hz.vy); }
      return true;
    }
    case "rotor":
      hz.angle += hz.angularVel * dt;
      return true;
    case "seeker": {
      const desired = Math.atan2(s.player.y - hz.y, s.player.x - hz.x);
      let diff = desired - hz.angle;
      while (diff > Math.PI) diff -= Math.PI * 2;
      while (diff < -Math.PI) diff += Math.PI * 2;
      const maxTurn = hz.turnRate * dt;
      hz.angle += diff > maxTurn ? maxTurn : diff < -maxTurn ? -maxTurn : diff;
      hz.vx = Math.cos(hz.angle) * hz.speed; hz.vy = Math.sin(hz.angle) * hz.speed;
      hz.x += hz.vx * dt; hz.y += hz.vy * dt;
      return true;
    }
  }
}
