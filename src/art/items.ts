import { mulberry32 } from '../core/rng';
import {
  IconShape,
  clearCanvas,
  paintIconShape,
  rimLight,
  shapeFlecks,
  type IconPalette as Palette,
} from './iconKit';
import { mixPixel } from './pixelKit';
import { PixelPainter, parseColor, type PixelBuffer, type RGBA } from './pixels';
import { TILE_SIZE as T, type ItemPainter } from './types';

/**
 * Procedural 32x32 item sprites (transparent background, original pixel art).
 *
 * Covers every `allItems()` entry whose `icon === 'sprite'`: materials, food,
 * tools/weapons and armour. Block items intentionally have no sprite - the UI
 * composes them from the block tiles as an isometric cube.
 *
 * Icon language: 1 px dark outline around the silhouette, bevel light on the
 * upper-left, shadow on the lower-right, per-material palettes for tools and
 * armour so tiers are distinguishable at a glance.
 */

// ---------------------------------------------------------------------------
// shape masks + painting helpers
// ---------------------------------------------------------------------------

const WOODEN_HANDLE: Palette = {
  base: '#8a5f32',
  light: '#a9793f',
  dark: '#5f3f1e',
  edge: '#2f1e0c',
};

const MATERIALS: Record<string, Palette> = {
  wooden: { base: '#9a6b3a', light: '#b98a52', dark: '#6f4a24', edge: '#3d2812' },
  stone: { base: '#8b8b8b', light: '#a8a8a8', dark: '#666666', edge: '#2f2f2f' },
  iron: { base: '#cfcfcf', light: '#efeefe', dark: '#9a9a9a', edge: '#3f3f3f' },
  golden: { base: '#f0cc3c', light: '#ffe97a', dark: '#c09a1e', edge: '#5c4408' },
  diamond: { base: '#5ce8dc', light: '#a8fff7', dark: '#2a9a92', edge: '#155e5a' },
  leather: { base: '#9c6a3c', light: '#c08a58', dark: '#6f4424', edge: '#33200e' },
};

function clear(p: PixelPainter): void {
  clearCanvas(p);
}

function rgba(hex: string): RGBA {
  return parseColor(hex);
}

// ---------------------------------------------------------------------------
// tools and weapons
// ---------------------------------------------------------------------------

type ToolKind = 'pickaxe' | 'axe' | 'shovel' | 'sword';

function toolIcon(matKey: string, kind: ToolKind): ItemPainter {
  const palette = MATERIALS[matKey];
  return (p) => {
    clear(p);
    const handle = new IconShape();
    if (kind === 'sword') {
      handle.thickLine(9, 26, 13, 21, 3);
    } else if (kind === 'pickaxe') {
      // shorter handle: the head meets it at the middle of the arc
      handle.thickLine(10, 27, 19, 16, 3);
    } else {
      handle.thickLine(9, 28, 19, 15, 3);
    }
    const head = new IconShape();
    if (kind === 'pickaxe') {
      // flat pick head: ~110 degree arc with pointed tips, socket at the middle
      for (let i = 0; i <= 20; i++) {
        const angle = Math.PI * (1.19 + (0.62 * i) / 20);
        head.circle(20 + Math.cos(angle) * 8.6, 15 + Math.sin(angle) * 8.6, 1.7);
      }
      head.thickLine(13, 9, 11, 13, 2);
      head.thickLine(27, 9, 29, 13, 2);
      head.circle(20, 13.5, 2.2);
    } else if (kind === 'axe') {
      // broad hatchet blade with a curved cutting edge on the right
      head.polygon([
        [15, 4],
        [21, 3],
        [27, 7],
        [28, 12],
        [24, 16],
        [18, 15],
        [14, 10],
      ]);
      head.circle(18, 11, 2.5);
    } else if (kind === 'shovel') {
      // spade: wide rounded blade tapering into the handle socket
      for (let y = 4; y <= 15; y++) {
        const t = (y - 4) / 11;
        const half = Math.round(3 + Math.sin(t * Math.PI * 0.85) * 2.2 - t * 1.6);
        head.rect(20 - half, y, half * 2 + 1, 1);
      }
      head.rect(19, 15, 3, 3);
    } else {
      // sword blade + crossguard
      head.thickLine(15, 20, 25, 9, 3);
      head.thickLine(25, 9, 27, 7, 2);
      head.set(26, 7);
      head.set(27, 6);
    }
    if (kind === 'sword') {
      const guard = new IconShape();
      guard.thickLine(11, 19, 17, 24, 2);
      paintIconShape(p, head, palette.base, palette);
      paintIconShape(p, guard, palette.base, palette);
      rimLight(p, head, 'left', palette.light);
      paintIconShape(p, handle, WOODEN_HANDLE.base, WOODEN_HANDLE);
      p.set(9, 26, WOODEN_HANDLE.dark);
    } else {
      paintIconShape(p, handle, WOODEN_HANDLE.base, WOODEN_HANDLE);
      paintIconShape(p, head, palette.base, palette);
      if (kind === 'axe') rimLight(p, head, 'right', palette.light);
      if (kind === 'pickaxe') {
        rimLight(p, head, 'top', palette.light);
        // dark socket pixel where the handle enters the head
        p.set(20, 14, palette.dark);
      }
      if (kind === 'shovel') {
        p.set(20, 6, palette.light);
        p.set(19, 7, palette.light);
      }
    }
  };
}

