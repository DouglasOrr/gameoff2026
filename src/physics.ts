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
};

export type Pogo = {
  position: math.Vec3;
  orientation: math.Quat; // rider -> foot is local -Y
  velocity: math.Vec3;
  strain: number; // axial compression of the stick (0 when airborne)
  peakStrain: number; // deepest compression of the current contact
};

export type State = {
  pogo: Pogo;
};

export type Inputs = {
  yaw: number; // rad/s about world Y
  pitch: number; // rad/s about local X
  roll: number; // rad/s about local Z
  mega: boolean; // hold to add the mega-bounce impulse during extension
};

export function spawn(x = 0, z = 0): State {
  return {
    pogo: {
      position: { x, y: S.stickLength + S.spawnDrop, z },
      orientation: math.identityQuat(),
      velocity: { x: 0, y: 0, z: 0 },
      strain: 0,
      peakStrain: 0,
    },
  };
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

export function step(s: State, input: Inputs, dt: number): void {
  const { position: p, velocity: v } = s.pogo;
  const L = S.stickLength;
  const down = { x: 0, y: -1, z: 0 };

  const axisBefore = math.rotate(s.pogo.orientation, down);
  let q = math.mulQuat(math.rotationAboutY(input.yaw * dt), s.pogo.orientation);
  q = math.mulQuat(q, math.rotationAboutX(input.pitch * dt));
  q = math.mulQuat(q, math.rotationAboutZ(input.roll * dt));
  s.pogo.orientation = math.normalizeQuat(q);
  const axis = math.rotate(s.pogo.orientation, down);

  const strain = contactStrain(p, axis);

  let ax = 0;
  let ay = -S.gravity;
  let az = 0;

  if (strain > 0) {
    s.pogo.peakStrain = Math.max(s.pogo.peakStrain, strain);

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
    s.pogo.peakStrain = 0;
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

  // Recompute strain from the new pose so the rendered foot sits on the floor.
  s.pogo.strain = contactStrain(p, axis);

  // Fixed speed boost per-bounce: bounceBoost (always) +megaBoost (control)
  const released = strain - s.pogo.strain;
  if (released > 0 && s.pogo.peakStrain > 0) {
    const boost = S.bounceBoost + (input.mega ? S.megaBoost : 0);
    const dv = (boost * released) / s.pogo.peakStrain;
    v.x -= axis.x * dv;
    v.y -= axis.y * dv;
    v.z -= axis.z * dv;
  }

  // Crash: the pogo fell over and the rider reached the ground. Reset in place.
  if (p.y <= S.groundY) {
    Object.assign(s.pogo, spawn(p.x, p.z).pogo);
  }
}
