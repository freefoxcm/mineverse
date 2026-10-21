import * as THREE from 'three';
import { createItemIcon } from '../art/items';
import { getItem } from '../world/items';
type Vec3Tuple = [number, number, number];

/**
 * Extruded 3D models for first-person held items.
 *
 * Minecraft renders held sprites as thin extruded pixel-art slabs, not flat
 * billboards. We rebuild that look from Art-E's 32x32 alpha masks:
 * - front/back faces sample the item icon atlas,
 * - side walls are emitted only along silhouette edges and sample the edge
 *   pixel (so the slab has a readable thickness/colour),
 * - direction-specific tints give the slab a light source (top-left).
 *
 * The resulting geometry is cached by item id in `HeldItemGeometryCache`.
 */

export type HeldCategory = 'block' | 'tool' | 'weapon' | 'food' | 'material' | 'other';

export type HandItemKind = 'block' | 'sprite' | 'fallback' | 'none';

export interface ExtrudedItemGeometry {
  geometry: THREE.BufferGeometry;
  /** Grip point in icon-local coordinates (-0.5..0.5, x/y). */
  grip: Vec3Tuple;
  triangles: number;
}

/** Icon thickness in icon pixels (32 px = 1 world unit before item scale). */
export const ITEM_THICKNESS_PX = 2;
const ICON_SIZE = 32;
const ALPHA_THRESHOLD = 128;

const CATEGORY_GRIPS: Readonly<Record<HeldCategory, Vec3Tuple>> = {
  // Tool handle ends at around icon pixel (10..11, 27) -> lower-left.
  tool: [-0.17, -0.35, 0],
  weapon: [-0.19, -0.34, 0],
  // Materials are lumps; hold near the lower-left edge.
  material: [-0.14, -0.26, 0],
  // Food is held closer to the middle of the icon.
  food: [-0.02, -0.26, 0],
  // Blocks are handled by buildBlockGeometry, not this path.
  block: [0.24, -0.28, 0.18],
  other: [-0.1, -0.24, 0],
};

export function heldCategory(itemId: string): HeldCategory {
  const item = getItem(itemId);
  if (!item) return 'other';
  if (item.block) return 'block';
  switch (item.kind) {
    case 'tool':
      return 'tool';
    case 'weapon':
      return 'weapon';
    case 'food':
      return 'food';
    case 'material':
      return 'material';
    default:
      return 'other';
  }
}

export function gripForItem(itemId: string): Vec3Tuple {
  return CATEGORY_GRIPS[heldCategory(itemId)];
}

function pixelToUv(px: number, py: number): [number, number] {
  // The hand shader flips V, so pixel row 0 (top) ends up at v=1.
  return [(px + 0.5) / ICON_SIZE, 1 - (py + 0.5) / ICON_SIZE];
}

interface MeshBuffers {
  positions: number[];
  uvs: number[];
  layers: number[];
  tints: number[];
  indices: number[];
}

function pushQuad(
  buffers: MeshBuffers,
  layer: number,
  positions: readonly [number, number, number][],
  uvs: readonly [number, number][],
  tint: Vec3Tuple,
): void {
  const offset = buffers.positions.length / 3;
  for (let i = 0; i < 4; i++) {
    buffers.positions.push(positions[i][0], positions[i][1], positions[i][2]);
    buffers.uvs.push(uvs[i][0], uvs[i][1]);
    buffers.layers.push(layer);
    buffers.tints.push(tint[0], tint[1], tint[2]);
  }
  buffers.indices.push(offset, offset + 1, offset + 2, offset, offset + 2, offset + 3);
}

/**
 * Builds an extruded item model from the item's 32x32 icon alpha mask.
 * Returns null when the item has no painted icon (caller falls back to a quad).
 */
