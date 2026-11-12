// Core game objects and physics.

import * as math from "./math";
import * as terrain from "./terrain";

export const S = {
  stickLength: 20,
  gravity: 240,
  springStiffness: 600,
  maxStrainRatio: 1 / 6, // axial compression cap as a fraction of the stick length
  spawnDrop: 30, // spawn height of the rider above its resting contact height
  friction: 0.2, // Coulomb friction coefficient at the foot
  frictionSlip: 0.05, // tanh scale that smooths Coulomb stiction near zero slip
  drag: 0.007, // quadratic air resistance
  bounceBoost: 25, // fixed extra speed per bounce (active spring), spread over extension
  megaBoost: 75, // extra speed while holding the mega boost, spread over extension
  treeBounce: 0.5, // restitution when rebounding off a tree
  rampBounce: 0.5, // restitution when rebounding off a ramp's vertical faces
  riderRadius: 2.5, // pogo collision radius at the rider
  footRadius: 1, // pogo collision radius at the stick's foot
  toppleAxisY: -0.5, // stick Y (rider -> foot) above which the pogo counts as fallen
  gateDepth: 8, // gate thickness along its axis, the same for every gate
};

export type Inputs = {
  yaw: number; // rad/s about world Y
  pitch: number; // rad/s about local X
  roll: number; // rad/s about local Z
  mega: boolean;
};

export type Pogo = {
  position: math.Vec3;
  orientation: math.Quat; // rider -> foot is local -Y
  velocity: math.Vec3;
  strain: number; // axial compression of the stick (0 when airborne)
  peakStrain: number;
  input: Inputs;
  nextGate: number;
  lap: number;
  time: number;
};

export type Tree = {
  position: math.Vec3; // base of the cone, on the ground
  radius: number; // base radius of the cone
  height: number;
};

// A ramp: a straight wedge rising `height` over `length` along local +Z, then
// running `flat` more at full height (0 for a plain kicker). Yaw-only.
export type Ramp = {
  position: math.Vec3; // centre of the footprint, on the ground
  orientation: math.Quat;
  length: number; // run of the sloping part, ground to full height
  flat: number; // extra run at full height on top (0 for none)
  width: number;
  height: number;
};

// A V-shaped half-pipe: a straight trough whose two walls meet on the centreline
// at the ground and rise to `height`, opening at `angle` (the full angle between
// them). You hop between the walls to keep height. Yaw-only.
export type HalfPipe = {
  position: math.Vec3; // centre of the base, on the ground
  orientation: math.Quat;
  length: number; // span along local +Z
  angle: number; // full opening angle of the V (radians)
  height: number; // rise of each wall from the centreline
};

// A checkpoint: an oriented box the rider passes through along local Z.
export type Gate = {
  position: math.Vec3;
  orientation: math.Quat; // identity faces +z
  width: number;
  height: number;
};

export type Level = {
  gates: Gate[];
  trees: Tree[];
  ramps: Ramp[];
  halfPipes: HalfPipe[];
  terrain: terrain.Terrain;
  laps: number;
};

export type State = {
  level: Level;
  pogos: Pogo[];
};

export const IDLE: Inputs = { yaw: 0, pitch: 0, roll: 0, mega: false };

export function makePogo(
  x: number,
  z: number,
  groundY: number,
  orientation: math.Quat,
): Pogo {
  return {
    position: { x, y: groundY + S.stickLength + S.spawnDrop, z },
    orientation,
    velocity: { x: 0, y: 0, z: 0 },
    strain: 0,
    peakStrain: 0,
    input: { ...IDLE },
    nextGate: 0,
    lap: 0,
    time: 0,
  };
}

// Line up `count` riders across the track behind the first gate, all facing
// through it.
export function loadLevel(level: Level, count: number): State {
  const start = level.gates[0];
  const through = math.rotate(start.orientation, { x: 0, y: 0, z: 1 });
  const across = math.rotate(start.orientation, { x: 1, y: 0, z: 0 });
  const back = 3 * S.stickLength; // start this far short of the first gate

  const pogos: Pogo[] = [];
  for (let i = 0; i < count; i++) {
    // Side by side across the track, all facing through the first gate.
    const lane = (i - (count - 1) / 2) * S.stickLength * 3;
    const x = start.position.x - through.x * back + across.x * lane;
    const z = start.position.z - through.z * back + across.z * lane;
    pogos.push(
      makePogo(x, z, terrain.height(level.terrain, x, z), start.orientation),
    );
  }
  return { pogos, level };
}

