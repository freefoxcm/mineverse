/**
 * EntityRenderer: builds block-style mob models from `entities/models.ts`,
 * renders dropped items and arrows, and animates walking / idling / hurt /
 * death / creeper flashes / spider legs, with a flat foot shadow per entity.
 *
 * Wiring (Lead, in game.ts):
 *   const entityRenderer = new EntityRenderer(scene, (tile) => atlas.layerOf(tile), {
 *     skins: MOB_SKINS,              // Art-E's src/art/mobSkins.ts
 *     atlasTexture: atlas.texture,   // needed for textured block drops
 *     itemTexture: itemAtlas.texture,// ItemIconAtlas: 2D sprites for non-block drops
 *     itemLayerOf: (id) => itemAtlas.layerOf(id),
 *   });
 *   // every frame, after entityManager.update(++tick, world, player, dtTicks):
 *   entityRenderer.sync(entityManager.snapshots(), camera, alpha, {
 *     daylight: time.daylight,
 *     fogColor: sky.fogColor,
 *     fogNear: near,
 *     fogFar: far,
 *   });
 *   // in the renderer resize/dispose path:
 *   entityRenderer.dispose();
 */

import * as THREE from 'three';
import { hashString } from '../core/rng';
import { PixelPainter } from '../art/pixels';
import { TILE_SIZE } from '../art/types';
import type { MobPainter } from '../art/types';
import { blockNumeric, faceTexture, getBlockDef } from '../world/blocks';
import { getItem } from '../world/items';
import { itemDropColor } from '../entities/itemEntity';
import {
  MOB_MODELS,
  MOB_TEXTURE_FALLBACK_COLORS,
  MOB_TEXTURE_NAMES,
  type MobType,
  type ModelPart,
} from '../entities/models';
import type { EntitySnapshot } from '../entities/snapshot';

export interface EntityRendererEnvironment {
  daylight: number;
  fogColor: THREE.Color | number | string;
  fogNear: number;
  fogFar: number;
}

export interface EntityRendererOptions {
  /** Art-E mob skin painters keyed by `models.ts` texture names. */
  skins?: Readonly<Record<string, MobPainter>>;
  /**
   * The terrain texture array (`TextureAtlas.texture`). Without it, block drops
   * render as flat colour cubes instead of textured mini blocks.
   */
  atlasTexture?: THREE.Texture;
  /**
   * Item sprite texture array (`ItemIconAtlas.texture`). When set together with
   * `itemLayerOf`, non-block dropped items render as camera-facing 2D sprites
   * instead of coloured mini cubes. The texture is owned by the caller: the
   * renderer never disposes it.
   */
  itemTexture?: THREE.DataArrayTexture;
  /** Resolve an item id to its layer in `itemTexture` (null = no sprite). */
  itemLayerOf?: (itemId: string) => number | null;
  /** Render foot shadows (default true). */
  shadows?: boolean;
  /** Entity groups farther than this from the camera are hidden (default 192). */
  cullDistance?: number;
}

const MOB_SHADE = [0.8, 0.8, 1.0, 0.5, 0.85, 0.85] as const;
const ITEM_SHADE = [0.78, 0.78, 1.0, 0.5, 0.9, 0.9] as const;
const Z_AXIS = new THREE.Vector3(0, 0, 1);
/** World size of a dropped-item billboard sprite. */
const ITEM_SPRITE_SIZE = 0.26;

const MOB_VERTEX = /* glsl */ `
in float aLayer;
in float aShade;
out vec2 vUv;
out float vLayer;
out float vShade;
out float vFogDepth;

void main() {
  vUv = uv;
  vLayer = aLayer;
  vShade = aShade;
  vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
  vFogDepth = -mvPosition.z;
  gl_Position = projectionMatrix * mvPosition;
}
`;

const MOB_FRAGMENT = /* glsl */ `
precision highp float;
precision highp sampler2DArray;

uniform sampler2DArray uSkins;
uniform float uDaylight;
uniform float uFogNear;
uniform float uFogFar;
uniform vec3 uFogColor;
uniform float uHurt;
uniform float uOpacity;
uniform float uFire;
uniform float uTime;

in vec2 vUv;
in float vLayer;
in float vShade;
in float vFogDepth;

void main() {
  vec4 texel = texture(uSkins, vec3(vUv.x, 1.0 - vUv.y, vLayer));
  if (texel.a < 0.5) discard;

  float light = mix(0.35, 1.0, clamp(uDaylight, 0.0, 1.0));
  vec3 color = texel.rgb * vShade * light;
  color = mix(color, vec3(1.0, 0.25, 0.25), clamp(uHurt, 0.0, 1.0) * 0.65);

  float flicker = 0.7 + 0.3 * sin(uTime * 17.0 + gl_FragCoord.x * 0.06);
  color = mix(color, vec3(1.0, 0.45, 0.08), clamp(uFire, 0.0, 1.0) * 0.55 * flicker);

  float fogFactor = smoothstep(uFogNear, uFogFar, vFogDepth);
  color = mix(color, uFogColor, fogFactor);
  gl_FragColor = vec4(color, texel.a * uOpacity);
}
`;

