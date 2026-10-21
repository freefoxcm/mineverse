import { describe, expect, it } from 'vitest';
import {
  CREEPER_EXPLOSION_POWER,
  TNT_EXPLOSION_POWER,
  explode,
} from '../../src/entities/explosion';
import { Mob } from '../../src/entities/mob';
import { TEST_BLOCKS, countNonAir, makeFlatWorld } from './helpers';

const CENTER = { x: 0.5, y: 10.5, z: 0.5 };

describe('explosions', () => {
  it('breaks soft blocks inside the radius and reports them', () => {
    const world = makeFlatWorld();
    const broken: Array<{ x: number; y: number; z: number; id: number }> = [];
    const before = countNonAir(world, -6, 0, -6, 6, 10, 6);
    const result = explode(world, CENTER, CREEPER_EXPLOSION_POWER, {
      onBlockBreak: (x, y, z, id) => broken.push({ x, y, z, id }),
    });
    expect(result.power).toBe(3);
    expect(result.radius).toBe(4.5);
    expect(result.blocksBroken).toBeGreaterThan(0);
    expect(broken).toHaveLength(result.blocksBroken);
    expect(result.brokenBlocks).toHaveLength(result.blocksBroken);
    expect(world.getBlock(0, 9, 0)).toBe(TEST_BLOCKS.air);
    expect(countNonAir(world, -6, 0, -6, 6, 10, 6)).toBeLessThan(before);
    expect(world.lastBlockCause).toBe('explosion');
  });

  it('respects blast resistance and never removes fluids or bedrock', () => {
    const world = makeFlatWorld();
    world.set(1, 9, 1, TEST_BLOCKS.obsidian);
    world.set(-1, 9, -1, TEST_BLOCKS.bedrock);
    world.set(2, 10, 2, TEST_BLOCKS.water);
    explode(world, CENTER, CREEPER_EXPLOSION_POWER);
    expect(world.getBlock(1, 9, 1)).toBe(TEST_BLOCKS.obsidian);
    expect(world.getBlock(-1, 9, -1)).toBe(TEST_BLOCKS.bedrock);
    expect(world.getBlock(2, 10, 2)).toBe(TEST_BLOCKS.water);
  });

  it('damages entities with distance falloff and radial knockback', () => {
    const world = makeFlatWorld();
    const near = new Mob('zombie', 0.5, 10, 0.5);
    const far = new Mob('zombie', 4.5, 10, 0.5);
    const result = explode(world, CENTER, CREEPER_EXPLOSION_POWER, {
      targets: [near, far],
    });
    expect(result.entityHits).toHaveLength(2);
    const nearHit = result.entityHits.find((hit) => hit.entity === near);
    const farHit = result.entityHits.find((hit) => hit.entity === far);
    expect(nearHit).toBeDefined();
    expect(farHit).toBeDefined();
    expect(nearHit!.damage).toBeGreaterThan(farHit!.damage);
    expect(nearHit!.damage).toBeGreaterThan(0);
    expect(near.health).toBeLessThan(20);
    expect(far.health).toBeLessThan(20);
    // Knockback pushes entities away from the blast centre (+X direction).
    expect(far.velocity.x).toBeGreaterThan(0);
  });

  it('does not damage entities outside the blast radius', () => {
    const world = makeFlatWorld();
    const outOfRange = new Mob('zombie', 20.5, 10, 0.5);
    const result = explode(world, CENTER, CREEPER_EXPLOSION_POWER, {
      targets: [outOfRange],
    });
    expect(result.entityHits).toHaveLength(0);
    expect(outOfRange.health).toBe(20);
  });

  it('can skip block damage for tests/creative', () => {
    const world = makeFlatWorld();
    const mob = new Mob('pig', 1.5, 10, 0.5);
    const before = countNonAir(world, -6, 0, -6, 6, 10, 6);
    const result = explode(world, CENTER, CREEPER_EXPLOSION_POWER, {
      blockDamage: false,
      targets: [mob],
    });
    expect(result.blocksBroken).toBe(0);
    expect(world.setBlockCalls).toHaveLength(0);
    expect(countNonAir(world, -6, 0, -6, 6, 10, 6)).toBe(before);
    expect(result.entityHits).toHaveLength(1);
  });

  it('scales damage through the multiplier and exposes TNT power 4', () => {
    const world = makeFlatWorld();
    const weak = new Mob('zombie', 1.5, 10, 0.5);
    const strong = new Mob('zombie', 1.5, 10, 2.5);
    explode(world, CENTER, 3, { targets: [weak], damageMultiplier: 0.5, blockDamage: false });
    explode(world, { x: 0.5, y: 10.5, z: 2.5 }, 3, {
      targets: [strong],
      damageMultiplier: 2,
      blockDamage: false,
    });
    expect(20 - weak.health).toBeLessThan(20 - strong.health);
    expect(TNT_EXPLOSION_POWER).toBe(4);
  });

  it('emits explosion particles and sound through callbacks', () => {
    const world = makeFlatWorld();
    const particles: string[] = [];
    const sounds: string[] = [];
    explode(world, CENTER, 3, {
      blockDamage: false,
      onParticles: (kind) => particles.push(kind),
      onSound: (name) => sounds.push(name),
      source: 'creeper',
    });
    expect(particles).toContain('explosion');
    expect(sounds).toContain('explosion.creeper');
  });
});
