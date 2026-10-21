import { hash2f, hash2i, mulberry32 } from '../core/rng';
import {
  bevel,
  blobs,
  col,
  fbm,
  mixPixel,
  palette,
  rgb,
  smoothNoise,
  specks,
  tone,
  voronoi,
  wrap,
  type Rgba,
} from './pixelKit';
import type { PixelPainter } from './pixels';
import { TILE_SIZE as T, type TilePainter } from './types';

/**
 * Procedural block textures for MineVerse (32x32, original pixel art).
 *
 * Art direction:
 * - colours are close to the vanilla brightness range but authored from scratch;
 * - low-frequency clustered colour variation (value noise) + a few crisp specks,
 *   never a uniform salt-and-pepper noise field (mipmaps alias badly and it reads
 *   as "white noise" at distance);
 * - surfaces that tile vertically/horizontally are seamless (wrapped blobs);
 * - wood has directional grain (vertical bark on sides, annual rings on tops);
 * - every painter is deterministic and idempotent.
 */

// ---------------------------------------------------------------------------
// small bitmap glyph helper (TNT label)
// ---------------------------------------------------------------------------

const GLYPHS: Record<string, readonly number[]> = {
  T: [0b11111, 0b00100, 0b00100, 0b00100, 0b00100, 0b00100, 0b00100],
  N: [0b10001, 0b11001, 0b10101, 0b10011, 0b10001, 0b10001, 0b10001],
};

function stampGlyph(p: PixelPainter, glyph: readonly number[], x: number, y: number, color: Rgba): void {
  for (let row = 0; row < glyph.length; row++) {
    const bits = glyph[row];
    for (let bit = 0; bit < 5; bit++) {
      if ((bits >> (4 - bit)) & 1) p.set(x + bit, y + row, color);
    }
  }
}

// ---------------------------------------------------------------------------
// stone family
// ---------------------------------------------------------------------------

function stoneTile(
  seed: number,
  base: string,
  light: string,
  dark: string,
  accents: readonly string[] = [],
): TilePainter {
  return (p) => {
    p.fill(base);
    tone(p, seed, light, dark, { cell: 6, strength: 0.24, levels: 4 });
    // small clustered patches of lighter/darker stone (never per-pixel noise)
    blobs(p, seed ^ 0x9c1, [light, dark], 6, 1, 1);
    // sparse short crevices add depth without becoming visual noise
    const rng = mulberry32(seed ^ 0x51a7);
    for (let i = 0; i < 4; i++) {
      let x = Math.floor(rng() * T);
      let y = Math.floor(rng() * T);
      const length = 2 + Math.floor(rng() * 3);
      for (let s = 0; s < length; s++) {
        p.set(wrap(x), wrap(y), dark);
        x += 1;
        if (rng() < 0.35) y += 1;
      }
    }
    specks(p, seed ^ 0x9c3, [dark, light, ...accents], 8);
  };
}

/**
 * Igneous rock with visible mineral grains: the grains are painted as tiny
 * 2-5 px clumps, not single pixels, so the tile stays readable at mip levels.
 */
function speckledStone(
  seed: number,
  base: string,
  light: string,
  dark: string,
  grains: readonly [string, string],
): TilePainter {
  return (p) => {
    p.fill(base);
    tone(p, seed, light, dark, { cell: 6, strength: 0.2, levels: 4 });
    blobs(p, seed ^ 0x11, [grains[0]], 8, 1, 1);
    blobs(p, seed ^ 0x12, [grains[1]], 6, 1, 1);
    specks(p, seed ^ 0x13, [grains[0], grains[1], light, dark], 6);
  };
}

const stone: TilePainter = stoneTile(0x1101, '#7d7d7d', '#8a8a8a', '#707070', ['#868686']);

const granite = speckledStone(0x1111, '#9a6a5e', '#a97a6c', '#87594e', ['#b0867a', '#71483e']);
const diorite = speckledStone(0x1112, '#bcbcc0', '#c8c8cc', '#aaaaae', ['#d3d3d7', '#8c8c93']);
const andesite = speckledStone(0x1113, '#8c8c8e', '#98989a', '#7e7e80', ['#a5a5a7', '#6f6f71']);

const smoothStone: TilePainter = (p) => {
  p.fill('#9a9a9a');
  tone(p, 0x3061, '#a4a4a4', '#909090', { cell: 8, strength: 0.09, levels: 3 });
  blobs(p, 0x3063, ['#a0a0a0', '#939393'], 4, 1, 1);
  p.rect(0, 0, T, 1, '#a6a6a6');
  p.rect(0, T - 1, T, 1, '#8a8a8a');
  specks(p, 0x3062, ['#a2a2a2', '#8f8f8f'], 6);
};

function cobblestoneTile(seed: number, mossy: boolean): TilePainter {
  return (p) => {
    p.fill('#4a4a4a');
    voronoi(p, seed, {
      grid: 4,
      gap: 1.7,
      colors: ['#8d8d8d', '#7f7f7f', '#969696', '#747474', '#858585', '#9d9d9d', '#6e6e6e'],
      color: '#474747',
      highlight: '#a2a2a2',
      shadow: '#5d5d5d',
      relief: 0.16,
    });
    tone(p, seed ^ 0x77, '#9c9c9c', '#5c5c5c', { cell: 6, strength: 0.1, levels: 3 });
    if (mossy) {
      blobs(p, seed ^ 0x1f2e, ['#5c7a3a', '#4c682e', '#6a8a44'], 12, 1, 2);
      specks(p, seed ^ 0x1f30, ['#6f8f47', '#425c28'], 12);
      tone(p, seed ^ 0x1f31, '#6d8f47', '#405a27', { cell: 4, strength: 0.08, levels: 2 });
    }
    specks(p, seed ^ 0x44, ['#a0a0a0', '#5f5f5f'], 6);
  };
}

const cobblestone: TilePainter = cobblestoneTile(0x1201, false);
const mossyCobblestone: TilePainter = cobblestoneTile(0x1201, true);

// ---------------------------------------------------------------------------
// soil / sand / gravel / clay
// ---------------------------------------------------------------------------

function dirtTile(seed: number, coarse: boolean): TilePainter {
  const base = coarse ? '#7b5635' : '#87603e';
  const light = coarse ? '#8b6642' : '#97704a';
  const dark = coarse ? '#66472b' : '#745030';
  return (p) => {
    p.fill(base);
    tone(p, seed, light, dark, { cell: 5, strength: 0.22, levels: 4 });
    blobs(p, seed ^ 0x71, coarse ? ['#5f4329', '#93683f'] : ['#6b4a2c', '#a07850'], coarse ? 7 : 5, 1, 1);
    specks(p, seed ^ 0x13, ['#6a482a', '#a37b52', '#5f3f24'], coarse ? 14 : 10);
  };
}

const dirtBase: TilePainter = dirtTile(0x33aa, false);

const coarseDirt: TilePainter = dirtTile(0x33ab, true);

const sand: TilePainter = (p) => {
  p.fill('#dcd3a1');
  tone(p, 0x1901, '#e9e0b2', '#c9bf8d', { cell: 6, strength: 0.14, levels: 4 });
  // wind ripples: a few short horizontal darker grains
  const rng = mulberry32(0x1902);
  for (let i = 0; i < 6; i++) {
    const x = Math.floor(rng() * T);
    const y = Math.floor(rng() * T);
    p.rect(x, y, 2 + Math.floor(rng() * 3), 1, '#c6bb89');
  }
  specks(p, 0x1903, ['#c4b98a', '#e8dfb3', '#cdc292'], 14);
  blobs(p, 0x1904, ['#e6dcae', '#d2c795'], 3, 1, 1);
};

const sandstoneTop: TilePainter = (p) => {
  p.fill('#d8cc9a');
  tone(p, 0x1a01, '#e3d8a7', '#c8ba87', { cell: 7, strength: 0.12, levels: 4 });
  p.rect(0, 0, T, 1, '#e7dcae');
  p.rect(0, T - 1, T, 1, '#c0b27e');
  specks(p, 0x1a02, ['#c5b681', '#e9dfb0'], 16);
};

