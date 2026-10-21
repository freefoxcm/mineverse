import { describe, expect, it } from 'vitest';
import { BLOCK } from '../../src/world/blocks';
import {
  EYE_HEIGHT,
  PLAYER_HEIGHT,
  SNEAK_EYE_HEIGHT,
  SNEAK_SPEED,
  SPRINT_SPEED,
  WALK_SPEED,
  bodyFluid,
  collidesWithWorld,
  emptyMovementInput,
  eyeHeightFor,
  fallDamageForDistance,
  horizontalSpeedFor,
  lookDirection,
  movePlayer,
  resolvePenetration,
  stepPhysics,
  sweepAxis,
} from '../../src/player/physics';
import { groundWorld, input, makeBody, simulate, TestWorld } from './helpers';

describe('player physics: AABB collision', () => {
  it('detects colliding boxes only when actually overlapping solid blocks', () => {
    const world = groundWorld(63);
    expect(collidesWithWorld(world, { x: 0.5, y: 64, z: 0.5 })).toBe(false);
    expect(collidesWithWorld(world, { x: 0.5, y: 63.5, z: 0.5 })).toBe(true);
    // Standing exactly on the top face is not a collision.
    expect(collidesWithWorld(world, { x: 0.5, y: 64.0001, z: 0.5 })).toBe(false);
  });

  it('sweeps long distances without tunneling through a wall', () => {
    const world = groundWorld(63);
    world.fill(1, 64, -4, 1, 70, 4, BLOCK.stone);
    const sweep = sweepAxis(world, { x: 0.5, y: 64, z: 0.5 }, 'x', 12);
    expect(sweep.hit).toBe(true);
    expect(sweep.value).toBeCloseTo(0.7, 6);
  });

  it('slides along a wall on the free axis (corner does not stick)', () => {
    const world = groundWorld(63);
    world.fill(1, 64, -4, 1, 70, 4, BLOCK.stone);
    world.fill(-4, 64, 1, 4, 70, 1, BLOCK.stone);
    const result = movePlayer(world, { x: 0.5, y: 64, z: 0.5 }, { x: 0.4, y: -0.1, z: 0.4 });
    expect(result.hitX).toBe(true);
    expect(result.hitZ).toBe(true);
    expect(result.position.x).toBeCloseTo(0.7, 6);
    expect(result.position.z).toBeCloseTo(0.7, 6);
    expect(result.position.y).toBeCloseTo(64, 6);
    expect(Number.isFinite(result.position.x + result.position.y + result.position.z)).toBe(true);
  });

  it('walks diagonally along a wall instead of stopping', () => {
    const world = groundWorld(63);
    world.fill(1, 64, -8, 1, 70, 8, BLOCK.stone);
    const simulated = simulate(
      world,
      makeBody({ x: 0.5, y: 64, z: 0.5, yaw: 0 }),
      input({ forward: 1, strafe: 1 }),
      20,
    );
    expect(simulated.body.position.x).toBeLessThanOrEqual(0.7 + 1e-6);
    expect(Math.abs(simulated.body.position.z - 0.5)).toBeGreaterThan(1);
    expect(simulated.steps.some((step) => step.hitWall)).toBe(true);
  });

  it('pushes the player out when embedded in a solid block', () => {
    const world = groundWorld(63);
    const resolved = resolvePenetration(world, { x: 0.5, y: 63.3, z: 0.5 });
    expect(collidesWithWorld(world, resolved)).toBe(false);
    expect(resolved.y).toBeCloseTo(64, 5);
  });
});

