import { IconShape, clearCanvas, paintIconShape, type IconPalette } from './iconKit';
import {
  PixelPainter,
  createPixelBuffer,
  parseColor,
  type PixelBuffer,
  type RGBA,
} from './pixels';
import { rgb, tone } from './pixelKit';
import { TILE_SIZE as T, type ItemPainter } from './types';

/**
 * Procedural HUD / inventory pixel sprites for the MineVerse UI.
 *
 * Everything is a pure `ItemPainter` on a 32x32 RGBA buffer with a transparent
 * background, so the UI can render each one into a canvas and use it as a
 * dataURL (see `createUiIcon`). Icons are authored at 32x32 and meant to be
 * displayed with nearest-neighbour scaling at whatever CSS size the HUD needs.
 *
 * Keys used by UI-C:
 *   heart_full / heart_half / heart_empty
 *   hunger_full / hunger_half / hunger_empty
 *   armor_full / armor_half / armor_empty
 *   bubble_full / bubble_empty
 *   slot / slot_selected / button / button_hover / button_pressed / button_disabled
 *   panel / crosshair / flame / arrow / logo / xp_bar / xp_bar_empty
 *   hotbar / hotbar_selected (hotbar frame tiles)
 *
 * Extra factory exports: `createLogo()` (wide wordmark), `createDamageVignette`,
 * `createUnderwaterOverlay`, `drawPixelText`.
 */

// ---------------------------------------------------------------------------
// shared painters
// ---------------------------------------------------------------------------

const HEART_RED: IconPalette = {
  base: '#c02a2a',
  light: '#e85a4a',
  dark: '#8f1414',
  edge: '#3a0a0a',
};
const CONTAINER: IconPalette = {
  base: '#3a3a3a',
  light: '#4c4c4c',
  dark: '#242424',
  edge: '#0f0f0f',
};
const MEAT: IconPalette = {
  base: '#b87430',
  light: '#d99a4e',
  dark: '#7f4a1c',
  edge: '#3a1f08',
};
const BONE: IconPalette = {
  base: '#e8e8dc',
  light: '#ffffff',
  dark: '#c0c0b4',
  edge: '#4f4f44',
};
const STEEL: IconPalette = {
  base: '#d0d0d0',
  light: '#f2f2f2',
  dark: '#9a9a9a',
  edge: '#2f2f2f',
};
const BUBBLE: IconPalette = {
  base: '#6ab8e8',
  light: '#b0e4fa',
  dark: '#3a7aa8',
  edge: '#143a52',
};

function heartShape(): IconShape {
  const shape = new IconShape();
  shape.circle(11.5, 12, 6.4);
  shape.circle(20.5, 12, 6.4);
  shape.polygon([
    [5.6, 13],
    [26.4, 13],
    [16, 28],
  ]);
  return shape;
}

function splitMask(shape: IconShape, keepLeft: boolean): IconShape {
  const half = shape.clone();
  for (let y = 0; y < T; y++) {
    for (let x = 0; x < T; x++) {
      const keep = keepLeft ? x < 16 : x >= 16;
      if (!keep) half.mask[y * T + x] = 0;
    }
  }
  return half;
}

function paintHeart(p: PixelPainter, mode: 'full' | 'half' | 'empty'): void {
  clearCanvas(p);
  const shape = heartShape();
  if (mode === 'empty') {
    paintIconShape(p, shape, CONTAINER.base, CONTAINER);
    return;
  }
  paintIconShape(p, shape, HEART_RED.base, HEART_RED);
  // gloss
  p.rect(9, 9, 3, 2, '#ff8a7a');
  p.set(8, 11, '#f07060');
  p.set(12, 7, '#ffd0c0');
  p.set(21, 22, '#7f1010');
  if (mode === 'half') {
    const right = splitMask(shape, false);
    paintIconShape(p, right, CONTAINER.base, CONTAINER);
  }
}

