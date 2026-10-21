import * as THREE from 'three';
import type { TextureAtlas } from './atlas';
import type { BlockHit } from '../core/types';

const OUTLINE_VERT = /* glsl */ `
void main() {
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`;

const OUTLINE_FRAG = /* glsl */ `
precision highp float;
uniform vec3 uColor;
uniform float uOpacity;
void main() {
  gl_FragColor = vec4(uColor, uOpacity);
}
`;

const CRACK_VERT = /* glsl */ `
in vec2 aUv;
out vec2 vUv;
void main() {
  vUv = aUv;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`;

const CRACK_FRAG = /* glsl */ `
precision highp float;
precision highp sampler2DArray;
uniform sampler2DArray uAtlas;
uniform float uLayer;
in vec2 vUv;
void main() {
  vec4 texel = texture(uAtlas, vec3(vUv.x, 1.0 - vUv.y, uLayer));
  if (texel.a < 0.08) discard;
  gl_FragColor = vec4(0.0, 0.0, 0.0, texel.a * 0.85);
}
`;

/**
 * Renders the block selection outline and the 10-stage breaking crack overlay.
 */
export class BlockOverlay {
  private readonly outline: THREE.LineSegments;
  private readonly crack: THREE.Mesh;
  private readonly crackMaterial: THREE.ShaderMaterial;
  private readonly crackGeometry: THREE.BufferGeometry;
  private stage = -1;
  private visible = false;

  constructor(scene: THREE.Scene, atlas: TextureAtlas) {
    const box = new THREE.BoxGeometry(1.002, 1.002, 1.002);
    const edges = new THREE.EdgesGeometry(box);
    const outlineMaterial = new THREE.ShaderMaterial({
      uniforms: {
        uColor: { value: new THREE.Color(0x000000) },
        uOpacity: { value: 0.55 },
      },
      vertexShader: OUTLINE_VERT,
      fragmentShader: OUTLINE_FRAG,
      transparent: true,
      depthWrite: false,
    });
    this.outline = new THREE.LineSegments(edges, outlineMaterial);
    this.outline.visible = false;
    this.outline.renderOrder = 3;
    scene.add(this.outline);
    box.dispose();

    this.crackGeometry = new THREE.BoxGeometry(1.004, 1.004, 1.004);
    const uv = new Float32Array((this.crackGeometry.attributes.position.count ?? 0) * 2);
    const count = this.crackGeometry.attributes.position.count;
    for (let i = 0; i < count; i += 4) {
      uv[i * 2] = 0;
      uv[i * 2 + 1] = 0;
      uv[(i + 1) * 2] = 1;
      uv[(i + 1) * 2 + 1] = 0;
      uv[(i + 2) * 2] = 1;
      uv[(i + 2) * 2 + 1] = 1;
      uv[(i + 3) * 2] = 0;
      uv[(i + 3) * 2 + 1] = 1;
    }
    this.crackGeometry.setAttribute('aUv', new THREE.BufferAttribute(uv, 2));
    this.crackMaterial = new THREE.ShaderMaterial({
      uniforms: {
        uAtlas: { value: atlas.texture },
        uLayer: { value: atlas.layerOf('crack_0') },
      },
      vertexShader: CRACK_VERT,
      fragmentShader: CRACK_FRAG,
      transparent: true,
      depthWrite: false,
    });
    this.crack = new THREE.Mesh(this.crackGeometry, this.crackMaterial);
    this.crack.visible = false;
    this.crack.renderOrder = 4;
    scene.add(this.crack);
  }

  /** `stage` -1 hides the crack overlay; 0..9 shows breaking progress. */
  setTarget(hit: BlockHit | null, stage: number, atlas: TextureAtlas): void {
    if (!hit) {
      this.outline.visible = false;
      this.crack.visible = false;
      this.visible = false;
      return;
    }
    this.visible = true;
    const x = hit.x + 0.5;
    const y = hit.y + 0.5;
    const z = hit.z + 0.5;
    this.outline.position.set(x, y, z);
    this.outline.visible = true;
    if (stage >= 0 && stage !== this.stage) {
      this.stage = stage;
      this.crackMaterial.uniforms.uLayer.value = atlas.layerOf(`crack_${Math.min(9, Math.max(0, stage))}`);
    }
    this.crack.position.set(x, y, z);
    this.crack.visible = stage >= 0;
  }

  setOutlineVisible(visible: boolean): void {
    this.outline.visible = visible && this.visible;
  }

  dispose(): void {
    this.outline.geometry.dispose();
    (this.outline.material as THREE.Material).dispose();
    this.crackGeometry.dispose();
    this.crackMaterial.dispose();
  }
}