// Axial compression that puts the stick tip on the terrain (0 when airborne).
// Solve p.y + u*axis.y = height(foot) for the stick length u, then strain = L-u.
function terrainStrain(
  t: terrain.Terrain,
  p: math.Vec3,
  axis: math.Vec3,
): number {
  const L = S.stickLength;
  const lo = L - S.maxStrainRatio * L;
  const gap = (u: number) =>
    p.y + u * axis.y - terrain.height(t, p.x + u * axis.x, p.z + u * axis.z);

  // Start from the flat-ground estimate (exact when the ground is flat), then
  // refine with Newton, since a bump under the foot bends the line.
  let u = Math.min(
    Math.max((terrain.height(t, p.x, p.z) - p.y) / axis.y, lo),
    L,
  );
  for (let i = 0; i < 8; i++) {
    const g = gap(u);
    if (Math.abs(g) < 1e-6) break;
    const e = 1e-3;
    const dg = (gap(u + e) - gap(u - e)) / (2 * e);
    if (Math.abs(dg) < 1e-9) break;
    u = Math.min(Math.max(u - g / dg, lo), L);
  }
  return L - u;
}

// Axial compression that puts the stick tip on whichever surface stops it
// first: the terrain, or the top of a ramp. Unlike the terrain, a ramp's top is
// planar, so its contact is closed form rather than a solve.
function contactStrain(level: Level, p: math.Vec3, axis: math.Vec3): number {
  if (axis.y >= -1e-6) return 0;
  let strain = terrainStrain(level.terrain, p, axis);
  for (const ramp of level.ramps)
    strain = Math.max(strain, rampStrain(ramp, p, axis));
  for (const pipe of level.halfPipes) {
    strain = Math.max(strain, halfPipeStrain(pipe, -1, p, axis));
    strain = Math.max(strain, halfPipeStrain(pipe, 1, p, axis));
  }
  return strain;
}

// Local (x, z) of a world point in a yaw-only frame at `origin`.
function toLocal(
  origin: math.Vec3,
  orientation: math.Quat,
  x: number,
  z: number,
): { x: number; z: number } {
  const d = math.rotate(math.conjugateQuat(orientation), {
    x: x - origin.x,
    y: 0,
    z: z - origin.z,
  });
  return { x: d.x, z: d.z };
}

// A local point lifted into world space, with the ramp's ground height applied.
function rampPoint(ramp: Ramp, lx: number, ly: number, lz: number): math.Vec3 {
  const r = math.rotate(ramp.orientation, { x: lx, y: ly, z: lz });
  return {
    x: ramp.position.x + r.x,
    y: ramp.position.y + r.y,
    z: ramp.position.z + r.z,
  };
}

// The top surface height, in local Z: the run from the back edge at -half rises
// over `length`, then plateaus. Callers check the footprint separately.
function rampTop(ramp: Ramp, lz: number): number {
  const half = (ramp.length + ramp.flat) / 2;
  return ramp.height * Math.min((lz + half) / ramp.length, 1);
}

// Highest surface under (x, z): the terrain, or a ramp top covering the point.
// For things that only need a height - shadows, the camera's floor - not a
// contact solve.
export function groundHeight(level: Level, x: number, z: number): number {
  let h = terrain.height(level.terrain, x, z);
  for (const ramp of level.ramps) {
    const l = toLocal(ramp.position, ramp.orientation, x, z);
    const half = (ramp.length + ramp.flat) / 2;
    if (Math.abs(l.x) <= ramp.width / 2 && Math.abs(l.z) <= half)
      h = Math.max(h, ramp.position.y + rampTop(ramp, l.z));
  }
  for (const pipe of level.halfPipes) {
    const l = toLocal(pipe.position, pipe.orientation, x, z);
    const w = pipe.height * Math.tan(pipe.angle / 2);
    if (Math.abs(l.z) <= pipe.length / 2 && Math.abs(l.x) <= w)
      h = Math.max(h, pipe.position.y + (Math.abs(l.x) / w) * pipe.height);
  }
  return h;
}

