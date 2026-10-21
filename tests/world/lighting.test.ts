import { describe, expect, it } from 'vitest';
import { BLOCK, LIGHT_EMISSION, blockNumeric } from '../../src/world/blocks';
import { ChunkColumn, chunkKey, localIndex } from '../../src/world/chunk';
import { LightEngine, MAX_LIGHT, type LightWorld } from '../../src/world/lighting';
import { WORLD_HEIGHT } from '../../src/core/config';

class TestLightWorld implements LightWorld {
  readonly columns = new Map<string, ChunkColumn>();
  readonly dirty = new Set<string>();

  getColumn(cx: number, cz: number): ChunkColumn | undefined {
    return this.columns.get(chunkKey(cx, cz));
  }

  addColumn(cx: number, cz: number): ChunkColumn {
    const column = new ChunkColumn(cx, cz);
    this.columns.set(chunkKey(cx, cz), column);
    return column;
  }

  markDirty(wx: number, wy: number, wz: number): void {
    this.dirty.add(`${wx},${wy},${wz}`);
  }
}

function fillRun(column: ChunkColumn, block: number, y0: number, y1: number): void {
  for (let y = y0; y <= y1; y++) {
    for (let z = 0; z < 16; z++) {
      for (let x = 0; x < 16; x++) column.blocks[localIndex(x, y, z)] = block;
    }
  }
}

function skyAt(world: TestLightWorld, x: number, y: number, z: number): number {
  const column = world.getColumn(Math.floor(x / 16), Math.floor(z / 16));
  if (!column) return -1;
  return column.sky[localIndex(x - column.cx * 16, y, z - column.cz * 16)];
}

function blockLightAt(world: TestLightWorld, x: number, y: number, z: number): number {
  const column = world.getColumn(Math.floor(x / 16), Math.floor(z / 16));
  if (!column) return -1;
  return column.blockLight[localIndex(x - column.cx * 16, y, z - column.cz * 16)];
}

describe('sky light', () => {
  it('fills an open column with 15 and keeps darkness below opaque blocks', () => {
    const world = new TestLightWorld();
    const engine = new LightEngine(world);
    const open = world.addColumn(0, 0);
    engine.lightColumn(open);
    expect(skyAt(world, 8, WORLD_HEIGHT - 1, 8)).toBe(MAX_LIGHT);
    expect(skyAt(world, 8, 80, 8)).toBe(MAX_LIGHT);

    const solid = world.addColumn(1, 0);
    fillRun(solid, BLOCK.stone, 0, 100);
    engine.lightColumn(solid);
    expect(skyAt(world, 24, 100, 8)).toBe(0);
    expect(skyAt(world, 24, 60, 8)).toBe(0);
    expect(skyAt(world, 24, 101, 8)).toBe(MAX_LIGHT);
  });

  it('spreads sideways into the shadow of an overhang with decay 1', () => {
    const world = new TestLightWorld();
    const engine = new LightEngine(world);
    const column = world.addColumn(0, 0);
    fillRun(column, BLOCK.stone, 0, 60);
    // Roof at y=70 covering x=4..11, all z.
    for (let z = 0; z < 16; z++) {
      for (let x = 4; x <= 11; x++) column.blocks[localIndex(x, 70, z)] = BLOCK.stone;
    }
    engine.lightColumn(column);

    const edge = skyAt(world, 4, 69, 8);
    const middle = skyAt(world, 8, 69, 8);
    expect(edge).toBeGreaterThan(0);
    expect(edge).toBeLessThan(MAX_LIGHT);
    expect(middle).toBeGreaterThan(0);
    expect(middle).toBeLessThan(edge);
    // Outside the roof is full daylight.
    expect(skyAt(world, 2, 69, 8)).toBe(MAX_LIGHT);
  });

  it('reports 15 above world height and 0 below bedrock', () => {
    const world = new TestLightWorld();
    const engine = new LightEngine(world);
    world.addColumn(0, 0);
    expect(engine.getSkyLight(8, WORLD_HEIGHT, 8)).toBe(MAX_LIGHT);
    expect(engine.getSkyLight(8, -1, 8)).toBe(0);
    expect(engine.getSkyLight(1000, 80, 1000)).toBe(0);
  });
});

