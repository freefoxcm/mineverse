import { beforeEach, describe, expect, it } from 'vitest';
import {
  aabbOverlap,
  boxCollides,
  rayAABB,
  resetEntityIds,
  type AABB,
} from '../../src/entities/entity';
import { ItemEntity } from '../../src/entities/itemEntity';
import { Mob } from '../../src/entities/mob';
import { TEST_BLOCKS, makeFlatWorld } from './helpers';

describe('Entity base: physics, AABB, damage and death', () => {
  beforeEach(() => {
    resetEntityIds();
  });

  it('falls under gravity and lands on the ground', () => {
    const world = makeFlatWorld();
    const mob = new Mob('zombie', 0.5, 15, 0.5);
    for (let i = 0; i < 80; i++) mob.update(1, world);
    expect(mob.onGround).toBe(true);
    expect(mob.position.y).toBeCloseTo(10, 1);
  });

  it('exposes an AABB sized from width/height', () => {
    const mob = new Mob('zombie', 0.5, 10, 0.5);
    const box = mob.aabb();
    expect(box.maxX - box.minX).toBeCloseTo(0.6);
    expect(box.maxZ - box.minZ).toBeCloseTo(0.6);
    expect(box.maxY - box.minY).toBeCloseTo(1.95);
    expect(box.minY).toBe(10);
  });

  it('stops at a wall instead of tunnelling through it', () => {
    const world = makeFlatWorld();
    world.fill(2, 10, -3, 2, 11, 3, TEST_BLOCKS.stone);
    const mob = new Mob('zombie', 0.5, 10, 0.5);
    mob.velocity.x = 20;
    for (let i = 0; i < 30; i++) {
      mob.velocity.x = 20;
      mob.update(1, world);
    }
    expect(mob.position.x).toBeLessThan(2);
    expect(mob.position.x).toBeGreaterThan(1);
  });

  it('auto-steps up a single block ledge', () => {
    const world = makeFlatWorld();
    world.fill(2, 10, -2, 2, 10, 2, TEST_BLOCKS.stone);
    world.fill(2, 10, -2, 6, 10, 2, TEST_BLOCKS.stone);
    const mob = new Mob('zombie', 0.5, 10, 0.5);
    for (let i = 0; i < 20; i++) {
      mob.velocity.x = 4;
      mob.update(1, world);
    }
    expect(mob.position.y).toBeGreaterThan(10.5);
    expect(mob.position.x).toBeGreaterThan(2);
  });

  it('detects water and slows down in it', () => {
    const world = makeFlatWorld();
    world.set(2, 9, 0, TEST_BLOCKS.water);
    const mob = new Mob('zombie', 2.5, 9, 0.5);
    mob.update(1, world);
    expect(mob.inWater).toBe(true);
    expect(mob.inLava).toBe(false);
    const before = mob.velocity.x;
    mob.velocity.x = 4;
    mob.update(1, world);
    expect(mob.velocity.x).toBeLessThan(4);
    expect(before).toBeDefined();
  });

  it('grants invincibility frames after a hit', () => {
    const world = makeFlatWorld();
    const mob = new Mob('pig', 0.5, 10, 0.5);
    expect(mob.health).toBe(10);
    expect(mob.hurt(3, { x: 0, y: 10, z: 0.5 }, 0)).toBe(true);
    expect(mob.health).toBe(7);
    expect(mob.hurtTime).toBe(10);
    expect(mob.hurt(3, { x: 0, y: 10, z: 0.5 }, 0)).toBe(false);
    for (let i = 0; i < 10; i++) mob.update(1, world);
    expect(mob.hurtTime).toBe(0);
    expect(mob.hurt(3, { x: 0, y: 10, z: 0.5 }, 0)).toBe(true);
  });

  it('knocks the entity away from the damage source', () => {
    const mob = new Mob('pig', 5, 10, 0.5);
    mob.hurt(2, { x: 0, y: 10, z: 0.5 }, 4);
    expect(mob.velocity.x).toBeGreaterThan(0);
    expect(Math.abs(mob.velocity.z)).toBeLessThan(0.01);
  });

  it('plays a death animation then gets removed', () => {
    const world = makeFlatWorld();
    const mob = new Mob('pig', 0.5, 10, 0.5);
    let deaths = 0;
    mob.onDeath = () => {
      deaths++;
    };
    mob.health = 1;
    expect(mob.hurt(5, null, 0)).toBe(true);
    expect(mob.isDead).toBe(true);
    expect(deaths).toBe(1);
    expect(mob.hurt(5, null, 0)).toBe(false);
    for (let i = 0; i < 19; i++) mob.update(1, world);
    expect(mob.removed).toBe(false);
    mob.update(1, world);
    expect(mob.removed).toBe(true);
    expect(deaths).toBe(1);
  });

  it('discard() removes an entity immediately without drops', () => {
    const mob = new Mob('zombie', 0.5, 10, 0.5);
    let deaths = 0;
    mob.onDeath = () => {
      deaths++;
    };
    mob.discard();
    expect(mob.removed).toBe(true);
    expect(deaths).toBe(0);
  });

  it('items store their stack and are not pickable during the delay', () => {
    const world = makeFlatWorld();
    const item = new ItemEntity('bone', 3, 0.5, 10.5, 0.5);
    expect(item.item).toBe('bone');
    expect(item.count).toBe(3);
    expect(item.canPickup).toBe(false);
    for (let i = 0; i < 10; i++) item.update(1, world);
    expect(item.canPickup).toBe(true);
    item.age = 5999;
    item.update(1, world);
    expect(item.removed).toBe(true);
  });

  it('provides correct AABB overlap and ray tests', () => {
    const a: AABB = { minX: 0, minY: 0, minZ: 0, maxX: 1, maxY: 1, maxZ: 1 };
    const b: AABB = { minX: 0.5, minY: 0.5, minZ: 0.5, maxX: 2, maxY: 2, maxZ: 2 };
    const c: AABB = { minX: 4, minY: 4, minZ: 4, maxX: 5, maxY: 5, maxZ: 5 };
    expect(aabbOverlap(a, b)).toBe(true);
    expect(aabbOverlap(a, c)).toBe(false);
    const hit = rayAABB({ x: -2, y: 0.5, z: 0.5 }, { x: 1, y: 0, z: 0 }, 10, a);
    expect(hit).toBeCloseTo(2);
    const miss = rayAABB({ x: -2, y: 3, z: 0.5 }, { x: 1, y: 0, z: 0 }, 10, a);
    expect(miss).toBeNull();
    const behind = rayAABB({ x: 3, y: 0.5, z: 0.5 }, { x: 1, y: 0, z: 0 }, 10, a);
    expect(behind).toBeNull();
  });

  it('boxCollides sees solid voxels only', () => {
    const world = makeFlatWorld();
    expect(boxCollides(world, 0, 11, 0, 0.6, 12, 0.6)).toBe(false);
    expect(boxCollides(world, 0, 9, 0, 0.6, 10, 0.6)).toBe(true);
  });
});
