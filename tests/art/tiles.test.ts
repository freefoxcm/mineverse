import { describe, expect, it } from 'vitest';
import { PixelPainter } from '../../src/art/pixels';
import { TILE_NAMES, TILES } from '../../src/art/tiles';
import { TILE_SIZE } from '../../src/art/types';
import { BLOCKS, faceTexture } from '../../src/world/blocks';

/**
 * Contract tests for the block texture set:
 * - every block face name used by blocks.ts resolves to a painter;
 * - the engine overlay tiles (crack_0..9) exist;
 * - every tile is 32x32 and deterministic (painter run twice = same bytes);
 * - opaque block tiles are fully opaque, cutout tiles contain transparent texels.
 */

function paint(painter: (p: PixelPainter) => void): PixelPainter {
  const p = new PixelPainter(TILE_SIZE, TILE_SIZE);
  p.fill('rgba(0,0,0,0)');
  painter(p);
  return p;
}

/** Every tile name referenced by a block face. */
function referencedTiles(): string[] {
  const names = new Set<string>();
  for (const block of BLOCKS) {
    for (let face = 0; face < 6; face++) names.add(faceTexture(block, face));
  }
  return [...names].sort();
}

describe('tiles: coverage', () => {
  it('covers every block face name referenced by blocks.ts', () => {
    const missing = referencedTiles().filter((name) => !(name in TILES));
    expect(missing).toEqual([]);
  });

  it('provides crack_0 .. crack_9 for the breaking overlay', () => {
    for (let stage = 0; stage < 10; stage++) {
      expect(typeof TILES[`crack_${stage}`]).toBe('function');
    }
  });

  it('TILE_NAMES mirrors the TILES registry without duplicates', () => {
    expect([...TILE_NAMES].sort()).toEqual(Object.keys(TILES).sort());
    expect(new Set(TILE_NAMES).size).toBe(TILE_NAMES.length);
  });

  it('has no unused tile names outside the atlas contract set', () => {
    const referenced = new Set(referencedTiles());
    for (let stage = 0; stage < 10; stage++) referenced.add(`crack_${stage}`);
    const extra = Object.keys(TILES).filter((name) => !referenced.has(name));
    expect(extra).toEqual([]);
  });
});

describe('tiles: geometry and determinism', () => {
  it('paints 32x32 buffers for every tile', () => {
    for (const name of TILE_NAMES) {
      const p = paint(TILES[name]);
      expect(p.width, name).toBe(TILE_SIZE);
      expect(p.height, name).toBe(TILE_SIZE);
    }
  });

  it('is deterministic: two independent runs produce identical bytes', () => {
    for (const name of TILE_NAMES) {
      const a = paint(TILES[name]);
      const b = paint(TILES[name]);
      expect(Buffer.from(a.data).equals(Buffer.from(b.data)), name).toBe(true);
    }
  });

  it('is idempotent: painting twice on the same buffer is a no-op', () => {
    for (const name of TILE_NAMES) {
      const once = paint(TILES[name]);
      const twice = new PixelPainter(TILE_SIZE, TILE_SIZE);
      twice.fill('rgba(0,0,0,0)');
      TILES[name](twice);
      TILES[name](twice);
      expect(Buffer.from(once.data).equals(Buffer.from(twice.data)), name).toBe(true);
    }
  });
});

