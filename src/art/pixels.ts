import { mulberry32 } from '../core/rng';

export type RGB = readonly [number, number, number];
export type RGBA = readonly [number, number, number, number];
export type Color = string | RGB | RGBA;

export interface PixelBuffer {
  width: number;
  height: number;
  /** RGBA, row-major, 4 bytes per pixel, row 0 = top. */
  data: Uint8ClampedArray;
}

const COLOR_CACHE = new Map<string, RGBA>();

export function parseColor(color: Color): RGBA {
  if (typeof color !== 'string') {
    return [color[0], color[1], color[2], color.length > 3 ? color[3] : 255] as RGBA;
  }
  const cached = COLOR_CACHE.get(color);
  if (cached) return cached;
  const text = color.trim();
  let rgba: RGBA;
  if (text.startsWith('rgb')) {
    // CSS "rgb(r,g,b)" / "rgba(r,g,b,a)" strings are handy for effect overlays.
    const open = text.indexOf('(');
    const close = text.lastIndexOf(')');
    const parts = text
      .slice(open + 1, close > open ? close : text.length)
      .split(',')
      .map((part) => Number.parseFloat(part.trim()));
    const clamp = (value: number, max: number) =>
      Number.isFinite(value) ? Math.max(0, Math.min(max, Math.round(value))) : 0;
    rgba = [
      clamp(parts[0] ?? 0, 255),
      clamp(parts[1] ?? 0, 255),
      clamp(parts[2] ?? 0, 255),
      clamp((parts[3] ?? 1) * 255, 255),
    ];
  } else {
    let hex = text;
    if (hex.startsWith('#')) hex = hex.slice(1);
    if (hex.length === 3) {
      hex = hex[0] + hex[0] + hex[1] + hex[1] + hex[2] + hex[2];
    } else if (hex.length === 4) {
      hex = hex[0] + hex[0] + hex[1] + hex[1] + hex[2] + hex[2] + hex[3] + hex[3];
    }
    if (hex.length === 6) hex += 'ff';
    const value = Number.parseInt(hex, 16);
    rgba = [(value >>> 24) & 255, (value >>> 16) & 255, (value >>> 8) & 255, value & 255];
  }
  COLOR_CACHE.set(color, rgba);
  return rgba;
}

export function createPixelBuffer(width: number, height: number): PixelBuffer {
  return { width, height, data: new Uint8ClampedArray(width * height * 4) };
}

export function cloneBuffer(buffer: PixelBuffer): PixelBuffer {
  return { width: buffer.width, height: buffer.height, data: new Uint8ClampedArray(buffer.data) };
}

/** Lighten/darken a color by a factor (1 = unchanged). */
export function shade(color: RGBA, factor: number): RGBA {
  return [
    Math.max(0, Math.min(255, Math.round(color[0] * factor))),
    Math.max(0, Math.min(255, Math.round(color[1] * factor))),
    Math.max(0, Math.min(255, Math.round(color[2] * factor))),
    color[3],
  ];
}

/** Mix two colors (t=0 -> a, t=1 -> b). */
export function mixColor(a: RGBA, b: RGBA, t: number): RGBA {
  return [
    Math.round(a[0] + (b[0] - a[0]) * t),
    Math.round(a[1] + (b[1] - a[1]) * t),
    Math.round(a[2] + (b[2] - a[2]) * t),
    Math.round(a[3] + (b[3] - a[3]) * t),
  ];
}

/**
 * Small immediate-mode pixel painter used by procedural texture art.
 * Pixel (0,0) is the top-left texel of the tile.
 */
export class PixelPainter {
  readonly buffer: PixelBuffer;

  constructor(width: number, height: number) {
    this.buffer = createPixelBuffer(width, height);
  }

  get width(): number {
    return this.buffer.width;
  }

  get height(): number {
    return this.buffer.height;
  }

  get data(): Uint8ClampedArray {
    return this.buffer.data;
  }

  inBounds(x: number, y: number): boolean {
    return x >= 0 && y >= 0 && x < this.width && y < this.height;
  }

  set(x: number, y: number, color: Color): void {
    if (!this.inBounds(x, y)) return;
    const rgba = parseColor(color);
    const i = (y * this.width + x) * 4;
    this.data[i] = rgba[0];
    this.data[i + 1] = rgba[1];
    this.data[i + 2] = rgba[2];
    this.data[i + 3] = rgba[3];
  }

  get(x: number, y: number): RGBA {
    const i = (y * this.width + x) * 4;
    return [this.data[i], this.data[i + 1], this.data[i + 2], this.data[i + 3]];
  }

