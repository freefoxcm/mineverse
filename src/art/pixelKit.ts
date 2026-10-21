import { hash2f, hash2i, mix32, mulberry32 } from '../core/rng';
import { mixColor, parseColor, type PixelPainter, type RGBA } from './pixels';
import { TILE_SIZE } from './types';

/**
 * Shared low-level helpers for the procedural pixel art.
 *
 * Design rules for Art-E tiles:
 * - No `Math.random()`: every random decision comes from a seed (hash2i/fbm/mulberry32).
 * - Prefer low-frequency clusters over per-pixel white noise; a handful of crisp
 *   highlight/shadow specks is fine, a uniform salt-and-pepper field is not.
 * - Painters are idempotent: they overwrite every pixel they care about, so
 *   painting the same painter twice on the same buffer yields identical output.
 */

export const TILE = TILE_SIZE;

export type Rgba = RGBA;

export function rgb(r: number, g: number, b: number, a = 255): RGBA {
  return [r, g, b, a];
}

export function col(color: string | RGBA): RGBA {
  return typeof color === 'string' ? parseColor(color) : color;
}

export function palette(colors: readonly (string | RGBA)[]): RGBA[] {
  return colors.map(col);
}

/** Positive wrap into [0, TILE_SIZE) so tiles tile seamlessly. */
export function wrap(value: number): number {
  const m = value % TILE_SIZE;
  return m < 0 ? m + TILE_SIZE : m;
}

/** Mix two pixels but keep the alpha of `from` (used for transparent tiles). */
export function mixPixel(from: RGBA, to: RGBA, t: number): RGBA {
  const mixed = mixColor(from, to, t);
  return [mixed[0], mixed[1], mixed[2], from[3]];
}

export function smoothStep(t: number): number {
  const c = t < 0 ? 0 : t > 1 ? 1 : t;
  return c * c * (3 - 2 * c);
}

export function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

/** Bilinear value noise on a coarse grid. `cell` is the grid spacing in pixels. */
export function smoothNoise(seed: number, x: number, y: number, cell: number): number {
  const sx = x / cell;
  const sy = y / cell;
  const gx = Math.floor(sx);
  const gy = Math.floor(sy);
  const fx = smoothStep(sx - gx);
  const fy = smoothStep(sy - gy);
  const v00 = hash2f(seed, gx, gy);
  const v10 = hash2f(seed, gx + 1, gy);
  const v01 = hash2f(seed, gx, gy + 1);
  const v11 = hash2f(seed, gx + 1, gy + 1);
  return lerp(lerp(v00, v10, fx), lerp(v01, v11, fx), fy);
}

/** Two-octave value noise, result in [0,1). */
export function fbm(seed: number, x: number, y: number, cell: number): number {
  const a = smoothNoise(seed, x, y, cell);
  const b = smoothNoise(mix32(seed ^ 0x7f4a7c15), x, y, Math.max(2, cell * 0.5));
  return a * 0.64 + b * 0.36;
}

export interface ToneOptions {
  /** Noise cluster size in pixels. Bigger = broader patches. */
  cell?: number;
  /** Maximum mix toward the light/dark color (0..1). */
  strength?: number;
  /** Quantization steps of the noise (fewer = chunkier light/dark patches). */
  levels?: number;
}

/**
 * Adds low-frequency light/dark variation on top of whatever was already
 * painted. Alpha is preserved, so it is safe for transparent tiles.
 */
export function tone(
  p: PixelPainter,
  seed: number,
  light: string | RGBA,
  dark: string | RGBA,
  options: ToneOptions = {},
): void {
  const { cell = 7, strength = 0.2, levels = 4 } = options;
  const lightColor = col(light);
  const darkColor = col(dark);
  for (let y = 0; y < TILE_SIZE; y++) {
    for (let x = 0; x < TILE_SIZE; x++) {
      const base = p.get(x, y);
      if (base[3] === 0) continue;
      const n = fbm(seed, x, y, cell);
      const q = Math.round(n * levels) / levels;
      const t = (q - 0.5) * 2 * strength;
      const out = t >= 0 ? mixPixel(base, lightColor, t) : mixPixel(base, darkColor, -t);
      p.set(x, y, out);
    }
  }
}

/** Scatter `count` single-pixel accents (kept sparse: this is the only high-frequency pass). */
export function specks(
  p: PixelPainter,
  seed: number,
  colors: readonly (string | RGBA)[],
  count: number,
): void {
  const rng = mulberry32(seed);
  const parsed = palette(colors);
  for (let i = 0; i < count; i++) {
    const x = Math.floor(rng() * TILE_SIZE);
    const y = Math.floor(rng() * TILE_SIZE);
    p.set(x, y, parsed[Math.floor(rng() * parsed.length)]);
  }
}

