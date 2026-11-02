// Headless sanity checks for the pogo physics. Run with `npm run sim`.
// Each scenario steps the simulation against the real level at 240 Hz.

import { Pogo, spawn, step, foot, type Inputs, type PogoState } from "../src/core/pogo";
import { makeLevel, groundHeight } from "../src/core/level";

type Ctrl = (t: number, s: PogoState) => Inputs;

const BLOCKS = makeLevel();
const heightAt = (x: number) => groundHeight(x, BLOCKS);

// Exact contact check (no one-frame lag like `s.grounded`): the foot is within
// 4px of the surface. Skilled play leans only during true contact.
function contact(s: PogoState): boolean {
  const f = foot(s);
  const g = heightAt(f.x);
  return g !== -Infinity && f.y <= g + 4;
}

function run(dur: number, ctrl: Ctrl, track?: (t: number, s: PogoState) => void) {
  const s = spawn(0);
  const h = 1 / 240;
  for (let t = 0; t <= dur; t += h) {
    const input = ctrl(t, s);
    step(s, input, h, heightAt);
    track?.(t, s);
  }
  return s;
}

// Collect flight apexes (local maxima of rider height well above rest) to
// check for decay. The spring's contact jitter sits near y=L, so filter those.
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
    `${name.padEnd(28)} pos=(${s.x.toFixed(0)}, ${s.y.toFixed(0)})` +
      ` vel=(${s.vx.toFixed(0)}, ${s.vy.toFixed(0)})` +
      ` theta=${(s.theta * 57.3).toFixed(0)}deg`
  );
}

// Peak foot height: the foot must clear a wall top, so this is what matters.
function maxFootHeight(name: string, dur: number, ctrl: Ctrl): void {
  let peak = -Infinity;
  run(dur, ctrl, (_t, s) => {
    peak = Math.max(peak, foot(s).y);
  });
  console.log(`${name.padEnd(28)} maxFoot=${peak.toFixed(0)}px`);
}

// Flying high over a wall clears it; flying low into it stops you.
function flyOver(
  name: string,
  wallX: number,
  wallW: number,
  wallTop: number,
  startY: number
): void {
  const s = spawn(0);
  s.x = wallX - 250;
  s.y = startY;
  s.vy = 0;
  s.vx = 900;
  let minFoot = Infinity;
  for (let t = 0; t <= 2; t += 1 / 240) {
    step(s, { rotL: false, rotR: false }, 1 / 240, heightAt);
    const f = foot(s);
    if (f.x >= wallX && f.x <= wallX + wallW) minFoot = Math.min(minFoot, f.y);
  }
  const ok = minFoot > wallTop;
  console.log(
    `${name.padEnd(28)} minFoot=${minFoot.toFixed(0)} (wallTop=${wallTop})` +
      ` endX=${s.x.toFixed(0)} ${ok ? "CLEARED" : "STOPPED"}`
  );
}

// Continuous idle bounce, no input: apexes should hold steady (no decay).
{
  const a = apexes(10, () => ({ rotL: false, rotR: false }));
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

// Skilled carry: lean exactly while the foot is in contact, straighten in air.
scenario("carry: lean on contact only", 8, (_t, s) => ({
  rotL: false,
  rotR: contact(s),
}));

maxFootHeight("peak foot: idle bounce", 4, () => ({ rotL: false, rotR: false }));
maxFootHeight("peak foot: leaned carry", 6, (_t, s) => ({
  rotL: false,
  rotR: contact(s),
}));

flyOver("high flight clears 300 wall", 2200, 70, 300, 620);
flyOver("low flight stopped by 240 wall", 1400, 70, 240, 420);

console.log(
  `\nconstants: L=${Pogo.L} K=${Pogo.K} C=${Pogo.C} compressCap=${Pogo.MAX_COMPRESS}` +
    ` slip=${(Pogo.THETA_SLIP * 57.3).toFixed(0)}deg maxSpeed=${Pogo.SPEED_MAX}`
);
