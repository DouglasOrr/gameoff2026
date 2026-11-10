// Smooth heightfield terrain: sphere-segment bumps and bowls, blended into the
// ground with smooth min/max so the joins have no hard edges.

import * as math from "./math";

export type Vec2 = { x: number; z: number };

// The cap of a sphere: a round bump (op "add") or bowl (op "cut") whose foot
// meets the ground on a circle of `radius`, rising `apex` at the centre. Keep
// `apex` well under `radius`, so the blend below has room to round the foot.
export type SphereSegment = {
  center: Vec2;
  radius: number;
  apex: number;
};

export type Feature = {
  op: "add" | "cut";
  shape: SphereSegment;
  blend: number; // fillet radius at the join; larger rounds it more
};

export type Terrain = {
  base: number;
  features: Feature[];
};

// Height of the terrain surface at (x, z).
export function height(t: Terrain, x: number, z: number): number {
  let h = t.base;
  for (const f of t.features) {
    const s = surface(t.base, f, x, z);
    h = f.op === "add" ? smax(h, s, f.blend) : smin(h, s, f.blend);
  }
  return h;
}

// Upward surface normal, from central differences of the height field.
export function normal(t: Terrain, x: number, z: number): math.Vec3 {
  const e = 0.5;
  const dx = height(t, x + e, z) - height(t, x - e, z);
  const dz = height(t, x, z + e) - height(t, x, z - e);
  const n = { x: -dx, y: 2 * e, z: -dz };
  const len = Math.hypot(n.x, n.y, n.z);
  return { x: n.x / len, y: n.y / len, z: n.z / len };
}

// The sphere's upper surface, measured above the base. It crosses the base at
// the foot and carries on below it, so the smooth blend has somewhere to
// complete; past the sphere's equator there is no surface.
function cap(shape: SphereSegment, d2: number): number | null {
  const { radius, apex } = shape;
  const R = (radius * radius + apex * apex) / (2 * apex);
  if (d2 > R * R) return null;
  return Math.sqrt(R * R - d2) - (R - apex);
}

function surface(base: number, f: Feature, x: number, z: number): number {
  const dx = x - f.shape.center.x;
  const dz = z - f.shape.center.z;
  const c = cap(f.shape, dx * dx + dz * dz);
  if (c === null) return f.op === "add" ? -Infinity : Infinity;
  return f.op === "add" ? base + c : base - c;
}

// Polynomial smooth min/max (Inigo Quilez). `k` is the fillet radius; where the
// two surfaces are equal the join bulges or notches by up to k/4.
function smin(a: number, b: number, k: number): number {
  if (k <= 0 || !Number.isFinite(a) || !Number.isFinite(b))
    return Math.min(a, b);
  const h = Math.min(Math.max(0.5 + (0.5 * (b - a)) / k, 0), 1);
  return b + (a - b) * h - k * h * (1 - h);
}

function smax(a: number, b: number, k: number): number {
  if (k <= 0 || !Number.isFinite(a) || !Number.isFinite(b))
    return Math.max(a, b);
  return -smin(-a, -b, k);
}
