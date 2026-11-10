// The demo track: a ring of gates through a scattered forest, over rolling
// bumps and a bowl.

import * as math from "../math";
import * as physics from "../physics";
import * as terrain from "../terrain";

const ground: terrain.Terrain = {
  base: 0,
  features: [
    {
      op: "add",
      shape: { center: { x: 600, z: 0 }, radius: 180, apex: 60 },
      blend: 20,
    },
    {
      op: "cut",
      shape: { center: { x: -600, z: 0 }, radius: 160, apex: 50 },
      blend: 20,
    },
    {
      op: "add",
      shape: { center: { x: 0, z: -600 }, radius: 200, apex: 80 },
      blend: 24,
    },
  ],
};

export const demo: physics.Level = {
  gates: gateRing(ground),
  trees: forest(ground),
  terrain: ground,
  laps: 2,
};

// Eight gates evenly spaced around a circle, each facing along the loop.
function gateRing(t: terrain.Terrain): physics.Gate[] {
  const count = 8;
  const radius = 600; // gates sit on a circle of this radius
  const width = 120; // span across the gate
  const height = 160; // span vertically
  const depth = 20; // span along the gate

  const gates: physics.Gate[] = [];
  for (let i = 0; i < count; i++) {
    const theta = (i / count) * Math.PI * 2;
    const x = radius * Math.sin(theta);
    const z = radius * Math.cos(theta);
    gates.push({
      position: { x, y: terrain.height(t, x, z) + height / 2, z },
      orientation: math.rotationAboutY(theta + Math.PI / 2), // tangent to the loop
      width,
      height,
      depth,
    });
  }
  return gates;
}

// A fixed scatter of cones, clear of the spawn area.
function forest(t: terrain.Terrain): physics.Tree[] {
  const count = 90;
  const spread = 900; // scattered within +/- this of the origin
  const clear = 70; // keep this radius around the origin clear
  const minRadius = 6;
  const maxRadius = 16;
  const minHeight = 40;
  const maxHeight = 120;

  const rand = math.rng(1); // fixed seed, so the scatter is reproducible
  const trees: physics.Tree[] = [];
  for (let i = 0; i < count; i++) {
    let x: number;
    let z: number;
    do {
      x = (rand() * 2 - 1) * spread;
      z = (rand() * 2 - 1) * spread;
    } while (Math.hypot(x, z) < clear);
    trees.push({
      position: { x, y: terrain.height(t, x, z), z },
      radius: minRadius + (maxRadius - minRadius) * rand(),
      height: minHeight + (maxHeight - minHeight) * rand(),
    });
  }
  return trees;
}
