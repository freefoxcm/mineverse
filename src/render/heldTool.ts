import * as THREE from 'three';
import { getItem } from '../world/items';

/**
 * True 3D first-person models for pickaxes, axes, shovels and swords.
 *
 * The heads are extruded 2D silhouettes (so a pickaxe actually has a curved
 * pick head and an axe has a blade edge), while the handle is an octagonal
 * prism with grip wrapping and a ferrule. The grip sits at the local origin so
 * the existing first-person pose/swing code still works.
 */

export interface HeldToolModel {
  geometry: THREE.BufferGeometry;
  scale: number;
}

type Rgb = [number, number, number];
type Point2 = [number, number];

const WOOD: Rgb = [0.5, 0.34, 0.18];
const WOOD_LIGHT: Rgb = [0.66, 0.47, 0.27];
const WOOD_DARK: Rgb = [0.3, 0.19, 0.09];

const TIER_COLORS: Record<string, { base: Rgb; light: Rgb; dark: Rgb }> = {
  wooden: { base: [0.58, 0.4, 0.21], light: [0.76, 0.55, 0.31], dark: [0.36, 0.23, 0.11] },
  stone: { base: [0.5, 0.5, 0.5], light: [0.7, 0.7, 0.7], dark: [0.28, 0.28, 0.28] },
  iron: { base: [0.76, 0.76, 0.79], light: [0.95, 0.95, 0.98], dark: [0.42, 0.42, 0.46] },
  golden: { base: [0.88, 0.7, 0.2], light: [1.0, 0.9, 0.44], dark: [0.54, 0.4, 0.06] },
  diamond: { base: [0.36, 0.86, 0.82], light: [0.66, 1.0, 0.96], dark: [0.12, 0.5, 0.48] },
};

const FACE_SHADE = [0.82, 0.7, 1.0, 0.55, 0.9, 0.65];

interface Buffers {
  positions: number[];
  colors: number[];
  indices: number[];
}

function shade(color: Rgb, factor: number): Rgb {
  return [
    Math.min(1, color[0] * factor),
    Math.min(1, color[1] * factor),
    Math.min(1, color[2] * factor),
  ];
}

function addTriangle(
  buffers: Buffers,
  a: [number, number, number],
  b: [number, number, number],
  c: [number, number, number],
  color: Rgb,
): void {
  const base = buffers.positions.length / 3;
  buffers.positions.push(a[0], a[1], a[2], b[0], b[1], b[2], c[0], c[1], c[2]);
  buffers.colors.push(color[0], color[1], color[2], color[0], color[1], color[2], color[0], color[1], color[2]);
  buffers.indices.push(base, base + 1, base + 2);
}

