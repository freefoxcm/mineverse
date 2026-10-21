import { mulberry32 } from '../core/rng';
import { specks, tone } from './pixelKit';
import { PixelPainter, type PixelBuffer } from './pixels';
import { TILE_SIZE as T, type MobPainter } from './types';

/**
 * Procedural mob skin textures for the eight MineVerse creatures.
 *
 * Contract (see `src/entities/models.ts`):
 * - one 32x32 RGBA texture per unique `ModelPart.texture` key, transparent bg;
 * - exported as `MOB_SKINS: Record<string, MobPainter>`;
 * - head parts map only their +Z face to the **top-left 16x16** pixel rectangle,
 *   so each face is painted inside `[0,16) x [0,16)` and the rest of the tile is
 *   generic skin (back of the head / side texture).
 *
 * All textures are original pixel art derived from a seeded palette; no external
 * image assets and no Math.random().
 */

// ---------------------------------------------------------------------------
// shared skin helpers
// ---------------------------------------------------------------------------

interface SkinPalette {
  base: string;
  light: string;
  dark: string;
}

const SKIN: SkinPalette = { base: '#5b8f4a', light: '#6fa25a', dark: '#446f37' };
const BONE: SkinPalette = { base: '#d8d8cc', light: '#eaeae0', dark: '#b4b4a8' };
const PINK: SkinPalette = { base: '#e8a3a3', light: '#f2bcbc', dark: '#c98989' };
const FUR_BROWN: SkinPalette = { base: '#8a6a4a', light: '#9c7a58', dark: '#6f5238' };
const WOOL: SkinPalette = { base: '#ece8dd', light: '#f6f3ea', dark: '#d6d1c4' };
const FEATHER: SkinPalette = { base: '#ecece6', light: '#f8f8f4', dark: '#d4d4cc' };
const DARK_FUZZ: SkinPalette = { base: '#3a2f28', light: '#4a3c33', dark: '#2a221d' };
const CREEPER: SkinPalette = { base: '#58b558', light: '#68c468', dark: '#3f9a3f' };
const SHIRT: SkinPalette = { base: '#2f5b5b', light: '#3a6a6a', dark: '#244848' };
const TROUSERS: SkinPalette = { base: '#3a3a6e', light: '#454580', dark: '#2d2d57' };
const HORN: SkinPalette = { base: '#d9d2c2', light: '#ece6d8', dark: '#b0a892' };

/**
 * Generic mottled skin: one low-frequency tone pass plus a few clusters so the
 * texture never looks like flat paint or per-pixel noise.
 */
function paintSkin(p: PixelPainter, seed: number, palette: SkinPalette, clusterCount = 6): void {
  p.fill(palette.base);
  tone(p, seed, palette.light, palette.dark, { cell: 6, strength: 0.16, levels: 4 });
  const rng = mulberry32(seed ^ 0x7151);
  for (let i = 0; i < clusterCount; i++) {
    const cx = Math.floor(rng() * T);
    const cy = Math.floor(rng() * T);
    const color = rng() < 0.5 ? palette.light : palette.dark;
    const w = 2 + Math.floor(rng() * 3);
    const h = 2 + Math.floor(rng() * 3);
    for (let dy = 0; dy < h; dy++) {
      for (let dx = 0; dx < w; dx++) {
        p.set((cx + dx) % T, (cy + dy) % T, color);
      }
    }
  }
  specks(p, seed ^ 0x2c4, [palette.dark, palette.light], 8);
}

function paintFaceBase(p: PixelPainter, base: string): void {
  p.rect(0, 0, 16, 16, base);
}

function paintEyes(
  p: PixelPainter,
  color: string,
  left: readonly [number, number],
  right: readonly [number, number],
  width = 3,
  height = 2,
): void {
  p.rect(left[0], left[1], width, height, color);
  p.rect(right[0], right[1], width, height, color);
}

// ---------------------------------------------------------------------------
// head faces (painted into the top-left 16x16 rectangle)
// ---------------------------------------------------------------------------

function zombieHead(seed: number): MobPainter {
  return (p) => {
    paintSkin(p, seed, SKIN, 6);
    // face
    paintFaceBase(p, '#5f8f4a');
    p.rect(0, 0, 16, 4, '#3f6f30'); // hair line
    p.rect(1, 3, 14, 1, '#4a7a37');
    paintEyes(p, '#22301c', [3, 6], [10, 6], 3, 2);
    p.set(4, 5, '#3f5a33');
    p.set(11, 5, '#3f5a33');
    // mouth + stitched jaw
    p.rect(6, 11, 4, 1, '#2a3a22');
    p.set(5, 10, '#2a3a22');
    p.set(10, 10, '#2a3a22');
    p.rect(7, 12, 2, 1, '#4a6a3a');
    // sickly cheek patches
    p.rect(2, 9, 2, 2, '#527a3f');
    p.rect(12, 9, 2, 2, '#527a3f');
    p.set(8, 4, '#6fa25a');
  };
}

