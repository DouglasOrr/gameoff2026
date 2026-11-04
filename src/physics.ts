// Core game objects and physics.

import * as math from "./math";

export const S = {
  groundY: 0,
  stickLength: 30,
  gravity: 240,
  springStiffness: 600,
  maxStrain: 5, // cap on axial compression: bounds hard impacts
  maxSpeed: 200,
  spawnDrop: 30, // spawn height of the rider above its resting contact height
};

export type Pogo = {
  position: math.Vec3;
  orientation: math.Quat; // rider -> foot is local -Y
  velocity: math.Vec3;
  strain: number; // axial compression of the stick (0 when airborne)
  anchor: math.Vec3 | null; // planted foot while grounded
};

export type State = {
  pogo: Pogo;
};

export type Inputs = {
  yaw: number; // rad/s about world Y
  pitch: number; // rad/s about local X
  roll: number; // rad/s about local Z
};

export function spawn(x = 0, z = 0): State {
  return {
    pogo: {
      position: { x, y: S.stickLength + S.spawnDrop, z },
      orientation: math.identityQuat(),
      velocity: { x: 0, y: 0, z: 0 },
      strain: 0,
      anchor: null,
    },
  };
}

export function step(s: State, input: Inputs, dt: number): void {
  const { position: p, velocity: v } = s.pogo;
  const L = S.stickLength;
  const down = { x: 0, y: -1, z: 0 };

  // While airborne the player rotates the stick freely.
  if (s.pogo.anchor === null) {
    let q = math.mulQuat(
      math.rotationAboutY(input.yaw * dt),
      s.pogo.orientation,
    );
    q = math.mulQuat(q, math.rotationAboutX(input.pitch * dt));
    q = math.mulQuat(q, math.rotationAboutZ(input.roll * dt));
    s.pogo.orientation = math.normalizeQuat(q);

    // Plant the foot where the stick tip meets the ground.
    const axis = math.rotate(s.pogo.orientation, down);
    const footY = p.y + L * axis.y;
    if (footY <= S.groundY) {
      s.pogo.anchor = {
        x: p.x + L * axis.x,
        y: S.groundY,
        z: p.z + L * axis.z,
      };
    }
  }

  let ax = 0;
  let ay = -S.gravity;
  let az = 0;
  let strain = 0;

  // While grounded the stick is a spring to the planted foot: a conservative
  // force along P - anchor. It can only push, so the foot lifts off once the
  // rider reaches rest length.
  const anchor = s.pogo.anchor;
  if (anchor !== null) {
    const dx = p.x - anchor.x;
    const dy = p.y - anchor.y;
    const dz = p.z - anchor.z;
    const dist = Math.hypot(dx, dy, dz);

    if (dist > L) {
      s.pogo.anchor = null;
    } else if (dist > 1e-4) {
      strain = Math.min(L - dist, S.maxStrain);
      const fs = (S.springStiffness * strain) / dist;
      ax = dx * fs;
      ay += dy * fs;
      az = dz * fs;

      // The stick is the rod from rider to foot: aim local -Y at the anchor.
      const axis = math.rotate(s.pogo.orientation, down);
      const target = { x: -dx / dist, y: -dy / dist, z: -dz / dist };
      s.pogo.orientation = math.normalizeQuat(
        math.mulQuat(math.fromTo(axis, target), s.pogo.orientation),
      );
    }
  }

  s.pogo.strain = strain;

  // Update velocity (semi-implicit Euler - updates velocity first)
  v.x += ax * dt;
  v.y += ay * dt;
  v.z += az * dt;
  const speed = Math.hypot(v.x, v.y, v.z);
  if (speed > S.maxSpeed) {
    const k = S.maxSpeed / speed;
    v.x *= k;
    v.y *= k;
    v.z *= k;
  }

  // Update position
  p.x += v.x * dt;
  p.y += v.y * dt;
  p.z += v.z * dt;

  // Crash: the pogo fell over and the rider reached the ground. Reset in place.
  if (p.y <= S.groundY) {
    Object.assign(s.pogo, spawn(p.x, p.z).pogo);
  }
}
