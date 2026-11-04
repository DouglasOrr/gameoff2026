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
    distance: bounceTop * 1.4, // behind the rider, along its facing direction
    height: bounceTop * 0.7, // fixed camera height, so bounces don't shake the horizon
    lookY: bounceTop * 0.32,
  },
  shadow: {
    radiusNear: 2.5,
    radiusFar: 1.75,
    range: 32, // height above stick-length to fade over
    nearColor: new THREE.Color(0x2563eb),
    farColor: new THREE.Color(0x0a0e12),
    nearOpacity: 0.85,
    farOpacity: 0.25,
    contactColor: new THREE.Color(0x0d9488),
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
  private readonly forward = new THREE.Vector3();

  constructor(canvas: HTMLCanvasElement) {
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
    this.camera = new THREE.PerspectiveCamera(60, 1, 0.1, 1200);
    this.camera.position.set(0, S.camera.height, S.camera.distance);
    this.camera.lookAt(0, S.camera.lookY, 0);

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

    this.rider = new THREE.Mesh(
      new THREE.BoxGeometry(4, 4, 4),
      new THREE.MeshStandardMaterial({ color: 0x4f9cf9, roughness: 0.4 }),
    );
    this.stick = new THREE.Mesh(
      new THREE.BoxGeometry(1.6, physics.S.stickLength, 1.6),
      new THREE.MeshStandardMaterial({ color: 0x9aa4ad, roughness: 0.6 }),
    );

    this.shadowMat = new THREE.MeshBasicMaterial({
      color: S.shadow.nearColor,
      transparent: true,
      opacity: S.shadow.nearOpacity,
      depthWrite: false,
      side: THREE.DoubleSide,
    });
    this.shadow = new THREE.Mesh(
      new THREE.CircleGeometry(1, 48), // unit circle; scaled per-frame to the world radius
      this.shadowMat,
    );
    this.shadow.rotation.x = -Math.PI / 2;
    this.shadow.position.y = physics.S.groundY + 0.05;

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
    const { position, orientation, strain } = st.pogo;
    this.rider.position.set(position.x, position.y, position.z);
    this.rider.quaternion.set(
      orientation.x,
      orientation.y,
      orientation.z,
      orientation.w,
    );
    this.stick.quaternion.copy(this.rider.quaternion);

    const length = physics.S.stickLength - strain;
    this.stick.scale.set(1, length / physics.S.stickLength, 1);
    this.mid
      .set(0, -length / 2, 0)
      .applyQuaternion(this.stick.quaternion)
      .add(this.rider.position);
    this.stick.position.copy(this.mid);

    // Chase camera: behind the rider's heading, at a fixed height. Only the
    // horizontal part of the facing direction matters (pitch/roll ignored).
    this.forward.set(0, 0, 1).applyQuaternion(this.stick.quaternion);
    this.forward.y = 0;
    if (this.forward.lengthSq() > 1e-6) this.forward.normalize();
    else this.forward.set(0, 0, 1);
    this.camera.position.set(
      position.x - this.forward.x * S.camera.distance,
      S.camera.height,
      position.z - this.forward.z * S.camera.distance,
    );
    this.camera.lookAt(position.x, S.camera.lookY, position.z);

    const sh = S.shadow;
    // t = 0 once the rider is stick-length above the ground (stick could hit).
    const t = THREE.MathUtils.clamp(
      (position.y - physics.S.groundY - physics.S.stickLength) / sh.range,
      0,
      1,
    );
    this.shadow.position.set(position.x, physics.S.groundY + 0.05, position.z);
    this.shadow.scale.setScalar(
      THREE.MathUtils.lerp(sh.radiusNear, sh.radiusFar, t),
    );
    if (strain > 0) {
      this.shadowMat.color.copy(sh.contactColor);
    } else {
      this.shadowMat.color.copy(sh.nearColor).lerp(sh.farColor, t);
    }
    this.shadowMat.opacity = THREE.MathUtils.lerp(
      sh.nearOpacity,
      sh.farOpacity,
      t,
    );

    this.renderer.render(this.scene, this.camera);
  }
}
