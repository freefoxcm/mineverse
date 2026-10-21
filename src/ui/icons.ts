/**
 * Icon pipeline for the UI. Item sprites are produced from Art-E's procedural
 * pixel buffers (`src/art/items.ts`) and converted to a canvas data URL so the
 * DOM can render them without external images. When the art registries are not
 * available yet (or an icon is missing) a deterministic pixel placeholder is
 * generated locally, so the UI never shows broken images.
 *
 * Art registries are discovered through `import.meta.glob` so this module
 * compiles and runs before `src/art/items.ts` / `src/art/ui.ts` exist.
 */
import { PixelPainter, type PixelBuffer } from '../art/pixels';
import { TILE_SIZE, type ItemPainter } from '../art/types';
import { TILES } from '../art/tiles';
import { blockById, faceTexture } from '../world/blocks';
import { getItem } from '../world/items';

export const ITEM_ICON_SIZE = TILE_SIZE;

export type UiIconName =
  | 'heart_full'
  | 'heart_half'
  | 'heart_empty'
  | 'hunger_full'
  | 'hunger_half'
  | 'hunger_empty'
  | 'armor_full'
  | 'armor_half'
  | 'armor_empty'
  | 'bubble_full'
  | 'bubble_empty'
  | 'flame'
  | 'arrow'
  | 'crosshair';

// ---------------------------------------------------------------------------
// Art-E registries (optional)
// ---------------------------------------------------------------------------

interface ArtModule {
  ITEM_ICONS?: Record<string, ItemPainter>;
  UI_ICONS?: Record<string, ItemPainter>;
}

const ART_MODULES: Record<string, ArtModule> = import.meta.glob<ArtModule>('../art/*.ts', { eager: true });

function collectArtIcons(key: 'ITEM_ICONS' | 'UI_ICONS'): Record<string, ItemPainter> {
  const icons: Record<string, ItemPainter> = {};
  for (const module of Object.values(ART_MODULES)) {
    const registry = module?.[key];
    if (!registry || typeof registry !== 'object') continue;
    for (const [name, painter] of Object.entries(registry)) {
      if (typeof painter === 'function') icons[name] = painter as ItemPainter;
    }
  }
  return icons;
}

const ART_ITEM_ICONS = collectArtIcons('ITEM_ICONS');
const ART_UI_ICONS = collectArtIcons('UI_ICONS');

// ---------------------------------------------------------------------------
// Pixel buffer -> PNG data URL
// ---------------------------------------------------------------------------

function paintBuffer(painter: ItemPainter, size: number = TILE_SIZE): PixelBuffer | null {
  if (typeof document === 'undefined') return null;
  const pixels = new PixelPainter(size, size);
  painter(pixels);
  return pixels.buffer;
}

function bufferToDataUrl(buffer: PixelBuffer, scale = 2): string {
  if (typeof document === 'undefined') return '';
  const source = document.createElement('canvas');
  source.width = buffer.width;
  source.height = buffer.height;
  const sourceContext = source.getContext('2d');
  if (!sourceContext) return '';
  sourceContext.putImageData(new ImageData(new Uint8ClampedArray(buffer.data), buffer.width, buffer.height), 0, 0);
  if (scale === 1) return source.toDataURL('image/png');
  const scaled = document.createElement('canvas');
  scaled.width = buffer.width * scale;
  scaled.height = buffer.height * scale;
  const context = scaled.getContext('2d');
  if (!context) return source.toDataURL('image/png');
  context.imageSmoothingEnabled = false;
  context.drawImage(source, 0, 0, scaled.width, scaled.height);
  return scaled.toDataURL('image/png');
}

function clipDataUrl(buffer: PixelBuffer, scale = 2): string {
  return bufferToDataUrl(buffer, scale);
}

// ---------------------------------------------------------------------------
// Block icons: isometric cube rendered from the existing 32x32 tile painters
// ---------------------------------------------------------------------------

function checkerBuffer(): PixelBuffer {
  const pixels = new PixelPainter(TILE_SIZE, TILE_SIZE);
  pixels.checker('#ff00ff', '#101010', 4);
  return pixels.buffer;
}

function tileBuffer(tileName: string): PixelBuffer {
  const painter = TILES[tileName];
  if (!painter) return checkerBuffer();
  const pixels = new PixelPainter(TILE_SIZE, TILE_SIZE);
  painter(pixels);
  return pixels.buffer;
}

