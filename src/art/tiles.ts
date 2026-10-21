import { hash2i } from '../core/rng';
import { PixelPainter, type Color } from './pixels';
import { TILE_SIZE, type TilePainter } from './types';

/**
 * Placeholder procedural textures for M0.
 * Art-E owns this file afterwards and replaces these with detailed pixel art.
 */

const T = TILE_SIZE;

function noise(seed: number, colors: Color[], density = 0.45): TilePainter {
  return (p) => {
    p.fill(colors[0]);
    p.speckle(seed, colors.slice(1), density);
  };
}

function clusterNoise(seed: number, colors: Color[], patchSize = 3): TilePainter {
  return (p) => {
    p.fill(colors[0]);
    for (let y = 0; y < T; y += patchSize) {
      for (let x = 0; x < T; x += patchSize) {
        const c = colors[1 + (hash2i(seed, x, y) % (colors.length - 1))];
        p.rect(x, y, patchSize, patchSize, c);
      }
    }
    p.speckle(seed ^ 0x51f3, [colors[0], ...colors.slice(1)], 0.25);
  };
}

function stoneLike(base: Color, light: Color, dark: Color, seed = 11): TilePainter {
  return (p) => {
    p.fill(base);
    p.speckle(seed, [light, dark, base, base], 0.8);
    // a few small cracks
    for (let i = 0; i < 3; i++) {
      const x = hash2i(seed + 7, i, 3) % T;
      const y = hash2i(seed + 9, i, 5) % T;
      p.set(x, y, dark);
      p.set(x + 1, y, dark);
      p.set(x, y + 1, dark);
    }
  };
}

function oreTile(oreLight: Color, oreDark: Color, seed: number): TilePainter {
  const base = stoneLike('#7c7c7c', '#8b8b8b', '#656565', 21);
  return (p) => {
    base(p);
    for (let i = 0; i < 4; i++) {
      const cx = 4 + (hash2i(seed, i, 1) % 24);
      const cy = 4 + (hash2i(seed, i, 2) % 24);
      const size = 2 + (hash2i(seed, i, 3) % 3);
      for (let y = -size; y <= size; y++) {
        for (let x = -size; x <= size; x++) {
          if (x * x + y * y > size * size) continue;
          const edge = x * x + y * y > (size - 1) * (size - 1);
          p.set(cx + x, cy + y, edge ? oreDark : oreLight);
        }
      }
    }
  };
}

function grassTop(): TilePainter {
  return (p) => {
    p.fill('#6a9e3f');
    p.speckle(0x1a2b, ['#7cb34a', '#5c8c33', '#71a744', '#63963a'], 0.9);
    for (let i = 0; i < 40; i++) {
      const x = hash2i(0x77, i, 1) % T;
      const y = hash2i(0x79, i, 2) % T;
      p.set(x, y, hash2i(0x81, i, 3) % 2 ? '#82b94f' : '#527d2c');
    }
  };
}

function grassSide(): TilePainter {
  const dirt = noise(0x33aa, ['#86603f', '#9a6f4a', '#6d4b30', '#7b5538'], 0.9);
  return (p) => {
    dirt(p);
    // jagged grass fringe at the top
    for (let x = 0; x < T; x++) {
      const depth = 7 + (hash2i(0x2345, x, 0) % 5);
      for (let y = 0; y < depth; y++) {
        const shade = y < 2 ? '#5c8c33' : y > depth - 2 ? '#4e7a2b' : '#6a9e3f';
        p.set(x, y, shade);
      }
    }
    for (let x = 0; x < T; x += 2) {
      p.set(x, 9 + (hash2i(0x999, x, 1) % 3), '#4e7a2b');
    }
  };
}

function logSide(base: string, dark: string, light: string, seed: number): TilePainter {
  return (p) => {
    p.fill(base);
    for (let x = 0; x < T; x++) {
      if (x % 5 === 0) p.rect(x, 0, 1, T, dark);
      if (x % 7 === 3) p.rect(x, 0, 1, T, light);
    }
    p.speckle(seed, [dark, light, base], 0.35);
  };
}

