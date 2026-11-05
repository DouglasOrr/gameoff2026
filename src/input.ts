// Keyboard and mouse input mapped to physics controls.

import type { Inputs } from "./physics";

export const S = {
  leanRate: 1.5, // rad/s from WASD
  mouseSens: 0.0025, // rad per pixel of mouse movement
};

export class Input {
  private readonly held: Record<string, boolean> = {
    w: false,
    a: false,
    s: false,
    d: false,
    shift: false,
  };
  private mouseDx = 0;

  constructor(canvas: HTMLCanvasElement) {
    // Click to capture the mouse; movementX then drives the yaw.
    canvas.addEventListener("click", () => canvas.requestPointerLock());
    canvas.addEventListener("mousemove", (e) => {
      if (document.pointerLockElement === canvas) this.mouseDx += e.movementX;
    });
    window.addEventListener("keydown", (e) => this.onKey(e, true));
    window.addEventListener("keyup", (e) => this.onKey(e, false));
    window.addEventListener("blur", () => {
      for (const key in this.held) this.held[key] = false;
    });
  }

  /** Reads and clears the input accumulated since the last call. */
  read(dt: number): Inputs {
    const { w, a, s, d, shift } = this.held;
    const input: Inputs = {
      yaw: dt > 0 ? -(this.mouseDx * S.mouseSens) / dt : 0,
      pitch: ((w ? 1 : 0) - (s ? 1 : 0)) * S.leanRate,
      roll: ((d ? 1 : 0) - (a ? 1 : 0)) * S.leanRate,
      mega: shift,
    };
    this.mouseDx = 0;
    return input;
  }

  private onKey(e: KeyboardEvent, isDown: boolean): void {
    const key = e.key.toLowerCase();
    if (!Object.hasOwn(this.held, key)) return;
    // Shift is a modifier: record it but don't swallow its default.
    if (key !== "shift") e.preventDefault();
    this.held[key] = isDown;
  }
}