// Strain for the tip resting on one planar face of a ramp: where the tip
// crosses the plane, then whether that point lands within the face - its local
// z-span [z0, z1] and the ramp's width.
function faceStrain(
  ramp: Ramp,
  normal: math.Vec3,
  point: math.Vec3,
  p: math.Vec3,
  axis: math.Vec3,
  lo: number,
  z0: number,
  z1: number,
): number {
  const L = S.stickLength;
  const denom = normal.x * axis.x + normal.y * axis.y + normal.z * axis.z;
  if (denom >= -1e-9) return 0; // the tip slides along the face, not into it
  const raw =
    (normal.x * (point.x - p.x) +
      normal.y * (point.y - p.y) +
      normal.z * (point.z - p.z)) /
    denom;
  // Clamp like the terrain solve: a face needing more than the stick's travel
  // still presses at full compression, rather than dropping the contact.
  const u = Math.min(Math.max(raw, lo), L);
  const l = toLocal(
    ramp.position,
    ramp.orientation,
    p.x + u * axis.x,
    p.z + u * axis.z,
  );
  if (Math.abs(l.x) > ramp.width / 2 || l.z < z0 || l.z > z1) return 0;
  return L - u;
}

// Axial compression that rests the tip on a ramp's top, or 0 if it misses it.
function rampStrain(ramp: Ramp, p: math.Vec3, axis: math.Vec3): number {
  const L = S.stickLength;
  const lo = L - S.maxStrainRatio * L;
  const half = (ramp.length + ramp.flat) / 2;

  // The sloped face, normal leaning back over the foot, through the back edge.
  const slope = math.rotate(ramp.orientation, {
    x: 0,
    y: ramp.length,
    z: -ramp.height,
  });
  let strain = faceStrain(
    ramp,
    slope,
    rampPoint(ramp, 0, 0, -half),
    p,
    axis,
    lo,
    -half,
    half - ramp.flat,
  );

  // The flat top, when there is one.
  if (ramp.flat > 0) {
    const flat = math.rotate(ramp.orientation, { x: 0, y: 1, z: 0 });
    strain = Math.max(
      strain,
      faceStrain(
        ramp,
        flat,
        rampPoint(ramp, 0, ramp.height, half - ramp.flat),
        p,
        axis,
        lo,
        half - ramp.flat,
        half,
      ),
    );
  }
  return strain;
}

// Axial compression that rests the tip on one of a half-pipe's slanted walls, or
// 0 if it misses it. `side` is -1 for the wall on local -x, +1 for +x.
function halfPipeStrain(
  pipe: HalfPipe,
  side: number,
  p: math.Vec3,
  axis: math.Vec3,
): number {
  const L = S.stickLength;
  const lo = L - S.maxStrainRatio * L;
  const phi = pipe.angle / 2;

  // The wall's inward normal (local): up and back toward the centreline.
  const normal = math.rotate(pipe.orientation, {
    x: -side * Math.cos(phi),
    y: Math.sin(phi),
    z: 0,
  });
  const denom = normal.x * axis.x + normal.y * axis.y + normal.z * axis.z;
  if (denom >= -1e-9) return 0;
  const raw =
    (normal.x * (pipe.position.x - p.x) +
      normal.y * (pipe.position.y - p.y) +
      normal.z * (pipe.position.z - p.z)) /
    denom;
  // Test the face where the stick actually meets the plane, not at a clamped
  // length: clamping first drags a tip that is off the wall back onto it, which
  // would fake a wall extending past the top edge.
  if (raw < 0 || raw > L) return 0;

  const tip = {
    x: p.x + raw * axis.x,
    y: p.y + raw * axis.y,
    z: p.z + raw * axis.z,
  };
  const l = toLocal(pipe.position, pipe.orientation, tip.x, tip.z);
  if (Math.abs(l.z) > pipe.length / 2) return 0;

  // Along the wall from the centreline to the top edge; must land on the face.
  const along =
    l.x * side * Math.sin(phi) + (tip.y - pipe.position.y) * Math.cos(phi);
  if (along < 0 || along > pipe.height / Math.cos(phi)) return 0;
  return L - Math.max(raw, lo);
}

