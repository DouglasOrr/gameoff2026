import * as physics from "./physics";
import { Input } from "./input";
import { Renderer } from "./renderer";

const canvas = document.getElementById("canvas-main") as HTMLCanvasElement;

const renderer = new Renderer(canvas);
new ResizeObserver(() => renderer.resize()).observe(canvas);
// ResizeObserver won't fire on DPR-only changes (e.g. moving between monitors).
window.addEventListener("resize", () => renderer.resize());
renderer.resize();

const input = new Input(canvas);
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

  const controls = input.read(dt);

  while (acc >= FIXED_DT) {
    physics.step(state, controls, FIXED_DT);
    acc -= FIXED_DT;
  }
  renderer.render(state);
});
