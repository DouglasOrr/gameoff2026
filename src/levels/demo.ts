// The demo track: a ring of gates through a scattered forest.

import * as math from "../math";
import * as physics from "../physics";

export const demo: physics.Level = {
  gates: gateRing(),
  trees: forest(),
  laps: 2,
};

// Eight gates evenly spaced around a circle, each facing along the loop.
function gateRing(): physics.Gate[] {
  const count = 8;
  const radius = 600; // gates sit on a circle of this radius
  const width = 120; // span across the gate
  const height = 160; // span vertically
  const depth = 20; // span along the gate

  const gates: physics.Gate[] = [];
  for (let i = 0; i < count; i++) {
    const theta = (i / count) * Math.PI * 2;
    gates.push({
      position: {
        x: radius * Math.sin(theta),
        y: height / 2,
        z: radius * Math.cos(theta),
      },
      orientation: math.rotationAboutY(theta + Math.PI / 2), // tangent to the loop
      width,
      height,
      depth,
    });
  }
  return gates;
}

// A fixed scatter of cones, clear of the spawn area.
function forest(): physics.Tree[] {
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
      position: { x, y: physics.S.groundY, z },
      radius: minRadius + (maxRadius - minRadius) * rand(),
      height: minHeight + (maxHeight - minHeight) * rand(),
    });
  }
  return trees;
}
