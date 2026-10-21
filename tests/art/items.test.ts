import { describe, expect, it } from 'vitest';
import { ITEM_ICON_NAMES, ITEM_ICONS, createItemIcon, paintItemIcon } from '../../src/art/items';
import { PixelPainter } from '../../src/art/pixels';
import { TILE_SIZE } from '../../src/art/types';
import { allItems, getItem } from '../../src/world/items';

/**
 * Contract tests for item sprites:
 * - every `icon: 'sprite'` item in the registry has an ITEM_ICONS painter;
 * - ITEM_ICONS has no keys that are not sprite items (block items are cubes);
 * - 32x32, transparent background, deterministic output;
 * - tool/armour tiers are visually distinct (same kind, different material).
 */

function paint(icon: (p: PixelPainter) => void): PixelPainter {
  const p = new PixelPainter(TILE_SIZE, TILE_SIZE);
  p.fill('rgba(0,0,0,0)');
  icon(p);
  return p;
}

function spriteItems(): string[] {
  return allItems()
    .filter((item) => item.icon === 'sprite')
    .map((item) => item.id)
    .sort();
}

function countTransparent(p: PixelPainter): number {
  let count = 0;
  for (let i = 3; i < p.data.length; i += 4) if (p.data[i] === 0) count++;
  return count;
}

describe('item icons: coverage', () => {
  it('covers every sprite item in allItems()', () => {
    const missing = spriteItems().filter((id) => !(id in ITEM_ICONS));
    expect(missing).toEqual([]);
  });

  it('only contains keys that are sprite items', () => {
    const extra = ITEM_ICON_NAMES.filter((id) => {
      const def = getItem(id);
      return !def || def.icon !== 'sprite';
    });
    expect(extra).toEqual([]);
  });

  it('has no duplicate names', () => {
    expect(new Set(ITEM_ICON_NAMES).size).toBe(ITEM_ICON_NAMES.length);
  });
});

describe('item icons: geometry / determinism', () => {
  it('paints 32x32 sprites', () => {
    for (const id of ITEM_ICON_NAMES) {
      const p = paint(ITEM_ICONS[id]);
      expect(p.width, id).toBe(TILE_SIZE);
      expect(p.height, id).toBe(TILE_SIZE);
    }
  });

  it('is deterministic across runs and idempotent on the same buffer', () => {
    for (const id of ITEM_ICON_NAMES) {
      const a = paint(ITEM_ICONS[id]);
      const b = paint(ITEM_ICONS[id]);
      expect(Buffer.from(a.data).equals(Buffer.from(b.data)), id).toBe(true);

      const twice = new PixelPainter(TILE_SIZE, TILE_SIZE);
      twice.fill('rgba(0,0,0,0)');
      ITEM_ICONS[id](twice);
      ITEM_ICONS[id](twice);
      expect(Buffer.from(a.data).equals(Buffer.from(twice.data)), id).toBe(true);
    }
  });

  it('keeps all four corners transparent (transparent background contract)', () => {
    for (const id of ITEM_ICON_NAMES) {
      const p = paint(ITEM_ICONS[id]);
      const corners = [
        p.get(0, 0),
        p.get(TILE_SIZE - 1, 0),
        p.get(0, TILE_SIZE - 1),
        p.get(TILE_SIZE - 1, TILE_SIZE - 1),
      ];
      for (const corner of corners) expect(corner[3], id).toBe(0);
    }
  });

  it('draws an opaque silhouette (not an empty sprite)', () => {
    for (const id of ITEM_ICON_NAMES) {
      const p = paint(ITEM_ICONS[id]);
      let opaque = 0;
      for (let i = 3; i < p.data.length; i += 4) if (p.data[i] === 255) opaque++;
      expect(opaque, id).toBeGreaterThan(80);
      expect(countTransparent(p), id).toBeGreaterThan(0);
    }
  });
});

describe('item icons: tool / armour tiers are distinct', () => {
  const materials = ['wooden', 'stone', 'iron', 'golden', 'diamond'];
  const kinds = ['pickaxe', 'axe', 'shovel', 'sword'];

  it('paints a different icon for each tool material', () => {
    for (const kind of kinds) {
      const rendered = materials.map((m) => Buffer.from(paint(ITEM_ICONS[`${m}_${kind}`]).data));
      for (let i = 1; i < rendered.length; i++) {
        expect(rendered[i].equals(rendered[0]), `${materials[i]}_${kind}`).toBe(false);
      }
    }
  });

  it('paints a different icon for each armour material and slot', () => {
    const armorMaterials = ['leather', 'iron', 'golden', 'diamond'];
    const slots = ['helmet', 'chestplate', 'leggings', 'boots'];
    const rendered = new Map<string, Buffer>();
    for (const m of armorMaterials) {
      for (const slot of slots) {
        const id = `${m}_${slot}`;
        const buffer = Buffer.from(paint(ITEM_ICONS[id]).data);
        for (const [otherId, other] of rendered) {
          expect(buffer.equals(other), `${id} vs ${otherId}`).toBe(false);
        }
        rendered.set(id, buffer);
      }
    }
  });
});

