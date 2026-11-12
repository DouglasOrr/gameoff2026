import { describe, expect, it } from "vitest";
import * as physics from "../src/physics";
import * as math from "../src/math";
import * as terrain from "../src/terrain";
import { demo } from "../src/levels/demo";
import { Pilot } from "../src/ai";

const DT = 1 / 240;
const NO_INPUT = physics.IDLE;

// Copy the level, so tests that edit gates, trees or ramps can't touch the
// shared demo.
const cloneLevel = (level: physics.Level): physics.Level => ({
  ...level,
  gates: level.gates.map((g) => ({ ...g })),
  trees: level.trees.map((t) => ({ ...t })),
  ramps: level.ramps.map((r) => ({ ...r })),
  halfPipes: level.halfPipes.map((p) => ({ ...p })),
});

const makeState = (count = 1) => physics.loadLevel(cloneLevel(demo), count);

// The state holds several pogos; these tests drive the first.
const pogo = (s: physics.State) => s.pogos[0];
const step = (s: physics.State, input: physics.Inputs = NO_INPUT) => {
  for (const p of s.pogos) p.input = input;
  physics.step(s, DT);
};

describe("physics bounce", () => {
  it("spawns above the ground, upright and at rest", () => {
    const p = pogo(makeState());
    expect(p.position.y).toBe(physics.S.stickLength + physics.S.spawnDrop);
    const axis = math.rotate(p.orientation, { x: 0, y: -1, z: 0 });
    expect(axis.x).toBeCloseTo(0, 12);
    expect(axis.y).toBeCloseTo(-1, 12);
    expect(axis.z).toBeCloseTo(0, 12);
    expect(p.velocity).toEqual({ x: 0, y: 0, z: 0 });
    expect(p.strain).toBe(0);
  });

  it("falls under gravity before touching the ground", () => {
    const s = makeState();
    for (let i = 0; i < 3; i++) step(s);
    expect(pogo(s).position.y).toBeLessThan(
      physics.S.stickLength + physics.S.spawnDrop,
    );
    expect(pogo(s).velocity.y).toBeLessThan(0);
    expect(pogo(s).strain).toBe(0);
  });

  it("compresses the stick on contact and rebounds to near its drop height", () => {
    const s = makeState();
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
    expect(minY).toBeGreaterThan(0);
    // The active spring mostly balances drag, so it settles near the drop
    // height (a little short, since drag is now fairly strong).
    expect(maxAfterBounce).toBeGreaterThan(startY - 4);
  });

  it("keeps the foot on the ground while in contact", () => {
    const s = makeState();
    let found = false;
    for (let i = 0; i < 300 && !found; i++) {
      step(s);
      if (pogo(s).strain > 0) {
        found = true;
        const axis = math.rotate(pogo(s).orientation, { x: 0, y: -1, z: 0 });
        const length = physics.S.stickLength - pogo(s).strain;
        expect(pogo(s).position.y + length * axis.y).toBeCloseTo(0, 6);
      }
    }
    expect(found).toBe(true);
  });

  it("converts a lean into horizontal speed", () => {
    const s = makeState();
    pogo(s).orientation = math.rotationAboutX(0.4);
    for (let i = 0; i < 480; i++) step(s);
    expect(Math.hypot(pogo(s).velocity.x, pogo(s).velocity.z)).toBeGreaterThan(1);
  });

  it("resets the pogo upright when it falls through the ground", () => {
    const s = makeState();
    pogo(s).position = { x: 5, y: -1, z: 7 };
    pogo(s).orientation = math.rotationAboutX(Math.PI); // stick points up, facing -z
    pogo(s).nextGate = 3;
    pogo(s).lap = demo.laps;
    pogo(s).time = 12.5;
    step(s);
    expect(pogo(s).position).toEqual({
      x: 5,
      y: physics.S.stickLength + physics.S.spawnDrop,
      z: 7,
    });
    expect(pogo(s).velocity).toEqual({ x: 0, y: 0, z: 0 });
    expect(pogo(s).nextGate).toBe(3); // race progress survives a crash
    expect(pogo(s).lap).toBe(demo.laps);
    expect(pogo(s).time).toBe(12.5);

    // Upright, still facing the way it crashed.
    const q = pogo(s).orientation;
    const axis = math.rotate(q, { x: 0, y: -1, z: 0 });
    expect(axis.y).toBeCloseTo(-1, 12);
    const facing = math.rotate(q, { x: 0, y: 0, z: 1 });
    expect(facing.z).toBeCloseTo(-1, 12);
  });

  it("does not reset a rider that dips below a bump while still upright", () => {
    const s = makeState();
    s.level = { ...s.level, trees: [] };
    const p = pogo(s);
    // Body below the top of the demo bump at (600, 0), but the stick is
    // still standing on its foot, so this is not a fall.
    p.position = { x: 600, y: 30, z: 0 };
    p.orientation = math.identityQuat();
    step(s);
    const spawn =
      terrain.height(s.level.terrain, 600, 0) +
      physics.S.stickLength +
      physics.S.spawnDrop;
    expect(pogo(s).position.y).toBeLessThan(spawn); // recovering, not reset
  });

  it("resets once the pogo has toppled into the ground", () => {
    const s = makeState();
    s.level = { ...s.level, trees: [] };
    const p = pogo(s);
    p.position = { x: 600, y: 30, z: 0 };
    p.orientation = math.rotationAboutX(Math.PI / 2); // stick horizontal
    step(s);
    const spawn =
      terrain.height(s.level.terrain, 600, 0) +
      physics.S.stickLength +
      physics.S.spawnDrop;
    expect(pogo(s).position.y).toBe(spawn);
  });

  it("keeps the stick orientation a unit quaternion", () => {
    const s = makeState();
    const input: physics.Inputs = { yaw: 1.3, pitch: 0.7, roll: -0.9, mega: false };
    for (let i = 0; i < 200; i++) {
      step(s, input);
      const q = pogo(s).orientation;
      expect(Math.hypot(q.x, q.y, q.z, q.w)).toBeCloseTo(1, 9);
    }
  });

  it("rotates the orientation from input", () => {
    const s = makeState();
    const y0 = pogo(s).orientation.y;
    step(s, { yaw: 0, pitch: 0, roll: 0, mega: false });
    expect(pogo(s).orientation.y).toBeCloseTo(y0, 12);
    step(s, { yaw: 1, pitch: 0, roll: 0, mega: false });
    expect(pogo(s).orientation.y).toBeGreaterThan(y0);
  });

  it("mega-bounce adds height", () => {
    const maxHeight = (mega: boolean) => {
      const s = makeState();
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
    const a = makeState(2);
    const b = makeState(2);
    for (let i = 0; i < 500; i++) {
      physics.step(a, DT);
      physics.step(b, DT);
    }
    expect(a).toEqual(b);
  });
});

describe("trees", () => {
  it("puts cones on the ground, clear of the spawn", () => {
    const s = makeState();
    const t = {
      count: 90,
      clear: 70,
      minRadius: 6,
      maxRadius: 16,
      minHeight: 40,
      maxHeight: 120,
    };
    expect(s.level.trees).toHaveLength(t.count);
    for (const tree of s.level.trees) {
      expect(tree.position.y).toBeCloseTo(
        terrain.height(s.level.terrain, tree.position.x, tree.position.z),
        9,
      );
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
    expect(makeState().level.trees).toEqual(makeState().level.trees);
  });
});

describe("tree collision", () => {
  const fly = (trees: physics.Tree[], y = 40) => {
    const s = makeState();
    s.level = { ...s.level, trees };
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

describe("ramps", () => {
  const flat: terrain.Terrain = { base: 0, features: [] };

  // A plain kicker at the origin, rising to the lip along +z.
  const kicker: physics.Ramp = {
    position: { x: 0, y: 0, z: 0 },
    orientation: math.identityQuat(),
    length: 100,
    flat: 0,
    width: 100,
    height: 50,
  };

  it("places ramps on the ground, clear of the trees", () => {
    const s = makeState();
    expect(s.level.ramps.length).toBeGreaterThan(0);
    for (const ramp of s.level.ramps) {
      expect(ramp.position.y).toBeCloseTo(
        terrain.height(s.level.terrain, ramp.position.x, ramp.position.z),
        9,
      );
      for (const tree of s.level.trees) {
        const d = Math.hypot(
          tree.position.x - ramp.position.x,
          tree.position.z - ramp.position.z,
        );
        expect(d).toBeGreaterThanOrEqual(
          Math.hypot(ramp.width / 2, (ramp.length + ramp.flat) / 2),
        );
      }
    }
  });

  it("reports the ramp top as ground height", () => {
    const level: physics.Level = { ...demo, terrain: flat, ramps: [kicker] };
    expect(physics.groundHeight(level, 0, 0)).toBeCloseTo(25, 9); // mid-slope
    expect(physics.groundHeight(level, 0, 49)).toBeCloseTo(49.5, 9); // near the lip
    expect(physics.groundHeight(level, 0, -60)).toBeCloseTo(0, 9); // behind it
    expect(physics.groundHeight(level, 60, 0)).toBeCloseTo(0, 9); // beside it
  });

  it("rests the stick on a ramp's slope", () => {
    const s = makeState();
    s.level = { ...s.level, terrain: flat, trees: [], ramps: [kicker] };
    const p = pogo(s);
    p.position = { x: 0, y: 25 + physics.S.stickLength - 2, z: 0 };
    p.orientation = math.identityQuat();
    step(s);
    expect(p.strain).toBeGreaterThan(0);
    const axis = math.rotate(p.orientation, { x: 0, y: -1, z: 0 });
    const len = physics.S.stickLength - p.strain;
    const footY = p.position.y + axis.y * len;
    const footZ = p.position.z + axis.z * len;
    expect(footY).toBeCloseTo((kicker.height * (footZ + 50)) / 100, 6);
  });

  const flyRamp = (ramps: physics.Ramp[], y = 40) => {
    const s = makeState();
    s.level = { ...s.level, terrain: flat, trees: [], ramps };
    const p = pogo(s);
    p.position = { x: 0, y, z: 55 };
    p.velocity = { x: 0, y: 0, z: -40 };
    p.orientation = math.identityQuat();
    for (let i = 0; i < 60; i++) step(s);
    return p;
  };

  it("rests the stick on a ramp's flat top", () => {
    const tabled: physics.Ramp = { ...kicker, flat: 60 };
    const s = makeState();
    s.level = { ...s.level, terrain: flat, trees: [], ramps: [tabled] };
    const p = pogo(s);
    p.position = { x: 0, y: 50 + physics.S.stickLength - 2, z: 50 };
    p.orientation = math.identityQuat();
    step(s);
    expect(p.strain).toBeGreaterThan(0);
    const axis = math.rotate(p.orientation, { x: 0, y: -1, z: 0 });
    const len = physics.S.stickLength - p.strain;
    expect(p.position.y + axis.y * len).toBeCloseTo(50, 6);
  });

  it("holds a rider that lands hard on a ramp", () => {
    const s = makeState();
    s.level = { ...s.level, terrain: flat, trees: [], ramps: [kicker] };
    const p = pogo(s);
    p.position = { x: 0, y: 60, z: -40 };
    p.velocity = { x: 0, y: -100, z: 0 };
    p.orientation = math.identityQuat();
    let minZ = Infinity;
    for (let i = 0; i < 240; i++) {
      step(s);
      minZ = Math.min(minZ, p.position.z);
    }
    const half = (kicker.length + kicker.flat) / 2;
    expect(minZ).toBeGreaterThan(-half); // not ejected out the back
  });

  it("bounces a rider off a ramp's lip", () => {
    const hit = flyRamp([kicker]);
    const miss = flyRamp([]);
    expect(hit.velocity.z).toBeGreaterThan(0); // bounced back
    expect(hit.position.z).toBeGreaterThan(50);
    expect(miss.position.z).toBeLessThan(50);
  });

  it("launches a rider up a ramp", () => {
    const run = (ramps: physics.Ramp[]) => {
      const s = makeState();
      s.level = { ...s.level, terrain: flat, trees: [], ramps };
      const p = pogo(s);
      // Start close to the ramp: from further back, drag bleeds off the approach
      // speed before the rider reaches the slope.
      p.position = { x: 0, y: physics.S.stickLength + 2, z: -60 };
      p.velocity = { x: 0, y: 0, z: 90 };
      p.orientation = math.identityQuat();
      let top = 0;
      for (let i = 0; i < 480; i++) {
        step(s);
        top = Math.max(top, p.position.y);
      }
      return top;
    };
    expect(run([kicker])).toBeGreaterThan(run([]) + 10);
  });
});

describe("half-pipes", () => {
  const flat: terrain.Terrain = { base: 0, features: [] };

  // 90 degree opening, so the walls are 45 degrees and rise as y = |x|.
  const pipe: physics.HalfPipe = {
    position: { x: 0, y: 0, z: 0 },
    orientation: math.identityQuat(),
    length: 400,
    angle: Math.PI / 2,
    height: 60,
  };

  it("reports the wall as ground height", () => {
    const level: physics.Level = { ...demo, terrain: flat, halfPipes: [pipe] };
    expect(physics.groundHeight(level, 0, 0)).toBeCloseTo(0, 6); // the vertex
    expect(physics.groundHeight(level, 30, 0)).toBeCloseTo(30, 6); // mid-wall
    expect(physics.groundHeight(level, 90, 0)).toBeCloseTo(0, 6); // past the top
  });

  it("rests the stick on a slanted wall", () => {
    const s = makeState();
    s.level = {
      ...s.level,
      terrain: flat,
      trees: [],
      ramps: [],
      halfPipes: [pipe],
    };
    const p = pogo(s);
    p.position = { x: 30, y: 30 + physics.S.stickLength - 2, z: 0 };
    p.orientation = math.identityQuat();
    step(s);
    expect(p.strain).toBeGreaterThan(0);
    const axis = math.rotate(p.orientation, { x: 0, y: -1, z: 0 });
    const len = physics.S.stickLength - p.strain;
    const footX = p.position.x + axis.x * len;
    const footY = p.position.y + axis.y * len;
    expect(footY).toBeCloseTo(footX, 6); // on the 45 degree wall, y = |x|
  });

  it("bounces a rider off an end cap", () => {
    const s = makeState();
    s.level = {
      ...s.level,
      terrain: flat,
      trees: [],
      ramps: [],
      halfPipes: [pipe],
    };
    const p = pogo(s);
    // Outside the +z cap, inside the solid's triangular section, flying in.
    p.position = { x: 30, y: 15, z: 202 };
    p.velocity = { x: 0, y: 0, z: -40 };
    p.orientation = math.identityQuat();
    for (let i = 0; i < 30; i++) step(s);
    expect(p.velocity.z).toBeGreaterThan(0); // pushed back out along +z
  });

  it("does not fake a wall beyond the top edge", () => {
    const s = makeState();
    s.level = {
      ...s.level,
      terrain: flat,
      trees: [],
      ramps: [],
      halfPipes: [pipe],
    };
    const p = pogo(s);
    // Just past the top edge (x = w = 60), level with where the wall plane
    // would be. A clamped solve used to drag this onto the wall; it must not.
    p.position = { x: 65, y: 65, z: 0 };
    p.orientation = math.identityQuat();
    step(s);
    expect(p.strain).toBe(0);
  });

  it("bounces a rider off the outer side", () => {
    const s = makeState();
    s.level = {
      ...s.level,
      terrain: flat,
      trees: [],
      ramps: [],
      halfPipes: [pipe],
    };
    const p = pogo(s);
    // The wall top is at x = 60 (height * tan 45); approach it from outside.
    p.position = { x: 64, y: 50, z: 0 };
    p.velocity = { x: -40, y: 0, z: 0 };
    p.orientation = math.identityQuat();
    for (let i = 0; i < 120; i++) step(s);
    expect(p.velocity.x).toBeGreaterThan(0); // pushed back out
  });
});

describe("gates", () => {
  it("starts every pogo at the first gate", () => {
    const s = makeState(2);
    expect(s.level.gates.length).toBeGreaterThan(1);
    for (const p of s.pogos) expect(p.nextGate).toBe(0);
  });

  it("starts the player in front of the first gate, facing through it", () => {
    const s = makeState();
    const p = s.pogos[0];
    const g = s.level.gates[0];
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
    const s = makeState();
    const p = pogo(s);
    p.position = { ...s.level.gates[0].position };
    step(s);
    expect(p.nextGate).toBe(1);
  });

  it("wraps to the first gate after the last", () => {
    const s = makeState();
    s.level = { ...s.level, trees: [] };
    const p = pogo(s);
    p.nextGate = s.level.gates.length - 1;
    p.position = { ...s.level.gates[p.nextGate].position };
    step(s);
    expect(p.nextGate).toBe(0);
  });

  it("ignores a gate the rider passes beside", () => {
    const s = makeState();
    const p = pogo(s);
    const g = s.level.gates[0];
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
    const s = makeState();
    const p = pogo(s);
    const g = s.level.gates[0];
    g.orientation = math.rotationAboutY(0.7);
    const through = math.rotate(g.orientation, { x: 0, y: 0, z: 1 });
    p.position = {
      x: g.position.x + through.x * physics.S.gateDepth * 0.4,
      y: g.position.y,
      z: g.position.z + through.z * physics.S.gateDepth * 0.4,
    };
    step(s);
    expect(p.nextGate).toBe(1);
  });

  it("does not let a fast rider skip its next gate", () => {
    const s = makeState();
    s.level = { ...s.level, trees: [] };
    const p = pogo(s);
    const g = s.level.gates[0];
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
    const s = makeState();
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
    const s = makeState();
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

describe("race", () => {
  it("runs the timer before the race is done", () => {
    const s = makeState();
    for (let i = 0; i < 10; i++) step(s);
    expect(pogo(s).time).toBeCloseTo(10 * DT, 9);
  });

  it("counts a lap when the rider loops back through the first gate", () => {
    const s = makeState();
    const p = pogo(s);
    p.nextGate = s.level.gates.length - 1;
    p.position = { ...s.level.gates[p.nextGate].position };
    step(s);
    expect(p.lap).toBe(1);
  });

  it("pauses the timer once every lap is done", () => {
    const s = makeState();
    const p = pogo(s);
    for (let i = 0; i < demo.laps; i++) {
      p.nextGate = s.level.gates.length - 1;
      p.position = { ...s.level.gates[p.nextGate].position };
      step(s);
    }
    expect(p.lap).toBe(demo.laps);
    const frozen = p.time;
    for (let i = 0; i < 10; i++) step(s);
    expect(p.time).toBe(frozen);
  });
});