function logTop(base: string, dark: string, light: string): TilePainter {
  return (p) => {
    p.fill(base);
    const cx = T / 2;
    for (let ring = 2; ring < 18; ring += 3) {
      for (let a = 0; a < 360; a += 3) {
        const rad = (a * Math.PI) / 180;
        const x = Math.round(cx + Math.cos(rad) * ring);
        const y = Math.round(cx + Math.sin(rad) * ring);
        p.set(x, y, ring % 2 === 0 ? dark : light);
      }
    }
    p.set(16, 16, dark);
  };
}

function planks(base: string, dark: string, light: string, seed: number): TilePainter {
  return (p) => {
    p.fill(base);
    for (let y = 0; y < T; y++) {
      if (y % 8 === 0) p.rect(0, y, T, 1, dark);
      else if (y % 8 === 1) p.rect(0, y, T, 1, light);
    }
    const seam = hash2i(seed, 1, 1) % T;
    p.rect(seam, 0, 1, 8, dark);
    p.rect((seam + 11) % T, 8, 1, 8, dark);
    p.rect((seam + 5) % T, 16, 1, 8, dark);
    p.rect((seam + 19) % T, 24, 1, 8, dark);
    p.speckle(seed, [dark, light], 0.15);
  };
}

function leaves(base: string, dark: string, light: string, seed: number): TilePainter {
  return (p) => {
    p.fill(base);
    for (let y = 0; y < T; y++) {
      for (let x = 0; x < T; x++) {
        const h = hash2i(seed, x, y);
        if (h % 100 < 16) {
          p.set(x, y, 'rgba(0,0,0,0)');
        } else if (h % 100 < 45) {
          p.set(x, y, dark);
        } else if (h % 100 < 65) {
          p.set(x, y, light);
        }
      }
    }
  };
}

function wool(base: string, seed: number): TilePainter {
  return (p) => {
    p.fill(base);
    p.speckle(seed, [shadeHex(base, 0.9), shadeHex(base, 1.08)], 0.4);
  };
}

function shadeHex(hex: string, factor: number): string {
  const value = Number.parseInt(hex.slice(1), 16);
  const r = Math.min(255, Math.round(((value >> 16) & 255) * factor));
  const g = Math.min(255, Math.round(((value >> 8) & 255) * factor));
  const b = Math.min(255, Math.round((value & 255) * factor));
  return `rgb(${r},${g},${b})`;
}

function metalBlock(base: string, light: string, dark: string, seed: number): TilePainter {
  return (p) => {
    p.fill(base);
    p.rect(0, 0, T, 2, light);
    p.rect(0, 0, 2, T, light);
    p.rect(0, T - 2, T, 2, dark);
    p.rect(T - 2, 0, 2, T, dark);
    p.speckle(seed, [light, dark], 0.25);
  };
}

function furnaceFront(lit: boolean): TilePainter {
  return (p) => {
    p.fill('#7a7a7a');
    p.speckle(0x45, ['#8b8b8b', '#656565'], 0.6);
    p.rect(6, 10, 20, 18, '#3a3a3a');
    p.rect(8, 12, 16, 14, '#2a2a2a');
    if (lit) {
      p.rect(10, 18, 12, 8, '#e07a1f');
      p.rect(12, 14, 8, 6, '#ffb52e');
      p.rect(13, 20, 6, 4, '#ffd95e');
    } else {
      p.rect(10, 20, 12, 5, '#1c1c1c');
    }
    p.rect(6, 6, 20, 2, '#9a9a9a');
  };
}

function craftingTop(): TilePainter {
  const planksPaint = planks('#b58b52', '#8d6a3c', '#c9a267', 0x71);
  return (p) => {
    planksPaint(p);
    p.rect(4, 4, 24, 24, '#7a5a30');
    p.rect(5, 5, 10, 10, '#a9824a');
    p.rect(17, 5, 10, 10, '#a9824a');
    p.rect(5, 17, 10, 10, '#a9824a');
    p.rect(17, 17, 10, 10, '#a9824a');
    p.rect(15, 5, 2, 22, '#6a4a24');
    p.rect(5, 15, 22, 2, '#6a4a24');
  };
}

