import { mulberry32 } from '../core/rng';
import { PixelPainter, type PixelBuffer } from './pixels';
import { Sprite16, sprite16 } from './tile16';
import { TILE_SIZE } from './types';

/**
 * First-person arm textures for the V4 3D held-item rig.
 *
 * Both textures are 32x32 RGBA and authored on the same 16x16 logical-pixel
 * grid as the block textures (each logical pixel = a crisp 2x2 block), so the
 * arm fits the rest of the art style. The patterns are wrap-friendly: there are
 * no border lines, so opposite edges are statistically continuous and the
 * texture can be repeated around an arm box without an obvious seam.
 *
 * No external assets; purely procedural and deterministic.
 */

// warm skin tone used by the current first-person arm, with 3-4 shade steps
const SKIN_BASE = '#C68F6B';
const SKIN_TONES = [SKIN_BASE, '#BD8662', '#CF9A75', '#A9714C'];
const SKIN_WRINKLE = '#A9704F';
const SKIN_HIGHLIGHT = '#D8A781';
const SKIN_FRECKLE = '#AD7652';

// teal shirt cloth for the sleeve, with a darker cuff and stitch line
const SLEEVE_BASE = '#2F8F99';
const SLEEVE_TONES = [SLEEVE_BASE, '#277B84', '#3799A4', '#216B74'];
const SLEEVE_WRINKLE = '#1D5A63';
const SLEEVE_HIGHLIGHT = '#43A6B1';
const SLEEVE_STITCH = '#5BBEC8';

function renderSkin(paint: (s: Sprite16) => void): PixelBuffer {
  const painter = new PixelPainter(TILE_SIZE, TILE_SIZE);
  painter.fill('rgba(0,0,0,0)');
  sprite16(paint)(painter);
  return painter.buffer;
}

function paintArm(s: Sprite16): void {
  // Mostly flat skin with a few hard 3-4 tone clumps (no dense noise field).
  s.fill(SKIN_BASE);
  const rng = mulberry32(0xa202);
  const clump = (color: string, count: number): void => {
    for (let i = 0; i < count; i++) {
      const x = Math.floor(rng() * 15);
      const y = Math.floor(rng() * 15);
      s.set(x, y, color);
      s.set(x + 1, y, color);
      if (rng() < 0.6) s.set(x, y + 1, color);
      if (rng() < 0.25) s.set(x + 1, y + 1, color);
    }
  };
  clump(SKIN_TONES[1], 5);
  clump(SKIN_TONES[2], 4);
  clump(SKIN_TONES[3], 3);
  // wrist/hand-back folds: short 2-3 logical-pixel creases with a lit ridge
  for (let i = 0; i < 5; i++) {
    const x = 2 + Math.floor(rng() * 11);
    const y = 2 + Math.floor(rng() * 11);
    const length = 2 + Math.floor(rng() * 2);
    for (let step = 0; step < length; step++) s.set(x + step, y, SKIN_WRINKLE);
    s.set(x, y - 1, SKIN_HIGHLIGHT);
    if (rng() < 0.5) s.set(x + length - 1, y + 1, SKIN_WRINKLE);
  }
  // a few freckles / knuckle dots
  for (let i = 0; i < 4; i++) {
    s.set(1 + Math.floor(rng() * 14), 1 + Math.floor(rng() * 14), SKIN_FRECKLE);
  }
  // knuckle highlight band (1 px, wrap-friendly)
  s.rect(11, 3, 2, 1, SKIN_HIGHLIGHT);
  s.set(4, 12, SKIN_WRINKLE);
  s.set(5, 12, SKIN_WRINKLE);
}

function paintSleeve(s: Sprite16): void {
  // Mostly flat teal cloth with hard shade clumps, folds, a cuff and stitches.
  s.fill(SLEEVE_BASE);
  const rng = mulberry32(0xb202);
  const clump = (color: string, count: number): void => {
    for (let i = 0; i < count; i++) {
      const x = Math.floor(rng() * 15);
      const y = Math.floor(rng() * 13);
      s.set(x, y, color);
      s.set(x + 1, y, color);
      if (rng() < 0.6) s.set(x, y + 1, color);
      if (rng() < 0.3) s.set(x + 1, y + 1, color);
    }
  };
  clump(SLEEVE_TONES[1], 5);
  clump(SLEEVE_TONES[2], 4);
  clump(SLEEVE_TONES[3], 3);
  // cloth folds
  for (let i = 0; i < 5; i++) {
    const x = 1 + Math.floor(rng() * 13);
    const y = 1 + Math.floor(rng() * 11);
    const length = 2 + Math.floor(rng() * 2);
    for (let step = 0; step < length; step++) s.set(x + step, y, SLEEVE_WRINKLE);
    if (rng() < 0.6) s.set(x, y - 1, SLEEVE_HIGHLIGHT);
  }
  // cuff: 1 px dark edge one row above the bottom (edge rows stay fabric so the
  // texture still tiles vertically), plus a stitched seam above it
  s.rect(0, 14, 16, 1, SLEEVE_WRINKLE);
  for (let x = 0; x < 16; x += 2) s.set(x, 13, SLEEVE_STITCH);
  s.set(3, 14, SLEEVE_HIGHLIGHT);
  s.set(11, 14, SLEEVE_HIGHLIGHT);
}

/** 32x32 warm skin texture for the first-person arm. */
export function createPlayerArmSkin(): PixelBuffer {
  return renderSkin(paintArm);
}

/** 32x32 teal shirt-sleeve texture (cuff + stitch) for the first-person arm. */
export function createPlayerSleeveSkin(): PixelBuffer {
  return renderSkin(paintSleeve);
}