const ITEM_VERTEX = /* glsl */ `
in float aLayer;
in float aShade;
in vec3 aTint;
out vec2 vUv;
out float vLayer;
out float vShade;
out vec3 vTint;
out float vFogDepth;

void main() {
  vUv = uv;
  vLayer = aLayer;
  vShade = aShade;
  vTint = aTint;
  vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
  vFogDepth = -mvPosition.z;
  gl_Position = projectionMatrix * mvPosition;
}
`;

const ITEM_FRAGMENT = /* glsl */ `
precision highp float;
precision highp sampler2DArray;

uniform sampler2DArray uAtlas;
uniform float uDaylight;
uniform float uFogNear;
uniform float uFogFar;
uniform vec3 uFogColor;

in vec2 vUv;
in float vLayer;
in float vShade;
in vec3 vTint;
in float vFogDepth;

void main() {
  vec4 texel = texture(uAtlas, vec3(vUv.x, 1.0 - vUv.y, vLayer));
  if (texel.a < 0.5) discard;
  float light = mix(0.4, 1.0, clamp(uDaylight, 0.0, 1.0));
  vec3 color = texel.rgb * vTint * vShade * light;
  float fogFactor = smoothstep(uFogNear, uFogFar, vFogDepth);
  color = mix(color, uFogColor, fogFactor);
  gl_FragColor = vec4(color, 1.0);
}
`;

interface SharedUniforms {
  uDaylight: { value: number };
  uFogNear: { value: number };
  uFogFar: { value: number };
  uFogColor: { value: THREE.Color };
  uTime: { value: number };
}

interface MobPartEntry {
  def: ModelPart;
  group: THREE.Group;
}

interface MobRecord {
  kind: 'mob';
  root: THREE.Group;
  model: THREE.Group;
  parts: MobPartEntry[];
  shadow: THREE.Mesh;
  material: THREE.ShaderMaterial;
  type: MobType;
}

interface ItemRecord {
  kind: 'item';
  root: THREE.Group;
  mesh: THREE.Mesh;
  shadow: THREE.Mesh;
  itemId: string;
  bobSeed: number;
  /** True when the mesh is a camera-facing 2D billboard (non-block sprite). */
  sprite: boolean;
}

interface ArrowRecord {
  kind: 'arrow';
  root: THREE.Group;
  mesh: THREE.Mesh;
}

type RenderRecord = MobRecord | ItemRecord | ArrowRecord;

/** '#rrggbb' helper (PixelPainter only parses hex strings). */
function rgb(r: number, g: number, b: number): string {
  const value =
    (Math.max(0, Math.min(255, Math.round(r))) << 16) |
    (Math.max(0, Math.min(255, Math.round(g))) << 8) |
    Math.max(0, Math.min(255, Math.round(b)));
  return `#${value.toString(16).padStart(6, '0')}`;
}

function hexColor(value: number): string {
  return rgb((value >> 16) & 255, (value >> 8) & 255, value & 255);
}

function darker(value: number, factor: number): number {
  const r = Math.round(((value >> 16) & 255) * factor);
  const g = Math.round(((value >> 8) & 255) * factor);
  const b = Math.round((value & 255) * factor);
  return (r << 16) | (g << 8) | b;
}

function lighter(value: number, factor: number): number {
  const r = Math.min(255, Math.round(((value >> 16) & 255) * factor));
  const g = Math.min(255, Math.round(((value >> 8) & 255) * factor));
  const b = Math.min(255, Math.round((value & 255) * factor));
  return (r << 16) | (g << 8) | b;
}

