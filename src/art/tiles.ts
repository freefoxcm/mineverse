import { hash2i, mulberry32 } from '../core/rng';
import { Sprite16, sprite16 } from './tile16';
import type { TilePainter } from './types';

/**
 * Procedural block textures for MineVerse, authored on a **16x16 logical grid**
 * and stamped into the 32x32 tile as crisp 2x2 blocks (see `tile16.ts`).
 *
 * Why: the first mipmap level of a 32x32 tile authored this way is exactly the
 * 16x16 art, so distant surfaces stay clean Minecraft-style pixels instead of
 * blurring into soft noise. Palettes stay at 3-4 tones per material with hard
 * edges; detail is small high-frequency clusters, never large soft gradients.
 *
 * All painters are deterministic (seeded hash / mulberry32) and idempotent.
 * Every name referenced by `blocks.ts` faceTexture() is covered, plus crack_0..9.
 */

const GRASS_BASE = '#79C05A';
const DIRT_BASE = '#8A5B33';
const STONE_BASE = '#7F7F7F';

// ---------------------------------------------------------------------------
// shared painters
// ---------------------------------------------------------------------------

function paintStone(s: Sprite16, seed: number): void {
  s.fill(STONE_BASE);
  s.noise(seed, [STONE_BASE, '#757575', '#8A8A8A', '#6A6A6A', '#909090'], [7, 3, 3, 2, 1]);
  // chunky light/dark chips (1-3 cells) + fine cracks
  s.clusters(seed ^ 0x51, ['#8C8C8C'], 3, 1);
  s.clusters(seed ^ 0x52, ['#6F6F6F'], 3, 1);
  s.line(3, 3, 5, 6, '#626262');
  s.line(5, 6, 8, 7, '#626262');
  s.set(9, 11, '#616161');
  s.set(10, 12, '#616161');
  s.set(11, 12, '#616161');
  s.set(6, 1, '#969696');
  s.set(2, 12, '#8E8E8E');
  s.set(13, 5, '#8E8E8E');
  s.set(12, 13, '#8E8E8E');
}

function paintDirt(s: Sprite16, seed: number): void {
  s.fill(DIRT_BASE);
  s.noise(seed, [DIRT_BASE, '#7C4F2B', '#98683E', '#6D4425'], [7, 3, 3, 2]);
  s.speckle(seed ^ 0x11, ['#6D4425', '#6D4425', '#A27447'], 8);
  s.rect(4, 10, 2, 1, '#5F3A1E');
  s.set(11, 4, '#5F3A1E');
  s.set(12, 4, '#5F3A1E');
  s.set(2, 2, '#A27447');
  s.set(13, 12, '#A27447');
}

function paintCobble(s: Sprite16, seed: number, mossy: boolean): void {
  s.fill('#4A4A4A');
  const tones = ['#8C8C8C', '#7D7D7D', '#979797', '#737373', '#868686', '#A0A0A0'];
  const rng = mulberry32(seed);
  const centers: Array<{ x: number; y: number; tone: string }> = [];
  for (let gy = 0; gy < 3; gy++) {
    for (let gx = 0; gx < 3; gx++) {
      centers.push({
        x: (gx + 0.2 + rng() * 0.6) * (16 / 3),
        y: (gy + 0.2 + rng() * 0.6) * (16 / 3),
        tone: tones[Math.floor(rng() * tones.length)],
      });
    }
  }
  for (let y = 0; y < 16; y++) {
    for (let x = 0; x < 16; x++) {
      let d1 = Number.POSITIVE_INFINITY;
      let d2 = Number.POSITIVE_INFINITY;
      let best = centers[0];
      for (const c of centers) {
        const d = Math.hypot(x + 0.5 - c.x, y + 0.5 - c.y);
        if (d < d1) {
          d2 = d1;
          d1 = d;
          best = c;
        } else if (d < d2) {
          d2 = d;
        }
      }
      if (d2 - d1 < 1.05) {
        s.set(x, y, '#4A4A4A');
        continue;
      }
      const facing = x + 0.5 - best.x + (y + 0.5 - best.y);
      let color = best.tone;
      if (facing < -1.7) color = '#A8A8A8';
      else if (facing > 1.7) color = '#616161';
      s.set(x, y, color);
    }
  }
  s.speckle(seed ^ 0x20, ['#909090', '#6E6E6E'], 10);
  if (mossy) {
    const mossGreens = ['#5C7A3A', '#4C682E', '#6A8A44'];
    const mossRng = mulberry32(seed ^ 0x1f2e);
    for (let i = 0; i < 10; i++) {
      const cx = Math.floor(mossRng() * 16);
      const cy = Math.floor(mossRng() * 16);
      const color = mossGreens[Math.floor(mossRng() * mossGreens.length)];
      s.set(cx, cy, color);
      s.set(cx + 1, cy, color);
      if (mossRng() < 0.6) s.set(cx, cy + 1, color);
    }
  }
}

function paintLeaves(
  s: Sprite16,
  seed: number,
  deep: string,
  dark: string,
  base: string,
  light: string,
): void {
  const rng = mulberry32(seed);
  const tones = [deep, dark, base, base, base, light];
  for (let y = 0; y < 16; y++) {
    for (let x = 0; x < 16; x++) {
      s.set(x, y, tones[Math.floor(rng() * tones.length)]);
    }
  }
  // clustered alpha holes (~12%): leaf masses with a few see-through gaps
  const holeRng = mulberry32(seed ^ 0x3311);
  const holes = new Uint8Array(16 * 16);
  const erase = (x: number, y: number): void => {
    const wx = ((x % 16) + 16) % 16;
    const wy = ((y % 16) + 16) % 16;
    holes[wy * 16 + wx] = 1;
    s.set(wx, wy, 'rgba(0,0,0,0)');
  };
  for (let c = 0; c < 5; c++) {
    let hx = Math.floor(holeRng() * 16);
    let hy = Math.floor(holeRng() * 16);
    const size = 3 + Math.floor(holeRng() * 3);
    for (let i = 0; i < size; i++) {
      erase(hx, hy);
      hx += Math.floor(holeRng() * 3) - 1;
      hy += Math.floor(holeRng() * 3) - 1;
    }
  }
  for (let i = 0; i < 6; i++) erase(Math.floor(holeRng() * 16), Math.floor(holeRng() * 16));
  // rim light on the upper/left edge of each leaf cluster, shadow below/right
  for (let y = 0; y < 16; y++) {
    for (let x = 0; x < 16; x++) {
      if (holes[y * 16 + x]) continue;
      const up = y > 0 && holes[(y - 1) * 16 + x] === 1;
      const left = x > 0 && holes[y * 16 + x - 1] === 1;
      const down = y < 15 && holes[(y + 1) * 16 + x] === 1;
      const right = x < 15 && holes[y * 16 + x + 1] === 1;
      if (up || left) s.set(x, y, light);
      else if (down || right) s.set(x, y, deep);
    }
  }
}

