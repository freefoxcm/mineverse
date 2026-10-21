import { describe, expect, it } from 'vitest';
import { createPlayerArmSkin, createPlayerSleeveSkin } from '../../src/art/playerSkin';
import type { PixelBuffer } from '../../src/art/pixels';

/**
 * Contract tests for the V4 first-person arm textures:
 * - 32x32 RGBA, fully opaque;
 * - small hard-pixel palettes (<= 8 colours), no soft noise;
 * - visible 3-4 tone shading in the centre;
 * - wrap-friendly: opposite edges are continuous (no border lines).
 */

const SIZE = 32;

function colorsOf(buffer: PixelBuffer): Set<string> {
  const colors = new Set<string>();
  for (let i = 0; i < buffer.data.length; i += 4) {
    colors.add(`${buffer.data[i]},${buffer.data[i + 1]},${buffer.data[i + 2]},${buffer.data[i + 3]}`);
  }
  return colors;
}

function pixel(buffer: PixelBuffer, x: number, y: number): number[] {
  const i = (y * SIZE + x) * 4;
  return [buffer.data[i], buffer.data[i + 1], buffer.data[i + 2], buffer.data[i + 3]];
}

function luma(rgba: readonly number[]): number {
  return rgba[0] * 0.299 + rgba[1] * 0.587 + rgba[2] * 0.114;
}

function meanEdgeDiff(
  buffer: PixelBuffer,
  edgeA: (index: number) => number[],
  edgeB: (index: number) => number[],
): number {
  let total = 0;
  for (let i = 0; i < SIZE; i++) {
    const a = edgeA(i);
    const b = edgeB(i);
    total += Math.abs(a[0] - b[0]) + Math.abs(a[1] - b[1]) + Math.abs(a[2] - b[2]);
  }
  return total / (SIZE * 3);
}

function averageColor(buffer: PixelBuffer): [number, number, number] {
  let r = 0;
  let g = 0;
  let b = 0;
  for (let i = 0; i < buffer.data.length; i += 4) {
    r += buffer.data[i];
    g += buffer.data[i + 1];
    b += buffer.data[i + 2];
  }
  const count = buffer.data.length / 4;
  return [r / count, g / count, b / count];
}

describe('player skin: geometry', () => {
  it('creates deterministic 32x32 fully opaque textures', () => {
    for (const create of [createPlayerArmSkin, createPlayerSleeveSkin]) {
      const buffer = create();
      expect(buffer.width).toBe(SIZE);
      expect(buffer.height).toBe(SIZE);
      for (let i = 3; i < buffer.data.length; i += 4) expect(buffer.data[i], 'alpha').toBe(255);
      const again = create();
      expect(Buffer.from(buffer.data).equals(Buffer.from(again.data))).toBe(true);
    }
  });

  it('uses a small hard-pixel palette (no soft noise)', () => {
    for (const create of [createPlayerArmSkin, createPlayerSleeveSkin]) {
      const colors = colorsOf(create());
      expect(colors.size).toBeGreaterThanOrEqual(3);
      expect(colors.size).toBeLessThanOrEqual(8);
    }
  });

  it('has visible 3-4 tone shading in the centre', () => {
    for (const create of [createPlayerArmSkin, createPlayerSleeveSkin]) {
      const buffer = create();
      let min = 255;
      let max = 0;
      for (let y = 4; y < SIZE - 4; y++) {
        for (let x = 4; x < SIZE - 4; x++) {
          const value = luma(pixel(buffer, x, y));
          min = Math.min(min, value);
          max = Math.max(max, value);
        }
      }
      expect(max - min, 'centre luminance range').toBeGreaterThan(20);
    }
  });
});

describe('player skin: tileability', () => {
  it('keeps opposite edges continuous so the texture can wrap an arm box', () => {
    for (const create of [createPlayerArmSkin, createPlayerSleeveSkin]) {
      const buffer = create();
      const horizontal = meanEdgeDiff(
        buffer,
        (y) => pixel(buffer, 0, y),
        (y) => pixel(buffer, SIZE - 1, y),
      );
      const vertical = meanEdgeDiff(
        buffer,
        (x) => pixel(buffer, x, 0),
        (x) => pixel(buffer, x, SIZE - 1),
      );
      expect(horizontal, 'left/right edge continuity').toBeLessThan(14);
      expect(vertical, 'top/bottom edge continuity').toBeLessThan(14);
    }
  });
});

describe('player skin: palettes', () => {
  it('uses a warm skin tone for the arm', () => {
    const [r, g, b] = averageColor(createPlayerArmSkin());
    expect(r).toBeGreaterThan(g);
    expect(g).toBeGreaterThan(b);
    expect(r - b).toBeGreaterThan(40);
  });

  it('uses a teal shirt tone for the sleeve and differs from the arm', () => {
    const arm = createPlayerArmSkin();
    const sleeve = createPlayerSleeveSkin();
    const [r, g, b] = averageColor(sleeve);
    expect(b).toBeGreaterThan(g);
    expect(g).toBeGreaterThan(r);
    expect(b - r).toBeGreaterThan(60);
    expect(Buffer.from(arm.data).equals(Buffer.from(sleeve.data))).toBe(false);
  });
});
