// Core game objects and physics.

import * as math from "./math";

export type Pogo = {
  position: math.Vec3;
  orientation: math.Quat; // rider -> foot is local -Y
};

export type State = {
  t: number;
  pogo: Pogo;
};

export const S = {
  stickLength: 110,
  restHeight: 200,
  amplitude: 90,
  freqHz: 1.5,
  swayRad: 0.2,
  swayHz: 0.7,
};

export function spawn(x = 0, z = 0): State {
  return {
    t: 0,
    pogo: { position: { x, y: S.restHeight, z }, orientation: math.identityQuat() },
  };
}

export function step(s: State, dt: number): void {
  s.t += dt;
  s.pogo.position.y = S.restHeight + S.amplitude * Math.sin(2 * Math.PI * S.freqHz * s.t);
  s.pogo.orientation = math.rotationAboutZ(S.swayRad * Math.sin(2 * Math.PI * S.swayHz * s.t));
}
