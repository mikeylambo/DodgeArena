import Phaser from "phaser";
import { PhaserAdapter } from "@slu/web-shell";
import { Game } from "./app/game.js";
import { Persistence } from "./app/persistence.js";
import { PALETTE } from "./view/palette.js";
import "./styles.css";

const MAX_DPR = 2;
const dprNow = () => Math.min(MAX_DPR, window.devicePixelRatio || 1);

async function boot(): Promise<void> {
  const persistence = new Persistence();
  await persistence.load();
  const host = document.getElementById("game")!;
  const game = new Game(persistence, host);

  class ArenaScene extends Phaser.Scene {
    constructor() { super("arena"); }
    create(): void { game.attach(this); fit(); }
    override update(_t: number, delta: number): void { game.frame(delta); }
  }

  // Render at device resolution and CSS-scale down, so lines stay crisp on retina phones.
  const dpr = dprNow();
  const phaser = new Phaser.Game({
    type: Phaser.AUTO,
    parent: host,
    backgroundColor: PALETTE.bg,
    width: Math.round(window.innerWidth * dpr),
    height: Math.round(window.innerHeight * dpr),
    zoom: 1 / dpr,
    scale: { mode: Phaser.Scale.NONE },
    antialias: true,
    disableContextMenu: true,
    input: { mouse: false, touch: false, keyboard: false }, // input is handled by the shell-side InputController
    fps: { target: 60, smoothStep: true },
    scene: ArenaScene,
    banner: false,
  });

  // Renderer seam from the shell: resize/suspend/resume go through the adapter.
  const adapter = new PhaserAdapter({
    pause: () => phaser.loop.sleep(),
    resume: () => phaser.loop.wake(),
    resize: (w, h, d) => {
      phaser.scale.resize(Math.round(w * d), Math.round(h * d));
      phaser.scale.setZoom(1 / d);
      game.resize(w, h, d);
    },
  });
  function fit(): void { adapter.resize(window.innerWidth, window.innerHeight, dprNow()); }
  window.addEventListener("resize", fit);
  window.visualViewport?.addEventListener("resize", fit);

  (window as unknown as { __dodge: unknown }).__dodge = { game, phaser, telemetry: game.telemetry, persistence };
}

void boot();