/** Paint a deterministic placeholder skin when Art-E has not delivered a tile. */
export function paintFallbackMobTexture(painter: PixelPainter, texture: string): void {
  const base = MOB_TEXTURE_FALLBACK_COLORS[texture] ?? 0xbfbfbf;
  painter.fill(hexColor(base));
  painter.noiseFill(hashString(texture) ^ 0x51ed270b, [
    hexColor(darker(base, 0.86)),
    hexColor(base),
    hexColor(lighter(base, 1.12)),
  ]);
  if (texture.endsWith('_head') || texture.endsWith('_face')) {
    // Simple 2-eye face in the front-face UV region (top-left 16x16 px).
    const eye = texture.startsWith('spider') ? 0x1a0f0a : 0x101010;
    const eyeColor = rgb((eye >> 16) & 255, (eye >> 8) & 255, eye & 255);
    painter.rect(3, 5, 3, 3, eyeColor);
    painter.rect(10, 5, 3, 3, eyeColor);
    painter.rect(5, 11, 6, 2, eyeColor);
  }
}

/** Paints the default skins into a texture-array data buffer. */
function buildSkinTexture(skins: Readonly<Record<string, MobPainter>>): THREE.DataArrayTexture {
  const width = TILE_SIZE;
  const height = TILE_SIZE;
  const layerCount = MOB_TEXTURE_NAMES.length;
  const pixelCount = width * height;
  const data = new Uint8Array(pixelCount * 4 * layerCount);
  const painter = new PixelPainter(width, height);
  MOB_TEXTURE_NAMES.forEach((name, layer) => {
    painter.fill('rgba(0,0,0,0)');
    const paint = skins[name];
    if (paint) paint(painter);
    else paintFallbackMobTexture(painter, name);
    data.set(painter.data, layer * pixelCount * 4);
  });
  const texture = new THREE.DataArrayTexture(data, width, height, layerCount);
  texture.format = THREE.RGBAFormat;
  texture.type = THREE.UnsignedByteType;
  texture.magFilter = THREE.NearestFilter;
  texture.minFilter = THREE.NearestFilter;
  texture.wrapS = THREE.ClampToEdgeWrapping;
  texture.wrapT = THREE.ClampToEdgeWrapping;
  texture.colorSpace = THREE.NoColorSpace;
  texture.generateMipmaps = false;
  texture.needsUpdate = true;
  return texture;
}

/** Tiny white layer used when the Lead does not pass the terrain atlas. */
function createWhiteArrayTexture(): THREE.DataArrayTexture {
  const texture = new THREE.DataArrayTexture(new Uint8Array([255, 255, 255, 255]), 1, 1, 1);
  texture.format = THREE.RGBAFormat;
  texture.type = THREE.UnsignedByteType;
  texture.magFilter = THREE.NearestFilter;
  texture.minFilter = THREE.NearestFilter;
  texture.colorSpace = THREE.NoColorSpace;
  texture.needsUpdate = true;
  return texture;
}

interface BoxGeometryOptions {
  layerOf: (face: number) => number;
  tint?: { r: number; g: number; b: number } | null;
  shades?: readonly [number, number, number, number, number, number];
  /** UV rect (pixel coords, origin top-left) for the +Z face. */
  frontUv?: readonly [number, number, number, number];
}

/** Unit cube geometry with aLayer/aShade/aTint vertex attributes. */
function createBoxGeometry(
  size: readonly [number, number, number],
  options: BoxGeometryOptions,
): THREE.BufferGeometry {
  const geometry = new THREE.BoxGeometry(size[0], size[1], size[2]);
  const count = geometry.getAttribute('position').count;
  const layers = new Float32Array(count);
  const shades = new Float32Array(count);
  const tints = new Float32Array(count * 3);
  const shadeValues = options.shades ?? ITEM_SHADE;
  const tint = options.tint ?? { r: 1, g: 1, b: 1 };
  for (let face = 0; face < 6; face++) {
    const layer = options.layerOf(face);
    for (let v = 0; v < 4; v++) {
      const index = face * 4 + v;
      layers[index] = layer;
      shades[index] = shadeValues[face] ?? 1;
      tints[index * 3] = tint.r;
      tints[index * 3 + 1] = tint.g;
      tints[index * 3 + 2] = tint.b;
    }
  }
  geometry.setAttribute('aLayer', new THREE.BufferAttribute(layers, 1));
  geometry.setAttribute('aShade', new THREE.BufferAttribute(shades, 1));
  geometry.setAttribute('aTint', new THREE.BufferAttribute(tints, 3));

  if (options.frontUv) {
    const uv = geometry.getAttribute('uv') as THREE.BufferAttribute;
    const [u0, v0, u1, v1] = options.frontUv;
    const s = TILE_SIZE;
    const frontVertices = 16; // +Z is the 5th BoxGeometry group
    const rects: Array<[number, number]> = [
      [u0 / s, 1 - v0 / s], // top-left
      [u1 / s, 1 - v0 / s], // top-right
      [u0 / s, 1 - v1 / s], // bottom-left
      [u1 / s, 1 - v1 / s], // bottom-right
    ];
    for (let v = 0; v < 4; v++) {
      uv.setXY(frontVertices + v, rects[v][0], rects[v][1]);
    }
    uv.needsUpdate = true;
  }
  return geometry;
}

