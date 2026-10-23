import { test } from "node:test";
import assert from "node:assert/strict";
import { createRun, step, hashRun } from "../src/sim/step.ts";
import { DodgeBot } from "../src/sim/bot.ts";
import { TickInputRecorder, replayRun } from "../src/sim/replay.ts";

function botRun(seed, orientation = "landscape", maxSeconds = 120) {
  const config = { seed, orientation };
  const run = createRun(config);
  const bot = new DodgeBot();
  const rec = new TickInputRecorder(config);
  let i = 0;
  while (run.state.alive && run.state.time < maxSeconds) {
    const input = bot.decide(run.state);
    // Mix in drag deltas so the drag path is covered by the determinism check too.
    const withDrag = i++ % 7 === 0 ? { ...input, dx: input.kx * 3.25, dy: input.ky * -1.5 } : input;
    rec.record(run.state.tick, withDrag);
    step(run, withDrag);
  }
  return { config, run, replay: rec.finish(run.state.tick) };
}

test("same seed + same input log -> identical RunState hash", () => {
  for (let i = 0; i < 25; i++) {
    const orientation = i % 2 ? "portrait" : "landscape";
    const a = botRun(`det-${i}`, orientation);
    const b = replayRun(a.config, a.replay);
    assert.equal(b.state.tick, a.run.state.tick, `tick mismatch seed det-${i}`);
    assert.equal(hashRun(b), hashRun(a.run), `hash mismatch seed det-${i}`);
  }
});

test("replay survives a JSON round trip (storage/network format)", () => {
  const a = botRun("det-json");
  const data = JSON.parse(JSON.stringify(a.replay));
  assert.equal(hashRun(replayRun(a.config, data)), hashRun(a.run));
});

test("different seeds diverge", () => {
  const a = createRun({ seed: "x1", orientation: "landscape" });
  const b = createRun({ seed: "x2", orientation: "landscape" });
  const idle = { kx: 0, ky: 0, dx: 0, dy: 0 };
  for (let t = 0; t < 600; t++) { step(a, idle); step(b, idle); }
  assert.notEqual(hashRun(a), hashRun(b));
});