function skeletonHead(seed: number): MobPainter {
  return (p) => {
    paintSkin(p, seed, BONE, 4);
    paintFaceBase(p, '#d4d4c6');
    // eye sockets, nose, jaw
    p.rect(3, 5, 3, 3, '#1c1c18');
    p.rect(10, 5, 3, 3, '#1c1c18');
    p.rect(4, 6, 1, 1, '#4a4a42');
    p.rect(11, 6, 1, 1, '#4a4a42');
    p.rect(7, 8, 2, 2, '#9a9a8c');
    // nasal cavity
    p.rect(7, 9, 2, 2, '#3a3a32');
    // teeth
    for (let x = 5; x < 11; x += 2) {
      p.rect(x, 12, 1, 2, '#a8a89a');
      p.rect(x, 14, 1, 1, '#6f6f62');
    }
    p.rect(4, 13, 8, 1, '#a8a89a');
    p.rect(4, 15, 8, 1, '#7f7f72');
    // cheek shadows
    p.rect(1, 8, 2, 3, '#bcbcae');
    p.rect(13, 8, 2, 3, '#bcbcae');
  };
}

function creeperHead(seed: number): MobPainter {
  return (p) => {
    paintSkin(p, seed, CREEPER, 7);
    paintFaceBase(p, '#5cbc5c');
    // mottled face
    const rng = mulberry32(seed ^ 0x33);
    for (let i = 0; i < 12; i++) {
      const x = Math.floor(rng() * 16);
      const y = Math.floor(rng() * 16);
      p.set(x, y, rng() < 0.5 ? '#54b254' : '#65c665');
    }
    // the classic angry/frowning creeper arrangement, drawn from scratch
    p.rect(2, 5, 3, 3, '#0e2a0e');
    p.rect(11, 5, 3, 3, '#0e2a0e');
    p.rect(5, 10, 6, 2, '#0e2a0e');
    p.rect(4, 8, 2, 3, '#0e2a0e');
    p.rect(10, 8, 2, 3, '#0e2a0e');
    p.rect(6, 12, 4, 2, '#0e2a0e');
    p.rect(2, 9, 2, 6, '#4aa84a');
    p.rect(12, 9, 2, 6, '#4aa84a');
  };
}

function spiderHead(seed: number): MobPainter {
  return (p) => {
    paintSkin(p, seed, DARK_FUZZ, 8);
    paintFaceBase(p, '#342a24');
    // six red eyes in two rows
    const eyes: ReadonlyArray<readonly [number, number]> = [
      [2, 5],
      [6, 4],
      [10, 4],
      [13, 5],
      [4, 8],
      [10, 8],
    ];
    for (const [x, y] of eyes) {
      p.rect(x, y, 2, 1, '#d42a1e');
      p.set(x, y, '#ff6a4a');
    }
    // fangs
    p.rect(6, 12, 1, 2, '#e0d8c8');
    p.rect(9, 12, 1, 2, '#e0d8c8');
    p.rect(6, 14, 1, 1, '#a89f8e');
    p.rect(9, 14, 1, 1, '#a89f8e');
    p.rect(1, 2, 3, 2, '#4a3c33');
    p.rect(12, 2, 3, 2, '#4a3c33');
  };
}

function pigHead(seed: number): MobPainter {
  return (p) => {
    paintSkin(p, seed, PINK, 5);
    paintFaceBase(p, '#e8a3a3');
    // ears
    p.rect(1, 2, 3, 4, '#d98c8c');
    p.rect(12, 2, 3, 4, '#d98c8c');
    p.set(2, 3, '#f2bcbc');
    p.set(13, 3, '#f2bcbc');
    // eyes
    p.rect(3, 6, 2, 2, '#f4e8e0');
    p.rect(11, 6, 2, 2, '#f4e8e0');
    p.set(4, 7, '#1e1a18');
    p.set(12, 7, '#1e1a18');
    // snout
    p.rect(4, 9, 8, 5, '#d98787');
    p.rect(5, 10, 6, 3, '#c97575');
    p.rect(5, 11, 1, 1, '#7a3f3f');
    p.rect(10, 11, 1, 1, '#7a3f3f');
    p.rect(4, 9, 8, 1, '#f0b0b0');
  };
}