describe('player physics: walking / jumping / gravity', () => {
  it('accelerates to walking speed and moves forward', () => {
    const world = groundWorld(63);
    const simulated = simulate(world, makeBody({ x: 0, y: 64, z: 0 }), input({ forward: 1 }), 40);
    const distance = -simulated.body.position.z;
    // ~4.317 blocks/s for 2 s minus a short acceleration ramp.
    expect(distance).toBeGreaterThan(6.5);
    expect(distance).toBeLessThan(8.8);
    expect(simulated.body.onGround).toBe(true);
    expect(simulated.body.velocity.y).toBe(0);
  });

  it('sprints faster than walking and sneaks slower', () => {
    const world = groundWorld(63);
    const walk = simulate(world, makeBody({ x: 0, y: 64, z: 0 }), input({ forward: 1 }), 40);
    const sprint = simulate(
      world,
      makeBody({ x: 0, y: 64, z: 0 }),
      input({ forward: 1, sprint: true }),
      40,
    );
    const sneak = simulate(
      world,
      makeBody({ x: 0, y: 64, z: 0 }),
      input({ forward: 1, sneak: true }),
      40,
    );
    expect(-sprint.body.position.z).toBeGreaterThan(-walk.body.position.z + 1.5);
    expect(-sneak.body.position.z).toBeLessThan(-walk.body.position.z);

    const base = { flying: false, sprinting: false, sneaking: false, inWater: false, inLava: false };
    expect(horizontalSpeedFor(base)).toBe(WALK_SPEED);
    expect(horizontalSpeedFor({ ...base, sprinting: true })).toBe(SPRINT_SPEED);
    expect(horizontalSpeedFor({ ...base, sneaking: true })).toBe(SNEAK_SPEED);
  });

  it('jumps about 1.2 blocks high with gravity 32 and jump velocity 8.9', () => {
    const world = groundWorld(63);
    const simulated = simulate(
      world,
      makeBody({ x: 0.5, y: 64, z: 0.5 }),
      (tick) => input({ jump: tick === 0, jumpPressed: tick === 0 }),
      24,
    );
    const peak = Math.max(...simulated.steps.map((step) => step.position.y)) - 64;
    expect(peak).toBeGreaterThan(1.15);
    expect(peak).toBeLessThan(1.35);
    expect(simulated.body.position.y).toBeCloseTo(64, 6);
    expect(simulated.body.onGround).toBe(true);
    expect(simulated.steps.every((step) => step.landedFallDamage === 0)).toBe(true);
  });

  it('stops upward motion under a ceiling and never clips through it', () => {
    const world = groundWorld(63);
    world.fill(-2, 66, -2, 2, 66, 2, BLOCK.stone);
    const simulated = simulate(
      world,
      makeBody({ x: 0.5, y: 64, z: 0.5 }),
      (tick) => input({ jump: tick === 0, jumpPressed: tick === 0 }),
      24,
    );
    const peakFeet = Math.max(...simulated.steps.map((step) => step.position.y));
    expect(peakFeet).toBeLessThanOrEqual(64.2 + 1e-6);
    for (const step of simulated.steps) {
      expect(step.position.y + PLAYER_HEIGHT).toBeLessThanOrEqual(66 + 1e-6);
    }
  });

  it('detects standing on the ground every tick', () => {
    const world = groundWorld(63);
    let body = makeBody({ x: 0.5, y: 64, z: 0.5, onGround: true });
    for (let tick = 0; tick < 5; tick++) {
      const result = stepPhysics(world, body, emptyMovementInput());
      expect(result.onGround).toBe(true);
      expect(result.position.y).toBeCloseTo(64, 8);
      expect(result.velocity.y).toBe(0);
      body = {
        ...body,
        position: result.position,
        velocity: result.velocity,
        onGround: result.onGround,
      };
    }
  });
});