const sandstoneSide: TilePainter = (p) => {
  p.fill('#d6ca97');
  tone(p, 0x1b01, '#e1d6a5', '#c4b681', { cell: 8, strength: 0.1, levels: 3 });
  // sedimentary stratification
  const strata = [3, 4, 10, 11, 18, 19, 25, 26];
  strata.forEach((y, index) => {
    p.rect(0, y, T, 1, index % 2 === 0 ? '#cbbd88' : '#c0b17b');
  });
  // top cap
  p.rect(0, 0, T, 2, '#e4d9a8');
  p.rect(0, 2, T, 1, '#c8ba86');
  // vertical flutes in the lower part
  const rng = mulberry32(0x1b02);
  for (let i = 0; i < 7; i++) {
    const x = Math.floor(rng() * T);
    p.rect(x, 12 + Math.floor(rng() * 5), 1, 2 + Math.floor(rng() * 4), '#c6b883');
  }
  specks(p, 0x1b03, ['#cdc08c', '#e8ddad', '#bdae79'], 14);
};

const sandstoneBottom: TilePainter = (p) => {
  p.fill('#cfc28e');
  tone(p, 0x1c01, '#dbcf9d', '#bbad79', { cell: 7, strength: 0.13, levels: 4 });
  p.rect(0, 0, T, 1, '#bab078');
  specks(p, 0x1c02, ['#bdaf7b', '#dfd4a2'], 18);
  const rng = mulberry32(0x1c03);
  for (let i = 0; i < 4; i++) {
    const x = Math.floor(rng() * T);
    p.rect(x, 3 + Math.floor(rng() * 24), 1, 2 + Math.floor(rng() * 3), '#b5a771');
  }
};

const gravel: TilePainter = (p) => {
  p.fill('#575350');
  voronoi(p, 0x1d01, {
    grid: 5,
    gap: 1.05,
    colors: ['#8d8783', '#9a948e', '#817b77', '#a39d97', '#6f6a66', '#948e88'],
    color: '#56524f',
    highlight: '#aaa49c',
    shadow: '#615c58',
    relief: 0.26,
  });
  tone(p, 0x1d02, '#a29c95', '#615c58', { cell: 5, strength: 0.12, levels: 3 });
  specks(p, 0x1d03, ['#a8a29a', '#5c5753'], 8);
};

const clay: TilePainter = (p) => {
  p.fill('#a6b0ba');
  tone(p, 0x1e01, '#b2bcc6', '#98a2ac', { cell: 6, strength: 0.14, levels: 4 });
  blobs(p, 0x1e02, ['#9ca6b0', '#b4bec8'], 7, 1, 1);
  specks(p, 0x1e03, ['#8e98a2', '#b9c3cb'], 8);
};

const bedrock: TilePainter = (p) => {
  p.fill('#3c3c3c');
  voronoi(p, 0x1f01, {
    grid: 5,
    gap: 1.7,
    colors: ['#454545', '#3a3a3a', '#4d4d4d', '#343434', '#424242'],
    color: '#262626',
    highlight: '#555555',
    shadow: '#2c2c2c',
    relief: 0.22,
  });
  tone(p, 0x1f02, '#4e4e4e', '#2b2b2b', { cell: 6, strength: 0.13, levels: 3 });
  specks(p, 0x1f03, ['#525252', '#2f2f2f'], 10);
};

// ---------------------------------------------------------------------------
// snow / ice / fluids
// ---------------------------------------------------------------------------

const snow: TilePainter = (p) => {
  p.fill('#f2f5f8');
  tone(p, 0x2001, '#ffffff', '#d9e2ea', { cell: 5, strength: 0.16, levels: 4 });
  // soft blue-grey drifts keep the snow from reading as flat white
  blobs(p, 0x2003, ['#e1e9f0', '#eef3f7'], 7, 1, 1);
  p.rect(0, 0, T, 1, '#ffffff');
  p.rect(0, T - 1, T, 1, '#dce4ec');
  specks(p, 0x2002, ['#e4ecf2', '#ffffff'], 7);
};

const ice: TilePainter = (p) => {
  const base = rgb(148, 194, 234, 222);
  p.fill(base);
  tone(p, 0x2101, rgb(212, 236, 250, 222), rgb(104, 152, 202, 222), { cell: 7, strength: 0.2, levels: 4 });
  // frozen cracks, lighter than the body
  const crack = rgb(226, 244, 252, 240);
  const rng = mulberry32(0x2102);
  for (let i = 0; i < 4; i++) {
    let x = Math.floor(rng() * T);
    let y = Math.floor(rng() * T);
    const length = 4 + Math.floor(rng() * 6);
    for (let s = 0; s < length; s++) {
      p.set(wrap(x), wrap(y), crack);
      x += rng() < 0.7 ? 1 : -1;
      y += 1;
    }
  }
  specks(p, 0x2103, [rgb(236, 248, 255, 238), rgb(120, 168, 214, 226)], 10);
};

const water: TilePainter = (p) => {
  p.fill(rgb(46, 102, 192, 208));
  // depth mottling
  tone(p, 0x2201, rgb(74, 136, 224, 208), rgb(30, 72, 156, 208), { cell: 6, strength: 0.3, levels: 5 });
  // diagonal flow bands (stretched noise reads as a current, unlike per-pixel noise)
  const angle = 0.52;
  const ca = Math.cos(angle);
  const sa = Math.sin(angle);
  for (let y = 0; y < T; y++) {
    for (let x = 0; x < T; x++) {
      const u = x * ca + y * sa;
      const v = -x * sa + y * ca;
      const n = smoothNoise(0x2202, u, v * 2.6, 9);
      if (n > 0.68) p.set(x, y, rgb(92, 152, 232, 212));
      else if (n > 0.6) p.set(x, y, rgb(70, 128, 218, 210));
      else if (n < 0.3) p.set(x, y, rgb(34, 80, 168, 210));
      else if (n < 0.38) p.set(x, y, rgb(40, 90, 178, 210));
    }
  }
  specks(p, 0x2203, [rgb(140, 190, 248, 216), rgb(58, 112, 204, 212)], 12);
};

const lava: TilePainter = (p) => {
  // marbled heat bands instead of white noise
  for (let y = 0; y < T; y++) {
    for (let x = 0; x < T; x++) {
      const n = fbm(0x2301, x, y, 7);
      let color: Rgba;
      if (n > 0.72) color = col('#ffd34d');
      else if (n > 0.6) color = col('#f7a121');
      else if (n > 0.47) color = col('#e06a12');
      else if (n > 0.34) color = col('#b8430a');
      else color = col('#8f2c05');
      p.set(x, y, color);
    }
  }
  // dark crust along some noise contours
  for (let y = 0; y < T; y++) {
    for (let x = 0; x < T; x++) {
      const n = fbm(0x2301, x, y, 7);
      if (Math.abs(n - 0.4) < 0.012) p.set(x, y, '#6e1e03');
      else if (Math.abs(n - 0.665) < 0.01) p.set(x, y, '#ffb733');
    }
  }
  blobs(p, 0x2302, ['#ffd34d', '#ffb733'], 5, 1, 1);
  blobs(p, 0x2303, ['#7a2404', '#8f2c05'], 4, 1, 2);
  specks(p, 0x2304, ['#ffe87a', '#ff9a1f', '#a83406'], 10);
};

// ---------------------------------------------------------------------------
// logs
// ---------------------------------------------------------------------------

function logSideTile(
  seed: number,
  base: string,
  light: string,
  dark: string,
  crevice: string,
  cracks: number,
): TilePainter {
  return (p) => {
    p.fill(base);
    const rng = mulberry32(seed ^ 0x1a2b);
    // vertical grain: runs of 2-4 px, each split into longer vertical segments
    // so the bark reads as fibre instead of wall-paper stripes or noise
    const tones = [base, base, base, light, dark];
    let x = 0;
    while (x < T) {
      const run = 2 + Math.floor(rng() * 3);
      let y = 0;
      while (y < T) {
        const segment = 3 + Math.floor(rng() * 8);
        const color = tones[Math.floor(rng() * tones.length)];
        for (let dx = 0; dx < run && x + dx < T; dx++) {
          p.rect(x + dx, y, 1, segment, color);
        }
        y += segment;
      }
      x += run;
    }
    // meandering deep crevices with a light ridge (vertical bark cracks)
    for (let i = 0; i < cracks; i++) {
      const startX = Math.floor(rng() * T);
      const amplitude = 1 + Math.floor(rng() * 2);
      const frequency = 0.1 + rng() * 0.12;
      const phase = rng() * Math.PI * 2;
      for (let y = 0; y < T; y++) {
        const cx = wrap(startX + Math.round(Math.sin(y * frequency * Math.PI * 2 + phase) * amplitude));
        p.set(cx, y, crevice);
        p.set(wrap(cx + 1), y, light);
      }
    }
    // horizontal bark plates
    for (let i = 0; i < 5; i++) {
      const x0 = Math.floor(rng() * T);
      const y = Math.floor(rng() * T);
      p.rect(x0, y, 2 + Math.floor(rng() * 4), 1, i % 2 === 0 ? dark : crevice);
    }
    // knots: dark oval with a lit rim
    for (let k = 0; k < 2; k++) {
      const kx = 4 + Math.floor(rng() * 24);
      const ky = 5 + Math.floor(rng() * 22);
      for (let dy = -2; dy <= 2; dy++) {
        const w = dy === 0 ? 2 : 1;
        for (let dx = -w; dx <= w; dx++) p.set(wrap(kx + dx), wrap(ky + dy), crevice);
      }
      p.set(wrap(kx), wrap(ky - 3), light);
      p.set(wrap(kx + 2), wrap(ky + 1), light);
    }
    tone(p, seed ^ 0x81, light, dark, { cell: 10, strength: 0.06, levels: 2 });
  };
}

