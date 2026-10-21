import { describe, expect, it } from 'vitest';
import { EntityManager, type EntityFeedback, type PlayerHurtEvent } from '../../src/entities/manager';
import type { Mob } from '../../src/entities/mob';
import { makeFlatWorld, makePlayer } from './helpers';

function makeManager(feedback: EntityFeedback = {}): EntityManager {
  return new EntityManager({
    difficulty: 'normal',
    random: () => 0.5,
    feedback,
    spawnEnabled: false,
    seed: 'mob-tests',
  });
}

function run(manager: EntityManager, world: ReturnType<typeof makeFlatWorld>, player: ReturnType<typeof makePlayer> | null, ticks: number): void {
  for (let i = 0; i < ticks; i++) manager.update(i + 1, world, player, 1);
}

describe('Mob AI state machine', () => {
  it('chases a nearby survival player', () => {
    const world = makeFlatWorld();
    const manager = makeManager();
    const mob = manager.spawn('zombie', 0.5, 10, 0.5);
    const player = makePlayer(6.5, 10, 0.5);
    run(manager, world, player, 20);
    expect(['chase', 'attack']).toContain(mob.state);
    expect(mob.position.x).toBeGreaterThan(1.5);
  });

  it('hits the player in melee and reports difficulty-scaled damage', () => {
    const hurts: PlayerHurtEvent[] = [];
    const manager = makeManager({ onPlayerHurt: (event) => hurts.push(event) });
    const world = makeFlatWorld();
    const mob = manager.spawn('zombie', 1.2, 10, 0.5);
    const player = makePlayer(0.5, 10, 0.5);
    run(manager, world, player, 2);
    expect(hurts.length).toBeGreaterThan(0);
    expect(hurts[0].damage).toBe(3);
    expect(hurts[0].sourceType).toBe('zombie');
    expect(hurts[0].cause).toBe('melee');
    expect(hurts[0].knockback.x).toBeLessThan(0); // pushed away from the mob
    expect(mob.attackCooldown).toBeGreaterThan(0);
  });

  it('enters hurt then returns to chase after invincibility ends', () => {
    const manager = makeManager();
    const world = makeFlatWorld();
    const mob = manager.spawn('zombie', 6.5, 10, 0.5);
    const player = makePlayer(0.5, 10, 0.5);
    run(manager, world, player, 2);
    expect(['chase', 'attack']).toContain(mob.state);
    manager.attackEntity(mob, 1, player.position, 2);
    run(manager, world, player, 1);
    expect(mob.state).toBe('hurt');
    run(manager, world, player, 12);
    expect(['chase', 'attack']).toContain(mob.state);
    expect(mob.health).toBeLessThan(20);
  });

  it('passive mobs flee when hurt and stay away from the attacker', () => {
    const manager = makeManager();
    const world = makeFlatWorld();
    const pig = manager.spawn('pig', 0.5, 10, 0.5);
    const player = makePlayer(30.5, 10, 0.5);
    manager.attackEntity(pig, 2, { x: -2, y: 10, z: 0.5 }, 3);
    run(manager, world, player, 1);
    expect(pig.state).toBe('flee');
    run(manager, world, player, 25);
    expect(pig.position.x).toBeGreaterThan(1.5);
    expect(pig.health).toBeLessThan(10);
  });

  it('passive mobs idle and then wander when there is no target', () => {
    const manager = makeManager();
    const world = makeFlatWorld();
    const pig = manager.spawn('pig', 0.5, 10, 0.5);
    expect(pig.state).toBe('idle');
    run(manager, world, null, 25);
    expect(['idle', 'wander']).toContain(pig.state);
  });

  it('primes the creeper fuse and explodes at the end', () => {
    let explosions = 0;
    const hurts: PlayerHurtEvent[] = [];
    let primed = 0;
    const manager = makeManager({
      onExplosion: () => {
        explosions++;
      },
      onPlayerHurt: (event) => hurts.push(event),
    });
    const world = makeFlatWorld();
    const creeper = manager.spawn('creeper', 2.0, 10, 0.5);
    const player = makePlayer(0.5, 10, 0.5);

    // Run until the fuse has been primed (it needs a few ticks of LOS).
    for (let i = 0; i < 35 && creeper.fuse === 0; i++) {
      manager.update(i + 1, world, player, 1);
      if (creeper.fuse > 0) primed++;
    }
    expect(creeper.fuse).toBeGreaterThan(0);
    expect(primed).toBe(1);

    for (let i = 0; i < 60 && explosions === 0; i++) manager.update(100 + i, world, player, 1);
    expect(explosions).toBe(1);
    expect(creeper.isDead || creeper.removed).toBe(true);
    expect(manager.mobs).toHaveLength(0);
    expect(world.lastBlockCause).toBe('explosion');
    expect(hurts.some((hurt) => hurt.cause === 'explosion')).toBe(true);
    expect(world.setBlockCalls.length).toBeGreaterThan(0);
  });

  it('skeleton keeps distance and fires arrows at the player', () => {
    const hurts: PlayerHurtEvent[] = [];
    const manager = makeManager({ onPlayerHurt: (event) => hurts.push(event) });
    const world = makeFlatWorld();
    manager.spawn('skeleton', 8.5, 10, 0.5);
    const player = makePlayer(0.5, 10, 0.5);
    run(manager, world, player, 2);
    expect(manager.arrows.length).toBeGreaterThan(0);
    const arrow = manager.arrows[0];
    expect(arrow.baseDamage).toBeGreaterThanOrEqual(2);
    expect(arrow.baseDamage).toBeLessThanOrEqual(4);
    // Flying arrows may connect with the player within a few ticks.
    run(manager, world, player, 20);
    expect(hurts.every((hurt) => hurt.cause === 'arrow' || hurt.cause === 'melee')).toBe(true);
  });

  it('zombies burn in daylight and take fire damage', () => {
    const world = makeFlatWorld({ daytime: true });
    const manager = makeManager();
    const zombie = manager.spawn('zombie', 0.5, 10, 0.5);
    const player = makePlayer(40.5, 10, 0.5);
    run(manager, world, player, 80);
    expect(zombie.fireTicks).toBeGreaterThan(0);
    expect(zombie.health).toBeLessThan(20);
  });

  it('spiders leap when the target is above them', () => {
    const manager = makeManager();
    const world = makeFlatWorld({ daytime: false });
    const spider = manager.spawn('spider', 0.5, 10, 0.5);
    const player = makePlayer(2.5, 13, 0.5);
    // First tick settles the spider onto the ground (AI runs before physics),
    // the second one is allowed to execute the leap.
    manager.update(1, world, player, 1);
    manager.update(2, world, player, 1);
    expect(velocityOrPosition(spider)).toBe(true);
  });

  it('spiders are neutral by day but provoked spiders fight back', () => {
    const world = makeFlatWorld({ daytime: true });
    const manager = makeManager();
    const spider = manager.spawn('spider', 6.5, 10, 0.5);
    const player = makePlayer(0.5, 10, 0.5);
    run(manager, world, player, 10);
    expect(['idle', 'wander']).toContain(spider.state);
    manager.attackEntity(spider, 1, player.position, 2);
    run(manager, world, player, 3);
    expect(['chase', 'attack', 'hurt']).toContain(spider.state);
  });
});

/** Spider leap: either vertical velocity or upward displacement happened. */
function velocityOrPosition(spider: Mob): boolean {
  return spider.velocity.y > 3 || spider.position.y > 10.05;
}