/** Shortest signed angle difference wrapped to [-PI, PI]. */
function wrapAngle(angle: number): number {
  let value = angle % (Math.PI * 2);
  if (value > Math.PI) value -= Math.PI * 2;
  if (value < -Math.PI) value += Math.PI * 2;
  return value;
}

/**
 * Camera-facing quad for a 2D item icon. Uses the same ITEM shader as the mini
 * blocks (aLayer selects the sprite layer in the item texture array, aShade and
 * aTint stay 1 so the icon renders at full brightness).
 */
function createSpriteGeometry(layer: number): THREE.BufferGeometry {
  const geometry = new THREE.PlaneGeometry(ITEM_SPRITE_SIZE, ITEM_SPRITE_SIZE);
  const count = geometry.getAttribute('position').count;
  const layers = new Float32Array(count).fill(layer);
  const shades = new Float32Array(count).fill(1);
  const tints = new Float32Array(count * 3).fill(1);
  geometry.setAttribute('aLayer', new THREE.BufferAttribute(layers, 1));
  geometry.setAttribute('aShade', new THREE.BufferAttribute(shades, 1));
  geometry.setAttribute('aTint', new THREE.BufferAttribute(tints, 3));
  return geometry;
}

export class EntityRenderer {
  readonly root = new THREE.Group();
  private readonly records = new Map<number, RenderRecord>();
  private readonly scene: THREE.Scene;
  private readonly atlasLayerOf: (tile: string) => number;
  private readonly itemSpriteLayerOf: ((itemId: string) => number | null) | null;
  private readonly cullDistance: number;
  private readonly shadowsEnabled: boolean;

  private readonly shared: SharedUniforms;
  private readonly skinTexture: THREE.DataArrayTexture;
  private readonly atlasTexture: THREE.Texture;
  private readonly ownsAtlasTexture: boolean;
  private readonly mobMaterialTemplateUniforms: Record<string, THREE.IUniform>;
  private readonly itemMaterial: THREE.ShaderMaterial;
  /** Material for non-block item sprites (null when no itemTexture was given). */
  private readonly itemSpriteMaterial: THREE.ShaderMaterial | null;
  private readonly shadowGeometry: THREE.CircleGeometry;
  private readonly shadowMaterial: THREE.MeshBasicMaterial;
  private readonly mobGeometries = new Map<string, THREE.BufferGeometry>();
  private readonly itemGeometries = new Map<string, THREE.BufferGeometry>();
  private readonly itemSpriteGeometries = new Map<number, THREE.BufferGeometry>();
  private readonly skinLayers = new Map<string, number>();
  private readonly mobMaterials = new Set<THREE.ShaderMaterial>();