function addQuad(
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

/** Axis-aligned box with per-face brightness. */
function addBox(
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
  const colors = FACE_SHADE.map((factor) => shade(color, factor));
  addQuad(buffers, [[x1, y0, z1], [x1, y1, z1], [x1, y1, z0], [x1, y0, z0]], colors[0]);
  addQuad(buffers, [[x0, y0, z0], [x0, y1, z0], [x0, y1, z1], [x0, y0, z1]], colors[1]);
  addQuad(buffers, [[x0, y1, z1], [x1, y1, z1], [x1, y1, z0], [x0, y1, z0]], colors[2]);
  addQuad(buffers, [[x0, y0, z0], [x1, y0, z0], [x1, y0, z1], [x0, y0, z1]], colors[3]);
  addQuad(buffers, [[x0, y0, z1], [x1, y0, z1], [x1, y1, z1], [x0, y1, z1]], colors[4]);
  addQuad(buffers, [[x1, y0, z0], [x0, y0, z0], [x0, y1, z0], [x1, y1, z0]], colors[5]);
}

/** Extrudes a 2D silhouette along Z, with shaded front/back/side faces. */
function addPrism(
  buffers: Buffers,
  points: readonly Point2[],
  depth: number,
  color: Rgb,
): void {
  const vectors = points.map(([x, y]) => new THREE.Vector2(x, y));
  const triangles = THREE.ShapeUtils.triangulateShape(vectors, []);
  const zFront = depth / 2;
  const zBack = -depth / 2;
  for (const triangle of triangles) {
    const [ai, bi, ci] = triangle;
    const a = points[ai];
    const b = points[bi];
    const c = points[ci];
    addTriangle(buffers, [a[0], a[1], zFront], [b[0], b[1], zFront], [c[0], c[1], zFront], shade(color, 1));
    addTriangle(buffers, [a[0], a[1], zBack], [c[0], c[1], zBack], [b[0], b[1], zBack], shade(color, 0.55));
  }
  for (let i = 0; i < points.length; i++) {
    const a = points[i];
    const b = points[(i + 1) % points.length];
    const dx = b[0] - a[0];
    const dy = b[1] - a[1];
    const length = Math.hypot(dx, dy) || 1;
    const nx = dy / length;
    const ny = -dx / length;
    const light = 0.58 + 0.42 * Math.max(0, -nx * 0.35 + ny * 0.85);
    addQuad(
      buffers,
      [
        [a[0], a[1], zFront],
        [b[0], b[1], zFront],
        [b[0], b[1], zBack],
        [a[0], a[1], zBack],
      ],
      shade(color, light),
    );
  }
}

/** Octagonal wooden handle with a metal ferrule + grip wraps. */
function addHandle(buffers: Buffers, yTop: number, wrapColor: Rgb): void {
  const y0 = -0.2;
  addPrismOctagon(buffers, 0.034, y0, yTop, WOOD);
  for (const y of [-0.11, -0.055, 0]) {
    addPrismOctagon(buffers, 0.038, y - 0.012, y + 0.012, wrapColor);
  }
  addPrismOctagon(buffers, 0.044, yTop - 0.035, yTop - 0.012, WOOD_LIGHT);
}

function addPrismOctagon(
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
    const factor = 0.55 + 0.45 * Math.max(0, Math.cos((i / segments) * Math.PI * 2 + Math.PI / 8));
    addQuad(buffers, [lower[i], lower[next], upper[next], upper[i]], shade(color, factor));
  }
  for (let i = 1; i < segments - 1; i++) {
    addTriangle(buffers, lower[0], lower[i + 1], lower[i], shade(color, 0.42));
    addTriangle(buffers, upper[0], upper[i], upper[i + 1], shade(color, 0.92));
  }
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
    addPrismOctagon(buffers, 0.03, -0.16, 0.06, WOOD_DARK);
    for (const y of [-0.12, -0.06, 0]) addPrismOctagon(buffers, 0.034, y - 0.01, y + 0.01, palette.dark);
    addBox(buffers, [0, 0.075, 0], [0.26, 0.038, 0.06], palette.dark);
    addBox(buffers, [0, 0.1, 0], [0.1, 0.045, 0.075], palette.light);
    addPrism(
      buffers,
      [
        [-0.05, 0.12],
        [0.05, 0.12],
        [0.042, 0.66],
        [0.018, 0.86],
        [0, 0.94],
        [-0.018, 0.86],
        [-0.042, 0.66],
      ],
      0.032,
      palette.base,
    );
    addBox(buffers, [0.031, 0.5, 0.018], [0.012, 0.7, 0.006], palette.light);
    addBox(buffers, [0, -0.185, 0], [0.065, 0.035, 0.065], palette.dark);
    return makeGeometry(buffers, 0.4);
  }

  // Handle + head. Heads are extruded silhouettes, not boxes.
  addHandle(buffers, type === 'pickaxe' ? 0.64 : type === 'axe' ? 0.6 : 0.55, palette.dark);
  if (type === 'pickaxe') {
    addPrism(
      buffers,
      [
        [-0.42, 0.62],
        [-0.32, 0.72],
        [-0.12, 0.79],
        [0, 0.81],
        [0.12, 0.79],
        [0.32, 0.72],
        [0.42, 0.62],
        [0.36, 0.56],
        [0.2, 0.6],
        [0.09, 0.64],
        [0, 0.65],
        [-0.09, 0.64],
        [-0.2, 0.6],
        [-0.36, 0.56],
      ],
      0.085,
      palette.base,
    );
    addBox(buffers, [0, 0.625, 0], [0.12, 0.12, 0.11], palette.dark);
    addBox(buffers, [0, 0.625, 0.055], [0.055, 0.055, 0.02], palette.light);
    addBox(buffers, [-0.43, 0.6, 0], [0.06, 0.03, 0.05], palette.light);
    addBox(buffers, [0.43, 0.6, 0], [0.06, 0.03, 0.05], palette.light);
  } else if (type === 'axe') {
    addPrism(
      buffers,
      [
        [0.02, 0.53],
        [0.16, 0.52],
        [0.32, 0.56],
        [0.38, 0.63],
        [0.39, 0.76],
        [0.33, 0.85],
        [0.18, 0.9],
        [0.04, 0.86],
        [0.02, 0.76],
      ],
      0.065,
      palette.base,
    );
    addBox(buffers, [0.36, 0.72, 0], [0.045, 0.25, 0.045], palette.light);
    addBox(buffers, [0.06, 0.65, 0], [0.08, 0.12, 0.08], palette.dark);
  } else {
    addPrism(
      buffers,
      [
        [-0.17, 0.5],
        [0.17, 0.5],
        [0.21, 0.62],
        [0.21, 0.77],
        [0.16, 0.89],
        [0, 0.94],
        [-0.16, 0.89],
        [-0.21, 0.77],
        [-0.21, 0.62],
      ],
      0.05,
      palette.base,
    );
    addBox(buffers, [0, 0.92, 0], [0.16, 0.035, 0.035], palette.light);
    addBox(buffers, [0, 0.55, 0], [0.1, 0.08, 0.07], palette.dark);
  }

  return makeGeometry(buffers, 0.38);
}