function cowHead(seed: number): MobPainter {
  return (p) => {
    paintSkin(p, seed, FUR_BROWN, 6);
    paintFaceBase(p, '#5f4632');
    // white blaze
    p.rect(6, 0, 4, 8, '#e8e2d4');
    p.rect(5, 7, 6, 4, '#e8e2d4');
    // muzzle
    p.rect(3, 10, 10, 5, '#d8c8b4');
    p.rect(4, 11, 8, 2, '#c4b09a');
    p.rect(4, 12, 1, 1, '#5a4634');
    p.rect(10, 12, 1, 1, '#5a4634');
    // eyes
    p.rect(2, 5, 2, 2, '#f0e8dc');
    p.rect(12, 5, 2, 2, '#f0e8dc');
    p.set(2, 6, '#1e1a16');
    p.set(12, 6, '#1e1a16');
    // horns at the top corners
    p.rect(0, 1, 2, 2, '#d9d2c2');
    p.rect(14, 1, 2, 2, '#d9d2c2');
    p.set(0, 0, '#ece6d8');
    p.set(15, 0, '#ece6d8');
  };
}

function sheepHead(seed: number): MobPainter {
  return (p) => {
    paintSkin(p, seed, WOOL, 7);
    // wool fringe around the face
    paintFaceBase(p, '#ece8dd');
    p.rect(3, 3, 10, 10, '#d8c0a8');
    p.rect(2, 1, 12, 3, '#f2efe6');
    p.rect(1, 2, 2, 6, '#e8e4d8');
    p.rect(13, 2, 2, 6, '#e8e4d8');
    // eyes
    p.rect(5, 6, 2, 2, '#1e1a16');
    p.rect(9, 6, 2, 2, '#1e1a16');
    p.set(5, 6, '#4a4038');
    p.set(9, 6, '#4a4038');
    // nose / mouth
    p.rect(7, 9, 3, 2, '#b89f88');
    p.rect(7, 11, 3, 1, '#8f7560');
    p.rect(5, 12, 2, 1, '#c4aa92');
    p.rect(10, 12, 2, 1, '#c4aa92');
  };
}

function chickenHead(seed: number): MobPainter {
  return (p) => {
    paintSkin(p, seed, FEATHER, 5);
    paintFaceBase(p, '#ecece6');
    // comb
    p.rect(3, 0, 2, 3, '#c83030');
    p.rect(6, 0, 2, 2, '#c83030');
    p.rect(9, 0, 2, 3, '#c83030');
    // eyes
    p.rect(4, 5, 2, 1, '#1e1a16');
    p.rect(10, 5, 2, 1, '#1e1a16');
    p.set(4, 5, '#3a3a32');
    p.set(10, 5, '#3a3a32');
    // beak
    p.rect(6, 7, 4, 2, '#e8b02a');
    p.rect(7, 9, 2, 1, '#c89018');
    p.rect(6, 7, 4, 1, '#f8d060');
    // wattle
    p.rect(7, 10, 2, 2, '#d83838');
    p.rect(7, 12, 2, 1, '#b02828');
    // cheek feathers
    p.rect(2, 8, 2, 3, '#dcded8');
    p.rect(12, 8, 2, 3, '#dcded8');
  };
}

// ---------------------------------------------------------------------------
// body / limb textures
// ---------------------------------------------------------------------------

function plainSkin(seed: number, palette: SkinPalette, clusters = 6): MobPainter {
  return (p) => {
    paintSkin(p, seed, palette, clusters);
  };
}

/** Skeleton limbs: bone shafts with dark joints at both ends. */
function boneLimb(seed: number, joints: boolean): MobPainter {
  return (p) => {
    paintSkin(p, seed, BONE, 4);
    if (joints) {
      p.rect(0, 0, T, 2, '#a8a89a');
      p.rect(0, T - 2, T, 2, '#a8a89a');
      p.rect(0, 0, 2, T, '#b4b4a6');
      p.rect(T - 2, 0, 2, T, '#a0a092');
      p.rect(4, 4, 2, 5, '#c8c8ba');
      p.rect(20, 14, 2, 6, '#9a9a8c');
    }
  };
}

/** Skeleton torso: rib cage bands. */
function skeletonBody(seed: number): MobPainter {
  return (p) => {
    paintSkin(p, seed, BONE, 4);
    // spine
    p.rect(14, 2, 4, T - 4, '#c4c4b6');
    // ribs
    for (let y = 4; y < T - 3; y += 5) {
      p.rect(3, y, 26, 2, '#bcbcae');
      p.rect(3, y + 2, 26, 1, '#a0a092');
    }
    p.rect(0, 0, T, 2, '#a0a092');
    p.rect(0, T - 2, T, 2, '#a0a092');
  };
}

