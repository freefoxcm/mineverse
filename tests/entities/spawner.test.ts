import { describe, expect, it } from 'vitest';
import {
  DESPAWN_DISTANCE,
  Spawner,
  canSpawnHostileAt,
  canSpawnPassiveAt,
  difficultySpawnMultiplier,
  effectiveLightLevel,
  findHostileSpawn,
  randomRingPoint,
  type SpawnerContext,
} from '../../src/entities/spawner';
import { Rand } from '../../src/core/rng';
import { TEST_BLOCKS, makeFlatWorld, makePlayer } from './helpers';

function context(
  world: ReturnType<typeof makeFlatWorld>,
  overrides: Partial<SpawnerContext> = {},
): SpawnerContext {
  const rand = new Rand(1234);
  return {
    world,
    playerPosition: makePlayer(0.5, 10, 0.5).position,
    difficulty: 'normal',
    hostileCount: 0,
    passiveCount: 0,
    random: () => rand.next(),
    ...overrides,
  };
}

describe('mob spawner rules', () => {
  it('spawns hostiles on dark solid ground 24-48m away', () => {
    const world = makeFlatWorld({ daytime: false, halfSize: 80 });
    const spawner = new Spawner();
    const plan = spawner.trySpawnHostile(context(world));
    expect(plan).not.toBeNull();
    if (!plan) return;
    expect(plan.position.y).toBe(10);
    const distance = Math.hypot(plan.position.x - 0.5, plan.position.z - 0.5);
    expect(distance).toBeGreaterThanOrEqual(22);
    expect(distance).toBeLessThanOrEqual(50);
    expect(canSpawnHostileAt(world, Math.floor(plan.position.x), plan.position.y, Math.floor(plan.position.z))).toBe(true);
  });

  it('does not spawn hostiles on a lit surface during the day', () => {
    const world = makeFlatWorld({ daytime: true, halfSize: 80 });
    expect(effectiveLightLevel(world, 30, 10, 0)).toBe(15);
    expect(findHostileSpawn(world, 30, 0)).toBeNull();
    const spawner = new Spawner();
    expect(spawner.trySpawnHostile(context(world))).toBeNull();
  });

  it('does not spawn hostiles on peaceful difficulty', () => {
    const world = makeFlatWorld({ daytime: false, halfSize: 80 });
    const spawner = new Spawner();
    const ctx = context(world, { difficulty: 'peaceful' });
    expect(difficultySpawnMultiplier('peaceful')).toBe(0);
    const result = spawner.tick({ ...ctx, difficulty: 'peaceful' });
    expect(result.hostile).toBeNull();
  });

  it('spawns passives on grass with light >= 9', () => {
    const world = makeFlatWorld({ daytime: true, halfSize: 80 });
    const spawner = new Spawner();
    const plan = spawner.trySpawnPassive(context(world));
    expect(plan).not.toBeNull();
    if (!plan) return;
    expect(plan.position.y).toBe(10);
    expect(world.getBlock(Math.floor(plan.position.x), 9, Math.floor(plan.position.z))).toBe(
      TEST_BLOCKS.grass_block,
    );
    expect(canSpawnPassiveAt(world, Math.floor(plan.position.x), plan.position.y, Math.floor(plan.position.z))).toBe(true);
    // At night the same spot is too dark for passive spawns.
    world.setDaytime(false);
    expect(canSpawnPassiveAt(world, Math.floor(plan.position.x), plan.position.y, Math.floor(plan.position.z))).toBe(false);
  });

  it('enforces the hostile/passive caps', () => {
    const night = makeFlatWorld({ daytime: false, halfSize: 80 });
    const day = makeFlatWorld({ daytime: true, halfSize: 80 });
    const spawner = new Spawner();
    expect(spawner.tick(context(night, { hostileCount: 24 })).hostile).toBeNull();
    expect(spawner.tick(context(night, { hostileCount: 0 })).hostile).not.toBeNull();
    expect(spawner.tick(context(day, { passiveCount: 12 })).passive).toBeNull();
    expect(spawner.tick(context(day, { passiveCount: 0 })).passive).not.toBeNull();
  });

  it('applies difficulty spawn multipliers', () => {
    expect(difficultySpawnMultiplier('peaceful')).toBe(0);
    expect(difficultySpawnMultiplier('easy')).toBe(0.5);
    expect(difficultySpawnMultiplier('normal')).toBe(1);
    expect(difficultySpawnMultiplier('hard')).toBe(1.5);
  });

  it('despawns mobs beyond 128m and hostile mobs on peaceful', () => {
    const spawner = new Spawner();
    const player = { x: 0.5, y: 10, z: 0.5 };
    expect(spawner.shouldDespawn('zombie', { x: 200, y: 10, z: 0.5 }, player, 'normal')).toBe(true);
    expect(spawner.shouldDespawn('zombie', { x: 50, y: 10, z: 0.5 }, player, 'normal')).toBe(false);
    expect(spawner.shouldDespawn('zombie', { x: 5, y: 10, z: 0.5 }, player, 'peaceful')).toBe(true);
    expect(spawner.shouldDespawn('pig', { x: 5, y: 10, z: 0.5 }, player, 'peaceful')).toBe(false);
    expect(DESPAWN_DISTANCE).toBe(128);
  });

  it('computes effective light from sky/block light and daylight', () => {
    const world = makeFlatWorld({ daytime: true });
    world.setSkyLight(2, 10, 2, 15);
    expect(effectiveLightLevel(world, 2, 10, 2)).toBe(15);
    world.setDaytime(false);
    expect(effectiveLightLevel(world, 2, 10, 2)).toBeLessThanOrEqual(2);
    world.setBlockLight(2, 10, 2, 8);
    expect(effectiveLightLevel(world, 2, 10, 2)).toBe(8);
    world.setBlockLight(2, 10, 2, 0);
    world.setSkyLight(2, 10, 2, 0);
    expect(effectiveLightLevel(world, 2, 10, 2)).toBe(0);
  });

  it('randomRingPoint stays inside the spawn ring', () => {
    const rand = new Rand(99);
    for (let i = 0; i < 40; i++) {
      const point = randomRingPoint(() => rand.next(), { x: 0, y: 10, z: 0 }, 24, 48);
      const distance = Math.hypot(point.x, point.z);
      expect(distance).toBeGreaterThanOrEqual(22);
      expect(distance).toBeLessThanOrEqual(50);
    }
  });
});
