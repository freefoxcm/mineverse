import { describe, expect, it } from 'vitest';
import { hash2i, hash3i, hashString, mix32, Rand } from '../../src/core/rng';

describe('rng', () => {
  it('mix32 is deterministic and stays uint32', () => {
    expect(mix32(0)).toBe(mix32(0));
    for (let i = 0; i < 1000; i++) {
      const value = mix32(i * 7919);
      expect(value).toBeGreaterThanOrEqual(0);
      expect(value).toBeLessThanOrEqual(0xffffffff);
    }
  });

  it('hashString is stable for the same seed string', () => {
    expect(hashString('mineverse')).toBe(hashString('mineverse'));
    expect(hashString('mineverse')).not.toBe(hashString('mineverse2'));
  });

  it('hash2i distinguishes coordinates', () => {
    const values = new Set<number>();
    for (let x = -4; x <= 4; x++) {
      for (let z = -4; z <= 4; z++) values.add(hash2i(1234, x, z));
    }
    expect(values.size).toBe(81);
  });

  it('hash3i distinguishes coordinates', () => {
    const values = new Set<number>();
    for (let x = 0; x < 8; x++) {
      for (let y = 0; y < 8; y++) {
        for (let z = 0; z < 8; z++) values.add(hash3i(99, x, y, z));
      }
    }
    expect(values.size).toBe(512);
  });

  it('hash2f stays in [0,1)', () => {
    for (let i = 0; i < 500; i++) {
      const value = hash2i(7, i, i * 3) / 4294967296;
      expect(value).toBeGreaterThanOrEqual(0);
      expect(value).toBeLessThan(1);
    }
  });

  it('Rand produces the same sequence for the same seed', () => {
    const a = new Rand(42);
    const b = new Rand(42);
    const first = Array.from({ length: 32 }, () => a.nextUint());
    const second = Array.from({ length: 32 }, () => b.nextUint());
    expect(first).toEqual(second);
  });

  it('Rand.int respects bounds', () => {
    const random = new Rand(123);
    for (let i = 0; i < 1000; i++) {
      const value = random.int(7);
      expect(value).toBeGreaterThanOrEqual(0);
      expect(value).toBeLessThan(7);
    }
  });
});