function bufferToCanvas(buffer: PixelBuffer): HTMLCanvasElement {
  const canvas = document.createElement('canvas');
  canvas.width = buffer.width;
  canvas.height = buffer.height;
  const context = canvas.getContext('2d');
  if (context) {
    context.putImageData(new ImageData(new Uint8ClampedArray(buffer.data), buffer.width, buffer.height), 0, 0);
  }
  return canvas;
}

function drawParallelogram(
  context: CanvasRenderingContext2D,
  tile: HTMLCanvasElement,
  origin: readonly [number, number],
  u: readonly [number, number],
  v: readonly [number, number],
  shade: number,
): void {
  const [ox, oy] = origin;
  const [ux, uy] = u;
  const [vx, vy] = v;
  context.save();
  context.beginPath();
  context.moveTo(ox, oy);
  context.lineTo(ox + ux, oy + uy);
  context.lineTo(ox + ux + vx, oy + uy + vy);
  context.lineTo(ox + vx, oy + vy);
  context.closePath();
  context.clip();
  context.setTransform(ux / TILE_SIZE, uy / TILE_SIZE, vx / TILE_SIZE, vy / TILE_SIZE, ox, oy);
  context.drawImage(tile, 0, 0);
  context.setTransform(1, 0, 0, 1, 0, 0);
  if (shade > 0) {
    context.fillStyle = `rgba(0, 0, 0, ${shade})`;
    context.fill();
  } else if (shade < 0) {
    context.fillStyle = `rgba(255, 255, 255, ${-shade})`;
    context.fill();
  }
  context.restore();
}

function blockIconDataUrl(blockName: string): string {
  const def = blockById.get(blockName);
  if (!def) return '';
  const canvas = document.createElement('canvas');
  canvas.width = TILE_SIZE;
  canvas.height = TILE_SIZE;
  const context = canvas.getContext('2d');
  if (!context) return '';

  if (def.render !== 'cube') {
    // Cross / torch / liquid block items render as a flat sprite.
    context.drawImage(bufferToCanvas(tileBuffer(faceTexture(def, 0))), 0, 0);
    return canvas.toDataURL('image/png');
  }

  const topTile = bufferToCanvas(tileBuffer(faceTexture(def, 2)));
  const sideTile = bufferToCanvas(tileBuffer(faceTexture(def, 0)));

  // Isometric cube inside 32x32 (top diamond, two side faces).
  drawParallelogram(context, topTile, [16, 2], [13, 7], [-13, 7], 0);
  drawParallelogram(context, sideTile, [3, 9], [13, 7], [0, 13], 0.28);
  drawParallelogram(context, sideTile, [16, 16], [13, -7], [0, 13], 0.12);

  // Crisp pixel outline.
  context.strokeStyle = 'rgba(0, 0, 0, 0.45)';
  context.lineWidth = 1;
  context.beginPath();
  context.moveTo(16, 2);
  context.lineTo(29, 9);
  context.lineTo(29, 22);
  context.lineTo(16, 29);
  context.lineTo(3, 22);
  context.lineTo(3, 9);
  context.closePath();
  context.stroke();
  return canvas.toDataURL('image/png');
}

// ---------------------------------------------------------------------------
// Item icon fallbacks (used until Art-E's ITEM_ICONS covers the item)
// ---------------------------------------------------------------------------

interface ItemPalette {
  main: string;
  light: string;
  dark: string;
}

