// 3D rendering of the state from physics.

import * as THREE from "three";
import * as physics from "./physics";

// Top of the spawn bounce; the camera frames this whole vertical range.
const bounceTop = physics.S.stickLength + physics.S.spawnDrop;

export const S = {
  background: 0x101418, // also the fog colour, so the horizon blends in
  ground: {
    size: 2000,
    cell: 20, // world units per grid cell
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
    height: bounceTop * 0.7, // fixed camera height, so bounces don't shake the horizon
    lookY: bounceTop * 0.32,
    minDistance: bounceTop * 0.9, // closest the autorange pulls in
    maxDistance: bounceTop * 4, // farthest it pulls back (the autorange limit)
    peakWindow: 1, // seconds of height history the autorange frames
    fitPadding: 0.9, // fraction of the vertical half-FOV the framing may use
    zoomOutTime: 0.1, // seconds to pull back, as the rider climbs
    zoomInTime: 1, // seconds to ease back in, once it drops
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
    lift: 0.05, // height above the ground, so the layers don't z-fight
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
  tree: {
    color: 0x2f7d4e,
    segments: 8, // cone is low-poly, to match the toon look
    ghostOpacity: 0.25, // trees between the camera and the rider
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

  follow(pogo: physics.Pogo, dt: number): void {
    const { position, orientation } = pogo;
    this.quat.set(orientation.x, orientation.y, orientation.z, orientation.w);

    // Behind the rider's heading. Only the horizontal part of the facing
    // direction matters (pitch/roll ignored).
    this.forward.set(0, 0, 1).applyQuaternion(this.quat);
    this.forward.y = 0;
    if (this.forward.lengthSq() > 1e-6) this.forward.normalize();
    else this.forward.set(0, 0, 1);

    // Autorange: frame the highest the rider has been in the last second, so
    // successive bounces settle instead of pumping the camera as the rider
    // falls. Pull back quickly, ease back in slowly, clamp to the limit.
    const top = position.y + S.rider.size / 2;
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

    this.camera.position.set(
      position.x - this.forward.x * this.distance,
      S.camera.height,
      position.z - this.forward.z * this.distance,
    );
    this.camera.lookAt(position.x, S.camera.lookY, position.z);
  }
}

// Everything that moves with a single rider: the box, the stick, and the three
// stacked shadow layers (contact patch, box silhouette, stick silhouette).
class PogoView {
  private readonly rider: THREE.Mesh;
  private readonly stick: THREE.Mesh;
  private readonly patch: THREE.Mesh;
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
    this.patch = new THREE.Mesh(
      new THREE.CircleGeometry(1, 48), // unit circle; scaled per-frame to the world radius
      this.patchMat,
    );
    this.patch.rotation.x = -Math.PI / 2;
    this.patch.position.y = physics.S.groundY + S.shadow.lift;
    this.patch.renderOrder = 0;

    this.solidMat = new THREE.MeshBasicMaterial({
      color: S.shadow.solidColor,
      transparent: true,
      opacity: S.shadow.solidNearOpacity,
      depthWrite: false,
      side: THREE.DoubleSide,
      ...shadowStencil,
    });
    const shadowY = physics.S.groundY + S.shadow.lift * 0.5;
    this.boxShadow = new THREE.Mesh(
      makeSilhouetteGeometry(this.boxPos),
      this.solidMat,
    );
    this.boxShadow.position.y = shadowY;
    this.boxShadow.frustumCulled = false;
    this.boxShadow.renderOrder = 1;
    this.stickShadow = new THREE.Mesh(
      makeSilhouetteGeometry(this.stickPos),
      this.solidMat,
    );
    this.stickShadow.position.y = shadowY;
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

  update(pogo: physics.Pogo): void {
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
    // t = 0 once the rider is stick-length above the ground (stick could hit).
    const t = THREE.MathUtils.clamp(
      (position.y - physics.S.groundY - physics.S.stickLength) / sh.range,
      0,
      1,
    );

    // Grey box and stick silhouettes, projected straight down onto the ground:
    // the convex hull of each box's corners, so they pitch and roll with the
    // rider.
    const h = S.rider.size / 2;
    this.center.set(position.x, position.y, position.z);
    this.half.set(h, h, h);
    this.updateSilhouette(this.boxShadow, this.boxPos, this.center, this.half);

    const w = S.stick.width / 2;
    this.half.set(w, length / 2, w);
    this.updateSilhouette(this.stickShadow, this.stickPos, this.mid, this.half);
    this.solidMat.opacity = THREE.MathUtils.lerp(
      sh.solidNearOpacity,
      sh.solidFarOpacity,
      t,
    );

    // Coloured contact patch, on top of the silhouettes.
    this.patch.position.set(this.foot.x, physics.S.groundY + sh.lift, this.foot.z);
    this.patch.scale.setScalar(
      THREE.MathUtils.lerp(sh.radiusNear, sh.radiusFar, t),
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
  // projected corners) into `pos`, as `shadowCorners` (x, 0, z) triples.
  private updateSilhouette(
    mesh: THREE.Mesh,
    pos: Float32Array,
    center: THREE.Vector3,
    half: THREE.Vector3,
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
      pos[v * 3 + 1] = 0;
      pos[v * 3 + 2] = q.z;
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
      if (occludes(trees[i], camera, focus)) this.ghost.setMatrixAt(ghost++, matrix);
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
  return (
    Math.hypot(tree.position.x - cx, tree.position.z - cz) <= tree.radius
  );
}

export class Renderer {
  readonly renderer: THREE.WebGLRenderer;
  readonly camera: THREE.PerspectiveCamera;
  readonly scene = new THREE.Scene();

  private readonly chase = new ChaseCamera();
  private readonly trees = new TreeField();
  private readonly views: PogoView[] = [];

  constructor(canvas: HTMLCanvasElement) {
    this.renderer = new THREE.WebGLRenderer({
      canvas,
      antialias: true,
      stencil: true,
    });
    this.camera = this.chase.camera;

    this.scene.background = new THREE.Color(S.background);
    this.scene.fog = new THREE.Fog(S.background, S.fog.near, S.fog.far);
    this.scene.add(new THREE.AmbientLight(0xffffff, 1.2));
    const sun = new THREE.DirectionalLight(0xffffff, 2.5);
    sun.position.set(5, 10, 7);
    this.scene.add(sun);

    const ground = new THREE.Mesh(
      new THREE.PlaneGeometry(S.ground.size, S.ground.size),
      new THREE.MeshStandardMaterial({
        map: makeGridTexture(this.renderer.capabilities.getMaxAnisotropy()),
        roughness: 1,
      }),
    );
    ground.rotation.x = -Math.PI / 2;
    ground.position.y = physics.S.groundY;
    this.scene.add(ground);
  }

  resize(): void {
    const canvas = this.renderer.domElement;
    const w = canvas.clientWidth;
    const h = canvas.clientHeight;
    if (w === 0 || h === 0) return;
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.setSize(w, h, false);
    this.chase.resize(w / h);
  }

  render(state: physics.State, dt: number): void {
    this.trees.sync(this.scene, state.trees);
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

    for (let i = 0; i < pogos.length; i++) this.views[i].update(pogos[i]);

    if (pogos.length > 0) {
      const focus = pogos[0]; // pogos[0] is "us"
      this.chase.follow(focus, dt);
      this.trees.update(this.camera.position, focus.position);
    }
    this.renderer.render(this.scene, this.camera);
  }
}