// Rebound the pogo off a ramp's vertical faces - the lip and the two sides. The
// top is handled by the ground contact, so here a sphere only bounces when it is
// outside the footprint, hard against a side or the lip; inside the footprint it
// is over the top, which the ground contact owns.
function bounceOffRamp(
  p: math.Vec3,
  v: math.Vec3,
  ramp: Ramp,
  sx: number,
  sy: number,
  sz: number,
  r: number,
): void {
  const half = (ramp.length + ramp.flat) / 2;
  const l = toLocal(ramp.position, ramp.orientation, sx, sz);
  const ly = sy - ramp.position.y;
  if (ly >= rampTop(ramp, l.z) - r) return; // on or above the top: not a wall
  if (ly < -r) return; // under the base: the ground's job

  const hw = ramp.width / 2;
  if (Math.abs(l.x) <= hw && Math.abs(l.z) <= half) return; // over the top

  // Nearest point on the footprint rectangle; the centre is outside it, so the
  // push is at most the sphere's radius.
  const qx = Math.min(Math.max(l.x, -hw), hw);
  const qz = Math.min(Math.max(l.z, -half), half);
  const nx = l.x - qx;
  const nz = l.z - qz;
  const d = Math.hypot(nx, nz);
  const pen = r - d;
  if (pen <= 0 || d < 1e-6) return;

  const n = math.rotate(ramp.orientation, { x: nx / d, y: 0, z: nz / d });
  p.x += n.x * pen;
  p.z += n.z * pen;
  const vn = v.x * n.x + v.z * n.z;
  if (vn < 0) {
    const j = (1 + S.rampBounce) * vn;
    v.x -= j * n.x;
    v.z -= j * n.z;
  }
}

// Push a sphere out along `n` by `pen`, reflecting its velocity (restitution e).
function pushOut(
  p: math.Vec3,
  v: math.Vec3,
  n: math.Vec3,
  pen: number,
  e: number,
): void {
  p.x += n.x * pen;
  p.y += n.y * pen;
  p.z += n.z * pen;
  const vn = v.x * n.x + v.y * n.y + v.z * n.z;
  if (vn < 0) {
    const j = (1 + e) * vn;
    v.x -= j * n.x;
    v.y -= j * n.y;
    v.z -= j * n.z;
  }
}

// Rebound the pogo off a half-pipe's solid faces from outside: the vertical
// outer side and the triangular end caps. `side` is -1 or +1. The slanted walls
// are the contact surfaces, handled elsewhere.
function bounceOffHalfPipe(
  p: math.Vec3,
  v: math.Vec3,
  pipe: HalfPipe,
  side: number,
  sx: number,
  sy: number,
  sz: number,
  r: number,
): void {
  const w = pipe.height * Math.tan(pipe.angle / 2);
  const half = pipe.length / 2;
  const l = toLocal(pipe.position, pipe.orientation, sx, sz);
  const ly = sy - pipe.position.y;
  if (ly < -r || ly > pipe.height + r) return;

  // The vertical outer face, over the length.
  const outside = side * l.x - w;
  if (outside >= 0 && outside < r && Math.abs(l.z) < half + r) {
    const n = math.rotate(pipe.orientation, { x: side, y: 0, z: 0 });
    pushOut(p, v, n, r - outside, S.rampBounce);
  }

  // The triangular end caps, when the sphere is within the solid section.
  const lx = side * l.x;
  if (lx >= 0 && lx <= w && ly >= 0 && ly < (lx / w) * pipe.height) {
    for (const end of [-1, 1]) {
      const beyond = end * l.z - half;
      if (beyond >= 0 && beyond < r) {
        const n = math.rotate(pipe.orientation, { x: 0, y: 0, z: end });
        pushOut(p, v, n, r - beyond, S.rampBounce);
      }
    }
  }
}

