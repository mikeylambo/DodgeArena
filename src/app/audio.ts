import type { AudioBusName, AudioSystem } from "@slu/web-shell";

export type SfxId = "coin" | "near_miss" | "level_up" | "death" | "start" | "frenzy_start" | "eat" | "frenzy_end";

/**
 * Asset-free WebAudio synth implementing the shell's AudioSystem contract, so
 * AudioLifecycleCoordinator can pause it on blur/pause. Gameplay asks for semantic
 * ids ("coin"), never files.
 */
export class SynthAudio implements AudioSystem {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private sfxBus: GainNode | null = null;
  private muted = false;
  private volumes: Record<string, number> = { master: 0.8, sfx: 1 };

  /** Must be called from a user gesture (browser autoplay policy). */
  unlock(): void {
    if (!this.ctx) {
      const Ctx = window.AudioContext ?? (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      if (!Ctx) return;
      this.ctx = new Ctx();
      this.master = this.ctx.createGain();
      this.sfxBus = this.ctx.createGain();
      this.sfxBus.connect(this.master);
      this.master.connect(this.ctx.destination);
      this.apply();
    }
    if (this.ctx.state === "suspended") void this.ctx.resume();
  }

  setBusVolume(bus: AudioBusName, value: number): void { this.volumes[bus] = value; this.apply(); }
  setMuted(muted: boolean): void { this.muted = muted; this.apply(); }
  pauseAll(): void { void this.ctx?.suspend(); }
  resumeAll(): void { void this.ctx?.resume(); }

  private apply(): void {
    if (!this.master || !this.sfxBus) return;
    this.master.gain.value = this.muted ? 0 : (this.volumes.master ?? 1);
    this.sfxBus.gain.value = this.volumes.sfx ?? 1;
  }

  playSfx(id: string, options: { volume?: number; pitch?: number } = {}): void {
    const ctx = this.ctx, out = this.sfxBus;
    if (!ctx || !out || ctx.state !== "running") return;
    const t = ctx.currentTime;
    const p = options.pitch ?? 1, v = options.volume ?? 1;
    switch (id as SfxId) {
      case "coin":
        this.tone("triangle", 880 * p, 1320 * p, t, 0.09, 0.22 * v);
        this.tone("sine", 1760 * p, 1760 * p, t + 0.02, 0.06, 0.08 * v);
        break;
      case "near_miss":
        this.noise(t, 0.035, 0.18 * v, 4500);
        this.tone("square", 2400, 1800, t, 0.03, 0.04 * v);
        break;
      case "level_up":
        [0, 4, 7, 12].forEach((semi, i) => this.tone("triangle", 523.25 * Math.pow(2, semi / 12), 523.25 * Math.pow(2, semi / 12), t + i * 0.07, 0.16, 0.16 * v));
        break;
      case "death":
        this.tone("sawtooth", 220, 40, t, 0.45, 0.25 * v);
        this.noise(t, 0.35, 0.3 * v, 900);
        break;
      case "frenzy_start":
        this.tone("sawtooth", 110, 880, t, 0.32, 0.14 * v);
        [0, 3, 7, 12].forEach((semi, i) => this.tone("square", 440 * Math.pow(2, semi / 12), 440 * Math.pow(2, semi / 12), t + 0.05 + i * 0.045, 0.12, 0.07 * v));
        this.noise(t, 0.25, 0.16 * v, 2500);
        break;
      case "eat":
        // Chomp: a pitched drop plus a crunch; pitch climbs with the chain.
        this.tone("square", 660 * p, 180 * p, t, 0.11, 0.16 * v);
        this.tone("triangle", 1320 * p, 1320 * p, t + 0.03, 0.08, 0.1 * v);
        this.noise(t, 0.06, 0.22 * v, 3200);
        break;
      case "frenzy_end":
        this.tone("triangle", 660, 220, t, 0.22, 0.12 * v);
        break;
      case "start":
        this.tone("sine", 440, 660, t, 0.12, 0.12 * v);
        break;
    }
  }

  private tone(type: OscillatorType, f0: number, f1: number, t: number, dur: number, vol: number): void {
    const ctx = this.ctx!, o = ctx.createOscillator(), g = ctx.createGain();
    o.type = type;
    o.frequency.setValueAtTime(f0, t);
    o.frequency.exponentialRampToValueAtTime(Math.max(20, f1), t + dur);
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(vol, t + 0.005);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g).connect(this.sfxBus!);
    o.start(t); o.stop(t + dur + 0.02);
  }

  private noiseBuf: AudioBuffer | null = null;
  private noise(t: number, dur: number, vol: number, cutoff: number): void {
    const ctx = this.ctx!;
    if (!this.noiseBuf) {
      this.noiseBuf = ctx.createBuffer(1, ctx.sampleRate * 0.5, ctx.sampleRate);
      const d = this.noiseBuf.getChannelData(0);
      for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
    }
    const src = ctx.createBufferSource(), f = ctx.createBiquadFilter(), g = ctx.createGain();
    src.buffer = this.noiseBuf;
    f.type = "lowpass"; f.frequency.value = cutoff;
    g.gain.setValueAtTime(vol, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    src.connect(f).connect(g).connect(this.sfxBus!);
    src.start(t); src.stop(t + dur + 0.02);
  }
}
