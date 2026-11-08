import { describe, expect, it } from "vitest";
import * as physics from "../src/physics";
import * as math from "../src/math";
import { Pilot } from "../src/ai";

const DT = 1 / 240;
const NO_INPUT = physics.IDLE;

// The state holds several pogos; these tests drive the first.
const pogo = (s: physics.State) => s.pogos[0];
const step = (s: physics.State, input: physics.Inputs = NO_INPUT) => {
  for (const p of s.pogos) p.input = input;
  physics.step(s, DT);
};

describe("physics bounce", () => {
  it("spawns above the ground, upright and at rest", () => {
    const p = pogo(physics.makeState());
    expect(p.position.y).toBe(physics.S.stickLength + physics.S.spawnDrop);
    const axis = math.rotate(p.orientation, { x: 0, y: -1, z: 0 });
    expect(axis.x).toBeCloseTo(0, 12);
    expect(axis.y).toBeCloseTo(-1, 12);
    expect(axis.z).toBeCloseTo(0, 12);
    expect(p.velocity).toEqual({ x: 0, y: 0, z: 0 });
    expect(p.strain).toBe(0);
  });

  it("falls under gravity before touching the ground", () => {
    const s = physics.makeState();
    for (let i = 0; i < 3; i++) step(s);
    expect(pogo(s).position.y).toBeLessThan(
      physics.S.stickLength + physics.S.spawnDrop,
    );
    expect(pogo(s).velocity.y).toBeLessThan(0);
    expect(pogo(s).strain).toBe(0);
  });

  it("compresses the stick on contact and rebounds to near its drop height", () => {
    const s = physics.makeState();
    const startY = pogo(s).position.y;
    let touched = false;
    let maxStrain = 0;
    let minY = Infinity;
    let maxAfterBounce = 0;

    for (let i = 0; i < 480; i++) {
      step(s);
      if (pogo(s).strain > 0) {
        touched = true;
        maxStrain = Math.max(maxStrain, pogo(s).strain);
      } else if (touched) {
        maxAfterBounce = Math.max(maxAfterBounce, pogo(s).position.y);
      }
      minY = Math.min(minY, pogo(s).position.y);
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
    const s = physics.makeState();
    let found = false;
    for (let i = 0; i < 300 && !found; i++) {
      step(s);
      if (pogo(s).strain > 0) {
        found = true;
        const axis = math.rotate(pogo(s).orientation, { x: 0, y: -1, z: 0 });
        const length = physics.S.stickLength - pogo(s).strain;
        expect(pogo(s).position.y + length * axis.y).toBeCloseTo(
          physics.S.groundY,
          6,
        );
      }
    }
    expect(found).toBe(true);
  });

  it("converts a lean into horizontal speed", () => {
    const s = physics.makeState();
    pogo(s).orientation = math.rotationAboutX(0.4);
    for (let i = 0; i < 480; i++) step(s);
    expect(Math.hypot(pogo(s).velocity.x, pogo(s).velocity.z)).toBeGreaterThan(1);
  });

  it("resets the pogo upright when it falls through the ground", () => {
    const s = physics.makeState();
    pogo(s).position = { x: 5, y: physics.S.groundY - 1, z: 7 };
    pogo(s).orientation = math.rotationAboutX(Math.PI); // stick points up, facing -z
    pogo(s).nextGate = 3;
    step(s);
    expect(pogo(s).position).toEqual({
      x: 5,
      y: physics.S.stickLength + physics.S.spawnDrop,
      z: 7,
    });
    expect(pogo(s).velocity).toEqual({ x: 0, y: 0, z: 0 });
    expect(pogo(s).nextGate).toBe(3); // gate progress survives a crash

    // Upright, still facing the way it crashed.
    const q = pogo(s).orientation;
    const axis = math.rotate(q, { x: 0, y: -1, z: 0 });
    expect(axis.y).toBeCloseTo(-1, 12);
    const facing = math.rotate(q, { x: 0, y: 0, z: 1 });
    expect(facing.z).toBeCloseTo(-1, 12);
  });

  it("keeps the stick orientation a unit quaternion", () => {
    const s = physics.makeState();
    const input: physics.Inputs = { yaw: 1.3, pitch: 0.7, roll: -0.9, mega: false };
    for (let i = 0; i < 200; i++) {
      step(s, input);
      const q = pogo(s).orientation;
      expect(Math.hypot(q.x, q.y, q.z, q.w)).toBeCloseTo(1, 9);
    }
  });

  it("rotates the orientation from input", () => {
    const s = physics.makeState();
    const y0 = pogo(s).orientation.y;
    step(s, { yaw: 0, pitch: 0, roll: 0, mega: false });
    expect(pogo(s).orientation.y).toBeCloseTo(y0, 12);
    step(s, { yaw: 1, pitch: 0, roll: 0, mega: false });
    expect(pogo(s).orientation.y).toBeGreaterThan(y0);
  });

  it("mega-bounce adds height", () => {
    const maxHeight = (mega: boolean) => {
      const s = physics.makeState();
      let top = 0;
      for (let i = 0; i < 480; i++) {
        step(s, { ...NO_INPUT, mega });
        top = Math.max(top, pogo(s).position.y);
      }
      return top;
    };
    expect(maxHeight(true)).toBeGreaterThan(maxHeight(false) + 5);
  });

  it("is deterministic for identical step sequences", () => {
    const a = physics.makeState(2);
    const b = physics.makeState(2);
    for (let i = 0; i < 500; i++) {
      physics.step(a, DT);
      physics.step(b, DT);
    }
    expect(a).toEqual(b);
  });
});

describe("trees", () => {
  it("puts cones on the ground, clear of the spawn", () => {
    const s = physics.makeState();
    const t = {
      count: 90,
      clear: 70,
      minRadius: 6,
      maxRadius: 16,
      minHeight: 40,
      maxHeight: 120,
    };
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
    expect(physics.makeState().trees).toEqual(physics.makeState().trees);
  });
});

describe("tree collision", () => {
  const fly = (trees: physics.Tree[], y = 40) => {
    const s = physics.makeState();
    s.trees = trees;
    const p = pogo(s);
    p.position = { x: 0, y, z: -5 };
    p.velocity = { x: 0, y: 0, z: -60 };
    p.orientation = math.identityQuat();
    for (let i = 0; i < 30; i++) step(s);
    return p;
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

describe("gates", () => {
  it("starts every pogo at the first gate", () => {
    const s = physics.makeState(2);
    expect(s.gates.length).toBeGreaterThan(1);
    for (const p of s.pogos) expect(p.nextGate).toBe(0);
  });

  it("starts the player in front of the first gate, facing through it", () => {
    const s = physics.makeState();
    const p = s.pogos[0];
    const g = s.gates[0];
    const through = math.rotate(g.orientation, { x: 0, y: 0, z: 1 });

    // Behind the gate: the offset from gate to rider opposes the through axis.
    const behind =
      (p.position.x - g.position.x) * through.x +
      (p.position.z - g.position.z) * through.z;
    expect(behind).toBeLessThan(0);

    // Facing the gate: the rider's forward matches the gate's through axis.
    const facing = math.rotate(p.orientation, { x: 0, y: 0, z: 1 });
    expect(facing.x).toBeCloseTo(through.x, 12);
    expect(facing.z).toBeCloseTo(through.z, 12);
    expect(facing.y).toBeCloseTo(0, 12);
  });

  it("advances to the next gate when the rider passes through it", () => {
    const s = physics.makeState();
    const p = pogo(s);
    p.position = { ...s.gates[0].position };
    step(s);
    expect(p.nextGate).toBe(1);
  });

  it("wraps to the first gate after the last", () => {
    const s = physics.makeState();
    s.trees = [];
    const p = pogo(s);
    p.nextGate = s.gates.length - 1;
    p.position = { ...s.gates[p.nextGate].position };
    step(s);
    expect(p.nextGate).toBe(0);
  });

  it("ignores a gate the rider passes beside", () => {
    const s = physics.makeState();
    const p = pogo(s);
    const g = s.gates[0];
    const across = math.rotate(g.orientation, { x: 1, y: 0, z: 0 });
    p.position = {
      x: g.position.x + across.x * g.width,
      y: g.position.y,
      z: g.position.z + across.z * g.width,
    };
    step(s);
    expect(p.nextGate).toBe(0);
  });

  it("passes a rotated gate along its own axis", () => {
    const s = physics.makeState();
    const p = pogo(s);
    const g = s.gates[0];
    g.orientation = math.rotationAboutY(0.7);
    const through = math.rotate(g.orientation, { x: 0, y: 0, z: 1 });
    p.position = {
      x: g.position.x + through.x * g.depth * 0.4,
      y: g.position.y,
      z: g.position.z + through.z * g.depth * 0.4,
    };
    step(s);
    expect(p.nextGate).toBe(1);
  });

  it("does not let a fast rider skip its next gate", () => {
    const s = physics.makeState();
    s.trees = [];
    const p = pogo(s);
    const g = s.gates[0];
    const through = math.rotate(g.orientation, { x: 0, y: 0, z: 1 });
    // Start short of the gate and cross it in a single step.
    p.position = {
      x: g.position.x - through.x * 20,
      y: g.position.y,
      z: g.position.z - through.z * 20,
    };
    p.velocity = { x: through.x * 9600, y: 0, z: through.z * 9600 };
    step(s);
    expect(p.nextGate).toBe(1);
  });
});

describe("ai pilot", () => {
  it("returns bounded controls", () => {
    const s = physics.makeState();
    const p = pogo(s);
    const pilot = new Pilot(p, 3);
    for (let i = 0; i < 240; i++) {
      pilot.update(DT);
      expect(Math.abs(p.input.yaw)).toBeLessThanOrEqual(4 + 1e-9);
      expect(Math.abs(p.input.pitch)).toBeLessThanOrEqual(3 + 1e-9);
      expect(p.input.roll).toBe(0);
      physics.step(s, DT);
    }
  });

  it("hops the pogo around", () => {
    const s = physics.makeState();
    const p = pogo(s);
    const pilot = new Pilot(p, 7);
    const start = { x: p.position.x, z: p.position.z };
    for (let i = 0; i < 4 * 240; i++) {
      pilot.update(DT);
      physics.step(s, DT);
    }
    const moved = Math.hypot(p.position.x - start.x, p.position.z - start.z);
    expect(moved).toBeGreaterThan(30);
  });
});
