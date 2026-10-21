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
