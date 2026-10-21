import { describe, expect, it } from 'vitest';
import { clamp, clamp01, floorDiv, lerp, posMod, smoothstep } from '../../src/core/math';

describe('math', () => {
  it('clamp bounds values', () => {
    expect(clamp(5, 0, 3)).toBe(3);
    expect(clamp(-2, 0, 3)).toBe(0);
    expect(clamp(1.5, 0, 3)).toBe(1.5);
  });

  it('clamp01 maps into unit range', () => {
    expect(clamp01(-1)).toBe(0);
    expect(clamp01(2)).toBe(1);
    expect(clamp01(0.25)).toBe(0.25);
  });

  it('lerp interpolates', () => {
    expect(lerp(2, 8, 0)).toBe(2);
    expect(lerp(2, 8, 1)).toBe(8);
    expect(lerp(2, 8, 0.5)).toBe(5);
  });

  it('smoothstep is monotonic and bounded', () => {
    let previous = -1;
    for (let i = 0; i <= 20; i++) {
      const value = smoothstep(0, 1, i / 20);
      expect(value).toBeGreaterThanOrEqual(previous);
      previous = value;
    }
    expect(smoothstep(0, 1, -1)).toBe(0);
    expect(smoothstep(0, 1, 2)).toBe(1);
  });

  it('floorDiv works for negatives', () => {
    expect(floorDiv(17, 16)).toBe(1);
    expect(floorDiv(-1, 16)).toBe(-1);
    expect(floorDiv(-17, 16)).toBe(-2);
  });

  it('posMod is always positive', () => {
    expect(posMod(-1, 16)).toBe(15);
    expect(posMod(17, 16)).toBe(1);
  });
});
