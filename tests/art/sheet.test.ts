import fs from 'node:fs';
import path from 'node:path';
import { describe, it } from 'vitest';
import { ITEM_ICON_NAMES, ITEM_ICONS } from '../../src/art/items';
import { MOB_SKIN_NAMES, MOB_SKINS } from '../../src/art/mobSkins';
import { PixelPainter } from '../../src/art/pixels';
import { UI_ICON_NAMES, UI_ICONS, createLogo } from '../../src/art/ui';
import { TILES } from '../../src/art/tiles';
import { TILE_SIZE, type TilePainter } from '../../src/art/types';
import { encodePng } from '../tools/png';

/**
 * Renders contact sheets for visual review. Outputs (never overwrite the
 * Lead-owned artifacts/art-sheet.png):
 *   artifacts/art-tiles.png  - every tile, alpha composited over a checkerboard
 *   artifacts/art-tiles-index.txt - tile order for the sheet
 *
 * Review with: pnpm vitest run tests/art/sheet.test.ts
 */

interface Cell {
  label: string;
  painter: TilePainter;
}

function paintCell(painter: TilePainter): PixelPainter {
  const p = new PixelPainter(TILE_SIZE, TILE_SIZE);
  p.fill('rgba(0,0,0,0)');
  painter(p);
  return p;
}

/** Alpha-composite a pixel over the opaque background. */
function blendOver(
  dst: Uint8Array,
  index: number,
  source: readonly number[],
  bg: readonly number[],
): void {
  const a = (source[3] ?? 0) / 255;
  dst[index] = Math.round(source[0] * a + bg[0] * (1 - a));
  dst[index + 1] = Math.round(source[1] * a + bg[1] * (1 - a));
  dst[index + 2] = Math.round(source[2] * a + bg[2] * (1 - a));
  dst[index + 3] = 255;
}

function writeSheet(
  fileName: string,
  cells: readonly Cell[],
  columns: number,
  scale: number,
  basePainter?: TilePainter,
): void {
  const pad = 6;
  const tilePixels = TILE_SIZE * scale;
  const rows = Math.ceil(cells.length / columns);
  const width = pad + columns * (tilePixels + pad);
  const height = pad + rows * (tilePixels + pad);
  const canvas = new Uint8Array(width * height * 4);
  const basePainted = basePainter ? paintCell(basePainter) : null;

  // dark checkerboard so transparent pixels are obvious
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = (y * width + x) * 4;
      const light = (Math.floor(x / 8) + Math.floor(y / 8)) % 2 === 0;
      const value = light ? 62 : 44;
      canvas[i] = value;
      canvas[i + 1] = value + 3;
      canvas[i + 2] = value + 8;
      canvas[i + 3] = 255;
    }
  }

  cells.forEach((cell, index) => {
    const painted = paintCell(cell.painter);
    const col = index % columns;
    const row = Math.floor(index / columns);
    const originX = pad + col * (tilePixels + pad);
    const originY = pad + row * (tilePixels + pad);
    for (let y = 0; y < tilePixels; y++) {
      for (let x = 0; x < tilePixels; x++) {
        const sx = Math.floor(x / scale);
        const sy = Math.floor(y / scale);
        const dx = originX + x;
        const dy = originY + y;
        const index4 = (dy * width + dx) * 4;
        const bg = basePainted ? basePainted.get(sx, sy) : ([62, 65, 70] as const);
        canvas[index4] = bg[0];
        canvas[index4 + 1] = bg[1];
        canvas[index4 + 2] = bg[2];
        canvas[index4 + 3] = 255;
        blendOver(canvas, index4, painted.get(sx, sy), bg);
      }
    }
  });

  const outputDir = path.join(process.cwd(), 'artifacts');
  fs.mkdirSync(outputDir, { recursive: true });
  fs.writeFileSync(path.join(outputDir, fileName), encodePng(width, height, canvas));
}

