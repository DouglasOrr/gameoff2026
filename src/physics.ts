// Core game objects and physics.

import * as math from "./math";

export const S = {
  groundY: 0,
  stickLength: 20,
  gravity: 240,
  springStiffness: 600,
  maxStrainRatio: 1 / 6, // axial compression cap as a fraction of the stick length
  spawnDrop: 30, // spawn height of the rider above its resting contact height
  friction: 0.15, // Coulomb friction coefficient at the foot
  frictionSlip: 0.05, // tanh scale that smooths Coulomb stiction near zero slip
  drag: 0.002, // quadratic air resistance
  bounceBoost: 10, // fixed extra speed per bounce (active spring), spread over extension
  megaBoost: 50, // extra speed while holding the mega boost, spread over extension
  treeBounce: 0.5, // restitution when rebounding off a tree
  riderRadius: 2.5, // pogo collision radius at the rider
  footRadius: 1, // pogo collision radius at the stick's foot
};

export type Pogo = {
  position: math.Vec3;
  orientation: math.Quat; // rider -> foot is local -Y
  velocity: math.Vec3;
  strain: number; // axial compression of the stick (0 when airborne)
  peakStrain: number;
  input: Inputs;
  nextGate: number;
};

export type State = {
  pogos: Pogo[];
  trees: Tree[];
  gates: Gate[];
};

export type Tree = {
  position: math.Vec3; // base of the cone, on the ground
  radius: number; // base radius of the cone
  height: number;
};

// A checkpoint: an oriented box the rider passes through along local Z.
export type Gate = {
  position: math.Vec3;
  orientation: math.Quat; // identity faces +z
  width: number;
  height: number;
  depth: number;
};

export type Level = {
  gates: Gate[];
  trees: Tree[];
};

export type Inputs = {
  yaw: number; // rad/s about world Y
  pitch: number; // rad/s about local X
  roll: number; // rad/s about local Z
  mega: boolean; // hold to add the mega-bounce impulse during extension
};

export const IDLE: Inputs = { yaw: 0, pitch: 0, roll: 0, mega: false };

export function makePogo(
  x = 0,
  z = 0,
  orientation: math.Quat = math.identityQuat(),
): Pogo {
  return {
    position: { x, y: S.stickLength + S.spawnDrop, z },
    orientation,
    velocity: { x: 0, y: 0, z: 0 },
    strain: 0,
    peakStrain: 0,
    input: { ...IDLE },
    nextGate: 0,
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
    pogos.push(
      makePogo(
        start.position.x - through.x * back + across.x * lane,
        start.position.z - through.z * back + across.z * lane,
        start.orientation,
      ),
    );
  }
  return { pogos, trees: level.trees, gates: level.gates };
}

// Axial compression that puts the stick tip on the ground (0 when airborne).
function contactStrain(p: math.Vec3, axis: math.Vec3): number {
  const tipY = p.y + S.stickLength * axis.y;
  if (tipY > S.groundY || axis.y >= -1e-6) return 0;
  return Math.min(
    (S.groundY - tipY) / -axis.y,
    S.maxStrainRatio * S.stickLength,
  );
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
    z: gate.depth / 2,
  });
}

export function step(state: State, dt: number): void {
  for (const pogo of state.pogos) stepPogo(pogo, state.trees, state.gates, dt);
}

function stepPogo(
  pogo: Pogo,
  trees: readonly Tree[],
  gates: readonly Gate[],
  dt: number,
): void {
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

  const strain = contactStrain(p, axis);

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

  // Trees are solid: rebound off any the pogo overlaps, at the rider and at the
  // foot of the stick.
  for (const tree of trees) {
    bounceOffTree(p, v, tree, p.x, p.y, p.z, S.riderRadius);
  }
  const footLen = S.stickLength - contactStrain(p, axis);
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

  // Recompute strain from the new pose so the rendered foot sits on the floor.
  pogo.strain = contactStrain(p, axis);

  // Fixed speed boost per-bounce: bounceBoost (always) +megaBoost (control)
  const released = strain - pogo.strain;
  if (released > 0 && pogo.peakStrain > 0) {
    const boost = S.bounceBoost + (input.mega ? S.megaBoost : 0);
    const dv = (boost * released) / pogo.peakStrain;
    v.x -= axis.x * dv;
    v.y -= axis.y * dv;
    v.z -= axis.z * dv;
  }

  // Advance once the rider has passed through the next gate.
  if (hitsGate(prev, p, gates[pogo.nextGate])) {
    pogo.nextGate = (pogo.nextGate + 1) % gates.length;
  }

  // Crash: the pogo fell over and the rider reached the ground. Reset in place,
  // keeping the heading and the gate progress.
  if (p.y <= S.groundY) {
    const facing = math.rotate(pogo.orientation, { x: 0, y: 0, z: 1 });
    const upright = math.rotationAboutY(Math.atan2(facing.x, facing.z));
    const nextGate = pogo.nextGate;
    Object.assign(pogo, makePogo(p.x, p.z, upright));
    pogo.nextGate = nextGate;
  }
}
