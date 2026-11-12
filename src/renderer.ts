// 3D rendering of the state from physics.

import * as THREE from "three";
import * as math from "./math";
import * as physics from "./physics";
import * as terrain from "./terrain";

// Top of the spawn bounce; the camera frames this whole vertical range.
const bounceTop = physics.S.stickLength + physics.S.spawnDrop;

export const S = {
  background: 0x101418, // also the fog colour, so the horizon blends in
  ground: {
    size: 2000,
    cell: 20, // world units per grid cell
    segments: 320, // grid resolution the terrain is displaced on
    color: 0x55606b,
    lineColor: 0x707d8a,
  },
  fog: {
    near: 80,
    far: 700,
  },
  camera: {
    fov: 60,
    distance: bounceTop * 1.4, // initial distance, before the autorange settles
    height: bounceTop * 0.5, // camera height above the ground under the rider
    lookY: bounceTop * 0.32, // look point height above that same ground
    minDistance: bounceTop * 0.9, // closest the autorange pulls in
    maxDistance: bounceTop * 4, // farthest it pulls back (the autorange limit)
    peakWindow: 1, // seconds of height history the autorange frames
    fitPadding: 0.9, // fraction of the vertical half-FOV the framing may use
    zoomOutTime: 0.1, // seconds to pull back, as the rider climbs
    zoomInTime: 1, // seconds to ease back in, once it drops
    minElevation: -0.1, // rad the camera may dip below the focus (peek up)
    maxElevation: 1.1, // rad it may rise above it (peek down)
  },
  top: {
    fov: 50, // fixed; the framing distance is what adapts
    fitPadding: 0.8, // fraction of the half-FOV the gate bounds may use
    far: 5000, // the top-down camera sits well back, and runs without fog
  },
  shadow: {
    radiusNear: 2.5,
    radiusFar: 1.75,
    range: 32, // height above stick-length to fade over
    farColor: new THREE.Color(0x0a0e12), // the patch fades to this with height
    nearOpacity: 0.85,
    farOpacity: 0.25,
    solidNearOpacity: 0.45, // the grey silhouettes read heavier, so sit lighter
    solidFarOpacity: 0.25,
    solidColor: new THREE.Color(0x22272c), // grey silhouette of the box and stick
    patchSegments: 48, // ring resolution of the ground-hugging contact patch
    lift: 0.1, // height above the ground, so the layers don't z-fight or clip
  },
  rider: {
    size: 4, // edge length of the rider box
    // Body colour plus the matching shadow tint, cycled across riders.
    colors: [
      { body: new THREE.Color(0x4f9cf9), shadow: new THREE.Color(0x2563eb) },
      { body: new THREE.Color(0xf0714b), shadow: new THREE.Color(0xd9601f) },
      { body: new THREE.Color(0x2fbf71), shadow: new THREE.Color(0x1b8f52) },
      { body: new THREE.Color(0xe8b93b), shadow: new THREE.Color(0xb8860b) },
    ],
  },
  stick: {
    width: 1.6, // edge of the stick's square cross-section
  },
  gate: {
    colors: {
      next: 0x3ad17a, // the player's next gate
      soon: 0xe8c33b, // the one after that
      other: 0x333a42, // dark enough to read against the ground
    },
    opacity: 0.4, // translucent
    border: 0.15, // frame thickness, as a fraction of the smaller half-size
  },
  tree: {
    color: 0x2f7d4e,
    segments: 8, // cone is low-poly, to match the toon look
    ghostOpacity: 0.25, // trees between the camera and the rider
  },
  ramp: {
    color: 0x9c6f43,
  },
};

type Skin = { body: THREE.Color; shadow: THREE.Color };

// Every shadow layer draws only where the stencil is free, then marks those
// pixels, so overlapping layers never stack into darker patches. Priority comes
// from renderOrder: contact patch, then rider box, then stick.
const shadowStencil: Partial<THREE.MeshBasicMaterialParameters> = {
  stencilWrite: true,
  stencilFunc: THREE.EqualStencilFunc,
  stencilRef: 0,
  stencilFail: THREE.KeepStencilOp,
  stencilZFail: THREE.KeepStencilOp,
  stencilZPass: THREE.IncrementWrapStencilOp,
};

function css(hex: number): string {
  return `#${hex.toString(16).padStart(6, "0")}`;
}

// Distance behind the look point at which a point at world height `y` sits on
// the edge of the camera's vertical field of view. The camera looks from
// (distance, cameraHeight) towards (0, lookY); the angle to the point gives a
// quadratic in `distance`, and we want its larger root - the distance at or
// beyond which the point is framed.
function fitDistance(y: number, tanHalfFov: number): number {
  const dy = S.camera.lookY - y;
  const c = (y - S.camera.height) * (S.camera.lookY - S.camera.height);
  const disc = dy * dy - 4 * tanHalfFov * tanHalfFov * c;
  if (disc <= 0) return 0;
  return (Math.abs(dy) + Math.sqrt(disc)) / (2 * tanHalfFov);
}