  constructor(
    scene: THREE.Scene,
    atlasLayerOf: (tile: string) => number,
    options: EntityRendererOptions = {},
  ) {
    this.scene = scene;
    this.atlasLayerOf = atlasLayerOf;
    this.cullDistance = options.cullDistance ?? 192;
    this.shadowsEnabled = options.shadows ?? true;

    this.skinTexture = buildSkinTexture(options.skins ?? {});
    MOB_TEXTURE_NAMES.forEach((name, index) => this.skinLayers.set(name, index));
    this.atlasTexture = options.atlasTexture ?? createWhiteArrayTexture();
    this.ownsAtlasTexture = !options.atlasTexture;

    this.shared = {
      uDaylight: { value: 1 },
      uFogNear: { value: 120 },
      uFogFar: { value: 128 },
      uFogColor: { value: new THREE.Color(0x9fc4ff) },
      uTime: { value: 0 },
    };

    this.mobMaterialTemplateUniforms = {
      uSkins: { value: this.skinTexture },
      ...this.shared,
    };

    this.itemMaterial = new THREE.ShaderMaterial({
      uniforms: {
        uAtlas: { value: this.atlasTexture },
        uDaylight: this.shared.uDaylight,
        uFogNear: this.shared.uFogNear,
        uFogFar: this.shared.uFogFar,
        uFogColor: this.shared.uFogColor,
      },
      vertexShader: ITEM_VERTEX,
      fragmentShader: ITEM_FRAGMENT,
    });

    // Non-block drops: dedicated item-icon texture array + alpha-tested
    // billboard material. The texture belongs to the caller (ItemIconAtlas).
    if (options.itemTexture && options.itemLayerOf) {
      this.itemSpriteLayerOf = options.itemLayerOf;
      this.itemSpriteMaterial = new THREE.ShaderMaterial({
        uniforms: {
          uAtlas: { value: options.itemTexture },
          uDaylight: this.shared.uDaylight,
          uFogNear: this.shared.uFogNear,
          uFogFar: this.shared.uFogFar,
          uFogColor: this.shared.uFogColor,
        },
        vertexShader: ITEM_VERTEX,
        fragmentShader: ITEM_FRAGMENT,
        transparent: true,
        depthWrite: true,
        side: THREE.DoubleSide,
        alphaTest: 0.5,
      });
    } else {
      this.itemSpriteLayerOf = null;
      this.itemSpriteMaterial = null;
    }

    this.shadowGeometry = new THREE.CircleGeometry(1, 16);
    this.shadowGeometry.rotateX(-Math.PI / 2);
    this.shadowMaterial = new THREE.MeshBasicMaterial({
      color: 0x000000,
      transparent: true,
      opacity: 0.3,
      depthWrite: false,
      polygonOffset: true,
      polygonOffsetFactor: -2,
    });

    scene.add(this.root);
    this.root.name = 'entity-root';
  }

  get count(): number {
    return this.records.size;
  }

  /** Update environment uniforms (call every frame next to the terrain material update). */
  setEnvironment(environment: EntityRendererEnvironment): void {
    this.shared.uDaylight.value = Math.max(0, Math.min(1, environment.daylight));
    if (environment.fogColor instanceof THREE.Color) {
      this.shared.uFogColor.value.copy(environment.fogColor);
    } else {
      this.shared.uFogColor.value.set(environment.fogColor);
    }
    this.shared.uFogNear.value = environment.fogNear;
    this.shared.uFogFar.value = environment.fogFar;
  }

  /** Sync render records with the manager snapshots (interpolated positions). */
  sync(
    snapshots: readonly EntitySnapshot[],
    camera?: THREE.Camera,
    alpha = 1,
    environment?: EntityRendererEnvironment,
  ): void {
    if (environment) this.setEnvironment(environment);
    this.shared.uTime.value = (typeof performance !== 'undefined' ? performance.now() : Date.now()) / 1000;

    const seen = new Set<number>();
    for (const snapshot of snapshots) {
      seen.add(snapshot.id);
      let record = this.records.get(snapshot.id);
      if (!record || record.kind !== snapshot.kind || this.recordTypeChanged(record, snapshot)) {
        if (record) {
          this.removeRecord(record);
          this.records.delete(snapshot.id);
        }
        record = this.createRecord(snapshot);
        this.records.set(snapshot.id, record);
        this.root.add(record.root);
      }
      const position = this.interpolatePosition(snapshot, alpha);
      if (camera) {
        const distance = camera.position.distanceTo(position);
        record.root.visible = distance <= this.cullDistance;
      } else {
        record.root.visible = true;
      }
      if (record.kind === 'mob') this.updateMob(record, snapshot, position);
      else if (record.kind === 'item') this.updateItem(record, snapshot, position, camera);
      else this.updateArrow(record, snapshot, position);
    }

    for (const [id, record] of [...this.records.entries()]) {
      if (!seen.has(id)) {
        this.removeRecord(record);
        this.records.delete(id);
      }
    }
  }

  private recordTypeChanged(record: RenderRecord, snapshot: EntitySnapshot): boolean {
    if (record.kind !== snapshot.kind) return true;
    if (record.kind === 'mob' && record.type !== snapshot.type) return true;
    if (record.kind === 'item' && record.itemId !== (snapshot.item?.item ?? snapshot.type)) return true;
    return false;
  }

  private interpolatePosition(snapshot: EntitySnapshot, alpha: number): THREE.Vector3 {
    const t = Math.max(0, Math.min(1, alpha));
    return new THREE.Vector3(
      snapshot.previousPosition.x + (snapshot.position.x - snapshot.previousPosition.x) * t,
      snapshot.previousPosition.y + (snapshot.position.y - snapshot.previousPosition.y) * t,
      snapshot.previousPosition.z + (snapshot.position.z - snapshot.previousPosition.z) * t,
    );
  }

  // -------------------------------------------------------------------------
  // Record creation
  // -------------------------------------------------------------------------

