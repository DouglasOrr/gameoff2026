// 3D pogo stick physics.
//
// Same model as the 2D prototype: a point-mass rider on a massless stick; the
// foot is a spring against the ground surface (a height field), rebounding
// along the line of action of the stick with a little friction; lean past the
// slip angle and the foot loses grip.
//
// In 3D the lean is a 2D vector in the rider's heading frame: WASD tilts the
// stick (W = forward, A/D = left/right), QE rotates the heading, and the world
// lean direction = local lean rotated by the heading. Releasing WASD eases the
// stick back to vertical. The chase camera follows the heading.

export type Inputs = {
  leanF: boolean; // W: lean forward
  leanB: boolean; // S
  leanL: boolean; // A
  leanR: boolean; // D
  turnL: boolean; // Q: turn heading left
  turnR: boolean; // E: turn heading right
};

export type PogoState = {
  x: number; // rider position
  y: number;
  z: number;
  vx: number;
  vy: number;
  vz: number;
  leanF: number; // lean along the heading direction; |lean| = sin(tilt angle)
  leanR: number; // lean along the right direction
  heading: number; // yaw; forward = (sin heading, 0, cos heading)
  grounded: boolean;
  compress: number; // current spring compression (px), for rendering
};

export const Pogo = {
  L: 110, // stick length (px)
  G: 2400, // gravity (px/s^2)
  K: 6000, // spring stiffness (1/s^2)
  C: 0, // spring damping (1/s): none, so bounces do not decay
  FRICTION: 0.08, // Coulomb friction coefficient on the foot
  THETA_MAX: 1.15, // max lean in air (rad, ~66deg: foot stays below rider)
  THETA_SLIP: 0.8, // lean at which the foot slips when grounded (rad, ~46deg)
  OMEGA_MAX: 2.6, // lean ease rate (rad/s)
  HEADING_SPEED: 2.0, // q/e turn rate (rad/s)
  MAX_COMPRESS: 30, // spring compression cap (px)
  SPEED_MAX: 1300, // clamp on total speed (px/s)
  DRAG: 0.00002, // quadratic air drag coefficient
  SPAWN_DROP: 140, // spawn height above the ground (px)
};

export function forward(h: number): { x: number; z: number } {
  return { x: Math.sin(h), z: Math.cos(h) };
}

export function right(h: number): { x: number; z: number } {
  return { x: -Math.cos(h), z: Math.sin(h) };
}

// Horizontal component of the spring push (foot -> rider) in world space.
export function worldLean(s: PogoState): { x: number; z: number } {
  const f = forward(s.heading);
  const r = right(s.heading);
  return {
    x: s.leanF * f.x + s.leanR * r.x,
    z: s.leanF * f.z + s.leanR * r.z,
  };
}

// Unit vector along the stick, rider -> foot.
export function stickDir(s: PogoState): { x: number; y: number; z: number } {
  const wl = worldLean(s);
  const cosA = Math.sqrt(Math.max(0, 1 - wl.x * wl.x - wl.z * wl.z));
  return { x: -wl.x, y: -cosA, z: -wl.z };
}

// Foot position (bottom of the stick), at rest stick length.
export function foot(s: PogoState): { x: number; y: number; z: number } {
  const d = stickDir(s);
  return { x: s.x + Pogo.L * d.x, y: s.y + Pogo.L * d.y, z: s.z + Pogo.L * d.z };
}

export function spawn(x = 0, z = 0): PogoState {
  return {
    x,
    y: Pogo.L + Pogo.SPAWN_DROP,
    z,
    vx: 0,
    vy: 0,
    vz: 0,
    leanF: 0,
    leanR: 0,
    heading: 0,
    grounded: false,
    compress: 0,
  };
}

export function step(
  s: PogoState,
  input: Inputs,
  dt: number,
  heightAt: (x: number, z: number) => number
): void {
  // Fixed substepping keeps the stiff spring stable at any frame rate.
  const maxH = 1 / 240;
  const n = Math.max(1, Math.ceil(dt / maxH));
  const h = dt / n;
  for (let i = 0; i < n; i++) {
    substep(s, input, h, heightAt);
  }
}

