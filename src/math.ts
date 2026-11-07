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

export function mulQuat(a: Quat, b: Quat): Quat {
  return {
    x: a.w * b.x + a.x * b.w + a.y * b.z - a.z * b.y,
    y: a.w * b.y - a.x * b.z + a.y * b.w + a.z * b.x,
    z: a.w * b.z + a.x * b.y - a.y * b.x + a.z * b.w,
    w: a.w * b.w - a.x * b.x - a.y * b.y - a.z * b.z,
  };
}

export function normalizeQuat(q: Quat): Quat {
  const n = Math.hypot(q.x, q.y, q.z, q.w) || 1;
  return { x: q.x / n, y: q.y / n, z: q.z / n, w: q.w / n };
}

// Inverse rotation for a unit quaternion: maps a world vector into its frame.
export function conjugateQuat(q: Quat): Quat {
  return { x: -q.x, y: -q.y, z: -q.z, w: q.w };
}

// Shortest-arc rotation taking unit vector a onto unit vector b.
export function fromTo(a: Vec3, b: Vec3): Quat {
  const d = a.x * b.x + a.y * b.y + a.z * b.z;
  if (d > 1 - 1e-9) return identityQuat();
  if (d < -1 + 1e-9) {
    // Opposite vectors: half-turn about any axis perpendicular to a.
    const p =
      Math.abs(a.x) < Math.abs(a.y) && Math.abs(a.x) < Math.abs(a.z)
        ? { x: 0, y: -a.z, z: a.y }
        : Math.abs(a.y) < Math.abs(a.z)
          ? { x: -a.z, y: 0, z: a.x }
          : { x: -a.y, y: a.x, z: 0 };
    const n = Math.hypot(p.x, p.y, p.z) || 1;
    return { x: p.x / n, y: p.y / n, z: p.z / n, w: 0 };
  }
  return normalizeQuat({
    x: a.y * b.z - a.z * b.y,
    y: a.z * b.x - a.x * b.z,
    z: a.x * b.y - a.y * b.x,
    w: 1 + d,
  });
}

// Slab test: does the segment a -> b intersect the origin-centred box with the
// given half sizes?
export function intersectSegmentBox(a: Vec3, b: Vec3, hSize: Vec3): boolean {
  const o = [a.x, a.y, a.z];
  const d = [b.x - a.x, b.y - a.y, b.z - a.z];
  const h = [hSize.x, hSize.y, hSize.z];
  let tmin = 0;
  let tmax = 1;
  for (let i = 0; i < 3; i++) {
    if (Math.abs(d[i]) < 1e-9) {
      if (Math.abs(o[i]) > h[i]) return false;
    } else {
      let t1 = (-h[i] - o[i]) / d[i];
      let t2 = (h[i] - o[i]) / d[i];
      if (t1 > t2) [t1, t2] = [t2, t1];
      tmin = Math.max(tmin, t1);
      tmax = Math.min(tmax, t2);
      if (tmin > tmax) return false;
    }
  }
  return true;
}

export function rotationAboutX(angle: number): Quat {
  const h = angle / 2;
  return { x: Math.sin(h), y: 0, z: 0, w: Math.cos(h) };
}

export function rotationAboutZ(angle: number): Quat {
  const h = angle / 2;
  return { x: 0, y: 0, z: Math.sin(h), w: Math.cos(h) };
}

export function rotationAboutY(angle: number): Quat {
  const h = angle / 2;
  return { x: 0, y: Math.sin(h), z: 0, w: Math.cos(h) };
}

// Deterministic PRNG (mulberry32); same seed gives the same sequence.
export function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), a | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
