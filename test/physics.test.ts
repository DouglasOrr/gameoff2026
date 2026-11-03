import { describe, expect, it } from "vitest";
import * as physics from "../src/physics";

describe("physics wiggle", () => {
  it("spawns at rest height with a vertical stick", () => {
    const s = physics.spawn();
    expect(s.t).toBe(0);
    expect(s.pogo.position.y).toBe(physics.S.restHeight);
    expect(s.pogo.orientation).toEqual({ x: 0, y: 0, z: 0, w: 1 });
  });

  it("stays within the amplitude band as it advances", () => {
    const s = physics.spawn();
    for (let i = 0; i < 1000; i++) {
      physics.step(s, 1 / 120);
      const y = s.pogo.position.y;
      expect(y).toBeGreaterThanOrEqual(physics.S.restHeight - physics.S.amplitude - 1e-9);
      expect(y).toBeLessThanOrEqual(physics.S.restHeight + physics.S.amplitude + 1e-9);
    }
    expect(s.t).toBeGreaterThan(0);
  });

  it("keeps the stick orientation a unit quaternion", () => {
    const s = physics.spawn();
    for (let i = 0; i < 200; i++) {
      physics.step(s, 1 / 120);
      const q = s.pogo.orientation;
      expect(Math.hypot(q.x, q.y, q.z, q.w)).toBeCloseTo(1, 10);
    }
  });

  it("is deterministic for identical step sequences", () => {
    const a = physics.spawn();
    const b = physics.spawn();
    for (let i = 0; i < 500; i++) {
      physics.step(a, 1 / 120);
      physics.step(b, 1 / 120);
    }
    expect(a).toEqual(b);
  });

});
