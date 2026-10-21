/**
 * First-person hand / held item rendering.
 *
 * Owns an independent `handScene` + `handCamera` so it never interferes with
 * the world camera. Lead wires it up like this:
 *
 *   const atlas = new TextureAtlas(renderer.maxAnisotropy);
 *   const firstPerson = new FirstPersonHand(atlas, { baseFov: 70 });
 *   // whenever the selected slot changes:
 *   firstPerson.setItem(player.selectedStack());
 *   // when interaction starts/ends (callbacks from InteractionController):
 *   firstPerson.swing('attack');  // or 'place'
 *   firstPerson.triggerEat();
 *   // per frame, after the world render (renderer.render()):
 *   firstPerson.update(dt, player.animationState());
 *   firstPerson.render(renderer.webgl, renderer.camera);
 *   // optional: firstPerson.setDaylight(world.time().daylight);
 *
 * The block cube uses the atlas layer of each face (via blocks.faceTexture),
 * matching the chunk vertex format (UV p0(0,0)..p3(0,1), shader flips V).
 * Non-block items use either an optional item texture-array layer resolver
 * (`itemLayerOf` + `itemTexture`, once Art-E/Lead provide item icons) or a
 * simple colored placeholder quad.
 */

import * as THREE from 'three';
import type { Slot } from '../core/types';
import { blockNumeric, faceTexture, getBlockDef, type BlockDef } from '../world/blocks';
import { getItem, type ItemDef } from '../world/items';
import type { TextureAtlas } from './atlas';
import { createArmModel, createHeldFist, type ArmModel } from './armModel';
import { HeldItemGeometryCache, heldCategory, type HeldCategory } from './heldItem';

export type HandSwingKind = 'attack' | 'place';

export interface FirstPersonState {
  moving?: boolean;
  sprinting?: boolean;
  sneaking?: boolean;
  onGround?: boolean;
  inWater?: boolean;
  horizontalSpeed?: number;
}

export interface FirstPersonHandOptions {
  /** Optional texture array that contains item icons (Art-E item atlas). */
  itemTexture?: THREE.DataArrayTexture | null;
  /** Resolve an item id to its layer in `itemTexture`. */
  itemLayerOf?: ((itemId: string) => number) | null;
  /** Persistent hand camera FOV (matched to the world camera each frame). */
  baseFov?: number;
}

type Vec3Tuple = [number, number, number];

/** Which mesh kind is currently held (diagnostics for Lead's E2E). */
export type HandItemKind = 'none' | 'block' | 'sprite' | 'fallback';

export interface HandPose {
  position: Vec3Tuple;
  rotation: Vec3Tuple;
}

/**
 * Hand poses in the hand camera's view space (camera at origin looking -Z).
 * Tuned MC-style: bottom-right, block ≈25% screen height, icons readable and
 * nearly camera-facing, bare arm slimmer and lower. Exported so visual tuning
 * does not need to touch the animation code.
 */
export const HAND_POSES: Readonly<Record<'block' | 'sprite' | 'arm', HandPose>> = {
  block: {
    position: [0.52, -0.33, -0.8],
    rotation: [0.2, -0.55, 0.05],
  },
  sprite: {
    position: [0.52, -0.34, -0.75],
    rotation: [0.05, -0.18, 0.1],
  },
  arm: {
    position: [0.52, -0.5, -1.05],
    rotation: [0.35, 0.25, -0.5],
  },
};

/** Held-item hand pose per item category (V4 3D rig). */
export const HELD_POSES: Readonly<Record<HeldCategory, HandPose>> = {
  block: {
    position: [0.54, -0.35, -0.82],
    rotation: [0.18, -0.42, 0.05],
  },
  tool: {
    position: [0.5, -0.34, -0.78],
    rotation: [0.08, -0.34, 0.16],
  },
  weapon: {
    position: [0.5, -0.34, -0.78],
    rotation: [0.04, -0.3, 0.24],
  },
  food: {
    position: [0.47, -0.36, -0.74],
    rotation: [0.08, -0.26, 0.12],
  },
  material: {
    position: [0.5, -0.34, -0.78],
    rotation: [0.06, -0.32, 0.14],
  },
  other: {
    position: [0.5, -0.34, -0.78],
    rotation: [0.06, -0.32, 0.14],
  },
};