const PALETTES: readonly { match: RegExp; palette: ItemPalette }[] = [
  { match: /diamond/, palette: { main: '#5fe6e6', light: '#b9ffff', dark: '#2a9199' } },
  { match: /gold/, palette: { main: '#f2cf4a', light: '#fff0a8', dark: '#a5821f' } },
  { match: /^iron|iron_/, palette: { main: '#d8dce2', light: '#ffffff', dark: '#8b929c' } },
  { match: /copper/, palette: { main: '#e08a52', light: '#ffbf8e', dark: '#91501f' } },
  { match: /coal|charcoal|black_dye/, palette: { main: '#2c2f33', light: '#54595f', dark: '#101215' } },
  { match: /redstone|red_dye|poppy|brick$/, palette: { main: '#c0392b', light: '#ff7a6a', dark: '#701d14' } },
  { match: /lapis|blue_dye/, palette: { main: '#2f5bd6', light: '#6f96ff', dark: '#1a327d' } },
  { match: /yellow_dye|dandelion/, palette: { main: '#f2d94e', light: '#fff9b0', dark: '#9c8612' } },
  { match: /leather/, palette: { main: '#b08050', light: '#d9ab7c', dark: '#694a26' } },
  { match: /wooden|^stick$/, palette: { main: '#9a6b3d', light: '#c69a66', dark: '#5e3d1e' } },
  { match: /stone/, palette: { main: '#9a9a9a', light: '#c4c4c4', dark: '#5f5f5f' } },
  { match: /paper|feather|bone|string|snow/, palette: { main: '#e8e8e0', light: '#ffffff', dark: '#a8a89c' } },
  { match: /clay|brick_?item/, palette: { main: '#b06a4a', light: '#d68f6c', dark: '#6b3a26' } },
  { match: /flint|gunpowder/, palette: { main: '#6b6b6b', light: '#949494', dark: '#3a3a3a' } },
];

