// Headless sanity checks for the 3D pogo physics. Run with `npm run sim`.
// Each scenario steps the simulation against the real level at 240 Hz.

import { Pogo, spawn, step, foot, type Inputs, type PogoState } from "../src/core/pogo3";
import { makeLevel, groundHeight } from "../src/core/level3";

type Ctrl = (t: number, s: PogoState) => Inputs;

const BLOCKS = makeLevel();
const heightAt = (x: number, z: number) => groundHeight(x, z, BLOCKS);

function run(dur: number, ctrl: Ctrl, track?: (t: number, s: PogoState) => void) {
  const s = spawn(0, 0);
  const h = 1 / 240;
  for (let t = 0; t <= dur; t += h) {
    const input = ctrl(t, s);
    step(s, input, h, heightAt);
    track?.(t, s);
  }
  return s;
}

// Flight apexes (rider height local maxima well above rest) to check decay.
function apexes(dur: number, ctrl: Ctrl): number[] {
  const out: number[] = [];
  let prevY = -Infinity;
  let rising = true;
  run(dur, ctrl, (_t, s) => {
    if (s.y > prevY) {
      rising = true;
    } else if (s.y < prevY && rising && prevY > Pogo.L + 60) {
      out.push(prevY);
      rising = false;
    }
    prevY = s.y;
  });
  return out;
}

function scenario(name: string, dur: number, ctrl: Ctrl): void {
  const s = run(dur, ctrl);
  console.log(
    `${name.padEnd(28)} pos=(${s.x.toFixed(0)}, ${s.y.toFixed(0)}, ${s.z.toFixed(0)})` +
      ` vel=(${s.vx.toFixed(0)}, ${s.vy.toFixed(0)}, ${s.vz.toFixed(0)})`
  );
}

// Track the lowest the foot gets while over a wall: cleared iff > wall top.
function flyOver(
  name: string,
  wallZ: number,
  wallD: number,
  wallTop: number,
  startZ: number,
  startY: number,
  vz: number
): void {
  const s = spawn(0, startZ);
  s.y = startY;
  s.vy = 0;
  s.vz = vz;
  let minFoot = Infinity;
  for (let t = 0; t <= 2; t += 1 / 240) {
    step(s, { leanF: false, leanB: false, leanL: false, leanR: false, turnL: false, turnR: false }, 1 / 240, heightAt);
    const f = foot(s);
    if (f.z >= wallZ - wallD / 2 && f.z <= wallZ + wallD / 2) minFoot = Math.min(minFoot, f.y);
  }
  const ok = minFoot > wallTop;
  console.log(
    `${name.padEnd(28)} minFoot=${minFoot.toFixed(0)} (wallTop=${wallTop})` +
      ` endZ=${s.z.toFixed(0)} ${ok ? "CLEARED" : "STOPPED"}`
  );
}

// Continuous idle bounce, no input: apexes should hold steady (no decay).
{
  const a = apexes(10, () => ({ leanF: false, leanB: false, leanL: false, leanR: false, turnL: false, turnR: false }));
  const first = a[0] ?? 0;
  const last = a[a.length - 1] ?? 0;
  const drift = last - first;
  const steady = a.length > 3 && Math.abs(drift) < first * 0.1;
  console.log(
    `idle bounce (no input)   n=${a.length} firstApex=${first.toFixed(0)}` +
      ` lastApex=${last.toFixed(0)} drift=${drift.toFixed(0)}` +
      ` ${steady ? "STEADY" : "DECAYS/GROWS"}`
  );
}

// Hold W (lean forward): should accelerate along +z on each bounce.
scenario("hold W (lean forward)", 6, () => ({
  leanF: true,
  leanB: false,
  leanL: false,
  leanR: false,
  turnL: false,
  turnR: false,
}));

// Hold W and steer with Q (turn left): should curve toward -x.
scenario("hold W + Q (turn left)", 6, () => ({
  leanF: true,
  leanB: false,
  leanL: false,
  leanR: false,
  turnL: true,
  turnR: false,
}));

// Peak foot height while leaning forward.
{
  let peak = -Infinity;
  run(5, () => ({ leanF: true, leanB: false, leanL: false, leanR: false, turnL: false, turnR: false }), (_t, s) => {
    peak = Math.max(peak, foot(s).y);
  });
  console.log(`peak foot: lean forward     maxFoot=${peak.toFixed(0)}px`);
}

flyOver("high flight clears 300 wall", 2200, 70, 300, 1950, 620, 900);
flyOver("low flight stopped by 240 wall", 1400, 70, 240, 1150, 420, 900);

console.log(
  `\nconstants: L=${Pogo.L} K=${Pogo.K} C=${Pogo.C} compressCap=${Pogo.MAX_COMPRESS}` +
    ` slip=${(Pogo.THETA_SLIP * 57.3).toFixed(0)}deg maxSpeed=${Pogo.SPEED_MAX}`
);