  fill(color: Color): void {
    const rgba = parseColor(color);
    for (let i = 0; i < this.data.length; i += 4) {
      this.data[i] = rgba[0];
      this.data[i + 1] = rgba[1];
      this.data[i + 2] = rgba[2];
      this.data[i + 3] = rgba[3];
    }
  }

  /** Overwrite a rectangle. */
  rect(x: number, y: number, w: number, h: number, color: Color): void {
    const rgba = parseColor(color);
    for (let py = y; py < y + h; py++) {
      for (let px = x; px < x + w; px++) {
        if (!this.inBounds(px, py)) continue;
        const i = (py * this.width + px) * 4;
        this.data[i] = rgba[0];
        this.data[i + 1] = rgba[1];
        this.data[i + 2] = rgba[2];
        this.data[i + 3] = rgba[3];
      }
    }
  }

  /** Alpha-blend a single pixel over the current content. */
  blend(x: number, y: number, color: Color): void {
    if (!this.inBounds(x, y)) return;
    const src = parseColor(color);
    const i = (y * this.width + x) * 4;
    const sa = src[3] / 255;
    const da = this.data[i + 3] / 255;
    const outA = sa + da * (1 - sa);
    if (outA <= 0) {
      this.data[i] = this.data[i + 1] = this.data[i + 2] = this.data[i + 3] = 0;
      return;
    }
    this.data[i] = Math.round((src[0] * sa + this.data[i] * da * (1 - sa)) / outA);
    this.data[i + 1] = Math.round((src[1] * sa + this.data[i + 1] * da * (1 - sa)) / outA);
    this.data[i + 2] = Math.round((src[2] * sa + this.data[i + 2] * da * (1 - sa)) / outA);
    this.data[i + 3] = Math.round(outA * 255);
  }

  line(x0: number, y0: number, x1: number, y1: number, color: Color): void {
    let dx = Math.abs(x1 - x0);
    let dy = -Math.abs(y1 - y0);
    const sx = x0 < x1 ? 1 : -1;
    const sy = y0 < y1 ? 1 : -1;
    let err = dx + dy;
    for (;;) {
      this.set(x0, y0, color);
      if (x0 === x1 && y0 === y1) break;
      const e2 = 2 * err;
      if (e2 >= dy) {
        err += dy;
        x0 += sx;
      }
      if (e2 <= dx) {
        err += dx;
        y0 += sy;
      }
    }
  }

  /** Randomly scatter single pixels from a palette. */
  speckle(seed: number, colors: Color[], density = 1, offset = 0): void {
    const rng = mulberry32(seed);
    const parsed = colors.map(parseColor);
    const count = Math.round(this.width * this.height * density);
    const area = this.width * this.height;
    for (let i = 0; i < count; i++) {
      const p = Math.floor(rng() * area);
      const x = p % this.width;
      const y = Math.floor(p / this.width);
      const c = parsed[Math.floor(rng() * parsed.length)];
      if (offset > 0) this.blend(x, y, [c[0], c[1], c[2], offset]);
      else this.set(x, y, c);
    }
  }

  /** Fill the whole tile with one of the palette colors per pixel (weighted by order). */
  noiseFill(seed: number, colors: Color[]): void {
    const rng = mulberry32(seed);
    const parsed = colors.map(parseColor);
    for (let y = 0; y < this.height; y++) {
      for (let x = 0; x < this.width; x++) {
        this.set(x, y, parsed[Math.floor(rng() * parsed.length)]);
      }
    }
  }

  /** Fill with a checkerboard (used for missing textures). */
  checker(colorA: Color, colorB: Color, size = 4): void {
    const a = parseColor(colorA);
    const b = parseColor(colorB);
    for (let y = 0; y < this.height; y++) {
      for (let x = 0; x < this.width; x++) {
        this.set(x, y, (Math.floor(x / size) + Math.floor(y / size)) % 2 === 0 ? a : b);
      }
    }
  }

  /** Copy a rectangular region from another painter. */
  blit(source: PixelPainter, srcX: number, srcY: number, w: number, h: number, dstX: number, dstY: number): void {
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const sx = srcX + x;
        const sy = srcY + y;
        if (!source.inBounds(sx, sy)) continue;
        const rgba = source.get(sx, sy);
        const dx = dstX + x;
        const dy = dstY + y;
        if (!this.inBounds(dx, dy)) continue;
        this.set(dx, dy, rgba);
      }
    }
  }
}
