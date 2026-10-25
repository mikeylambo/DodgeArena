import { test } from "node:test";
import assert from "node:assert/strict";
import { createRun, step } from "../src/sim/step.ts";
import { DodgeBot } from "../src/sim/bot.ts";
import { gapToHazard } from "../src/sim/collide.ts";

test("set pieces fire every 5 levels, cycle, and never spawn on the player", () => {
  const seen = new Set();
  for (let i = 0; i < 90; i++) {
    const startLevel = [4, 9, 14][i % 3];
    const run = createRun({ seed: `sp-${i}`, orientation: i % 2 ? "portrait" : "landscape", startLevel });
    const s = run.state, bot = new DodgeBot();
    let fired = false;
    while (s.alive && s.time < 25) {
      step(run, bot.decide(s));
      for (const ev of s.events) {
        if (ev.type === "set_piece") { fired = true; seen.add(ev.name); assert.equal(s.level % 5, 0); }
        if (ev.type === "spawn") {
          const hz = s.hazards.find(h => h.id === ev.hazardId);
          if (hz) assert.ok(gapToHazard(s.player.x, s.player.y, s.player.size / 2, hz) > s.player.size, `spawn on player (seed sp-${i}, ${hz.kind})`);
        }
      }
    }
    if (s.alive || s.level >= startLevel + 1) assert.ok(fired || s.level < startLevel + 1, `no set piece (seed sp-${i})`);
  }
  assert.deepEqual([...seen].sort(), ["cage", "swarm", "wall"]);
});
