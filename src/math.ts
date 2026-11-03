// Pure vector and quaternion math.

export type Vec3 = { x: number; y: number; z: number };
export type Quat = { x: number; y: number; z: number; w: number };

export function identityQuat(): Quat {
  return { x: 0, y: 0, z: 0, w: 1 };
}

export function rotate(q: Quat, v: Vec3): Vec3 {
  const tx = 2 * (q.y * v.z - q.z * v.y);
  const ty = 2 * (q.z * v.x - q.x * v.z);
  const tz = 2 * (q.x * v.y - q.y * v.x);
  return {
    x: v.x + q.w * tx + (q.y * tz - q.z * ty),
    y: v.y + q.w * ty + (q.z * tx - q.x * tz),
    z: v.z + q.w * tz + (q.x * ty - q.y * tx),
  };
}

export function rotationAboutZ(angle: number): Quat {
  const h = angle / 2;
  return { x: 0, y: 0, z: Math.sin(h), w: Math.cos(h) };
}
