import { TUNING } from "./tuning.js";
import { levelParams } from "./curve.js";
import { draftHazard, spawnFootprint } from "./hazards.js";
import { gapToShape, gapToHazard } from "./collide.js";
import type { RunRng } from "./rng.js";
import type { Hazard, RunState } from "./types.js";

/** Minimum distance (from the player's visual box) a hazard may spawn at. */
export function safeSpawnDistance(): number {
  return TUNING.player.size * TUNING.fairness.safeSpawnPlayerWidths;
}

/**
 * Spawn director. Called once per fixed step. Keeps active hazards under the level
 * budget, honours the post-level-up breather, and never spawns a hazard whose
 * footprint is within `safeSpawnDistance` of the player.
 */
export function runSpawner(s: RunState, rng: RunRng, dt: number): void {
  if (s.breather > 0) { s.breather = Math.max(0, s.breather - dt); return; }
  s.spawnTimer -= dt;
  if (s.spawnTimer > 0) return;
  const lp = levelParams(s.level);
  if (s.hazards.length >= lp.budget) { s.spawnTimer = 0.1; return; }
  const r = rng.hazards;
  const kind = r.weighted(lp.kinds, lp.weights);
  const pHalf = s.player.size / 2;
  const safe = Math.max(safeSpawnDistance(), (TUNING.hazards[kind] as { minSpawnDist?: number }).minSpawnDist ?? 0);
  for (let attempt = 0; attempt < TUNING.fairness.spawnAttempts; attempt++) {
    const d = draftHazard(kind, s, r, lp.speed);
    const fp = spawnFootprint(d);
    if (gapToShape(s.player.x, s.player.y, pHalf, fp, d.x, d.y, d.angle) < safe) continue;
    // Don't bury a coin under a hazard (coins must stay collectable).
    let blocksCoin = false;
    for (const c of s.coins) {
      if (gapToShape(c.x, c.y, c.r, fp, d.x, d.y, d.angle) < 4) { blocksCoin = true; break; }
    }
    if (blocksCoin) continue;
    const hz: Hazard = { ...d, id: s.nextId++, age: 0, lastNearMiss: -Infinity };
    s.hazards.push(hz);
    s.events.push({ type: "spawn", hazardId: hz.id, kind: hz.kind });
    s.spawnTimer = lp.interval;
    return;
  }
  s.spawnTimer = 0.1; // no fair placement this tick; retry shortly
}

/** True if (x,y,r) is clear of every hazard (telegraphing or lethal) by `clearance`. */
export function clearOfHazards(s: RunState, x: number, y: number, r: number, clearance: number): boolean {
  for (const hz of s.hazards) if (gapToHazard(x, y, r, hz) < clearance) return false;
  return true;
}