type Point2 = { x: number; z: number };

// Convex hull of points in the XZ plane (monotone chain, collinear points dropped).
function convexHullXZ(points: Point2[]): Point2[] {
  const p = points.slice().sort((a, b) => a.x - b.x || a.z - b.z);
  const turn = (o: Point2, a: Point2, b: Point2) =>
    (a.x - o.x) * (b.z - o.z) - (a.z - o.z) * (b.x - o.x);
  const chain = (src: Point2[]) => {
    const out: Point2[] = [];
    for (const q of src) {
      while (
        out.length > 1 &&
        turn(out[out.length - 2], out[out.length - 1], q) <= 0
      )
        out.pop();
      out.push(q);
    }
    return out;
  };
  const lower = chain(p);
  const upper = chain(p.slice().reverse());
  lower.pop();
  upper.pop();
  return lower.concat(upper);
}

// Fan triangles for a silhouette of up to 6 hull corners; padding repeats the
// last corner, so short hulls just produce degenerate (invisible) triangles.
const shadowFan = [0, 1, 2, 0, 2, 3, 0, 3, 4, 0, 4, 5];
const shadowCorners = 6;

function makeSilhouetteGeometry(pos: Float32Array): THREE.BufferGeometry {
  const geo = new THREE.BufferGeometry();
  const attr = new THREE.BufferAttribute(pos, 3);
  attr.setUsage(THREE.DynamicDrawUsage);
  geo.setAttribute("position", attr);
  geo.setIndex(shadowFan);
  return geo;
}

// A ground-hugging disc: a centre vertex and a ring, both written per frame in
// world space, so the contact patch conforms to bumps and bowls.
function makeDiscGeometry(
  pos: Float32Array,
  segments: number,
): THREE.BufferGeometry {
  const geo = new THREE.BufferGeometry();
  const attr = new THREE.BufferAttribute(pos, 3);
  attr.setUsage(THREE.DynamicDrawUsage);
  geo.setAttribute("position", attr);
  const index: number[] = [];
  for (let i = 0; i < segments; i++)
    index.push(0, 1 + i, 1 + ((i + 1) % segments));
  geo.setIndex(index);
  return geo;
}

function makeGridTexture(maxAniso: number): THREE.CanvasTexture {
  const px = 128;
  const canvas = document.createElement("canvas");
  canvas.width = px;
  canvas.height = px;
  const ctx = canvas.getContext("2d")!;
  ctx.fillStyle = css(S.ground.color);
  ctx.fillRect(0, 0, px, px);
  ctx.strokeStyle = css(S.ground.lineColor);
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(0, 0);
  ctx.lineTo(0, px);
  ctx.moveTo(0, 0);
  ctx.lineTo(px, 0);
  ctx.stroke();

  const tex = new THREE.CanvasTexture(canvas);
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.RepeatWrapping;
  const repeat = S.ground.size / S.ground.cell;
  tex.repeat.set(repeat, repeat);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = maxAniso;
  return tex;
}

// Chase camera that follows one rider: fixed height, autoranging distance.
class ChaseCamera {
  readonly camera: THREE.PerspectiveCamera;

  private readonly fitTan: number; // tan of the padded vertical half-FOV
  private readonly peaks: { t: number; top: number }[] = [];
  private readonly quat = new THREE.Quaternion();
  private readonly forward = new THREE.Vector3();
  private distance = S.camera.distance;
  private clock = 0;

  constructor() {
    this.camera = new THREE.PerspectiveCamera(S.camera.fov, 1, 0.1, 1200);
    this.camera.position.set(0, S.camera.height, S.camera.distance);
    this.camera.lookAt(0, S.camera.lookY, 0);
    this.fitTan = Math.tan(
      THREE.MathUtils.degToRad(S.camera.fov / 2) * S.camera.fitPadding,
    );
  }

  resize(aspect: number): void {
    this.camera.aspect = aspect;
    this.camera.updateProjectionMatrix();
  }

