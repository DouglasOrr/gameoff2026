// 3D rendering of the state from physics.

import * as THREE from "three";
import * as physics from "./physics";

const GROUND_Y = 0;

export const S = {
  background: 0x101418, // also the fog colour, so the horizon blends in
  ground: {
    size: 20000,
    cell: 200, // world units per grid cell
    color: 0x55606b,
    lineColor: 0x707d8a,
  },
  fog: {
    near: 800,
    far: 7000,
  },
  shadow: {
    radiusNear: 50,
    radiusFar: 35,
    range: 320, // height above stick-length to fade over
    nearColor: new THREE.Color(0x2563eb),
    farColor: new THREE.Color(0x0a0e12),
    nearOpacity: 0.85,
    farOpacity: 0.25,
  },
};

function css(hex: number): string {
  return `#${hex.toString(16).padStart(6, "0")}`;
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

export class Renderer {
  readonly renderer: THREE.WebGLRenderer;
  readonly camera: THREE.PerspectiveCamera;
  readonly scene = new THREE.Scene();

  private readonly rider: THREE.Mesh;
  private readonly stick: THREE.Mesh;
  private readonly shadow: THREE.Mesh;
  private readonly shadowMat: THREE.MeshBasicMaterial;
  private readonly mid = new THREE.Vector3();

  constructor(canvas: HTMLCanvasElement) {
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
    this.camera = new THREE.PerspectiveCamera(60, 1, 1, 12000);
    this.camera.position.set(400, 300, 500);
    this.camera.lookAt(0, physics.S.restHeight, 0);

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
    ground.position.y = GROUND_Y;
    this.scene.add(ground);

    this.rider = new THREE.Mesh(
      new THREE.BoxGeometry(60, 60, 60),
      new THREE.MeshStandardMaterial({ color: 0x4f9cf9, roughness: 0.4 }),
    );
    this.stick = new THREE.Mesh(
      new THREE.BoxGeometry(16, physics.S.stickLength, 16),
      new THREE.MeshStandardMaterial({ color: 0x9aa4ad, roughness: 0.6 }),
    );

    this.shadowMat = new THREE.MeshBasicMaterial({
      color: S.shadow.nearColor,
      transparent: true,
      opacity: S.shadow.nearOpacity,
      depthWrite: false,
      side: THREE.DoubleSide,
    });
    this.shadow = new THREE.Mesh(new THREE.CircleGeometry(1, 48), this.shadowMat);
    this.shadow.rotation.x = -Math.PI / 2;
    this.shadow.position.y = GROUND_Y + 0.5;

    this.scene.add(this.rider, this.stick, this.shadow);
  }

  resize(): void {
    const canvas = this.renderer.domElement;
    const w = canvas.clientWidth;
    const h = canvas.clientHeight;
    if (w === 0 || h === 0) return;
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
  }

  render(st: physics.State): void {
    const { position, orientation } = st.pogo;
    this.rider.position.set(position.x, position.y, position.z);
    this.stick.quaternion.set(orientation.x, orientation.y, orientation.z, orientation.w);

    // Midpoint between rider and foot: half the stick's local -Y axis, rotated.
    this.mid
      .set(0, -physics.S.stickLength / 2, 0)
      .applyQuaternion(this.stick.quaternion)
      .add(this.rider.position);
    this.stick.position.copy(this.mid);

    const sh = S.shadow;
    // t = 0 once the rider is stick-length above the ground (stick could hit).
    const t = THREE.MathUtils.clamp(
      (position.y - GROUND_Y - physics.S.stickLength) / sh.range,
      0,
      1,
    );
    this.shadow.position.set(position.x, GROUND_Y + 0.5, position.z);
    this.shadow.scale.setScalar(THREE.MathUtils.lerp(sh.radiusNear, sh.radiusFar, t));
    this.shadowMat.color.copy(sh.nearColor).lerp(sh.farColor, t);
    this.shadowMat.opacity = THREE.MathUtils.lerp(sh.nearOpacity, sh.farOpacity, t);

    this.renderer.render(this.scene, this.camera);
  }
}