export function buildExtrudedItemGeometry(itemId: string, layer: number): ExtrudedItemGeometry | null {
  const icon = createItemIcon(itemId);
  if (!icon) return null;
  const { data, width, height } = icon;
  const opaque = new Uint8Array(width * height);
  let opaqueCount = 0;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      if (data[(y * width + x) * 4 + 3] >= ALPHA_THRESHOLD) {
        opaque[y * width + x] = 1;
        opaqueCount++;
      }
    }
  }
  if (opaqueCount < 4) return null;

  const thickness = ITEM_THICKNESS_PX / ICON_SIZE;
  const zFront = thickness / 2;
  const zBack = -thickness / 2;
  const buffers: MeshBuffers = { positions: [], uvs: [], layers: [], tints: [], indices: [] };

  const isOpaque = (x: number, y: number): boolean =>
    x >= 0 && y >= 0 && x < width && y < height && opaque[y * width + x] === 1;

  // Front/back full quads: transparent pixels are discarded by alphaTest, so
  // interior holes stay holes and silhouette side walls still work.
  pushQuad(
    buffers,
    layer,
    [
      [-0.5, -0.5, zFront],
      [0.5, -0.5, zFront],
      [0.5, 0.5, zFront],
      [-0.5, 0.5, zFront],
    ],
    [
      [0, 0],
      [1, 0],
      [1, 1],
      [0, 1],
    ],
    [1, 1, 1],
  );
  pushQuad(
    buffers,
    layer,
    [
      [-0.5, -0.5, zBack],
      [-0.5, 0.5, zBack],
      [0.5, 0.5, zBack],
      [0.5, -0.5, zBack],
    ],
    [
      [0, 0],
      [0, 1],
      [1, 1],
      [1, 0],
    ],
    [0.64, 0.64, 0.64],
  );

  // Side walls only along the alpha silhouette. Sample one pixel inset (not the
  // dark outline pixel) so the thickness shows the material colour.
  for (let py = 0; py < height; py++) {
    for (let px = 0; px < width; px++) {
      if (!isOpaque(px, py)) continue;
      const u0 = px / ICON_SIZE;
      const u1 = (px + 1) / ICON_SIZE;
      const yTop = 0.5 - py / ICON_SIZE;
      const yBottom = 0.5 - (py + 1) / ICON_SIZE;
      const insetUv = (nx: number, ny: number): [number, number] =>
        isOpaque(nx, ny) ? pixelToUv(nx, ny) : pixelToUv(px, py);

      if (!isOpaque(px - 1, py)) {
        const edgeUv = insetUv(px + 1, py);
        pushQuad(
          buffers,
          layer,
          [
            [u0 - 0.5, yBottom, zBack],
            [u0 - 0.5, yTop, zBack],
            [u0 - 0.5, yTop, zFront],
            [u0 - 0.5, yBottom, zFront],
          ],
          [edgeUv, edgeUv, edgeUv, edgeUv],
          [0.92, 0.92, 0.92],
        );
      }
      if (!isOpaque(px + 1, py)) {
        const edgeUv = insetUv(px - 1, py);
        pushQuad(
          buffers,
          layer,
          [
            [u1 - 0.5, yBottom, zFront],
            [u1 - 0.5, yTop, zFront],
            [u1 - 0.5, yTop, zBack],
            [u1 - 0.5, yBottom, zBack],
          ],
          [edgeUv, edgeUv, edgeUv, edgeUv],
          [0.74, 0.74, 0.74],
        );
      }
      if (!isOpaque(px, py - 1)) {
        const edgeUv = insetUv(px, py + 1);
        pushQuad(
          buffers,
          layer,
          [
            [u0 - 0.5, yTop, zFront],
            [u1 - 0.5, yTop, zFront],
            [u1 - 0.5, yTop, zBack],
            [u0 - 0.5, yTop, zBack],
          ],
          [edgeUv, edgeUv, edgeUv, edgeUv],
          [1, 1, 1],
        );
      }
      if (!isOpaque(px, py + 1)) {
        const edgeUv = insetUv(px, py - 1);
        pushQuad(
          buffers,
          layer,
          [
            [u0 - 0.5, yBottom, zBack],
            [u1 - 0.5, yBottom, zBack],
            [u1 - 0.5, yBottom, zFront],
            [u0 - 0.5, yBottom, zFront],
          ],
          [edgeUv, edgeUv, edgeUv, edgeUv],
          [0.62, 0.62, 0.62],
        );
      }
    }
  }

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(buffers.positions, 3));
  geometry.setAttribute('aUv', new THREE.Float32BufferAttribute(buffers.uvs, 2));
  geometry.setAttribute('aLayer', new THREE.Float32BufferAttribute(buffers.layers, 1));
  geometry.setAttribute('aTint', new THREE.Float32BufferAttribute(buffers.tints, 3));
  geometry.setIndex(buffers.indices);
  geometry.computeBoundingBox();
  geometry.computeBoundingSphere();

  return {
    geometry,
    grip: [...CATEGORY_GRIPS[heldCategory(itemId)]],
    triangles: buffers.indices.length / 3,
  };
}

/** Small per-item geometry cache: extruding a 32x32 mask is cheap but not free. */
export class HeldItemGeometryCache {
  private readonly cache = new Map<string, ExtrudedItemGeometry>();

  get(itemId: string, layer: number): ExtrudedItemGeometry | null {
    const key = `${itemId}:${layer}`;
    const cached = this.cache.get(key);
    if (cached) return cached;
    const built = buildExtrudedItemGeometry(itemId, layer);
    if (built) this.cache.set(key, built);
    return built;
  }

  get size(): number {
    return this.cache.size;
  }

  dispose(): void {
    for (const item of this.cache.values()) item.geometry.dispose();
    this.cache.clear();
  }
}
