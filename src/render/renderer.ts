import * as THREE from 'three';

/** Thin wrapper around the WebGL renderer, scene and main camera. */
export class GameRenderer {
  readonly webgl: THREE.WebGLRenderer;
  readonly scene: THREE.Scene;
  readonly camera: THREE.PerspectiveCamera;

  constructor(canvas: HTMLCanvasElement) {
    THREE.ColorManagement.enabled = false;

    this.webgl = new THREE.WebGLRenderer({
      canvas,
      antialias: true,
      powerPreference: 'high-performance',
      alpha: false,
      stencil: false,
    });
    this.webgl.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    this.webgl.setSize(window.innerWidth, window.innerHeight, false);
    this.webgl.outputColorSpace = THREE.LinearSRGBColorSpace;
    this.webgl.toneMapping = THREE.NoToneMapping;
    this.webgl.setClearColor(0x8fbcff, 1);

    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(70, window.innerWidth / window.innerHeight, 0.05, 900);
    this.camera.rotation.order = 'YXZ';
  }

  resize(): void {
    const width = window.innerWidth;
    const height = window.innerHeight;
    this.camera.aspect = width / height;
    this.camera.updateProjectionMatrix();
    this.webgl.setSize(width, height, false);
  }

  setFov(fov: number): void {
    this.camera.fov = fov;
    this.camera.updateProjectionMatrix();
  }

  render(): void {
    this.webgl.render(this.scene, this.camera);
  }

  get maxAnisotropy(): number {
    return Math.min(8, this.webgl.capabilities.getMaxAnisotropy());
  }
}
