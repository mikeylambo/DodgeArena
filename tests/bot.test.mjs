import { test } from "node:test";
import assert from "node:assert/strict";
import { createRun, step } from "../src/sim/step.ts";
import { DodgeBot } from "../src/sim/bot.ts";

const RUNS = 400;
const MAX_SECONDS = 300;

function survey(orientation) {
  const times = [];
  let survivedL1 = 0;
  for (let i = 0; i < RUNS; i++) {
    const run = createRun({ seed: `bot-${i}`, orientation });
    const bot = new DodgeBot();
    let reachedL2 = false;
    while (run.state.alive && run.state.time < MAX_SECONDS) {
      step(run, bot.decide(run.state));
      if (run.state.level >= 2) reachedL2 = true;
    }
    if (reachedL2) survivedL1++;
    times.push(run.state.time);
  }
  times.sort((a, b) => a - b);
  return { median: times[Math.floor(times.length / 2)], l1: survivedL1 / RUNS };
}

for (const orientation of ["landscape", "portrait"]) {
  test(`dodge bot (${orientation}): median survival 45–90 s, level-1 survival > 95%`, () => {
    const { median, l1 } = survey(orientation);
    console.log(`  ${orientation}: median ${median.toFixed(1)} s, level-1 survival ${(l1 * 100).toFixed(1)}%`);
    assert.ok(median >= 45 && median <= 90, `median survival ${median.toFixed(1)} s outside 45–90`);
    assert.ok(l1 > 0.95, `level-1 survival ${(l1 * 100).toFixed(1)}% <= 95%`);
  });
}