/** Initial tilt of the 3D item itself, so the extruded side is always visible. */
const HELD_ITEM_ROTATIONS: Readonly<Record<HeldCategory, Vec3Tuple>> = {
  block: [-0.12, -0.62, 0.06],
  tool: [-0.04, -0.34, 0.12],
  weapon: [-0.04, -0.28, 0.38],
  food: [-0.06, -0.34, 0.12],
  material: [-0.04, -0.38, 0.12],
  other: [-0.04, -0.38, 0.12],
};

/** Held-item world scale: block ≈25% screen height, sprite icons ≈23%. */
export const HAND_SCALES: Readonly<Record<'block' | 'sprite' | 'fallback', number>> = {
  block: 0.16,
  sprite: 0.24,
  fallback: 1,
};


interface FaceAxes {
  normal: Vec3Tuple;
  u: Vec3Tuple;
  v: Vec3Tuple;
}

/**
 * Face order matches `src/world/blocks.ts` FACE_DIRS: +X -X +Y -Y +Z -Z.
 * `u × v = normal` guarantees counter-clockwise (front-facing) quads.
 */
const CUBE_FACES: readonly FaceAxes[] = [
  { normal: [1, 0, 0], u: [0, 0, -1], v: [0, 1, 0] },
  { normal: [-1, 0, 0], u: [0, 0, 1], v: [0, 1, 0] },
  { normal: [0, 1, 0], u: [1, 0, 0], v: [0, 0, -1] },
  { normal: [0, -1, 0], u: [1, 0, 0], v: [0, 0, 1] },
  { normal: [0, 0, 1], u: [1, 0, 0], v: [0, 1, 0] },
  { normal: [0, 0, -1], u: [-1, 0, 0], v: [0, 1, 0] },
];

const HAND_VERTEX_SHADER = /* glsl */ `
attribute vec2 aUv;
attribute float aLayer;
attribute vec3 aTint;

varying vec2 vUv;
varying float vLayer;
varying vec3 vTint;

void main() {
  vUv = aUv;
  vLayer = aLayer;
  vTint = aTint;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`;

const HAND_FRAGMENT_SHADER = /* glsl */ `
precision highp float;
precision highp sampler2DArray;

uniform sampler2DArray uAtlas;
uniform float uLight;
uniform float uAlphaTest;

varying vec2 vUv;
varying float vLayer;
varying vec3 vTint;

void main() {
  vec4 texel = texture(uAtlas, vec3(vUv.x, 1.0 - vUv.y, vLayer));
  if (texel.a < uAlphaTest) discard;
  gl_FragColor = vec4(texel.rgb * vTint * uLight, texel.a);
}
`;

export interface BlockGeometryResult {
  geometry: THREE.BufferGeometry;
  /** Atlas layer per cube face, in +X -X +Y -Y +Z -Z order. */
  layers: number[];
}

/** Tint applied to grass/foliage blocks so they match the world palette. */
export function tintForBlock(block: BlockDef): Vec3Tuple {
  if (block.tint === 'grass') return [0.62, 0.82, 0.45];
  if (block.tint === 'foliage') return [0.5, 0.74, 0.36];
  if (block.tint === 'water') return [0.62, 0.78, 1];
  return [1, 1, 1];
}

