import { test } from "node:test";
import assert from "node:assert/strict";
import { createRun, step } from "../src/sim/step.ts";
import { gapToShape } from "../src/sim/collide.ts";
import { spawnFootprint } from "../src/sim/hazards.ts";
import { TUNING } from "../src/sim/tuning.ts";
import { DeterministicRng } from "@slu/web-shell";

const SEEDS = 10_000;
const SECONDS_PER_SEED = 5;
const P = TUNING.player.size;
const SAFE = P * TUNING.fairness.safeSpawnPlayerWidths;

test(`${SEEDS} seeds: no hazard spawns overlapping the player or within ${TUNING.fairness.safeSpawnPlayerWidths} player-widths`, () => {
  let spawns = 0;
  const kindsSeen = new Set();
  for (let seed = 0; seed < SEEDS; seed++) {
    // Cover the whole hazard vocabulary: start seeds across levels 1..9.
    const run = createRun({ seed: `fair-${seed}`, orientation: seed % 3 === 0 ? "portrait" : "landscape", startLevel: 1 + (seed % 9) });
    run.state.breather = 0;
    const walk = new DeterministicRng(seed + 1);
    let kx = 0, ky = 0;
    const ticks = SECONDS_PER_SEED * TUNING.sim.hz;
    for (let t = 0; t < ticks && run.state.alive; t++) {
      if (t % 30 === 0) { kx = walk.range(-1, 1); ky = walk.range(-1, 1); }
      step(run, { kx, ky, dx: 0, dy: 0 });
      for (const ev of run.state.events) {
        if (ev.type !== "spawn") continue;
        spawns++;
        const hz = run.state.hazards.find(h => h.id === ev.hazardId);
        assert.ok(hz, "spawned hazard exists");
        kindsSeen.add(hz.kind);
        const p = run.state.player;
        const g = gapToShape(p.x, p.y, P / 2, spawnFootprint(hz), hz.x, hz.y, hz.angle);
        assert.ok(g >= SAFE - 1e-9, `seed ${seed} t=${t} ${hz.kind} spawned ${g.toFixed(1)}u from player (min ${SAFE})`);
        assert.ok(hz.telegraph >= TUNING.fairness.minTelegraph, `${hz.kind} telegraph ${hz.telegraph}s < min`);
      }
    }
  }
  assert.ok(spawns > SEEDS, `expected plenty of spawns, got ${spawns}`);
  assert.deepEqual([...kindsSeen].sort(), ["bouncer", "laser", "rotor", "seeker", "slider", "static"]);
});

test("no spawns during the post-level-up breather", () => {
  for (let seed = 0; seed < 300; seed++) {
    const run = createRun({ seed: `breather-${seed}`, orientation: "landscape" });
    let breatherUntil = -1;
    while (run.state.alive && run.state.time < 40) {
      step(run, { kx: 0, ky: 0, dx: 0, dy: 0 });
      for (const ev of run.state.events) {
        if (ev.type === "level_up") breatherUntil = run.state.time + TUNING.fairness.breatherAfterLevelUp - 1e-9;
        if (ev.type === "spawn") assert.ok(run.state.time > breatherUntil, `seed ${seed}: spawn at ${run.state.time.toFixed(3)} inside breather`);
      }
    }
  }
});

test("hazards are harmless while telegraphing", () => {
  // Park a hazard on the player during its telegraph: no death until it turns lethal.
  const run = createRun({ seed: "tele", orientation: "landscape" });
  run.state.breather = 999;
  const p = run.state.player;
  run.state.hazards.push({
    id: 999, kind: "static", shape: { type: "box", hw: 36, hh: 12 }, x: p.x, y: p.y,
    vx: 0, vy: 0, angle: 0, angularVel: 0, age: 0, telegraph: 0.5, life: 3, fadeSafe: 0.25,
    speed: 0, turnRate: 0, lastNearMiss: -Infinity,
  });
  const idle = { kx: 0, ky: 0, dx: 0, dy: 0 };
  while (run.state.time < 0.49) { step(run, idle); assert.ok(run.state.alive, `died during telegraph at ${run.state.time}`); }
  for (let i = 0; i < 4; i++) step(run, idle);
  assert.equal(run.state.alive, false);
});