function chestFace(kind: 'top' | 'side' | 'front'): TilePainter {
  return (p) => {
    p.fill('#8a6235');
    p.speckle(0x22, ['#9b7040', '#7a542c'], 0.5);
    p.rect(0, 0, T, 2, '#6a4a24');
    p.rect(0, T - 2, T, 2, '#6a4a24');
    if (kind === 'top') {
      p.rect(12, 12, 8, 8, '#3a3a3a');
      p.rect(14, 14, 4, 4, '#b9a06a');
    } else if (kind === 'front') {
      p.rect(0, 13, T, 2, '#5a3c1e');
      p.rect(13, 12, 6, 8, '#3a3a3a');
      p.rect(15, 14, 2, 4, '#e0c060');
    } else {
      p.rect(0, 13, T, 2, '#5a3c1e');
    }
  };
}

function tntSide(): TilePainter {
  return (p) => {
    p.fill('#c43a2e');
    p.speckle(0x31, ['#d94a3c', '#a82c22'], 0.5);
    p.rect(0, 10, T, 12, '#e8e2d8');
    p.rect(4, 13, 4, 6, '#2a2a2a');
    p.rect(10, 13, 2, 6, '#2a2a2a');
    p.rect(14, 13, 2, 6, '#2a2a2a');
    p.rect(18, 13, 4, 6, '#2a2a2a');
    p.rect(24, 13, 4, 6, '#2a2a2a');
  };
}

function torchTile(): TilePainter {
  return (p) => {
    p.fill('rgba(0,0,0,0)');
    p.rect(14, 12, 4, 20, '#7a5a30');
    p.rect(13, 10, 6, 3, '#9a7040');
    p.rect(13, 8, 6, 2, '#3a2a10');
    p.rect(14, 3, 4, 6, '#ff9a1f');
    p.rect(15, 1, 2, 4, '#ffd95e');
  };
}

function plantTile(kind: 'grass' | 'poppy' | 'dandelion' | 'dead_bush' | 'cane'): TilePainter {
  return (p) => {
    p.fill('rgba(0,0,0,0)');
    if (kind === 'grass') {
      for (let i = 0; i < 7; i++) {
        const x = 4 + i * 4;
        const h = 12 + (hash2i(0x66, i, 1) % 14);
        p.line(x, T - 1, x + (i % 2 === 0 ? 2 : -2), T - h, i % 2 === 0 ? '#5c8c33' : '#6a9e3f');
        p.line(x + 1, T - 1, x + (i % 2 === 0 ? 3 : -1), T - h + 2, '#4e7a2b');
      }
      return;
    }
    if (kind === 'cane') {
      for (let i = 0; i < 3; i++) {
        const x = 6 + i * 9;
        p.rect(x, 0, 3, T, '#7fb04a');
        p.rect(x + 1, 0, 1, T, '#9ac65e');
        for (let y = 4; y < T; y += 7) p.rect(x - 1, y, 5, 1, '#5c8c33');
      }
      return;
    }
    if (kind === 'dead_bush') {
      for (let i = 0; i < 6; i++) {
        const x = 6 + i * 4;
        p.line(x, T - 1, x + ((i % 3) - 1) * 4, T - 12 - (i % 4) * 4, '#6a4a24');
      }
      return;
    }
    // flower
    p.rect(15, 16, 2, 16, '#4e7a2b');
    p.rect(11, 20, 4, 2, '#5c8c33');
    p.rect(17, 24, 4, 2, '#5c8c33');
    if (kind === 'poppy') {
      p.rect(12, 6, 8, 8, '#c43a2e');
      p.rect(13, 5, 6, 2, '#d94a3c');
      p.rect(14, 7, 4, 4, '#2a1a10');
    } else {
      p.rect(12, 7, 8, 7, '#f2d23a');
      p.rect(13, 6, 6, 2, '#ffe86a');
      p.rect(14, 8, 4, 4, '#c4a21a');
    }
  };
}