function paintPlanks(
  s: Sprite16,
  seed: number,
  base: string,
  light: string,
  dark: string,
  seam: string,
): void {
  const rng = mulberry32(seed);
  for (let board = 0; board < 4; board++) {
    const y0 = board * 4;
    for (let y = y0; y < y0 + 4; y++) {
      for (let x = 0; x < 16; x++) {
        const roll = rng();
        const color = roll < 0.12 ? light : roll < 0.26 ? dark : base;
        s.set(x, y, color);
      }
    }
    s.rect(0, y0, 16, 1, light);
    s.rect(0, y0 + 3, 16, 1, seam);
    const joint = 2 + Math.floor(rng() * 12);
    s.rect(joint, y0, 1, 3, seam);
    for (let i = 0; i < 2; i++) {
      s.rect(1 + Math.floor(rng() * 13), y0 + 1 + Math.floor(rng() * 2), 2, 1, dark);
    }
  }
}

function paintStoneBricks(
  s: Sprite16,
  seed: number,
  base: string,
  light: string,
  dark: string,
  mortar: string,
): void {
  for (let y = 0; y < 16; y++) {
    const row = Math.floor(y / 4);
    const shift = (row % 2) * 4;
    for (let x = 0; x < 16; x++) {
      const xs = (x + shift) % 16;
      if (y % 4 === 3 || xs % 8 === 7) {
        s.set(x, y, mortar);
        continue;
      }
      const brick = hash2i(seed, row * 2 + Math.floor(xs / 8), 5);
      let color = brick % 2 === 0 ? base : light;
      if (y % 4 === 0) color = light;
      else if (y % 4 === 2) color = dark;
      s.set(x, y, color);
    }
  }
}

function oreTile(
  seed: number,
  oreLight: string,
  oreMid: string,
  oreDark: string,
  clusters = 6,
): TilePainter {
  return sprite16((s) => {
    paintStone(s, 0x3001);
    const rng = mulberry32(seed);
    for (let c = 0; c < clusters; c++) {
      let x = 2 + Math.floor(rng() * 12);
      let y = 2 + Math.floor(rng() * 12);
      const steps = 2 + Math.floor(rng() * 2);
      for (let step = 0; step < steps; step++) {
        // small faceted mineral grain (1-2 logical px), like a chunky ore speck
        s.set(x, y, oreLight);
        s.set(x + 1, y, oreMid);
        s.set(x, y + 1, oreDark);
        if (rng() < 0.5) s.set(x + 1, y + 1, oreMid);
        x = Math.max(1, Math.min(14, x + Math.floor(rng() * 3) - 1));
        y = Math.max(1, Math.min(14, y + Math.floor(rng() * 3) - 1));
      }
    }
    s.speckle(seed ^ 0x71, [oreLight, oreMid], 3);
  });
}

function logSideTile(
  seed: number,
  base: string,
  light: string,
  dark: string,
  crevice: string,
): TilePainter {
  return sprite16((s) => {
    s.fill(base);
    const rng = mulberry32(seed);
    // vertical grain bands 1-2 cells wide
    let x = 0;
    while (x < 16) {
      const width = 1 + Math.floor(rng() * 2);
      const roll = rng();
      const color = roll < 0.16 ? light : roll < 0.34 ? dark : base;
      s.rect(x, 0, width, 16, color);
      x += width;
    }
    // deep vertical bark cracks with a lit ridge
    for (let i = 0; i < 3; i++) {
      const cx = 1 + Math.floor(rng() * 14);
      s.rect(cx, 0, 1, 16, crevice);
      s.rect(cx + 1, 0, 1, 16, light);
    }
    // break up the full-height bands with bark plates + noise
    s.speckle(seed ^ 0x111, [base, light, dark], 22);
    for (let i = 0; i < 6; i++) {
      s.rect(Math.floor(rng() * 15), Math.floor(rng() * 16), 1 + Math.floor(rng() * 2), 1, dark);
    }
    // knots: dark core + lit rim
    for (let k = 0; k < 2; k++) {
      const kx = 2 + Math.floor(rng() * 11);
      const ky = 2 + Math.floor(rng() * 12);
      s.rect(kx, ky, 2, 1, crevice);
      s.rect(kx, ky + 1, 2, 1, dark);
      s.set(kx, ky - 1, light);
      s.set(kx + 2, ky, light);
    }
  });
}

function logTopTile(
  seed: number,
  wood: string,
  light: string,
  dark: string,
  bark: string,
  barkDark: string,
): TilePainter {
  return sprite16((s) => {
    const cx = 7.5;
    const cy = 7.5;
    const phase = (hash2i(seed, 1, 2) % 628) / 100;
    for (let y = 0; y < 16; y++) {
      for (let x = 0; x < 16; x++) {
        const dx = x - cx;
        const dy = y - cy;
        const angle = Math.atan2(dy, dx);
        const r = Math.hypot(dx, dy) + 0.3 * Math.sin(angle * 4 + phase);
        if (r > 6.8) {
          const band = Math.floor((angle + Math.PI) * 3) % 2;
          s.set(x, y, band === 0 ? bark : barkDark);
          continue;
        }
        if (r > 6.2) {
          s.set(x, y, dark);
          continue;
        }
        const ring = Math.floor(r / 1.3);
        let color = ring % 2 === 0 ? wood : dark;
        if (ring === 0) color = dark;
        if (ring === 2) color = light;
        s.set(x, y, color);
      }
    }
    const rng = mulberry32(seed ^ 0x7e33);
    for (let i = 0; i < 3; i++) {
      const angle = rng() * Math.PI * 2;
      for (let r = 2; r < 6; r++) {
        s.set(Math.round(cx + Math.cos(angle) * r), Math.round(cy + Math.sin(angle) * r), dark);
      }
    }
    s.speckle(seed ^ 0x81, [wood, light, dark], 16);
  });
}

