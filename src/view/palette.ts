/**
 * Visual language. Gameplay categories also differ by shape/motion (constitution #9), not color alone.
 *
 * The palette is live: each theme has a calm and a hot stop, and `Heat` blends between them
 * as the run escalates (level, plus a bump during set pieces). Retrying cools it back down.
 * Draw code reads PALETTE every frame, so it always sees the current blend.
 */
export interface Colors {
  bg: number; grid: number; border: number;
  player: number; playerCore: number; ghost: number;
  coin: number; coinCore: number;
  red: number; redHot: number;
  white: number;
}

export type ThemeId = "standard" | "colorblind";

const THEMES: Record<ThemeId, { calm: Colors; hot: Colors }> = {
  // Calm: deep indigo, coral danger, mint you. Hot: near-black, saturated red, electric cyan.
  standard: {
    calm: { bg: 0x10132a, grid: 0x1b2040, border: 0x2a3160, player: 0x7af5c6, playerCore: 0xdafff0, ghost: 0x7af5c6, coin: 0xffd966, coinCore: 0xfff6d8, red: 0xff7466, redHot: 0xffa79c, white: 0xffffff },
    hot: { bg: 0x0e0a0f, grid: 0x21161c, border: 0x3a222b, player: 0x5ff5ff, playerCore: 0xc8fdff, ghost: 0x5ff5ff, coin: 0xffe94a, coinCore: 0xfffbd1, red: 0xff2a46, redHot: 0xff6a7c, white: 0xffffff },
  },
  // Okabe–Ito based: orange danger vs sky-blue you separate under protan/deutan/tritan vision;
  // coins go near-white so they differ from danger in lightness, not just hue.
  colorblind: {
    calm: { bg: 0x0f1424, grid: 0x1b2238, border: 0x2b3452, player: 0x56b4e9, playerCore: 0xd8efff, ghost: 0x56b4e9, coin: 0xf2f2f2, coinCore: 0xffffff, red: 0xffa040, redHot: 0xffc98a, white: 0xffffff },
    hot: { bg: 0x0b0c10, grid: 0x1d1e24, border: 0x34353f, player: 0x3fa9ff, playerCore: 0xd0e9ff, ghost: 0x3fa9ff, coin: 0xf7f7f7, coinCore: 0xffffff, red: 0xff7a00, redHot: 0xffb04d, white: 0xffffff },
  },
};

export const PALETTE: Colors = { ...THEMES.standard.calm };

const lerpColor = (a: number, b: number, t: number) => {
  const ch = (s: number) => Math.round(((a >> s) & 255) + (((b >> s) & 255) - ((a >> s) & 255)) * t);
  return (ch(16) << 16) | (ch(8) << 8) | ch(0);
};
const hex = (c: number) => `#${c.toString(16).padStart(6, "0")}`;
const smooth = (t: number) => t * t * (3 - 2 * t);

/** Level at which a run reaches full heat. */
const HOT_LEVEL = 10;
/** Extra heat while a set piece plays. */
const SET_PIECE_BUMP = 0.3;
/** Seconds for heat to settle on its target. */
const SETTLE = 1.4;

let version = 0;
/** Changes whenever PALETTE does. */
export const heatVersion = () => version;

export class Heat {
  private heat = 0;
  private theme: ThemeId = "standard";
  private css = "";

  setTheme(t: ThemeId): void { this.theme = t; this.apply(true); }
  get themeId(): ThemeId { return this.theme; }

  /** Ease toward the heat for this moment of the run. */
  update(level: number, setPiece: boolean, dt: number): void {
    const target = Math.min(1, smooth(Math.min(1, Math.max(0, (level - 1) / (HOT_LEVEL - 1)))) + (setPiece ? SET_PIECE_BUMP : 0));
    const prev = this.heat;
    this.heat += (target - this.heat) * Math.min(1, dt / SETTLE);
    if (Math.abs(this.heat - prev) > 1e-4) this.apply(false);
  }

  private apply(force: boolean): void {
    const { calm, hot } = THEMES[this.theme];
    for (const k of Object.keys(calm) as (keyof Colors)[]) PALETTE[k] = lerpColor(calm[k], hot[k], this.heat);
    version++;
    const css = `${PALETTE.bg}|${PALETTE.red}|${PALETTE.player}`;
    if (!force && css === this.css) return;
    this.css = css;
    const root = document.documentElement.style;
    root.setProperty("--bg", hex(PALETTE.bg));
    root.setProperty("--red", hex(PALETTE.red));
    root.setProperty("--cyan", hex(PALETTE.player));
    root.setProperty("--red-rgb", `${(PALETTE.red >> 16) & 255},${(PALETTE.red >> 8) & 255},${PALETTE.red & 255}`);
    root.setProperty("--cyan-rgb", `${(PALETTE.player >> 16) & 255},${(PALETTE.player >> 8) & 255},${PALETTE.player & 255}`);
    document.querySelector('meta[name="theme-color"]')?.setAttribute("content", hex(PALETTE.bg));
  }
}
