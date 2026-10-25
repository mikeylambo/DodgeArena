/** Core sim types. Pure data, no renderer imports. */
export interface Vec2 { x: number; y: number }

export type HazardKind = "static" | "slider" | "bouncer" | "rotor" | "seeker" | "laser";
export const HAZARD_KINDS: readonly HazardKind[] = ["static", "slider", "bouncer", "rotor", "seeker", "laser"];

/** Authoritative collision shape. `box` is axis-aligned, `obb` uses the hazard's angle. */
export type Shape =
  | { type: "box"; hw: number; hh: number }
  | { type: "obb"; hw: number; hh: number }
  | { type: "circle"; r: number };

export interface Hazard {
  id: number;
  kind: HazardKind;
  shape: Shape;
  x: number; y: number;
  vx: number; vy: number;
  angle: number;
  angularVel: number;
  /** Seconds since spawn. */
  age: number;
  /** Seconds before the hazard can kill. Always >= fairness.minTelegraph. */
  telegraph: number;
  /** Total lifetime in seconds (Infinity = despawns by leaving the arena). */
  life: number;
  /** Seconds at the end of life during which the hazard is fading and harmless. */
  fadeSafe: number;
  /** Seeker speed (scalar) — other kinds use vx/vy directly. */
  speed: number;
  turnRate: number;
  lastNearMiss: number;
}

export interface Coin { id: number; x: number; y: number; r: number }

export interface Player {
  x: number; y: number;
  /** Visual edge length. */
  size: number;
  /** Hitbox half-extent (size * hitboxScale / 2). */
  hit: number;
  pendingX: number; pendingY: number;
}

/** One fixed-step input sample. kx/ky = keyboard/analog direction, dx/dy = relative drag delta in world units. */
export interface StepInput { kx: number; ky: number; dx: number; dy: number }
export const NO_INPUT: StepInput = Object.freeze({ kx: 0, ky: 0, dx: 0, dy: 0 });

export type SimEvent =
  | { type: "coin"; x: number; y: number; combo: number; score: number }
  | { type: "near_miss"; hazardId: number; kind: HazardKind; x: number; y: number }
  | { type: "level_up"; level: number }
  | { type: "set_piece"; name: "cage" | "wall" | "swarm" }
  | { type: "spawn"; hazardId: number; kind: HazardKind }
  | { type: "death"; kind: HazardKind; hazardId: number; x: number; y: number };

export type Orientation = "landscape" | "portrait";

export interface RunConfig {
  seed: string;
  orientation: Orientation;
  /** Debug/test only: start at a later level. */
  startLevel?: number;
}

export interface RunState {
  seed: string;
  orientation: Orientation;
  arena: { w: number; h: number };
  tick: number;
  time: number;
  level: number;
  levelTimer: number;
  coinsThisLevel: number;
  breather: number;
  spawnTimer: number;
  score: number;
  coinsCollected: number;
  combo: number;
  lastCoinTime: number;
  nearMisses: number;
  /** Pending set-piece beats. */
  script: { at: number; op: "cage" | "wall" | "swarm"; flip: boolean }[];
  player: Player;
  coins: Coin[];
  /** Times (sim seconds) at which a pending coin should try to respawn. */
  coinRespawns: number[];
  hazards: Hazard[];
  nextId: number;
  alive: boolean;
  deathKind: HazardKind | null;
  /** Events produced by the most recent step. Cleared at the start of each step. */
  events: SimEvent[];
}
