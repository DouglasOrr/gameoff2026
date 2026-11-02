// Three.js view: flat 2D orthographic camera, boxes and circles in the XY
// plane. The camera pans horizontally to follow the rider. The vertical view
// spans VIEW_H world units, so the pogo occupies a modest slice of the screen;
// the stick shortens by the spring compression to show the bounce squash.

import * as THREE from "three";
import { Pogo, type PogoState } from "./pogo";
import type { Block } from "./level";

export const VIEW_H = 1440; // world units across the screen height
const CAM_Y = 400; // vertical center of the view (ground sits lower-middle)

export class Render {
  readonly renderer: THREE.WebGLRenderer;
  readonly camera: THREE.OrthographicCamera;
  readonly scene = new THREE.Scene();

  private readonly body: THREE.Mesh;
  private readonly stick: THREE.Mesh;
  private readonly shoe: THREE.Mesh;

  constructor(canvas: HTMLCanvasElement, blocks: Block[]) {
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
    this.camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0.1, 1000);
    this.camera.position.set(0, CAM_Y, 10);
    this.camera.lookAt(0, CAM_Y, 0);
    this.scene.background = new THREE.Color(0xcfdbe8);

    const world = new THREE.Group();
    for (const b of blocks) {
      const ground = b.y < 0;
      const mesh = new THREE.Mesh(
        new THREE.BoxGeometry(b.w, b.h, 1),
        new THREE.MeshBasicMaterial({ color: ground ? 0x8a6d4b : 0x9aa7b4 })
      );
      mesh.position.set(b.x + b.w / 2, b.y + b.h / 2, 0);
      world.add(mesh);
    }
    this.scene.add(world);

    this.stick = new THREE.Mesh(
      new THREE.BoxGeometry(7, Pogo.L, 1),
      new THREE.MeshBasicMaterial({ color: 0x3a3a3a })
    );
    this.body = new THREE.Mesh(
      new THREE.CircleGeometry(24, 24),
      new THREE.MeshBasicMaterial({ color: 0x2b4a6f })
    );
    this.shoe = new THREE.Mesh(
      new THREE.CircleGeometry(11, 20),
      new THREE.MeshBasicMaterial({ color: 0xe2652c })
    );
    this.scene.add(this.stick, this.body, this.shoe);
  }

  resize(): void {
    const w = window.innerWidth;
    const h = window.innerHeight;
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    this.renderer.setSize(w, h, true);
    const aspect = w / h;
    const vw = VIEW_H * aspect;
    this.camera.left = -vw / 2;
    this.camera.right = vw / 2;
    this.camera.top = VIEW_H / 2;
    this.camera.bottom = -VIEW_H / 2;
    this.camera.updateProjectionMatrix();
  }

  update(s: PogoState, camX: number): void {
    this.camera.position.x = camX;
    this.camera.lookAt(camX, CAM_Y, 0);

    // Visual squash: shorten the stick by the spring compression (slightly
    // exaggerated so the bounce reads clearly), lifting the shoe to the ground.
    const vis = Math.min(s.compress * 1.6, Pogo.L * 0.45);
    const len = Pogo.L - vis;
    const vfx = s.x - len * Math.sin(s.theta);
    const vfy = s.y - len * Math.cos(s.theta);

    this.body.position.set(s.x, s.y, 0);
    this.stick.position.set((s.x + vfx) / 2, (s.y + vfy) / 2, 0);
    this.stick.rotation.z = -s.theta;
    this.stick.scale.y = len / Pogo.L;
    this.shoe.position.set(vfx, vfy, 0);
  }
}