  private createRecord(snapshot: EntitySnapshot): RenderRecord {
    if (snapshot.kind === 'mob') return this.createMobRecord(snapshot.type as MobType);
    if (snapshot.kind === 'item') return this.createItemRecord(snapshot.item?.item ?? snapshot.type);
    return this.createArrowRecord();
  }

  private createMobRecord(type: MobType): MobRecord {
    const model = MOB_MODELS[type] ?? MOB_MODELS.zombie;
    const root = new THREE.Group();
    root.name = `mob:${type}`;
    const modelGroup = new THREE.Group();
    root.add(modelGroup);
    const material = this.createMobMaterial();
    const partGroups = new Map<string, THREE.Group>();
    const parts: MobPartEntry[] = [];

    for (const def of model.parts) {
      const parent = def.parent ? partGroups.get(def.parent) ?? modelGroup : modelGroup;
      const group = new THREE.Group();
      group.name = def.name;
      group.position.set(def.pivot[0], def.pivot[1], def.pivot[2]);
      parent.add(group);
      const geometry = this.mobGeometry(type, def);
      const mesh = new THREE.Mesh(geometry, material);
      mesh.position.set(def.offset[0], def.offset[1], def.offset[2]);
      group.add(mesh);
      partGroups.set(def.name, group);
      parts.push({ def, group });
    }

    const shadow = this.createShadow(model.width * 0.85);
    root.add(shadow);
    return { kind: 'mob', root, model: modelGroup, parts, shadow, material, type };
  }

  private createItemRecord(itemId: string): ItemRecord {
    const root = new THREE.Group();
    root.name = `item:${itemId}`;
    const item = getItem(itemId);
    // Block items stay as textured mini blocks; every other item becomes a
    // 2D icon billboard when the caller supplied an item texture array.
    const spriteLayer = item?.block ? null : this.resolveItemSpriteLayer(itemId);
    const sprite = spriteLayer !== null && this.itemSpriteMaterial !== null;
    const geometry = sprite
      ? this.itemSpriteGeometry(spriteLayer as number)
      : this.itemGeometry(itemId);
    const mesh = new THREE.Mesh(
      geometry,
      sprite && this.itemSpriteMaterial ? this.itemSpriteMaterial : this.itemMaterial,
    );
    mesh.position.y = sprite ? 0.17 : 0.15;
    root.add(mesh);
    const shadow = this.createShadow(sprite ? 0.16 : 0.18);
    root.add(shadow);
    return { kind: 'item', root, mesh, shadow, itemId, bobSeed: hashString(itemId) % 1000, sprite };
  }

  /** Resolve the item-icon layer; -1/NaN/null from the caller means "no sprite". */
  private resolveItemSpriteLayer(itemId: string): number | null {
    if (!this.itemSpriteLayerOf) return null;
    const layer = this.itemSpriteLayerOf(itemId);
    if (typeof layer !== 'number' || !Number.isFinite(layer) || layer < 0) return null;
    return Math.floor(layer);
  }

  private itemSpriteGeometry(layer: number): THREE.BufferGeometry {
    const cached = this.itemSpriteGeometries.get(layer);
    if (cached) return cached;
    const geometry = createSpriteGeometry(layer);
    this.itemSpriteGeometries.set(layer, geometry);
    return geometry;
  }

  private createArrowRecord(): ArrowRecord {
    const root = new THREE.Group();
    root.name = 'arrow';
    const mesh = new THREE.Mesh(this.arrowGeometry(), this.itemMaterial);
    root.add(mesh);
    return { kind: 'arrow', root, mesh };
  }

  private createMobMaterial(): THREE.ShaderMaterial {
    const material = new THREE.ShaderMaterial({
      uniforms: {
        ...(this.mobMaterialTemplateUniforms as Record<string, THREE.IUniform>),
        uHurt: { value: 0 },
        uOpacity: { value: 1 },
        uFire: { value: 0 },
      },
      vertexShader: MOB_VERTEX,
      fragmentShader: MOB_FRAGMENT,
      transparent: true,
      depthWrite: true,
    });
    this.mobMaterials.add(material);
    return material;
  }

  private createShadow(radius: number): THREE.Mesh {
    const mesh = new THREE.Mesh(this.shadowGeometry, this.shadowMaterial);
    mesh.scale.setScalar(Math.max(0.12, radius));
    mesh.renderOrder = 1;
    mesh.visible = this.shadowsEnabled;
    return mesh;
  }