// ---------------------------------------------------------------------------
// armour
// ---------------------------------------------------------------------------

type ArmorKind = 'helmet' | 'chestplate' | 'leggings' | 'boots';

function armorIcon(matKey: string, kind: ArmorKind): ItemPainter {
  const palette = MATERIALS[matKey];
  return (p) => {
    clear(p);
    const shape = new IconShape();
    if (kind === 'helmet') {
      // dome + brim, cheek guards and a dark face opening
      shape.ellipse(16, 12, 8, 8);
      shape.rect(7, 17, 18, 4);
      shape.rect(6, 14, 3, 7);
      shape.rect(23, 14, 3, 7);
      shape.eraseRect(11, 20, 10, 3);
      paintIconShape(p, shape, palette.base, palette);
      p.rect(10, 16, 12, 2, palette.dark);
      p.rect(11, 15, 10, 1, palette.light);
      p.rect(6, 21, 3, 1, palette.dark);
      p.rect(23, 21, 3, 1, palette.dark);
    } else if (kind === 'chestplate') {
      shape.rect(6, 7, 20, 5);
      shape.rect(7, 12, 18, 5);
      shape.rect(9, 17, 14, 6);
      // neck opening
      shape.eraseRect(13, 7, 6, 4);
      paintIconShape(p, shape, palette.base, palette);
      p.rect(13, 7, 6, 3, palette.dark);
      p.rect(14, 7, 4, 1, palette.light);
      // central seam
      for (let y = 13; y < 22; y += 2) p.set(16, y, palette.dark);
    } else if (kind === 'leggings') {
      shape.rect(8, 6, 16, 5);
      shape.rect(9, 11, 5, 14);
      shape.rect(18, 11, 5, 14);
      paintIconShape(p, shape, palette.base, palette);
      p.rect(9, 11, 5, 2, palette.light);
      p.rect(18, 11, 5, 2, palette.light);
      p.rect(13, 11, 6, 3, palette.dark);
    } else {
      // pair of boots, toes pointing outwards
      const boot = (x: number, toeDirection: 1 | -1) => {
        shape.rect(x, 8, 5, 11);
        shape.rect(toeDirection === 1 ? x : x - 4, 19, 9, 4);
        shape.rect(toeDirection === 1 ? x + 7 : x - 4, 21, 2, 2);
      };
      boot(8, -1);
      boot(19, 1);
      paintIconShape(p, shape, palette.base, palette);
      p.rect(4, 20, 9, 1, palette.light);
      p.rect(19, 20, 9, 1, palette.light);
      p.rect(8, 9, 5, 1, palette.light);
      p.rect(19, 9, 5, 1, palette.light);
    }
  };
}

// ---------------------------------------------------------------------------
// simple material / food icons
// ---------------------------------------------------------------------------