/** Paint a handful of small round-ish clumps (2-5 px across). */
export function blobs(
  p: PixelPainter,
  seed: number,
  colors: readonly (string | RGBA)[],
  count: number,
  radiusMin = 1,
  radiusMax = 2,
): void {
  const rng = mulberry32(seed);
  const parsed = palette(colors);
  for (let i = 0; i < count; i++) {
    const cx = Math.floor(rng() * TILE_SIZE);
    const cy = Math.floor(rng() * TILE_SIZE);
    const color = parsed[Math.floor(rng() * parsed.length)];
    const radius = radiusMin + Math.floor(rng() * (radiusMax - radiusMin + 0.999));
    if (radius <= 1) {
      // a 2x2 pebble reads better than a plus/cross of single pixels
      p.set(wrap(cx), wrap(cy), color);
      p.set(wrap(cx + 1), wrap(cy), color);
      p.set(wrap(cx), wrap(cy + 1), color);
      if (rng() < 0.75) p.set(wrap(cx + 1), wrap(cy + 1), color);
    } else {
      for (let dy = -radius; dy <= radius; dy++) {
        for (let dx = -radius; dx <= radius; dx++) {
          if (dx * dx + dy * dy > radius * radius + radius * 0.4) continue;
          p.set(wrap(cx + dx), wrap(cy + dy), color);
        }
      }
    }
    // little tail so blobs are not perfect rectangles/circles
    const tail = rng() < 0.5 ? 1 : 2;
    for (let t = 0; t < tail; t++) {
      p.set(wrap(cx + Math.floor(rng() * 5) - 2), wrap(cy + Math.floor(rng() * 5) - 2), color);
    }
  }
}

/** 1px bevel: light on top/left, dark on bottom/right. */
export function bevel(
  p: PixelPainter,
  light: string | RGBA,
  dark: string | RGBA,
  thickness = 1,
): void {
  p.rect(0, 0, TILE_SIZE, thickness, light);
  p.rect(0, 0, thickness, TILE_SIZE, light);
  p.rect(0, TILE_SIZE - thickness, TILE_SIZE, thickness, dark);
  p.rect(TILE_SIZE - thickness, 0, thickness, TILE_SIZE, dark);
}

export function pickColor(seed: number, x: number, y: number, colors: RGBA[], salt = 0): RGBA {
  return colors[hash2i(seed ^ salt, x, y) % colors.length];
}

export interface VoronoiOptions {
  /** Cells per tile edge (3..6 usually). */
  grid: number;
  /** Stone colors; each cell picks one. */
  colors: readonly (string | RGBA)[];
  /** Torus distance between nearest and second-nearest cell that becomes mortar. */
  gap: number;
  color: string | RGBA;
  highlight?: string | RGBA;
  shadow?: string | RGBA;
  /** Strength of the fake top-left lighting on each pebble (default 0.32). */
  relief?: number;
}

/**
 * Voronoi pebble field: irregular rounded stones separated by dark mortar.
 * Used for cobblestone, gravel, bedrock - gives clustered detail instead of
 * high-frequency noise.
 */
export function voronoi(p: PixelPainter, seed: number, options: VoronoiOptions): void {
  const { grid, colors, gap, color: gapColor } = options;
  const cellSize = TILE_SIZE / grid;
  const stoneColors = palette(colors);
  const gapRgba = col(gapColor);
  const highlight = options.highlight === undefined ? null : col(options.highlight);
  const shadow = options.shadow === undefined ? null : col(options.shadow);
  const relief = options.relief ?? 0.32;

  interface Center {
    x: number;
    y: number;
    color: RGBA;
  }
  const centers: Center[] = [];
  for (let gy = 0; gy < grid; gy++) {
    for (let gx = 0; gx < grid; gx++) {
      const jx = 0.18 + hash2f(seed, gx, gy) * 0.64;
      const jy = 0.18 + hash2f(mix32(seed ^ 0x2c1b3d79), gx, gy) * 0.64;
      centers.push({
        x: (gx + jx) * cellSize,
        y: (gy + jy) * cellSize,
        color: stoneColors[hash2i(seed ^ 0x51, gx, gy) % stoneColors.length],
      });
    }
  }

  const half = TILE_SIZE / 2;
  for (let y = 0; y < TILE_SIZE; y++) {
    for (let x = 0; x < TILE_SIZE; x++) {
      let nearest = Number.POSITIVE_INFINITY;
      let second = Number.POSITIVE_INFINITY;
      let nearestCenter = centers[0];
      for (let i = 0; i < centers.length; i++) {
        const c = centers[i];
        let dx = x + 0.5 - c.x;
        let dy = y + 0.5 - c.y;
        if (dx > half) dx -= TILE_SIZE;
        if (dx < -half) dx += TILE_SIZE;
        if (dy > half) dy -= TILE_SIZE;
        if (dy < -half) dy += TILE_SIZE;
        const d = Math.sqrt(dx * dx + dy * dy);
        if (d < nearest) {
          second = nearest;
          nearest = d;
          nearestCenter = c;
        } else if (d < second) {
          second = d;
        }
      }
      if (second - nearest < gap) {
        p.set(x, y, gapRgba);
        continue;
      }
      let color = nearestCenter.color;
      let dx = x + 0.5 - nearestCenter.x;
      let dy = y + 0.5 - nearestCenter.y;
      if (dx > half) dx -= TILE_SIZE;
      if (dx < -half) dx += TILE_SIZE;
      if (dy > half) dy -= TILE_SIZE;
      if (dy < -half) dy += TILE_SIZE;
      const facing = dx + dy;
      if (highlight && facing < -cellSize * 0.28) color = mixPixel(color, highlight, relief);
      else if (shadow && facing > cellSize * 0.28) color = mixPixel(color, shadow, relief * 0.9);
      p.set(x, y, color);
    }
  }
}