  private mobGeometry(type: MobType, part: ModelPart): THREE.BufferGeometry {
    const key = `${type}:${part.name}`;
    const cached = this.mobGeometries.get(key);
    if (cached) return cached;
    const layer = this.skinLayers.get(part.texture) ?? 0;
    const geometry = createBoxGeometry(
      part.size,
      {
        layerOf: () => layer,
        shades: MOB_SHADE,
        frontUv: part.frontUv,
      },
    );
    this.mobGeometries.set(key, geometry);
    return geometry;
  }

  private itemGeometry(itemId: string): THREE.BufferGeometry {
    const cached = this.itemGeometries.get(itemId);
    if (cached) return cached;
    const size = 0.28;
    const item = getItem(itemId);
    let geometry: THREE.BufferGeometry;
    if (item?.block) {
      const def = getBlockDef(blockNumeric(item.block));
      if (this.ownsAtlasTexture) {
        const color = itemDropColor(itemId);
        geometry = createBoxGeometry([size, size, size], {
          layerOf: () => 0,
          shades: ITEM_SHADE,
          tint: {
            r: ((color >> 16) & 255) / 255,
            g: ((color >> 8) & 255) / 255,
            b: (color & 255) / 255,
          },
        });
      } else {
        geometry = createBoxGeometry([size, size, size], {
          layerOf: (face) => this.atlasLayerOf(faceTexture(def, face)),
          shades: ITEM_SHADE,
        });
      }
    } else {
      // No item-icon sprite available: fall back to a coloured mini cube.
      const color = itemDropColor(itemId);
      const layer = this.ownsAtlasTexture ? 0 : this.atlasLayerOf('stone');
      geometry = createBoxGeometry([size, size, size], {
        layerOf: () => layer,
        shades: ITEM_SHADE,
        tint: {
          r: ((color >> 16) & 255) / 255,
          g: ((color >> 8) & 255) / 255,
          b: (color & 255) / 255,
        },
      });
    }
    this.itemGeometries.set(itemId, geometry);
    return geometry;
  }

  private arrowGeometry(): THREE.BufferGeometry {
    const key = '__arrow__';
    const cached = this.itemGeometries.get(key);
    if (cached) return cached;
    const layer = this.ownsAtlasTexture ? 0 : this.atlasLayerOf('oak_log');
    const geometry = createBoxGeometry([0.05, 0.05, 0.55], {
      layerOf: () => layer,
      shades: ITEM_SHADE,
      tint: { r: 0.78, g: 0.7, b: 0.52 },
    });
    this.itemGeometries.set(key, geometry);
    return geometry;
  }

  // -------------------------------------------------------------------------
  // Per-frame updates
  // -------------------------------------------------------------------------

  private updateMob(record: MobRecord, snapshot: EntitySnapshot, position: THREE.Vector3): void {
    const root = record.root;
    root.position.copy(position);
    root.rotation.y = snapshot.yaw;

    const speed = snapshot.speed ?? 0;
    const walkAmp = Math.max(0, Math.min(1, speed / 2.2));
    for (const entry of record.parts) {
      const def = entry.def;
      const rest = def.rest ?? [0, 0, 0];
      let rx = rest[0];
      let ry = rest[1];
      let rz = rest[2];
      if (def.head) {
        ry += Math.max(-1.05, Math.min(1.05, wrapAngle(snapshot.headYaw - snapshot.yaw)));
        rx += Math.max(-0.75, Math.min(0.75, snapshot.headPitch));
        // Idle animation: subtle head sway when the mob is standing still.
        if (walkAmp < 0.06) rx += Math.sin(snapshot.age * 0.15) * 0.05;
      } else if (def.swing && def.swing !== 'none') {
        const amplitude = def.amplitude ?? (def.swing === 'leg' ? 0.72 : 0.55);
        const swing = Math.sin(snapshot.walkPhase + (def.phase ?? 0)) * amplitude * walkAmp;
        const axis = def.axis ?? 'x';
        if (axis === 'x') rx += swing;
        else if (axis === 'y') ry += swing;
        else rz += swing;
        if (def.swing === 'arm' && snapshot.state === 'attack') rx -= 0.85;
      }
      entry.group.rotation.set(rx, ry, rz);
    }

    const deathProgress = snapshot.deathTime >= 0 ? Math.min(1, snapshot.deathTime / 20) : 0;
    record.model.rotation.x = deathProgress * 1.35;
    record.model.position.y = -deathProgress * 0.12;

    let hurt = snapshot.hurtTime > 0 ? Math.min(1, snapshot.hurtTime / 10) * 0.9 : 0;
    const fire = snapshot.fireTicks > 0 ? 1 : 0;
    let scale = 1;
    if (record.type === 'creeper' && snapshot.fuse > 0) {
      const progress = Math.min(1, snapshot.fuse / 30);
      hurt = Math.max(hurt, 0.2 + 0.6 * Math.abs(Math.sin(snapshot.fuse * 1.15)));
      scale = 1 + progress * 0.18;
    }
    record.model.scale.setScalar(scale);
    record.material.uniforms.uHurt.value = hurt;
    record.material.uniforms.uFire.value = fire * (0.7 + 0.3 * Math.sin(snapshot.age * 0.6));
    record.material.uniforms.uOpacity.value = 1 - deathProgress * 0.45;

    record.shadow.visible = this.shadowsEnabled && snapshot.deathTime < 0;
    if (record.shadow.visible) {
      record.shadow.position.y = snapshot.shadowY - position.y + 0.015;
      const shadowScale = Math.max(0.12, MOB_MODELS[record.type].width * 0.85);
      record.shadow.scale.setScalar(shadowScale);
      record.shadow.rotation.y = 0;
    }
  }