function lumpIcon(
  seed: number,
  base: string,
  light: string,
  dark: string,
  edge: string,
  fleckColors: readonly string[] = [],
): ItemPainter {
  const palette: Palette = { base, light, dark, edge };
  return (p) => {
    clear(p);
    const shape = new IconShape();
    const rng = mulberry32(seed);
    const cx = 15 + Math.floor(rng() * 3);
    const cy = 15 + Math.floor(rng() * 3);
    const parts = 3 + Math.floor(rng() * 2);
    for (let i = 0; i < parts; i++) {
      const ox = cx + Math.floor(rng() * 9) - 4;
      const oy = cy + Math.floor(rng() * 9) - 4;
      shape.circle(ox, oy, 3 + Math.floor(rng() * 3));
    }
    paintIconShape(p, shape, base, palette);
    shapeFlecks(p, shape, seed ^ 0x51, [light, dark], 10);
    if (fleckColors.length > 0) shapeFlecks(p, shape, seed ^ 0x52, fleckColors, 6);
  };
}

function ingotIcon(base: string, light: string, dark: string, edge: string): ItemPainter {
  const palette: Palette = { base, light, dark, edge };
  return (p) => {
    clear(p);
    const top = new IconShape();
    top.polygon([
      [7, 13],
      [15, 9],
      [29, 13],
      [21, 17],
    ]);
    const front = new IconShape();
    front.polygon([
      [7, 13],
      [21, 17],
      [21, 24],
      [7, 20],
    ]);
    const side = new IconShape();
    side.polygon([
      [21, 17],
      [29, 13],
      [27, 20],
      [21, 24],
    ]);
    paintIconShape(p, front, base, palette, false);
    paintIconShape(p, side, dark, palette, false);
    paintIconShape(p, top, light, palette, false);
    // crisp outline around the whole ingot
    const all = new IconShape();
    all.polygon([
      [7, 13],
      [15, 9],
      [29, 13],
      [27, 20],
      [21, 24],
      [7, 20],
    ]);
    for (let y = 0; y < T; y++) {
      for (let x = 0; x < T; x++) {
        if (all.has(x, y)) continue;
        if (all.has(x - 1, y) || all.has(x + 1, y) || all.has(x, y - 1) || all.has(x, y + 1)) {
          p.set(x, y, edge);
        }
      }
    }
    p.set(10, 13, light);
    p.set(24, 15, mixPixel(rgba(base), rgba(light), 0.5));
  };
}

function gemIcon(base: string, light: string, dark: string, edge: string): ItemPainter {
  const palette: Palette = { base, light, dark, edge };
  return (p) => {
    clear(p);
    const shape = new IconShape();
    shape.polygon([
      [16, 4],
      [26, 13],
      [16, 28],
      [6, 13],
    ]);
    paintIconShape(p, shape, base, palette, false);
    // facets
    const topFacet = new IconShape();
    topFacet.polygon([
      [16, 4],
      [26, 13],
      [16, 15],
      [6, 13],
    ]);
    for (let y = 0; y < T; y++) {
      for (let x = 0; x < T; x++) {
        if (topFacet.has(x, y)) p.set(x, y, light);
      }
    }
    const leftFacet = new IconShape();
    leftFacet.polygon([
      [6, 13],
      [16, 15],
      [16, 28],
      [11, 20],
    ]);
    for (let y = 0; y < T; y++) {
      for (let x = 0; x < T; x++) {
        if (leftFacet.has(x, y)) p.set(x, y, mixPixel(rgba(base), rgba(dark), 0.35));
      }
    }
    p.set(10, 10, '#ffffff');
    p.set(11, 10, '#ffffff');
    p.set(19, 8, light);
  };
}

function gemClusterIcon(base: string, light: string, dark: string, edge: string): ItemPainter {
  return (p) => {
    clear(p);
    const shape = new IconShape();
    shape.polygon([
      [9, 10],
      [15, 6],
      [20, 11],
      [14, 15],
    ]);
    shape.polygon([
      [17, 15],
      [24, 12],
      [28, 18],
      [22, 23],
    ]);
    shape.polygon([
      [8, 17],
      [14, 16],
      [15, 24],
      [9, 26],
    ]);
    paintIconShape(p, shape, base, { base, light, dark, edge });
    shapeFlecks(p, shape, 0x7a11, [light], 8);
    shapeFlecks(p, shape, 0x7a12, [dark], 4);
  };
}