const birchLog: TilePainter = (p) => {
  p.fill('#d9d5c6');
  tone(p, 0x2601, '#e9e5d8', '#bdb8a9', { cell: 7, strength: 0.15, levels: 4 });
  // faint vertical grain
  for (let x = 0; x < T; x++) {
    const h = hash2f(0x2602, Math.floor(x / 2), 1);
    if (h < 0.16) p.rect(x, 0, 1, T, '#c9c4b5');
    else if (h > 0.9) p.rect(x, 0, 1, T, '#e8e4d7');
  }
  // horizontal lenticels (the signature birch marks)
  const rng = mulberry32(0x2603);
  for (let i = 0; i < 12; i++) {
    const x = Math.floor(rng() * T);
    const y = Math.floor(rng() * T);
    const w = 2 + Math.floor(rng() * 4);
    p.rect(x, y, w, 1, '#8f8a7d');
    p.rect(x, y + 1, Math.max(1, w - 1), 1, '#a9a496');
    p.set(x + w, y, '#c5c0b2');
  }
  // a few dark knots
  const krng = mulberry32(0x2604);
  for (let i = 0; i < 3; i++) {
    const x = 4 + Math.floor(krng() * 24);
    const y = 4 + Math.floor(krng() * 24);
    p.rect(x, y, 3, 2, '#6f6a5e');
    p.set(x, y + 2, '#918c80');
  }
  tone(p, 0x2605, '#e8e4d7', '#b0ab9c', { cell: 8, strength: 0.06, levels: 2 });
};

function logTopTile(
  seed: number,
  wood: string,
  woodLight: string,
  woodDark: string,
  bark: string,
  barkLight: string,
  barkDark: string,
): TilePainter {
  return (p) => {
    p.fill(wood);
    const phase1 = hash2f(seed, 1, 2) * Math.PI * 2;
    const phase2 = hash2f(seed, 3, 4) * Math.PI * 2;
    const cx = 15.5;
    const cy = 15.5;
    for (let y = 0; y < T; y++) {
      for (let x = 0; x < T; x++) {
        const dx = x - cx;
        const dy = y - cy;
        const radius = Math.hypot(dx, dy);
        const angle = Math.atan2(dy, dx);
        // only a slight wobble: rings must stay circular (a 3-lobe wobble reads as a heart)
        const wobble =
          0.3 * Math.sin(angle * 2 + phase1) +
          0.2 * Math.sin(angle * 5 + phase2) +
          0.1 * Math.sin(angle * 9 + phase1 * 1.7);
        const r = radius + wobble;
        if (r > 14.4) {
          const band = Math.floor((angle + Math.PI) * 5) % 2;
          p.set(x, y, band === 0 ? bark : barkDark);
          continue;
        }
        if (r > 13.1) {
          p.set(x, y, barkLight);
          continue;
        }
        const ring = Math.floor(r / 1.9);
        let color = ring % 2 === 0 ? wood : woodDark;
        if (ring === 0) color = woodDark;
        p.set(x, y, color);
      }
    }
    // radial drying cracks
    const rng = mulberry32(seed ^ 0x7e33);
    for (let i = 0; i < 3; i++) {
      const angle = rng() * Math.PI * 2;
      const length = 6 + Math.floor(rng() * 6);
      for (let s = 3; s < length; s++) {
        p.set(
          Math.round(cx + Math.cos(angle + s * 0.04) * s),
          Math.round(cy + Math.sin(angle + s * 0.04) * s),
          woodDark,
        );
      }
    }
    tone(p, seed ^ 0x55, woodLight, woodDark, { cell: 9, strength: 0.06, levels: 3 });
  };
}

const oakLog = logSideTile(0x2501, '#6f5430', '#7e623a', '#5a4024', '#42301b', 4);
const oakLogTop = logTopTile(0x2502, '#ac8d5b', '#c0a06a', '#8c6f42', '#6f5430', '#7e623a', '#4a341f');
const spruceLog = logSideTile(0x2701, '#4d3a26', '#5e4830', '#3a2a1a', '#2a1e11', 5);
const spruceLogTop = logTopTile(0x2702, '#7a5f3a', '#8b6f45', '#5e4527', '#3f2d1b', '#4d3a26', '#2c2012');
const birchLogTop = logTopTile(0x2606, '#d6cba9', '#e4dbba', '#b8ad8a', '#c2beb0', '#d4d0c2', '#a8a496');

// ---------------------------------------------------------------------------
// leaves (cutout: alpha holes with layered shading)
// ---------------------------------------------------------------------------

function leavesTile(
  seed: number,
  deep: string,
  dark: string,
  base: string,
  light: string,
): TilePainter {
  return (p) => {
    p.fill('rgba(0,0,0,0)');
    const visible = new Uint8Array(T * T);
    for (let y = 0; y < T; y++) {
      for (let x = 0; x < T; x++) {
        // clustered coverage: dense leaf masses plus a few bigger holes
        visible[y * T + x] = fbm(seed, x, y, 4.2) > 0.33 ? 1 : 0;
      }
    }
    const rng = mulberry32(seed ^ 0x3311);
    for (let i = 0; i < 3; i++) {
      const hx = Math.floor(rng() * T);
      const hy = Math.floor(rng() * T);
      const hr = 1 + Math.floor(rng() * 2);
      for (let dy = -hr; dy <= hr; dy++) {
        for (let dx = -hr; dx <= hr; dx++) {
          if (dx * dx + dy * dy > hr * hr) continue;
          visible[wrap(hy + dy) * T + wrap(hx + dx)] = 0;
        }
      }
    }
    // clustered shading (narrow value range: leaf clumps, not camouflage)
    for (let y = 0; y < T; y++) {
      for (let x = 0; x < T; x++) {
        if (!visible[y * T + x]) continue;
        const shade = fbm(seed ^ 0x2f19, x, y, 3.2);
        let color: Rgba;
        if (shade < 0.3) color = col(deep);
        else if (shade < 0.52) color = col(dark);
        else if (shade < 0.86) color = col(base);
        else color = col(light);
        p.set(x, y, color);
      }
    }
    // subtle rim light on the upper/left silhouette, deeper shade lower/right
    for (let y = 0; y < T; y++) {
      for (let x = 0; x < T; x++) {
        if (!visible[y * T + x]) continue;
        const up = y > 0 && visible[(y - 1) * T + x] === 1;
        const left = x > 0 && visible[y * T + (x - 1)] === 1;
        const down = y < T - 1 && visible[(y + 1) * T + x] === 1;
        const right = x < T - 1 && visible[y * T + (x + 1)] === 1;
        if (!up || !left) p.set(x, y, mixPixel(p.get(x, y), col(light), 0.4));
        else if (!down || !right) p.set(x, y, mixPixel(p.get(x, y), col(deep), 0.42));
      }
    }
  };
}

const oakLeaves = leavesTile(0x2801, '#2a4a1c', '#345a22', '#3f6b27', '#4b7a2f');
const birchLeaves = leavesTile(0x2901, '#3a5c24', '#466b2b', '#537c31', '#628c3b');
const spruceLeaves = leavesTile(0x2a01, '#1c3616', '#24421c', '#2c4f22', '#365c29');

// ---------------------------------------------------------------------------
// ores / obsidian
// ---------------------------------------------------------------------------

const oreStone = stoneTile(0x3001, '#7f7f7f', '#8d8d8d', '#6e6e6e');