  follow(
    pogo: physics.Pogo,
    ground: terrain.Terrain,
    dt: number,
    pitch: number,
  ): void {
    const { position, orientation } = pogo;
    this.quat.set(orientation.x, orientation.y, orientation.z, orientation.w);

    // Behind the rider's heading. Only the horizontal part of the facing
    // direction matters (pitch/roll ignored).
    this.forward.set(0, 0, 1).applyQuaternion(this.quat);
    this.forward.y = 0;
    if (this.forward.lengthSq() > 1e-6) this.forward.normalize();
    else this.forward.set(0, 0, 1);

    // Anchor the vertical frame to the ground under the rider, so the camera
    // climbs hills with it while staying put through each bounce.
    const floor = terrain.height(ground, position.x, position.z);

    // Autorange: frame the highest the rider has been in the last second, so
    // successive bounces settle instead of pumping the camera as the rider
    // falls. Pull back quickly, ease back in slowly, clamp to the limit.
    const top = position.y + S.rider.size / 2 - floor;
    this.clock += dt;
    this.peaks.push({ t: this.clock, top });
    while (this.peaks[0].t < this.clock - S.camera.peakWindow)
      this.peaks.shift();
    let peak = -Infinity;
    for (const p of this.peaks) if (p.top > peak) peak = p.top;

    const target = THREE.MathUtils.clamp(
      fitDistance(peak, this.fitTan),
      S.camera.minDistance,
      S.camera.maxDistance,
    );
    const tau =
      target > this.distance ? S.camera.zoomOutTime : S.camera.zoomInTime;
    this.distance += (target - this.distance) * (1 - Math.exp(-dt / tau));

    // Orbit the focus at the autorange radius. `pitch` > 0 peeks up, which
    // lowers the camera; at pitch 0 it sits at the configured fixed height.
    const lift = S.camera.height - S.camera.lookY;
    const radius = Math.hypot(this.distance, lift);
    const elevation = THREE.MathUtils.clamp(
      Math.atan2(lift, this.distance) - pitch,
      S.camera.minElevation,
      S.camera.maxElevation,
    );
    const horizontal = radius * Math.cos(elevation);
    const lookY = floor + S.camera.lookY;
    this.camera.position.set(
      position.x - this.forward.x * horizontal,
      lookY + radius * Math.sin(elevation),
      position.z - this.forward.z * horizontal,
    );
    this.camera.lookAt(position.x, lookY, position.z);
  }
}

type Bounds2 = { minX: number; maxX: number; minZ: number; maxZ: number };

// Axis-aligned XZ bounds of the gates' footprints: each gate's centre, spread by
// its half-width (local X) and half-depth (local Z) through the gate's yaw, so
// the framing covers the frames themselves rather than just their centres.
function gateBounds(gates: readonly physics.Gate[]): Bounds2 | null {
  if (gates.length === 0) return null;
  let minX = Infinity;
  let maxX = -Infinity;
  let minZ = Infinity;
  let maxZ = -Infinity;
  for (const gate of gates) {
    const across = math.rotate(gate.orientation, { x: 1, y: 0, z: 0 });
    const along = math.rotate(gate.orientation, { x: 0, y: 0, z: 1 });
    const w = gate.width / 2;
    const d = gate.depth / 2;
    for (const sx of [-1, 1])
      for (const sz of [-1, 1]) {
        const x = gate.position.x + sx * w * across.x + sz * d * along.x;
        const z = gate.position.z + sx * w * across.z + sz * d * along.z;
        minX = Math.min(minX, x);
        maxX = Math.max(maxX, x);
        minZ = Math.min(minZ, z);
        maxZ = Math.max(maxZ, z);
      }
  }
  return { minX, maxX, minZ, maxZ };
}

// Fixed top-down camera that frames the whole gate layout at once, for editing
// levels. It centres on the gates' XZ bounds and backs off just far enough that
// the bounds fit the padded vertical FOV (and the horizontal one, via aspect).
class TopCamera {
  readonly camera: THREE.PerspectiveCamera;

  constructor() {
    this.camera = new THREE.PerspectiveCamera(S.top.fov, 1, 0.1, S.top.far);
    // Looking straight down, so the default up (+Y) is degenerate: use -Z up so
    // the screen shows +X right and -Z up, matching a plan view of the level.
    this.camera.up.set(0, 0, -1);
  }

  resize(aspect: number): void {
    this.camera.aspect = aspect;
    this.camera.updateProjectionMatrix();
  }

  frame(gates: readonly physics.Gate[]): void {
    const bounds = gateBounds(gates);
    if (!bounds) {
      this.camera.position.set(0, S.top.far / 4, 0);
      this.camera.lookAt(0, 0, 0);
      return;
    }

    const cx = (bounds.minX + bounds.maxX) / 2;
    const cz = (bounds.minZ + bounds.maxZ) / 2;
    const halfX = (bounds.maxX - bounds.minX) / 2;
    const halfZ = (bounds.maxZ - bounds.minZ) / 2;

    // Distance at which a half-extent fills the padded half-FOV. Take the worst
    // of the two axes, so neither the width nor the depth is cropped.
    const tanV =
      Math.tan(THREE.MathUtils.degToRad(S.top.fov / 2)) * S.top.fitPadding;
    const tanH = tanV * Math.max(this.camera.aspect, 1e-3);
    const distance = Math.max(halfZ / tanV, halfX / tanH);

    this.camera.position.set(cx, distance, cz);
    this.camera.lookAt(cx, 0, cz);
  }
}

