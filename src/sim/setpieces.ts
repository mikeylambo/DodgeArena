import { TUNING } from "./tuning.js";
import type { DeterministicRng } from "@slu/web-shell";
import type { Hazard, RunState } from "./types.js";

/**
 * Set pieces: authored waves that replace random spawns every `setPieces.every` levels.
 * Each is built around the player's position at the moment it fires so a safe answer
 * always exists: the cage leaves you a cell, the wall leaves a gap, the swarm starts far away.
 */
export type SetPieceName = "cage" | "wall" | "swarm";
export const SET_PIECES: readonly SetPieceName[] = ["cage", "wall", "swarm"];

export interface ScriptedSpawn { at: number; op: SetPieceName; flip: boolean }

/** Queue a set piece's beats. Ops fire from `runScript`. */
export function queueSetPiece(s: RunState, name: SetPieceName): void {
  const beats = TUNING.setPieces[name].beats;
  beats.forEach((dt, i) => s.script.push({ at: s.time + dt, op: name, flip: i % 2 === 1 }));
  // Hold random spawns until the piece has played out.
  s.breather = Math.max(s.breather, beats[beats.length - 1]! + TUNING.setPieces.tail);
}

export function runScript(s: RunState, rng: DeterministicRng): void {
  for (let i = 0; i < s.script.length; i++) {
    const b = s.script[i]!;
    if (b.at > s.time) continue;
    s.script.splice(i--, 1);
    if (b.op === "cage") cage(s);
    else if (b.op === "wall") wall(s, rng, b.flip);
    else swarm(s, rng);
  }
}

function base(s: RunState): Omit<Hazard, "kind" | "shape" | "x" | "y" | "telegraph" | "life"> {
  return { id: s.nextId++, vx: 0, vy: 0, angle: 0, angularVel: 0, age: 0, fadeSafe: 0, speed: 0, turnRate: 0, lastNearMiss: -Infinity };
}

function push(s: RunState, hz: Hazard): void {
  s.hazards.push(hz);
  s.events.push({ type: "spawn", hazardId: hz.id, kind: hz.kind });
}

/** Four beams in a # around the player: stay in your cell. */
function cage(s: RunState): void {
  const C = TUNING.setPieces.cage, L = TUNING.hazards.laser;
  const t = L.thickness / 2, { w, h } = s.arena, p = s.player;
  const half = p.size / 2 + C.cell / 2 + t;
  const telegraph = Math.max(C.telegraph, TUNING.fairness.minTelegraph);
  for (const sgn of [-1, 1]) {
    const y = p.y + sgn * half, x = p.x + sgn * half;
    if (y > t && y < h - t) push(s, { ...base(s), kind: "laser", shape: { type: "box", hw: w / 2, hh: t }, x: w / 2, y, telegraph, life: telegraph + L.beam });
    if (x > t && x < w - t) push(s, { ...base(s), kind: "laser", shape: { type: "box", hw: t, hh: h / 2 }, x, y: h / 2, telegraph, life: telegraph + L.beam });
  }
}

/** A wall of sliders sweeps the arena's long axis with one gap. */
function wall(s: RunState, rng: DeterministicRng, flip: boolean): void {
  const W = TUNING.setPieces.wall, sl = TUNING.hazards.slider;
  const { w, h } = s.arena;
  const alongX = w >= h; // sweep across the long axis
  const span = alongX ? h : w;
  const seg = sl.length, thick = sl.thickness / 2;
  const gap = TUNING.player.size * W.gapPlayerWidths;
  const gapAt = rng.range(gap, span - gap);
  const sp = W.speed * (flip ? -1 : 1);
  const start = flip ? (alongX ? w : h) - sl.edgeInset - thick : sl.edgeInset + thick;
  const telegraph = Math.max(W.telegraph, TUNING.fairness.minTelegraph);
  for (let c = seg / 2; c < span; c += seg) {
    if (Math.abs(c - gapAt) < gap / 2 + seg / 2) continue;
    // Never spawn on top of the player, even at the arena edge.
    const x = alongX ? start : c, y = alongX ? c : start;
    if (Math.abs(x - s.player.x) < thick + TUNING.player.size * 2 && Math.abs(y - s.player.y) < seg / 2 + TUNING.player.size * 2) continue;
    push(s, {
      ...base(s), kind: "slider",
      shape: alongX ? { type: "box", hw: thick, hh: seg / 2 } : { type: "box", hw: seg / 2, hh: thick },
      x, y, vx: alongX ? sp : 0, vy: alongX ? 0 : sp,
      telegraph, life: Infinity,
    });
  }
}

/** Seekers from the corners farthest from the player. */
function swarm(s: RunState, rng: DeterministicRng): void {
  const S = TUNING.setPieces.swarm, sk = TUNING.hazards.seeker;
  const { w, h } = s.arena, p = s.player, m = sk.radius + 30;
  const corners = [[m, m], [w - m, m], [m, h - m], [w - m, h - m]]
    .map(([x, y]) => ({ x: x!, y: y!, d: Math.hypot(x! - p.x, y! - p.y) }))
    .sort((a, b) => b.d - a.d)
    .slice(0, S.count)
    .filter(c => c.d > sk.minSpawnDist);
  const telegraph = Math.max(sk.telegraph, TUNING.fairness.minTelegraph);
  for (const c of corners) {
    push(s, {
      ...base(s), kind: "seeker", shape: { type: "circle", r: sk.radius }, x: c.x, y: c.y,
      speed: sk.speed * S.speedMul, turnRate: sk.turnRate, angle: Math.atan2(p.y - c.y, p.x - c.x) + rng.range(-0.3, 0.3),
      fadeSafe: TUNING.fairness.fadeOutSafe, telegraph, life: telegraph + S.life,
    });
  }
}
