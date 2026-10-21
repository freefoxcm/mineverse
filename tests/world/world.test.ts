import { describe, expect, it } from 'vitest';
import { BLOCK, getBlockDef } from '../../src/world/blocks';
import { WORLD_HEIGHT } from '../../src/core/config';
import { World } from '../../src/world/world';

describe('world placeholder generation', () => {
  it('is deterministic for a seed', () => {
    const a = new World('same-seed');
    const b = new World('same-seed');
    const columnA = a.ensureColumn(0, 0);
    const columnB = b.ensureColumn(0, 0);
    expect([...columnA.blocks]).toEqual([...columnB.blocks]);
  });

  it('differs between seeds', () => {
    const a = new World('seed-a');
    const b = new World('seed-b');
    const columnA = a.ensureColumn(0, 0);
    const columnB = b.ensureColumn(0, 0);
    expect([...columnA.blocks]).not.toEqual([...columnB.blocks]);
  });

  it('places bedrock at the bottom and grass at the surface', () => {
    const world = new World('bedrock-test');
    const column = world.ensureColumn(0, 0);
    expect(column.getBlock(8, 0, 8)).toBe(BLOCK.bedrock);
    expect(column.getBlock(8, 1, 8)).toBe(BLOCK.bedrock);
    const surface = world.spawnY(8, 8) - 1;
    expect(surface).toBeGreaterThan(0);
    expect(surface).toBeLessThan(WORLD_HEIGHT);
    const surfaceBlock = world.getBlock(8, surface, 8);
    expect([BLOCK.grass_block, BLOCK.sand, BLOCK.water]).toContain(surfaceBlock);
  });

  it('fills low terrain up to sea level with water', () => {
    const world = new World('water-test');
    let foundWater = false;
    for (let cx = -3; cx <= 3 && !foundWater; cx++) {
      for (let cz = -3; cz <= 3 && !foundWater; cz++) {
        world.ensureColumn(cx, cz);
        for (let x = 0; x < 16 && !foundWater; x++) {
          for (let z = 0; z < 16 && !foundWater; z++) {
            if (world.getBlock(cx * 16 + x, 62, cz * 16 + z) === BLOCK.water) foundWater = true;
          }
        }
      }
    }
    expect(foundWater).toBe(true);
  });

  it('computes sky light: bright above the surface, dark under blocks', () => {
    const world = new World('light-test');
    world.ensureColumn(0, 0);
    const surface = world.spawnY(8, 8) - 1;
    expect(world.getSkyLight(8, WORLD_HEIGHT - 1, 8)).toBe(15);
    expect(world.getSkyLight(8, surface - 2, 8)).toBe(0);
  });

  it('applies block edits and records them for saving', () => {
    const world = new World('edit-test');
    const column = world.ensureColumn(0, 0);
    const y = world.spawnY(8, 8);
    expect(world.setBlock(8, y, 8, BLOCK.torch)).toBe(true);
    expect(world.getBlock(8, y, 8)).toBe(BLOCK.torch);
    expect(column.edits.size).toBe(1);
    expect(world.setBlock(8, y, 8, BLOCK.torch)).toBe(false);
  });

  it('reports time of day and daylight', () => {
    const world = new World('time-test');
    world.setTicks(6000);
    const noon = world.time();
    expect(noon.daylight).toBeGreaterThan(0.9);
    world.setTicks(18000);
    const midnight = world.time();
    expect(midnight.daylight).toBeLessThan(0.2);
  });

  it('knows which columns are loaded', () => {
    const world = new World('loaded-test');
    expect(world.isChunkLoaded(0, 0)).toBe(false);
    world.ensureColumn(0, 0);
    expect(world.isChunkLoaded(0, 0)).toBe(true);
    expect(world.getBlock(-1, 70, -1)).toBe(0);
  });

  it('has solid numeric ids for every block', () => {
    expect(getBlockDef(BLOCK.stone).hardness).toBeGreaterThan(0);
  });
});