function pushFace(
  positions: number[],
  uvs: number[],
  layers: number[],
  tints: number[],
  indices: number[],
  face: FaceAxes,
  layer: number,
  tint: Vec3Tuple,
  vertexOffset: number,
): void {
  const half = 0.5;
  const center: Vec3Tuple = [face.normal[0] * half, face.normal[1] * half, face.normal[2] * half];
  const corners: Vec3Tuple[] = [
    [
      center[0] - face.u[0] * half - face.v[0] * half,
      center[1] - face.u[1] * half - face.v[1] * half,
      center[2] - face.u[2] * half - face.v[2] * half,
    ],
    [
      center[0] + face.u[0] * half - face.v[0] * half,
      center[1] + face.u[1] * half - face.v[1] * half,
      center[2] + face.u[2] * half - face.v[2] * half,
    ],
    [
      center[0] + face.u[0] * half + face.v[0] * half,
      center[1] + face.u[1] * half + face.v[1] * half,
      center[2] + face.u[2] * half + face.v[2] * half,
    ],
    [
      center[0] - face.u[0] * half + face.v[0] * half,
      center[1] - face.u[1] * half + face.v[1] * half,
      center[2] - face.u[2] * half + face.v[2] * half,
    ],
  ];
  const faceUvs: [number, number][] = [
    [0, 0],
    [1, 0],
    [1, 1],
    [0, 1],
  ];
  for (let i = 0; i < 4; i++) {
    const corner = corners[i];
    positions.push(corner[0], corner[1], corner[2]);
    uvs.push(faceUvs[i][0], faceUvs[i][1]);
    layers.push(layer);
    tints.push(tint[0], tint[1], tint[2]);
  }
  indices.push(vertexOffset, vertexOffset + 1, vertexOffset + 2);
  indices.push(vertexOffset, vertexOffset + 2, vertexOffset + 3);
}

/** Per-face brightness for held blocks so a cube never reads as a flat card. */
export const BLOCK_FACE_SHADE: readonly [number, number, number, number, number, number] = [
  0.74, 0.66, 1.0, 0.52, 0.88, 0.78,
];

/** Build the held-block cube geometry (unit cube centered at the origin). */
export function buildBlockGeometry(
  block: BlockDef,
  layerOf: (tile: string) => number,
  tint: Vec3Tuple = [1, 1, 1],
): BlockGeometryResult {
  const positions: number[] = [];
  const uvs: number[] = [];
  const layers: number[] = [];
  const tints: number[] = [];
  const indices: number[] = [];
  const faceLayers: number[] = [];
  for (let face = 0; face < 6; face++) {
    const layer = layerOf(faceTexture(block, face));
    faceLayers.push(layer);
    const shade = BLOCK_FACE_SHADE[face];
    const faceTint: Vec3Tuple = [tint[0] * shade, tint[1] * shade, tint[2] * shade];
    pushFace(positions, uvs, layers, tints, indices, CUBE_FACES[face], layer, faceTint, face * 4);
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute('aUv', new THREE.Float32BufferAttribute(uvs, 2));
  geometry.setAttribute('aLayer', new THREE.Float32BufferAttribute(layers, 1));
  geometry.setAttribute('aTint', new THREE.Float32BufferAttribute(tints, 3));
  geometry.setIndex(indices);
  geometry.computeBoundingSphere();
  return { geometry, layers: faceLayers };
}

/** Build a flat quad (item icon) geometry centred at the origin, facing +Z. */
export function buildSpriteGeometry(layer: number, tint: Vec3Tuple = [1, 1, 1]): THREE.BufferGeometry {
  const geometry = new THREE.BufferGeometry();
  const positions = new Float32Array([
    -0.5, -0.5, 0,
    0.5, -0.5, 0,
    0.5, 0.5, 0,
    -0.5, 0.5, 0,
  ]);
  const uvs = new Float32Array([0, 0, 1, 0, 1, 1, 0, 1]);
  const layers = new Float32Array([layer, layer, layer, layer]);
  const tints = new Float32Array([tint[0], tint[1], tint[2], tint[0], tint[1], tint[2], tint[0], tint[1], tint[2], tint[0], tint[1], tint[2]]);
  const indices = new Uint16Array([0, 1, 2, 0, 2, 3]);
  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geometry.setAttribute('aUv', new THREE.BufferAttribute(uvs, 2));
  geometry.setAttribute('aLayer', new THREE.BufferAttribute(layers, 1));
  geometry.setAttribute('aTint', new THREE.BufferAttribute(tints, 3));
  geometry.setIndex(new THREE.BufferAttribute(indices, 1));
  geometry.computeBoundingSphere();
  return geometry;
}

function fallbackItemColor(item: ItemDef | null): number {
  if (!item) return 0x9a9a9a;
  switch (item.kind) {
    case 'food':
      return 0xb45a2e;
    case 'tool':
      return 0x9aa4b0;
    case 'weapon':
      return 0x8a7448;
    case 'armor':
      return 0x8fa0b8;
    case 'material':
      return 0xb8a47c;
    case 'block':
      return 0x8c8c8c;
    default:
      return 0xd8d8d8;
  }
}

function createHandMaterial(texture: THREE.DataArrayTexture): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    uniforms: {
      uAtlas: { value: texture },
      uLight: { value: 1 },
      uAlphaTest: { value: 0.5 },
    },
    vertexShader: HAND_VERTEX_SHADER,
    fragmentShader: HAND_FRAGMENT_SHADER,
    side: THREE.DoubleSide,
  });
}