function hungerShape(): IconShape {
  const shape = new IconShape();
  shape.ellipse(15, 12, 8.5, 7);
  shape.ellipse(20, 9.5, 5, 4.5);
  return shape;
}

function paintHunger(p: PixelPainter, mode: 'full' | 'half' | 'empty'): void {
  clearCanvas(p);
  const leg = new IconShape();
  leg.thickLine(19, 17, 24, 24, 3);
  leg.circle(25.5, 25, 2.4);
  const meat = hungerShape();
  if (mode === 'empty') {
    paintIconShape(p, leg, CONTAINER.base, CONTAINER);
    paintIconShape(p, meat, CONTAINER.base, CONTAINER);
    return;
  }
  paintIconShape(p, leg, BONE.base, BONE);
  paintIconShape(p, meat, MEAT.base, MEAT);
  p.rect(11, 8, 3, 2, '#f0bd70');
  p.set(10, 11, '#c98a44');
  p.set(18, 16, '#6f3f14');
  if (mode === 'half') {
    const right = splitMask(meat, false);
    paintIconShape(p, right, CONTAINER.base, CONTAINER);
  }
}

function armorShape(): IconShape {
  const shape = new IconShape();
  shape.rect(5, 8, 22, 6);
  shape.rect(7, 14, 18, 7);
  shape.rect(10, 21, 12, 5);
  shape.eraseRect(13, 8, 6, 4);
  return shape;
}

function paintArmor(p: PixelPainter, mode: 'full' | 'half' | 'empty'): void {
  clearCanvas(p);
  const shape = armorShape();
  if (mode === 'empty') {
    paintIconShape(p, shape, CONTAINER.base, CONTAINER);
    return;
  }
  paintIconShape(p, shape, STEEL.base, STEEL);
  p.rect(7, 9, 18, 1, '#ffffff');
  p.rect(11, 15, 10, 1, '#e6e6e6');
  p.set(9, 12, '#8a8a8a');
  p.set(22, 12, '#8a8a8a');
  p.set(15, 14, '#7a7a7a');
  if (mode === 'half') {
    const right = splitMask(shape, false);
    paintIconShape(p, right, CONTAINER.base, CONTAINER);
  }
}

function bubbleShape(): IconShape {
  const shape = new IconShape();
  shape.circle(16, 16, 7.5);
  return shape;
}

const UI_ICONS: Record<string, ItemPainter> = {};

function define(name: string, painter: ItemPainter): void {
  UI_ICONS[name] = painter;
}

// hearts -------------------------------------------------------------------
define('heart_full', (p) => paintHeart(p, 'full'));
define('heart_half', (p) => paintHeart(p, 'half'));
define('heart_empty', (p) => paintHeart(p, 'empty'));

// hunger -------------------------------------------------------------------
define('hunger_full', (p) => paintHunger(p, 'full'));
define('hunger_half', (p) => paintHunger(p, 'half'));
define('hunger_empty', (p) => paintHunger(p, 'empty'));

// armour -------------------------------------------------------------------
define('armor_full', (p) => paintArmor(p, 'full'));
define('armor_half', (p) => paintArmor(p, 'half'));
define('armor_empty', (p) => paintArmor(p, 'empty'));

// oxygen bubbles -----------------------------------------------------------
define('bubble_full', (p) => {
  clearCanvas(p);
  const shape = bubbleShape();
  paintIconShape(p, shape, BUBBLE.base, BUBBLE);
  p.rect(11, 11, 3, 2, BUBBLE.light);
  p.set(10, 13, BUBBLE.light);
  p.set(12, 10, '#ffffff');
});
define('bubble_empty', (p) => {
  clearCanvas(p);
  const shape = bubbleShape();
  paintIconShape(p, shape, '#2a3a44', { base: '#2a3a44', light: '#3a4c58', dark: '#17242c', edge: '#0a1116' });
});

