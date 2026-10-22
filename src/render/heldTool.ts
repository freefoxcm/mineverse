import * as THREE from 'three';
import { getItem } from '../world/items';

/**
 * True 3D first-person models for the four vanilla tool families.
 *
 * The extruded-sprite path is fine for food/materials, but tools read as flat
 * cards when viewed head-on. These models are built from boxes/prisms with a
 * real handle, head, guard and per-face shading. They keep the same grip
 * convention as the other held items: the handle passes through the local
 * origin and the head points up (+Y), so the category pose/tilt still applies.
 */

export interface HeldToolModel {
  geometry: THREE.BufferGeometry;
  /** Local model scale applied by FirstPersonHand. */
  scale: number;
}

type Rgb = [number, number, number];

const WOOD: Rgb = [0.54, 0.37, 0.2];
const WOOD_LIGHT: Rgb = [0.68, 0.49, 0.28];
const WOOD_DARK: Rgb = [0.35, 0.23, 0.12];

const TIER_COLORS: Record<string, { base: Rgb; light: Rgb; dark: Rgb }> = {
  wooden: { base: [0.62, 0.43, 0.23], light: [0.78, 0.57, 0.32], dark: [0.4, 0.27, 0.13] },
  stone: { base: [0.53, 0.53, 0.53], light: [0.72, 0.72, 0.72], dark: [0.3, 0.3, 0.3] },
  iron: { base: [0.78, 0.78, 0.8], light: [0.94, 0.94, 0.97], dark: [0.46, 0.46, 0.5] },
  golden: { base: [0.9, 0.72, 0.22], light: [1.0, 0.9, 0.45], dark: [0.58, 0.42, 0.08] },
  diamond: { base: [0.4, 0.88, 0.84], light: [0.7, 1.0, 0.98], dark: [0.15, 0.55, 0.52] },
};

const FACE_SHADE = [0.82, 0.7, 1.0, 0.55, 0.9, 0.65];

interface Buffers {
  positions: number[];
  colors: number[];
  indices: number[];
}

function scaleColor(color: Rgb, factor: number): Rgb {
  return [
    Math.min(1, color[0] * factor),
    Math.min(1, color[1] * factor),
    Math.min(1, color[2] * factor),
  ];
}

function pushQuad(
  buffers: Buffers,
  corners: readonly [number, number, number][],
  color: Rgb,
): void {
  const base = buffers.positions.length / 3;
  for (const corner of corners) {
    buffers.positions.push(corner[0], corner[1], corner[2]);
    buffers.colors.push(color[0], color[1], color[2]);
  }
  buffers.indices.push(base, base + 1, base + 2, base, base + 2, base + 3);
}

/** Axis-aligned box; `rotationZ` rotates around its own centre. */
function pushBox(
  buffers: Buffers,
  center: [number, number, number],
  size: [number, number, number],
  color: Rgb,
): void {
  const [cx, cy, cz] = center;
  const [w, h, d] = size;
  const x0 = cx - w / 2;
  const x1 = cx + w / 2;
  const y0 = cy - h / 2;
  const y1 = cy + h / 2;
  const z0 = cz - d / 2;
  const z1 = cz + d / 2;
  const faces: Array<[Rgb, [number, number, number][]]> = [
    [scaleColor(color, FACE_SHADE[0]), [[x1, y0, z1], [x1, y1, z1], [x1, y1, z0], [x1, y0, z0]]],
    [scaleColor(color, FACE_SHADE[1]), [[x0, y0, z0], [x0, y1, z0], [x0, y1, z1], [x0, y0, z1]]],
    [scaleColor(color, FACE_SHADE[2]), [[x0, y1, z1], [x1, y1, z1], [x1, y1, z0], [x0, y1, z0]]],
    [scaleColor(color, FACE_SHADE[3]), [[x0, y0, z0], [x1, y0, z0], [x1, y0, z1], [x0, y0, z1]]],
    [scaleColor(color, FACE_SHADE[4]), [[x0, y0, z1], [x1, y0, z1], [x1, y1, z1], [x0, y1, z1]]],
    [scaleColor(color, FACE_SHADE[5]), [[x1, y0, z0], [x0, y0, z0], [x0, y1, z0], [x1, y1, z0]]],
  ];
  for (const [tint, corners] of faces) pushQuad(buffers, corners, tint);
}

/** Octagonal prism along Y, used for the wooden handle. */
function pushPrismY(
  buffers: Buffers,
  radius: number,
  y0: number,
  y1: number,
  color: Rgb,
): void {
  const segments = 8;
  const ring = (y: number): Array<[number, number, number]> =>
    Array.from({ length: segments }, (_unused, i) => {
      const angle = (i / segments) * Math.PI * 2 + Math.PI / 8;
      return [Math.cos(angle) * radius, y, Math.sin(angle) * radius];
    });
  const lower = ring(y0);
  const upper = ring(y1);
  for (let i = 0; i < segments; i++) {
    const next = (i + 1) % segments;
    const tint = scaleColor(color, 0.55 + 0.45 * Math.max(0, Math.cos((i / segments) * Math.PI * 2 + Math.PI / 8)));
    pushQuad(buffers, [lower[i], lower[next], upper[next], upper[i]], tint);
  }
  // caps
  for (let i = 1; i < segments - 1; i++) {
    pushQuad(buffers, [lower[0], lower[i + 1], lower[i], lower[0]], scaleColor(color, 0.45));
    pushQuad(buffers, [upper[0], upper[i], upper[i + 1], upper[0]], scaleColor(color, 0.9));
  }
}