function oreTile(
  seed: number,
  oreLight: string,
  oreMid: string,
  oreDark: string,
  clusters = 6,
): TilePainter {
  return (p) => {
    oreStone(p);
    const rng = mulberry32(seed);
    // connected veins: grains step forward while overlapping, so the ore reads
    // as chunky mineral clusters instead of scattered specks
    for (let c = 0; c < clusters; c++) {
      let x = 3 + Math.floor(rng() * 26);
      let y = 3 + Math.floor(rng() * 26);
      const steps = 5 + Math.floor(rng() * 3);
      for (let s = 0; s < steps; s++) {
        const wide = rng() < 0.45;
        // faceted grain: lit upper-left corner, shadowed lower-right corner
        p.set(wrap(x), wrap(y), oreLight);
        p.set(wrap(x + 1), wrap(y), oreMid);
        p.set(wrap(x), wrap(y + 1), oreMid);
        p.set(wrap(x + 1), wrap(y + 1), oreDark);
        if (wide) {
          p.set(wrap(x + 2), wrap(y), oreMid);
          p.set(wrap(x + 2), wrap(y + 1), oreDark);
          p.set(wrap(x + 1), wrap(y + 2), oreDark);
        }
        x = wrap(x + Math.floor(rng() * 3) - 1);
        y = wrap(y + Math.floor(rng() * 3) - 1);
      }
    }
    // a few isolated grains for texture
    const rng2 = mulberry32(seed ^ 0x5bd1);
    for (let i = 0; i < 3; i++) {
      const x = 3 + Math.floor(rng2() * 26);
      const y = 3 + Math.floor(rng2() * 26);
      p.set(x, y, oreLight);
      p.set(x + 1, y, oreMid);
      p.set(x, y + 1, oreDark);
    }
    specks(p, seed ^ 0x70, [oreLight, oreMid], 5);
  };
}

const coalOre = oreTile(0x2b01, '#3a3a3a', '#262626', '#141414', 5);
const copperOre = oreTile(0x2c01, '#e09a6a', '#c47a48', '#8f5228', 5);
const ironOre = oreTile(0x2d01, '#e8d6be', '#c9ae90', '#9a7f64', 5);
const goldOre = oreTile(0x2e01, '#ffe45e', '#e8c02e', '#b08a12', 5);
const redstoneOre = oreTile(0x2f01, '#ff6a5a', '#d6372e', '#901a14', 6);
const lapisOre = oreTile(0x3002, '#7a92ff', '#3f5fd6', '#24388f', 6);
const diamondOre = oreTile(0x3101, '#a8fff7', '#5ce8dc', '#27a69b', 5);

const obsidian: TilePainter = (p) => {
  p.fill('#191024');
  tone(p, 0x3201, '#2c1d42', '#0d0815', { cell: 5, strength: 0.26, levels: 4 });
  blobs(p, 0x3202, ['#241833', '#2f1f45', '#1d1329'], 12, 1, 2);
  // subtle glossy sheen patches (low contrast, no long scratches)
  blobs(p, 0x3203, ['#33204d', '#3b2657'], 5, 1, 1);
  specks(p, 0x3204, ['#4a3170', '#553a80', '#33204d'], 8);
  // a couple of bright glints catch the light
  p.set(9, 11, '#6d4d9c');
  p.set(22, 21, '#5b3f8c');
  p.set(20, 8, '#3f2a60');
};

// ---------------------------------------------------------------------------
// wood products
// ---------------------------------------------------------------------------

function planksTile(
  seed: number,
  base: string,
  light: string,
  dark: string,
  seam: string,
  grain: string,
): TilePainter {
  return (p) => {
    p.fill(base);
    const rng = mulberry32(seed);
    for (let board = 0; board < 4; board++) {
      const y0 = board * 8;
      p.rect(0, y0, T, 1, light);
      p.rect(0, y0 + 7, T, 1, seam);
      const seamX = Math.floor(rng() * T);
      p.rect(seamX, y0 + 1, 1, 6, seam);
      const dashes = 2 + Math.floor(rng() * 3);
      for (let d = 0; d < dashes; d++) {
        const x = Math.floor(rng() * T);
        const y = y0 + 2 + Math.floor(rng() * 5);
        const length = 2 + Math.floor(rng() * 4);
        p.rect(x, y, length, 1, rng() < 0.5 ? grain : light);
      }
      if (board % 2 === 1) {
        const kx = 4 + Math.floor(rng() * 24);
        p.set(kx, y0 + 4, seam);
        p.set(kx + 1, y0 + 4, seam);
        p.set(kx, y0 + 5, seam);
        p.set(kx + 1, y0 + 3, light);
      }
    }
    tone(p, seed ^ 0x37, light, dark, { cell: 8, strength: 0.08, levels: 3 });
  };
}

const oakPlanks = planksTile(0x3301, '#b58b52', '#c9a267', '#8d6a3c', '#6f5230', '#a07846');
const birchPlanks = planksTile(0x3401, '#d7cdb0', '#e6ddc4', '#b3a888', '#918770', '#c8bda0');
const sprucePlanks = planksTile(0x3501, '#7a5a38', '#8e6c45', '#5c4228', '#4a3420', '#6a4d2f');

// ---------------------------------------------------------------------------
// masonry
// ---------------------------------------------------------------------------

function stoneBricksTile(
  seed: number,
  base: string,
  light: string,
  dark: string,
  mortar: string,
): TilePainter {
  return (p) => {
    const rowHeight = 16;
    const baseColor = col(base);
    const lightColor = col(light);
    const darkColor = col(dark);
    const mortarColor = col(mortar);
    for (let y = 0; y < T; y++) {
      const row = Math.floor(y / rowHeight);
      const shift = row % 2 === 0 ? 0 : 8;
      for (let x = 0; x < T; x++) {
        const xs = (x + shift) % T;
        const brickId = row * 2 + Math.floor(xs / 16);
        let color: Rgba;
        if (y % rowHeight < 2 || xs % 16 < 2) {
          color = mortarColor;
        } else {
          const variation = hash2f(seed, brickId, 5);
          color = mixPixel(baseColor, variation < 0.5 ? lightColor : darkColor, Math.abs(variation - 0.5) * 0.42);
          if (y % rowHeight === 2) color = mixPixel(color, lightColor, 0.5);
          else if (y % rowHeight === rowHeight - 1) color = mixPixel(color, darkColor, 0.5);
        }
        p.set(x, y, color);
      }
    }
    tone(p, seed ^ 0x517, light, dark, { cell: 9, strength: 0.08, levels: 3 });
    specks(p, seed ^ 0x518, [light, dark], 10);
  };
}

const stoneBricks = stoneBricksTile(0x3601, '#7d7d7d', '#8f8f8f', '#686868', '#5a5a5a');
const furnaceSide = stoneBricksTile(0x3f01, '#7a7a7a', '#8a8a8a', '#666666', '#545454');

const bricks: TilePainter = (p) => {
  const mortar = col('#c8bba7');
  const brickColors = palette(['#a54c3c', '#b0543f', '#984438', '#ad5142', '#9c4737']);
  const lightBrick = col('#c46a52');
  const darkBrick = col('#7f3226');
  const rowHeight = 8;
  for (let y = 0; y < T; y++) {
    const row = Math.floor(y / rowHeight);
    const shift = (row % 2) * 8;
    for (let x = 0; x < T; x++) {
      const xs = (x + shift) % T;
      let color: Rgba;
      if (y % rowHeight < 2 || xs % 16 < 2) {
        color = mortar;
      } else {
        const brickId = row * 2 + Math.floor(xs / 16);
        color = brickColors[hash2i(0x3801, brickId, 7) % brickColors.length];
        color = mixPixel(color, hash2f(0x3802, brickId, 9) < 0.5 ? darkBrick : lightBrick, hash2f(0x3803, brickId, 11) * 0.2);
        if (y % rowHeight === 2) color = mixPixel(color, lightBrick, 0.5);
        else if (y % rowHeight === rowHeight - 1) color = mixPixel(color, darkBrick, 0.5);
      }
      p.set(x, y, color);
    }
  }
  tone(p, 0x3804, '#b6604a', '#83362a', { cell: 8, strength: 0.07, levels: 3 });
  specks(p, 0x3805, ['#c1624b', '#8d3a2d'], 8);
};