// Everything that moves with a single rider: the box, the stick, and the three
// stacked shadow layers (contact patch, box silhouette, stick silhouette).
class PogoView {
  private readonly rider: THREE.Mesh;
  private readonly stick: THREE.Mesh;
  private readonly patch: THREE.Mesh;
  private readonly patchPos: Float32Array;
  private readonly boxShadow: THREE.Mesh;
  private readonly stickShadow: THREE.Mesh;
  private readonly riderMat: THREE.MeshStandardMaterial;
  private readonly stickMat: THREE.MeshStandardMaterial;
  private readonly patchMat: THREE.MeshBasicMaterial;
  private readonly solidMat: THREE.MeshBasicMaterial;
  private readonly boxPos = new Float32Array(shadowCorners * 3);
  private readonly stickPos = new Float32Array(shadowCorners * 3);
  private readonly quat = new THREE.Quaternion();
  private readonly corner = new THREE.Vector3();
  private readonly center = new THREE.Vector3();
  private readonly half = new THREE.Vector3();
  private readonly mid = new THREE.Vector3();
  private readonly foot = new THREE.Vector3();
  private readonly hullPts: Point2[] = Array.from({ length: 8 }, () => ({
    x: 0,
    z: 0,
  }));
  private readonly skin: Skin;

  constructor(skin: Skin) {
    this.skin = skin;
    this.riderMat = new THREE.MeshStandardMaterial({
      color: skin.body,
      roughness: 0.4,
    });
    this.rider = new THREE.Mesh(
      new THREE.BoxGeometry(S.rider.size, S.rider.size, S.rider.size),
      this.riderMat,
    );
    this.stickMat = new THREE.MeshStandardMaterial({
      color: 0x9aa4ad,
      roughness: 0.6,
    });
    this.stick = new THREE.Mesh(
      new THREE.BoxGeometry(
        S.stick.width,
        physics.S.stickLength,
        S.stick.width,
      ),
      this.stickMat,
    );

    this.patchMat = new THREE.MeshBasicMaterial({
      color: skin.shadow,
      transparent: true,
      opacity: S.shadow.nearOpacity,
      depthWrite: false,
      side: THREE.DoubleSide,
      ...shadowStencil,
    });
    const seg = S.shadow.patchSegments;
    this.patchPos = new Float32Array((seg + 1) * 3);
    this.patch = new THREE.Mesh(
      makeDiscGeometry(this.patchPos, seg),
      this.patchMat,
    );
    this.patch.frustumCulled = false;
    this.patch.renderOrder = 0;

    this.solidMat = new THREE.MeshBasicMaterial({
      color: S.shadow.solidColor,
      transparent: true,
      opacity: S.shadow.solidNearOpacity,
      depthWrite: false,
      side: THREE.DoubleSide,
      ...shadowStencil,
    });
    this.boxShadow = new THREE.Mesh(
      makeSilhouetteGeometry(this.boxPos),
      this.solidMat,
    );
    this.boxShadow.frustumCulled = false;
    this.boxShadow.renderOrder = 1;
    this.stickShadow = new THREE.Mesh(
      makeSilhouetteGeometry(this.stickPos),
      this.solidMat,
    );
    this.stickShadow.frustumCulled = false;
    this.stickShadow.renderOrder = 2;
  }

  addTo(scene: THREE.Scene): void {
    scene.add(
      this.rider,
      this.stick,
      this.patch,
      this.boxShadow,
      this.stickShadow,
    );
  }

  dispose(scene: THREE.Scene): void {
    scene.remove(
      this.rider,
      this.stick,
      this.patch,
      this.boxShadow,
      this.stickShadow,
    );
    this.rider.geometry.dispose();
    this.stick.geometry.dispose();
    this.patch.geometry.dispose();
    this.boxShadow.geometry.dispose();
    this.stickShadow.geometry.dispose();
    this.riderMat.dispose();
    this.stickMat.dispose();
    this.patchMat.dispose();
    this.solidMat.dispose();
  }

