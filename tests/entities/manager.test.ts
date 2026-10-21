import { describe, expect, it } from 'vitest';
import type { Slot } from '../../src/core/types';
import { ITEM_LIFETIME_TICKS } from '../../src/entities/itemEntity';
import {
  EntityManager,
  type EntityFeedback,
  type PlayerHurtEvent,
} from '../../src/entities/manager';
import { TEST_BLOCKS, makeFlatWorld, makePlayer } from './helpers';

function makeManager(feedback: EntityFeedback = {}, randomValue = 0.5): EntityManager {
  return new EntityManager({
    seed: 'manager-tests',
    random: () => randomValue,
    difficulty: 'normal',
    spawnEnabled: false,
    feedback,
  });
}

describe('EntityManager', () => {
  it('spawns mobs and exposes renderer snapshots', () => {
    const world = makeFlatWorld();
    const manager = makeManager();
    const mob = manager.spawn('zombie', 2.5, 10, 0.5);
    manager.spawnItem('bone', 2, { x: 1.5, y: 10, z: 1.5 }, { velocity: { x: 0, y: 0, z: 0 } });
    manager.update(1, world, null, 1);
    const snapshots = manager.snapshots();
    expect(snapshots).toHaveLength(2);
    const mobSnapshot = snapshots.find((snapshot) => snapshot.id === mob.id);
    expect(mobSnapshot).toBeDefined();
    expect(mobSnapshot!.kind).toBe('mob');
    expect(mobSnapshot!.type).toBe('zombie');
    expect(mobSnapshot!.health).toBe(20);
    expect(mobSnapshot!.maxHealth).toBe(20);
    expect(mobSnapshot!.shadowY).toBe(10);
    expect(mobSnapshot!.deathTime).toBe(-1);
    const itemSnapshot = snapshots.find((snapshot) => snapshot.kind === 'item');
    expect(itemSnapshot!.item).toEqual({ item: 'bone', count: 2 });
  });

  it('ray-casts entities and applies player attacks', () => {
    const world = makeFlatWorld();
    const hits: PlayerHurtEvent[] = [];
    const manager = makeManager({ onPlayerHurt: (event) => hits.push(event) });
    const mob = manager.spawn('zombie', 3.5, 10, 0.5);
    const player = makePlayer(0.5, 10, 0.5);
    manager.update(1, world, player, 1);
    const eye = { x: 0.5, y: 11.62, z: 0.5 };
    const hit = manager.raycastEntities(eye, { x: 1, y: 0, z: 0 }, 5);
    expect(hit).not.toBeNull();
    expect(hit!.entity).toBe(mob);
    const result = manager.playerAttack(eye, { x: 1, y: 0, z: 0 }, 5, 6, 4);
    expect(result).not.toBeNull();
    expect(result!.entityId).toBe(mob.id);
    expect(result!.damageDealt).toBe(6);
    expect(result!.healthBefore).toBe(20);
    expect(result!.healthAfter).toBe(14);
    expect(result!.killed).toBe(false);
    expect(mob.health).toBe(14);
  });

  it('misses when no mob is in reach', () => {
    const world = makeFlatWorld();
    const manager = makeManager();
    manager.spawn('zombie', 3.5, 10, 0.5);
    const player = makePlayer(0.5, 10, 0.5);
    manager.update(1, world, player, 1);
    expect(manager.playerAttack({ x: 0.5, y: 11.62, z: 0.5 }, { x: 0, y: 0, z: 1 }, 5, 6)).toBeNull();
    expect(manager.playerAttack({ x: 0.5, y: 11.62, z: 0.5 }, { x: 1, y: 0, z: 0 }, 1, 6)).toBeNull();
  });

  it('collects items with the Lead pickup callback (partial accept)', () => {
    const world = makeFlatWorld();
    const calls: Slot[] = [];
    let callCount = 0;
    const manager = makeManager({
      onItemPickup: (slot) => {
        calls.push(slot);
        callCount++;
        return callCount === 1 ? 2 : 0;
      },
    });
    manager.spawnItem('dirt', 5, { x: 0.5, y: 10, z: 0.5 }, { velocity: { x: 0, y: 0, z: 0 } });
    const player = makePlayer(0.5, 10, 0.5);
    for (let i = 0; i < 15; i++) manager.update(i + 1, world, player, 1);
    expect(calls.length).toBeGreaterThan(0);
    expect(calls[0]).toEqual({ item: 'dirt', count: 5 });
    expect(manager.items).toHaveLength(1);
    expect(manager.items[0].count).toBe(3);
  });

  it('leaves items when the inventory is full', () => {
    const world = makeFlatWorld();
    const manager = makeManager({ onItemPickup: () => 0 });
    manager.spawnItem('dirt', 5, { x: 0.5, y: 10, z: 0.5 }, { velocity: { x: 0, y: 0, z: 0 } });
    const player = makePlayer(0.5, 10, 0.5);
    for (let i = 0; i < 15; i++) manager.update(i + 1, world, player, 1);
    expect(manager.items).toHaveLength(1);
    expect(manager.items[0].count).toBe(5);
  });

  it('removes dropped items after five minutes', () => {
    const world = makeFlatWorld();
    const manager = makeManager();
    manager.spawnItem('bone', 1, { x: 0.5, y: 10, z: 0.5 }, { velocity: { x: 0, y: 0, z: 0 } });
    expect(manager.items[0].despawnTicksLeft).toBe(ITEM_LIFETIME_TICKS);
    manager.items[0].age = ITEM_LIFETIME_TICKS - 1;
    manager.update(1, world, null, 1);
    expect(manager.items).toHaveLength(0);
  });

  it('despawns mobs beyond the 128m radius', () => {
    const world = makeFlatWorld({ halfSize: 8 });
    const manager = makeManager();
    manager.spawn('zombie', 200.5, 10, 0.5);
    const player = makePlayer(0.5, 10, 0.5);
    manager.update(1, world, player, 1);
    expect(manager.mobs).toHaveLength(0);
  });

  it('drops deterministic loot when a mob dies', () => {
    const world = makeFlatWorld();
    const manager = makeManager({}, 0.99);
    manager.update(1, world, null, 1);
    const zombie = manager.spawn('zombie', 0.5, 10, 0.5);
    const result = manager.attackEntity(zombie, 100, makePlayer(2.5, 10, 0.5).position, 2);
    expect(result.killed).toBe(true);
    expect(manager.items).toHaveLength(1);
    expect(manager.items[0].item).toBe('rotten_flesh');
    expect(manager.items[0].count).toBe(2);
  });

  it('sticks arrows into blocks', () => {
    const world = makeFlatWorld();
    world.fill(3, 10, -2, 3, 11, 2, TEST_BLOCKS.stone);
    const manager = makeManager();
    manager.update(1, world, null, 1);
    manager.spawnArrow({ x: 0.5, y: 10.6, z: 0.5 }, { x: 1, y: 0, z: 0 }, { speed: 40, damage: 3 });
    for (let i = 0; i < 20; i++) manager.update(i + 2, world, null, 1);
    const arrow = manager.arrows[0];
    expect(arrow).toBeDefined();
    expect(arrow.stuck).toBe(true);
    expect(arrow.blockHit?.x).toBe(3);
  });

  it('arrow hits damage mobs', () => {
    const world = makeFlatWorld();
    const manager = makeManager();
    manager.update(1, world, null, 1);
    const pig = manager.spawn('pig', 3.0, 10, 0.5);
    manager.spawnArrow({ x: 0.5, y: 10.7, z: 0.5 }, { x: 1, y: 0, z: 0 }, { speed: 40, damage: 3 });
    for (let i = 0; i < 10; i++) manager.update(i + 2, world, null, 1);
    expect(pig.health).toBeLessThan(10);
  });

  it('explodes through the manager with block-break and player-hurt callbacks', () => {
    const world = makeFlatWorld();
    const blockBreaks: number[] = [];
    const hurts: PlayerHurtEvent[] = [];
    let explosionResult: { power: number } | null = null;
    const manager = makeManager({
      onBlockBreak: (x, y, z) => blockBreaks.push(x + y + z),
      onPlayerHurt: (event) => hurts.push(event),
      onExplosion: (result) => {
        explosionResult = result;
      },
    });
    const player = makePlayer(0.5, 10, 0.5);
    manager.update(1, world, player, 1);
    const result = manager.explodeAt({ x: 0.5, y: 10.5, z: 0.5 }, 3, 'tnt');
    expect(result.blocksBroken).toBeGreaterThan(0);
    expect(blockBreaks.length).toBe(result.blocksBroken);
    expect(explosionResult).not.toBeNull();
    expect(world.lastBlockCause).toBe('explosion');
    expect(hurts.some((hurt) => hurt.cause === 'explosion')).toBe(true);
    expect(hurts[0].damage).toBeGreaterThan(5);
  });

  it('removes hostile mobs in peaceful mode but keeps passive animals', () => {
    const world = makeFlatWorld();
    const manager = new EntityManager({
      seed: 'peaceful-test',
      random: () => 0.5,
      difficulty: 'peaceful',
      spawnEnabled: false,
    });
    const zombie = manager.spawn('zombie', 2.5, 10, 0.5);
    const pig = manager.spawn('pig', 3.5, 10, 0.5);
    const player = makePlayer(0.5, 10, 0.5);
    manager.update(1, world, player, 1);
    expect(zombie.removed).toBe(true);
    expect(pig.removed).toBe(false);
  });

  it('exposes counts and can be cleared', () => {
    const manager = makeManager();
    manager.spawn('zombie', 0.5, 10, 0.5);
    manager.spawn('pig', 1.5, 10, 0.5);
    manager.spawnItem('bone', 1, { x: 0.5, y: 10, z: 0.5 });
    expect(manager.entityCount).toBe(3);
    expect(manager.hostileCount).toBe(1);
    expect(manager.passiveCount).toBe(1);
    expect(manager.items).toHaveLength(1);
    manager.clear();
    expect(manager.entityCount).toBe(0);
  });
});