const glass: TilePainter = (p) => {
  p.fill('rgba(0,0,0,0)');
  const frame = rgb(196, 228, 240, 255);
  const frameShade = rgb(150, 196, 216, 255);
  const shine = rgb(235, 250, 255, 255);
  p.rect(0, 0, T, 2, frame);
  p.rect(0, T - 2, T, 2, frame);
  p.rect(0, 0, 2, T, frame);
  p.rect(T - 2, 0, 2, T, frame);
  // inner bevel + diagonal glints
  p.rect(2, 2, T - 4, 1, frameShade);
  p.rect(2, 2, 1, T - 4, frameShade);
  p.line(6, 24, 20, 10, shine);
  p.line(7, 25, 21, 11, shine);
  p.line(17, 27, 27, 17, frame);
  p.set(4, 5, shine);
  p.set(5, 4, shine);
  p.set(26, 26, shine);
};

// ---------------------------------------------------------------------------
// wool
// ---------------------------------------------------------------------------

function woolTile(seed: number, base: string, light: string, dark: string): TilePainter {
  return (p) => {
    p.fill(base);
    tone(p, seed, light, dark, { cell: 5, strength: 0.12, levels: 3 });
    // short fuzzy fibres, low contrast
    const rng = mulberry32(seed ^ 0x5a);
    for (let i = 0; i < 24; i++) {
      const x = Math.floor(rng() * T);
      const y = Math.floor(rng() * T);
      const color = rng() < 0.5 ? light : dark;
      p.set(x, y, color);
      if (rng() < 0.4) p.set(wrap(x + 1), y, color);
      if (rng() < 0.25) p.set(x, wrap(y + 1), color);
    }
  };
}

const woolWhite = woolTile(0x3901, '#e6e6e6', '#f2f2f2', '#cfcfcf');
const woolRed = woolTile(0x3a01, '#b83a3a', '#c94c4c', '#9c2d2d');
const woolYellow = woolTile(0x3b01, '#e0c040', '#efd45c', '#c4a52c');
const woolBlue = woolTile(0x3c01, '#3a4ab8', '#4c5ccc', '#2d3a96');
const woolBlack = woolTile(0x3d01, '#2a2a2a', '#383838', '#1d1d1d');

// ---------------------------------------------------------------------------
// crafting table
// ---------------------------------------------------------------------------

const craftingTableTop: TilePainter = (p) => {
  oakPlanks(p);
  // wooden frame
  p.rect(0, 0, T, 2, '#6a4a24');
  p.rect(0, T - 2, T, 2, '#6a4a24');
  p.rect(0, 0, 2, T, '#6a4a24');
  p.rect(T - 2, 0, 2, T, '#6a4a24');
  p.rect(2, 2, T - 4, 1, '#8d6a3c');
  // 3x3 recessed grid
  for (let gy = 0; gy < 3; gy++) {
    for (let gx = 0; gx < 3; gx++) {
      const x = 5 + gx * 8;
      const y = 5 + gy * 8;
      p.rect(x, y, 6, 6, '#7d5a30');
      p.rect(x + 1, y + 1, 4, 4, '#a9824a');
      p.set(x + 1, y + 1, '#c9a267');
      p.set(x + 4, y + 4, '#8d6a3c');
    }
  }
};

const craftingTableSide: TilePainter = (p) => {
  oakPlanks(p);
  p.rect(0, 0, T, 1, '#6a4a24');
  p.rect(0, T - 1, T, 1, '#6a4a24');
  p.rect(0, 13, T, 2, '#6a4a24');
  p.rect(0, 13, T, 1, '#8d6a3c');
  // saw silhouette
  p.rect(4, 5, 14, 3, '#b8b8b8');
  p.rect(4, 5, 14, 1, '#e0e0e0');
  for (let i = 0; i < 7; i++) p.set(5 + i * 2, 8, '#d8d8d8');
  p.rect(18, 4, 4, 5, '#7a5a30');
  p.rect(18, 4, 4, 1, '#966f3e');
  // hammer silhouette
  p.rect(8, 18, 4, 10, '#8d6a3c');
  p.rect(8, 18, 1, 10, '#a9824a');
  p.rect(4, 17, 12, 4, '#a0a0a0');
  p.rect(4, 17, 12, 1, '#d0d0d0');
  p.rect(4, 20, 12, 1, '#7a7a7a');
  specks(p, 0x7101, ['#c9a267', '#8d6a3c'], 8);
};

const craftingTableFront: TilePainter = (p) => {
  oakPlanks(p);
  p.rect(0, 0, T, 1, '#6a4a24');
  p.rect(0, T - 1, T, 1, '#6a4a24');
  // recessed panel
  p.rect(4, 4, T - 8, T - 8, '#6a4a24');
  p.rect(5, 5, T - 10, T - 10, '#a9824a');
  p.rect(5, 5, T - 10, 1, '#c9a267');
  p.rect(13, 6, 2, 20, '#8d6a3c');
  p.rect(6, 13, 20, 2, '#8d6a3c');
  p.rect(17, 7, 6, 3, '#b8b8b8');
  p.rect(17, 7, 6, 1, '#e0e0e0');
};

// ---------------------------------------------------------------------------
// furnace
// ---------------------------------------------------------------------------

const furnaceTop: TilePainter = (p) => {
  p.fill('#7c7c7c');
  tone(p, 0x3e01, '#8a8a8a', '#6a6a6a', { cell: 7, strength: 0.14, levels: 3 });
  p.rect(0, 0, T, 2, '#5f5f5f');
  p.rect(0, T - 2, T, 2, '#5f5f5f');
  p.rect(0, 0, 2, T, '#5f5f5f');
  p.rect(T - 2, 0, 2, T, '#5f5f5f');
  // chimney / vent opening
  p.rect(10, 10, 12, 12, '#3a3a3a');
  p.rect(11, 11, 10, 10, '#2b2b2b');
  p.rect(12, 12, 8, 8, '#1c1c1c');
  p.set(11, 11, '#585858');
  for (let i = 0; i < 3; i++) p.rect(13, 13 + i * 3, 6, 1, '#3a3a3a');
  specks(p, 0x3e02, ['#888888', '#6a6a6a'], 8);
};

function furnaceFrontTile(lit: boolean): TilePainter {
  return (p) => {
    furnaceSide(p);
    // stone surround
    p.rect(6, 6, 20, 3, '#8f8f8f');
    p.rect(6, 6, 1, 22, '#8a8a8a');
    p.rect(25, 6, 1, 22, '#6d6d6d');
    p.rect(6, 27, 20, 2, '#666666');
    if (lit) {
      // warm glow on the stone around the mouth
      for (let y = 5; y < 30; y++) {
        for (let x = 4; x < 28; x++) {
          if (x >= 8 && x <= 23 && y >= 11 && y <= 27) continue;
          const dx = Math.max(0, Math.max(8 - x, x - 23));
          const dy = Math.max(0, Math.max(11 - y, y - 27));
          const distance = Math.hypot(dx, dy);
          if (distance > 0 && distance <= 2.5) p.set(x, y, mixPixel(p.get(x, y), col('#ff8a2a'), 0.28));
        }
      }
    }
    // mouth
    p.rect(8, 11, 16, 17, '#2a2a2a');
    p.rect(9, 12, 14, 15, lit ? '#1a1210' : '#1b1b1b');
    if (lit) {
      p.rect(9, 25, 14, 2, '#d8641a');
      for (let x = 9; x < 23; x++) {
        const heat = fbm(0x3f05, x, 0, 4);
        const height = 3 + Math.floor(heat * 7);
        const top = 25 - height;
        for (let y = top; y < 26; y++) {
          const t = (y - top) / Math.max(1, 26 - top);
          const color = t < 0.3 ? '#ffe89a' : t < 0.62 ? '#ffc040' : '#f07a18';
          p.set(x, y, color);
        }
      }
      p.rect(12, 20, 8, 4, '#ffd85e');
      p.rect(14, 18, 4, 3, '#ffe89a');
      specks(p, 0x3f06, ['#fff0b0', '#ff9a2a'], 6);
    } else {
      p.rect(9, 24, 14, 3, '#141414');
      p.rect(10, 23, 12, 2, '#3a2a20');
      p.rect(15, 22, 2, 2, '#241812');
    }
    // lintel highlight
    p.rect(6, 6, 20, 1, '#9a9a9a');
  };
}

const furnaceFront = furnaceFrontTile(false);
const furnaceFrontLit = furnaceFrontTile(true);

// ---------------------------------------------------------------------------
// chest
// ---------------------------------------------------------------------------

const CHEST_BASE = '#a87b42';
const CHEST_LIGHT = '#bd8f52';
const CHEST_DARK = '#85582c';
const CHEST_SEAM = '#6b4520';

