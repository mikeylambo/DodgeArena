import tuningJson from "../content/tuning.json" with { type: "json" };
import type { HazardKind } from "./types.js";

export type Range = [number, number];

export interface LevelRow { budget: number; interval: number; speed: number; kinds: Partial<Record<HazardKind, number>> }

export interface Tuning {
  arena: { landscape: { width: number; height: number }; portrait: { width: number; height: number }; cell: number };
  sim: { hz: number };
  player: { size: number; hitboxScale: number; keySpeed: number; dragGain: number; dragMaxSpeed: number; dragMaxPending: number };
  coins: { radius: number; onScreen: number; value: number; respawnDelay: number; minDistFromPlayer: number; hazardClearance: number; edgeMargin: number; comboWindow: number };
  fairness: { minTelegraph: number; safeSpawnPlayerWidths: number; breatherAfterLevelUp: number; spawnAttempts: number; fadeOutSafe: number };
  frenzy: { charge: number; duration: number; warn: number; grace: number; eatBase: number; eatMax: number };
  juice: { nearMissPlayerWidths: number; nearMissCooldown: number; hitstopMs: number };
  levels: {
    secondsPerLevel: number;
    coinsPerLevel: number;
    table: LevelRow[];
    beyond: { budgetPerLevel: number; budgetMax: number; intervalScale: number; intervalMin: number; speedPerLevel: number; speedMax: number };
  };
  hazards: {
    static: { length: number; thickness: number; telegraph: number; life: Range };
    slider: { length: number; thickness: number; telegraph: number; speed: Range; edgeInset: number };
    bouncer: { radius: number; telegraph: number; speed: Range; life: Range };
    rotor: { length: number; thickness: number; telegraph: number; angularSpeed: Range; life: Range };
    seeker: { radius: number; telegraph: number; speed: number; turnRate: number; life: Range };
    laser: { thickness: number; telegraph: number; beam: number };
  };
}

export const TUNING = tuningJson as unknown as Tuning;
