import { describe, expect, it } from 'vitest';
import {
  MOB_SKIN_NAMES,
  MOB_SKINS,
  createMobSkin,
  mobSkinDominantColor,
  paintMobSkin,
} from '../../src/art/mobSkins';
import { PixelPainter } from '../../src/art/pixels';
import { TILE_SIZE } from '../../src/art/types';
import { MOB_TEXTURE_FALLBACK_COLORS, MOB_TEXTURE_NAMES } from '../../src/entities/models';

/**
 * Contract tests for the mob skins against Entities-D's model definitions:
 * - MOB_SKINS covers exactly the texture keys used by MOB_MODELS;
 * - every skin is a 32x32 opaque, deterministic tile;
 * - head textures carry face detail (eyes) inside the top-left 16x16 rectangle
 *   that `frontUv` samples;
 * - dominant colours stay close to the renderer fallback colours.
 */

function paint(key: string): PixelPainter {
  const p = new PixelPainter(TILE_SIZE, TILE_SIZE);
  p.fill('rgba(0,0,0,0)');
  MOB_SKINS[key](p);
  return p;
}

function luma(rgba: readonly number[]): number {
  return rgba[0] * 0.299 + rgba[1] * 0.587 + rgba[2] * 0.114;
}

describe('mob skins: coverage', () => {
  it('covers exactly the texture keys of the entity models', () => {
    expect([...MOB_SKIN_NAMES].sort()).toEqual([...MOB_TEXTURE_NAMES].sort());
  });

  it('provides the 29 keys agreed with Entities-D', () => {
    expect(MOB_SKIN_NAMES.length).toBe(29);
    for (const key of [
      'zombie_head',
      'skeleton_leg',
      'creeper_body',
      'spider_leg',
      'pig_head',
      'cow_horn',
      'sheep_wool',
      'chicken_beak',
      'chicken_wing',
    ]) {
      expect(MOB_SKIN_NAMES, key).toContain(key);
    }
  });
});

describe('mob skins: geometry / determinism', () => {
  it('paints opaque 32x32 tiles', () => {
    for (const key of MOB_SKIN_NAMES) {
      const p = paint(key);
      expect(p.width, key).toBe(TILE_SIZE);
      expect(p.height, key).toBe(TILE_SIZE);
      for (let i = 3; i < p.data.length; i += 4) {
        expect(p.data[i], `${key} alpha`).toBe(255);
      }
    }
  });

  it('is deterministic and idempotent', () => {
    for (const key of MOB_SKIN_NAMES) {
      const a = paint(key);
      const b = paint(key);
      expect(Buffer.from(a.data).equals(Buffer.from(b.data)), key).toBe(true);

      const twice = new PixelPainter(TILE_SIZE, TILE_SIZE);
      twice.fill('rgba(0,0,0,0)');
      MOB_SKINS[key](twice);
      MOB_SKINS[key](twice);
      expect(Buffer.from(a.data).equals(Buffer.from(twice.data)), key).toBe(true);
    }
  });
});

describe('mob skins: faces', () => {
  it('head textures carry eyes inside the top-left 16x16 face rectangle', () => {
    const heads = MOB_SKIN_NAMES.filter((key) => key.endsWith('_head'));
    expect(heads.length).toBe(8);
    for (const key of heads) {
      const p = paint(key);
      let dark = 0;
      for (let y = 0; y < 16; y++) {
        for (let x = 0; x < 16; x++) {
          if (luma(p.get(x, y)) < 70) dark++;
        }
      }
      expect(dark, `${key} dark face pixels`).toBeGreaterThanOrEqual(2);
    }
  });
});

describe('mob skins: palette matches renderer fallbacks', () => {
  it('stays close to MOB_TEXTURE_FALLBACK_COLORS', () => {
    for (const key of MOB_SKIN_NAMES) {
      const fallback = MOB_TEXTURE_FALLBACK_COLORS[key];
      expect(fallback, key).toBeTypeOf('number');
      const [r, g, b] = mobSkinDominantColor(key);
      const fr = (fallback >> 16) & 255;
      const fg = (fallback >> 8) & 255;
      const fb = fallback & 255;
      expect(Math.abs(r - fr), `${key} red`).toBeLessThan(80);
      expect(Math.abs(g - fg), `${key} green`).toBeLessThan(80);
      expect(Math.abs(b - fb), `${key} blue`).toBeLessThan(80);
    }
  });
});

describe('mob skins: helpers', () => {
  it('handles unknown keys', () => {
    const p = new PixelPainter(TILE_SIZE, TILE_SIZE);
    p.fill('#ff00ff');
    expect(paintMobSkin('nope', p)).toBe(false);
    expect(p.get(0, 0)[3]).toBe(0);
    expect(paintMobSkin('zombie_head', p)).toBe(true);
    expect(createMobSkin('nope')).toBeNull();
    expect(createMobSkin('zombie_head')?.width).toBe(TILE_SIZE);
  });
});
