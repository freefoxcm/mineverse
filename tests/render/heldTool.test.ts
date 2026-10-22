import { describe, expect, it } from 'vitest';
import { buildHeldToolModel } from '../../src/render/heldTool';

describe('true 3D held tool models', () => {
  it('builds volumetric pickaxe/axe/shovel/sword models for all five tiers', () => {
    const ids = ['wooden', 'stone', 'iron', 'golden', 'diamond'].flatMap((tier) =>
      ['pickaxe', 'axe', 'shovel', 'sword'].map((kind) => `${tier}_${kind}`),
    );
    for (const id of ids) {
      const model = buildHeldToolModel(id);
      expect(model, id).not.toBeNull();
      expect(model!.geometry.getAttribute('position').count, id).toBeGreaterThan(100);
      expect(model!.geometry.getAttribute('color').count, id).toBeGreaterThan(100);
      model!.geometry.dispose();
    }
  });

  it('keeps the handle/grip near the origin and the head above it', () => {
    const pickaxe = buildHeldToolModel('diamond_pickaxe')!;
    pickaxe.geometry.computeBoundingBox();
    const box = pickaxe.geometry.boundingBox!;
    expect(box.min.y).toBeLessThan(0);
    expect(box.max.y).toBeGreaterThan(0.5);
    expect(box.max.x - box.min.x).toBeGreaterThan(0.3);
    expect(box.max.z - box.min.z).toBeGreaterThan(0.05);
    pickaxe.geometry.dispose();

    const sword = buildHeldToolModel('iron_sword')!;
    sword.geometry.computeBoundingBox();
    const swordBox = sword.geometry.boundingBox!;
    expect(swordBox.max.y).toBeGreaterThan(0.6);
    expect(swordBox.max.x - swordBox.min.x).toBeGreaterThan(0.2);
    sword.geometry.dispose();
  });

  it('returns null for non-tool items', () => {
    expect(buildHeldToolModel('apple')).toBeNull();
    expect(buildHeldToolModel('oak_planks')).toBeNull();
    expect(buildHeldToolModel('__not_an_item__')).toBeNull();
  });
});