/** First-person hand scene + animation state. */
export class FirstPersonHand {
  readonly scene = new THREE.Scene();
  readonly camera: THREE.PerspectiveCamera;

  private readonly atlas: TextureAtlas;
  private readonly blockMaterial: THREE.ShaderMaterial;
  private readonly spriteMaterial: THREE.ShaderMaterial | null;
  private readonly fallbackMaterial: THREE.MeshBasicMaterial;
  private readonly handRoot = new THREE.Group();
  private readonly arm: THREE.Group;
  private readonly armModel: ArmModel;
  private readonly itemCache = new HeldItemGeometryCache();
  private itemRoot: THREE.Group | null = null;
  private itemMesh: THREE.Mesh | null = null;
  private itemFist: THREE.Group | null = null;
  private itemGeometryOwned = false;

  private currentItemId: string | null = null;
  private currentItemKind: HandItemKind = 'none';
  private currentCategory: HeldCategory | null = null;
  private equipProgress = 1;
  private swingTime = 1;
  private swingKind: HandSwingKind = 'attack';
  private eatTime = 1;
  private bobPhase = 0;
  private bobAmount = 0;
  private idleTime = 0;
  private light = 1;
  private readonly baseFov: number;
  private itemLayerOf: ((itemId: string) => number) | null = null;

  constructor(atlas: TextureAtlas, options: FirstPersonHandOptions = {}) {
    this.atlas = atlas;
    this.baseFov = options.baseFov ?? 70;
    this.camera = new THREE.PerspectiveCamera(this.baseFov, 1, 0.01, 10);
    this.blockMaterial = createHandMaterial(atlas.texture);
    this.spriteMaterial = options.itemTexture && options.itemLayerOf
      ? createHandMaterial(options.itemTexture)
      : null;
    if (this.spriteMaterial && options.itemLayerOf) this.itemLayerOf = options.itemLayerOf;
    this.fallbackMaterial = new THREE.MeshBasicMaterial({ color: 0x9a9a9a });

    // Empty-hand arm: tapered forearm, textured skin, sleeve/cuff and a fist.
    this.armModel = createArmModel();
    this.arm = this.armModel.group;
    this.arm.scale.setScalar(1);
    this.handRoot.add(this.arm);

    this.scene.add(this.handRoot);
    this.setItem(null);
  }

  /** Update the held item (call when the selected hotbar slot/content changes). */
  setItem(stack: Slot | null): void {
    const itemId = stack?.item ?? null;
    if (itemId === this.currentItemId) return;
    this.currentItemId = itemId;
    this.rebuildItem();
    this.equipProgress = 0;
  }

  private clearItem(): void {
    if (!this.itemRoot) return;
    this.handRoot.remove(this.itemRoot);
    if (this.itemFist) {
      const geometries = new Set<THREE.BufferGeometry>();
      this.itemFist.traverse((object) => {
        if (object instanceof THREE.Mesh) geometries.add(object.geometry);
      });
      for (const geometry of geometries) geometry.dispose();
      this.itemFist = null;
    }
    if (this.itemGeometryOwned && this.itemMesh) this.itemMesh.geometry.dispose();
    this.itemRoot = null;
    this.itemMesh = null;
    this.itemGeometryOwned = false;
  }