// Rebound the pogo off a tree. A tree is a cone (base radius, height); each
// contact is a sphere (the rider or the foot of the stick) against it.
function bounceOffTree(
  p: math.Vec3,
  v: math.Vec3,
  tree: Tree,
  sx: number,
  sy: number,
  sz: number,
  r: number,
): void {
  const R = tree.radius;
  const H = tree.height;
  const dx = sx - tree.position.x;
  const dz = sz - tree.position.z;
  const d = Math.hypot(dx, dz); // horizontal distance from the axis
  const y = sy - tree.position.y; // height above the base
  if (d > R + r || y > H + r || y < -r) return;

  // Work in the (radius, height) half-plane, where the cone is the triangle
  // (0,0)-(R,0)-(0,H). Find the closest point on its boundary - the base disk or
  // the slanted side; the (0,0)-(0,H) edge is the axis, not a surface.
  let bx = Math.min(d, R);
  let by = 0;
  let best = Math.hypot(d - bx, y);

  const t = Math.min(Math.max((R * (R - d) + y * H) / (R * R + H * H), 0), 1);
  const lx = R * (1 - t);
  const ly = H * t;
  const ld = Math.hypot(d - lx, y - ly);
  if (ld < best) {
    best = ld;
    bx = lx;
    by = ly;
  }

  const inside = y >= 0 && y <= H && d / R + y / H <= 1;
  if (!inside && best >= r) return;

  // Outward normal in the half-plane, flipped to point out when inside.
  const sign = inside ? -1 : 1;
  let nr = sign * (d - bx);
  let ny = sign * (y - by);
  const len = Math.hypot(nr, ny) || 1;
  nr /= len;
  ny /= len;

  // Lift it back to 3D, adding the azimuthal direction.
  const inv = d > 1e-6 ? 1 / d : 0;
  const nx = nr * (d > 1e-6 ? dx * inv : 1);
  const nz = nr * (d > 1e-6 ? dz * inv : 0);

  const pen = inside ? r + best : r - best;
  p.x += nx * pen;
  p.y += ny * pen;
  p.z += nz * pen;

  const vn = v.x * nx + v.y * ny + v.z * nz;
  if (vn < 0) {
    const j = (1 + S.treeBounce) * vn;
    v.x -= j * nx;
    v.y -= j * ny;
    v.z -= j * nz;
  }
}

// Whether the segment the rider swept, `prev` -> `p`, meets the gate's oriented
// box. Testing the segment rather than the point means a fast rider cannot skip
// a gate between two steps.
function hitsGate(prev: math.Vec3, p: math.Vec3, gate: Gate): boolean {
  const inv = math.conjugateQuat(gate.orientation);
  const a = math.rotate(inv, {
    x: prev.x - gate.position.x,
    y: prev.y - gate.position.y,
    z: prev.z - gate.position.z,
  });
  const b = math.rotate(inv, {
    x: p.x - gate.position.x,
    y: p.y - gate.position.y,
    z: p.z - gate.position.z,
  });
  return math.intersectSegmentBox(a, b, {
    x: gate.width / 2,
    y: gate.height / 2,
    z: S.gateDepth / 2,
  });
}

export function step(state: State, dt: number): void {
  for (const pogo of state.pogos) stepPogo(pogo, state.level, dt);
}

