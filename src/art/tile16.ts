import { mulberry32 } from '../core/rng';
import { parseColor, type PixelPainter, type RGBA } from './pixels';
import type { TilePainter } from './types';

/**
 * 16x16 logical-pixel drawing kit.
 *
 * The engine textures are 32x32, but Minecraft-style art reads best at a
 * 16 pixel grid: every logical pixel is stamped as a crisp 2x2 block. This
 * keeps nearest-filtered close-ups blocky and, crucially, makes the first
 * mipmap level a perfect 16x16 texture (no blurry 32px soft detail).
 */

export const GRID = 16;

export type Cell = string | RGBA;

function coerce(color: Cell): RGBA {
  return typeof color === 'string' ? parseColor(color) : color;
}

export class Sprite16 {
  readonly cells: RGBA[];

  constructor() {
    this.cells = new Array<RGBA>(GRID * GRID);
    const transparent: RGBA = [0, 0, 0, 0];
    for (let i = 0; i < this.cells.length; i++) this.cells[i] = transparent;
  }

  set(x: number, y: number, color: Cell): void {
    if (x < 0 || y < 0 || x >= GRID || y >= GRID) return;
    this.cells[y * GRID + x] = coerce(color);
  }

  get(x: number, y: number): RGBA {
    if (x < 0 || y < 0 || x >= GRID || y >= GRID) return [0, 0, 0, 0];
    return this.cells[y * GRID + x];
  }

  fill(color: Cell): void {
    const c = coerce(color);
    for (let i = 0; i < this.cells.length; i++) this.cells[i] = c;
  }

  rect(x: number, y: number, w: number, h: number, color: Cell): void {
    const c = coerce(color);
    for (let py = y; py < y + h; py++) {
      for (let px = x; px < x + w; px++) {
        if (px < 0 || py < 0 || px >= GRID || py >= GRID) continue;
        this.cells[py * GRID + px] = c;
      }
    }
  }

  /** 1 px Bresenham line on the 16 grid. */
  line(x0: number, y0: number, x1: number, y1: number, color: Cell): void {
    const c = coerce(color);
    let x = Math.round(x0);
    let y = Math.round(y0);
    const ex = Math.round(x1);
    const ey = Math.round(y1);
    const dx = Math.abs(ex - x);
    const dy = -Math.abs(ey - y);
    const sx = x < ex ? 1 : -1;
    const sy = y < ey ? 1 : -1;
    let err = dx + dy;
    for (let guard = 0; guard < 256; guard++) {
      if (x >= 0 && y >= 0 && x < GRID && y < GRID) this.cells[y * GRID + x] = c;
      if (x === ex && y === ey) break;
      const e2 = 2 * err;
      if (e2 >= dy) {
        err += dy;
        x += sx;
      }
      if (e2 <= dx) {
        err += dx;
        y += sy;
      }
    }
  }

  /**
   * Fill every cell with a weighted random pick from the palette. This is the
   * Minecraft "grain": close shades at 1 logical pixel, never a smooth gradient.
   */
  noise(seed: number, colors: readonly Cell[], weights?: readonly number[]): void {
    const rng = mulberry32(seed);
    const parsed = colors.map(coerce);
    const w = weights ?? colors.map(() => 1);
    let total = 0;
    for (const value of w) total += value;
    const cumulative: number[] = [];
    let acc = 0;
    for (const value of w) {
      acc += value;
      cumulative.push(acc);
    }
    for (let y = 0; y < GRID; y++) {
      for (let x = 0; x < GRID; x++) {
        const roll = rng() * total;
        let index = 0;
        while (index < cumulative.length - 1 && roll >= cumulative[index]) index++;
        this.cells[y * GRID + x] = parsed[index];
      }
    }
  }

  /** Sprinkle `count` single logical-pixel accents. */
  speckle(seed: number, colors: readonly Cell[], count: number): void {
    const rng = mulberry32(seed);
    const parsed = colors.map(coerce);
    for (let i = 0; i < count; i++) {
      const x = Math.floor(rng() * GRID);
      const y = Math.floor(rng() * GRID);
      this.cells[y * GRID + x] = parsed[Math.floor(rng() * parsed.length)];
    }
  }

  /** Small clumps of 2-4 cells (pebbles, moss, mineral grains). */
  clusters(seed: number, colors: readonly Cell[], count: number, radius = 1): void {
    const rng = mulberry32(seed);
    const parsed = colors.map(coerce);
    for (let i = 0; i < count; i++) {
      const cx = Math.floor(rng() * GRID);
      const cy = Math.floor(rng() * GRID);
      const color = parsed[Math.floor(rng() * parsed.length)];
      const r = Math.max(1, Math.round(radius));
      for (let dy = -r; dy <= r; dy++) {
        for (let dx = -r; dx <= r; dx++) {
          if (dx * dx + dy * dy > r * r + 0.5) continue;
          if (x_in(cx + dx)) this.set(cx + dx, cy + dy, color);
        }
      }
    }
  }

  /** Stamp an ASCII pattern; '.' and ' ' leave the cell untouched. */
  art(rows: readonly string[], map: Readonly<Record<string, Cell>>, ox = 0, oy = 0): void {
    for (let y = 0; y < rows.length; y++) {
      const row = rows[y];
      for (let x = 0; x < row.length; x++) {
        const ch = row[x];
        if (ch === '.' || ch === ' ') continue;
        const color = map[ch];
        if (color === undefined) continue;
        this.set(ox + x, oy + y, color);
      }
    }
  }
}

function x_in(x: number): boolean {
  return x >= 0 && x < GRID;
}

/** Wraps a Sprite16 painting into a 32x32 TilePainter (each logical px = 2x2). */
export function sprite16(paint: (s: Sprite16) => void): TilePainter {
  return (p: PixelPainter) => {
    const s = new Sprite16();
    paint(s);
    for (let y = 0; y < GRID; y++) {
      for (let x = 0; x < GRID; x++) {
        p.rect(x * 2, y * 2, 2, 2, s.cells[y * GRID + x]);
      }
    }
  };
}
