import { describe, expect, it } from "vitest";
import * as terrain from "../src/terrain";

const flat = (base = 0): terrain.Terrain => ({ base, features: [] });

const bump = (
  op: "add" | "cut",
  blend: number,
): terrain.Terrain => ({
  base: 0,
  features: [
    {
      op,
      shape: { center: { x: 0, z: 0 }, radius: 100, apex: 50 },
      blend,
    },
  ],
});

describe("terrain heightfield", () => {
  it("is flat with no features", () => {
    expect(terrain.height(flat(), 12, -34)).toBe(0);
  });

  it("raises a bump to its apex at the centre", () => {
    const t = bump("add", 0);
    expect(terrain.height(t, 0, 0)).toBeCloseTo(50, 6);
    expect(terrain.height(t, 100, 0)).toBe(0); // at the foot
    expect(terrain.height(t, 150, 0)).toBe(0); // beyond the foot
  });

  it("lowers a bowl to its depth at the centre", () => {
    const t = bump("cut", 0);
    expect(terrain.height(t, 0, 0)).toBeCloseTo(-50, 6);
    expect(terrain.height(t, 100, 0)).toBe(0);
    expect(terrain.height(t, 150, 0)).toBe(0);
  });

  it("keeps the surface continuous across a blended join", () => {
    const t = bump("add", 30);
    let prev = terrain.height(t, 300, 0);
    for (let x = 300; x >= -300; x -= 2) {
      const h = terrain.height(t, x, 0);
      expect(Math.abs(h - prev)).toBeLessThan(3);
      prev = h;
    }
  });

  it("points the normal up on flat ground, tilted into a slope", () => {
    expect(terrain.normal(flat(), 0, 0).y).toBeCloseTo(1, 9);
    const n = terrain.normal(bump("add", 0), 60, 0); // on the +x flank
    expect(n.x).toBeGreaterThan(0); // the normal leans downhill, away from the centre
    expect(n.y).toBeGreaterThan(0);
  });
});