function chestPanel(p: PixelPainter, seed: number): void {
  p.fill(CHEST_BASE);
  tone(p, seed, CHEST_LIGHT, CHEST_DARK, { cell: 6, strength: 0.16, levels: 4 });
  p.rect(0, 10, T, 1, CHEST_DARK);
  p.rect(0, 21, T, 1, CHEST_DARK);
  const rng = mulberry32(seed ^ 0x3a);
  for (let i = 0; i < 9; i++) {
    const x = Math.floor(rng() * T);
    const y = Math.floor(rng() * T);
    p.rect(x, y, 2 + Math.floor(rng() * 3), 1, rng() < 0.5 ? '#96682f' : '#b98a4c');
  }
}

const chestTop: TilePainter = (p) => {
  chestPanel(p, 0x3b01);
  // lid frame
  p.rect(0, 0, T, 2, CHEST_SEAM);
  p.rect(0, T - 2, T, 2, CHEST_SEAM);
  p.rect(0, 0, 2, T, CHEST_SEAM);
  p.rect(T - 2, 0, 2, T, CHEST_SEAM);
  p.rect(2, 2, T - 4, 1, CHEST_LIGHT);
  // lock plate on the lid edge
  p.rect(13, 25, 6, 6, '#8a8a8a');
  p.rect(14, 26, 4, 4, '#b0b0b0');
  p.rect(15, 27, 2, 2, '#e0c060');
};

const chestSide: TilePainter = (p) => {
  chestPanel(p, 0x3b02);
  p.rect(0, 0, T, 2, CHEST_SEAM);
  p.rect(0, T - 2, T, 2, CHEST_SEAM);
  p.rect(0, 0, 2, T, CHEST_SEAM);
  p.rect(T - 2, 0, 2, T, CHEST_SEAM);
  // lid seam
  p.rect(0, 14, T, 2, CHEST_SEAM);
  p.rect(0, 13, T, 1, CHEST_LIGHT);
  // iron hinges
  p.rect(4, 2, 4, 4, '#7a7a7a');
  p.rect(4, 2, 4, 1, '#a0a0a0');
  p.rect(24, 2, 4, 4, '#7a7a7a');
  p.rect(24, 2, 4, 1, '#a0a0a0');
};

const chestFront: TilePainter = (p) => {
  chestPanel(p, 0x3b03);
  p.rect(0, 0, T, 2, CHEST_SEAM);
  p.rect(0, T - 2, T, 2, CHEST_SEAM);
  p.rect(0, 0, 2, T, CHEST_SEAM);
  p.rect(T - 2, 0, 2, T, CHEST_SEAM);
  p.rect(0, 14, T, 2, CHEST_SEAM);
  p.rect(0, 13, T, 1, CHEST_LIGHT);
  // central lock
  p.rect(12, 11, 8, 9, '#7a7a7a');
  p.rect(13, 12, 6, 8, '#a8a8a8');
  p.rect(13, 12, 6, 1, '#d0d0d0');
  p.rect(14, 13, 4, 4, '#e0c060');
  p.rect(15, 14, 2, 2, '#5a4212');
  p.set(15, 17, '#8a6a1a');
  p.set(16, 17, '#8a6a1a');
};

// ---------------------------------------------------------------------------
// torch / TNT
// ---------------------------------------------------------------------------

const torch: TilePainter = (p) => {
  p.fill('rgba(0,0,0,0)');
  // stick
  p.rect(13, 13, 6, 19, '#7a5630');
  p.rect(13, 13, 1, 19, '#4a3018');
  p.rect(18, 13, 1, 19, '#4a3018');
  p.rect(14, 13, 2, 19, '#93683a');
  p.rect(13, 30, 6, 2, '#4a3018');
  // ember / coal head
  p.rect(12, 10, 8, 4, '#3a2a18');
  p.rect(13, 9, 6, 2, '#5a3a1e');
  // flame: teardrop with a hot core
  for (let y = 1; y <= 10; y++) {
    const half = Math.round(4 - Math.abs(y - 6) * 0.42);
    const width = Math.max(1, half);
    for (let dx = -width; dx <= width; dx++) p.set(16 + dx, y, '#ff8a1e');
    if (width > 1) {
      for (let dx = -width + 1; dx <= width - 1; dx++) p.set(16 + dx, y, '#ffc44a');
    }
    if (width > 2 && y >= 5 && y <= 8) {
      for (let dx = -2; dx <= 2; dx++) p.set(16 + dx, y, '#fff0b0');
    }
  }
  // embers around the flame
  p.set(11, 6, '#ffb347');
  p.set(21, 5, '#ffb347');
  p.set(10, 9, '#e0701a');
  p.set(22, 9, '#e0701a');
  p.set(16, 0, '#ffd97a');
};

const tntSide: TilePainter = (p) => {
  p.fill('#c4392c');
  tone(p, 0x3101, '#d64a38', '#a72a20', { cell: 6, strength: 0.14, levels: 3 });
  for (let x = 0; x < T; x += 8) p.rect(x, 0, 1, 10, '#a52a20');
  // white label band with the classic stencilled letters (original glyphs)
  p.rect(0, 10, T, 12, '#e8e2d8');
  p.rect(0, 10, T, 1, '#c8c2b8');
  p.rect(0, 21, T, 1, '#c8c2b8');
  const ink = col('#3a2a20');
  stampGlyph(p, GLYPHS.T, 4, 12, ink);
  stampGlyph(p, GLYPHS.N, 13, 12, ink);
  stampGlyph(p, GLYPHS.T, 22, 12, ink);
  // strap shadows above and below the band
  const rng = mulberry32(0x3102);
  for (let i = 0; i < 6; i++) {
    const x = Math.floor(rng() * T);
    const y = Math.floor(rng() * T);
    p.rect(x, y, 2 + Math.floor(rng() * 4), 1, rng() < 0.5 ? '#b03024' : '#d9503c');
  }
  specks(p, 0x3103, ['#e05a46', '#9c241a'], 8);
};

const tntTop: TilePainter = (p) => {
  p.fill('#c4392c');
  tone(p, 0x3111, '#d64a38', '#a72a20', { cell: 6, strength: 0.14, levels: 3 });
  p.rect(0, 0, T, 1, '#a52a20');
  p.rect(0, T - 1, T, 1, '#a52a20');
  // fuse hole
  p.rect(13, 13, 6, 6, '#4a3a30');
  p.rect(14, 14, 4, 4, '#241a14');
  p.rect(15, 15, 2, 2, '#0e0a08');
  // fuse
  p.line(16, 13, 21, 7, '#6a4a2a');
  p.line(21, 7, 25, 8, '#6a4a2a');
  p.set(25, 7, '#8a6a3a');
  p.set(22, 6, '#8a6a3a');
  specks(p, 0x3112, ['#e05a46', '#9c241a'], 8);
};

const tntBottom: TilePainter = (p) => {
  p.fill('#8a2c20');
  tone(p, 0x3121, '#a83a2c', '#6f1f18', { cell: 6, strength: 0.16, levels: 3 });
  p.rect(0, 0, T, 1, '#6a1a14');
  p.rect(0, T - 1, T, 1, '#6a1a14');
  specks(p, 0x3122, ['#a83a2c', '#5f1812'], 10);
};

// ---------------------------------------------------------------------------
// bookshelf / mineral blocks
// ---------------------------------------------------------------------------

const BOOK_COLORS = palette(['#a83a34', '#34589c', '#3f7a3c', '#b08a2e', '#8a4a8a', '#c8c0a8', '#7a4a2a']);

const bookshelf: TilePainter = (p) => {
  oakPlanks(p);
  p.rect(0, 0, T, 2, '#8d6a3c');
  p.rect(0, 0, T, 1, '#c9a267');
  p.rect(0, T - 2, T, 2, '#8d6a3c');
  p.rect(0, T - 2, T, 1, '#6f5230');
  const rows: readonly (readonly [number, number])[] = [
    [2, 13],
    [17, 28],
  ];
  for (const [top, bottom] of rows) {
    p.rect(0, bottom, T, 2, '#6a4a24');
    p.rect(0, bottom, T, 1, '#8d6a3c');
    const rng = mulberry32(0x43 ^ top);
    let x = 1;
    while (x < T - 2) {
      const width = 1 + Math.floor(rng() * 3);
      const height = bottom - top - Math.floor(rng() * 3);
      const color = BOOK_COLORS[Math.floor(rng() * BOOK_COLORS.length)];
      const y = bottom - height;
      p.rect(x, y, width, height, color);
      p.rect(x, y, width, 1, mixPixel(color, col('#e8e0c8'), 0.42));
      p.rect(x + width - 1, y, 1, height, mixPixel(color, col('#1a1208'), 0.35));
      if (width >= 2 && rng() < 0.5) p.set(x, y + 2, '#d8c890');
      x += width + 1;
    }
  }
};

