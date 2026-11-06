// A pilot that flies one pogo towards random targets with the same controls a
// player uses: it leans the stick (pitch) via a PID and turns to face the
// target (yaw). Update it once per tick; it writes its pogo's input.

import * as math from "./math";
import * as physics from "./physics";

export const S = {
  seed: 1,
  targetFactor: 2.5, // target circle radius, in stick lengths
  maxSpeed: 50, // capped speed the pilot aims for
  speedGain: 1, // desired speed per unit of distance remaining
  maxTilt: 0.5, // steepest lean the controller asks for (rad)
  pitchGain: 8, // pitch rate per radian of lean error
  maxPitch: 3, // rad/s
  steerGain: 3, // yaw rate per radian of heading error
  maxYaw: 4, // rad/s
  drive: { kp: 0.01, ki: 0.004, kd: 0.002, limit: 12 }, // PID: speed error -> lean
};

const DOWN = { x: 0, y: -1, z: 0 };
const FORWARD = { x: 0, y: 0, z: 1 };

function clamp(v: number, lo: number, hi: number): number {
  return Math.min(Math.max(v, lo), hi);
}

function wrap(angle: number): number {
  return Math.atan2(Math.sin(angle), Math.cos(angle));
}

class Pid {
  private integral = 0;
  private prev: number | null = null;

  constructor(
    private readonly kp: number,
    private readonly ki: number,
    private readonly kd: number,
    private readonly limit: number,
  ) {}

  step(error: number, dt: number): number {
    this.integral = clamp(this.integral + error * dt, -this.limit, this.limit);
    const derivative = this.prev === null ? 0 : (error - this.prev) / dt;
    this.prev = error;
    return this.kp * error + this.ki * this.integral + this.kd * derivative;
  }
}

export class Pilot {
  target: { x: number; z: number };

  private readonly pogo: physics.Pogo;
  private readonly rand: () => number;
  private readonly drive: Pid;
  private rising = false;

  constructor(pogo: physics.Pogo, seed = S.seed) {
    this.pogo = pogo;
    this.rand = math.rng(seed);
    this.drive = new Pid(S.drive.kp, S.drive.ki, S.drive.kd, S.drive.limit);
    this.target = { x: pogo.position.x, z: pogo.position.z };
  }

  update(dt: number): void {
    const pogo = this.pogo;

    // Re-aim at the apex of each bounce.
    const rising = pogo.velocity.y > 0;
    if (rising && !this.rising) this.pickTarget();
    this.rising = rising;

    const dx = this.target.x - pogo.position.x;
    const dz = this.target.z - pogo.position.z;
    const dist = Math.hypot(dx, dz);
    const ux = dist > 1e-6 ? dx / dist : 0;
    const uz = dist > 1e-6 ? dz / dist : 1;

    // Face the target: the stick's lean then accelerates along it.
    const facing = math.rotate(pogo.orientation, FORWARD);
    const heading = Math.atan2(facing.x, facing.z);
    const yaw = clamp(
      S.steerGain * wrap(Math.atan2(ux, uz) - heading),
      -S.maxYaw,
      S.maxYaw,
    );

    // PID on the speed error chooses the lean; pitch drives the stick to it.
    const axis = math.rotate(pogo.orientation, DOWN);
    const flat = Math.hypot(facing.x, facing.z) || 1;
    const along = (axis.x * facing.x + axis.z * facing.z) / flat;
    const tilt = -Math.asin(clamp(along, -1, 1));
    const wantSpeed = Math.min(S.maxSpeed, S.speedGain * dist);
    const speed = pogo.velocity.x * ux + pogo.velocity.z * uz;
    const wantTilt = clamp(
      this.drive.step(wantSpeed - speed, dt),
      -S.maxTilt,
      S.maxTilt,
    );
    const pitch = clamp(
      S.pitchGain * (wantTilt - tilt),
      -S.maxPitch,
      S.maxPitch,
    );

    pogo.input = { yaw, pitch, roll: 0, mega: false };
  }

  private pickTarget(): void {
    const angle = this.rand() * Math.PI * 2;
    const r = S.targetFactor * physics.S.stickLength;
    this.target = {
      x: this.pogo.position.x + Math.cos(angle) * r,
      z: this.pogo.position.z + Math.sin(angle) * r,
    };
  }
}