describe('item icons: tool silhouettes (V4 extrusion-ready)', () => {
  const MATERIAL_KEYS = ['wooden', 'stone', 'iron', 'golden', 'diamond'];
  const TOOL_KINDS = ['pickaxe', 'axe', 'shovel', 'sword'];
  const TOOL_IDS = MATERIAL_KEYS.flatMap((m) => TOOL_KINDS.map((k) => `${m}_${k}`));

  function maskOf(id: string): Uint8Array {
    const p = paint(ITEM_ICONS[id]);
    const mask = new Uint8Array(TILE_SIZE * TILE_SIZE);
    for (let i = 0; i < mask.length; i++) mask[i] = p.data[i * 4 + 3] > 0 ? 1 : 0;
    return mask;
  }

  function floodFillOpaque(mask: Uint8Array, start: number): number {
    const seen = new Uint8Array(mask.length);
    const stack = [start];
    let count = 0;
    while (stack.length > 0) {
      const index = stack.pop() as number;
      if (seen[index] || mask[index] === 0) continue;
      seen[index] = 1;
      count++;
      const x = index % TILE_SIZE;
      const y = Math.floor(index / TILE_SIZE);
      if (x > 0) stack.push(index - 1);
      if (x < TILE_SIZE - 1) stack.push(index + 1);
      if (y > 0) stack.push(index - TILE_SIZE);
      if (y < TILE_SIZE - 1) stack.push(index + TILE_SIZE);
    }
    return count;
  }

  it('uses binary alpha for all tool icons', () => {
    for (const id of TOOL_IDS) {
      const p = paint(ITEM_ICONS[id]);
      for (let i = 3; i < p.data.length; i += 4) {
        expect([0, 255].includes(p.data[i]), `${id} alpha ${p.data[i]}`).toBe(true);
      }
    }
  });

  it('is one 4-connected silhouette with no floating pixels', () => {
    for (const id of TOOL_IDS) {
      const mask = maskOf(id);
      let opaque = 0;
      let first = -1;
      for (let i = 0; i < mask.length; i++) {
        if (mask[i] === 0) continue;
        opaque++;
        if (first < 0) first = i;
      }
      expect(opaque, id).toBeGreaterThan(140);
      expect(floodFillOpaque(mask, first), `${id} disconnected pixels`).toBe(opaque);
    }
  });

  it('has no enclosed transparent holes so the extruded sides stay solid', () => {
    for (const id of TOOL_IDS) {
      const mask = maskOf(id);
      const reachable = new Uint8Array(mask.length);
      const stack: number[] = [];
      for (let x = 0; x < TILE_SIZE; x++) {
        stack.push(x, (TILE_SIZE - 1) * TILE_SIZE + x);
      }
      for (let y = 0; y < TILE_SIZE; y++) {
        stack.push(y * TILE_SIZE, y * TILE_SIZE + TILE_SIZE - 1);
      }
      while (stack.length > 0) {
        const index = stack.pop() as number;
        if (reachable[index] || mask[index] === 1) continue;
        reachable[index] = 1;
        const x = index % TILE_SIZE;
        const y = Math.floor(index / TILE_SIZE);
        if (x > 0) stack.push(index - 1);
        if (x < TILE_SIZE - 1) stack.push(index + 1);
        if (y > 0) stack.push(index - TILE_SIZE);
        if (y < TILE_SIZE - 1) stack.push(index + TILE_SIZE);
      }
      let holes = 0;
      for (let i = 0; i < mask.length; i++) if (mask[i] === 0 && reachable[i] === 0) holes++;
      expect(holes, `${id} enclosed transparent holes`).toBe(0);
    }
  });

  it('pickaxe head is wide and flat instead of a sickle crescent', () => {
    for (const id of TOOL_IDS.filter((tool) => tool.endsWith('_pickaxe'))) {
      const p = paint(ITEM_ICONS[id]);
      let minX = TILE_SIZE;
      let maxX = -1;
      let minY = TILE_SIZE;
      const topByColumn: number[] = new Array(TILE_SIZE).fill(TILE_SIZE);
      for (let y = 0; y < TILE_SIZE; y++) {
        for (let x = 0; x < TILE_SIZE; x++) {
          if (p.get(x, y)[3] === 0) continue;
          minX = Math.min(minX, x);
          maxX = Math.max(maxX, x);
          minY = Math.min(minY, y);
          topByColumn[x] = Math.min(topByColumn[x], y);
        }
      }
      expect(maxX - minX + 1, `${id} width`).toBeGreaterThanOrEqual(20);
      const centreX = Math.round((minX + maxX) / 2);
      const centreTop = topByColumn[centreX];
      const edgeTop = Math.max(topByColumn[minX + 3], topByColumn[maxX - 3]);
      // the arc rises towards the middle (>=2 px) but stays shallow (<=6 px)
      expect(centreTop, `${id} flat arc`).toBeLessThanOrEqual(minY + 6);
      expect(edgeTop - centreTop, `${id} shallow arc`).toBeGreaterThanOrEqual(2);
      expect(edgeTop - centreTop, `${id} shallow arc`).toBeLessThanOrEqual(6);
      // widest head row is wide enough to read as a pick, not a hook
      let widestTopRow = 0;
      for (let y = minY; y < minY + 6; y++) {
        let width = 0;
        for (let x = 0; x < TILE_SIZE; x++) if (p.get(x, y)[3] > 0) width++;
        widestTopRow = Math.max(widestTopRow, width);
      }
      expect(widestTopRow, `${id} head width`).toBeGreaterThanOrEqual(16);
      // T-bar must be thick enough to survive a 2-3 px extrusion side; the tips
      // stay thin so the silhouette reads as a pick with two points.
      const columnThickness = (x: number): number => {
        let run = 0;
        for (let y = minY; y < minY + 10; y++) if (p.get(x, y)[3] > 0) run++;
        return run;
      };
      expect(columnThickness(centreX), `${id} head thickness`).toBeGreaterThanOrEqual(5);
      const tipThickness = Math.max(columnThickness(minX + 1), columnThickness(maxX - 1));
      expect(tipThickness, `${id} thin tips`).toBeGreaterThanOrEqual(2);
      expect(tipThickness, `${id} thin tips`).toBeLessThanOrEqual(6);
      // the T-bar centre is clearly thicker than the pointed ends
      expect(columnThickness(centreX) - tipThickness, `${id} T-bar`).toBeGreaterThanOrEqual(2);
    }
  });

  it('axe, shovel and sword keep clear distinctive silhouettes', () => {
    for (const id of TOOL_IDS) {
      const p = paint(ITEM_ICONS[id]);
      const opaqueIn = (x0: number, y0: number, x1: number, y1: number): number => {
        let count = 0;
        for (let y = y0; y <= y1; y++) {
          for (let x = x0; x <= x1; x++) if (p.get(x, y)[3] > 0) count++;
        }
        return count;
      };
      if (id.endsWith('_axe')) {
        // tall cuttine edge on the right
        expect(opaqueIn(22, 4, 31, 16), `${id} cutting edge`).toBeGreaterThanOrEqual(10);
      } else if (id.endsWith('_shovel')) {
        // wide spade blade, narrow neck
        expect(opaqueIn(13, 4, 26, 8), `${id} wide blade`).toBeGreaterThanOrEqual(14);
      } else if (id.endsWith('_sword')) {
        // long blade to the top-right, guard and pommel at the lower-left
        expect(opaqueIn(22, 3, 31, 14), `${id} blade tip`).toBeGreaterThanOrEqual(8);
        expect(opaqueIn(6, 16, 21, 29), `${id} guard/grip`).toBeGreaterThanOrEqual(14);
      }
    }
  });
});

describe('item icons: helpers', () => {
  it('paintItemIcon reports unknown ids and clears the buffer', () => {
    const p = new PixelPainter(TILE_SIZE, TILE_SIZE);
    p.fill('#ff00ff');
    expect(paintItemIcon('not_an_item', p)).toBe(false);
    expect(p.get(0, 0)[3]).toBe(0);
    expect(paintItemIcon('stick', p)).toBe(true);
  });

  it('createItemIcon returns a buffer or null', () => {
    const buffer = createItemIcon('diamond_pickaxe');
    expect(buffer).not.toBeNull();
    expect(buffer?.width).toBe(TILE_SIZE);
    expect(createItemIcon('not_an_item')).toBeNull();
  });
});