describe('player physics: fall damage and fluids', () => {
  it('computes fall damage as floor(distance - 3)', () => {
    expect(fallDamageForDistance(0)).toBe(0);
    expect(fallDamageForDistance(3)).toBe(0);
    expect(fallDamageForDistance(3.9)).toBe(0);
    expect(fallDamageForDistance(4)).toBe(1);
    expect(fallDamageForDistance(13.9)).toBe(10);
    expect(fallDamageForDistance(Number.NaN)).toBe(0);
  });

  it('applies exactly floor(fall distance - 3) on landing', () => {
    const world = groundWorld(63);
    const simulated = simulate(
      world,
      makeBody({ x: 0.5, y: 100, z: 0.5, onGround: false }),
      input(),
      80,
    );
    expect(simulated.body.position.y).toBeCloseTo(64, 6);
    expect(simulated.body.onGround).toBe(true);
    const damage = simulated.steps.reduce((sum, step) => sum + step.landedFallDamage, 0);
    expect(damage).toBe(33); // 100 -> 64 = 36 blocks, floor(36 - 3)
  });

  it('never hurts a creative player from falling', () => {
    const world = groundWorld(63);
    const simulated = simulate(
      world,
      makeBody({ x: 0.5, y: 100, z: 0.5, onGround: false, gameMode: 'creative' }),
      input(),
      80,
    );
    expect(simulated.steps.every((step) => step.landedFallDamage === 0)).toBe(true);
  });

  it('sinks slowly in water without fall damage', () => {
    const world = groundWorld(63).fill(-6, 64, -6, 6, 70, 6, BLOCK.water);
    expect(bodyFluid(world, { x: 0.5, y: 66, z: 0.5 })).toBe('water');
    const simulated = simulate(
      world,
      makeBody({ x: 0.5, y: 66, z: 0.5, onGround: false }),
      input(),
      80,
    );
    expect(simulated.body.inWater).toBe(true);
    expect(simulated.body.position.y).toBeGreaterThan(63.9);
    expect(simulated.body.position.y).toBeLessThan(65);
    expect(simulated.steps.every((step) => step.landedFallDamage === 0)).toBe(true);
  });

  it('swims upward while jump is held in water', () => {
    const world = groundWorld(63).fill(-6, 64, -6, 6, 70, 6, BLOCK.water);
    const simulated = simulate(world, makeBody({ x: 0.5, y: 64, z: 0.5 }), input({ jump: true }), 20);
    expect(simulated.body.inWater).toBe(true);
    expect(simulated.body.position.y).toBeGreaterThan(64.5);
  });

  it('is slower in lava than in water than on land', () => {
    const base = { flying: false, sprinting: false, sneaking: false, inWater: false, inLava: false };
    expect(horizontalSpeedFor({ ...base, inLava: true })).toBeLessThan(
      horizontalSpeedFor({ ...base, inWater: true }),
    );
    expect(horizontalSpeedFor({ ...base, inWater: true })).toBeLessThan(horizontalSpeedFor(base));
  });
});

describe('player physics: flight and camera math', () => {
  it('flies upward in creative mode without gravity', () => {
    const world = groundWorld(63);
    const simulated = simulate(
      world,
      makeBody({ x: 0.5, y: 64, z: 0.5, gameMode: 'creative', flying: true }),
      input({ flyVertical: 1 }),
      20,
    );
    expect(simulated.body.position.y).toBeGreaterThan(66);
    expect(simulated.steps.every((step) => step.landedFallDamage === 0)).toBe(true);
  });

  it('ignores the flying flag outside creative mode', () => {
    const world = groundWorld(63);
    const simulated = simulate(
      world,
      makeBody({ x: 0.5, y: 70, z: 0.5, flying: true, onGround: false }),
      input(),
      40,
    );
    expect(simulated.body.position.y).toBeCloseTo(64, 6);
    expect(simulated.body.onGround).toBe(true);
  });

  it('reports the correct eye height when sneaking', () => {
    expect(eyeHeightFor(false)).toBe(EYE_HEIGHT);
    expect(eyeHeightFor(true)).toBe(SNEAK_EYE_HEIGHT);
    expect(EYE_HEIGHT).toBe(1.62);
  });

  it('builds a look direction matching a YXZ camera', () => {
    const forward = lookDirection(0, 0);
    expect(forward.x).toBeCloseTo(0, 8);
    expect(forward.y).toBeCloseTo(0, 8);
    expect(forward.z).toBeCloseTo(-1, 8);

    const right = lookDirection(Math.PI / 2, 0);
    expect(right.x).toBeCloseTo(-1, 8);
    expect(right.z).toBeCloseTo(0, 8);

    const up = lookDirection(0, Math.PI / 2);
    expect(up.y).toBeCloseTo(1, 8);
  });

  it('only collides with collidable blocks (plants and liquids are passable)', () => {
    const world = new TestWorld()
      .set(0, 64, 0, BLOCK.tall_grass)
      .set(1, 64, 0, BLOCK.water)
      .set(2, 64, 0, BLOCK.stone);
    expect(collidesWithWorld(world, { x: 0.5, y: 64.1, z: 0.5 })).toBe(false);
    expect(collidesWithWorld(world, { x: 1.5, y: 64.1, z: 0.5 })).toBe(false);
    expect(collidesWithWorld(world, { x: 2.5, y: 64.1, z: 0.5 })).toBe(true);
  });
});
