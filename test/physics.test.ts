import { describe, expect, it } from "vitest";
import * as physics from "../src/physics";
import * as math from "../src/math";

const DT = 1 / 240;
const NO_INPUT: physics.Inputs = { yaw: 0, pitch: 0, roll: 0, mega: false };

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
    expect(maxStrain).toBeLessThanOrEqual(
      physics.S.maxStrainRatio * physics.S.stickLength,
    );
    // No tunnelling through the ground.
    expect(minY).toBeGreaterThan(physics.S.groundY);
    // The active spring balances drag, so it settles near the drop height.
    expect(maxAfterBounce).toBeGreaterThan(startY - 2);
  });

  it("keeps the foot on the ground while in contact", () => {
    const s = physics.spawn();
    let found = false;
    for (let i = 0; i < 300 && !found; i++) {
      physics.step(s, NO_INPUT, DT);
      if (s.pogo.strain > 0) {
        found = true;
        const axis = math.rotate(s.pogo.orientation, { x: 0, y: -1, z: 0 });
        const length = physics.S.stickLength - s.pogo.strain;
        expect(s.pogo.position.y + length * axis.y).toBeCloseTo(
          physics.S.groundY,
          6,
        );
      }
    }
    expect(found).toBe(true);
  });

  it("converts a lean into horizontal speed", () => {
    const s = physics.spawn();
    s.pogo.orientation = math.rotationAboutX(0.4);
    for (let i = 0; i < 480; i++) physics.step(s, NO_INPUT, DT);
    expect(Math.hypot(s.pogo.velocity.x, s.pogo.velocity.z)).toBeGreaterThan(1);
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
  });

  it("keeps the stick orientation a unit quaternion", () => {
    const s = physics.spawn();
    const input: physics.Inputs = { yaw: 1.3, pitch: 0.7, roll: -0.9, mega: false };
    for (let i = 0; i < 200; i++) {
      physics.step(s, input, DT);
      const q = s.pogo.orientation;
      expect(Math.hypot(q.x, q.y, q.z, q.w)).toBeCloseTo(1, 9);
    }
  });

  it("rotates the orientation from input", () => {
    const s = physics.spawn();
    physics.step(s, { yaw: 0, pitch: 0, roll: 0, mega: false }, DT);
    expect(s.pogo.orientation).toEqual({ x: 0, y: 0, z: 0, w: 1 });
    physics.step(s, { yaw: 1, pitch: 0, roll: 0, mega: false }, DT);
    expect(s.pogo.orientation.y).toBeGreaterThan(0);
  });

  it("mega-bounce adds height", () => {
    const maxHeight = (mega: boolean) => {
      const s = physics.spawn();
      let top = 0;
      for (let i = 0; i < 480; i++) {
        physics.step(s, { ...NO_INPUT, mega }, DT);
        top = Math.max(top, s.pogo.position.y);
      }
      return top;
    };
    expect(maxHeight(true)).toBeGreaterThan(maxHeight(false) + 5);
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

describe("tree scatter", () => {
  it("puts cones on the ground, clear of the spawn", () => {
    const s = physics.spawn();
    const t = physics.S.trees;
    expect(s.trees).toHaveLength(t.count);
    for (const tree of s.trees) {
      expect(tree.position.y).toBe(physics.S.groundY);
      expect(Math.hypot(tree.position.x, tree.position.z)).toBeGreaterThanOrEqual(
        t.clear,
      );
      expect(tree.radius).toBeGreaterThanOrEqual(t.minRadius);
      expect(tree.radius).toBeLessThanOrEqual(t.maxRadius);
      expect(tree.height).toBeGreaterThanOrEqual(t.minHeight);
      expect(tree.height).toBeLessThanOrEqual(t.maxHeight);
    }
  });

  it("is reproducible for a fixed seed", () => {
    expect(physics.spawn().trees).toEqual(physics.spawn().trees);
  });
});

describe("tree collision", () => {
  const fly = (trees: physics.Tree[], y = 40) => {
    const s = physics.spawn();
    s.trees = trees;
    s.pogo.position = { x: 0, y, z: -5 };
    s.pogo.velocity = { x: 0, y: 0, z: -60 };
    s.pogo.orientation = math.identityQuat();
    for (let i = 0; i < 30; i++) physics.step(s, NO_INPUT, DT);
    return s.pogo;
  };
  const tree: physics.Tree = {
    position: { x: 0, y: 0, z: -20 },
    radius: 10,
    height: 100,
  };

  it("rebounds off a tree, up its slope", () => {
    const hit = fly([tree]);
    const miss = fly([]);
    expect(hit.velocity.z).toBeGreaterThan(0); // bounced back
    expect(hit.velocity.y).toBeGreaterThan(miss.velocity.y + 5); // and up the slope
    expect(hit.position.z).toBeGreaterThan(-10 - physics.S.riderRadius);
  });

  it("passes over a tree it clears", () => {
    const high = fly([{ ...tree, height: 30 }], 200);
    const miss = fly([], 200);
    expect(high.velocity.z).toBeLessThan(0); // carried on past
    expect(high.velocity.z).toBeCloseTo(miss.velocity.z, 5);
  });
});
