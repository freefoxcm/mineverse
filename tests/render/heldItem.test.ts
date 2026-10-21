import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import {
  HeldItemGeometryCache,
  buildExtrudedItemGeometry,
  heldCategory,
  gripForItem,
} from '../../src/render/heldItem';
import { BLOCK, getBlockDef } from '../../src/world/blocks';
import { buildBlockGeometry } from '../../src/render/firstPerson';

function bounds(geometry: THREE.BufferGeometry): THREE.Box3 {
  geometry.computeBoundingBox();
  return geometry.boundingBox ?? new THREE.Box3();
}

describe('extruded held-item geometry', () => {
  it('builds a thin 3D slab from the tool icon alpha mask', () => {
    const pickaxe = buildExtrudedItemGeometry('iron_pickaxe', 0);
    expect(pickaxe).not.toBeNull();
    expect(pickaxe!.triangles).toBeGreaterThan(30);
    const box = bounds(pickaxe!.geometry);
    // Front/back slab plus side walls: clearly thicker than a flat quad in z.
    expect(box.max.z - box.min.z).toBeCloseTo(2 / 32, 5);
    expect(box.max.x - box.min.x).toBeGreaterThan(0.5);
    expect(box.max.y - box.min.y).toBeGreaterThan(0.5);
    pickaxe!.geometry.dispose();
  });

  it('extrudes swords and small food icons too, with a sane grip point', () => {
    for (const id of ['diamond_sword', 'apple', 'stick']) {
      const model = buildExtrudedItemGeometry(id, 0);
      expect(model, id).not.toBeNull();
      expect(model!.triangles).toBeGreaterThan(10);
      expect(Number.isFinite(model!.grip[0])).toBe(true);
      expect(Number.isFinite(model!.grip[1])).toBe(true);
      model!.geometry.dispose();
    }
    expect(heldCategory('iron_pickaxe')).toBe('tool');
    expect(heldCategory('diamond_sword')).toBe('weapon');
    expect(heldCategory('apple')).toBe('food');
    expect(heldCategory('oak_planks')).toBe('block');
    expect(gripForItem('iron_pickaxe')[1]).toBeLessThan(0);
  });

  it('returns null for characters without item icons', () => {
    expect(buildExtrudedItemGeometry('__not_an_item__', 0)).toBeNull();
  });

  it('caches geometries and disposes them together', () => {
    const cache = new HeldItemGeometryCache();
    const first = cache.get('iron_pickaxe', 0);
    const second = cache.get('iron_pickaxe', 0);
    expect(first).toBe(second);
    expect(cache.size).toBe(1);
    const count = first!.geometry.getAttribute('position').count;
    cache.dispose();
    expect(cache.size).toBe(0);
    expect(count).toBeGreaterThan(8);
  });

  it('gives held block faces distinct brightness', () => {
    const stone = getBlockDef(BLOCK.stone);
    const result = buildBlockGeometry(stone, () => 0);
    const tint = result.geometry.getAttribute('aTint') as THREE.BufferAttribute;
    const faceTints: number[] = [];
    for (let face = 0; face < 6; face++) faceTints.push(tint.getX(face * 4));
    expect(new Set(faceTints.map((value) => value.toFixed(3))).size).toBeGreaterThan(3);
    // Top is the brightest, bottom the darkest, like the world's face shading.
    const top = faceTints[2];
    const bottom = faceTints[3];
    expect(top).toBeGreaterThan(bottom);
    result.geometry.dispose();
  });
});
