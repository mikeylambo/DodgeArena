import { InputReplayRecorder, type InputReplayData } from "@slu/web-shell";
import { createRun, step, SIM_HZ, type Run } from "./step.js";
import type { RunConfig, StepInput } from "./types.js";

const tickToMs = (tick: number) => (tick * 1000) / SIM_HZ;
const msToTick = (ms: number) => Math.round((ms * SIM_HZ) / 1000);

/**
 * Records fixed-step inputs into the shell's InputReplay format.
 * Only changes are stored: a frame whenever the held direction changes or a drag delta occurs.
 */
export class TickInputRecorder {
  private tick = 0;
  private lastKx = 0;
  private lastKy = 0;
  private readonly recorder: InputReplayRecorder<StepInput>;
  constructor(private readonly config: RunConfig) {
    this.recorder = new InputReplayRecorder<StepInput>(() => tickToMs(this.tick), {
      seed: config.seed, orientation: config.orientation, hz: SIM_HZ, startLevel: config.startLevel ?? 1,
    });
  }
  /** Call once per fixed step, before step(), with the input that will be applied at `tick`. */
  record(tick: number, input: StepInput): void {
    this.tick = tick;
    if (input.kx !== this.lastKx || input.ky !== this.lastKy || input.dx !== 0 || input.dy !== 0) {
      this.recorder.record({ kx: input.kx, ky: input.ky, dx: input.dx, dy: input.dy });
      this.lastKx = input.kx; this.lastKy = input.ky;
    }
  }
  finish(finalTick: number): InputReplayData<StepInput> {
    this.tick = finalTick;
    return this.recorder.finish();
  }
}

/** Re-simulate a run from its config + recorded inputs. Used for determinism checks and score verification. */
export function replayRun(config: RunConfig, data: InputReplayData<StepInput>): Run {
  const run = createRun(config);
  const byTick = new Map<number, StepInput>();
  for (const f of data.frames) byTick.set(msToTick(f.atMs), f.action);
  const endTick = msToTick(data.durationMs);
  let kx = 0, ky = 0;
  while (run.state.alive && run.state.tick < endTick) {
    const f = byTick.get(run.state.tick);
    let input: StepInput;
    if (f) { kx = f.kx; ky = f.ky; input = f; } else input = { kx, ky, dx: 0, dy: 0 };
    step(run, input);
  }
  return run;
}