// slots / buttons ----------------------------------------------------------
define('slot', (p) => {
  p.fill('#8b8b8b');
  // 2 px black frame, inset shadow top-left, light bottom-right
  p.rect(0, 0, T, 2, '#373737');
  p.rect(0, T - 2, T, 2, '#373737');
  p.rect(0, 0, 2, T, '#373737');
  p.rect(T - 2, 0, 2, T, '#373737');
  p.rect(2, 2, T - 4, 2, '#6f6f6f');
  p.rect(2, 2, 2, T - 4, '#6f6f6f');
  p.rect(2, T - 4, T - 4, 2, '#c6c6c6');
  p.rect(T - 4, 2, 2, T - 4, '#c6c6c6');
  p.rect(4, 4, T - 8, T - 8, '#8b8b8b');
  p.rect(4, 4, T - 8, 1, '#7a7a7a');
});

define('slot_selected', (p) => {
  UI_ICONS.slot(p);
  // gold highlight frame over the default slot
  p.rect(0, 0, T, 2, '#f0c040');
  p.rect(0, 0, 2, T, '#f0c040');
  p.rect(0, T - 2, T, 2, '#b8860b');
  p.rect(T - 2, 0, 2, T, '#b8860b');
  p.rect(2, 2, T - 4, 1, '#ffe89a');
});

type ButtonMode = 'normal' | 'hover' | 'pressed' | 'disabled';

function paintButton(p: PixelPainter, mode: ButtonMode): void {
  const colors: Record<ButtonMode, { base: string; light: string; dark: string; edge: string }> = {
    normal: { base: '#6f6f6f', light: '#a0a0a0', dark: '#3f3f3f', edge: '#1a1a1a' },
    hover: { base: '#7d8fa8', light: '#b0c2d8', dark: '#4a5a6f', edge: '#1f2a36' },
    pressed: { base: '#5a5a5a', light: '#3f3f3f', dark: '#8a8a8a', edge: '#141414' },
    disabled: { base: '#4a4a4a', light: '#5f5f5f', dark: '#333333', edge: '#1a1a1a' },
  };
  const c = colors[mode];
  p.fill(c.base);
  p.rect(0, 0, T, 2, c.light);
  p.rect(0, 0, 2, T, c.light);
  p.rect(0, T - 2, T, 2, c.dark);
  p.rect(T - 2, 0, 2, T, c.dark);
  p.rect(0, 0, T, 1, c.edge);
  p.rect(0, T - 1, T, 1, c.edge);
  p.rect(0, 0, 1, T, c.edge);
  p.rect(T - 1, 0, 1, T, c.edge);
  // subtle inner plate so stretched buttons keep some pixel texture
  p.rect(3, 3, T - 6, T - 6, c.base);
  p.rect(3, 3, T - 6, 1, c.light);
  p.rect(3, T - 4, T - 6, 1, c.dark);
}

define('button', (p) => paintButton(p, 'normal'));
define('button_hover', (p) => paintButton(p, 'hover'));
define('button_pressed', (p) => paintButton(p, 'pressed'));
define('button_disabled', (p) => paintButton(p, 'disabled'));

define('panel', (p) => {
  p.fill('#2a2a2e');
  tone(p, 0x7a01, '#333338', '#202024', { cell: 6, strength: 0.2, levels: 3 });
  p.rect(0, 0, T, 1, '#3a3a40');
  p.rect(0, T - 1, T, 1, '#17171b');
  p.rect(0, 0, 1, T, '#34343a');
  p.rect(T - 1, 0, 1, T, '#17171b');
});

// crosshair ----------------------------------------------------------------
define('crosshair', (p) => {
  clearCanvas(p);
  // 1 px dark halo keeps the reticle readable on snow and on the night sky
  const halo = rgb(10, 10, 10, 190);
  p.rect(12, 14, 9, 4, halo);
  p.rect(14, 12, 4, 9, halo);
  p.rect(13, 15, 6, 2, '#ffffff');
  p.rect(15, 13, 2, 6, '#ffffff');
});

