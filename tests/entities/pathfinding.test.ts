import { describe, expect, it } from 'vitest';
import {
  canStandAt,
  findPath,
  pathLength,
  type PathOptions,
} from '../../src/entities/pathfinding';
import { TEST_BLOCKS, makeFlatWorld } from './helpers';

const START = { x: 0.5, y: 10, z: 0.5 };

describe('3D A* pathfinding', () => {
  it('walks straight across flat ground', () => {
    const world = makeFlatWorld();
    const result = findPath(world, START, { x: 6.5, y: 10, z: 0.5 });
    expect(result.found).toBe(true);
    expect(result.reason).toBe('ok');
    expect(result.waypoints.length).toBeGreaterThan(0);
    const end = result.waypoints[result.waypoints.length - 1];
    expect(end.x).toBeCloseTo(6.5, 1);
    expect(end.y).toBe(10);
    expect(result.expanded).toBeLessThanOrEqual(300);
  });

  it('walks around a wall (does not pass through it)', () => {
    const world = makeFlatWorld();
    world.fill(3, 10, -3, 3, 11, 3, TEST_BLOCKS.stone);
    const result = findPath(world, START, { x: 6.5, y: 10, z: 0.5 });
    expect(result.found).toBe(true);
    expect(pathLength(START, result.waypoints)).toBeGreaterThan(8);
    for (const point of result.waypoints) {
      const inWall =
        Math.floor(point.x) === 3 &&
        Math.abs(Math.floor(point.z)) <= 3 &&
        point.y >= 10 &&
        point.y <= 11;
      expect(inWall).toBe(false);
    }
    // Must leave the wall corridor somewhere.
    expect(result.waypoints.some((point) => Math.abs(point.z) > 3)).toBe(true);
  });

  it('jumps up a one-block ledge', () => {
    const world = makeFlatWorld();
    world.fill(3, 10, -4, 8, 10, 4, TEST_BLOCKS.stone);
    const result = findPath(world, START, { x: 6.5, y: 11, z: 0.5 });
    expect(result.found).toBe(true);
    const end = result.waypoints[result.waypoints.length - 1];
    expect(end.y).toBe(11);
  });

  it('avoids walking into water', () => {
    const world = makeFlatWorld();
    world.fill(-2, 10, -2, 2, 10, 2, TEST_BLOCKS.water);
    const result = findPath(world, { x: 0.5, y: 10, z: -5 }, { x: 0.5, y: 10, z: 5 });
    expect(result.found).toBe(true);
    for (const point of result.waypoints) {
      const inPond =
        Math.floor(point.x) >= -2 &&
        Math.floor(point.x) <= 2 &&
        Math.floor(point.z) >= -2 &&
        Math.floor(point.z) <= 2 &&
        point.y === 10;
      expect(inPond).toBe(false);
    }
  });

  it('reports no path when fully walled in', () => {
    const world = makeFlatWorld();
    // 4x4 two-block-high box around the start.
    world.fill(-2, 10, -2, 2, 11, -2, TEST_BLOCKS.stone);
    world.fill(-2, 10, 2, 2, 11, 2, TEST_BLOCKS.stone);
    world.fill(-2, 10, -2, -2, 11, 2, TEST_BLOCKS.stone);
    world.fill(2, 10, -2, 2, 11, 2, TEST_BLOCKS.stone);
    const result = findPath(world, START, { x: 6.5, y: 10, z: 0.5 });
    expect(result.found).toBe(false);
    expect(result.reason).not.toBe('ok');
    expect(result.expanded).toBeLessThan(50);
  });

  it('respects the 300 node budget and can be tuned per call', () => {
    const world = makeFlatWorld();
    const options: PathOptions = { maxNodes: 5 };
    const result = findPath(world, START, { x: 40.5, y: 10, z: 0.5 }, options);
    expect(result.found).toBe(false);
    expect(result.reason).toBe('node-limit');
    expect(result.expanded).toBe(5);
  });

  it('canStandAt rejects occupied/liquid cells but accepts a valid stand', () => {
    const world = makeFlatWorld();
    expect(canStandAt(world, 5, 10, 5)).toBe(true);
    world.set(5, 10, 5, TEST_BLOCKS.stone);
    expect(canStandAt(world, 5, 10, 5)).toBe(false);
    world.set(6, 10, 6, TEST_BLOCKS.water);
    expect(canStandAt(world, 6, 10, 6)).toBe(false);
    // Without liquid avoidance a water cell is walkable (entities can swim).
    expect(canStandAt(world, 6, 10, 6, { avoidLiquids: false })).toBe(true);
  });
});