  update(pogo: physics.Pogo, level: physics.Level): void {
    const { position, strain } = pogo;
    this.quat.set(
      pogo.orientation.x,
      pogo.orientation.y,
      pogo.orientation.z,
      pogo.orientation.w,
    );

    this.rider.position.set(position.x, position.y, position.z);
    this.rider.quaternion.copy(this.quat);
    this.stick.quaternion.copy(this.quat);

    const length = physics.S.stickLength - strain;
    this.stick.scale.set(1, length / physics.S.stickLength, 1);
    this.mid
      .set(0, -length / 2, 0)
      .applyQuaternion(this.quat)
      .add(this.rider.position);
    this.stick.position.copy(this.mid);
    this.foot
      .set(0, -length, 0)
      .applyQuaternion(this.quat)
      .add(this.rider.position);

    const sh = S.shadow;
    const bodyGround = physics.groundHeight(level, position.x, position.z);
    // t = 0 once the rider is stick-length above the ground (stick could hit).
    const t = THREE.MathUtils.clamp(
      (position.y - bodyGround - physics.S.stickLength) / sh.range,
      0,
      1,
    );

    // Grey box and stick silhouettes, projected straight down onto the ground:
    // the convex hull of each box's corners, so they pitch and roll with the
    // rider.
    const h = S.rider.size / 2;
    this.center.set(position.x, position.y, position.z);
    this.half.set(h, h, h);
    this.updateSilhouette(
      this.boxShadow,
      this.boxPos,
      this.center,
      this.half,
      level,
    );

    const w = S.stick.width / 2;
    this.half.set(w, length / 2, w);
    this.updateSilhouette(
      this.stickShadow,
      this.stickPos,
      this.mid,
      this.half,
      level,
    );
    this.solidMat.opacity = THREE.MathUtils.lerp(
      sh.solidNearOpacity,
      sh.solidFarOpacity,
      t,
    );

    // Coloured contact patch, on top of the silhouettes, conformed to the ground.
    this.writeDisc(
      this.patch,
      this.patchPos,
      this.foot.x,
      this.foot.z,
      THREE.MathUtils.lerp(sh.radiusNear, sh.radiusFar, t),
      level,
      sh.lift,
    );
    if (strain > 0) this.patchMat.color.copy(this.skin.body);
    else this.patchMat.color.copy(this.skin.shadow).lerp(sh.farColor, t);
    this.patchMat.opacity = THREE.MathUtils.lerp(
      sh.nearOpacity,
      sh.farOpacity,
      t,
    );
  }

  // Writes the ground silhouette of the box (the convex hull of its eight
  // projected corners) into `pos` as `shadowCorners` (x, y, z) triples, each
  // dropped onto the ground so it conforms to bumps, bowls and ramp tops.
  private updateSilhouette(
    mesh: THREE.Mesh,
    pos: Float32Array,
    center: THREE.Vector3,
    half: THREE.Vector3,
    level: physics.Level,
  ): void {
    const pts = this.hullPts;
    let n = 0;
    for (let sx = -1; sx <= 1; sx += 2)
      for (let sy = -1; sy <= 1; sy += 2)
        for (let sz = -1; sz <= 1; sz += 2) {
          this.corner
            .set(sx * half.x, sy * half.y, sz * half.z)
            .applyQuaternion(this.quat)
            .add(center);
          pts[n].x = this.corner.x;
          pts[n].z = this.corner.z;
          n++;
        }

    const hull = convexHullXZ(pts);
    const m = Math.max(hull.length, 1);
    for (let v = 0; v < shadowCorners; v++) {
      const q = hull[Math.min(v, m - 1)];
      pos[v * 3] = q.x;
      pos[v * 3 + 1] = physics.groundHeight(level, q.x, q.z) + S.shadow.lift;
      pos[v * 3 + 2] = q.z;
    }
    (
      mesh.geometry.getAttribute("position") as THREE.BufferAttribute
    ).needsUpdate = true;
  }

  // Writes a ground-hugging disc of `radius` around (cx, cz) into `pos`.
  private writeDisc(
    mesh: THREE.Mesh,
    pos: Float32Array,
    cx: number,
    cz: number,
    radius: number,
    level: physics.Level,
    lift: number,
  ): void {
    const segments = pos.length / 3 - 1;
    pos[0] = cx;
    pos[1] = physics.groundHeight(level, cx, cz) + lift;
    pos[2] = cz;
    for (let i = 0; i < segments; i++) {
      const a = (i / segments) * Math.PI * 2;
      const x = cx + Math.cos(a) * radius;
      const z = cz + Math.sin(a) * radius;
      const o = (i + 1) * 3;
      pos[o] = x;
      pos[o + 1] = physics.groundHeight(level, x, z) + lift;
      pos[o + 2] = z;
    }
    (
      mesh.geometry.getAttribute("position") as THREE.BufferAttribute
    ).needsUpdate = true;
  }
}

// Static cones scattered across the ground. Trees that sit between the camera
// and the rider fade out so they never block the view; the rest stay opaque.
class TreeField {
  private readonly geometry: THREE.ConeGeometry;
  private readonly opaqueMat: THREE.MeshStandardMaterial;
  private readonly ghostMat: THREE.MeshStandardMaterial;
  private readonly matrices: THREE.Matrix4[] = [];
  private readonly pos = new THREE.Vector3();
  private readonly scale = new THREE.Vector3();
  private readonly quat = new THREE.Quaternion();
  private opaque: THREE.InstancedMesh | null = null;
  private ghost: THREE.InstancedMesh | null = null;
  private trees: readonly physics.Tree[] | null = null;

