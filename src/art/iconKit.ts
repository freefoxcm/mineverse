import { mulberry32 } from '../core/rng';
import { parseColor, type PixelPainter, type RGBA } from './pixels';
import { TILE_SIZE as T } from './types';

/**
 * Tiny mask-based drawing kit shared by the item sprites (`items.ts`) and the
 * HUD sprites (`ui.ts`). Icons are authored as 1-bit silhouettes, then filled
 * with a base colour, a light upper/left bevel, a dark lower/right bevel and a
 * 1 px outer outline so they stay readable on any slot background.
 */

export interface IconPalette {
  base: string;
  light: string;
  dark: string;
  edge: string;
}

export class IconShape {
  readonly mask = new Uint8Array(T * T);

  set(x: number, y: number): void {
    const ix = Math.round(x);
    const iy = Math.round(y);
    if (ix < 0 || iy < 0 || ix >= T || iy >= T) return;
    this.mask[iy * T + ix] = 1;
  }

  has(x: number, y: number): boolean {
    if (x < 0 || y < 0 || x >= T || y >= T) return false;
    return this.mask[y * T + x] === 1;
  }

  rect(x: number, y: number, w: number, h: number): void {
    for (let py = y; py < y + h; py++) for (let px = x; px < x + w; px++) this.set(px, py);
  }

  ellipse(cx: number, cy: number, rx: number, ry: number): void {
    for (let y = Math.floor(cy - ry); y <= Math.ceil(cy + ry); y++) {
      for (let x = Math.floor(cx - rx); x <= Math.ceil(cx + rx); x++) {
        const dx = (x - cx) / rx;
        const dy = (y - cy) / ry;
        if (dx * dx + dy * dy <= 1) this.set(x, y);
      }
    }
  }

  circle(cx: number, cy: number, r: number): void {
    this.ellipse(cx, cy, r, r);
  }

  eraseRect(x: number, y: number, w: number, h: number): void {
    for (let py = y; py < y + h; py++) {
      for (let px = x; px < x + w; px++) {
        if (px < 0 || py < 0 || px >= T || py >= T) continue;
        this.mask[py * T + px] = 0;
      }
    }
  }

  eraseCircle(cx: number, cy: number, r: number): void {
    for (let y = Math.floor(cy - r); y <= Math.ceil(cy + r); y++) {
      for (let x = Math.floor(cx - r); x <= Math.ceil(cx + r); x++) {
        if ((x - cx) * (x - cx) + (y - cy) * (y - cy) > r * r) continue;
        if (x < 0 || y < 0 || x >= T || y >= T) continue;
        this.mask[y * T + x] = 0;
      }
    }
  }

  /** Thick line (round brush) used for tool handles and blades. */
  thickLine(x0: number, y0: number, x1: number, y1: number, thickness: number): void {
    const steps = Math.max(Math.abs(x1 - x0), Math.abs(y1 - y0)) * 2;
    const radius = (thickness - 1) / 2;
    for (let i = 0; i <= steps; i++) {
      const t = steps === 0 ? 0 : i / steps;
      const cx = x0 + (x1 - x0) * t;
      const cy = y0 + (y1 - y0) * t;
      for (let dy = -Math.ceil(radius); dy <= Math.ceil(radius); dy++) {
        for (let dx = -Math.ceil(radius); dx <= Math.ceil(radius); dx++) {
          if (dx * dx + dy * dy > radius * radius + 0.35) continue;
          this.set(cx + dx, cy + dy);
        }
      }
    }
  }

  /** Even-odd scanline polygon fill (supports float points). */
  polygon(points: ReadonlyArray<readonly [number, number]>): void {
    let minY = Number.POSITIVE_INFINITY;
    let maxY = Number.NEGATIVE_INFINITY;
    for (const [, y] of points) {
      minY = Math.min(minY, y);
      maxY = Math.max(maxY, y);
    }
    for (let y = Math.floor(minY); y <= Math.ceil(maxY); y++) {
      const crossings: number[] = [];
      for (let i = 0; i < points.length; i++) {
        const [x1, y1] = points[i];
        const [x2, y2] = points[(i + 1) % points.length];
        if ((y1 <= y && y2 > y) || (y2 <= y && y1 > y)) {
          const t = (y - y1) / (y2 - y1);
          crossings.push(x1 + (x2 - x1) * t);
        }
      }
      crossings.sort((a, b) => a - b);
      for (let i = 0; i + 1 < crossings.length; i += 2) {
        for (let x = Math.ceil(crossings[i]); x <= Math.floor(crossings[i + 1]); x++) this.set(x, y);
      }
    }
  }

  /** Intersect this mask with another shape. */
  intersectWith(other: IconShape): void {
    for (let i = 0; i < this.mask.length; i++) this.mask[i] &= other.mask[i];
  }

  clone(): IconShape {
    const copy = new IconShape();
    copy.mask.set(this.mask);
    return copy;
  }
}

export function rgbaOf(hex: string): RGBA {
  return parseColor(hex);
}

export function clearCanvas(p: PixelPainter): void {
  p.fill('rgba(0,0,0,0)');
}

export function paintIconShape(
  p: PixelPainter,
  shape: IconShape,
  fill: string,
  palette: IconPalette,
  bevel = true,
): void {
  const fillColor = rgbaOf(fill);
  const light = rgbaOf(palette.light);
  const dark = rgbaOf(palette.dark);
  const edge = rgbaOf(palette.edge);
  for (let y = 0; y < T; y++) {
    for (let x = 0; x < T; x++) {
      if (shape.has(x, y)) p.set(x, y, fillColor);
    }
  }
  if (bevel) {
    for (let y = 0; y < T; y++) {
      for (let x = 0; x < T; x++) {
        if (!shape.has(x, y)) continue;
        if (!shape.has(x, y - 1)) p.set(x, y, light);
        else if (!shape.has(x, y + 1)) p.set(x, y, dark);
      }
    }
  }
  // 1 px outline just outside the silhouette
  for (let y = 0; y < T; y++) {
    for (let x = 0; x < T; x++) {
      if (shape.has(x, y)) continue;
      if (shape.has(x - 1, y) || shape.has(x + 1, y) || shape.has(x, y - 1) || shape.has(x, y + 1)) {
        p.set(x, y, edge);
      }
    }
  }
}

/** Light the outer edge on one side (axe blades, sword blades). */
export function rimLight(
  p: PixelPainter,
  shape: IconShape,
  side: 'left' | 'right' | 'top',
  color: string,
): void {
  const c = rgbaOf(color);
  for (let y = 1; y < T - 1; y++) {
    for (let x = 1; x < T - 1; x++) {
      if (!shape.has(x, y)) continue;
      const outside =
        side === 'left'
          ? !shape.has(x - 1, y)
          : side === 'right'
            ? !shape.has(x + 1, y)
            : !shape.has(x, y - 1);
      if (outside) p.set(x, y, c);
    }
  }
}

/** Deterministic colour specks constrained to a mask (ore flecks, marbling). */
export function shapeFlecks(
  p: PixelPainter,
  shape: IconShape,
  seed: number,
  colors: readonly string[],
  count: number,
): void {
  const rng = mulberry32(seed);
  const parsed = colors.map(rgbaOf);
  let placed = 0;
  let guard = 0;
  while (placed < count && guard < count * 40) {
    guard++;
    const x = Math.floor(rng() * T);
    const y = Math.floor(rng() * T);
    if (!shape.has(x, y)) continue;
    p.set(x, y, parsed[Math.floor(rng() * parsed.length)]);
    placed++;
  }
}