function stepPogo(pogo: Pogo, level: Level, dt: number): void {
  const { trees, ramps, halfPipes, gates, laps } = level;
  if (pogo.lap < laps) pogo.time += dt;
  const input = pogo.input;
  const { position: p, velocity: v } = pogo;
  const prev = { x: p.x, y: p.y, z: p.z }; // before this step moves p
  const L = S.stickLength;
  const down = { x: 0, y: -1, z: 0 };

  const axisBefore = math.rotate(pogo.orientation, down);
  let q = math.mulQuat(math.rotationAboutY(input.yaw * dt), pogo.orientation);
  q = math.mulQuat(q, math.rotationAboutX(input.pitch * dt));
  q = math.mulQuat(q, math.rotationAboutZ(input.roll * dt));
  pogo.orientation = math.normalizeQuat(q);
  const axis = math.rotate(pogo.orientation, down);

  const strain = contactStrain(level, p, axis);

  let ax = 0;
  let ay = -S.gravity;
  let az = 0;

  if (strain > 0) {
    pogo.peakStrain = Math.max(pogo.peakStrain, strain);

    const slipX = v.x + (L * (axis.x - axisBefore.x)) / dt;
    const slipZ = v.z + (L * (axis.z - axisBefore.z)) / dt;

    const push = S.springStiffness * strain;

    // Spring push along the stick, from foot to rider.
    ax = -axis.x * push;
    ay += -axis.y * push;
    az = -axis.z * push;

    // Coulomb friction opposing the foot sliding along the ground.
    const friction = S.friction * push;
    ax -= friction * Math.tanh(slipX * S.frictionSlip);
    az -= friction * Math.tanh(slipZ * S.frictionSlip);
  } else {
    pogo.peakStrain = 0;
  }

  const speed = Math.hypot(v.x, v.y, v.z);
  ax -= S.drag * speed * v.x;
  ay -= S.drag * speed * v.y;
  az -= S.drag * speed * v.z;

  // Update velocity (semi-implicit Euler - updates velocity first)
  v.x += ax * dt;
  v.y += ay * dt;
  v.z += az * dt;

  // Update position
  p.x += v.x * dt;
  p.y += v.y * dt;
  p.z += v.z * dt;

  // Trees, ramps and half-pipes are solid: rebound off any the pogo overlaps,
  // at the rider and at the foot of the stick.
  for (const tree of trees) {
    bounceOffTree(p, v, tree, p.x, p.y, p.z, S.riderRadius);
  }
  for (const ramp of ramps) {
    bounceOffRamp(p, v, ramp, p.x, p.y, p.z, S.riderRadius);
  }
  for (const pipe of halfPipes) {
    bounceOffHalfPipe(p, v, pipe, -1, p.x, p.y, p.z, S.riderRadius);
    bounceOffHalfPipe(p, v, pipe, 1, p.x, p.y, p.z, S.riderRadius);
  }
  const footLen = S.stickLength - contactStrain(level, p, axis);
  for (const tree of trees) {
    bounceOffTree(
      p,
      v,
      tree,
      p.x + axis.x * footLen,
      p.y + axis.y * footLen,
      p.z + axis.z * footLen,
      S.footRadius,
    );
  }
  for (const ramp of ramps) {
    bounceOffRamp(
      p,
      v,
      ramp,
      p.x + axis.x * footLen,
      p.y + axis.y * footLen,
      p.z + axis.z * footLen,
      S.footRadius,
    );
  }
  for (const pipe of halfPipes) {
    const fx = p.x + axis.x * footLen;
    const fy = p.y + axis.y * footLen;
    const fz = p.z + axis.z * footLen;
    bounceOffHalfPipe(p, v, pipe, -1, fx, fy, fz, S.footRadius);
    bounceOffHalfPipe(p, v, pipe, 1, fx, fy, fz, S.footRadius);
  }

  // Recompute strain from the new pose so the rendered foot sits on the floor.
  pogo.strain = contactStrain(level, p, axis);

  // Fixed speed boost per-bounce: bounceBoost (always) +megaBoost (control)
  const released = strain - pogo.strain;
  if (released > 0 && pogo.peakStrain > 0) {
    const boost = S.bounceBoost + (input.mega ? S.megaBoost : 0);
    const dv = (boost * released) / pogo.peakStrain;
    v.x -= axis.x * dv;
    v.y -= axis.y * dv;
    v.z -= axis.z * dv;
  }

  // Advance once the rider has passed through the next gate; passing the last
  // one completes a lap.
  if (hitsGate(prev, p, gates[pogo.nextGate])) {
    if (pogo.nextGate === gates.length - 1)
      pogo.lap = Math.min(pogo.lap + 1, laps);
    pogo.nextGate = (pogo.nextGate + 1) % gates.length;
  }

  // Crash: the pogo toppled and the rider reached the ground. Reset in place,
  // keeping the heading and the race progress. The topple test matters on
  // slopes: a leaning rider's body can drop below the ground under it while the
  // stick is still standing on its foot, which is not a fall.
  if (
    axis.y > S.toppleAxisY &&
    p.y <= terrain.height(level.terrain, p.x, p.z)
  ) {
    const facing = math.rotate(pogo.orientation, { x: 0, y: 0, z: 1 });
    const upright = math.rotationAboutY(Math.atan2(facing.x, facing.z));
    const { nextGate, lap, time } = pogo;
    Object.assign(
      pogo,
      makePogo(p.x, p.z, terrain.height(level.terrain, p.x, p.z), upright),
    );
    Object.assign(pogo, { nextGate, lap, time });
  }
}
