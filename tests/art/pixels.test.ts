import { describe, expect, it } from 'vitest';
import {
  PixelPainter,
  cloneBuffer,
  createPixelBuffer,
  mixColor,
  parseColor,
  shade,
} from '../../src/art/pixels';

/**
 * Contract tests for the pixel primitives every procedural asset builds on.
 * (parseColor gained CSS rgb()/rgba() support and 4-digit hex support for
 * effect overlays, so those formats are pinned down here.)
 */

describe('pixels: colour parsing', () => {
  it('parses hex colours with #, 3, 4, 6 and 8 digits', () => {
    expect(parseColor('#ffffff')).toEqual([255, 255, 255, 255]);
    expect(parseColor('000000')).toEqual([0, 0, 0, 255]);
    expect(parseColor('#abc')).toEqual([170, 187, 204, 255]);
    expect(parseColor('#abcd')).toEqual([170, 187, 204, 221]);
    expect(parseColor('#11223344')).toEqual([17, 34, 51, 68]);
  });

  it('parses CSS rgb()/rgba() strings', () => {
    expect(parseColor('rgb(10, 20, 30)')).toEqual([10, 20, 30, 255]);
    expect(parseColor('rgba(10, 20, 30, 0.5)')).toEqual([10, 20, 30, 128]);
    expect(parseColor('rgba(0,0,0,0)')).toEqual([0, 0, 0, 0]);
    expect(parseColor('rgba(255,255,255,1)')).toEqual([255, 255, 255, 255]);
  });

  it('accepts RGB / RGBA tuples', () => {
    expect(parseColor([1, 2, 3])).toEqual([1, 2, 3, 255]);
    expect(parseColor([1, 2, 3, 4])).toEqual([1, 2, 3, 4]);
  });
});

describe('pixels: painter primitives', () => {
  it('creates and clones buffers', () => {
    const buffer = createPixelBuffer(3, 2);
    expect(buffer.data.length).toBe(3 * 2 * 4);
    const copy = cloneBuffer(buffer);
    expect(copy.data).not.toBe(buffer.data);
    expect(copy.data.length).toBe(buffer.data.length);
  });

  it('sets, fills, rects and blends pixels', () => {
    const p = new PixelPainter(4, 4);
    p.fill('#102030');
    expect(p.get(0, 0)).toEqual([16, 32, 48, 255]);
    p.set(1, 1, '#ff0000');
    expect(p.get(1, 1)).toEqual([255, 0, 0, 255]);
    p.rect(2, 2, 2, 2, 'rgba(255,255,255,0.5)');
    expect(p.get(3, 3)).toEqual([255, 255, 255, 128]);
    p.blend(0, 0, 'rgba(255,255,255,0.5)');
    const blended = p.get(0, 0);
    expect(blended[0]).toBeGreaterThan(16);
    expect(blended[0]).toBeLessThan(255);
    // out-of-bounds writes are ignored
    p.set(-1, -1, '#ffffff');
    p.set(99, 99, '#ffffff');
  });

  it('draws lines, checkers and noise deterministically', () => {
    const a = new PixelPainter(8, 8);
    a.line(0, 0, 7, 7, '#ffffff');
    expect(a.get(3, 3)).toEqual([255, 255, 255, 255]);

    const checker = new PixelPainter(8, 8);
    checker.checker('#000000', '#ffffff', 2);
    expect(checker.get(0, 0)).toEqual([0, 0, 0, 255]);
    expect(checker.get(2, 0)).toEqual([255, 255, 255, 255]);

    const noiseA = new PixelPainter(8, 8);
    noiseA.noiseFill(123, ['#000000', '#ffffff']);
    const noiseB = new PixelPainter(8, 8);
    noiseB.noiseFill(123, ['#000000', '#ffffff']);
    expect(Buffer.from(noiseA.data).equals(Buffer.from(noiseB.data))).toBe(true);

    const speckledA = new PixelPainter(8, 8);
    speckledA.speckle(99, ['#ffffff'], 0.5);
    const speckledB = new PixelPainter(8, 8);
    speckledB.speckle(99, ['#ffffff'], 0.5);
    expect(Buffer.from(speckledA.data).equals(Buffer.from(speckledB.data))).toBe(true);
  });
});

describe('pixels: colour helpers', () => {
  it('shades and mixes colours', () => {
    expect(shade([100, 120, 140, 255], 0.5)).toEqual([50, 60, 70, 255]);
    expect(shade([100, 120, 140, 255], 3)).toEqual([255, 255, 255, 255]);
    expect(mixColor([0, 0, 0, 255], [255, 255, 255, 255], 0.5)).toEqual([128, 128, 128, 255]);
  });
});