function hashString(value: string): number {
  let hash = 2166136261;
  for (let i = 0; i < value.length; i++) {
    hash ^= value.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

function paletteFor(itemId: string): ItemPalette {
  for (const entry of PALETTES) if (entry.match.test(itemId)) return entry.palette;
  const hash = hashString(itemId);
  const hue = hash % 360;
  const toHex = (value: number): string => Math.max(0, Math.min(255, Math.round(value))).toString(16).padStart(2, '0');
  const hsl = (h: number, s: number, l: number): string => {
    // Small HSL -> RGB helper (kept local to avoid pulling a color library).
    const c = (1 - Math.abs(2 * l - 1)) * s;
    const x = c * (1 - Math.abs(((h / 60) % 2) - 1));
    const m = l - c / 2;
    let r = 0;
    let g = 0;
    let b = 0;
    if (h < 60) [r, g, b] = [c, x, 0];
    else if (h < 120) [r, g, b] = [x, c, 0];
    else if (h < 180) [r, g, b] = [0, c, x];
    else if (h < 240) [r, g, b] = [0, x, c];
    else if (h < 300) [r, g, b] = [x, 0, c];
    else [r, g, b] = [c, 0, x];
    return `#${toHex((r + m) * 255)}${toHex((g + m) * 255)}${toHex((b + m) * 255)}`;
  };
  return { main: hsl(hue, 0.55, 0.55), light: hsl(hue, 0.6, 0.75), dark: hsl(hue, 0.55, 0.32) };
}

function fillRect(pixels: PixelPainter, x: number, y: number, w: number, h: number, color: string): void {
  pixels.rect(x, y, w, h, color);
}

function outlineRect(pixels: PixelPainter, x: number, y: number, w: number, h: number, color: string): void {
  pixels.rect(x, y, w, 1, color);
  pixels.rect(x, y + h - 1, w, 1, color);
  pixels.rect(x, y, 1, h, color);
  pixels.rect(x + w - 1, y, 1, h, color);
}

function ingotPainter(palette: ItemPalette): ItemPainter {
  return (pixels) => {
    // Parallelogram ingot: top face, front face, darker rim.
    for (let row = 0; row < 10; row++) {
      const inset = Math.floor(row / 2);
      pixels.rect(6 + inset, 9 + row, 20 - inset * 2, 1, palette.main);
    }
    pixels.rect(8, 10, 14, 2, palette.light);
    for (let row = 0; row < 5; row++) outlineRectSide(pixels, 6 + row, 9, 20 - row * 2, 10, palette.dark);
    pixels.rect(9, 12, 3, 1, '#ffffff');
  };
}

function outlineRectSide(pixels: PixelPainter, x: number, y: number, w: number, h: number, color: string): void {
  pixels.set(x, y, color);
  pixels.set(x + w - 1, y, color);
  pixels.set(x, y + h, color);
  pixels.set(x + w - 1, y + h, color);
}

function gemPainter(palette: ItemPalette): ItemPainter {
  return (pixels) => {
    const centerX = 16;
    for (let y = 6; y <= 25; y++) {
      const t = Math.abs(y - 15.5) / 10;
      const half = Math.max(1, Math.round(9.5 * (1 - t)));
      pixels.rect(centerX - half, y, half * 2, 1, y < 13 ? palette.light : palette.main);
    }
    pixels.rect(11, 11, 5, 3, '#ffffff');
    for (let y = 6; y <= 25; y += 1) {
      const t = Math.abs(y - 15.5) / 10;
      const half = Math.max(1, Math.round(9.5 * (1 - t)));
      pixels.set(centerX - half, y, palette.dark);
      pixels.set(centerX + half - 1, y, palette.dark);
    }
  };
}

function lumpPainter(palette: ItemPalette): ItemPainter {
  return (pixels) => {
    pixels.speckle(hashString(palette.main), [palette.main, palette.main, palette.light, palette.dark], 0.5);
    for (let y = 8; y < 24; y++) {
      for (let x = 8; x < 24; x++) {
        const dx = x - 16;
        const dy = y - 16;
        if (dx * dx * 1.1 + dy * dy * 0.85 > 60) pixels.set(x, y, [0, 0, 0, 0]);
      }
    }
    pixels.rect(11, 11, 4, 2, palette.light);
  };
}

function toolPainter(itemId: string, palette: ItemPalette): ItemPainter {
  return (pixels) => {
    const handle = '#7a5230';
    const handleDark = '#4d3018';
    // Diagonal handle.
    const line = (x: number, y: number, color: string, width: number): void => {
      for (let i = 0; i < 18; i++) {
        const px = x + i;
        const py = y - i;
        for (let w = 0; w < width; w++) pixels.set(px - w, py, color);
      }
    };
    line(9, 26, handleDark, 3);
    line(10, 26, handle, 2);
    if (itemId.includes('pickaxe')) {
      pixels.rect(6, 5, 18, 3, palette.main);
      pixels.rect(6, 4, 18, 1, palette.light);
      pixels.rect(6, 8, 18, 1, palette.dark);
      pixels.set(4, 6, palette.dark);
      pixels.set(4, 7, palette.main);
    } else if (itemId.includes('axe')) {
      pixels.rect(18, 4, 8, 10, palette.main);
      pixels.rect(18, 4, 8, 1, palette.light);
      pixels.rect(18, 13, 8, 1, palette.dark);
      pixels.rect(22, 6, 3, 3, palette.dark);
    } else if (itemId.includes('shovel')) {
      pixels.rect(19, 3, 8, 9, palette.main);
      pixels.rect(19, 3, 8, 1, palette.light);
      pixels.rect(19, 11, 8, 1, palette.dark);
    } else if (itemId.includes('sword')) {
      for (let i = 0; i < 16; i++) {
        pixels.rect(8 + i, 23 - i, 2, 2, i > 12 ? palette.dark : palette.light);
        pixels.set(9 + i, 24 - i, palette.main);
      }
      pixels.rect(6, 22, 6, 2, '#6b6b6b');
      pixels.rect(7, 24, 2, 4, handleDark);
    } else {
      pixels.speckle(hashString(itemId), [palette.main, palette.light], 0.4);
      fillRect(pixels, 10, 6, 12, 12, palette.main);
    }
  };
}

function armorPainter(itemId: string, palette: ItemPalette): ItemPainter {
  return (pixels) => {
    const outline = '#1c2430';
    if (itemId.includes('helmet')) {
      pixels.rect(5, 8, 22, 11, palette.main);
      pixels.rect(5, 8, 22, 2, palette.light);
      pixels.rect(7, 17, 18, 5, palette.main);
      pixels.rect(9, 19, 14, 2, outline);
      outlineRect(pixels, 5, 8, 22, 14, outline);
    } else if (itemId.includes('chestplate')) {
      pixels.rect(6, 7, 20, 16, palette.main);
      pixels.rect(3, 8, 5, 7, palette.main);
      pixels.rect(24, 8, 5, 7, palette.main);
      pixels.rect(6, 7, 20, 2, palette.light);
      pixels.rect(13, 9, 6, 4, palette.dark);
      outlineRect(pixels, 6, 7, 20, 16, outline);
    } else if (itemId.includes('leggings')) {
      pixels.rect(7, 6, 18, 8, palette.main);
      pixels.rect(7, 12, 7, 14, palette.main);
      pixels.rect(18, 12, 7, 14, palette.main);
      pixels.rect(7, 6, 18, 2, palette.light);
      pixels.rect(14, 12, 2, 12, palette.dark);
      outlineRect(pixels, 7, 6, 18, 8, outline);
    } else {
      // boots
      pixels.rect(5, 7, 9, 18, palette.main);
      pixels.rect(18, 7, 9, 18, palette.main);
      pixels.rect(5, 7, 9, 2, palette.light);
      pixels.rect(18, 7, 9, 2, palette.light);
      pixels.rect(5, 21, 12, 4, palette.dark);
      pixels.rect(16, 21, 12, 4, palette.dark);
      outlineRect(pixels, 5, 7, 9, 18, outline);
      outlineRect(pixels, 18, 7, 9, 18, outline);
    }
  };
}

function foodPainter(itemId: string, palette: ItemPalette): ItemPainter {
  return (pixels) => {
    pixels.speckle(hashString(itemId), [palette.main, palette.main, palette.light, palette.dark], 0.32);
    const centerX = 16;
    const centerY = 18;
    for (let y = 0; y < TILE_SIZE; y++) {
      for (let x = 0; x < TILE_SIZE; x++) {
        const dx = (x - centerX) / 10;
        const dy = (y - centerY) / 8.5;
        if (dx * dx + dy * dy > 1) pixels.set(x, y, [0, 0, 0, 0]);
      }
    }
    pixels.rect(13, 5, 3, 4, '#5b7a2a');
    pixels.rect(16, 4, 4, 3, '#7da33b');
    pixels.rect(11, 13, 5, 3, palette.light);
  };
}

function materialPainter(itemId: string, palette: ItemPalette): ItemPainter {
  if (itemId.includes('ingot') || itemId.endsWith('_brick') || itemId === 'brick') return ingotPainter(palette);
  if (['diamond', 'lapis_lazuli', 'redstone', 'coal', 'charcoal', 'flint'].includes(itemId)) return gemPainter(palette);
  if (itemId === 'stick') {
    return (pixels) => {
      for (let i = 0; i < 18; i++) {
        pixels.rect(8 + i, 25 - i, 2, 2, i % 5 === 0 ? '#c69a66' : '#9a6b3d');
      }
      pixels.rect(7, 25, 3, 2, '#5e3d1e');
    };
  }
  if (itemId === 'string') {
    return (pixels) => {
      for (let i = 0; i < 20; i++) pixels.set(8 + i, 8 + Math.round(Math.sin(i * 0.7) * 6), '#e8e8e0');
      for (let i = 0; i < 20; i++) pixels.set(8 + i, 10 + Math.round(Math.cos(i * 0.6) * 6), '#b9b9ae');
    };
  }
  return lumpPainter(palette);
}

function fallbackItemIconDataUrl(itemId: string): string {
  const def = getItem(itemId);
  if (!def) {
    const buffer = paintBuffer((pixels) => {
      pixels.checker('#ff00ff', '#101010', 4);
    });
    return buffer ? clipDataUrl(buffer, 2) : '';
  }
  const palette = paletteFor(itemId);
  let painter: ItemPainter;
  if (def.kind === 'tool' || def.kind === 'weapon' || def.kind === 'misc') painter = toolPainter(itemId, palette);
  else if (def.kind === 'armor') painter = armorPainter(itemId, palette);
  else if (def.kind === 'food') painter = foodPainter(itemId, palette);
  else painter = materialPainter(itemId, palette);
  const buffer = paintBuffer(painter);
  return buffer ? clipDataUrl(buffer, 2) : '';
}

// ---------------------------------------------------------------------------
// UI chrome icon fallbacks (hearts / hunger / armor / bubbles / flame)
// ---------------------------------------------------------------------------

function inCircle(x: number, y: number, cx: number, cy: number, radius: number): boolean {
  const dx = x - cx;
  const dy = y - cy;
  return dx * dx + dy * dy <= radius * radius;
}

function heartMask(x: number, y: number): boolean {
  if (inCircle(x + 0.5, y + 0.5, 5.7, 5.6, 4.05)) return true;
  if (inCircle(x + 0.5, y + 0.5, 10.3, 5.6, 4.05)) return true;
  if (y >= 6 && y <= 14) {
    const halfWidth = (14.6 - y) * 0.95;
    return Math.abs(x + 0.5 - 8) <= halfWidth;
  }
  return false;
}

function drawHeart(pixels: PixelPainter, mode: 'full' | 'half' | 'empty'): void {
  const bright = '#e13b3b';
  const brightLight = '#ff6b5e';
  const dark = '#7d1616';
  const emptyFill = '#3a3f46';
  const outline = '#14161a';
  for (let y = 0; y < 16; y++) {
    for (let x = 0; x < 16; x++) {
      if (!heartMask(x, y)) continue;
      const isEdge = !heartMask(x - 1, y) || !heartMask(x + 1, y) || !heartMask(x, y - 1) || !heartMask(x, y + 1);
      let color: string;
      if (isEdge) color = outline;
      else if (mode === 'empty') color = emptyFill;
      else if (mode === 'half' && x >= 8) color = dark;
      else color = y <= 6 ? brightLight : bright;
      pixels.set(x, y, color);
    }
  }
}

function drawHunger(pixels: PixelPainter, mode: 'full' | 'half' | 'empty'): void {
  const meat = '#c98a3a';
  const meatLight = '#e6b264';
  const meatDark = '#7d4a17';
  const bone = '#efe6d0';
  const boneDark = '#a89f8a';
  const outline = '#1c1610';
  for (let y = 0; y < 16; y++) {
    for (let x = 0; x < 16; x++) {
      const inMeat = inCircle(x + 0.5, y + 0.5, 6, 6.2, 4.6) && !inCircle(x + 0.5, y + 0.5, 8.4, 8.4, 3.1);
      if (!inMeat) continue;
      const edge = !inCircle(x - 0.5, y + 0.5, 6, 6.2, 4.6) || inCircle(x - 0.5, y + 0.5, 8.4, 8.4, 3.1);
      let color: string;
      if (mode === 'empty') color = '#3a3f46';
      else if (mode === 'half' && x >= 7) color = meatDark;
      else color = y < 5 ? meatLight : meat;
      if (edge) color = outline;
      pixels.set(x, y, color);
    }
  }
  for (let i = 0; i < 7; i++) {
    const x = 8 + i;
    const y = 8 + i;
    pixels.set(x, y, mode === 'empty' ? '#3a3f46' : bone);
    pixels.set(x + 1, y, mode === 'empty' ? '#3a3f46' : boneDark);
  }
  if (mode !== 'empty') {
    pixels.rect(13, 12, 3, 3, boneDark);
  }
}

function drawArmor(pixels: PixelPainter, mode: 'full' | 'half' | 'empty'): void {
  const bright = '#aabfd8';
  const brightLight = '#dbe8f8';
  const dark = '#46617f';
  const emptyFill = '#3a3f46';
  const outline = '#14202e';
  for (let y = 2; y <= 14; y++) {
    let start = 3;
    let end = 13;
    if (y <= 4) {
      start = 2;
      end = 14;
    } else if (y >= 11) {
      const taper = y - 10;
      start = 3 + taper;
      end = 13 - taper;
    }
    for (let x = start; x <= end; x++) {
      if (y === 2 || y === 14 || x === start || x === end) pixels.set(x, y, outline);
      else if (mode === 'empty') pixels.set(x, y, emptyFill);
      else if (mode === 'half' && x >= 8) pixels.set(x, y, dark);
      else pixels.set(x, y, y <= 4 ? brightLight : bright);
    }
  }
}

function drawBubble(pixels: PixelPainter, mode: 'full' | 'empty'): void {
  const ring = mode === 'full' ? '#8fd4ff' : '#3a6f96';
  const ringDark = mode === 'full' ? '#3f8bc4' : '#224660';
  for (let y = 0; y < 16; y++) {
    for (let x = 0; x < 16; x++) {
      const dist = Math.hypot(x + 0.5 - 8, y + 0.5 - 8);
      if (dist > 5.6 || dist < 3.4) continue;
      pixels.set(x, y, dist > 5 || y > 8 ? ringDark : ring);
    }
  }
  if (mode === 'full') pixels.rect(5, 4, 2, 2, '#e8f7ff');
}

const FLAME_MASK: readonly string[] = [
  '................',
  '.......#........',
  '......##........',
  '......##........',
  '.....###........',
  '....####........',
  '....####........',
  '...#####..##....',
  '...######.##....',
  '..##########....',
  '..############..',
  '..############..',
  '..###++++####...',
  '..##++++++##....',
  '...##++++##.....',
  '................',
];

function drawFlame(pixels: PixelPainter): void {
  const outer = '#e2701f';
  const inner = '#f7d34a';
  for (let y = 0; y < FLAME_MASK.length; y++) {
    for (let x = 0; x < FLAME_MASK[y].length; x++) {
      const ch = FLAME_MASK[y][x];
      if (ch === '#') pixels.set(x, y, outer);
      else if (ch === '+') pixels.set(x, y, inner);
    }
  }
}

function drawArrow(pixels: PixelPainter): void {
  pixels.rect(4, 11, 14, 3, '#e8e8e0');
  for (let i = 0; i < 6; i++) {
    pixels.rect(17 + i, 8 + i, 2, 2, '#e8e8e0');
    pixels.rect(17 + i, 16 - i, 2, 2, '#e8e8e0');
  }
}

function fallbackUiPainter(name: UiIconName): ItemPainter | null {
  if (name.startsWith('heart_')) {
    const mode = name.endsWith('_half') ? 'half' : name.endsWith('_empty') ? 'empty' : 'full';
    return (pixels) => drawHeart(pixels, mode);
  }
  if (name.startsWith('hunger_')) {
    const mode = name.endsWith('_half') ? 'half' : name.endsWith('_empty') ? 'empty' : 'full';
    return (pixels) => drawHunger(pixels, mode);
  }
  if (name.startsWith('armor_')) {
    const mode = name.endsWith('_half') ? 'half' : name.endsWith('_empty') ? 'empty' : 'full';
    return (pixels) => drawArmor(pixels, mode);
  }
  if (name === 'bubble_full') return (pixels) => drawBubble(pixels, 'full');
  if (name === 'bubble_empty') return (pixels) => drawBubble(pixels, 'empty');
  if (name === 'flame') return drawFlame;
  if (name === 'arrow') return drawArrow;
  if (name === 'crosshair') {
    return (pixels) => {
      pixels.rect(7, 1, 2, 14, '#ffffff');
      pixels.rect(1, 7, 14, 2, '#ffffff');
    };
  }
  return null;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

const itemIconCache = new Map<string, string>();
const uiIconCache = new Map<string, string>();

/** PNG data URL for an item id (Art-E sprite when available, placeholder else). */
export function getItemIcon(itemId: string | null | undefined): string {
  if (!itemId || itemId === 'air') return '';
  const cached = itemIconCache.get(itemId);
  if (cached !== undefined) return cached;
  const def = getItem(itemId);
  if (!def) {
    itemIconCache.set(itemId, '');
    return '';
  }
  let url: string;
  const artPainter = ART_ITEM_ICONS[itemId];
  if (artPainter) {
    const buffer = paintBuffer(artPainter);
    url = buffer ? clipDataUrl(buffer, 2) : '';
  } else if (def.block) {
    url = blockIconDataUrl(def.block);
  } else {
    url = fallbackItemIconDataUrl(itemId);
  }
  itemIconCache.set(itemId, url);
  return url;
}

/** True when Art-E's ITEM_ICONS registry covers this item. */
export function hasArtItemIcon(itemId: string): boolean {
  return typeof ART_ITEM_ICONS[itemId] === 'function';
}

/** True when Art-E's UI_ICONS registry covers this HUD/screen icon. */
export function hasArtUiIcon(name: string): boolean {
  return typeof ART_UI_ICONS[name] === 'function';
}

/** Number of icons discovered in the optional art registries (debug/E2E). */
export function artIconStats(): { items: number; ui: number } {
  return { items: Object.keys(ART_ITEM_ICONS).length, ui: Object.keys(ART_UI_ICONS).length };
}

/** PNG data URL for a HUD/UI chrome icon. */
export function getUiIcon(name: UiIconName): string {
  const cached = uiIconCache.get(name);
  if (cached !== undefined) return cached;
  let url = '';
  const artPainter = ART_UI_ICONS[name];
  if (artPainter) {
    const buffer = paintBuffer(artPainter);
    url = buffer ? clipDataUrl(buffer, 1) : '';
  } else {
    const fallback = fallbackUiPainter(name);
    if (fallback) {
      const buffer = paintBuffer(fallback, 16);
      url = buffer ? clipDataUrl(buffer, 2) : '';
    }
  }
  uiIconCache.set(name, url);
  return url;
}

/** Clear the data URL caches (used by tests / when art assets hot reload). */
export function clearIconCaches(): void {
  itemIconCache.clear();
  uiIconCache.clear();
}