function dyeIcon(base: string, light: string, dark: string, edge: string): ItemPainter {
  return (p) => {
    clear(p);
    const shape = new IconShape();
    shape.polygon([
      [6, 25],
      [10, 17],
      [15, 13],
      [21, 15],
      [26, 25],
    ]);
    paintIconShape(p, shape, base, { base, light, dark, edge });
    shapeFlecks(p, shape, 0x9a01, [light, light, dark], 12);
    // little sparkle
    p.set(23, 12, light);
    p.set(24, 12, light);
    p.set(23, 11, light);
    p.set(9, 11, light);
  };
}

function meatIcon(
  base: string,
  light: string,
  dark: string,
  fat: string,
  edge: string,
  cooked: boolean,
  bone?: string,
): ItemPainter {
  return (p) => {
    clear(p);
    const palette: Palette = { base, light, dark, edge };
    const shape = new IconShape();
    shape.ellipse(16, 15, 10, 8);
    shape.ellipse(19, 18, 6, 5);
    shape.ellipse(11, 19, 5, 4);
    shape.eraseCircle(24, 10, 2);
    paintIconShape(p, shape, base, palette);
    // fatty rim
    const rim = new IconShape();
    rim.ellipse(16, 14, 9, 7);
    rim.eraseCircle(16, 15, 8);
    for (let y = 0; y < T; y++) {
      for (let x = 0; x < T; x++) if (rim.has(x, y) && shape.has(x, y)) p.set(x, y, fat);
    }
    shapeFlecks(p, shape, 0xbb01 + (cooked ? 1 : 0), [fat, light], cooked ? 6 : 9);
    shapeFlecks(p, shape, 0xbb03, [dark], 5);
    if (bone) {
      const b = new IconShape();
      b.thickLine(19, 20, 27, 26, 3);
      b.circle(27, 27, 2.4);
      paintIconShape(p, b, bone, { base: bone, light: '#ffffff', dark: '#c0c0b4', edge: '#6f6a5a' });
    }
  };
}

function appleIcon(): ItemPainter {
  return (p) => {
    clear(p);
    const body = new IconShape();
    body.circle(15, 18, 9);
    body.ellipse(16, 18, 10, 8);
    const palette: Palette = { base: '#c02f2a', light: '#e8584a', dark: '#8f1e1a', edge: '#4f0f0c' };
    paintIconShape(p, body, '#c02f2a', palette);
    // top notch
    p.rect(13, 7, 5, 2, palette.edge);
    // stem
    p.rect(16, 4, 2, 6, '#6a4a24');
    p.set(15, 5, '#5a3c1c');
    // leaf
    const leaf = new IconShape();
    leaf.polygon([
      [18, 6],
      [24, 3],
      [25, 7],
      [20, 9],
    ]);
    paintIconShape(p, leaf, '#4f8a2c', { base: '#4f8a2c', light: '#6aa83c', dark: '#3a6a20', edge: '#224a12' });
    // highlight + shine
    p.set(10, 14, '#f08a74');
    p.set(11, 13, '#f8a890');
    p.set(10, 15, '#e07060');
    p.set(9, 17, '#e07060');
    p.set(20, 25, palette.dark);
  };
}

function breadIcon(): ItemPainter {
  return (p) => {
    clear(p);
    const palette: Palette = { base: '#c08a3c', light: '#dba95c', dark: '#8f6328', edge: '#4f3410' };
    const shape = new IconShape();
    shape.ellipse(16, 17, 11, 7);
    shape.ellipse(16, 15, 10, 6);
    paintIconShape(p, shape, palette.base, palette);
    // scored slashes
    for (let i = 0; i < 3; i++) {
      const x = 9 + i * 5;
      for (let s = 0; s < 4; s++) p.set(x + s, 12 + s, palette.dark);
      for (let s = 0; s < 3; s++) p.set(x + s, 11 + s, palette.light);
    }
    // crumb shading
    p.rect(7, 20, 18, 1, palette.dark);
    shapeFlecks(p, shape, 0xcc01, [palette.light], 6);
  };
}

// ---------------------------------------------------------------------------
// registry
// ---------------------------------------------------------------------------

const ITEM_ICONS: Record<string, ItemPainter> = {};

const TOOL_MATERIAL_KEYS = ['wooden', 'stone', 'iron', 'golden', 'diamond'] as const;
const TOOL_KINDS: readonly ToolKind[] = ['pickaxe', 'axe', 'shovel', 'sword'];