function crackTile(stage: number): TilePainter {
  return (p) => {
    p.fill('rgba(0,0,0,0)');
    const count = 2 + stage * 2;
    for (let i = 0; i < count; i++) {
      let x = 16 + (hash2i(0xc0 + stage, i, 1) % 9) - 4;
      let y = 16 + (hash2i(0xc1 + stage, i, 2) % 9) - 4;
      const dirX = hash2i(0xc2 + stage, i, 3) % 3;
      const dirY = hash2i(0xc3 + stage, i, 4) % 3;
      const len = 3 + (hash2i(0xc4 + stage, i, 5) % 6);
      for (let s = 0; s < len; s++) {
        p.set(x, y, `rgba(0,0,0,${0.35 + stage * 0.06})`);
        x += dirX - 1;
        y += dirY - 1;
        if (x < 0 || y < 0 || x >= T || y >= T) break;
      }
    }
  };
}

function transparentTile(): TilePainter {
  return (p) => p.fill('rgba(0,0,0,0)');
}

function waterTile(seed: number, base: string, light: string, dark: string): TilePainter {
  return (p) => {
    p.fill(base);
    for (let i = 0; i < 26; i++) {
      const x = hash2i(seed, i, 1) % T;
      const y = hash2i(seed, i, 2) % T;
      p.rect(x, y, 2 + (hash2i(seed, i, 3) % 3), 1, i % 2 === 0 ? light : dark);
    }
  };
}

function iceTile(): TilePainter {
  return (p) => {
    p.fill('rgba(150,200,245,0.75)');
    for (let i = 0; i < 5; i++) {
      const y = 4 + i * 6;
      p.line(0, y, T, y - 6, 'rgba(220,240,255,0.55)');
    }
  };
}

function glassTile(): TilePainter {
  return (p) => {
    p.fill('rgba(0,0,0,0)');
    p.rect(0, 0, T, 2, 'rgba(210,235,245,0.85)');
    p.rect(0, T - 2, T, 2, 'rgba(210,235,245,0.85)');
    p.rect(0, 0, 2, T, 'rgba(210,235,245,0.85)');
    p.rect(T - 2, 0, 2, T, 'rgba(210,235,245,0.85)');
    p.line(5, T - 8, T - 8, 5, 'rgba(240,250,255,0.5)');
  };
}

