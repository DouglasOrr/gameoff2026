import { describe, expect, it } from "vitest";
import * as physics from "../src/physics";
import * as math from "../src/math";

const DT = 1 / 240;
const NO_INPUT: physics.Inputs = { yaw: 0, pitch: 0, roll: 0 };

describe("physics bounce", () => {
  it("spawns above the ground with a vertical stick, at rest", () => {
    const s = physics.spawn();
    expect(s.pogo.position.y).toBe(physics.S.stickLength + physics.S.spawnDrop);
    expect(s.pogo.orientation).toEqual({ x: 0, y: 0, z: 0, w: 1 });
    expect(s.pogo.velocity).toEqual({ x: 0, y: 0, z: 0 });
    expect(s.pogo.strain).toBe(0);
  });

  it("falls under gravity before touching the ground", () => {
    const s = physics.spawn();
    for (let i = 0; i < 3; i++) physics.step(s, NO_INPUT, DT);
    expect(s.pogo.position.y).toBeLessThan(physics.S.stickLength + physics.S.spawnDrop);
    expect(s.pogo.velocity.y).toBeLessThan(0);
    expect(s.pogo.strain).toBe(0);
  });

  it("compresses the stick on contact and rebounds to near its drop height", () => {
    const s = physics.spawn();
    const startY = s.pogo.position.y;
    let touched = false;
    let maxStrain = 0;
    let minY = Infinity;
    let maxAfterBounce = 0;

    for (let i = 0; i < 480; i++) {
      physics.step(s, NO_INPUT, DT);
      if (s.pogo.strain > 0) {
        touched = true;
        maxStrain = Math.max(maxStrain, s.pogo.strain);
      } else if (touched) {
        maxAfterBounce = Math.max(maxAfterBounce, s.pogo.position.y);
      }
      minY = Math.min(minY, s.pogo.position.y);
    }

    expect(touched).toBe(true);
    expect(maxStrain).toBeGreaterThan(0);
    expect(maxStrain).toBeLessThanOrEqual(physics.S.maxStrain);
    // No tunnelling through the ground.
    expect(minY).toBeGreaterThan(physics.S.groundY);
    // Energy is preserved, so it climbs back to (almost) the drop height.
    expect(maxAfterBounce).toBeGreaterThan(startY - 0.2);
  });

  it("plants the foot on the floor, not below it", () => {
    const s = physics.spawn();
    for (let i = 0; i < 300 && s.pogo.anchor === null; i++) {
      physics.step(s, NO_INPUT, DT);
    }
    expect(s.pogo.anchor).not.toBe(null);
    expect(s.pogo.anchor!.y).toBe(physics.S.groundY);
  });

  it("resets the pogo when it falls through the ground", () => {
    const s = physics.spawn();
    s.pogo.position = { x: 5, y: physics.S.groundY - 1, z: 7 };
    s.pogo.orientation = math.rotationAboutX(Math.PI); // stick points up: can't catch
    physics.step(s, NO_INPUT, DT);
    expect(s.pogo.position).toEqual({
      x: 5,
      y: physics.S.stickLength + physics.S.spawnDrop,
      z: 7,
    });
    expect(s.pogo.velocity).toEqual({ x: 0, y: 0, z: 0 });
    expect(s.pogo.orientation).toEqual({ x: 0, y: 0, z: 0, w: 1 });
    expect(s.pogo.anchor).toBe(null);
  });

  it("keeps the stick orientation a unit quaternion", () => {
    const s = physics.spawn();
    const input: physics.Inputs = { yaw: 1.3, pitch: 0.7, roll: -0.9 };
    for (let i = 0; i < 200; i++) {
      physics.step(s, input, DT);
      const q = s.pogo.orientation;
      expect(Math.hypot(q.x, q.y, q.z, q.w)).toBeCloseTo(1, 9);
    }
  });

  it("rotates the orientation from input", () => {
    const s = physics.spawn();
    physics.step(s, { yaw: 0, pitch: 0, roll: 0 }, DT);
    expect(s.pogo.orientation).toEqual({ x: 0, y: 0, z: 0, w: 1 });
    physics.step(s, { yaw: 1, pitch: 0, roll: 0 }, DT);
    expect(s.pogo.orientation.y).toBeGreaterThan(0);
  });

  it("is deterministic for identical step sequences", () => {
    const a = physics.spawn();
    const b = physics.spawn();
    for (let i = 0; i < 500; i++) {
      physics.step(a, NO_INPUT, DT);
      physics.step(b, NO_INPUT, DT);
    }
    expect(a).toEqual(b);
  });
});
