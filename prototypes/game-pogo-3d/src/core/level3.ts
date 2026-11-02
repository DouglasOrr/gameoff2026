// Level layout: flat ground everywhere, with box obstacles sitting on it along
// the course (z axis). Blocks are axis-aligned boxes, centered at (x, z) with
// width w, depth d, height h, standing on the ground.

export type Block = { x: number; z: number; w: number; d: number; h: number };

export const SPAWN_X = 0;
export const SPAWN_Z = 0;
export const FINISH_Z = 4500;

export function makeLevel(): Block[] {
  // Course runs along +z; the spawn faces +z. Walls are wide in x so they read
  // as obstacles, but in 3D you can also go around them.
  const wall = (z: number, h: number, w = 400, d = 70): Block => ({ x: 0, z, w, d, h });
  return [
    wall(560, 120), // easy
    wall(1000, 180), // easy-mid
    wall(1400, 240), // needs a good bounce
    wall(1850, 140), // step to land on
    wall(2200, 300), // hard
    wall(3000, 120), // step
    wall(3280, 280), // hard
    wall(3900, 280), // finish wall
  ];
}

// Highest surface top at (x, z): 0 for the ground plane, or a block top.
export function groundHeight(x: number, z: number, blocks: Block[]): number {
  let top = 0;
  for (const b of blocks) {
    if (x >= b.x - b.w / 2 && x <= b.x + b.w / 2 && z >= b.z - b.d / 2 && z <= b.z + b.d / 2) {
      top = Math.max(top, b.h);
    }
  }
  return top;
}
