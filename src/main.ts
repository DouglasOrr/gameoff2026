import * as physics from "./physics";
import { Renderer } from "./renderer";

const canvas = document.getElementById("canvas-main") as HTMLCanvasElement;

const renderer = new Renderer(canvas);
new ResizeObserver(() => renderer.resize()).observe(canvas);
// ResizeObserver won't fire on DPR-only changes (e.g. moving between monitors).
window.addEventListener("resize", () => renderer.resize());
renderer.resize();

const state = physics.spawn(0, 0);

// Fixed-timestep accumulator: physics advances in fixed steps regardless of
// frame rate, so the motion is deterministic. The real pogo will need this
// anyway for its stiff spring.
const FIXED_DT = 1 / 120;
const MAX_FRAME = 0.1;
let acc = 0;
let last = performance.now();

renderer.renderer.setAnimationLoop((now: number) => {
  let dt = (now - last) / 1000;
  last = now;
  if (dt > MAX_FRAME) dt = MAX_FRAME;
  acc += dt;
  while (acc >= FIXED_DT) {
    physics.step(state, FIXED_DT);
    acc -= FIXED_DT;
  }
  renderer.render(state);
});