describe('art contact sheets', () => {
  it('writes artifacts/art-tiles.png', () => {
    const names = Object.keys(TILES).sort();
    const cells = names.map((name) => ({ label: name, painter: TILES[name] }));
    writeSheet('art-tiles.png', cells, 12, 4);
    fs.writeFileSync(
      path.join(process.cwd(), 'artifacts', 'art-tiles-index.txt'),
      names.map((name, index) => `${String(index).padStart(3, '0')} ${name}`).join('\n'),
    );
  });

  it('writes artifacts/art-cracks.png (crack stages over dirt)', () => {
    const cells = Array.from({ length: 10 }, (_, stage) => ({
      label: `crack_${stage}`,
      painter: TILES[`crack_${stage}`],
    }));
    writeSheet('art-cracks.png', cells, 5, 6, TILES.dirt);
  });

  it('writes artifacts/art-focus.png for the high-risk tiles', () => {
    const focus = [
      'grass_top',
      'grass_side',
      'dirt',
      'stone',
      'cobblestone',
      'mossy_cobblestone',
      'gravel',
      'sand',
      'snow',
      'oak_log',
      'oak_log_top',
      'birch_log',
      'birch_log_top',
      'spruce_log_top',
      'oak_leaves',
      'birch_leaves',
      'spruce_leaves',
      'coal_ore',
      'iron_ore',
      'gold_ore',
      'diamond_ore',
      'redstone_ore',
      'lapis_ore',
      'water',
      'lava',
      'obsidian',
      'glass',
      'bricks',
      'stone_bricks',
      'oak_planks',
      'tnt_side',
      'furnace_front_lit',
      'torch',
      'poppy',
      'dandelion',
      'tall_grass',
      'sugar_cane',
      'dead_bush',
      'cactus_side',
      'crafting_table_side',
    ];
    writeSheet(
      'art-focus.png',
      focus.map((name) => ({ label: name, painter: TILES[name] })),
      6,
      6,
    );
  });

  it('writes artifacts/art-items.png', () => {
    const names = [...ITEM_ICON_NAMES].sort();
    writeSheet(
      'art-items.png',
      names.map((name) => ({ label: name, painter: ITEM_ICONS[name] })),
      10,
      4,
    );
    fs.writeFileSync(
      path.join(process.cwd(), 'artifacts', 'art-items-index.txt'),
      names.map((name, index) => `${String(index).padStart(3, '0')} ${name}`).join('\n'),
    );
  });

  it('writes artifacts/art-ui.png', () => {
    const names = [...UI_ICON_NAMES].sort();
    writeSheet(
      'art-ui.png',
      names.map((name) => ({ label: name, painter: UI_ICONS[name] })),
      8,
      4,
    );
    fs.writeFileSync(
      path.join(process.cwd(), 'artifacts', 'art-ui-index.txt'),
      names.map((name, index) => `${String(index).padStart(3, '0')} ${name}`).join('\n'),
    );
  });

  it('writes artifacts/art-mobs.png', () => {
    const names = [...MOB_SKIN_NAMES].sort();
    writeSheet(
      'art-mobs.png',
      names.map((name) => ({ label: name, painter: MOB_SKINS[name] })),
      8,
      4,
    );
    fs.writeFileSync(
      path.join(process.cwd(), 'artifacts', 'art-mobs-index.txt'),
      names.map((name, index) => `${String(index).padStart(3, '0')} ${name}`).join('\n'),
    );
  });

  it('writes artifacts/art-tiles-mip.png (simulated 16px mipmap level)', () => {
    const names = Object.keys(TILES).sort();
    const scale = 5;
    const pad = 4;
    const cell = 16 * scale + pad;
    const columns = 12;
    const rows = Math.ceil(names.length / columns);
    const width = pad + columns * cell;
    const height = pad + rows * cell;
    const canvas = new Uint8Array(width * height * 4);
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const i = (y * width + x) * 4;
        const light = (Math.floor(x / 8) + Math.floor(y / 8)) % 2 === 0;
        canvas[i] = light ? 62 : 44;
        canvas[i + 1] = light ? 65 : 47;
        canvas[i + 2] = light ? 70 : 52;
        canvas[i + 3] = 255;
      }
    }
    names.forEach((name, index) => {
      const painted = paintCell(TILES[name]);
      const originX = pad + (index % columns) * cell;
      const originY = pad + Math.floor(index / columns) * cell;
      for (let y = 0; y < 16 * scale; y++) {
        for (let x = 0; x < 16 * scale; x++) {
          // take the top-left sample of each logical pixel = the 16x16 art
          const source = painted.get(Math.floor(x / scale) * 2, Math.floor(y / scale) * 2);
          blendOver(canvas, ((originY + y) * width + originX + x) * 4, source, [62, 65, 70]);
        }
      }
    });
    fs.mkdirSync(path.join(process.cwd(), 'artifacts'), { recursive: true });
    fs.writeFileSync(path.join(process.cwd(), 'artifacts', 'art-tiles-mip.png'), encodePng(width, height, canvas));
  });

  it('writes artifacts/art-tiling.png (3x3 tiling seam check)', () => {
    const names = [
      'grass_top',
      'stone',
      'sand',
      'water',
      'oak_log',
      'cobblestone',
      'dirt',
      'gravel',
      'oak_leaves',
    ];
    const reps = 3;
    const scale = 3;
    const pad = 8;
    const cell = 16 * reps * scale + pad;
    const columns = 3;
    const rows = Math.ceil(names.length / columns);
    const width = pad + columns * cell;
    const height = pad + rows * cell;
    const canvas = new Uint8Array(width * height * 4);
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const i = (y * width + x) * 4;
        const light = (Math.floor(x / 8) + Math.floor(y / 8)) % 2 === 0;
        canvas[i] = light ? 46 : 34;
        canvas[i + 1] = light ? 48 : 36;
        canvas[i + 2] = light ? 54 : 40;
        canvas[i + 3] = 255;
      }
    }
    names.forEach((name, index) => {
      const painted = paintCell(TILES[name]);
      const originX = pad + (index % columns) * cell;
      const originY = pad + Math.floor(index / columns) * cell;
      const tilePx = 16 * reps * scale;
      for (let y = 0; y < tilePx; y++) {
        for (let x = 0; x < tilePx; x++) {
          const lx = Math.floor(x / scale) % 16;
          const ly = Math.floor(y / scale) % 16;
          const source = painted.get(lx * 2, ly * 2);
          blendOver(canvas, ((originY + y) * width + originX + x) * 4, source, [62, 65, 70]);
        }
      }
    });
    fs.mkdirSync(path.join(process.cwd(), 'artifacts'), { recursive: true });
    fs.writeFileSync(path.join(process.cwd(), 'artifacts', 'art-tiling.png'), encodePng(width, height, canvas));
  });

  it('writes artifacts/art-logo.png', () => {
    const logo = createLogo('MINEVERSE', 4);
    const scale = 2;
    const width = logo.width * scale;
    const height = logo.height * scale;
    const canvas = new Uint8Array(width * height * 4);
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const src = ((Math.floor(y / scale) * logo.width) + Math.floor(x / scale)) * 4;
        const bg = [26, 28, 34] as const;
        blendOver(canvas, (y * width + x) * 4, [logo.data[src], logo.data[src + 1], logo.data[src + 2], logo.data[src + 3]], bg);
      }
    }
    fs.mkdirSync(path.join(process.cwd(), 'artifacts'), { recursive: true });
    fs.writeFileSync(path.join(process.cwd(), 'artifacts', 'art-logo.png'), encodePng(width, height, canvas));
  });
});
