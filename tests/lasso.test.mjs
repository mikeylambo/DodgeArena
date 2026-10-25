import { test } from "node:test";
import assert from "node:assert/strict";
import { createRun, step, pointInPoly } from "../src/sim/step.ts";
import { TUNING } from "../src/sim/tuning.ts";

/** Steer the cube along a circle with drag deltas; returns events seen. */
function circle(run, cx, cy, r, laps = 1.15) {
  const s = run.state, events = [];
  const n = Math.round(90 * laps);
  // Get onto the circle first.
  s.player.x = cx + r; s.player.y = cy;
  for (let i = 1; i <= n; i++) {
    const a = (i / 90) * Math.PI * 2;
    const tx = cx + Math.cos(a) * r, ty = cy + Math.sin(a) * r;
    step(run, { kx: 0, ky: 0, dx: tx - s.player.x - s.player.pendingX, dy: ty - s.player.y - s.player.pendingY });
    events.push(...s.events);
  }
  return events;
}

function withHazard(seed) {
  const run = createRun({ seed, orientation: "landscape" });
  const s = run.state;
  s.breather = 999; s.coinRespawns.length = 0; // isolate the lasso
  s.hazards.push({ id: 999, kind: "bouncer", shape: { type: "circle", r: 22 }, x: 400, y: 450, vx: 0, vy: 0, angle: 0, angularVel: 0,
    age: 0, telegraph: 0.75, life: 99, fadeSafe: 0.25, speed: 0, turnRate: 0, lastNearMiss: -Infinity });
  return run;
}

test("pointInPoly", () => {
  const sq = [{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 10 }, { x: 0, y: 10 }];
  assert.ok(pointInPoly(5, 5, sq));
  assert.ok(!pointInPoly(15, 5, sq));
});

test("closing a loop around a hazard lassos it and scores", () => {
  const run = withHazard("lasso-1");
  const ev = circle(run, 400, 450, 110).filter(e => e.type === "lasso");
  assert.equal(ev.length, 1);
  assert.equal(ev[0].count, 1);
  assert.equal(ev[0].points, TUNING.lasso.pointsPer);
  assert.equal(run.state.hazards.length, 0);
  assert.equal(run.state.score, TUNING.lasso.pointsPer);
});

test("a loop that encloses nothing scores nothing; tiny jitter loops are ignored", () => {
  const run = withHazard("lasso-2");
  assert.equal(circle(run, 1100, 450, 110).filter(e => e.type === "lasso").length, 0);
  assert.equal(circle(run, 400, 450, 14).filter(e => e.type === "lasso").length, 0);
  assert.equal(run.state.hazards.length, 1);
});