/** Tapered box along Y (w/d at y0 and y1). */
function pushTaperedBoxY(
  buffers: Buffers,
  y0: number,
  y1: number,
  w0: number,
  d0: number,
  w1: number,
  d1: number,
  color: Rgb,
): void {
  const a = (sx: number, sz: number): [number, number, number] => [sx * w0 / 2, y0, sz * d0 / 2];
  const b = (sx: number, sz: number): [number, number, number] => [sx * w1 / 2, y1, sz * d1 / 2];
  const faces: Array<[Rgb, [number, number, number][]]> = [
    [scaleColor(color, FACE_SHADE[0]), [a(1, -1), b(1, -1), b(1, 1), a(1, 1)]],
    [scaleColor(color, FACE_SHADE[1]), [a(-1, 1), b(-1, 1), b(-1, -1), a(-1, -1)]],
    [scaleColor(color, FACE_SHADE[4]), [a(-1, 1), a(1, 1), b(1, 1), b(-1, 1)]],
    [scaleColor(color, FACE_SHADE[5]), [a(1, -1), a(-1, -1), b(-1, -1), b(1, -1)]],
    [scaleColor(color, FACE_SHADE[2]), [b(-1, -1), b(1, -1), b(1, 1), b(-1, 1)]],
    [scaleColor(color, FACE_SHADE[3]), [a(-1, -1), a(-1, 1), a(1, 1), a(1, -1)]],
  ];
  for (const [tint, corners] of faces) pushQuad(buffers, corners, tint);
}

function makeGeometry(buffers: Buffers, scale: number): HeldToolModel {
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(buffers.positions, 3));
  geometry.setAttribute('color', new THREE.Float32BufferAttribute(buffers.colors, 3));
  geometry.setIndex(buffers.indices);
  geometry.computeBoundingSphere();
  return { geometry, scale };
}

/** Builds a real 3D model for pickaxe/axe/shovel/sword items, or null. */
export function buildHeldToolModel(itemId: string): HeldToolModel | null {
  const item = getItem(itemId);
  const type = item?.tool?.type;
  if (!type || !['pickaxe', 'axe', 'shovel', 'sword'].includes(type)) return null;
  const prefix = itemId.split('_')[0];
  const palette = TIER_COLORS[prefix] ?? TIER_COLORS.iron;
  const buffers: Buffers = { positions: [], colors: [], indices: [] };

  if (type === 'sword') {
    pushPrismY(buffers, 0.028, -0.16, 0.08, WOOD_DARK);
    pushBox(buffers, [0, 0.075, 0], [0.24, 0.035, 0.055], palette.dark);
    pushTaperedBoxY(buffers, 0.09, 0.82, 0.075, 0.024, 0.008, 0.012, palette.base);
    // bright edge strip
    pushBox(buffers, [0.038, 0.44, 0], [0.012, 0.68, 0.018], palette.light);
    pushBox(buffers, [0, -0.18, 0], [0.07, 0.035, 0.07], palette.dark);
    return makeGeometry(buffers, 0.42);
  }

  // Pickaxe / axe / shovel share the wooden handle, with a head near +Y.
  pushPrismY(buffers, 0.032, -0.18, 0.62, WOOD);
  pushPrismY(buffers, 0.026, -0.02, 0.2, WOOD_LIGHT);

  if (type === 'pickaxe') {
    pushBox(buffers, [0, 0.63, 0], [0.36, 0.08, 0.09], palette.base);
    pushBox(buffers, [0, 0.63, 0], [0.1, 0.14, 0.1], palette.dark);
    // two pointed tips, angled down slightly
    pushBox(buffers, [-0.24, 0.61, 0], [0.2, 0.065, 0.075], palette.base);
    pushBox(buffers, [0.24, 0.61, 0], [0.2, 0.065, 0.075], palette.base);
    pushBox(buffers, [-0.34, 0.585, 0], [0.12, 0.04, 0.05], palette.light);
    pushBox(buffers, [0.34, 0.585, 0], [0.12, 0.04, 0.05], palette.light);
  } else if (type === 'axe') {
    pushBox(buffers, [0, 0.6, 0], [0.18, 0.16, 0.1], palette.base);
    pushTaperedBoxY(buffers, 0.52, 0.72, 0.1, 0.08, 0.3, 0.06, palette.base);
    pushBox(buffers, [0.16, 0.62, 0], [0.06, 0.2, 0.06], palette.light);
    pushBox(buffers, [0, 0.6, 0], [0.08, 0.08, 0.1], palette.dark);
  } else {
    // shovel: wide flat spade blade
    pushTaperedBoxY(buffers, 0.45, 0.72, 0.14, 0.07, 0.28, 0.045, palette.base);
    pushBox(buffers, [0, 0.47, 0], [0.16, 0.06, 0.07], palette.dark);
    pushBox(buffers, [0, 0.7, 0], [0.18, 0.03, 0.035], palette.light);
  }

  return makeGeometry(buffers, 0.4);
}
