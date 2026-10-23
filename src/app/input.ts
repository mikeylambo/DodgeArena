import type { StepInput } from "../sim/types.js";

/**
 * One semantic input layer: relative drag (touch/mouse) + WASD/arrows → StepInput.
 * Drag deltas are accumulated in CSS px and converted to world units at consume time,
 * so the cube follows the finger's motion 1:1 on screen and is never hidden under it.
 */
export class InputController {
  private keys = new Set<string>();
  private dragId: number | null = null;
  private lastX = 0;
  private lastY = 0;
  private accX = 0;
  private accY = 0;
  /** True once the player has produced any movement input this run. */
  moved = false;
  onPress: ((e: { time: number; kind: "pointer" | "key" }) => void) | null = null;
  onPause: (() => void) | null = null;

  constructor(private readonly target: HTMLElement) {
    target.addEventListener("pointerdown", this.down, { passive: false });
    window.addEventListener("pointermove", this.move, { passive: false });
    window.addEventListener("pointerup", this.up);
    window.addEventListener("pointercancel", this.up);
    window.addEventListener("keydown", this.keyDown);
    window.addEventListener("keyup", e => this.keys.delete(e.code));
    window.addEventListener("blur", () => { this.keys.clear(); this.dragId = null; });
  }

  private down = (e: PointerEvent) => {
    e.preventDefault();
    this.dragId = e.pointerId;
    this.lastX = e.clientX; this.lastY = e.clientY;
    this.onPress?.({ time: performance.now(), kind: "pointer" });
  };
  private move = (e: PointerEvent) => {
    if (e.pointerId !== this.dragId) return;
    e.preventDefault();
    const evs = typeof e.getCoalescedEvents === "function" ? e.getCoalescedEvents() : [];
    const last = evs.length ? evs[evs.length - 1]! : e;
    this.accX += last.clientX - this.lastX;
    this.accY += last.clientY - this.lastY;
    this.lastX = last.clientX; this.lastY = last.clientY;
  };
  private up = (e: PointerEvent) => { if (e.pointerId === this.dragId) this.dragId = null; };
  private keyDown = (e: KeyboardEvent) => {
    if (e.code === "Escape" || e.code === "KeyP") { this.onPause?.(); return; }
    if (["ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight", "Space"].includes(e.code)) e.preventDefault();
    if (!e.repeat) this.onPress?.({ time: performance.now(), kind: "key" });
    this.keys.add(e.code);
  };

  get dragging(): boolean { return this.dragId !== null; }

  /** Discard buffered drag (e.g., between runs) so a stale swipe doesn't move the next cube. */
  flush(): void { this.accX = 0; this.accY = 0; }

  /** Build the input for one fixed step. `cssPxPerWorld` = on-screen CSS px per world unit. */
  consume(cssPxPerWorld: number): StepInput {
    const k = this.keys;
    const kx = (k.has("KeyD") || k.has("ArrowRight") ? 1 : 0) - (k.has("KeyA") || k.has("ArrowLeft") ? 1 : 0);
    const ky = (k.has("KeyS") || k.has("ArrowDown") ? 1 : 0) - (k.has("KeyW") || k.has("ArrowUp") ? 1 : 0);
    let dx = 0, dy = 0;
    if (this.accX !== 0 || this.accY !== 0) {
      dx = this.accX / cssPxPerWorld; dy = this.accY / cssPxPerWorld;
      this.accX = 0; this.accY = 0;
    }
    if (kx || ky || dx || dy) this.moved = true;
    return { kx, ky, dx, dy };
  }
}