function substep(
  s: PogoState,
  input: Inputs,
  h: number,
  heightAt: (x: number, z: number) => number
): void {
  // Attitude at the start of the substep (foot velocity for friction later).
  const f0 = foot(s);
  const g0 = heightAt(f0.x, f0.z);
  s.grounded = g0 !== -Infinity && f0.y <= g0;
  const nearGround = g0 !== -Infinity && f0.y <= g0 + 45;

  const mag = Math.hypot(s.leanF, s.leanR);
  const alpha = Math.asin(Math.min(1, mag));
  const grip = nearGround && alpha <= Pogo.THETA_SLIP;
  const band = grip ? Pogo.THETA_SLIP : Pogo.THETA_MAX;

  // Heading (QE) and lean ease (WASD): the stick returns to vertical when the
  // key is released. Increasing heading turns toward the rider's left.
  s.heading += Pogo.HEADING_SPEED * ((input.turnL ? 1 : 0) - (input.turnR ? 1 : 0)) * h;

  const inpF = (input.leanF ? 1 : 0) - (input.leanB ? 1 : 0);
  const inpR = (input.leanR ? 1 : 0) - (input.leanL ? 1 : 0);
  const inpMag = Math.hypot(inpF, inpR);

  let dirF = 0;
  let dirR = 0;
  if (inpMag > 0) {
    dirF = inpF / inpMag;
    dirR = inpR / inpMag;
  } else if (mag > 1e-9) {
    dirF = s.leanF / mag;
    dirR = s.leanR / mag;
  }

  const targetAlpha = inpMag > 0 ? band : 0;
  const rate = Pogo.OMEGA_MAX * h;
  const newAlpha = Math.max(0, alpha + Math.max(-rate, Math.min(rate, targetAlpha - alpha)));
  if (newAlpha < 1e-4) {
    s.leanF = 0;
    s.leanR = 0;
  } else {
    s.leanF = dirF * Math.sin(newAlpha);
    s.leanR = dirR * Math.sin(newAlpha);
  }

  // Contact + forces at the new attitude.
  const f = foot(s);
  const ground = heightAt(f.x, f.z);
  const grounded = ground !== -Infinity && f.y <= ground;

  let ax = 0;
  let ay = -Pogo.G;
  let az = 0;

  if (grounded) {
    const compress = Math.min(ground - f.y, Pogo.MAX_COMPRESS);
    let Fs = Pogo.K * compress;
    if (Fs < 0) Fs = 0;

    // Landed past the slip angle: the foot slides out, but rotating back in
    // regrips.
    const slip = Math.hypot(s.leanF, s.leanR) > Math.sin(Pogo.THETA_SLIP);
    if (slip) Fs *= 0.4;

    // Spring push along the stick, from foot to rider.
    const wl = worldLean(s);
    const cosA = Math.sqrt(Math.max(0, 1 - wl.x * wl.x - wl.z * wl.z));
    ax += wl.x * Fs;
    ay += cosA * Fs;
    az += wl.z * Fs;

    // Friction opposes foot sliding while the foot has grip (foot velocity
    // measured numerically across the substep).
    if (!slip) {
      const fvx = (f.x - f0.x) / h;
      const fvz = (f.z - f0.z) / h;
      const fspeed = Math.hypot(fvx, fvz);
      if (fspeed > 1e-6) {
        const fric = Pogo.FRICTION * Fs * Math.tanh(fspeed * 0.02);
        ax -= (fric * fvx) / fspeed;
        az -= (fric * fvz) / fspeed;
      }
    }
    s.compress = compress;
  } else {
    s.compress = 0;
  }

  // Mild quadratic air drag to stop runaway speed.
  ax -= Pogo.DRAG * s.vx * Math.abs(s.vx);
  az -= Pogo.DRAG * s.vz * Math.abs(s.vz);

  // Integrate (semi-implicit Euler).
  s.vx += ax * h;
  s.vy += ay * h;
  s.vz += az * h;
  const sp = Math.hypot(s.vx, s.vy, s.vz);
  if (sp > Pogo.SPEED_MAX) {
    const k = Pogo.SPEED_MAX / sp;
    s.vx *= k;
    s.vy *= k;
    s.vz *= k;
  }
  s.x += s.vx * h;
  s.y += s.vy * h;
  s.z += s.vz * h;
}