function mineralBlockTile(
  seed: number,
  base: string,
  light: string,
  dark: string,
  glint: string,
): TilePainter {
  return sprite16((s) => {
    s.fill(base);
    s.noise(seed, [base, base, light, dark], [5, 2, 1, 1]);
    // outer bevel
    s.rect(0, 0, 16, 1, light);
    s.rect(0, 0, 1, 16, light);
    s.rect(0, 15, 16, 1, dark);
    s.rect(15, 0, 1, 16, dark);
    // 2x2 ingot facets with a lit corner
    const cells: ReadonlyArray<readonly [number, number]> = [
      [2, 2],
      [9, 2],
      [2, 9],
      [9, 9],
    ];
    for (const [ox, oy] of cells) {
      s.rect(ox, oy, 5, 5, base);
      s.rect(ox, oy, 5, 1, light);
      s.rect(ox, oy, 1, 5, light);
      s.rect(ox, oy + 4, 5, 1, dark);
      s.rect(ox + 4, oy, 1, 5, dark);
      s.set(ox + 1, oy + 1, glint);
      s.set(ox + 2, oy + 1, glint);
      s.set(ox + 1, oy + 2, glint);
    }
  });
}

function tallGrassTile(): TilePainter {
  return sprite16((s) => {
    const tufts = [3, 8, 13];
    const palette = ['#6DA84A', '#79C05A', '#5D8F3C', '#8FBF5A'];
    const rng = mulberry32(0x6001);
    for (const baseX of tufts) {
      for (let i = 0; i < 4; i++) {
        const x0 = Math.min(14, Math.max(1, baseX + i - 1));
        const height = 6 + Math.floor(rng() * 6);
        const lean = Math.floor(rng() * 3) - 1;
        const color = palette[Math.floor(rng() * palette.length)];
        for (let h = 0; h < height; h++) {
          const t = h / Math.max(1, height - 1);
          const x = Math.min(15, Math.max(0, x0 + Math.round(lean * t * t)));
          const y = 15 - h;
          s.set(x, y, h === height - 1 ? '#8FBF5A' : color);
          // 2 px wide base, 1 px tips
          if (h < Math.ceil(height * 0.4)) s.set(Math.min(15, x + 1), y, color);
        }
        s.set(Math.min(15, x0 + 1), 15, '#5D8F3C');
      }
    }
  });
}

function crackTile(stage: number): TilePainter {
  return sprite16((s) => {
    const rng = mulberry32(0xc0ffee ^ (stage * 7919));
    const alpha = Math.min(0.85, 0.26 + stage * 0.06);
    const core = `rgba(10,6,6,${alpha.toFixed(3)})`;
    const soft = `rgba(10,6,6,${(alpha * 0.55).toFixed(3)})`;
    const rays = 2 + Math.ceil(stage * 0.8);
    for (let ray = 0; ray < rays; ray++) {
      let x = 7 + (hash2i(0xc1, stage, ray) % 3);
      let y = 7 + (hash2i(0xc2, stage, ray) % 3);
      let angle = rng() * Math.PI * 2;
      const length = 3 + Math.floor(rng() * 3) + stage;
      for (let step = 0; step < length; step++) {
        angle += (rng() - 0.5) * 0.9;
        const nextX = Math.max(-1, Math.min(16, x + Math.round(Math.cos(angle) * 1.2)));
        const nextY = Math.max(-1, Math.min(16, y + Math.round(Math.sin(angle) * 1.2)));
        s.line(x, y, nextX, nextY, core);
        if (stage > 4 && step % 2 === 0) s.line(x + 1, y + 1, nextX + 1, nextY + 1, soft);
        x = nextX;
        y = nextY;
      }
    }
  });
}

/** Tiny 3x5 stencil letters for the TNT label. */
const STENCIL: Readonly<Record<string, readonly string[]>> = {
  T: ['111', '010', '010', '010', '010'],
  N: ['101', '111', '111', '111', '101'],
};

function stampStencil(s: Sprite16, letter: string, x: number, y: number, color: string): void {
  const rows = STENCIL[letter];
  rows.forEach((row, dy) => {
    for (let dx = 0; dx < 3; dx++) if (row[dx] === '1') s.set(x + dx, y + dy, color);
  });
}

// ---------------------------------------------------------------------------
// registry
// ---------------------------------------------------------------------------

