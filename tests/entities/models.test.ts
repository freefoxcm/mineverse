import { describe, expect, it } from 'vitest';
import {
  MOB_MODELS,
  MOB_TEXTURE_FALLBACK_COLORS,
  MOB_TEXTURE_NAMES,
  MOB_TYPES,
  HOSTILE_MOBS,
  PASSIVE_MOBS,
  isHostileMob,
  isPassiveMob,
} from '../../src/entities/models';

describe('mob model definitions (Art-E contract)', () => {
  it('defines all eight mobs with sane hitboxes and parts', () => {
    expect(MOB_TYPES).toHaveLength(8);
    expect(MOB_TYPES).toEqual([
      'zombie',
      'skeleton',
      'creeper',
      'spider',
      'pig',
      'cow',
      'sheep',
      'chicken',
    ]);
    for (const type of MOB_TYPES) {
      const model = MOB_MODELS[type];
      expect(model.type).toBe(type);
      expect(model.parts.length).toBeGreaterThanOrEqual(4);
      expect(model.width).toBeGreaterThan(0);
      expect(model.height).toBeGreaterThan(0);
      expect(model.eyeHeight).toBeGreaterThan(0);
      expect(model.eyeHeight).toBeLessThanOrEqual(model.height);
      const names = new Set<string>();
      for (const part of model.parts) {
        expect(names.has(part.name)).toBe(false);
        names.add(part.name);
        expect(part.texture.length).toBeGreaterThan(0);
        expect(part.size.every((value) => value > 0)).toBe(true);
        expect(part.pivot.every((value) => Number.isFinite(value))).toBe(true);
        expect(part.offset.every((value) => Number.isFinite(value))).toBe(true);
        if (part.parent) expect(names.has(part.parent)).toBe(true);
        if (part.head) {
          expect(part.frontUv).toBeDefined();
          const [u0, v0, u1, v1] = part.frontUv as readonly [number, number, number, number];
          expect(u0).toBeGreaterThanOrEqual(0);
          expect(v0).toBeGreaterThanOrEqual(0);
          expect(u1).toBeLessThanOrEqual(32);
          expect(v1).toBeLessThanOrEqual(32);
          expect(u1).toBeGreaterThan(u0);
          expect(v1).toBeGreaterThan(v0);
        }
      }
    }
  });

  it('locks the 29 skin texture keys Art-E must paint', () => {
    expect(MOB_TEXTURE_NAMES).toHaveLength(29);
    expect(MOB_TEXTURE_NAMES).toEqual(
      [...MOB_TEXTURE_NAMES].sort(),
    );
    const expected = [
      'chicken_beak',
      'chicken_body',
      'chicken_head',
      'chicken_leg',
      'chicken_wing',
      'cow_body',
      'cow_head',
      'cow_horn',
      'cow_leg',
      'creeper_body',
      'creeper_head',
      'creeper_leg',
      'pig_body',
      'pig_head',
      'pig_leg',
      'sheep_head',
      'sheep_leg',
      'sheep_wool',
      'skeleton_arm',
      'skeleton_body',
      'skeleton_head',
      'skeleton_leg',
      'spider_body',
      'spider_head',
      'spider_leg',
      'zombie_arm',
      'zombie_body',
      'zombie_head',
      'zombie_leg',
    ];
    expect([...MOB_TEXTURE_NAMES]).toEqual(expected);
    for (const name of MOB_TEXTURE_NAMES) {
      expect(MOB_TEXTURE_FALLBACK_COLORS[name]).toBeTypeOf('number');
    }
  });

  it('splits hostile and passive mobs without overlap', () => {
    expect(HOSTILE_MOBS).toHaveLength(4);
    expect(PASSIVE_MOBS).toHaveLength(4);
    for (const type of MOB_TYPES) {
      expect(isHostileMob(type) !== isPassiveMob(type)).toBe(true);
    }
    expect(isHostileMob('zombie')).toBe(true);
    expect(isHostileMob('pig')).toBe(false);
    expect(isPassiveMob('chicken')).toBe(true);
  });

  it('head parts point forward with a face region', () => {
    for (const type of MOB_TYPES) {
      const head = MOB_MODELS[type].parts.find((part) => part.head);
      expect(head, `${type} should have a head part`).toBeDefined();
      expect(head?.frontUv).toEqual([0, 0, 16, 16]);
    }
  });
});