for (const materialKey of TOOL_MATERIAL_KEYS) {
  for (const kind of TOOL_KINDS) {
    ITEM_ICONS[`${materialKey}_${kind}`] = toolIcon(materialKey, kind);
  }
}

const ARMOR_MATERIAL_KEYS = ['leather', 'iron', 'golden', 'diamond'] as const;
const ARMOR_KINDS: readonly ArmorKind[] = ['helmet', 'chestplate', 'leggings', 'boots'];

for (const materialKey of ARMOR_MATERIAL_KEYS) {
  for (const kind of ARMOR_KINDS) {
    ITEM_ICONS[`${materialKey}_${kind}`] = armorIcon(materialKey, kind);
  }
}

// materials
ITEM_ICONS.stick = (p) => {
  clear(p);
  const shape = new IconShape();
  shape.thickLine(10, 25, 21, 8, 3);
  paintIconShape(p, shape, WOODEN_HANDLE.base, WOODEN_HANDLE);
  p.set(20, 9, WOODEN_HANDLE.light);
  p.set(19, 10, WOODEN_HANDLE.light);
  // small side twig
  p.set(13, 19, WOODEN_HANDLE.dark);
  p.set(12, 18, WOODEN_HANDLE.dark);
};

ITEM_ICONS.coal = lumpIcon(0xd101, '#262626', '#3f3f3f', '#101010', '#050505', ['#4a4a4a']);
ITEM_ICONS.charcoal = lumpIcon(0xd102, '#3a2e24', '#544536', '#221a12', '#0d0906', ['#6a5644']);

ITEM_ICONS.raw_iron = lumpIcon(0xd103, '#a89078', '#cbb79e', '#7a6450', '#3f3226', ['#e0d0ba', '#8a7460']);
ITEM_ICONS.raw_gold = lumpIcon(0xd104, '#c8a45a', '#e8c87a', '#96743a', '#4f3c18', ['#ffe89a', '#a8843e']);
ITEM_ICONS.raw_copper = lumpIcon(0xd105, '#b47a50', '#d69a6a', '#835430', '#3f2814', ['#e8b888', '#96603a']);

ITEM_ICONS.iron_ingot = ingotIcon('#cfcfcf', '#efefef', '#9a9a9a', '#3f3f3f');
ITEM_ICONS.gold_ingot = ingotIcon('#f0cc3c', '#ffe97a', '#c09a1e', '#5c4408');
ITEM_ICONS.copper_ingot = ingotIcon('#c47a48', '#e09a6a', '#8f5228', '#42230e');

ITEM_ICONS.diamond = gemIcon('#5ce8dc', '#a8fff7', '#2a9a92', '#155e5a');
ITEM_ICONS.lapis_lazuli = gemClusterIcon('#3f5fd6', '#7a92ff', '#24388f', '#101e52');

ITEM_ICONS.redstone = (p) => {
  clear(p);
  const shape = new IconShape();
  shape.polygon([
    [6, 25],
    [9, 16],
    [15, 12],
    [22, 14],
    [26, 25],
  ]);
  paintIconShape(p, shape, '#b82a1e', { base: '#b82a1e', light: '#f04a34', dark: '#7a140c', edge: '#3f0804' });
  shapeFlecks(p, shape, 0xd201, ['#ff6a4a', '#e03a26'], 14);
  p.set(24, 8, '#ff8a6a');
  p.set(25, 8, '#ff8a6a');
  p.set(24, 7, '#ff8a6a');
  p.set(7, 9, '#e03a26');
};

ITEM_ICONS.flint = (p) => {
  clear(p);
  const shape = new IconShape();
  shape.polygon([
    [8, 21],
    [6, 13],
    [12, 7],
    [20, 8],
    [26, 15],
    [22, 23],
    [14, 25],
  ]);
  paintIconShape(p, shape, '#3a3a3a', { base: '#3a3a3a', light: '#5c5c5c', dark: '#1f1f1f', edge: '#0a0a0a' });
  p.set(11, 11, '#6f6f6f');
  p.set(12, 10, '#6f6f6f');
  p.set(18, 20, '#141414');
};

