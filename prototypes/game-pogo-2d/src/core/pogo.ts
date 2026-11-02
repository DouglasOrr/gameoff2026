// 2D pogo stick physics.
//
// Model: a point-mass rider at the top of a massless stick of fixed length.
// The stick can rotate about the rider (the only input). The foot (bottom of
// the stick) is a spring acting against the ground along the line of action of
// the stick, with a bit of Coulomb friction. Lean the stick and the ground push
// moves the rider sideways: position control is indirect. Lean past the slip
// angle while in contact and the foot loses grip.
//
// Current iteration: no damping (bounces keep their energy) and no power-bounce
// mechanic — the pogo just bounces. The rider spawns slightly above the ground
// so it starts bouncing immediately.

export type Inputs = {
  rotL: boolean; // lean left
  rotR: boolean; // lean right
};

export type PogoState = {
  x: number; // rider position
  y: number;
  vx: number;
  vy: number;
  theta: number; // stick lean from vertical, >0 = rider leans right
  omega: number; // dtheta/dt
  grounded: boolean; // foot is in contact with the ground
  compress: number; // current spring compression (px), for rendering
};

export const Pogo = {
  L: 110, // stick length (px)
  G: 2400, // gravity (px/s^2)
  K: 6000, // spring stiffness (1/s^2): soft enough for a visible squash
  C: 0, // spring damping (1/s): none, so bounces do not decay
  FRICTION: 0.08, // Coulomb friction coefficient on the foot
  THETA_MAX: 1.15, // max lean in air (rad, ~66deg: foot stays below rider)
  THETA_SLIP: 0.8, // lean at which the foot slips when grounded (rad, ~46deg)
  OMEGA_MAX: 2.6, // rotation speed (rad/s)
  MAX_COMPRESS: 30, // spring compression cap (px): bounds hard impacts
  SPEED_MAX: 1300, // clamp on total speed (px/s)
  DRAG: 0.00002, // quadratic air drag coefficient
  SPAWN_DROP: 140, // spawn height above the ground (px), to start bouncing
};

export function spawn(x = 0): PogoState {
  return {
    x,
    y: Pogo.L + Pogo.SPAWN_DROP,
    vx: 0,
    vy: 0,
    theta: 0,
    omega: 0,
    grounded: false,
    compress: 0,
  };
}

// Foot position (bottom of the stick), at rest stick length.
export function foot(s: PogoState): { x: number; y: number } {
  return {
    x: s.x - Pogo.L * Math.sin(s.theta),
    y: s.y - Pogo.L * Math.cos(s.theta),
  };
}

export function step(
  s: PogoState,
  input: Inputs,
  dt: number,
  heightAt: (x: number) => number = () => 0
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
  heightAt: (x: number) => number
): void {
  // Contact at the current attitude.
  const f0 = foot(s);
  const g0 = heightAt(f0.x);
  s.grounded = g0 !== -Infinity && f0.y <= g0;

  // Rotation. In the air the stick can spin freely (up to THETA_MAX); while
  // the foot is grounded or hovering just above the surface (leaning lifts the
  // foot by up to ~L*(1-cos slip) = 35px, so use a grace band) the lean is
  // hard-clamped to the slip band: holding a key cannot over-rotate into a
  // skitter. Landing beyond the band (from a hot air flip) puts the foot into
  // slip mode until the player rotates back inside.
  const nearGround = g0 !== -Infinity && f0.y <= g0 + 45;
  let omega = Pogo.OMEGA_MAX * ((input.rotR ? 1 : 0) - (input.rotL ? 1 : 0));
  const grip = nearGround && Math.abs(s.theta) <= Pogo.THETA_SLIP;
  if (grip) {
    const lo = -Pogo.THETA_SLIP;
    const hi = Pogo.THETA_SLIP;
    if (s.theta + omega * h > hi) omega = (hi - s.theta) / h;
    else if (s.theta + omega * h < lo) omega = (lo - s.theta) / h;
  }
  s.omega = omega;
  s.theta += s.omega * h;
  if (grip) {
    s.theta = Math.max(-Pogo.THETA_SLIP, Math.min(Pogo.THETA_SLIP, s.theta));
  } else {
    s.theta = Math.max(-Pogo.THETA_MAX, Math.min(Pogo.THETA_MAX, s.theta));
  }

  // Contact forces at the new attitude.
  const f = foot(s);
  const ground = heightAt(f.x);
  const grounded = ground !== -Infinity && f.y <= ground;

  let ax = 0;
  let ay = -Pogo.G;

  if (grounded) {
    const compress = Math.min(ground - f.y, Pogo.MAX_COMPRESS); // >= 0
    let Fs = Pogo.K * compress;
    if (Fs < 0) Fs = 0;

    // Landed past the slip angle: the foot slides out and the bounce
    // collapses, but rotating back inside the band regrips.
    const slip = Math.abs(s.theta) > Pogo.THETA_SLIP;
    if (slip) Fs *= 0.4;

    // Spring push along the stick, from foot to rider.
    ax += Math.sin(s.theta) * Fs;
    ay += Math.cos(s.theta) * Fs;

    // Friction opposes foot sliding while the foot has grip.
    if (!slip) {
      const fvx = s.vx - Pogo.L * Math.cos(s.theta) * s.omega;
      ax -= Pogo.FRICTION * Fs * Math.tanh(fvx * 0.02);
    }
    s.compress = compress;
  } else {
    s.compress = 0;
  }

  // Mild quadratic air drag to stop runaway speed.
  ax -= Pogo.DRAG * s.vx * Math.abs(s.vx);

  // Integrate (semi-implicit Euler).
  s.vx += ax * h;
  s.vy += ay * h;
  const sp = Math.hypot(s.vx, s.vy);
  if (sp > Pogo.SPEED_MAX) {
    const k = Pogo.SPEED_MAX / sp;
    s.vx *= k;
    s.vy *= k;
  }
  s.x += s.vx * h;
  s.y += s.vy * h;
}