  private rebuildItem(): void {
    this.clearItem();
    this.currentItemKind = 'none';
    this.currentCategory = null;
    const itemId = this.currentItemId;
    if (!itemId) {
      this.arm.visible = true;
      return;
    }
    this.arm.visible = false;
    const item = getItem(itemId) ?? null;
    const category = heldCategory(itemId);

    let geometry: THREE.BufferGeometry | null = null;
    let material: THREE.Material = this.fallbackMaterial;
    let scale = 1;
    let grip: Vec3Tuple = [0, 0, 0];
    let kind: HandItemKind = 'fallback';
    let owned = true;

    if (item?.block) {
      const block = getBlockDef(blockNumeric(item.block));
      geometry = buildBlockGeometry(block, (tile) => this.atlas.layerOf(tile), tintForBlock(block)).geometry;
      material = this.blockMaterial;
      scale = HAND_SCALES.block;
      grip = [0.24, -0.28, 0.18];
      kind = 'block';
    } else if (this.spriteMaterial && this.itemLayerOf) {
      const extruded = this.itemCache.get(itemId, this.itemLayerOf(itemId));
      if (extruded) {
        geometry = extruded.geometry;
        grip = extruded.grip;
        scale = HAND_SCALES.sprite;
        material = this.spriteMaterial;
        kind = 'sprite';
        owned = false;
      }
    }

    if (!geometry) {
      this.fallbackMaterial.color.setHex(fallbackItemColor(item));
      geometry = new THREE.PlaneGeometry(0.21, 0.28);
      material = this.fallbackMaterial;
      kind = 'fallback';
      grip = [0, 0, 0];
      owned = true;
    }

    this.itemGeometryOwned = owned;
    const root = new THREE.Group();
    root.rotation.set(...HELD_ITEM_ROTATIONS[category]);
    const itemMesh = new THREE.Mesh(geometry, material);
    itemMesh.scale.setScalar(scale);
    itemMesh.position.set(-grip[0] * scale, -grip[1] * scale, -grip[2] * scale);
    root.add(itemMesh);

    // A visible fist around the grip point sells the 3D hold.
    const fist = createHeldFist(this.armModel.materials.arm, category === 'block' ? 0.78 : 0.62);
    fist.position.set(0, -0.015, 0.03);
    fist.rotation.set(0.22, -0.3, 0.16);
    root.add(fist);

    this.handRoot.add(root);
    this.itemRoot = root;
    this.itemMesh = itemMesh;
    this.itemFist = fist;
    this.currentItemKind = kind;
    this.currentCategory = category;
  }

  /** Start a swing animation. */
  swing(kind: HandSwingKind = 'attack'): void {
    this.swingTime = 0;
    this.swingKind = kind;
  }

  /** Play a short eating animation (call when an item is consumed). */
  triggerEat(): void {
    this.eatTime = 0;
  }

  /** Match the world's daylight so the hand is lit consistently. */
  setDaylight(daylight: number): void {
    // Keep the hand readable at night instead of going almost black.
    this.light = Math.max(0.38, Math.min(1.2, daylight));
    this.blockMaterial.uniforms.uLight.value = this.light;
    if (this.spriteMaterial) this.spriteMaterial.uniforms.uLight.value = this.light;
    this.armModel.materials.setLight(this.light);
  }

  get heldItemId(): string | null {
    return this.currentItemId;
  }

  /** Which rendering branch the current item uses (diagnostics / E2E). */
  get heldItemKind(): HandItemKind {
    return this.currentItemKind;
  }