describe('block light', () => {
  it('seeds torch light at 14 and decays one per block', () => {
    const world = new TestLightWorld();
    const engine = new LightEngine(world);
    const column = world.addColumn(0, 0);
    fillRun(column, BLOCK.stone, 0, 60);
    column.setGenerated(5, 61, 5, blockNumeric('torch'));
    engine.lightColumn(column);

    expect(blockLightAt(world, 5, 61, 5)).toBe(14);
    expect(blockLightAt(world, 6, 61, 5)).toBe(13);
    expect(blockLightAt(world, 7, 61, 5)).toBe(12);
    expect(blockLightAt(world, 5, 63, 5)).toBe(12);
    expect(blockLightAt(world, 15, 61, 5)).toBe(4);
    expect(LIGHT_EMISSION[blockNumeric('torch')]).toBe(14);
    expect(LIGHT_EMISSION[blockNumeric('lit_furnace')]).toBe(13);
    expect(LIGHT_EMISSION[blockNumeric('lava')]).toBe(15);
  });

  it('removes torch light completely when the torch is broken', () => {
    const world = new TestLightWorld();
    const engine = new LightEngine(world);
    const column = world.addColumn(0, 0);
    fillRun(column, BLOCK.stone, 0, 60);
    column.setGenerated(5, 61, 5, BLOCK.torch);
    engine.lightColumn(column);
    expect(blockLightAt(world, 6, 61, 5)).toBe(13);

    column.setGenerated(5, 61, 5, BLOCK.air);
    engine.onBlockChanged(5, 61, 5, BLOCK.torch, BLOCK.air);
    for (let y = 61; y <= 75; y++) {
      for (let z = 0; z < 16; z++) {
        for (let x = 0; x < 16; x++) {
          expect(blockLightAt(world, x, y, z)).toBe(0);
        }
      }
    }
  });

  it('does not leak block light through an opaque wall', () => {
    const world = new TestLightWorld();
    const engine = new LightEngine(world);
    const column = world.addColumn(0, 0);
    fillRun(column, BLOCK.stone, 0, 60);
    column.setGenerated(5, 61, 5, BLOCK.lava);
    for (let z = 0; z < 16; z++) {
      for (let y = 61; y < WORLD_HEIGHT; y++) column.blocks[localIndex(8, y, z)] = BLOCK.stone;
    }
    engine.lightColumn(column);
    expect(blockLightAt(world, 6, 61, 5)).toBe(14);
    expect(blockLightAt(world, 7, 61, 5)).toBe(13);
    expect(blockLightAt(world, 8, 61, 5)).toBe(0);
    expect(blockLightAt(world, 9, 61, 5)).toBe(0);
  });
});

describe('cross-chunk light', () => {
  it('propagates sky light into a dark tunnel across a chunk border', () => {
    const world = new TestLightWorld();
    const engine = new LightEngine(world);
    const open = world.addColumn(0, 0);
    engine.lightColumn(open);

    const solid = world.addColumn(1, 0);
    fillRun(solid, BLOCK.stone, 0, 100);
    for (let x = 0; x <= 5; x++) {
      for (let z = 4; z <= 6; z++) solid.blocks[localIndex(x, 70, z)] = BLOCK.air;
    }

    engine.lightColumn(solid);
    expect(skyAt(world, 16, 70, 5)).toBe(0);

    engine.lightColumnWithNeighbors(solid);
    expect(skyAt(world, 16, 70, 5)).toBe(14);
    expect(skyAt(world, 17, 70, 5)).toBe(13);
    expect(skyAt(world, 21, 70, 5)).toBe(9);
    // Tunnel ends at x=21 (local 5); x=22 is solid stone.
    expect(skyAt(world, 22, 70, 5)).toBe(0);
  });

  it('propagates block light across a chunk border and removes it again', () => {
    const world = new TestLightWorld();
    const engine = new LightEngine(world);
    const a = world.addColumn(0, 0);
    fillRun(a, BLOCK.stone, 0, 60);
    a.setGenerated(15, 61, 8, BLOCK.torch);
    const b = world.addColumn(1, 0);
    fillRun(b, BLOCK.stone, 0, 60);
    // Carve a small pocket on the border side of b.
    for (let x = 0; x <= 3; x++) {
      for (let z = 6; z <= 10; z++) b.blocks[localIndex(x, 61, z)] = BLOCK.air;
    }

    engine.lightColumn(a);
    engine.lightColumn(b);
    engine.lightColumnWithNeighbors(a);
    engine.lightColumnWithNeighbors(b);
    expect(blockLightAt(world, 16, 61, 8)).toBe(13);
    expect(blockLightAt(world, 17, 61, 8)).toBe(12);

    a.setGenerated(15, 61, 8, BLOCK.air);
    engine.onBlockChanged(15, 61, 8, BLOCK.torch, BLOCK.air);
    expect(blockLightAt(world, 16, 61, 8)).toBe(0);
    expect(blockLightAt(world, 17, 61, 8)).toBe(0);
  });
});

