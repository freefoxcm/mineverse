import fs from 'node:fs';
import path from 'node:path';
import { describe, it } from 'vitest';
import { PixelPainter } from '../../src/art/pixels';
import { TILES } from '../../src/art/tiles';
import { TILE_SIZE } from '../../src/art/types';
import { encodePng } from './png';

/**
 * Renders every procedural tile into artifacts/art-sheet.png for visual review.
 * Run: pnpm vitest run tests/tools/art-sheet.test.ts
 */
describe('art contact sheet', () => {
  it('writes artifacts/art-sheet.png', () => {
    const names = Object.keys(TILES).sort();
    const scale = 2;
    const pad = 4;
    const cols = 12;
    const tilePixels = TILE_SIZE * scale;
    const cell = tilePixels + pad;
    const rows = Math.ceil(names.length / cols);
    const width = cols * cell + pad;
    const height = rows * cell + pad;
    const canvas = new Uint8Array(width * height * 4);

    // Checkerboard background so transparency is visible.
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const i = (y * width + x) * 4;
        const dark = (Math.floor(x / 8) + Math.floor(y / 8)) % 2 === 0;
        canvas[i] = dark ? 42 : 58;
        canvas[i + 1] = dark ? 46 : 62;
        canvas[i + 2] = dark ? 52 : 68;
        canvas[i + 3] = 255;
      }
    }

    names.forEach((name, index) => {
      const painter = new PixelPainter(TILE_SIZE, TILE_SIZE);
      TILES[name](painter);
      const col = index % cols;
      const row = Math.floor(index / cols);
      const originX = pad + col * cell;
      const originY = pad + row * cell;
      for (let y = 0; y < tilePixels; y++) {
        for (let x = 0; x < tilePixels; x++) {
          const source = painter.get(Math.floor(x / scale), Math.floor(y / scale));
          const dst = ((originY + y) * width + originX + x) * 4;
          canvas[dst] = source[0];
          canvas[dst + 1] = source[1];
          canvas[dst + 2] = source[2];
          canvas[dst + 3] = 255;
        }
      }
    });

    const outputDir = path.join(process.cwd(), 'artifacts');
    fs.mkdirSync(outputDir, { recursive: true });
    fs.writeFileSync(path.join(outputDir, 'art-sheet.png'), encodePng(width, height, canvas));
    fs.writeFileSync(
      path.join(outputDir, 'art-sheet-index.txt'),
      names.map((name, index) => `${String(index).padStart(3, '0')} ${name}`).join('\n'),
    );
  });
});
