import * as physics from "./physics";
import { Pilot } from "./ai";
import { Input } from "./input";
import { Renderer } from "./renderer";

const canvas = document.getElementById("canvas-main") as HTMLCanvasElement;
const fpsEl = document.getElementById("fps") as HTMLDivElement;

const renderer = new Renderer(canvas);
new ResizeObserver(() => renderer.resize()).observe(canvas);
// ResizeObserver won't fire on DPR-only changes (e.g. moving between monitors).
window.addEventListener("resize", () => renderer.resize());
renderer.resize();

const input = new Input(canvas);
const state = physics.makeState(2);
// pogos[0] is the player; the rest are flown by pilots.
const pilots = state.pogos.slice(1).map((pogo, i) => new Pilot(pogo, i + 1));

// Fixed-timestep accumulator: physics advances in fixed steps regardless of
// frame rate, so the motion is deterministic. The step is short enough to keep
// the pogo's stiff spring stable.
const FIXED_DT = 1 / 240;
const MAX_FRAME = 0.1;
let acc = 0;
let last = performance.now();
let frames = 0;
let fpsSince = last;

renderer.renderer.setAnimationLoop((now: number) => {
  let dt = (now - last) / 1000;
  last = now;
  if (dt > MAX_FRAME) dt = MAX_FRAME;
  acc += dt;

  state.pogos[0].input = input.read(dt);
  for (const pilot of pilots) pilot.update(dt);

  while (acc >= FIXED_DT) {
    physics.step(state, FIXED_DT);
    acc -= FIXED_DT;
  }
  renderer.render(state, dt);

  frames++;
  const elapsed = now - fpsSince;
  if (elapsed >= 500) {
    fpsEl.textContent = `${Math.round((frames * 1000) / elapsed)} fps`;
    frames = 0;
    fpsSince = now;
  }
});