const TILES: Record<string, TilePainter> = {
  air: transparentTile(),
  stone: stoneLike('#7c7c7c', '#8b8b8b', '#656565', 11),
  granite: noise(0x12, ['#8f675f', '#a4736a', '#7c574f', '#966c64'], 0.7),
  diorite: noise(0x13, ['#b6b6bb', '#c7c7cc', '#a3a3a8', '#bdbdc2'], 0.7),
  andesite: noise(0x14, ['#88898b', '#95969a', '#77787a', '#8f9092'], 0.7),
  cobblestone: clusterNoise(0x15, ['#6f6f6f', '#7d7d7d', '#646464', '#8a8a8a'], 4),
  mossy_cobblestone: (p) => {
    clusterNoise(0x15, ['#6f6f6f', '#7d7d7d', '#646464', '#8a8a8a'], 4)(p);
    p.speckle(0x16, ['#4f6a3a', '#5e7a44'], 0.25);
  },
  dirt: noise(0x17, ['#86603f', '#9a6f4a', '#6d4b30', '#7b5538'], 0.9),
  coarse_dirt: noise(0x18, ['#7a5738', '#8d6642', '#684a2f'], 0.9),
  grass_top: grassTop(),
  grass_side: grassSide(),
  sand: noise(0x19, ['#dcd3a1', '#e6ddb0', '#c9bf8f', '#d5cb98'], 0.7),
  sandstone_top: noise(0x1a, ['#d8cc9a', '#e2d7a8', '#cabd88', '#ded2a2'], 0.6),
  sandstone_side: (p) => {
    p.fill('#d8cc9a');
    for (let y = 0; y < T; y += 5) p.rect(0, y, T, 1, '#b8aa78');
    p.speckle(0x1b, ['#e2d7a8', '#cabd88'], 0.4);
  },
  sandstone_bottom: noise(0x1c, ['#cabd88', '#d8cc9a', '#b8aa78'], 0.6),
  gravel: clusterNoise(0x1d, ['#8a8582', '#9a9591', '#77726e', '#a5a09b'], 3),
  clay: noise(0x1e, ['#a8b0ba', '#b6bec8', '#98a0aa'], 0.7),
  bedrock: clusterNoise(0x1f, ['#565656', '#6a6a6a', '#3f3f3f', '#787878'], 5),
  snow: noise(0x20, ['#f2f5f7', '#ffffff', '#e2e7ec', '#d8e0e6'], 0.5),
  ice: iceTile(),
  water: waterTile(0x21, 'rgba(58,110,220,0.8)', 'rgba(96,150,240,0.85)', 'rgba(40,86,180,0.85)'),
  lava: (p) => {
    p.fill('#d45a0e');
    p.speckle(0x22, ['#f7a12b', '#ffd34d', '#a83c05', '#ff7a1a'], 0.9);
    for (let i = 0; i < 6; i++) {
      p.rect(hash2i(0x23, i, 1) % T, hash2i(0x24, i, 2) % T, 4, 2, '#ffd34d');
    }
  },
  oak_log: logSide('#6b4f2a', '#4b3418', '#82613a', 0x25),
  oak_log_top: logTop('#a98a55', '#7d6238', '#bda06a'),
  birch_log: logSide('#d9d6c7', '#a8a594', '#e8e5d8', 0x26),
  birch_log_top: logTop('#d4cba8', '#b0a887', '#e2dab8'),
  spruce_log: logSide('#4a3520', '#332412', '#5c4429', 0x27),
  spruce_log_top: logTop('#6a5233', '#4e3a20', '#7d6340'),
  oak_leaves: leaves('#4f7f2f', '#3d6524', '#6a9a3f', 0x28),
  birch_leaves: leaves('#6f9a45', '#567d33', '#88b25a', 0x29),
  spruce_leaves: leaves('#3c6430', '#2c5024', '#4e7a3c', 0x2a),
  coal_ore: oreTile('#2e2e2e', '#151515', 0x2b),
  copper_ore: oreTile('#d08050', '#8a4c2c', 0x2c),
  iron_ore: oreTile('#d8c0a8', '#a88a6c', 0x2d),
  gold_ore: oreTile('#f2d04a', '#b8942a', 0x2e),
  redstone_ore: oreTile('#d43a3a', '#8a1c1c', 0x2f),
  lapis_ore: oreTile('#3a5ad8', '#1c2f8a', 0x30),
  diamond_ore: oreTile('#5af2e8', '#2a9a94', 0x31),
  obsidian: noise(0x32, ['#1a1024', '#241633', '#120a1a', '#2c1c40'], 0.8),
  oak_planks: planks('#b58b52', '#8d6a3c', '#c9a267', 0x33),
  birch_planks: planks('#d7cdb0', '#b3a888', '#e6ddc4', 0x34),
  spruce_planks: planks('#7a5a38', '#5c4228', '#8e6c45', 0x35),
  smooth_stone: noise(0x36, ['#9a9a9a', '#a5a5a5', '#8f8f8f'], 0.3),
  stone_bricks: (p) => {
    p.fill('#7c7c7c');
    p.rect(0, 15, T, 2, '#5f5f5f');
    p.rect(15, 0, 2, 15, '#5f5f5f');
    p.rect(7, 17, 2, 15, '#5f5f5f');
    p.rect(23, 17, 2, 15, '#5f5f5f');
    p.speckle(0x37, ['#8b8b8b', '#6b6b6b'], 0.5);
  },
  bricks: (p) => {
    p.fill('#a34a3a');
    for (let y = 0; y < T; y += 8) {
      p.rect(0, y, T, 2, '#c8b8a8');
      const offset = (y / 8) % 2 === 0 ? 0 : 8;
      for (let x = offset; x < T; x += 16) p.rect(x, y, 2, 8, '#c8b8a8');
    }
    p.speckle(0x38, ['#b85642', '#8f3f31'], 0.4);
  },
  glass: glassTile(),
  wool_white: wool('#e6e6e6', 0x39),
  wool_red: wool('#b83a3a', 0x3a),
  wool_yellow: wool('#e0c040', 0x3b),
  wool_blue: wool('#3a4ab8', 0x3c),
  wool_black: wool('#2a2a2a', 0x3d),
  crafting_table_top: craftingTop(),
  crafting_table_side: (p) => {
    planks('#b58b52', '#8d6a3c', '#c9a267', 0x71)(p);
    p.rect(4, 6, 24, 3, '#e8e2d0');
    p.rect(6, 14, 6, 10, '#7a5a30');
    p.rect(16, 12, 4, 12, '#5a7a9a');
    p.rect(22, 16, 4, 8, '#8a6a3a');
  },
  crafting_table_front: (p) => {
    planks('#b58b52', '#8d6a3c', '#c9a267', 0x72)(p);
    p.rect(5, 4, 22, 22, '#7a5a30');
    p.rect(6, 5, 9, 9, '#a9824a');
    p.rect(17, 5, 9, 9, '#a9824a');
    p.rect(6, 16, 9, 9, '#a9824a');
    p.rect(17, 16, 9, 9, '#a9824a');
  },
  furnace_top: stoneLike('#7c7c7c', '#8b8b8b', '#656565', 0x3e),
  furnace_side: stoneLike('#7a7a7a', '#8b8b8b', '#656565', 0x3f),
  furnace_front: furnaceFront(false),
  furnace_front_lit: furnaceFront(true),
  chest_top: chestFace('top'),
  chest_side: chestFace('side'),
  chest_front: chestFace('front'),
  torch: torchTile(),
  tnt_top: (p) => {
    p.fill('#c43a2e');
    p.speckle(0x40, ['#d94a3c', '#a82c22'], 0.5);
    p.rect(10, 10, 12, 12, '#3a3a3a');
    p.rect(13, 13, 6, 6, '#e8e2d8');
  },
  tnt_side: tntSide(),
  tnt_bottom: (p) => {
    p.fill('#8a2c22');
    p.speckle(0x41, ['#a82c22', '#6f1f18'], 0.5);
  },
  bookshelf: (p) => {
    planks('#b58b52', '#8d6a3c', '#c9a267', 0x42)(p);
    p.rect(0, 8, T, 2, '#6a4a24');
    p.rect(0, 24, T, 2, '#6a4a24');
    const colors = ['#b83a3a', '#3a5ab8', '#3a8a4a', '#c0a030', '#9a3aa0'];
    for (let shelf = 0; shelf < 2; shelf++) {
      let x = 2;
      let i = 0;
      while (x < T - 2) {
        const w = 2 + (hash2i(0x43, shelf, i) % 3);
        p.rect(x, 10 + shelf * 14, w, 12, colors[(shelf * 5 + i) % colors.length]);
        x += w + 1;
        i++;
      }
    }
  },
  coal_block: metalBlock('#2e2e2e', '#3f3f3f', '#1a1a1a', 0x44),
  iron_block: metalBlock('#c8c8c8', '#e0e0e0', '#9a9a9a', 0x45),
  gold_block: metalBlock('#f2d04a', '#ffe86a', '#c0a020', 0x46),
  diamond_block: metalBlock('#5af2e8', '#9afff8', '#2a9a94', 0x47),
  lapis_block: metalBlock('#3a5ad8', '#5a7aff', '#1c2f8a', 0x48),
  redstone_block: metalBlock('#c43a3a', '#e05a5a', '#8a1c1c', 0x49),
  cactus_top: noise(0x4a, ['#4e7a2b', '#5c8c33', '#3f6522'], 0.6),
  cactus_side: (p) => {
    p.fill('#4e7a2b');
    p.rect(0, 0, 2, T, '#3b5c20');
    p.rect(T - 2, 0, 2, T, '#3b5c20');
    for (let y = 2; y < T; y += 6) {
      p.set(8, y, '#d8e8b0');
      p.set(23, y + 3, '#d8e8b0');
    }
    p.speckle(0x4b, ['#5c8c33', '#3f6522'], 0.3);
  },
  sugar_cane: plantTile('cane'),
  tall_grass: plantTile('grass'),
  poppy: plantTile('poppy'),
  dandelion: plantTile('dandelion'),
  dead_bush: plantTile('dead_bush'),
};

for (let stage = 0; stage < 10; stage++) {
  TILES[`crack_${stage}`] = crackTile(stage);
}

export const TILE_NAMES = Object.keys(TILES);
export { TILES };