// furnace flame ------------------------------------------------------------
define('flame', (p) => {
  clearCanvas(p);
  for (let y = 4; y <= 29; y++) {
    const t = (y - 4) / 25;
    const half = Math.round(1 + 6.5 * Math.sin(t * Math.PI * 0.92) * (0.45 + 0.55 * t));
    for (let dx = -half; dx <= half; dx++) p.set(16 + dx, y, '#ff8a1e');
    if (half > 1) {
      for (let dx = -half + 1; dx <= half - 1; dx++) p.set(16 + dx, y, '#ffc44a');
    }
    if (half > 2 && t > 0.25 && t < 0.8) {
      for (let dx = -2; dx <= 2; dx++) p.set(16 + dx, y, '#fff2b0');
    }
  }
  // embers
  p.set(10, 8, '#ffb347');
  p.set(23, 7, '#ffb347');
  p.set(8, 14, '#e0701a');
  p.set(24, 16, '#e0701a');
});

// crafting arrow -----------------------------------------------------------
define('arrow', (p) => {
  clearCanvas(p);
  const shape = new IconShape();
  shape.rect(4, 14, 16, 4);
  shape.polygon([
    [19, 8],
    [28, 16],
    [19, 24],
  ]);
  paintIconShape(p, shape, '#cfcfcf', { base: '#cfcfcf', light: '#f0f0f0', dark: '#8f8f8f', edge: '#2f2f2f' });
  p.rect(5, 15, 13, 1, '#f0f0f0');
  p.rect(5, 17, 13, 1, '#8f8f8f');
});

// xp bar segments ----------------------------------------------------------
define('xp_bar', (p) => {
  p.fill('#2f8a16');
  p.rect(0, 0, T, 6, '#5cd62a');
  p.rect(0, 0, T, 2, '#8af05a');
  p.rect(0, T - 6, T, 6, '#1f6a0e');
  p.rect(0, 8, T, 2, '#78e84a');
  p.rect(0, 22, T, 2, '#3aa01a');
  p.rect(0, 14, T, 1, '#a8ff7a');
});
define('xp_bar_empty', (p) => {
  p.fill('#1e2a12');
  p.rect(0, 2, T, 2, '#2c3a1a');
  p.rect(0, T - 2, T, 2, '#141c0c');
});

// hotbar frame tiles -------------------------------------------------------
define('hotbar', (p) => {
  p.fill(rgb(20, 20, 20, 140));
  p.rect(0, 0, T, 2, rgb(40, 40, 40, 204));
  p.rect(0, T - 2, T, 2, rgb(8, 8, 8, 204));
  p.rect(0, 0, 2, T, rgb(40, 40, 40, 204));
  p.rect(T - 2, 0, 2, T, rgb(8, 8, 8, 204));
});
define('hotbar_selected', (p) => {
  UI_ICONS.hotbar(p);
  p.rect(0, 0, T, 2, '#f0f0e0');
  p.rect(0, 0, 2, T, '#f0f0e0');
  p.rect(0, T - 2, T, 2, '#b8b8a8');
  p.rect(T - 2, 0, 2, T, '#b8b8a8');
  p.rect(2, 2, T - 4, 1, rgb(255, 255, 255, 153));
});