  constructor() {
    // Unit cone with its base at y = 0, so instances scale from the ground up.
    this.geometry = new THREE.ConeGeometry(1, 1, S.tree.segments);
    this.geometry.translate(0, 0.5, 0);
    const base = { color: S.tree.color, roughness: 0.9, flatShading: true };
    this.opaqueMat = new THREE.MeshStandardMaterial(base);
    this.ghostMat = new THREE.MeshStandardMaterial({
      ...base,
      transparent: true,
      opacity: S.tree.ghostOpacity,
      depthWrite: false,
    });
  }

  sync(scene: THREE.Scene, trees: readonly physics.Tree[]): void {
    if (this.opaque && this.trees === trees) return;
    if (this.opaque && this.ghost) {
      scene.remove(this.opaque, this.ghost);
      this.opaque.dispose();
      this.ghost.dispose();
    }

    const n = trees.length;
    this.opaque = new THREE.InstancedMesh(this.geometry, this.opaqueMat, n);
    this.ghost = new THREE.InstancedMesh(this.geometry, this.ghostMat, n);
    this.opaque.frustumCulled = false;
    this.ghost.frustumCulled = false;
    this.ghost.renderOrder = 10; // after the ground shadow layers

    this.matrices.length = 0;
    for (let i = 0; i < n; i++) {
      const tree = trees[i];
      this.pos.set(tree.position.x, tree.position.y, tree.position.z);
      this.scale.set(tree.radius, tree.height, tree.radius);
      this.matrices.push(
        new THREE.Matrix4().compose(this.pos, this.quat, this.scale),
      );
    }

    this.trees = trees;
    scene.add(this.opaque, this.ghost);
  }

  // Splits the trees into opaque and translucent by whether each one blocks the
  // camera -> rider sightline.
  update(
    camera: { x: number; z: number },
    focus: { x: number; z: number },
  ): void {
    const trees = this.trees;
    if (!this.opaque || !this.ghost || !trees) return;
    let opaque = 0;
    let ghost = 0;
    for (let i = 0; i < trees.length; i++) {
      const matrix = this.matrices[i];
      if (occludes(trees[i], camera, focus))
        this.ghost.setMatrixAt(ghost++, matrix);
      else this.opaque.setMatrixAt(opaque++, matrix);
    }
    this.opaque.count = opaque;
    this.ghost.count = ghost;
    this.opaque.instanceMatrix.needsUpdate = true;
    this.ghost.instanceMatrix.needsUpdate = true;
  }
}

// Whether an infinite cylinder of the tree's radius blocks the camera -> rider
// sightline: nearest approach of the segment (in XZ) to the tree axis.
function occludes(
  tree: physics.Tree,
  camera: { x: number; z: number },
  focus: { x: number; z: number },
): boolean {
  const dx = focus.x - camera.x;
  const dz = focus.z - camera.z;
  const len2 = dx * dx + dz * dz;
  const t =
    len2 > 1e-9
      ? THREE.MathUtils.clamp(
          ((tree.position.x - camera.x) * dx +
            (tree.position.z - camera.z) * dz) /
            len2,
          0,
          1,
        )
      : 0;
  const cx = camera.x + dx * t;
  const cz = camera.z + dz * t;
  return Math.hypot(tree.position.x - cx, tree.position.z - cz) <= tree.radius;
}

// A ramp's solid: a trapezoid cross-section (the rise, the optional flat top,
// and the two vertical edges) extruded across the ramp's width. Built in local
// Z-Y, then turned so local +Z runs up the ramp and local X spans it.
function rampGeometry(ramp: physics.Ramp): THREE.BufferGeometry {
  const half = (ramp.length + ramp.flat) / 2;
  const shape = new THREE.Shape();
  shape.moveTo(-half, 0);
  shape.lineTo(half - ramp.flat, ramp.height);
  shape.lineTo(half, ramp.height);
  shape.lineTo(half, 0);
  shape.closePath();

  const geo = new THREE.ExtrudeGeometry(shape, {
    depth: ramp.width,
    bevelEnabled: false,
  });
  geo.translate(0, 0, -ramp.width / 2); // extrudes forward; centre the width
  geo.rotateY(-Math.PI / 2); // shape X runs up-slope, extrusion spans the width
  return geo;
}

// Static ramps. They share one material, so only the geometry varies.
class RampField {
  private readonly material: THREE.MeshStandardMaterial;
  private readonly group = new THREE.Group();
  private readonly geoms: THREE.BufferGeometry[] = [];
  private ramps: readonly physics.Ramp[] | null = null;

  constructor() {
    this.material = new THREE.MeshStandardMaterial({
      color: S.ramp.color,
      roughness: 0.9,
      flatShading: true,
    });
  }