  private updateItem(
    record: ItemRecord,
    snapshot: EntitySnapshot,
    position: THREE.Vector3,
    camera?: THREE.Camera,
  ): void {
    const age = snapshot.age;
    const bob = Math.sin(age * 0.16 + record.bobSeed) * 0.045 + 0.12;
    record.root.position.set(position.x, position.y + bob, position.z);
    if (record.sprite) {
      // Always face the camera so the 2D icon stays readable while bobbing.
      if (camera) record.root.quaternion.copy(camera.quaternion);
      else record.root.quaternion.identity();
      record.mesh.rotation.set(0, 0, 0);
    } else {
      // Mini blocks slowly spin around Y like a vanilla dropped item.
      record.root.rotation.y = age * 0.06;
      record.mesh.rotation.x = 0;
    }
    record.shadow.visible = this.shadowsEnabled;
    if (record.shadow.visible) {
      const shadowY = snapshot.shadowY + 0.01;
      record.shadow.position.y = shadowY - (position.y + bob);
      const distanceFade = Math.max(0.4, 1 - (position.y - snapshot.shadowY) * 0.35);
      record.shadow.scale.setScalar(0.18 * distanceFade);
    }
  }

  private updateArrow(record: ArrowRecord, snapshot: EntitySnapshot, position: THREE.Vector3): void {
    record.root.position.copy(position);
    const velocity = snapshot.velocity;
    const speed = Math.hypot(velocity.x, velocity.y, velocity.z);
    if (speed > 0.5) {
      const dir = new THREE.Vector3(velocity.x, velocity.y, velocity.z).normalize();
      record.root.quaternion.setFromUnitVectors(Z_AXIS, dir);
    } else {
      const yaw = snapshot.yaw;
      const pitch = snapshot.headPitch;
      const dir = new THREE.Vector3(
        Math.sin(yaw) * Math.cos(pitch),
        -Math.sin(pitch),
        Math.cos(yaw) * Math.cos(pitch),
      );
      record.root.quaternion.setFromUnitVectors(Z_AXIS, dir);
    }
  }

  // -------------------------------------------------------------------------
  // Cleanup
  // -------------------------------------------------------------------------

  private removeRecord(record: RenderRecord): void {
    this.root.remove(record.root);
    if (record.kind === 'mob') {
      this.mobMaterials.delete(record.material);
      record.material.dispose();
    }
  }

  dispose(): void {
    for (const record of this.records.values()) {
      this.root.remove(record.root);
      if (record.kind === 'mob') {
        this.mobMaterials.delete(record.material);
        record.material.dispose();
      }
    }
    this.records.clear();
    for (const geometry of this.mobGeometries.values()) geometry.dispose();
    this.mobGeometries.clear();
    for (const geometry of this.itemGeometries.values()) geometry.dispose();
    this.itemGeometries.clear();
    for (const geometry of this.itemSpriteGeometries.values()) geometry.dispose();
    this.itemSpriteGeometries.clear();
    this.shadowGeometry.dispose();
    this.shadowMaterial.dispose();
    this.itemMaterial.dispose();
    this.itemSpriteMaterial?.dispose();
    this.skinTexture.dispose();
    if (this.ownsAtlasTexture) this.atlasTexture.dispose();
    // The caller owns `options.itemTexture` (ItemIconAtlas); never dispose it.
    this.root.removeFromParent();
    void this.scene;
  }
}
