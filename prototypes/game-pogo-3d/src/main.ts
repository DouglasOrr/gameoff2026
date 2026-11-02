import "./static/style.css";
import { spawn, step } from "./core/pogo3";
import { makeLevel, groundHeight, SPAWN_X, SPAWN_Z, FINISH_Z } from "./core/level3";
import { Render } from "./core/render3";

const canvas = document.getElementById("canvas-main") as HTMLCanvasElement;
const statusEl = document.getElementById("status") as HTMLDivElement;

const blocks = makeLevel();
const render = new Render(canvas, blocks);
const { renderer, scene, camera } = render;

const keys = { leanF: false, leanB: false, leanL: false, leanR: false, turnL: false, turnR: false };
type Key = keyof typeof keys | "reset";

function mapKey(e: KeyboardEvent): Key | null {
  switch (e.key) {
    case "w":
    case "W":
      return "leanF";
    case "s":
    case "S":
      return "leanB";
    case "a":
    case "A":
      return "leanL";
    case "d":
    case "D":
      return "leanR";
    case "q":
    case "Q":
      return "turnL";
    case "e":
    case "E":
      return "turnR";
    case "r":
    case "R":
      return "reset";
    default:
      return null;
  }
}

let state = spawn(SPAWN_X, SPAWN_Z);
let finished = false;
let last: number | null = null;

function reset(): void {
  state = spawn(SPAWN_X, SPAWN_Z);
  finished = false;
}

window.addEventListener("keydown", (e) => {
  const k = mapKey(e);
  if (k) {
    e.preventDefault();
    if (k === "reset") reset();
    else keys[k] = true;
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
  for (const k of Object.keys(keys) as (keyof typeof keys)[]) keys[k] = false;
});

render.resize();
window.addEventListener("resize", () => render.resize());

function frame(time: number): void {
  requestAnimationFrame(frame);
  if (last === null) last = time;
  let dt = (time - last) / 1000;
  last = time;
  if (dt > 0.1) dt = 0.1;

  step(state, keys, dt, (x, z) => groundHeight(x, z, blocks));

  if (!finished && state.z > FINISH_Z) finished = true;
  render.update(state, dt);
  renderer.render(scene, camera);

  statusEl.textContent = `z=${Math.round(state.z)}${
    finished ? "  —  FINISHED! (R to reset)" : ""
  }`;
}
requestAnimationFrame(frame);
