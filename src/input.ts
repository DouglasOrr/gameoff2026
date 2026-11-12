// Keyboard and mouse input mapped to physics controls.

import type { Inputs } from "./physics";

export const S = {
  leanRate: 1.5, // rad/s from WASD
  mouseSens: 0.0025, // rad of yaw per pixel of mouse movement
  pitchSens: 0.0025, // rad of camera pitch per pixel of vertical mouse movement
  pitchLimit: 0.7, // how far the camera may peek up or down (rad)
};

function clamp(v: number, lo: number, hi: number): number {
  return Math.min(Math.max(v, lo), hi);
}

export class Input {
  private readonly held: Record<string, boolean> = {
    w: false,
    a: false,
    s: false,
    d: false,
    shift: false,
  };
  private mouseDx = 0;
  private mouseDy = 0;
  private cameraToggle = false;
  cameraPitch = 0; // camera look up/down, driven by vertical mouse movement

  constructor(canvas: HTMLCanvasElement) {
    // Click to capture the mouse; movementX then drives the yaw.
    canvas.addEventListener("click", () => canvas.requestPointerLock());
    canvas.addEventListener("mousemove", (e) => {
      if (document.pointerLockElement !== canvas) return;
      this.mouseDx += e.movementX;
      this.mouseDy += e.movementY;
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
    this.cameraPitch = clamp(
      this.cameraPitch - this.mouseDy * S.pitchSens,
      -S.pitchLimit,
      S.pitchLimit,
    );
    this.mouseDx = 0;
    this.mouseDy = 0;
    return input;
  }

  /** Read & reset the camera toggle state. */
  readCameraToggle(): boolean {
    const on = this.cameraToggle;
    this.cameraToggle = false;
    return on;
  }

  private onKey(e: KeyboardEvent, isDown: boolean): void {
    const key = e.key.toLowerCase();
    if (key === "c") {
      if (isDown && !e.repeat) this.cameraToggle = true;
      return;
    }
    if (!Object.hasOwn(this.held, key)) return;
    // Shift is a modifier: record it but don't swallow its default.
    if (key !== "shift") e.preventDefault();
    this.held[key] = isDown;
  }
}
