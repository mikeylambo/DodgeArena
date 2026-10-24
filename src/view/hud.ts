/** DOM HUD + overlays. Text updates only on change. Elements live in index.html. */
const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;

export type Mode = "endless" | "daily";

export interface HudHandlers {
  onPlay(mode: Mode): void;
  onPause(): void;
  onMute(): void;
  onMode(mode: Mode): void;
}

export class Hud {
  private readonly score = $("hud-score");
  private readonly best = $("hud-best");
  private readonly level = $("hud-level");
  private readonly mode = $("hud-mode");
  private readonly card = $("card");
  private readonly over = $("over");
  private readonly paused = $("paused");
  private readonly hint = $("hint");
  private readonly dim = $("dim");
  private readonly dev = $("dev");
  private readonly meter = $("hud-meter");
  private readonly meterFill = this.meter.firstElementChild as HTMLElement;
  private lastMeter = -1;
  private readonly muteBtn = $<HTMLButtonElement>("btn-mute");
  private last = { score: -1, best: -1, level: -1 };

  constructor(h: HudHandlers) {
    $("btn-play").addEventListener("click", e => { e.stopPropagation(); h.onPlay("endless"); });
    $("btn-daily").addEventListener("click", e => { e.stopPropagation(); h.onPlay("daily"); });
    $("btn-pause").addEventListener("pointerdown", e => { e.stopPropagation(); h.onPause(); });
    this.muteBtn.addEventListener("pointerdown", e => { e.stopPropagation(); h.onMute(); });
    for (const btn of document.querySelectorAll<HTMLButtonElement>("[data-mode]")) {
      btn.addEventListener("pointerdown", e => { e.stopPropagation(); h.onMode(btn.dataset.mode as Mode); });
    }
    const coarse = matchMedia("(pointer: coarse)").matches;
    this.hint.classList.toggle("touch", coarse);
  }

  stats(score: number, best: number, level: number): void {
    if (score !== this.last.score) { this.score.textContent = `SCORE: ${score}`; this.last.score = score; }
    if (best !== this.last.best) { this.best.textContent = `BEST: ${best}`; this.last.best = best; }
    if (level !== this.last.level) {
      this.level.textContent = `LEVEL ${level}`;
      if (this.last.level > 0 && level > this.last.level) this.punch(this.level);
      this.last.level = level;
    }
  }
  /** Frenzy meter: fills with charge (0..1), or drains with time left while `frenzy`. */
  meterState(fill: number, frenzy: boolean): void {
    const q = Math.round(fill * 200) / 200 + (frenzy ? 2 : 0);
    if (q === this.lastMeter) return;
    this.lastMeter = q;
    this.meter.classList.toggle("frenzy", frenzy);
    this.meterFill.style.transform = `scaleX(${fill})`;
  }
  punchScore(): void { this.punch(this.score); }
  setMode(mode: Mode): void {
    this.mode.textContent = mode === "daily" ? "DAILY" : "";
    for (const btn of document.querySelectorAll<HTMLButtonElement>("[data-mode]")) btn.classList.toggle("on", btn.dataset.mode === mode);
  }
  setMuted(m: boolean): void { this.muteBtn.classList.toggle("muted", m); this.muteBtn.setAttribute("aria-pressed", String(m)); }

  showCard(v: boolean): void { this.card.hidden = !v; }
  showHint(v: boolean): void { this.hint.classList.toggle("on", v); }
  showPaused(v: boolean): void { this.paused.hidden = !v; this.dim.classList.toggle("on", v || !this.over.hidden); }
  showOver(v: boolean, r?: { score: number; best: number; level: number; newBest: boolean; eaten: number }): void {
    this.over.hidden = !v;
    this.dim.classList.toggle("on", v);
    if (v && r) {
      $("over-score").textContent = String(r.score);
      $("over-best").textContent = `BEST: ${r.best}`;
      $("over-level").textContent = `LEVEL ${r.level}`;
      $("over-new").hidden = !r.newBest;
      $("over-eaten").textContent = `${r.eaten} EATEN`;
      $("over-eaten").hidden = $("over-eaten-sep").hidden = r.eaten === 0;
    }
  }
  devText(t: string | null): void { this.dev.hidden = t === null; if (t !== null) this.dev.textContent = t; }

  private punch(el: HTMLElement): void {
    el.classList.remove("punch");
    void el.offsetWidth; // restart CSS animation
    el.classList.add("punch");
  }
}