// logo emblem: isometric grass block --------------------------------------
define('logo', (p) => {
  clearCanvas(p);
  const top = new IconShape();
  top.polygon([
    [16, 2],
    [30, 10],
    [16, 18],
    [2, 10],
  ]);
  const left = new IconShape();
  left.polygon([
    [2, 10],
    [16, 18],
    [16, 30],
    [2, 22],
  ]);
  const right = new IconShape();
  right.polygon([
    [16, 18],
    [30, 10],
    [30, 22],
    [16, 30],
  ]);
  // grass top
  paintIconShape(p, top, '#6fae3a', { base: '#6fae3a', light: '#8ccb52', dark: '#4f8a28', edge: '#1f3a10' }, false);
  // dirt faces with a grass lip
  paintIconShape(p, left, '#8a6238', { base: '#8a6238', light: '#a37c4c', dark: '#6f4f2c', edge: '#1f3a10' }, false);
  paintIconShape(p, right, '#6f4f2c', { base: '#6f4f2c', light: '#8a6238', dark: '#573c20', edge: '#1f3a10' }, false);
  // grass lip on both sides
  for (let x = 2; x <= 16; x++) {
    const y = 10 + Math.round((x - 2) * 0.5);
    if (x < 16) {
      p.set(x, y, '#6fae3a');
      p.set(x, y + 1, '#5f9832');
    }
  }
  for (let x = 16; x <= 30; x++) {
    const y = 18 - Math.round((x - 16) * 0.5);
    p.set(x, y, '#5f9832');
    p.set(x, y + 1, '#4f8a28');
  }
  // block highlights
  p.set(16, 3, '#a8e070');
  p.set(8, 7, '#9ad860');
  p.set(22, 7, '#8ccb52');
  p.set(16, 19, '#7a5530');
  p.rect(4, 15, 2, 4, '#7a5530');
  p.rect(24, 15, 2, 4, '#5f4526');
  p.set(9, 20, '#9a7244');
  p.set(22, 20, '#7a5530');
});

// ---------------------------------------------------------------------------
// pixel font + wide logo
// ---------------------------------------------------------------------------

