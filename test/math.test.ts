import { describe, expect, it } from "vitest";
import * as math from "../src/math";

describe("math", () => {
  it("identityQuat leaves a vector unchanged", () => {
    const v = { x: 1, y: 2, z: 3 };
    expect(math.rotate(math.identityQuat(), v)).toEqual(v);
  });

  it("rotate about Z by 90deg maps -Y to +X", () => {
    const q = { x: 0, y: 0, z: Math.SQRT1_2, w: Math.SQRT1_2 };
    const v = math.rotate(q, { x: 0, y: -1, z: 0 });
    expect(v.x).toBeCloseTo(1, 10);
    expect(v.y).toBeCloseTo(0, 10);
    expect(v.z).toBeCloseTo(0, 10);
  });

  it("rotationAboutZ produces a unit quaternion", () => {
    const q = math.rotationAboutZ(0.7);
    expect(Math.hypot(q.x, q.y, q.z, q.w)).toBeCloseTo(1, 10);
  });

  const h = { x: 1, y: 1, z: 1 };

  it("intersectSegmentBox is true for a segment crossing the box", () => {
    expect(
      math.intersectSegmentBox({ x: 0, y: 0, z: -2 }, { x: 0, y: 0, z: 2 }, h),
    ).toBe(true);
  });

  it("intersectSegmentBox is true when an end lies inside", () => {
    expect(
      math.intersectSegmentBox({ x: 0, y: 0, z: -2 }, { x: 0, y: 0, z: 0.5 }, h),
    ).toBe(true);
  });

  it("intersectSegmentBox is false for a segment that stops short", () => {
    expect(
      math.intersectSegmentBox({ x: 0, y: 0, z: -2 }, { x: 0, y: 0, z: -1.5 }, h),
    ).toBe(false);
  });

  it("intersectSegmentBox is false when parallel and outside", () => {
    expect(
      math.intersectSegmentBox({ x: 2, y: 0, z: -1 }, { x: 2, y: 0, z: 1 }, h),
    ).toBe(false);
  });
});