/** Creeper body: darker underbelly band and mottled green. */
function creeperBody(seed: number): MobPainter {
  return (p) => {
    paintSkin(p, seed, CREEPER, 8);
    p.rect(0, 20, T, 4, '#3f8a3f');
    p.rect(0, 24, T, 2, '#357a35');
    p.rect(4, 6, 3, 3, '#6dcc6d');
    p.rect(22, 10, 4, 2, '#4aa84a');
    p.rect(10, 14, 2, 2, '#3f9a3f');
  };
}

function spiderBody(seed: number, leg: boolean): MobPainter {
  return (p) => {
    paintSkin(p, seed, DARK_FUZZ, 9);
    // coarse hair pattern
    const rng = mulberry32(seed ^ 0x4d);
    for (let i = 0; i < 26; i++) {
      const x = Math.floor(rng() * T);
      const y = Math.floor(rng() * T);
      p.set(x, y, rng() < 0.5 ? '#4a3c33' : '#241c18');
      if (rng() < 0.4) p.set((x + 1) % T, (y + 1) % T, '#332820');
    }
    if (!leg) {
      // abdomen marking
      p.rect(9, 8, 14, 14, '#332820');
      p.rect(11, 10, 10, 10, '#2a221d');
      p.rect(13, 13, 6, 4, '#3f3128');
    }
  };
}

function pigBody(seed: number): MobPainter {
  return (p) => {
    paintSkin(p, seed, PINK, 6);
    // mud patches
    const rng = mulberry32(seed ^ 0x6d);
    for (let i = 0; i < 5; i++) {
      const x = 4 + Math.floor(rng() * 22);
      const y = 4 + Math.floor(rng() * 22);
      p.rect(x, y, 3 + Math.floor(rng() * 3), 2 + Math.floor(rng() * 2), '#c08a6a');
    }
    p.rect(0, 0, T, 2, '#d68f8f');
    p.rect(0, T - 2, T, 2, '#d68f8f');
  };
}

function cowBody(seed: number): MobPainter {
  return (p) => {
    paintSkin(p, seed, FUR_BROWN, 6);
    // white patches
    p.rect(2, 2, 11, 9, '#e8e2d4');
    p.rect(5, 7, 5, 6, '#e8e2d4');
    p.rect(18, 5, 10, 8, '#e8e2d4');
    p.rect(14, 20, 9, 8, '#e8e2d4');
    p.rect(3, 23, 8, 6, '#e8e2d4');
    // hide wrinkles
    p.rect(0, 17, T, 1, '#6f5238');
    p.rect(24, 2, 2, 12, '#6f5238');
    specks(p, seed ^ 0x11, ['#9c7a58', '#5f4630'], 10);
  };
}

function sheepWool(seed: number): MobPainter {
  return (p) => {
    paintSkin(p, seed, WOOL, 8);
    // fluffy curls
    const rng = mulberry32(seed ^ 0x21);
    for (let i = 0; i < 16; i++) {
      const x = Math.floor(rng() * T);
      const y = Math.floor(rng() * T);
      p.set(x, y, '#f8f5ec');
      p.set((x + 1) % T, y, '#f8f5ec');
      p.set(x, (y + 1) % T, '#ded9cc');
    }
    p.rect(0, 0, T, 2, '#f8f5ec');
    p.rect(0, T - 2, T, 2, '#d6d1c4');
  };
}

function chickenBody(seed: number): MobPainter {
  return (p) => {
    paintSkin(p, seed, FEATHER, 6);
    // layered feather rows
    for (let y = 3; y < T; y += 5) {
      p.rect(1, y, T - 2, 1, '#d8d8d0');
      p.rect(2, y + 1, T - 4, 1, '#e4e4dc');
    }
    p.rect(0, 0, T, 2, '#f8f8f4');
    p.rect(0, T - 2, T, 2, '#c8c8c0');
  };
}

function chickenWing(seed: number): MobPainter {
  return (p) => {
    paintSkin(p, seed, FEATHER, 4);
    // long flight feathers
    for (let y = 4; y < T - 4; y += 4) {
      p.rect(6, y, 20, 2, '#d4d4cc');
      p.rect(7, y, 18, 1, '#e8e8e0');
      p.rect(24, y, 2, 1, '#b8b8b0');
    }
    p.rect(0, 0, T, 3, '#f0f0ea');
    p.rect(0, T - 3, T, 3, '#d4d4cc');
  };
}