function mineralBlockTile(
  seed: number,
  base: string,
  light: string,
  dark: string,
  glint: string,
): TilePainter {
  return (p) => {
    p.fill(base);
    tone(p, seed, light, dark, { cell: 8, strength: 0.12, levels: 3 });
    const origins: readonly (readonly [number, number])[] = [
      [2, 2],
      [17, 2],
      [2, 17],
      [17, 17],
    ];
    origins.forEach(([ox, oy], index) => {
      const vary = hash2f(seed, index, 3) * 0.14;
      const face = mixPixel(col(base), hash2f(seed, index, 4) < 0.5 ? col(light) : col(dark), vary);
      p.rect(ox, oy, 13, 13, face);
      p.rect(ox, oy, 13, 1, light);
      p.rect(ox, oy, 1, 13, light);
      p.rect(ox, oy + 12, 13, 1, dark);
      p.rect(ox + 12, oy, 1, 13, dark);
      p.rect(ox + 1, oy + 1, 11, 1, mixPixel(face, col(light), 0.45));
      p.rect(ox + 1, oy + 11, 11, 1, mixPixel(face, col(dark), 0.5));
      // ingot glint
      p.set(ox + 2, oy + 2, glint);
      p.set(ox + 3, oy + 2, glint);
      p.set(ox + 2, oy + 3, glint);
      p.set(ox + 10, oy + 10, mixPixel(face, col(dark), 0.6));
    });
    bevel(p, light, dark, 1);
    specks(p, seed ^ 0x91, [light, dark], 6);
  };
}

const coalBlock = mineralBlockTile(0x4401, '#262626', '#3c3c3c', '#121212', '#555555');
const ironBlock = mineralBlockTile(0x4501, '#c8c8c8', '#e4e4e4', '#9a9a9a', '#f8f8f8');
const goldBlock = mineralBlockTile(0x4601, '#f0cc3c', '#ffe868', '#c09818', '#fff4a8');
const diamondBlock = mineralBlockTile(0x4701, '#52e0d4', '#9cfff6', '#2a9a92', '#e0fff9');
const lapisBlock = mineralBlockTile(0x4801, '#3a54c8', '#5a74ec', '#22378f', '#8aa2ff');
const redstoneBlock = mineralBlockTile(0x4901, '#b8342a', '#e05040', '#7f1c16', '#ff7060');

// ---------------------------------------------------------------------------
// cactus / plants
// ---------------------------------------------------------------------------

const cactusTop: TilePainter = (p) => {
  p.fill('#4c7a2a');
  tone(p, 0x4a01, '#5c8c33', '#3a5f20', { cell: 6, strength: 0.18, levels: 4 });
  p.rect(0, 0, T, 2, '#3a5f20');
  p.rect(0, T - 2, T, 2, '#3a5f20');
  p.rect(0, 0, 2, T, '#3a5f20');
  p.rect(T - 2, 0, 2, T, '#3a5f20');
  p.rect(2, 2, 1, T - 4, '#5c8c33');
  p.rect(2, 2, T - 4, 1, '#5c8c33');
  // lighter flesh
  p.rect(9, 9, 14, 14, '#5c8c33');
  p.rect(10, 10, 12, 12, '#6a9a3e');
  p.rect(11, 11, 10, 10, '#78a84a');
  // spine dots at the four corners
  const spines: readonly (readonly [number, number])[] = [
    [6, 6],
    [25, 6],
    [6, 25],
    [25, 25],
  ];
  for (const [sx, sy] of spines) {
    p.set(sx, sy, '#d8e6a8');
    p.set(sx + 1, sy, '#b8cf88');
    p.set(sx, sy + 1, '#b8cf88');
  }
};

const cactusSide: TilePainter = (p) => {
  p.fill('#4c7a2a');
  tone(p, 0x4a02, '#5c8c33', '#3a5f20', { cell: 7, strength: 0.16, levels: 3 });
  // dark side ridges with a lighter inner edge
  p.rect(0, 0, 3, T, '#3a5f20');
  p.rect(3, 0, 1, T, '#5c8c33');
  p.rect(T - 3, 0, 3, T, '#3a5f20');
  p.rect(T - 4, 0, 1, T, '#5c8c33');
  // central rib
  p.rect(15, 0, 2, T, '#5c8c33');
  p.rect(15, 0, 1, T, '#6a9a3e');
  // spines
  for (let y = 2; y < T; y += 5) {
    p.set(8, y, '#d8e6a8');
    p.set(9, y, '#a8c878');
    p.set(23, y + 2, '#d8e6a8');
    p.set(22, y + 2, '#a8c878');
    p.set(16, y + 4, '#a8c878');
    p.set(11, y + 1, '#6a9a3e');
    p.set(20, y + 3, '#6a9a3e');
  }
  specks(p, 0x4a03, ['#5c8c33', '#3a5f20'], 8);
};

const sugarCane: TilePainter = (p) => {
  p.fill('rgba(0,0,0,0)');
  const stalks: readonly (readonly [number, number, number])[] = [
    [5, 0, 2],
    [14, 3, 5],
    [23, 1, 3],
  ];
  for (const [sx, sy, width] of stalks) {
    const top = sy;
    for (let y = top; y < T; y++) {
      for (let dx = 0; dx < width; dx++) {
        let color = '#7fb04a';
        if (dx === 0) color = '#65933a';
        else if (dx === width - 1) color = '#96c25c';
        p.set(sx + dx, y, color);
      }
      // nodes
      if ((y - top) % 7 === 3) {
        p.rect(sx - 1, y, width + 2, 1, '#5c8834');
        p.set(sx, y - 1, '#a8d070');
      }
    }
    // leaf blades at the top
    p.line(sx, top + 1, sx - 3, top - 2, '#6a9a3c');
    p.line(sx + width - 1, top + 2, sx + width + 2, top - 1, '#79a848');
    p.line(sx + 1, top, sx + 2, top - 3, '#8ab856');
  }
  // one angled blade lower down
  p.line(11, 18, 8, 13, '#7fb04a');
  p.line(12, 17, 10, 12, '#65933a');
};

const tallGrass: TilePainter = (p) => {
  p.fill('rgba(0,0,0,0)');
  const blades = 10;
  for (let i = 0; i < blades; i++) {
    const baseX = 3 + i * 3 + (hash2i(0x6002, i, 0) % 2);
    const height = 10 + (hash2i(0x6003, i, 1) % 13);
    const lean = (hash2i(0x6004, i, 2) % 5) - 2;
    const color = i % 3 === 0 ? '#5c8c33' : i % 3 === 1 ? '#6a9e3f' : '#4e7a2b';
    for (let s = 0; s < height; s++) {
      const t = s / height;
      const x = baseX + Math.round(lean * t * t);
      const y = T - 1 - s;
      p.set(x, y, color);
      if (s > height * 0.55 && s % 3 === 0) p.set(x + 1, y, '#7cae4d');
    }
    p.set(baseX + Math.round(lean), T - height, '#86b95a');
  }
};

function flowerTile(kind: 'poppy' | 'dandelion'): TilePainter {
  return (p) => {
    p.fill('rgba(0,0,0,0)');
    const stem = kind === 'poppy' ? '#3f6b26' : '#4a7a2c';
    // stem
    for (let y = 13; y < T; y++) p.set(16, y, stem);
    for (let y = 13; y < T; y += 2) p.set(17, y + 1, '#5c8c33');
    // leaves
    p.line(15, 23, 11, 20, '#4e7a2b');
    p.line(11, 20, 9, 21, '#5c8c33');
    p.line(17, 26, 21, 23, '#4e7a2b');
    p.line(21, 23, 23, 24, '#5c8c33');
    if (kind === 'poppy') {
      // red petals
      p.rect(11, 7, 10, 7, '#b83a2e');
      p.rect(12, 5, 8, 10, '#c8402f');
      p.rect(10, 9, 12, 4, '#b83a2e');
      p.rect(13, 6, 3, 2, '#e05a44');
      p.rect(11, 9, 2, 2, '#d64c38');
      p.rect(19, 11, 2, 2, '#9c2c22');
      // dark centre
      p.rect(14, 9, 4, 3, '#3a2a14');
      p.set(15, 10, '#e0c040');
      p.rect(15, 13, 2, 1, '#5c8c33');
    } else {
      // yellow head
      p.rect(12, 6, 8, 2, '#c4a21a');
      p.rect(11, 8, 10, 5, '#e0c040');
      p.rect(12, 13, 8, 2, '#c4a21a');
      p.rect(13, 7, 6, 8, '#f2d24a');
      p.rect(14, 9, 4, 4, '#ffe86a');
      p.rect(13, 6, 2, 2, '#f8e070');
      // green calyx
      p.rect(14, 14, 4, 2, '#5c8c33');
    }
  };
}