describe('tiles: transparency contract', () => {
  const OPAQUE_SKIP = new Set([
    'ice',
    'water',
    'lava',
    'glass',
    'torch',
    'sugar_cane',
    'tall_grass',
    'poppy',
    'dandelion',
    'dead_bush',
    'oak_leaves',
    'birch_leaves',
    'spruce_leaves',
  ]);

  it('opaque block tiles have no transparent pixels', () => {
    for (const block of BLOCKS) {
      if (block.alpha !== 'opaque') continue;
      const names = new Set<string>();
      for (let face = 0; face < 6; face++) names.add(faceTexture(block, face));
      for (const name of names) {
        if (OPAQUE_SKIP.has(name)) continue;
        const p = paint(TILES[name]);
        let transparent = 0;
        for (let i = 3; i < p.data.length; i += 4) if (p.data[i] === 0) transparent++;
        expect(transparent, `${name} (block ${block.id})`).toBe(0);
      }
    }
  });

  it('cutout/transparent tiles keep real transparent texels', () => {
    const cutoutTiles = ['glass', 'torch', 'sugar_cane', 'tall_grass', 'poppy', 'dandelion', 'dead_bush'];
    for (const name of cutoutTiles) {
      const p = paint(TILES[name]);
      let transparent = 0;
      for (let i = 3; i < p.data.length; i += 4) if (p.data[i] === 0) transparent++;
      expect(transparent, name).toBeGreaterThan(0);
    }
    // leaves are cutout as well and need clustered holes (>=8% of the tile)
    for (const name of ['oak_leaves', 'birch_leaves', 'spruce_leaves']) {
      const p = paint(TILES[name]);
      let transparent = 0;
      for (let i = 3; i < p.data.length; i += 4) if (p.data[i] === 0) transparent++;
      expect(transparent / (TILE_SIZE * TILE_SIZE), name).toBeGreaterThan(0.08);
    }
  });

  it('glass keeps a transparent interior with an opaque frame', () => {
    const p = paint(TILES.glass);
    // frame corners are opaque, centre is fully transparent
    expect(p.get(0, 0)[3]).toBe(255);
    expect(p.get(TILE_SIZE - 1, TILE_SIZE - 1)[3]).toBe(255);
    expect(p.get(TILE_SIZE - 8, 8)[3]).toBe(0);
  });
});

describe('tiles: crack overlay', () => {
  it('crack stages are semi-transparent dark overlays', () => {
    const p = paint(TILES.crack_0);
    let transparent = 0;
    let opaque = 0;
    let maxAlpha = 0;
    for (let i = 0; i < p.data.length; i += 4) {
      if (p.data[i + 3] === 0) transparent++;
      else {
        opaque++;
        maxAlpha = Math.max(maxAlpha, p.data[i + 3]);
        expect(p.data[i]).toBeLessThan(40); // dark crack colour
        expect(p.data[i + 1]).toBeLessThan(40);
      }
    }
    expect(transparent).toBeGreaterThan(0);
    expect(opaque).toBeGreaterThan(10);
    expect(maxAlpha).toBeLessThan(255);
    expect(maxAlpha).toBeGreaterThan(40);
  });

  it('later crack stages cover more of the tile and get darker', () => {
    function coverage(stage: number): number {
      const p = paint(TILES[`crack_${stage}`]);
      let lit = 0;
      for (let i = 3; i < p.data.length; i += 4) if (p.data[i] > 0) lit++;
      return lit;
    }
    expect(coverage(9)).toBeGreaterThan(coverage(0));
    const early = paint(TILES.crack_0);
    const late = paint(TILES.crack_9);
    let earlyMax = 0;
    let lateMax = 0;
    for (let i = 3; i < early.data.length; i += 4) earlyMax = Math.max(earlyMax, early.data[i]);
    for (let i = 3; i < late.data.length; i += 4) lateMax = Math.max(lateMax, late.data[i]);
    expect(lateMax).toBeGreaterThan(earlyMax);
  });
});

describe('tiles: no high-frequency white noise', () => {
  /** Fraction of horizontal neighbour pairs whose luminance jumps hard. */
  function roughPairRatio(name: string, threshold = 46): number {
    const p = paint(TILES[name]);
    let pairs = 0;
    let rough = 0;
    for (let y = 0; y < TILE_SIZE; y++) {
      for (let x = 0; x < TILE_SIZE - 1; x++) {
        const a = p.get(x, y);
        const b = p.get(x + 1, y);
        if (a[3] === 0 || b[3] === 0) continue;
        const la = a[0] * 0.299 + a[1] * 0.587 + a[2] * 0.114;
        const lb = b[0] * 0.299 + b[1] * 0.587 + b[2] * 0.114;
        pairs++;
        if (Math.abs(la - lb) > threshold) rough++;
      }
    }
    return pairs === 0 ? 0 : rough / pairs;
  }

  it('terrain base tiles cluster their colour variation', () => {
    for (const name of ['stone', 'dirt', 'grass_top', 'sand', 'oak_log', 'cobblestone', 'water', 'lava']) {
      expect(roughPairRatio(name), name).toBeLessThan(0.2);
    }
  });
});