ITEM_ICONS.string = (p) => {
  clear(p);
  const thread = new IconShape();
  const loop = (cx: number, cy: number, rx: number, ry: number, phase: number) => {
    for (let i = 0; i <= 140; i++) {
      const angle = (i / 140) * Math.PI * 2 + phase;
      thread.set(cx + Math.cos(angle) * rx, cy + Math.sin(angle) * ry);
    }
  };
  loop(15, 14, 8, 6, 0.2);
  loop(18, 19, 7, 6, Math.PI + 0.4);
  loop(13, 20, 5, 4, -0.6);
  const palette: Palette = { base: '#e6e6e0', light: '#ffffff', dark: '#b8b8b0', edge: '#5c5c58' };
  paintIconShape(p, thread, palette.base, palette);
  // loose strand
  p.set(7, 24, palette.base);
  p.set(6, 25, palette.base);
  p.set(24, 9, palette.dark);
};

ITEM_ICONS.feather = (p) => {
  clear(p);
  const shaft = new IconShape();
  shaft.thickLine(10, 25, 23, 8, 1);
  const vane = new IconShape();
  for (let i = 0; i < 16; i++) {
    const t = i / 15;
    const bx = Math.round(10 + t * 13);
    const by = Math.round(25 - t * 17);
    const len = Math.round(3 + Math.sin(t * Math.PI) * 5);
    vane.thickLine(bx, by, bx - len, by - 1, 2);
    vane.thickLine(bx, by, bx + 2, by - len, 2);
  }
  paintIconShape(p, vane, '#f2f2ea', { base: '#f2f2ea', light: '#ffffff', dark: '#c8c8c0', edge: '#6f6f68' });
  paintIconShape(p, shaft, '#d8d8d0', { base: '#d8d8d0', light: '#f8f8f0', dark: '#a8a8a0', edge: '#6f6f68' });
  p.set(22, 7, '#ffffff');
};

ITEM_ICONS.gunpowder = (p) => {
  clear(p);
  const shape = new IconShape();
  shape.polygon([
    [6, 25],
    [9, 17],
    [15, 13],
    [21, 15],
    [26, 25],
  ]);
  paintIconShape(p, shape, '#565656', { base: '#565656', light: '#7d7d7d', dark: '#333333', edge: '#1a1a1a' });
  shapeFlecks(p, shape, 0xd301, ['#8f8f8f', '#3f3f3f', '#6a6a6a'], 16);
  p.set(23, 11, '#9a9a9a');
  p.set(24, 12, '#707070');
};

ITEM_ICONS.bone = (p) => {
  clear(p);
  const shape = new IconShape();
  shape.thickLine(9, 24, 23, 9, 3);
  shape.circle(8, 25, 3);
  shape.circle(24, 8, 3);
  shape.circle(6, 22, 2);
  shape.circle(26, 11, 2);
  paintIconShape(p, shape, '#e8e8dc', { base: '#e8e8dc', light: '#ffffff', dark: '#c0c0b4', edge: '#5f5f54' });
  // little notches at the knuckles
  p.set(5, 26, '#5f5f54');
  p.set(27, 6, '#5f5f54');
  p.set(12, 20, '#c8c8bc');
};

ITEM_ICONS.leather = (p) => {
  clear(p);
  const shape = new IconShape();
  shape.polygon([
    [8, 10],
    [15, 6],
    [24, 8],
    [27, 16],
    [23, 24],
    [14, 26],
    [7, 20],
  ]);
  paintIconShape(p, shape, '#9c6a3c', MATERIALS.leather);
  // stitching
  for (let i = 0; i < 9; i++) {
    const x = 9 + i * 2;
    p.set(x, 24 - Math.floor(i / 3), '#d0a070');
    p.set(x, 23 - Math.floor(i / 3), '#7a5030');
  }
  p.set(12, 11, '#b88450');
  p.set(17, 10, '#b88450');
  p.set(20, 20, '#7a5030');
};

ITEM_ICONS.clay_ball = (p) => {
  clear(p);
  const shape = new IconShape();
  shape.circle(16, 17, 8);
  shape.ellipse(15, 14, 7, 6);
  paintIconShape(p, shape, '#a8b2bc', { base: '#a8b2bc', light: '#c6ced6', dark: '#88929c', edge: '#4f5862' });
  p.set(12, 12, '#d6dee6');
  p.set(13, 12, '#d6dee6');
  p.set(11, 14, '#bcc6ce');
};

