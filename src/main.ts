import * as physics from "./physics";
import { Renderer } from "./renderer";

const canvas = document.getElementById("canvas-main") as HTMLCanvasElement;

const renderer = new Renderer(canvas);
new ResizeObserver(() => renderer.resize()).observe(canvas);
// ResizeObserver won't fire on DPR-only changes (e.g. moving between monitors).
window.addEventListener("resize", () => renderer.resize());
renderer.resize();

// Click to capture the mouse; movementX then drives the yaw.
canvas.addEventListener("click", () => canvas.requestPointerLock());

const keys = { w: false, a: false, s: false, d: false };
let mouseDx = 0;

canvas.addEventListener("mousemove", (e) => {
  if (document.pointerLockElement === canvas) mouseDx += e.movementX;
});

function mapKey(e: KeyboardEvent): keyof typeof keys | null {
  switch (e.key.toLowerCase()) {
    case "w":
      return "w";
    case "a":
      return "a";
    case "s":
      return "s";
    case "d":
      return "d";
    default:
      return null;
  }
}

window.addEventListener("keydown", (e) => {
  const k = mapKey(e);
  if (k) {
    keys[k] = true;
    e.preventDefault();
  }
});
window.addEventListener("keyup", (e) => {
  const k = mapKey(e);
  if (k) {
    keys[k] = false;
    e.preventDefault();
  }
});
window.addEventListener("blur", () => {
  keys.w = keys.a = keys.s = keys.d = false;
});

const LEAN_RATE = 1.5; // rad/s from WASD
const MOUSE_SENS = 0.0025; // rad per pixel of mouse movement

const state = physics.spawn(0, 0);

// Fixed-timestep accumulator: physics advances in fixed steps regardless of
// frame rate, so the motion is deterministic. The step is short enough to keep
// the pogo's stiff spring stable.
const FIXED_DT = 1 / 240;
const MAX_FRAME = 0.1;
let acc = 0;
let last = performance.now();

renderer.renderer.setAnimationLoop((now: number) => {
  let dt = (now - last) / 1000;
  last = now;
  if (dt > MAX_FRAME) dt = MAX_FRAME;
  acc += dt;

  const input: physics.Inputs = {
    yaw: dt > 0 ? (mouseDx * MOUSE_SENS) / dt : 0,
    pitch: ((keys.w ? 1 : 0) - (keys.s ? 1 : 0)) * LEAN_RATE,
    roll: ((keys.a ? 1 : 0) - (keys.d ? 1 : 0)) * LEAN_RATE,
  };
  mouseDx = 0;

  while (acc >= FIXED_DT) {
    physics.step(state, input, FIXED_DT);
    acc -= FIXED_DT;
  }
  renderer.render(state);
});
