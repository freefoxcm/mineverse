import { describe, expect, it } from 'vitest';
import {
  CREEPER_FUSE_TICKS,
  angleDifference,
  canSee,
  decideMobState,
  hasLineOfSight,
  isDaytime,
  isExposedToDaylight,
  isHostileAt,
  pickFleeTarget,
  pickWanderTarget,
  shouldBurnInDaylight,
  skeletonArrowDamage,
  turnTowards,
  yawOf,
  type MobDecisionInput,
} from '../../src/entities/ai';
import { Rand } from '../../src/core/rng';
import { TEST_BLOCKS, makeFlatWorld } from './helpers';

function decision(overrides: Partial<MobDecisionInput> = {}): MobDecisionInput {
  return {
    type: 'zombie',
    health: 20,
    hurtTime: 0,
    state: 'wander',
    target: {
      distance: 8,
      horizontalDistance: 8,
      visible: true,
      alive: true,
      targetable: true,
    },
    hostileAt: true,
    attackCooldown: 20,
    fuse: 0,
    fleeTicks: 0,
    followRange: 20,
    rangedReady: false,
    ...overrides,
  };
}

describe('AI helpers: line of sight, states and daylight', () => {
  it('sees through open air but not through opaque walls', () => {
    const world = makeFlatWorld();
    const from = { x: 0.5, y: 10.7, z: 0.5 };
    const to = { x: 6.5, y: 10.7, z: 0.5 };
    expect(hasLineOfSight(world, from, to)).toBe(true);
    world.fill(3, 10, -2, 3, 11, 2, TEST_BLOCKS.stone);
    expect(hasLineOfSight(world, from, to)).toBe(false);
  });

  it('treats water/leaves as transparent for sight but respects max distance', () => {
    const world = makeFlatWorld();
    world.set(3, 10, 0, TEST_BLOCKS.water);
    world.set(3, 11, 0, TEST_BLOCKS.water);
    expect(hasLineOfSight(world, { x: 0.5, y: 10.7, z: 0.5 }, { x: 6.5, y: 10.7, z: 0.5 })).toBe(true);
    expect(
      hasLineOfSight(world, { x: 0.5, y: 10.7, z: 0.5 }, { x: 40.5, y: 10.7, z: 0.5 }, 10),
    ).toBe(false);
    expect(canSee(world, { x: 0.5, y: 10.7, z: 0.5 }, { x: 6.5, y: 10.7, z: 0.5 }, 10)).toBe(true);
    expect(canSee(world, { x: 0.5, y: 10.7, z: 0.5 }, { x: 16.5, y: 10.7, z: 0.5 }, 10)).toBe(
      false,
    );
  });

  it('chases a visible hostile target inside follow range', () => {
    expect(decideMobState(decision())).toBe('chase');
    expect(decideMobState(decision({ target: { ...decision().target!, distance: 30 } }))).toBe(
      'wander',
    );
    expect(
      decideMobState(decision({ target: { ...decision().target!, visible: false } })),
    ).toBe('wander');
  });

  it('attacks when in melee reach and the cooldown is ready', () => {
    expect(
      decideMobState(
        decision({
          target: { distance: 1.6, horizontalDistance: 1.6, visible: true, alive: true, targetable: true },
          attackCooldown: 0,
        }),
      ),
    ).toBe('attack');
    expect(
      decideMobState(
        decision({
          target: { distance: 1.6, horizontalDistance: 1.6, visible: true, alive: true, targetable: true },
          attackCooldown: 20,
        }),
      ),
    ).toBe('chase');
  });

  it('reacts to hurt, fleeing and priming priorities', () => {
    expect(decideMobState(decision({ hurtTime: 6 }))).toBe('hurt');
    expect(decideMobState(decision({ hurtTime: 6, fleeTicks: 40 }))).toBe('flee');
    expect(decideMobState(decision({ type: 'creeper', fuse: 10 }))).toBe('attack');
    expect(decideMobState(decision({ health: 0 }))).toBe('dead');
  });

  it('ignores creative and dead targets', () => {
    const creative = decision();
    expect(
      decideMobState(decision({ target: { ...creative.target!, targetable: false } })),
    ).toBe('wander');
    expect(
      decideMobState(decision({ target: { ...creative.target!, alive: false } })),
    ).toBe('wander');
    expect(decideMobState(decision({ target: null }))).toBe('wander');
  });

  it('lets skeletons shoot when ranged and visible', () => {
    expect(decideMobState(decision({ type: 'skeleton', rangedReady: true }))).toBe('attack');
    expect(decideMobState(decision({ type: 'skeleton', rangedReady: false }))).toBe('chase');
  });

  it('computes daylight exposure and burning rules', () => {
    const world = makeFlatWorld();
    world.setDaytime(true);
    expect(isDaytime(world)).toBe(true);
    expect(isExposedToDaylight(world, { x: 0.5, y: 10.5, z: 0.5 })).toBe(true);
    expect(shouldBurnInDaylight('zombie', world, { x: 0.5, y: 10.5, z: 0.5 })).toBe(true);
    expect(shouldBurnInDaylight('skeleton', world, { x: 0.5, y: 10.5, z: 0.5 })).toBe(true);
    expect(shouldBurnInDaylight('pig', world, { x: 0.5, y: 10.5, z: 0.5 })).toBe(false);
    world.setSkyLight(0, 10, 0, 4);
    expect(isExposedToDaylight(world, { x: 0.5, y: 10.5, z: 0.5 })).toBe(false);
    expect(shouldBurnInDaylight('zombie', world, { x: 0.5, y: 10.5, z: 0.5 })).toBe(false);
    world.setDaytime(false);
    expect(shouldBurnInDaylight('zombie', world, { x: 0.5, y: 10.5, z: 0.5 })).toBe(false);
  });

  it('spiders are neutral in daylight unless provoked', () => {
    const world = makeFlatWorld();
    world.setDaytime(true);
    expect(isHostileAt('spider', world, false)).toBe(false);
    expect(isHostileAt('spider', world, true)).toBe(true);
    world.setDaytime(false);
    expect(isHostileAt('spider', world, false)).toBe(true);
    expect(isHostileAt('zombie', world, false)).toBe(true);
    expect(isHostileAt('pig', world, false)).toBe(false);
  });

  it('scales skeleton arrow damage with distance', () => {
    expect(skeletonArrowDamage(3)).toBe(4);
    expect(skeletonArrowDamage(12)).toBe(3);
    expect(skeletonArrowDamage(20)).toBe(2);
    expect(CREEPER_FUSE_TICKS).toBe(30);
  });

  it('picks deterministic wander/flee targets', () => {
    const a = pickWanderTarget(new Rand(7).next.bind(new Rand(7)), { x: 0, y: 10, z: 0 }, 8);
    const randA = new Rand(7);
    const randB = new Rand(7);
    const pointA = pickWanderTarget(() => randA.next(), { x: 0, y: 10, z: 0 }, 8);
    const pointB = pickWanderTarget(() => randB.next(), { x: 0, y: 10, z: 0 }, 8);
    expect(pointA).toEqual(pointB);
    expect(pointA.y).toBe(10);
    expect(Math.hypot(pointA.x, pointA.z)).toBeLessThanOrEqual(8);
    expect(a.y).toBe(10);

    const fleeRand = new Rand(3);
    const flee = pickFleeTarget(() => fleeRand.next(), { x: 0, y: 10, z: 0 }, { x: -5, y: 10, z: 0 }, 10);
    expect(flee.x).toBeGreaterThan(0);
    expect(Math.hypot(flee.x, flee.z)).toBeCloseTo(10, 0);
  });

  it('wraps angles and turns smoothly', () => {
    expect(angleDifference(Math.PI * 1.5, -Math.PI * 0.5)).toBeCloseTo(0);
    expect(turnTowards(0, 1, 0.2)).toBeCloseTo(0.2);
    expect(turnTowards(0, 0.1, 0.2)).toBeCloseTo(0.1);
    expect(yawOf(0, 1)).toBeCloseTo(0);
    expect(yawOf(1, 0)).toBeCloseTo(Math.PI / 2);
  });
});