ITEM_ICONS.brick = (p) => {
  clear(p);
  const shape = new IconShape();
  shape.rect(7, 11, 18, 11);
  paintIconShape(p, shape, '#a54c3c', { base: '#a54c3c', light: '#c46650', dark: '#7f3428', edge: '#3f1812' });
  p.rect(7, 12, 18, 1, '#c46650');
  p.rect(7, 20, 18, 1, '#7f3428');
  p.set(10, 15, '#8f3c2e');
  p.set(20, 16, '#8f3c2e');
  p.set(15, 14, '#b85a44');
};

ITEM_ICONS.paper = (p) => {
  clear(p);
  const shape = new IconShape();
  shape.polygon([
    [10, 8],
    [24, 6],
    [27, 23],
    [13, 26],
  ]);
  paintIconShape(p, shape, '#e8e8e0', { base: '#e8e8e0', light: '#fbfbf5', dark: '#c4c4bc', edge: '#6f6f68' });
  // fold
  const fold = new IconShape();
  fold.polygon([
    [25, 8],
    [27, 8],
    [27, 10],
  ]);
  for (let y = 0; y < T; y++) for (let x = 0; x < T; x++) if (fold.has(x, y)) p.set(x, y, '#c4c4bc');
  // text lines
  for (let i = 0; i < 4; i++) {
    const x = 13 + i;
    p.rect(x, 13 + i * 3, 9 - i, 1, '#b8b8b0');
  }
};

ITEM_ICONS.red_dye = dyeIcon('#c8302a', '#f05a48', '#8f1610', '#3f0804');
ITEM_ICONS.yellow_dye = dyeIcon('#e0c040', '#ffe86a', '#b8981e', '#4f3c08');
ITEM_ICONS.blue_dye = dyeIcon('#3a54c8', '#6a84f0', '#22378f', '#0e1a4f');
ITEM_ICONS.black_dye = dyeIcon('#2a2a2a', '#4a4a4a', '#121212', '#000000');

// food
ITEM_ICONS.apple = appleIcon();
ITEM_ICONS.bread = breadIcon();
ITEM_ICONS.raw_porkchop = meatIcon('#e09090', '#f2b4ac', '#b86868', '#f0e0d8', '#6f3232', false);
ITEM_ICONS.cooked_porkchop = meatIcon('#c07840', '#e0a060', '#8f5228', '#e8c8a0', '#4f2a10', true);
ITEM_ICONS.raw_beef = meatIcon('#c04a40', '#d86858', '#8f322a', '#f0d8d0', '#5f1f18', false);
ITEM_ICONS.steak = meatIcon('#8f5a30', '#b07840', '#5f3a1c', '#d8b890', '#2f1a0c', true);
ITEM_ICONS.raw_chicken = meatIcon('#e8b0a0', '#f8ccc0', '#c08070', '#f8ece8', '#7a4a3f', false, '#e8e8dc');
ITEM_ICONS.cooked_chicken = meatIcon('#c8944a', '#e0b060', '#8f6428', '#e8d0a0', '#4f3410', true, '#e8e8dc');
ITEM_ICONS.raw_mutton = meatIcon('#d07068', '#e89a90', '#a84840', '#f0e0d8', '#6f2820', false);
ITEM_ICONS.cooked_mutton = meatIcon('#a06038', '#c08050', '#6f3f22', '#d8b890', '#3f2010', true);
ITEM_ICONS.rotten_flesh = (p) => {
  clear(p);
  const shape = new IconShape();
  shape.polygon([
    [6, 16],
    [10, 9],
    [18, 7],
    [25, 10],
    [27, 19],
    [22, 25],
    [13, 26],
    [7, 23],
  ]);
  shape.eraseRect(9, 12, 3, 2);
  shape.eraseRect(21, 18, 2, 3);
  paintIconShape(p, shape, '#7a8a4a', { base: '#7a8a4a', light: '#96a65a', dark: '#525f2a', edge: '#26300f' });
  shapeFlecks(p, shape, 0xe101, ['#5c6a32', '#a4b268'], 12);
  p.set(16, 14, '#a4b268');
  p.set(17, 15, '#5c6a32');
  p.set(20, 21, '#3f4a20');
};

