import "./static/style.css";
import { spawn, step } from "./core/pogo";
import { makeLevel, groundHeight, FINISH_X, SPAWN_X } from "./core/level";
import { Render } from "./core/render";

const canvas = document.getElementById("canvas-main") as HTMLCanvasElement;
const statusEl = document.getElementById("status") as HTMLDivElement;

const blocks = makeLevel();
const render = new Render(canvas, blocks);
const { renderer, scene, camera } = render;

const keys = { rotL: false, rotR: false };
type Key = keyof typeof keys | "reset";

function mapKey(e: KeyboardEvent): Key | null {
  switch (e.key) {
    case "ArrowLeft":
    case "a":
    case "A":
      return "rotL";
    case "ArrowRight":
    case "d":
    case "D":
      return "rotR";
    case "r":
    case "R":
      return "reset";
    default:
      return null;
  }
}

let state = spawn(SPAWN_X);
let finished = false;
let camX = SPAWN_X;
let last: number | null = null;

function reset(): void {
  state = spawn(SPAWN_X);
  finished = false;
  camX = SPAWN_X;
}

window.addEventListener("keydown", (e) => {
  const k = mapKey(e);
  if (k) {
    e.preventDefault();
    if (k === "reset") {
      reset();
    } else {
      keys[k] = true;
    }
  }
});
window.addEventListener("keyup", (e) => {
  const k = mapKey(e);
  if (k && k !== "reset") {
    e.preventDefault();
    keys[k] = false;
  }
});
window.addEventListener("blur", () => {
  keys.rotL = keys.rotR = false;
});

render.resize();
window.addEventListener("resize", () => render.resize());

function frame(time: number): void {
  requestAnimationFrame(frame);
  if (last === null) last = time;
  let dt = (time - last) / 1000;
  last = time;
  if (dt > 0.1) dt = 0.1;

  const input = { ...keys };
  step(state, input, dt, (x) => groundHeight(x, blocks));

  if (!finished && state.x > FINISH_X) finished = true;
  camX += (state.x - camX) * Math.min(1, dt * 3);
  render.update(state, camX);
  renderer.render(scene, camera);

  statusEl.textContent = `x=${Math.round(state.x)}${
    finished ? "  —  FINISHED! (R to reset)" : ""
  }`;
}
requestAnimationFrame(frame);
