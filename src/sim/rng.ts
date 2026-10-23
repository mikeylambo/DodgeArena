import { DeterministicRngRegistry, type DeterministicRng } from "@slu/web-shell";

export type StreamName = "hazards" | "coins" | "fx";
export const STREAMS: readonly StreamName[] = ["hazards", "coins", "fx"];

/** Per-run RNG: independent named streams so coin draws never perturb hazard draws. */
export class RunRng {
  private readonly registry = new DeterministicRngRegistry<StreamName>(STREAMS);
  constructor(seed: string | number) { this.registry.init(seed); }
  get hazards(): DeterministicRng { return this.registry.stream("hazards"); }
  get coins(): DeterministicRng { return this.registry.stream("coins"); }
  get fx(): DeterministicRng { return this.registry.stream("fx"); }
  states(): Record<string, number> { return this.registry.states(); }
}
