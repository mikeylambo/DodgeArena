import { test } from "node:test";
import assert from "node:assert/strict";
import { createRun, step, eatPoints } from "../src/sim/step.ts";
import { DodgeBot } from "../src/sim/bot.ts";
import { TUNING } from "../src/sim/tuning.ts";

const F = TUNING.frenzy;

test("eat chain doubles and caps", () => {
  assert.equal(eatPoints(1), F.eatBase);
  assert.equal(eatPoints(2), F.eatBase * 2);
  assert.equal(eatPoints(30), F.eatMax);
});

test("frenzy: triggers on charge, eats score, no lasers, no deaths while active or in grace", () => {
  let frenzies = 0, eats = 0;
  for (let i = 0; i < 60; i++) {
    const run = createRun({ seed: `fz-${i}`, orientation: i % 2 ? "portrait" : "landscape" });
    const bot = new DodgeBot();
    const s = run.state;
    while (s.alive && s.time < 120) {
      const before = s.score;
      step(run, bot.decide(s));
      for (const ev of s.events) {
        if (ev.type === "frenzy_start") {
          frenzies++;
          assert.equal(s.frenzyCharge, 0);
          assert.ok(!s.hazards.some(h => h.kind === "laser"), "lasers cleared on frenzy start");
        }
        if (ev.type === "eat") { eats++; assert.equal(ev.points, eatPoints(ev.chain)); }
        if (ev.type === "death") assert.ok(!(s.frenzy > 0 || s.grace > 0), `died during frenzy/grace (seed fz-${i})`);
      }
      if (s.frenzy > 0) assert.ok(!s.hazards.some(h => h.kind === "laser" && h.age < 0.01), "no laser spawns mid-frenzy");
      assert.ok(s.score >= before);
    }
  }
  assert.ok(frenzies > 30, `only ${frenzies} frenzies in 60 runs`);
  assert.ok(eats > frenzies, `bot ate ${eats} in ${frenzies} frenzies`);
});
