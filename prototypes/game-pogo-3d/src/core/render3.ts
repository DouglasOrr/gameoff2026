// Three.js 3D view: simple flat-coloured shapes with one directional light, a
// smooth chase camera behind the rider's heading, and the pogo stick that
// shortens by the spring compression to show the bounce squash.

import * as THREE from "three";
import { Pogo, worldLean, type PogoState } from "./pogo3";
import type { Block } from "./level3";

const CAM_DIST = 850; // chase camera distance behind the rider
const CAM_HEIGHT = 240; // chase camera height above the ground
const LOOK_LEAD = 80; // look slightly ahead of the rider
// Fixed altitudes (world units): the camera must not bob with the bounce.
const CAM_Y = Pogo.L + CAM_HEIGHT;
const LOOK_Y = Pogo.L + 20;

export class Render {
  readonly renderer: THREE.WebGLRenderer;
  readonly camera: THREE.PerspectiveCamera;
  readonly scene = new THREE.Scene();

  private readonly body: THREE.Mesh;
  private readonly stick: THREE.Mesh;
  private readonly shoe: THREE.Mesh;
  private readonly nose: THREE.Mesh;
  private readonly camPos = new THREE.Vector3(0, CAM_Y, -CAM_DIST);

  constructor(canvas: HTMLCanvasElement, blocks: Block[]) {
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
    this.camera = new THREE.PerspectiveCamera(55, 1, 1, 6000);
    this.scene.background = new THREE.Color(0xbcd3e6);
    this.scene.add(new THREE.AmbientLight(0xffffff, 0.75));
    const sun = new THREE.DirectionalLight(0xffffff, 1.2);
    sun.position.set(300, 600, 200);
    this.scene.add(sun);

    // Ground.
    const ground = new THREE.Mesh(
      new THREE.BoxGeometry(20000, 100, 20000),
      new THREE.MeshLambertMaterial({ color: 0x9a7f58 })
    );
    ground.position.set(0, -50, 0);
    this.scene.add(ground);

    // Obstacles.
    const wallMat = new THREE.MeshLambertMaterial({ color: 0x8f9aa5 });
    for (const b of blocks) {
      const mesh = new THREE.Mesh(new THREE.BoxGeometry(b.w, b.h, b.d), wallMat);
      mesh.position.set(b.x, b.h / 2, b.z);
      this.scene.add(mesh);
    }

    // Rider: body, stick, shoe, and a little nose so the heading is readable.
    this.stick = new THREE.Mesh(
      new THREE.CylinderGeometry(4, 4, Pogo.L, 12),
      new THREE.MeshLambertMaterial({ color: 0x3a3a3a })
    );
    this.body = new THREE.Mesh(
      new THREE.SphereGeometry(24, 20, 16),
      new THREE.MeshLambertMaterial({ color: 0x2b4a6f })
    );
    this.shoe = new THREE.Mesh(
      new THREE.SphereGeometry(11, 16, 12),
      new THREE.MeshLambertMaterial({ color: 0xe2652c })
    );
    this.nose = new THREE.Mesh(
      new THREE.BoxGeometry(10, 10, 26),
      new THREE.MeshLambertMaterial({ color: 0xf2c14e })
    );
    this.scene.add(this.stick, this.body, this.shoe, this.nose);
  }

  resize(): void {
    const w = window.innerWidth;
    const h = window.innerHeight;
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    this.renderer.setSize(w, h, true);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
  }

  update(s: PogoState, dt: number): void {
    // Stick axis foot -> rider.
    const wl = worldLean(s);
    const mag2 = wl.x * wl.x + wl.z * wl.z;
    const cosA = Math.sqrt(Math.max(0, 1 - mag2));
    const axis = new THREE.Vector3(wl.x, cosA, wl.z).normalize();

    // Visual squash: shorten the stick by the compression, lifting the shoe.
    const vis = Math.min(s.compress * 1.6, Pogo.L * 0.45);
    const len = Pogo.L - vis;
    const fpx = s.x - axis.x * len;
    const fpy = s.y - axis.y * len;
    const fpz = s.z - axis.z * len;

    this.body.position.set(s.x, s.y, s.z);
    this.stick.position.set((s.x + fpx) / 2, (s.y + fpy) / 2, (s.z + fpz) / 2);
    this.stick.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), axis);
    this.stick.scale.y = len / Pogo.L;
    this.shoe.position.set(fpx, fpy, fpz);
    this.nose.position.set(s.x + Math.sin(s.heading) * 34, s.y, s.z + Math.cos(s.heading) * 34);

    // Chase camera: smoothly follow from behind the heading at a fixed height.
    const cx = s.x - Math.sin(s.heading) * CAM_DIST;
    const cz = s.z - Math.cos(s.heading) * CAM_DIST;
    const t = Math.min(1, dt * 4);
    this.camPos.x += (cx - this.camPos.x) * t;
    this.camPos.z += (cz - this.camPos.z) * t;
    this.camPos.y = CAM_Y; // fixed: no bobbing
    this.camera.position.copy(this.camPos);
    this.camera.lookAt(
      s.x + Math.sin(s.heading) * LOOK_LEAD,
      LOOK_Y,
      s.z + Math.cos(s.heading) * LOOK_LEAD
    );
  }
}