const FONT: Readonly<Record<string, readonly number[]>> = {
  A: [0b01110, 0b10001, 0b10001, 0b11111, 0b10001, 0b10001, 0b10001],
  B: [0b11110, 0b10001, 0b10001, 0b11110, 0b10001, 0b10001, 0b11110],
  C: [0b01110, 0b10001, 0b10000, 0b10000, 0b10000, 0b10001, 0b01110],
  D: [0b11110, 0b10001, 0b10001, 0b10001, 0b10001, 0b10001, 0b11110],
  E: [0b11111, 0b10000, 0b10000, 0b11110, 0b10000, 0b10000, 0b11111],
  F: [0b11111, 0b10000, 0b10000, 0b11110, 0b10000, 0b10000, 0b10000],
  G: [0b01110, 0b10001, 0b10000, 0b10111, 0b10001, 0b10001, 0b01111],
  H: [0b10001, 0b10001, 0b10001, 0b11111, 0b10001, 0b10001, 0b10001],
  I: [0b01110, 0b00100, 0b00100, 0b00100, 0b00100, 0b00100, 0b01110],
  J: [0b00111, 0b00010, 0b00010, 0b00010, 0b00010, 0b10010, 0b01100],
  K: [0b10001, 0b10010, 0b10100, 0b11000, 0b10100, 0b10010, 0b10001],
  L: [0b10000, 0b10000, 0b10000, 0b10000, 0b10000, 0b10000, 0b11111],
  M: [0b10001, 0b11011, 0b10101, 0b10101, 0b10001, 0b10001, 0b10001],
  N: [0b10001, 0b11001, 0b10101, 0b10011, 0b10001, 0b10001, 0b10001],
  O: [0b01110, 0b10001, 0b10001, 0b10001, 0b10001, 0b10001, 0b01110],
  P: [0b11110, 0b10001, 0b10001, 0b11110, 0b10000, 0b10000, 0b10000],
  Q: [0b01110, 0b10001, 0b10001, 0b10001, 0b10101, 0b10010, 0b01101],
  R: [0b11110, 0b10001, 0b10001, 0b11110, 0b10100, 0b10010, 0b10001],
  S: [0b01111, 0b10000, 0b10000, 0b01110, 0b00001, 0b00001, 0b11110],
  T: [0b11111, 0b00100, 0b00100, 0b00100, 0b00100, 0b00100, 0b00100],
  U: [0b10001, 0b10001, 0b10001, 0b10001, 0b10001, 0b10001, 0b01110],
  V: [0b10001, 0b10001, 0b10001, 0b10001, 0b10001, 0b01010, 0b00100],
  W: [0b10001, 0b10001, 0b10001, 0b10101, 0b10101, 0b10101, 0b01010],
  X: [0b10001, 0b10001, 0b01010, 0b00100, 0b01010, 0b10001, 0b10001],
  Y: [0b10001, 0b10001, 0b01010, 0b00100, 0b00100, 0b00100, 0b00100],
  Z: [0b11111, 0b00001, 0b00010, 0b00100, 0b01000, 0b10000, 0b11111],
  '0': [0b01110, 0b10001, 0b10011, 0b10101, 0b11001, 0b10001, 0b01110],
  '1': [0b00100, 0b01100, 0b00100, 0b00100, 0b00100, 0b00100, 0b01110],
  '2': [0b01110, 0b10001, 0b00001, 0b00010, 0b00100, 0b01000, 0b11111],
  '3': [0b11111, 0b00010, 0b00100, 0b00010, 0b00001, 0b10001, 0b01110],
  '4': [0b00010, 0b00110, 0b01010, 0b10010, 0b11111, 0b00010, 0b00010],
  '5': [0b11111, 0b10000, 0b11110, 0b00001, 0b00001, 0b10001, 0b01110],
  '6': [0b00110, 0b01000, 0b10000, 0b11110, 0b10001, 0b10001, 0b01110],
  '7': [0b11111, 0b00001, 0b00010, 0b00100, 0b01000, 0b01000, 0b01000],
  '8': [0b01110, 0b10001, 0b10001, 0b01110, 0b10001, 0b10001, 0b01110],
  '9': [0b01110, 0b10001, 0b10001, 0b01111, 0b00001, 0b00010, 0b01100],
  ' ': [0, 0, 0, 0, 0, 0, 0],
  '.': [0, 0, 0, 0, 0, 0b01100, 0b01100],
  ':': [0, 0b01100, 0b01100, 0, 0b01100, 0b01100, 0],
  '-': [0, 0, 0, 0b11111, 0, 0, 0],
  '!': [0b00100, 0b00100, 0b00100, 0b00100, 0b00100, 0, 0b00100],
  '?': [0b01110, 0b10001, 0b00001, 0b00010, 0b00100, 0, 0b00100],
  '/': [0b00001, 0b00010, 0b00010, 0b00100, 0b01000, 0b01000, 0b10000],
};

/** Width in pixels of `text` for the built-in 5x7 font. */
export function measurePixelText(text: string, scale = 1): number {
  if (text.length === 0) return 0;
  return text.length * 6 * scale - scale;
}

export function drawPixelText(
  painter: PixelPainter,
  text: string,
  x: number,
  y: number,
  scale: number,
  color: string | RGBA,
): void {
  const glyphAdvance = 6 * scale;
  for (let i = 0; i < text.length; i++) {
    const glyph = FONT[text[i].toUpperCase()] ?? FONT['?'] ?? FONT[' '];
    for (let row = 0; row < glyph.length; row++) {
      const bits = glyph[row];
      for (let bit = 0; bit < 5; bit++) {
        if ((bits & (1 << (4 - bit))) === 0) continue;
        for (let sy = 0; sy < scale; sy++) {
          for (let sx = 0; sx < scale; sx++) {
            painter.set(x + i * glyphAdvance + bit * scale + sx, y + row * scale + sy, color);
          }
        }
      }
    }
  }
}

