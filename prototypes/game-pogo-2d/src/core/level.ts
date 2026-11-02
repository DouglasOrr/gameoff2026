// Level layout. Blocks are axis-aligned boxes with (x, y) = bottom-left corner.
// Ground segments sit below the ground line (y < 0, top at 0); obstacles sit on
// it. The course is a set of walls to jump over / onto and gaps to cross.
//
// groundHeight(x) collapses the blocks into a height field: the foot of the
// pogo bounces off whatever surface is under it, and falls (height = -Infinity)
// over gaps. Walls therefore need to be cleared by the *foot*, i.e. the rider
// must rise one stick-length above the wall top.

export type Block = { x: number; y: number; w: number; h: number };

// Highest surface top at x, or -Infinity over a gap.
export function groundHeight(x: number, blocks: Block[]): number {
  let h = -Infinity;
  for (const b of blocks) {
    if (x >= b.x && x <= b.x + b.w) {
      h = Math.max(h, b.y + b.h);
    }
  }
  return h;
}

export const SPAWN_X = 0;
export const FINISH_X = 4500;

export function makeLevel(): Block[] {
  const blocks: Block[] = [];
  const ground = (x0: number, x1: number) =>
    blocks.push({ x: x0, y: -400, w: x1 - x0, h: 400 });
  const wall = (x: number, w: number, h: number) =>
    blocks.push({ x, y: 0, w, h });

  // Ground with two gaps.
  ground(-1200, 2600);
  ground(2840, 3400);
  ground(3640, 4800);

  // Obstacles: rider must rise wall height + stick length to clear them.
  wall(560, 140, 120); // easy
  wall(1000, 70, 180); // easy-mid
  wall(1400, 70, 240); // needs a power-bounce
  wall(1850, 150, 140); // step to land on
  wall(2200, 70, 300); // hard
  wall(3000, 170, 120); // step
  wall(3280, 120, 280); // hard, before the second gap
  wall(3900, 70, 280); // finish wall

  return blocks;
}