  /** Animate the hand. Call once per rendered frame. */
  update(dtSeconds: number, state: FirstPersonState = {}): void {
    const dt = Math.min(0.1, Math.max(0, dtSeconds));
    this.idleTime += dt;
    this.equipProgress = Math.min(1, this.equipProgress + dt * 6);
    this.swingTime = Math.min(1, this.swingTime + dt / (this.swingKind === 'attack' ? 0.3 : 0.35));
    this.eatTime = Math.min(1, this.eatTime + dt / 0.5);

    const speed = state.horizontalSpeed ?? (state.moving ? 4.3 : 0);
    const moving = speed > 0.15;
    const targetBob = moving && state.onGround !== false ? 1 : 0.18;
    this.bobAmount += (targetBob - this.bobAmount) * Math.min(1, dt * 8);
    const bobRate = state.sprinting ? 12 : 8;
    this.bobPhase += dt * bobRate * (moving ? 1 : 0.35);

    const swing = this.swingTime < 1 ? Math.sin(this.swingTime * Math.PI) : 0;
    const equip = 1 - Math.pow(1 - this.equipProgress, 3);
    const eat = this.eatTime < 1 ? Math.sin(this.eatTime * Math.PI) : 0;
    const hasItem = this.currentItemKind !== 'none';
    const pose = hasItem ? HELD_POSES[this.currentCategory ?? 'other'] : HAND_POSES.arm;

    let x = pose.position[0];
    let y = pose.position[1];
    let z = pose.position[2];
    let rx = pose.rotation[0];
    let ry = pose.rotation[1];
    let rz = pose.rotation[2];

    // Walk bob (subtle: held items should not wobble into the crosshair).
    x += Math.sin(this.bobPhase) * 0.016 * this.bobAmount;
    y -= Math.abs(Math.cos(this.bobPhase)) * 0.022 * this.bobAmount;
    rz += Math.sin(this.bobPhase * 0.5) * 0.018 * this.bobAmount;

    // Equip: slide up from below the screen.
    y -= (1 - equip) * 0.55;

    // Swing arcs.
    if (this.currentItemKind === 'none') {
      // Bare hand punch: forward + down, like Minecraft's arm swing.
      rx -= swing * 1.15;
      y += swing * 0.08;
      z += swing * 0.22;
    } else if (this.currentItemKind === 'block') {
      rx -= swing * 0.7;
      ry += swing * 0.32;
      rz += swing * 0.16;
      y += swing * 0.1;
      z += swing * 0.12;
    } else {
      // Items stay readable during the swing: smaller rotation, more motion.
      rx -= swing * 0.55;
      ry += swing * 0.2;
      rz += swing * 0.24;
      y += swing * 0.08;
      z += swing * 0.1;
    }

    // Eating animation: bring the item toward the mouth.
    if (eat > 0 && hasItem) {
      x += (0.12 - x) * eat * 0.9;
      y += (-0.14 - y) * eat * 0.9;
      z += (-0.48 - z) * eat * 0.7;
      rx += (-0.55 - rx) * eat;
      ry += (0.22 - ry) * eat;
    }

    // Underwater sway.
    if (state.inWater) {
      x += Math.sin(this.idleTime * 2.2) * 0.018;
      y += Math.cos(this.idleTime * 1.7) * 0.014;
      rz += Math.sin(this.idleTime * 1.9) * 0.025;
    }

    this.handRoot.position.set(x, y, z);
    this.handRoot.rotation.set(rx, ry, rz);
    this.handRoot.visible = equip > 0.01;
    this.arm.visible = !hasItem;

    // Swing the model around its grip point, not the camera origin. This keeps
    // the tool head visible instead of sweeping the whole card across the screen.
    if (this.itemRoot && this.currentCategory) {
      const base = HELD_ITEM_ROTATIONS[this.currentCategory];
      let ix = base[0];
      let iy = base[1];
      let iz = base[2];
      if (this.currentCategory === 'weapon') {
        ix -= swing * 0.8;
        iz += swing * 0.55;
      } else if (this.currentCategory === 'tool') {
        ix -= swing * 0.95;
        iy += swing * 0.18;
      } else if (this.currentCategory === 'block') {
        ix -= swing * 0.35;
        iz += swing * 0.12;
      } else {
        ix -= swing * 0.5;
        iz += swing * 0.2;
      }
      this.itemRoot.rotation.set(ix, iy, iz);
    }
  }

  /**
   * Render the hand on top of the world. Call AFTER the world is rendered;
   * temporarily disables autoClear and clears only depth so the hand is never
   * clipped by nearby geometry.
   */
  render(webgl: THREE.WebGLRenderer, mainCamera: THREE.PerspectiveCamera): void {
    this.camera.fov = mainCamera.fov;
    this.camera.aspect = mainCamera.aspect;
    this.camera.updateProjectionMatrix();
    const previousAutoClear = webgl.autoClear;
    webgl.autoClear = false;
    webgl.clearDepth();
    webgl.render(this.scene, this.camera);
    webgl.autoClear = previousAutoClear;
  }

  dispose(): void {
    this.clearItem();
    this.armModel.dispose();
    this.itemCache.dispose();
    this.blockMaterial.dispose();
    this.spriteMaterial?.dispose();
    this.fallbackMaterial.dispose();
    this.scene.clear();
  }
}