const TILES: Record<string, TilePainter> = {
  air: sprite16((s) => s.fill('rgba(0,0,0,0)')),

  stone: sprite16((s) => paintStone(s, 0x1101)),
  granite: sprite16((s) => {
    s.fill('#9A6A5E');
    s.noise(0x1111, ['#9A6A5E', '#8F6156', '#A8786A', '#84564B'], [7, 3, 2, 2]);
    s.speckle(0x1112, ['#B98A7B', '#B98A7B', '#74483E'], 7);
    s.clusters(0x1113, ['#A8786A'], 2, 1);
  }),
  diorite: sprite16((s) => {
    s.fill('#BCBCC0');
    s.noise(0x1114, ['#BCBCC0', '#B3B3B7', '#C6C6CA', '#AAAAAE'], [7, 3, 3, 2]);
    s.speckle(0x1115, ['#8C8C93', '#8C8C93', '#D4D4D8'], 7);
  }),
  andesite: sprite16((s) => {
    s.fill('#8C8C8E');
    s.noise(0x1116, ['#8C8C8E', '#828284', '#969698', '#7A7A7C'], [7, 3, 3, 2]);
    s.speckle(0x1117, ['#A0A0A2', '#6E6E70'], 7);
  }),
  cobblestone: sprite16((s) => paintCobble(s, 0x1201, false)),
  mossy_cobblestone: sprite16((s) => paintCobble(s, 0x1201, true)),

  dirt: sprite16((s) => paintDirt(s, 0x1701)),
  coarse_dirt: sprite16((s) => {
    s.fill('#7B5635');
    s.noise(0x1702, ['#7B5635', '#6F4C2D', '#8A623E', '#5F4127'], [6, 3, 3, 2]);
    s.speckle(0x1703, ['#5F4127', '#5F4127', '#93683F', '#9C7148'], 12);
    s.clusters(0x1704, ['#5F4127'], 3, 1);
  }),

  grass_top: sprite16((s) => {
    s.fill(GRASS_BASE);
    s.noise(0x2001, [GRASS_BASE, '#6DA84A', '#8FBF5A', '#5D8F3C'], [7, 3, 3, 1.5]);
    // small 1-2px tufts, not 2x2 dark squares
    s.speckle(0x2002, ['#5D8F3C', '#5D8F3C', '#6DA84A', '#8FBF5A', '#9CCD6B'], 14);
    s.set(5, 4, '#5D8F3C');
    s.set(5, 5, '#6DA84A');
    s.set(10, 9, '#5D8F3C');
    s.set(10, 10, '#6DA84A');
    s.set(13, 3, '#6DA84A');
    s.set(3, 11, '#9CCD6B');
    s.set(12, 2, '#9CCD6B');
    s.set(7, 7, '#9CCD6B');
  }),

  grass_side: sprite16((s) => {
    paintDirt(s, 0x33aa);
    for (let x = 0; x < 16; x++) {
      const depth = 3 + (hash2i(0x2345, x, 0) % 2);
      for (let y = 0; y < depth; y++) {
        let color = GRASS_BASE;
        if (y === 0) color = '#8FBF5A';
        else if (y === depth - 1) color = '#5D8F3C';
        if (hash2i(0x2346, x, y) % 5 === 0) color = y < depth / 2 ? '#6DA84A' : '#5D8F3C';
        s.set(x, y, color);
      }
      const overhang = hash2i(0x2347, x, 0) % 10;
      if (overhang < 2) s.set(x, depth, '#5D8F3C');
      else if (overhang < 3) s.set(x, depth + 1, '#4F7A33');
    }
  }),

  sand: sprite16((s) => {
    s.fill('#DBD3A2');
    s.noise(0x1901, ['#DBD3A2', '#E6DEAF', '#CFC691', '#C3B985'], [7, 3, 3, 2]);
    s.speckle(0x1902, ['#C3B985', '#C3B985', '#E9E1B6', '#BDB37E'], 10);
    s.rect(3, 6, 2, 1, '#C6BC87');
    s.rect(11, 11, 2, 1, '#C6BC87');
  }),
  sandstone_top: sprite16((s) => {
    s.fill('#DCD2A0');
    s.noise(0x1a01, ['#DCD2A0', '#E7DDB0', '#D0C692', '#C5BA84'], [7, 3, 3, 2]);
    s.speckle(0x1a02, ['#C5BA84', '#EDE3B6'], 8);
  }),
  sandstone_side: sprite16((s) => {
    s.fill('#D8CC9A');
    s.noise(0x1b01, ['#D8CC9A', '#CFC28E', '#E2D7A8', '#C6B983'], [7, 2, 2, 2]);
    s.rect(0, 0, 16, 2, '#E6DBAC');
    s.rect(0, 2, 16, 1, '#C6B983');
    s.rect(0, 7, 16, 1, '#C6B983');
    s.rect(0, 12, 16, 1, '#C6B983');
    s.speckle(0x1b02, ['#C6B983', '#E6DBAC', '#BEAF79'], 10);
    s.set(4, 5, '#BEAF79');
    s.set(11, 9, '#BEAF79');
  }),
  sandstone_bottom: sprite16((s) => {
    s.fill('#CFC28E');
    s.noise(0x1c01, ['#CFC28E', '#DBD09E', '#C4B681', '#BAAC77'], [7, 3, 3, 2]);
    s.speckle(0x1c02, ['#BAAC77', '#E2D7A8'], 8);
    s.rect(3, 4, 1, 3, '#B4A671');
    s.rect(10, 9, 1, 3, '#B4A671');
  }),

  gravel: sprite16((s) => {
    s.fill('#4F4B47');
    const tones = ['#8A8580', '#9A948D', '#7C7671', '#A29C94', '#6E6964', '#948E87'];
    const rng = mulberry32(0x1d01);
    const grid = 6;
    const centers: Array<{ x: number; y: number; tone: string }> = [];
    for (let gy = 0; gy < grid; gy++) {
      for (let gx = 0; gx < grid; gx++) {
        centers.push({
          x: (gx + 0.15 + rng() * 0.7) * (16 / grid),
          y: (gy + 0.15 + rng() * 0.7) * (16 / grid),
          tone: tones[Math.floor(rng() * tones.length)],
        });
      }
    }
    for (let y = 0; y < 16; y++) {
      for (let x = 0; x < 16; x++) {
        let d1 = Number.POSITIVE_INFINITY;
        let d2 = Number.POSITIVE_INFINITY;
        let best = centers[0];
        for (const c of centers) {
          const d = Math.hypot(x + 0.5 - c.x, y + 0.5 - c.y);
          if (d < d1) {
            d2 = d1;
            d1 = d;
            best = c;
          } else if (d < d2) {
            d2 = d;
          }
        }
        if (d2 - d1 < 0.55) {
          s.set(x, y, '#4F4B47');
          continue;
        }
        const facing = x + 0.5 - best.x + (y + 0.5 - best.y);
        let color = best.tone;
        if (facing < -0.7) color = '#B0A9A0';
        else if (facing > 0.7) color = '#57524E';
        s.set(x, y, color);
      }
    }
  }),

  clay: sprite16((s) => {
    s.fill('#A4AFB6');
    s.noise(0x1e01, ['#A4AFB6', '#9AA5AC', '#AEB9C0', '#8F9AA1'], [7, 3, 3, 2]);
    s.speckle(0x1e02, ['#8F9AA1', '#B6C1C8'], 7);
  }),
  bedrock: sprite16((s) => {
    s.fill('#4A4A4A');
    s.noise(0x1f01, ['#4A4A4A', '#565656', '#3E3E3E', '#626262', '#333333'], [5, 3, 3, 2, 2]);
    s.clusters(0x1f02, ['#2E2E2E', '#343434'], 6, 1);
    s.speckle(0x1f03, ['#6A6A6A', '#2C2C2C'], 8);
  }),

  snow: sprite16((s) => {
    s.fill('#F2F5F8');
    s.noise(0x2003, ['#F2F5F8', '#FFFFFF', '#E8EEF3', '#DEE7EE'], [6, 2, 3, 1]);
    s.speckle(0x2004, ['#E2EAEF', '#FFFFFF', '#D6E0E8'], 8);
  }),
  ice: sprite16((s) => {
    const alpha = 214;
    s.fill(`rgba(150,196,236,${alpha})`);
    const palette = [
      `rgba(150,196,236,${alpha})`,
      `rgba(160,206,244,${alpha})`,
      `rgba(136,182,224,${alpha})`,
      `rgba(178,220,250,${alpha})`,
    ];
    s.noise(0x2101, palette, [4, 3, 3, 2]);
    const crack = 'rgba(226,244,252,238)';
    s.line(2, 12, 7, 4, crack);
    s.line(9, 14, 13, 7, crack);
    s.line(5, 2, 9, 6, crack);
    s.speckle(0x2102, [crack, `rgba(120,168,214,${alpha})`], 6);
  }),
  water: sprite16((s) => {
    const alpha = 205;
    s.fill(`rgba(63,118,228,${alpha})`);
    s.noise(0x2201, [
      `rgba(63,118,228,${alpha})`,
      `rgba(58,110,216,${alpha})`,
      `rgba(71,127,234,${alpha})`,
      `rgba(53,103,200,${alpha})`,
    ], [6, 3, 3, 2]);
    // no diagonal stripes: just a few short ripple highlights
    const glint = 'rgba(94,147,242,216)';
    s.rect(2, 3, 2, 1, glint);
    s.rect(9, 2, 2, 1, glint);
    s.rect(5, 8, 2, 1, glint);
    s.rect(12, 7, 2, 1, glint);
    s.rect(1, 12, 2, 1, glint);
    s.rect(8, 13, 2, 1, glint);
    s.rect(13, 11, 1, 1, glint);
    s.set(6, 5, 'rgba(40,84,176,208)');
    s.set(10, 10, 'rgba(40,84,176,208)');
  }),
  lava: sprite16((s) => {
    s.fill('#D45A0E');
    s.noise(0x2301, ['#D45A0E', '#E06A12', '#C24C08', '#F7A121', '#A83C05'], [5, 3, 2, 1, 1]);
    s.clusters(0x2302, ['#FFC33C', '#FFB733'], 5, 1);
    s.clusters(0x2303, ['#8F2C05', '#A83C05'], 4, 1);
    s.speckle(0x2304, ['#FFE07A', '#FF9A1F', '#8F2C05'], 10);
  }),

  oak_log: logSideTile(0x2501, '#6F5430', '#7E623A', '#5A4024', '#42301B'),
  oak_log_top: logTopTile(0x2502, '#B08F5C', '#C9AA74', '#8C6F42', '#6F5430', '#59422A'),
  birch_log: sprite16((s) => {
    s.fill('#D9D5C6');
    s.noise(0x2601, ['#D9D5C6', '#CFCBB9', '#E5E1D3', '#C3BEAC'], [7, 3, 3, 1]);
    for (let i = 0; i < 8; i++) {
      const x = Math.floor(mulberry32(0x2602 + i)() * 14);
      const y = Math.floor(mulberry32(0x2603 + i)() * 14);
      s.rect(x, y, 2 + (i % 2), 1, '#6F6A5E');
      s.rect(x, y + 1, 1, 1, '#A9A496');
    }
    s.speckle(0x2604, ['#B8B3A2', '#EDE9DC'], 8);
  }),
  birch_log_top: logTopTile(0x2605, '#D6C99F', '#E6DDB8', '#B3A67C', '#C2BEB0', '#9C988A'),
  spruce_log: logSideTile(0x2701, '#4B3626', '#5A4430', '#3A2A1A', '#2A1E11'),
  spruce_log_top: logTopTile(0x2702, '#7A5F3A', '#8B6F45', '#5E4527', '#3F2D1B', '#2C2012'),

  oak_leaves: sprite16((s) => paintLeaves(s, 0x2801, '#3A6420', '#457528', '#4F8530', '#5D983B')),
  birch_leaves: sprite16((s) => paintLeaves(s, 0x2901, '#4C7A28', '#588A32', '#64993B', '#74AB48')),
  spruce_leaves: sprite16((s) => paintLeaves(s, 0x2a01, '#2F5322', '#395F27', '#436C2D', '#4F7C34')),

  coal_ore: oreTile(0x2b01, '#4A4A4A', '#2E2E2E', '#161616', 7),
  copper_ore: oreTile(0x2c01, '#E8A878', '#C47A48', '#8A4A28', 7),
  iron_ore: oreTile(0x2d01, '#EBDAC2', '#C9AE90', '#96795C', 7),
  gold_ore: oreTile(0x2e01, '#FFE45E', '#F0C830', '#B08A12', 6),
  redstone_ore: oreTile(0x2f01, '#FF6A5A', '#D6372E', '#8A1912', 8),
  lapis_ore: oreTile(0x3002, '#7A92FF', '#3F5FD6', '#24388F', 8),
  diamond_ore: oreTile(0x3101, '#A8FFF7', '#5CE8DC', '#27A69B', 7),

  obsidian: sprite16((s) => {
    s.fill('#141020');
    s.noise(0x3201, ['#141020', '#1B1729', '#241E36', '#2F2745'], [5, 3, 2, 2]);
    s.clusters(0x3202, ['#1B1729', '#241E36'], 5, 1);
    s.speckle(0x3203, ['#3B2A5C', '#4B3670', '#5A4380'], 7);
    s.rect(3, 10, 2, 1, '#2F2745');
    s.rect(10, 4, 2, 1, '#2F2745');
  }),

  oak_planks: sprite16((s) => paintPlanks(s, 0x3301, '#B58B52', '#C9A267', '#9C7546', '#6F5230')),
  birch_planks: sprite16((s) => paintPlanks(s, 0x3401, '#D7CDB0', '#E6DDC4', '#C3B896', '#918770')),
  spruce_planks: sprite16((s) => paintPlanks(s, 0x3501, '#7A5A38', '#8E6C45', '#67492E', '#4A3420')),

  smooth_stone: sprite16((s) => {
    s.fill('#9A9A9A');
    s.noise(0x3601, ['#9A9A9A', '#949494', '#A2A2A2', '#8E8E8E'], [6, 3, 2, 1]);
    s.rect(0, 0, 16, 1, '#A6A6A6');
    s.rect(0, 15, 16, 1, '#8A8A8A');
    s.speckle(0x3602, ['#A2A2A2', '#8F8F8F'], 5);
  }),
  stone_bricks: sprite16((s) => paintStoneBricks(s, 0x3603, '#7D7D7D', '#8F8F8F', '#686868', '#5A5A5A')),
  bricks: sprite16((s) => {
    const brickTones = ['#A54C3C', '#B0543F', '#984438', '#AD5142'];
    for (let y = 0; y < 16; y++) {
      const row = Math.floor(y / 4);
      const shift = (row % 2) * 4;
      for (let x = 0; x < 16; x++) {
        const xs = (x + shift) % 16;
        if (y % 4 === 3 || xs % 8 === 7) {
          s.set(x, y, '#C3B6A4');
          continue;
        }
        const brick = hash2i(0x3801, row * 2 + Math.floor(xs / 8), 7);
        let color = brickTones[brick % brickTones.length];
        if (y % 4 === 0) color = '#C46650';
        else if (y % 4 === 2) color = '#83362A';
        s.set(x, y, color);
      }
    }
    s.speckle(0x3802, ['#B85A44', '#8F3C2E'], 6);
  }),

  glass: sprite16((s) => {
    s.fill('rgba(0,0,0,0)');
    const frame = '#C6E6F2';
    const frameDark = '#9CC4D6';
    const shine = '#EEFBFF';
    s.rect(0, 0, 16, 1, frame);
    s.rect(0, 15, 16, 1, frame);
    s.rect(0, 0, 1, 16, frame);
    s.rect(15, 0, 1, 16, frame);
    s.rect(1, 1, 14, 1, frameDark);
    s.rect(1, 1, 1, 14, frameDark);
    s.set(2, 3, shine);
    s.set(3, 2, shine);
    s.line(4, 11, 11, 4, shine);
    s.set(12, 12, frame);
  }),

  wool_white: sprite16((s) => {
    s.fill('#E6E6E6');
    s.noise(0x3901, ['#E6E6E6', '#DEDEDE', '#EFEFEF', '#D6D6D6'], [8, 2, 2, 1]);
  }),
  wool_red: sprite16((s) => {
    s.fill('#B83A3A');
    s.noise(0x3a01, ['#B83A3A', '#AE3131', '#C44444', '#A22B2B'], [8, 2, 2, 1]);
  }),
  wool_yellow: sprite16((s) => {
    s.fill('#E0C040');
    s.noise(0x3b01, ['#E0C040', '#D6B734', '#EBCB50', '#C9AA2A'], [8, 2, 2, 1]);
  }),
  wool_blue: sprite16((s) => {
    s.fill('#3A4AB8');
    s.noise(0x3c01, ['#3A4AB8', '#3544AB', '#4354C4', '#2F3D99'], [8, 2, 2, 1]);
  }),
  wool_black: sprite16((s) => {
    s.fill('#2A2A2A');
    s.noise(0x3d01, ['#2A2A2A', '#262626', '#303030', '#222222'], [8, 2, 2, 1]);
  }),

  crafting_table_top: sprite16((s) => {
    paintPlanks(s, 0x7101, '#B58B52', '#C9A267', '#9C7546', '#6F5230');
    s.rect(0, 0, 16, 1, '#6B4A24');
    s.rect(0, 15, 16, 1, '#6B4A24');
    s.rect(0, 0, 1, 16, '#6B4A24');
    s.rect(15, 0, 1, 16, '#6B4A24');
    s.rect(5, 1, 1, 14, '#8D6A3C');
    s.rect(10, 1, 1, 14, '#8D6A3C');
    s.rect(1, 5, 14, 1, '#8D6A3C');
    s.rect(1, 10, 14, 1, '#8D6A3C');
    for (const [cx, cy] of [
      [1, 1],
      [6, 1],
      [11, 1],
      [1, 6],
      [6, 6],
      [11, 6],
      [1, 11],
      [6, 11],
      [11, 11],
    ] as const) {
      s.set(cx, cy, '#D9B97E');
      s.set(cx + 1, cy, '#C9A267');
    }
  }),
  crafting_table_side: sprite16((s) => {
    paintPlanks(s, 0x7102, '#B58B52', '#C9A267', '#9C7546', '#6F5230');
    s.rect(0, 0, 16, 1, '#6B4A24');
    s.rect(0, 15, 16, 1, '#6B4A24');
    // saw
    s.rect(2, 4, 7, 1, '#C8C8C8');
    for (let i = 0; i < 4; i++) s.set(3 + i * 2, 5, '#E0E0E0');
    s.rect(9, 3, 2, 4, '#7A5A30');
    // hammer
    s.rect(4, 10, 1, 5, '#8D6A3C');
    s.rect(3, 9, 4, 2, '#A0A0A0');
    s.set(3, 9, '#C8C8C8');
  }),
  crafting_table_front: sprite16((s) => {
    paintPlanks(s, 0x7103, '#B58B52', '#C9A267', '#9C7546', '#6F5230');
    s.rect(0, 0, 16, 1, '#6B4A24');
    s.rect(0, 15, 16, 1, '#6B4A24');
    s.rect(3, 2, 10, 12, '#6B4A24');
    s.rect(4, 3, 8, 10, '#B58B52');
    s.rect(4, 3, 8, 1, '#D9B97E');
    s.rect(7, 4, 1, 8, '#8D6A3C');
    s.rect(4, 7, 8, 1, '#8D6A3C');
  }),

  furnace_top: sprite16((s) => {
    paintStoneBricks(s, 0x3e01, '#7C7C7C', '#8A8A8A', '#6C6C6C', '#5C5C5C');
    s.rect(4, 4, 8, 8, '#3A3A3A');
    s.rect(5, 5, 6, 6, '#2A2A2A');
    s.rect(6, 6, 4, 4, '#1C1C1C');
    s.set(5, 5, '#585858');
    s.rect(6, 7, 4, 1, '#3A3A3A');
    s.rect(6, 9, 4, 1, '#3A3A3A');
  }),
  furnace_side: sprite16((s) => paintStoneBricks(s, 0x3f01, '#7A7A7A', '#888888', '#666666', '#545454')),
  furnace_front: sprite16((s) => {
    paintStoneBricks(s, 0x3f02, '#7A7A7A', '#888888', '#666666', '#545454');
    s.rect(2, 3, 12, 2, '#8F8F8F');
    s.rect(2, 5, 1, 10, '#8A8A8A');
    s.rect(13, 5, 1, 10, '#6D6D6D');
    s.rect(3, 7, 10, 8, '#1E1E1E');
    s.rect(4, 8, 8, 6, '#161616');
    s.rect(4, 12, 8, 2, '#0E0E0E');
    s.rect(5, 11, 5, 1, '#2A2A2A');
  }),
  furnace_front_lit: sprite16((s) => {
    paintStoneBricks(s, 0x3f02, '#7A7A7A', '#888888', '#666666', '#545454');
    s.rect(2, 3, 12, 2, '#8F8F8F');
    s.rect(2, 5, 1, 10, '#8A8A8A');
    s.rect(13, 5, 1, 10, '#6D6D6D');
    s.rect(3, 7, 10, 8, '#1E1E1E');
    s.rect(4, 8, 8, 6, '#241410');
    // fire: layered flames filling the lower firebox
    s.rect(4, 11, 8, 3, '#F07A18');
    s.rect(5, 9, 6, 3, '#FFB733');
    s.rect(6, 8, 4, 2, '#FFE07A');
    s.rect(7, 8, 2, 1, '#FFF2B0');
    s.set(5, 8, '#FFB733');
    s.set(10, 9, '#FFB733');
    // warm glow on the stone frame
    s.speckle(0x3f05, ['#E08030', '#D06A20'], 6);
  }),

  chest_top: sprite16((s) => {
    paintPlanks(s, 0x3b01, '#A87B42', '#BD8F52', '#8A5E30', '#6B4520');
    s.rect(0, 0, 16, 1, '#6B4520');
    s.rect(0, 15, 16, 1, '#6B4520');
    s.rect(0, 0, 1, 16, '#6B4520');
    s.rect(15, 0, 1, 16, '#6B4520');
    s.rect(1, 1, 14, 1, '#BD8F52');
    s.rect(6, 12, 4, 4, '#8A8A8A');
    s.rect(7, 13, 2, 2, '#E0C060');
  }),
  chest_side: sprite16((s) => {
    paintPlanks(s, 0x3b02, '#A87B42', '#BD8F52', '#8A5E30', '#6B4520');
    s.rect(0, 0, 16, 1, '#6B4520');
    s.rect(0, 15, 16, 1, '#6B4520');
    s.rect(0, 0, 1, 16, '#6B4520');
    s.rect(15, 0, 1, 16, '#6B4520');
    s.rect(0, 7, 16, 1, '#6B4520');
    s.rect(0, 6, 16, 1, '#BD8F52');
    s.rect(2, 1, 2, 2, '#7A7A7A');
    s.rect(12, 1, 2, 2, '#7A7A7A');
  }),
  chest_front: sprite16((s) => {
    paintPlanks(s, 0x3b03, '#A87B42', '#BD8F52', '#8A5E30', '#6B4520');
    s.rect(0, 0, 16, 1, '#6B4520');
    s.rect(0, 15, 16, 1, '#6B4520');
    s.rect(0, 0, 1, 16, '#6B4520');
    s.rect(15, 0, 1, 16, '#6B4520');
    s.rect(0, 7, 16, 1, '#6B4520');
    s.rect(0, 6, 16, 1, '#BD8F52');
    s.rect(6, 6, 4, 5, '#7A7A7A');
    s.rect(6, 6, 4, 1, '#A8A8A8');
    s.rect(7, 7, 2, 2, '#E0C060');
    s.set(7, 10, '#5A4212');
    s.set(8, 10, '#5A4212');
  }),

  torch: sprite16((s) => {
    s.fill('rgba(0,0,0,0)');
    // stick
    s.rect(7, 7, 2, 9, '#8A5A2E');
    s.rect(7, 7, 1, 9, '#5A3A1E');
    s.rect(8, 7, 1, 9, '#A06A38');
    s.set(7, 15, '#4A2E16');
    // coal head
    s.rect(6, 5, 4, 2, '#3A2A18');
    s.rect(6, 4, 4, 1, '#6A4A28');
    // three-layer flame teardrop, attached to the head (no floating embers)
    s.rect(7, 0, 2, 1, '#FFC44A');
    s.rect(6, 1, 4, 1, '#FF8A1E');
    s.rect(7, 1, 2, 1, '#FFC44A');
    s.rect(6, 2, 4, 1, '#FF8A1E');
    s.rect(7, 2, 2, 1, '#FFF0B0');
    s.rect(6, 3, 4, 1, '#FF8A1E');
    s.rect(7, 3, 2, 1, '#FFC44A');
    s.rect(6, 4, 4, 1, '#FF8A1E');
  }),

  tnt_side: sprite16((s) => {
    s.fill('#C4392C');
    s.noise(0x3101, ['#C4392C', '#B03024', '#D04434', '#A52A20'], [7, 2, 2, 2]);
    s.rect(0, 5, 16, 2, '#D8D2C8');
    s.rect(0, 7, 16, 4, '#EDE7DD');
    s.rect(0, 11, 16, 1, '#D8D2C8');
    s.rect(0, 5, 16, 1, '#B8B2A8');
    s.rect(0, 11, 16, 1, '#B8B2A8');
    stampStencil(s, 'T', 2, 7, '#2A2A2A');
    stampStencil(s, 'N', 6, 7, '#2A2A2A');
    stampStencil(s, 'T', 10, 7, '#2A2A2A');
    s.rect(0, 0, 16, 1, '#A52A20');
    s.rect(0, 15, 16, 1, '#A52A20');
  }),
  tnt_top: sprite16((s) => {
    s.fill('#C4392C');
    s.noise(0x3111, ['#C4392C', '#B03024', '#D04434', '#A52A20'], [7, 2, 2, 2]);
    s.rect(0, 0, 16, 1, '#A52A20');
    s.rect(0, 15, 16, 1, '#A52A20');
    s.rect(6, 6, 4, 4, '#4A3A30');
    s.rect(7, 7, 2, 2, '#241A14');
    s.rect(8, 2, 1, 5, '#6A4A2A');
    s.rect(9, 2, 2, 1, '#6A4A2A');
  }),
  tnt_bottom: sprite16((s) => {
    s.fill('#8A2C20');
    s.noise(0x3121, ['#8A2C20', '#7C2318', '#983426', '#6F1F18'], [7, 2, 2, 2]);
    s.rect(0, 0, 16, 1, '#6A1A14');
    s.rect(0, 15, 16, 1, '#6A1A14');
  }),

  bookshelf: sprite16((s) => {
    paintPlanks(s, 0x4201, '#B58B52', '#C9A267', '#9C7546', '#6F5230');
    s.rect(0, 0, 16, 1, '#8D6A3C');
    s.rect(0, 15, 16, 1, '#8D6A3C');
    s.rect(0, 7, 16, 2, '#6A4A24');
    const bookColors = ['#A83A34', '#34589C', '#3F7A3C', '#B08A2E', '#8A4A8A', '#C8C0A8'];
    const rng = mulberry32(0x4202);
    for (const [top, bottom] of [
      [1, 7],
      [9, 15],
    ] as const) {
      let x = 1;
      while (x < 15) {
        const width = 1 + Math.floor(rng() * 2);
        const height = bottom - top - Math.floor(rng() * 2);
        const color = bookColors[Math.floor(rng() * bookColors.length)];
        s.rect(x, bottom - height, width, height, color);
        s.rect(x, bottom - height, width, 1, '#D8C890');
        s.rect(x + width - 1, bottom - height, 1, height, '#3A2A18');
        x += width + 1;
      }
    }
  }),

  coal_block: mineralBlockTile(0x4401, '#262626', '#3C3C3C', '#161616', '#555555'),
  iron_block: mineralBlockTile(0x4501, '#C8C8C8', '#E6E6E6', '#9A9A9A', '#F8F8F8'),
  gold_block: mineralBlockTile(0x4601, '#F0CC3C', '#FFE868', '#C09818', '#FFF4A8'),
  diamond_block: mineralBlockTile(0x4701, '#52E0D4', '#9CFFF6', '#2A9A92', '#E0FFF9'),
  lapis_block: mineralBlockTile(0x4801, '#3A54C8', '#5A74EC', '#22378F', '#8AA2FF'),
  redstone_block: mineralBlockTile(0x4901, '#B8342A', '#E05040', '#7F1C16', '#FF7060'),

  cactus_top: sprite16((s) => {
    s.fill('#4C7A2A');
    s.noise(0x4a01, ['#4C7A2A', '#457326', '#558630', '#3D6A20'], [7, 3, 2, 2]);
    s.rect(0, 0, 16, 1, '#3A5F20');
    s.rect(0, 15, 16, 1, '#3A5F20');
    s.rect(0, 0, 1, 16, '#3A5F20');
    s.rect(15, 0, 1, 16, '#3A5F20');
    s.rect(4, 4, 8, 8, '#558630');
    s.rect(5, 5, 6, 6, '#6A9A3E');
    for (const [sx, sy] of [
      [3, 3],
      [12, 4],
      [4, 12],
      [12, 11],
    ] as const) {
      s.set(sx, sy, '#D8E6A8');
      s.set(sx + 1, sy, '#A8C878');
    }
  }),
  cactus_side: sprite16((s) => {
    s.fill('#4C7A2A');
    s.noise(0x4a02, ['#4C7A2A', '#457326', '#558630', '#3D6A20'], [7, 3, 2, 2]);
    s.rect(0, 0, 1, 16, '#3A5F20');
    s.rect(1, 0, 1, 16, '#5C8C33');
    s.rect(15, 0, 1, 16, '#3A5F20');
    s.rect(14, 0, 1, 16, '#5C8C33');
    s.rect(7, 0, 2, 16, '#558630');
    s.rect(7, 0, 1, 16, '#6A9A3E');
    for (let y = 2; y < 16; y += 4) {
      s.set(4, y, '#D8E6A8');
      s.set(11, y + 2, '#D8E6A8');
      s.set(4, y + 1, '#A8C878');
    }
  }),

  sugar_cane: sprite16((s) => {
    s.fill('rgba(0,0,0,0)');
    const stalks: ReadonlyArray<readonly [number, number]> = [
      [2, 0],
      [7, 2],
      [12, 1],
    ];
    for (const [x, top] of stalks) {
      s.rect(x, top, 2, 16 - top, '#7FBE4A');
      s.rect(x, top, 1, 16 - top, '#65933A');
      s.rect(x + 1, top, 1, 16 - top, '#96C25C');
      for (let y = top + 3; y < 16; y += 4) {
        s.rect(x - 1, y, 4, 1, '#5C8834');
        s.set(x, y - 1, '#A8D070');
      }
      s.set(x, top, '#A8D070');
      s.set(x + 1, top, '#A8D070');
      s.line(x, top + 1, x - 2, top - 1, '#79A848');
      s.line(x + 1, top + 1, x + 3, top - 1, '#79A848');
    }
    s.line(6, 11, 4, 8, '#6A9A3C');
  }),

  tall_grass: tallGrassTile(),

  poppy: sprite16((s) => {
    s.fill('rgba(0,0,0,0)');
    // stem: 2 logical px wide (same as vanilla), from the ground up under the head
    s.rect(7, 8, 1, 8, '#3F6B26');
    s.rect(8, 8, 1, 8, '#4E7A2B');
    // two leaves
    s.rect(5, 10, 2, 1, '#3F6B26');
    s.rect(4, 11, 3, 1, '#4E7A2B');
    s.rect(9, 12, 2, 1, '#3F6B26');
    s.rect(9, 13, 3, 1, '#4E7A2B');
    // red flower head: 7 wide x 6 tall (vanilla poppy is ~6x7), top rows stay clear
    s.rect(6, 2, 5, 1, '#D63C30');
    s.rect(5, 3, 7, 1, '#C8302A');
    s.rect(5, 4, 7, 1, '#C8302A');
    s.rect(5, 5, 7, 1, '#C8302A');
    s.rect(5, 6, 7, 1, '#C8302A');
    s.rect(6, 7, 5, 1, '#A82A22');
    // petal shading + dark pistil centre
    s.set(6, 3, '#E05A44');
    s.set(7, 2, '#E05A44');
    s.set(5, 5, '#A82A22');
    s.set(11, 5, '#A82A22');
    s.rect(7, 4, 3, 2, '#2A1A10');
    s.set(8, 3, '#1A0F08');
    s.set(8, 6, '#1A0F08');
  }),
  dandelion: sprite16((s) => {
    s.fill('rgba(0,0,0,0)');
    s.rect(7, 9, 1, 7, '#3F6B26');
    s.rect(8, 9, 1, 7, '#4E7A2B');
    // leaves
    s.rect(5, 11, 2, 1, '#3F6B26');
    s.rect(4, 12, 3, 1, '#4E7A2B');
    s.rect(9, 12, 2, 1, '#3F6B26');
    s.rect(9, 13, 3, 1, '#4E7A2B');
    // yellow flower head: 7 wide x 6 tall, sits in the lower 13 px of the tile
    s.rect(6, 3, 5, 1, '#F2D24A');
    s.rect(5, 4, 7, 1, '#F2D24A');
    s.rect(5, 5, 7, 1, '#F2D24A');
    s.rect(5, 6, 7, 1, '#F2D24A');
    s.rect(6, 7, 5, 1, '#E8C63E');
    s.rect(7, 8, 3, 1, '#C4A21A');
    s.set(6, 4, '#FFE86A');
    s.set(7, 3, '#FFE86A');
    s.set(5, 5, '#D8B830');
    s.set(11, 6, '#D8B830');
    s.rect(7, 5, 3, 2, '#C4A21A');
    s.set(8, 5, '#B89418');
  }),
  dead_bush: sprite16((s) => {
    s.fill('rgba(0,0,0,0)');
    s.line(7, 15, 7, 8, '#6B4A24');
    s.line(7, 11, 3, 6, '#6B4A24');
    s.line(7, 10, 11, 5, '#7E5A2E');
    s.line(7, 8, 5, 3, '#6B4A24');
    s.line(7, 8, 9, 2, '#7E5A2E');
    s.line(3, 6, 2, 4, '#5A3C1C');
    s.line(11, 5, 13, 3, '#5A3C1C');
    s.speckle(0x6101, ['#7E5A2E', '#5A3C1C'], 5);
  }),
};

for (let stage = 0; stage < 10; stage++) {
  TILES[`crack_${stage}`] = crackTile(stage);
}

export const TILE_NAMES: readonly string[] = Object.freeze(Object.keys(TILES));
export { TILES };
