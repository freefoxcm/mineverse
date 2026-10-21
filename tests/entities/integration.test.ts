/** Integration smoke test against the real World implementation (not the fake). */

import { describe, expect, it } from 'vitest';
import { EntityManager } from '../../src/entities/manager';
import { findPath } from '../../src/entities/pathfinding';
import { BLOCK } from '../../src/world/blocks';
import { World } from '../../src/world/world';
import { makePlayer } from './helpers';

interface SpawnSpot {
  x: number;
  y: number;
  z: number;
}

/** Find a dry grass/sand surface spot in the real generated world. */
function findSpawnSpot(world: World): SpawnSpot {
  for (let cz = -2; cz <= 2; cz++) {
    for (let cx = -2; cx <= 2; cx++) {
      world.ensureColumn(cx, cz);
      for (let lz = 0; lz < 16; lz++) {
        for (let lx = 0; lx < 16; lx++) {
          const x = cx * 16 + lx;
          const z = cz * 16 + lz;
          const surface = world.spawnY(x, z);
          const ground = world.getBlock(x, surface - 1, z);
          if (surface > 64 && (ground === BLOCK.grass_block || ground === BLOCK.sand)) {
            return { x: x + 0.5, y: surface, z: z + 0.5 };
          }
        }
      }
    }
  }
  throw new Error('no dry spawn spot found');
}

describe('mob system on the real World', () => {
  it('spawns, ticks and snapshots a mob without throwing', () => {
    const world = new World('m4-integration');
    const spot = findSpawnSpot(world);
    world.setTicks(18000); // midnight so zombies do not burn
    const manager = new EntityManager({
      difficulty: 'normal',
      seed: 'm4-integration',
      spawnEnabled: false,
    });
    const player = makePlayer(spot.x + 6, spot.y, spot.z);
    const zombie = manager.spawn('zombie', spot.x, spot.y + 0.2, spot.z);
    for (let tick = 1; tick <= 60; tick++) manager.update(tick, world, player, 1);

    expect(zombie.health).toBeGreaterThan(0);
    const snapshots = manager.snapshots();
    expect(snapshots).toHaveLength(1);
    expect(snapshots[0].type).toBe('zombie');
    expect(snapshots[0].position.y).toBeGreaterThan(0);
    expect(Number.isFinite(snapshots[0].shadowY)).toBe(true);
    expect(snapshots[0].shadowY).toBeLessThanOrEqual(snapshots[0].position.y + 0.01);
  });

  it('pathfinds across real terrain within the node budget', () => {
    const world = new World('m4-path-integration');
    const spot = findSpawnSpot(world);
    const target = { x: spot.x + 4, y: spot.y, z: spot.z + 4 };
    const result = findPath(world, { x: spot.x, y: spot.y, z: spot.z }, target);
    expect(result.expanded).toBeLessThanOrEqual(300);
    if (result.found) {
      expect(result.waypoints.length).toBeGreaterThan(0);
      expect(result.reason).toBe('ok');
    } else {
      expect(['no-path', 'node-limit', 'timeout', 'invalid-goal', 'invalid-start']).toContain(
        result.reason,
      );
    }
  });
});