function beakTexture(seed: number): MobPainter {
  return (p) => {
    paintSkin(p, seed, { base: '#e8b02a', light: '#f8d060', dark: '#c89018' }, 3);
    p.rect(0, 0, T, 4, '#f8d060');
    p.rect(0, T - 4, T, 4, '#b88210');
    p.rect(8, 8, 16, 3, '#c89018');
  };
}

function hornTexture(seed: number): MobPainter {
  return (p) => {
    paintSkin(p, seed, HORN, 4);
    // rings
    for (let y = 5; y < T; y += 7) p.rect(0, y, T, 2, '#b0a892');
    p.rect(0, 0, T, 2, '#ece6d8');
    p.rect(0, T - 2, T, 2, '#9a927e');
  };
}

// ---------------------------------------------------------------------------
// registry (key names exactly match src/entities/models.ts MOB_TEXTURE_NAMES)
// ---------------------------------------------------------------------------

const MOB_SKINS: Record<string, MobPainter> = {
  zombie_head: zombieHead(0xb101),
  zombie_body: plainSkin(0xb102, SHIRT, 7),
  zombie_arm: plainSkin(0xb103, SKIN, 6),
  zombie_leg: plainSkin(0xb104, TROUSERS, 6),
  skeleton_head: skeletonHead(0xb201),
  skeleton_body: skeletonBody(0xb202),
  skeleton_arm: boneLimb(0xb203, true),
  skeleton_leg: boneLimb(0xb204, false),
  creeper_head: creeperHead(0xb301),
  creeper_body: creeperBody(0xb302),
  creeper_leg: plainSkin(0xb303, { base: '#4aa84a', light: '#58b858', dark: '#3a8a3a' }, 6),
  spider_head: spiderHead(0xb401),
  spider_body: spiderBody(0xb402, false),
  spider_leg: spiderBody(0xb403, true),
  pig_head: pigHead(0xb501),
  pig_body: pigBody(0xb502),
  pig_leg: plainSkin(0xb503, { base: '#d88a8a', light: '#e8a0a0', dark: '#b87070' }, 5),
  cow_head: cowHead(0xb601),
  cow_body: cowBody(0xb602),
  cow_leg: plainSkin(0xb603, { base: '#4a3626', light: '#5a4432', dark: '#3a2a1c' }, 5),
  cow_horn: hornTexture(0xb604),
  sheep_head: sheepHead(0xb701),
  sheep_wool: sheepWool(0xb702),
  sheep_leg: plainSkin(0xb703, { base: '#cbb49f', light: '#d8c4b0', dark: '#b09a86' }, 5),
  chicken_head: chickenHead(0xb801),
  chicken_body: chickenBody(0xb802),
  chicken_beak: beakTexture(0xb803),
  chicken_wing: chickenWing(0xb804),
  chicken_leg: plainSkin(0xb805, { base: '#e0a41e', light: '#f0bc3a', dark: '#b88412' }, 4),
};

export { MOB_SKINS };

export const MOB_SKIN_NAMES: readonly string[] = Object.freeze(Object.keys(MOB_SKINS));

/** Paints one mob skin into an existing painter (clears it first). */
export function paintMobSkin(key: string, painter: PixelPainter): boolean {
  painter.fill('rgba(0,0,0,0)');
  const skin = MOB_SKINS[key];
  if (!skin) return false;
  skin(painter);
  return true;
}

/** Renders one 32x32 mob skin into a fresh buffer. */
export function createMobSkin(key: string): PixelBuffer | null {
  const skin = MOB_SKINS[key];
  if (!skin) return null;
  const painter = new PixelPainter(T, T);
  painter.fill('rgba(0,0,0,0)');
  skin(painter);
  return painter.buffer;
}

/** Colour used by the renderer fallback, mirrored here for art tests. */
export function mobSkinDominantColor(key: string): readonly [number, number, number] {
  const skin = MOB_SKINS[key];
  if (!skin) return [255, 0, 255];
  const painter = new PixelPainter(T, T);
  painter.fill('rgba(0,0,0,0)');
  skin(painter);
  let r = 0;
  let g = 0;
  let b = 0;
  let count = 0;
  for (let i = 0; i < painter.data.length; i += 4) {
    if (painter.data[i + 3] === 0) continue;
    r += painter.data[i];
    g += painter.data[i + 1];
    b += painter.data[i + 2];
    count++;
  }
  if (count === 0) return [0, 0, 0];
  return [Math.round(r / count), Math.round(g / count), Math.round(b / count)];
}