describe('incremental edits', () => {
  it('removes and restores sky light through a 1-block hole in a roof', () => {
    const world = new TestLightWorld();
    const engine = new LightEngine(world);
    const column = world.addColumn(0, 0);
    // A full roof at y=100: everything below is in direct darkness.
    for (let z = 0; z < 16; z++) {
      for (let x = 0; x < 16; x++) column.blocks[localIndex(x, 100, z)] = BLOCK.stone;
    }
    engine.lightColumn(column);
    expect(skyAt(world, 5, 99, 5)).toBe(0);
    expect(skyAt(world, 6, 99, 5)).toBe(0);

    // Punch a hole: the shaft gets full sunlight and spills sideways.
    column.blocks[localIndex(5, 100, 5)] = BLOCK.air;
    engine.onBlockChanged(5, 100, 5, BLOCK.stone, BLOCK.air);
    expect(skyAt(world, 5, 99, 5)).toBe(MAX_LIGHT);
    expect(skyAt(world, 5, 60, 5)).toBe(MAX_LIGHT);
    expect(skyAt(world, 6, 99, 5)).toBe(14);
    expect(skyAt(world, 4, 99, 5)).toBe(14);

    // Seal it again: the shaft and everything lit through it goes dark.
    column.blocks[localIndex(5, 100, 5)] = BLOCK.stone;
    engine.onBlockChanged(5, 100, 5, BLOCK.air, BLOCK.stone);
    expect(skyAt(world, 5, 99, 5)).toBe(0);
    expect(skyAt(world, 6, 99, 5)).toBe(0);
    expect(skyAt(world, 5, 60, 5)).toBe(0);
  });

  it('relights after placing a torch and marks sections dirty', () => {
    const world = new TestLightWorld();
    const engine = new LightEngine(world);
    const column = world.addColumn(0, 0);
    fillRun(column, BLOCK.stone, 0, 60);
    engine.lightColumn(column);
    world.dirty.clear();

    column.blocks[localIndex(8, 61, 8)] = BLOCK.torch;
    engine.onBlockChanged(8, 61, 8, BLOCK.air, BLOCK.torch);
    expect(blockLightAt(world, 8, 61, 8)).toBe(14);
    expect(blockLightAt(world, 9, 61, 8)).toBe(13);
    expect(world.dirty.size).toBeGreaterThan(0);
    expect(world.dirty.has('8,61,8')).toBe(true);
  });

  it('widens light when an opaque block is removed', () => {
    const world = new TestLightWorld();
    const engine = new LightEngine(world);
    const column = world.addColumn(0, 0);
    fillRun(column, BLOCK.stone, 0, 60);
    // A 3x3 pillar of stone with a torch next to it.
    for (let y = 61; y <= 63; y++) {
      for (let z = 7; z <= 9; z++) column.blocks[localIndex(8, y, z)] = BLOCK.stone;
    }
    column.setGenerated(5, 61, 8, BLOCK.torch);
    engine.lightColumn(column);
    expect(blockLightAt(world, 6, 61, 8)).toBe(13);
    const before = blockLightAt(world, 9, 61, 8);
    expect(before).toBeGreaterThan(0);

    column.blocks[localIndex(8, 61, 8)] = BLOCK.air;
    engine.onBlockChanged(8, 61, 8, BLOCK.stone, BLOCK.air);
    expect(blockLightAt(world, 9, 61, 8)).toBeGreaterThan(before);
    expect(blockLightAt(world, 8, 61, 8)).toBe(11);
  });
});