  sync(scene: THREE.Scene, ramps: readonly physics.Ramp[]): void {
    if (this.ramps === ramps) return;
    for (const geo of this.geoms) geo.dispose();
    this.geoms.length = 0;
    this.group.clear();

    for (const ramp of ramps) {
      const geo = rampGeometry(ramp);
      const mesh = new THREE.Mesh(geo, this.material);
      mesh.position.set(ramp.position.x, ramp.position.y, ramp.position.z);
      mesh.quaternion.set(
        ramp.orientation.x,
        ramp.orientation.y,
        ramp.orientation.z,
        ramp.orientation.w,
      );
      this.geoms.push(geo);
      this.group.add(mesh);
    }

    this.ramps = ramps;
    if (!this.group.parent) scene.add(this.group);
  }
}

// The ground: a plane displaced by the terrain height field, so bumps and bowls
// show up as geometry.
class TerrainField {
  private readonly material: THREE.MeshStandardMaterial;
  private mesh: THREE.Mesh | null = null;
  private source: terrain.Terrain | null = null;

  constructor(maxAniso: number) {
    this.material = new THREE.MeshStandardMaterial({
      map: makeGridTexture(maxAniso),
      roughness: 1,
    });
  }

  sync(scene: THREE.Scene, source: terrain.Terrain): void {
    if (this.mesh && this.source === source) return;
    if (this.mesh) {
      scene.remove(this.mesh);
      this.mesh.geometry.dispose();
    }

    const seg = S.ground.segments;
    const geo = new THREE.PlaneGeometry(S.ground.size, S.ground.size, seg, seg);
    geo.rotateX(-Math.PI / 2);
    const pos = geo.getAttribute("position") as THREE.BufferAttribute;
    for (let i = 0; i < pos.count; i++) {
      pos.setY(i, terrain.height(source, pos.getX(i), pos.getZ(i)));
    }
    pos.needsUpdate = true;
    geo.computeVertexNormals();

    this.mesh = new THREE.Mesh(geo, this.material);
    scene.add(this.mesh);
    this.source = source;
  }
}

// A picture-frame outline in the gate's own plane (local X across, Y up, Z
// through): a rectangle with a rectangular hole, extruded to the gate's depth.
function frameGeometry(gate: physics.Gate): THREE.ExtrudeGeometry {
  const w = gate.width / 2;
  const h = gate.height / 2;
  const b = Math.min(w, h) * S.gate.border;

  const rect = (p: THREE.Path, inset: number): void => {
    const x = w - inset;
    const y = h - inset;
    p.moveTo(-x, -y);
    p.lineTo(x, -y);
    p.lineTo(x, y);
    p.lineTo(-x, y);
    p.closePath();
  };

  const shape = new THREE.Shape();
  rect(shape, 0);
  const hole = new THREE.Path();
  rect(hole, b);
  shape.holes.push(hole);

  const geo = new THREE.ExtrudeGeometry(shape, {
    depth: gate.depth,
    bevelEnabled: false,
  });
  geo.translate(0, 0, -gate.depth / 2); // extrudes forward; centre it
  return geo;
}

// The gates, each a translucent frame with a see-through middle.
// The player's next gate is green, the one after it yellow, the rest grey.
class GateField {
  private readonly group = new THREE.Group();
  private readonly mats: THREE.MeshBasicMaterial[] = [];
  private readonly geoms: THREE.BufferGeometry[] = [];
  private gates: readonly physics.Gate[] | null = null;

  sync(scene: THREE.Scene, gates: readonly physics.Gate[]): void {
    if (this.gates === gates) return;
    for (const mat of this.mats) mat.dispose();
    for (const geo of this.geoms) geo.dispose();
    this.mats.length = 0;
    this.geoms.length = 0;
    this.group.clear();

    for (const gate of gates) {
      const geo = frameGeometry(gate);
      const mat = new THREE.MeshBasicMaterial({
        color: S.gate.colors.other,
        transparent: true,
        opacity: S.gate.opacity,
        side: THREE.DoubleSide,
        depthWrite: false,
        // The frame's bottom sits on the ground plane; bias it toward the camera
        // so those coplanar fragments don't z-fight with the floor.
        polygonOffset: true,
        polygonOffsetFactor: -1,
        polygonOffsetUnits: -1,
      });
      const mesh = new THREE.Mesh(geo, mat);
      mesh.position.set(gate.position.x, gate.position.y, gate.position.z);
      mesh.quaternion.set(
        gate.orientation.x,
        gate.orientation.y,
        gate.orientation.z,
        gate.orientation.w,
      );
      this.geoms.push(geo);
      this.mats.push(mat);
      this.group.add(mesh);
    }

    this.gates = gates;
    if (!this.group.parent) scene.add(this.group);
  }

  update(next: number, lap: number, laps: number): void {
    const n = this.mats.length;
    const done = lap >= laps;
    // On the final lap the last gate is the finish; nothing follows it.
    const finish = lap === laps - 1 && next === n - 1;
    const soon = done || finish ? -1 : (next + 1) % n;
    for (let i = 0; i < n; i++) {
      const color = done
        ? S.gate.colors.other
        : i === next
          ? S.gate.colors.next
          : i === soon
            ? S.gate.colors.soon
            : S.gate.colors.other;
      this.mats[i].color.setHex(color);
    }
  }
}