/** Wide original wordmark for the title screen (green pixel font + outline). */
export function createLogo(text = 'MINEVERSE', scale = 4): PixelBuffer {
  const padding = 4 * scale;
  const textWidth = measurePixelText(text, scale);
  const textHeight = 7 * scale;
  const width = textWidth + padding * 2;
  const height = textHeight + padding * 2;
  const painter = new PixelPainter(width, height);
  painter.fill('rgba(0,0,0,0)');
  const shadow = parseColor('#14260b');
  const main = parseColor('#8fd44a');
  const highlight = parseColor('#c6f07a');
  const originX = padding;
  const originY = padding;
  // 1 px black-green outline (draw the glyph offsets around the main text)
  const offsets: ReadonlyArray<readonly [number, number]> = [
    [-1, 0],
    [1, 0],
    [0, -1],
    [0, 1],
    [-1, -1],
    [1, 1],
    [-1, 1],
    [1, -1],
  ];
  for (const [ox, oy] of offsets) {
    drawPixelText(painter, text, originX + ox, originY + oy, scale, shadow);
  }
  // offset drop shadow
  drawPixelText(painter, text, originX + Math.max(1, Math.round(scale / 2)), originY + scale, scale, shadow);
  drawPixelText(painter, text, originX, originY, scale, main);
  // top highlight on each glyph row 0
  for (let i = 0; i < text.length; i++) {
    const glyph = FONT[text[i].toUpperCase()] ?? FONT['?'];
    const bits = glyph[0];
    for (let bit = 0; bit < 5; bit++) {
      if ((bits & (1 << (4 - bit))) === 0) continue;
      const x = originX + i * 6 * scale + bit * scale;
      for (let sx = 0; sx < scale; sx++) painter.set(x + sx, originY, highlight);
    }
  }
  return painter.buffer;
}

// ---------------------------------------------------------------------------
// full-screen overlays
// ---------------------------------------------------------------------------

/** Red damage vignette: transparent centre, angry red edges. */
export function createDamageVignette(width: number, height: number): PixelBuffer {
  const buffer = createPixelBuffer(width, height);
  const data = buffer.data;
  const halfW = width / 2;
  const halfH = height / 2;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const nx = (x - halfW) / halfW;
      const ny = (y - halfH) / halfH;
      const radius = Math.min(1, Math.sqrt(nx * nx + ny * ny) / Math.SQRT2);
      const t = Math.max(0, (radius - 0.42) / 0.58);
      const alpha = Math.round(Math.pow(t, 1.7) * 175);
      const i = (y * width + x) * 4;
      data[i] = 185;
      data[i + 1] = 12;
      data[i + 2] = 10;
      data[i + 3] = alpha;
    }
  }
  return buffer;
}

/** Blue underwater tint for the whole viewport. */
export function createUnderwaterOverlay(width: number, height: number): PixelBuffer {
  const buffer = createPixelBuffer(width, height);
  const data = buffer.data;
  for (let y = 0; y < height; y++) {
    const depth = y / Math.max(1, height - 1);
    const alpha = Math.round(54 + depth * 34);
    for (let x = 0; x < width; x++) {
      const i = (y * width + x) * 4;
      data[i] = 24;
      data[i + 1] = 76;
      data[i + 2] = 138;
      data[i + 3] = alpha;
    }
  }
  return buffer;
}

export { UI_ICONS };

export const UI_ICON_NAMES: readonly string[] = Object.freeze(Object.keys(UI_ICONS));

/** Paints a UI sprite into an existing painter (clears it first). */
export function paintUiIcon(id: string, painter: PixelPainter): boolean {
  painter.fill('rgba(0,0,0,0)');
  const icon = UI_ICONS[id];
  if (!icon) return false;
  icon(painter);
  return true;
}

/** Renders one UI sprite into a fresh 32x32 buffer (for canvas/dataURL use). */
export function createUiIcon(id: string): PixelBuffer | null {
  const icon = UI_ICONS[id];
  if (!icon) return null;
  const painter = new PixelPainter(T, T);
  painter.fill('rgba(0,0,0,0)');
  icon(painter);
  return painter.buffer;
}
