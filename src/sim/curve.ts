import { TUNING, type LevelRow } from "./tuning.js";
import type { HazardKind } from "./types.js";

export interface LevelParams {
  level: number;
  budget: number;
  interval: number;
  speed: number;
  kinds: HazardKind[];
  weights: number[];
}

/** level (1-based) -> hazard budget, spawn interval, speed multiplier and unlocked kinds. */
export function levelParams(level: number): LevelParams {
  const table = TUNING.levels.table;
  const b = TUNING.levels.beyond;
  const idx = Math.max(0, Math.min(level, table.length) - 1);
  const row = table[idx] as LevelRow;
  const extra = Math.max(0, level - table.length);
  const budget = Math.min(b.budgetMax, row.budget + extra * b.budgetPerLevel);
  const interval = Math.max(b.intervalMin, row.interval * Math.pow(b.intervalScale, extra));
  const speed = Math.min(b.speedMax, row.speed + extra * b.speedPerLevel);
  const kinds: HazardKind[] = [];
  const weights: number[] = [];
  for (const [k, w] of Object.entries(row.kinds)) {
    if (w && w > 0) { kinds.push(k as HazardKind); weights.push(w); }
  }
  return { level, budget, interval, speed, kinds, weights };
}