function formatTime(seconds: number): string {
  const minutes = Math.floor(seconds / 60);
  const rest = seconds - minutes * 60;
  return `${minutes}:${rest.toFixed(2).padStart(5, "0")}`;
}

// The DOM overlays drawn over the canvas: the race readout and the fps counter.
class Hud {
  private readonly lap = document.getElementById("hud-lap")!;
  private readonly time = document.getElementById("hud-time")!;
  private readonly fps = document.getElementById("fps")!;

  private frames = 0;
  private since = performance.now();

  update(state: physics.State): void {
    const player = state.pogos[0];
    const laps = state.level.laps;
    this.lap.textContent = `Lap ${Math.min(player.lap + 1, laps)}/${laps}`;
    this.time.textContent = formatTime(player.time);

    // Measured locally rather than from the render dt, which is clamped.
    this.frames++;
    const now = performance.now();
    const elapsed = now - this.since;
    if (elapsed >= 500) {
      this.fps.textContent = `${Math.round((this.frames * 1000) / elapsed)} fps`;
      this.frames = 0;
      this.since = now;
    }
  }
}

export type CameraMode = "chase" | "top";

export class Renderer {
  readonly renderer: THREE.WebGLRenderer;
  readonly scene = new THREE.Scene();

  private readonly chase = new ChaseCamera();
  private readonly top = new TopCamera();
  private readonly fog = new THREE.Fog(S.background, S.fog.near, S.fog.far);
  private readonly trees = new TreeField();
  private readonly gates = new GateField();
  private readonly ramps = new RampField();
  private readonly terrainField: TerrainField;
  private readonly hud = new Hud();
  private readonly views: PogoView[] = [];
  private mode: CameraMode = "chase";

  constructor(canvas: HTMLCanvasElement) {
    this.renderer = new THREE.WebGLRenderer({
      canvas,
      antialias: true,
      stencil: true,
    });

    this.scene.background = new THREE.Color(S.background);
    this.scene.fog = this.fog;
    this.scene.add(new THREE.AmbientLight(0xffffff, 1.2));
    const sun = new THREE.DirectionalLight(0xffffff, 2.5);
    sun.position.set(5, 10, 7);
    this.scene.add(sun);

    this.terrainField = new TerrainField(
      this.renderer.capabilities.getMaxAnisotropy(),
    );
  }

  get camera(): THREE.PerspectiveCamera {
    return this.mode === "top" ? this.top.camera : this.chase.camera;
  }

  get cameraMode(): CameraMode {
    return this.mode;
  }

  setCameraMode(mode: CameraMode): void {
    this.mode = mode;
    // The top camera sits too far back for the chase fog, so drop it there.
    this.scene.fog = mode === "chase" ? this.fog : null;
  }

  toggleCamera(): void {
    this.setCameraMode(this.mode === "chase" ? "top" : "chase");
  }

  resize(): void {
    const canvas = this.renderer.domElement;
    const w = canvas.clientWidth;
    const h = canvas.clientHeight;
    if (w === 0 || h === 0) return;
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.setSize(w, h, false);
    const aspect = w / h;
    this.chase.resize(aspect);
    this.top.resize(aspect);
  }

  render(state: physics.State, dt: number, cameraPitch: number): void {
    this.trees.sync(this.scene, state.level.trees);
    this.gates.sync(this.scene, state.level.gates);
    this.ramps.sync(this.scene, state.level.ramps);
    this.terrainField.sync(this.scene, state.level.terrain);
    const pogos = state.pogos;
    while (this.views.length < pogos.length) {
      const view = new PogoView(
        S.rider.colors[this.views.length % S.rider.colors.length],
      );
      view.addTo(this.scene);
      this.views.push(view);
    }
    while (this.views.length > pogos.length) {
      this.views.pop()!.dispose(this.scene);
    }

    for (let i = 0; i < pogos.length; i++)
      this.views[i].update(pogos[i], state.level);

    if (this.mode === "top") {
      // Frame the whole track from above; passing the camera as its own focus
      // keeps every tree opaque, since no sightline can be blocked from there.
      this.top.frame(state.level.gates);
      this.trees.update(this.camera.position, this.camera.position);
    } else if (pogos.length > 0) {
      const focus = pogos[0]; // pogos[0] is "us"
      this.chase.follow(focus, state.level.terrain, dt, cameraPitch);
      this.trees.update(this.camera.position, focus.position);
    }
    if (pogos.length > 0)
      this.gates.update(pogos[0].nextGate, pogos[0].lap, state.level.laps);
    this.hud.update(state);
    this.renderer.render(this.scene, this.camera);
  }
}