const poppy = flowerTile('poppy');
const dandelion = flowerTile('dandelion');

const deadBush: TilePainter = (p) => {
  p.fill('rgba(0,0,0,0)');
  const branches: readonly (readonly [number, number, number, number, number])[] = [
    [16, 31, 16, 16, 0],
    [16, 24, 10, 15, 1],
    [16, 22, 22, 12, 1],
    [16, 18, 12, 8, 2],
    [16, 20, 19, 6, 2],
    [10, 15, 7, 9, 2],
    [22, 12, 25, 6, 2],
  ];
  for (const [x0, y0, x1, y1, thickness] of branches) {
    const steps = Math.max(Math.abs(x1 - x0), Math.abs(y1 - y0));
    for (let s = 0; s <= steps; s++) {
      const t = s / Math.max(1, steps);
      const x = Math.round(x0 + (x1 - x0) * t);
      const y = Math.round(y0 + (y1 - y0) * t);
      p.set(x, y, '#6a4a24');
      if (thickness > 0 && s % 3 === 0) p.set(x + 1, y, '#5a3c1c');
      if (thickness > 1 && s % 4 === 0) p.set(x, y + 1, '#7e5a2e');
    }
  }
  const rng = mulberry32(0x6101);
  for (let i = 0; i < 12; i++) {
    const x = Math.floor(rng() * T);
    const y = 4 + Math.floor(rng() * 16);
    p.set(x, y, rng() < 0.5 ? '#7e5a2e' : '#553a1c');
  }
};

// ---------------------------------------------------------------------------
// crack overlay (crack_0 .. crack_9)
// ---------------------------------------------------------------------------

function crackTile(stage: number): TilePainter {
  return (p) => {
    p.fill('rgba(0,0,0,0)');
    const rng = mulberry32(0xc0ffee ^ (stage * 7919));
    const alpha = Math.min(0.85, 0.26 + stage * 0.06);
    const core = `rgba(10,6,6,${alpha.toFixed(3)})`;
    const soft = `rgba(10,6,6,${(alpha * 0.55).toFixed(3)})`;
    const rays = 2 + Math.ceil(stage * 0.8);
    for (let ray = 0; ray < rays; ray++) {
      let x = 15 + (hash2i(0xc1, stage, ray) % 3);
      let y = 15 + (hash2i(0xc2, stage, ray) % 3);
      let angle = rng() * Math.PI * 2;
      const length = 5 + Math.floor(rng() * 5) + stage * 2;
      for (let s = 0; s < length; s++) {
        angle += (rng() - 0.5) * 0.8;
        const nextX = x + Math.round(Math.cos(angle) * 1.6);
        const nextY = y + Math.round(Math.sin(angle) * 1.6);
        if (nextX < -1 || nextY < -1 || nextX > T || nextY > T) break;
        // Bresenham lines keep the fracture continuous (single dots read as noise)
        p.line(x, y, nextX, nextY, core);
        if (stage > 4) p.line(x + 1, y + 1, nextX + 1, nextY + 1, soft);
        if (stage > 6 && s % 3 === 0) p.line(x - 1, y, nextX - 1, nextY, soft);
        x = nextX;
        y = nextY;
      }
    }
  };
}

// ---------------------------------------------------------------------------
// registry
// ---------------------------------------------------------------------------

const TILES: Record<string, TilePainter> = {
  air: (p) => p.fill('rgba(0,0,0,0)'),
  stone,
  granite,
  diorite,
  andesite,
  cobblestone,
  mossy_cobblestone: mossyCobblestone,
  dirt: dirtBase,
  coarse_dirt: coarseDirt,
  grass_top: (p) => {
    p.fill('#74a33f');
    tone(p, 0x2001, '#87b552', '#66923a', { cell: 5, strength: 0.18, levels: 4 });
    blobs(p, 0x2002, ['#7fae4a', '#6b9939', '#79a845'], 10, 1, 2);
    specks(p, 0x2003, ['#5d8730', '#8fbd58', '#6f9d3c'], 18);
    // short grass strokes give the top face its directionality
    const rng = mulberry32(0x2004);
    for (let i = 0; i < 16; i++) {
      const x = Math.floor(rng() * T);
      const y = Math.floor(rng() * T);
      p.set(x, y, '#8fbd58');
      p.set(x, wrap(y + 1), '#5d8730');
      if (rng() < 0.4) p.set(wrap(x + 1), wrap(y + 1), '#7fae4a');
      if (rng() < 0.25) p.set(x, wrap(y + 2), '#527d2c');
    }
  },
  grass_side: (p) => {
    dirtBase(p);
    for (let x = 0; x < T; x++) {
      const depth = 5 + Math.floor(hash2f(0x2345, x, 0) * 4);
      for (let y = 0; y < depth; y++) {
        let color = '#74a33f';
        if (y <= 1) color = '#8cba58';
        else if (y >= depth - 2) color = '#5d8733';
        if (hash2f(0x2346, x, y) < 0.18) color = y < depth / 2 ? '#7fae4a' : '#527a2c';
        p.set(x, y, color);
      }
      const overhang = hash2f(0x2347, x, 0);
      if (overhang < 0.28) p.set(x, depth, '#5d8733');
      else if (overhang < 0.42) p.set(x, depth, '#527a2c');
      if (overhang > 0.9) p.set(x, wrap(depth + 1), '#4e7429');
    }
    // stray grass pixels on the dirt band
    const rng = mulberry32(0x2348);
    for (let i = 0; i < 9; i++) {
      const x = Math.floor(rng() * T);
      const y = 9 + Math.floor(rng() * 4);
      p.set(x, y, rng() < 0.5 ? '#5d8733' : '#4e7429');
    }
  },
  sand,
  sandstone_top: sandstoneTop,
  sandstone_side: sandstoneSide,
  sandstone_bottom: sandstoneBottom,
  gravel,
  clay,
  bedrock,
  snow,
  ice,
  water,
  lava,
  oak_log: oakLog,
  oak_log_top: oakLogTop,
  birch_log: birchLog,
  birch_log_top: birchLogTop,
  spruce_log: spruceLog,
  spruce_log_top: spruceLogTop,
  oak_leaves: oakLeaves,
  birch_leaves: birchLeaves,
  spruce_leaves: spruceLeaves,
  coal_ore: coalOre,
  copper_ore: copperOre,
  iron_ore: ironOre,
  gold_ore: goldOre,
  redstone_ore: redstoneOre,
  lapis_ore: lapisOre,
  diamond_ore: diamondOre,
  obsidian,
  oak_planks: oakPlanks,
  birch_planks: birchPlanks,
  spruce_planks: sprucePlanks,
  smooth_stone: smoothStone,
  stone_bricks: stoneBricks,
  bricks,
  glass,
  wool_white: woolWhite,
  wool_red: woolRed,
  wool_yellow: woolYellow,
  wool_blue: woolBlue,
  wool_black: woolBlack,
  crafting_table_top: craftingTableTop,
  crafting_table_side: craftingTableSide,
  crafting_table_front: craftingTableFront,
  furnace_top: furnaceTop,
  furnace_side: furnaceSide,
  furnace_front: furnaceFront,
  furnace_front_lit: furnaceFrontLit,
  chest_top: chestTop,
  chest_side: chestSide,
  chest_front: chestFront,
  torch,
  tnt_top: tntTop,
  tnt_side: tntSide,
  tnt_bottom: tntBottom,
  bookshelf,
  coal_block: coalBlock,
  iron_block: ironBlock,
  gold_block: goldBlock,
  diamond_block: diamondBlock,
  lapis_block: lapisBlock,
  redstone_block: redstoneBlock,
  cactus_top: cactusTop,
  cactus_side: cactusSide,
  sugar_cane: sugarCane,
  tall_grass: tallGrass,
  poppy,
  dandelion,
  dead_bush: deadBush,
};

for (let stage = 0; stage < 10; stage++) {
  TILES[`crack_${stage}`] = crackTile(stage);
}

export const TILE_NAMES: readonly string[] = Object.freeze(Object.keys(TILES));
export { TILES };