ITEM_ICONS.bow = (p) => {
  clear(p);
  // curved wooden limb
  const limb = new IconShape();
  for (let i = 0; i <= 40; i++) {
    const t = i / 40;
    const angle = Math.PI * (0.58 + 0.84 * t);
    limb.circle(22 + Math.cos(angle) * 13, 16 + Math.sin(angle) * 11, 1.7);
  }
  limb.circle(22, 5, 1.6);
  limb.circle(22, 27, 1.6);
  paintIconShape(p, limb, '#8a5f32', WOODEN_HANDLE);
  // string
  p.rect(22, 5, 1, 23, '#e8e8e0');
  p.set(22, 4, '#f8f8f0');
  p.set(22, 28, '#f8f8f0');
  // grip
  p.rect(9, 14, 3, 5, '#5f3f1e');
  p.rect(9, 14, 1, 5, '#7a5530');
  // nocked arrow hint
  p.set(22, 15, '#c8c8c0');
  p.set(21, 15, '#8a8a8a');
};

ITEM_ICONS.arrow = (p) => {
  clear(p);
  // shaft
  const shaft = new IconShape();
  shaft.thickLine(9, 25, 23, 10, 1);
  paintIconShape(p, shaft, '#8a5f32', WOODEN_HANDLE);
  // head
  const head = new IconShape();
  head.polygon([
    [21, 12],
    [27, 4],
    [28, 7],
    [26, 12],
    [23, 15],
  ]);
  paintIconShape(p, head, '#c8c8c8', { base: '#c8c8c8', light: '#f0f0f0', dark: '#8a8a8a', edge: '#3f3f3f' });
  // fletching
  const feathers = new IconShape();
  feathers.polygon([
    [6, 23],
    [9, 17],
    [12, 18],
    [10, 23],
  ]);
  feathers.polygon([
    [8, 26],
    [12, 20],
    [15, 21],
    [12, 27],
  ]);
  paintIconShape(p, feathers, '#d84a3c', { base: '#d84a3c', light: '#f07060', dark: '#9c2a20', edge: '#3f0f08' });
  p.set(10, 20, '#f0f0e8');
  p.set(13, 23, '#f0f0e8');
};

ITEM_ICONS.flint_and_steel = (p) => {
  clear(p);
  // steel striker: L-shaped bar
  const steel = new IconShape();
  steel.rect(18, 6, 6, 13);
  steel.rect(10, 17, 14, 5);
  paintIconShape(p, steel, '#b8b8b8', { base: '#b8b8b8', light: '#e6e6e6', dark: '#7a7a7a', edge: '#3a3a3a' });
  p.rect(19, 7, 4, 1, '#e6e6e6');
  p.rect(11, 18, 12, 1, '#e6e6e6');
  // flint chunk
  const flint = new IconShape();
  flint.polygon([
    [5, 23],
    [6, 15],
    [13, 12],
    [18, 18],
    [15, 25],
    [9, 27],
  ]);
  paintIconShape(p, flint, '#4a4a4a', { base: '#4a4a4a', light: '#6f6f6f', dark: '#262626', edge: '#0f0f0f' });
  p.set(10, 17, '#7a7a7a');
  // sparks
  p.set(25, 12, '#ffd34d');
  p.set(26, 13, '#ffe87a');
  p.set(27, 11, '#ffb733');
  p.set(24, 15, '#ff9a1f');
};

export { ITEM_ICONS };

export const ITEM_ICON_NAMES: readonly string[] = Object.freeze(Object.keys(ITEM_ICONS));

/** Paints an item sprite into an existing painter (clears it first). */
export function paintItemIcon(id: string, painter: PixelPainter): boolean {
  const icon = ITEM_ICONS[id];
  painter.fill('rgba(0,0,0,0)');
  if (!icon) return false;
  icon(painter);
  return true;
}

/** Renders one item sprite into a fresh 32x32 buffer (for canvas/dataURL use). */
export function createItemIcon(id: string): PixelBuffer | null {
  const icon = ITEM_ICONS[id];
  if (!icon) return null;
  const painter = new PixelPainter(T, T);
  painter.fill('rgba(0,0,0,0)');
  icon(painter);
  return painter.buffer;
}
