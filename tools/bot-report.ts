/**
 * Headless bot report: survival distribution for the dodge bot across seeds.
 * Usage: npm run bot -- [runs=400] [orientation=landscape]
 */
import { createRun, step, SIM_HZ } from "../src/sim/step.js";
import { DodgeBot, AVERAGE_BOT } from "../src/sim/bot.js";
import type { Orientation } from "../src/sim/types.js";

const runs = Number(process.argv[2] ?? 400);
const orientation = (process.argv[3] ?? "landscape") as Orientation;
const botOpts = { ...AVERAGE_BOT, ...(process.env.BOT ? JSON.parse(process.env.BOT) : {}) };
const maxSeconds = 300;

const times: number[] = [];
const levels: number[] = [];
const deaths: Record<string, number> = {};
let survivedL1 = 0;
let coins = 0;
for (let i = 0; i < runs; i++) {
  const run = createRun({ seed: `bot-${i}`, orientation });
  const bot = new DodgeBot(botOpts);
  let reachedL2 = false;
  while (run.state.alive && run.state.time < maxSeconds) {
    step(run, bot.decide(run.state));
    if (run.state.level >= 2) reachedL2 = true;
  }
  if (reachedL2) survivedL1++;
  times.push(run.state.time);
  levels.push(run.state.level);
  coins += run.state.coinsCollected;
  const k = run.state.deathKind ?? "timeout";
  deaths[k] = (deaths[k] ?? 0) + 1;
}
times.sort((a, b) => a - b);
const q = (p: number) => times[Math.floor(p * (times.length - 1))]!.toFixed(1);
console.log(`runs=${runs} hz=${SIM_HZ} orientation=${orientation}`);
console.log(`survival s: p10=${q(0.1)} p25=${q(0.25)} median=${q(0.5)} p75=${q(0.75)} p90=${q(0.9)}`);
console.log(`level-1 survival: ${(100 * survivedL1 / runs).toFixed(1)}%`);
console.log(`mean level at death: ${(levels.reduce((a, b) => a + b, 0) / runs).toFixed(2)}  mean coins: ${(coins / runs).toFixed(1)}`);
console.log(`deaths by kind:`, deaths);
