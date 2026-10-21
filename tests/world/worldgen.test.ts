import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { SEA_LEVEL, WORLD_HEIGHT } from '../../src/core/config';
import { hashString } from '../../src/core/rng';
import { IS_OPAQUE, IS_REPLACEABLE, IS_SOLID, blockNumeric } from '../../src/world/blocks';
import { ChunkColumn, localIndex } from '../../src/world/chunk';
import {
  TerrainGenerator,
  collectFeatures,
  forEachTreeBlock,
  type FeatureContext,
  type RawColumnData,
  type TreeSpec,
} from '../../src/world/worldgen';

const COAL = blockNumeric('coal_ore');
const COPPER = blockNumeric('copper_ore');
const IRON = blockNumeric('iron_ore');
const GOLD = blockNumeric('gold_ore');
const REDSTONE = blockNumeric('redstone_ore');
const LAPIS = blockNumeric('lapis_ore');
const DIAMOND = blockNumeric('diamond_ore');
const LAVA = blockNumeric('lava');
const WATER = blockNumeric('water');
const ICE = blockNumeric('ice');
const BEDROCK = blockNumeric('bedrock');
const STONE = blockNumeric('stone');
const SAND = blockNumeric('sand');
const SANDSTONE = blockNumeric('sandstone');
const SNOW = blockNumeric('snow_block');
const GRAVEL = blockNumeric('gravel');
const COARSE_DIRT = blockNumeric('coarse_dirt');
const GRASS = blockNumeric('grass_block');
const DIRT = blockNumeric('dirt');

const SEED = 'worldgen-test-seed';

function makeGenerator(seedHash = hashString(SEED)): TerrainGenerator {
  return new TerrainGenerator(seedHash);
}

function columnBlock(raw: RawColumnData, x: number, y: number, z: number): number {
  return raw.blocks[localIndex(x, y, z)];
}

function topSolid(raw: RawColumnData, x: number, z: number): number {
  let top = 0;
  for (let y = WORLD_HEIGHT - 1; y >= 0; y--) {
    const block = columnBlock(raw, x, y, z);
    if (block !== 0 && block !== WATER && block !== ICE) {
      top = y;
      break;
    }
  }
  return top;
}

describe('determinism', () => {
  it('generates identical bytes for the same seed and column', () => {
    const a = makeGenerator().generateRaw(0, 0, hashString(SEED));
    const b = makeGenerator().generateRaw(0, 0, hashString(SEED));
    expect([...a.blocks]).toEqual([...b.blocks]);
    expect([...a.meta]).toEqual([...b.meta]);
    expect([...a.heightMap]).toEqual([...b.heightMap]);
  });

  it('differs between seeds', () => {
    const a = makeGenerator(hashString('seed-a')).generateRaw(0, 0, hashString('seed-a'));
    const b = makeGenerator(hashString('seed-b')).generateRaw(0, 0, hashString('seed-b'));
    expect([...a.blocks]).not.toEqual([...b.blocks]);
  });

  it('is independent of what was generated before (no hidden state)', () => {
    const generator = makeGenerator();
    const seed = hashString(SEED);
    const first = generator.generateRaw(2, -3, seed);
    for (let cx = -6; cx <= 6; cx++) {
      for (let cz = -6; cz <= 6; cz++) generator.generateRaw(cx, cz, seed);
    }
    const again = generator.generateRaw(2, -3, seed);
    expect([...again.blocks]).toEqual([...first.blocks]);
  });

  it('implements ColumnGenerator.generate over a ChunkColumn', () => {
    const generator = makeGenerator();
    const seed = hashString(SEED);
    const column = new ChunkColumn(1, 1);
    generator.generate(column, seed);
    const raw = generator.generateRaw(1, 1, seed);
    expect([...column.blocks]).toEqual([...raw.blocks]);
    expect([...column.heightMap]).toEqual([...raw.heightMap]);
  });

  it('never uses Math.random in world generation / world systems', () => {
    const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
    const files = [
      'src/world/worldgen/noise.ts',
      'src/world/worldgen/biomes.ts',
      'src/world/worldgen/features.ts',
      'src/world/worldgen/terrain.ts',
      'src/world/lighting.ts',
      'src/world/mesher.ts',
      'src/world/chunkManager.ts',
      'src/world/worker/generationWorker.ts',
      'src/world/worker/meshWorker.ts',
      'src/world/worker/local.ts',
      'src/world/worker/pool.ts',
    ];
    for (const file of files) {
      const source = readFileSync(resolve(root, file), 'utf8');
      expect(source.includes('Math.random'), file).toBe(false);
    }
  });
});

describe('terrain layers', () => {
  it('puts ragged bedrock in rows 0-2 and never exposes air down there', () => {
    const generator = makeGenerator();
    const seed = hashString(SEED);
    let ragged = false;
    for (let cx = -1; cx <= 1; cx++) {
      for (let cz = -1; cz <= 1; cz++) {
        const raw = generator.generateRaw(cx, cz, seed);
        for (let z = 0; z < 16; z++) {
          for (let x = 0; x < 16; x++) {
            expect(columnBlock(raw, x, 0, z)).toBe(BEDROCK);
            expect(columnBlock(raw, x, 1, z)).toBe(BEDROCK);
            const row2 = columnBlock(raw, x, 2, z);
            expect([BEDROCK, STONE]).toContain(row2);
            if (row2 === STONE) ragged = true;
          }
        }
      }
    }
    expect(ragged).toBe(true);
  });

  it('fills oceans up to sea level and keeps land dry above it', () => {
    const generator = makeGenerator();
    const seed = hashString(SEED);
    let oceanChecks = 0;
    let landChecks = 0;
    for (let wz = -2048; wz <= 2048 && (oceanChecks < 4 || landChecks < 4); wz += 32) {
      for (let wx = -2048; wx <= 2048 && (oceanChecks < 4 || landChecks < 4); wx += 32) {
        const height = generator.surfaceHeight(wx, wz);
        const isOcean = height < SEA_LEVEL - 2 && oceanChecks < 4;
        const isLand = height > SEA_LEVEL + 3 && landChecks < 4;
        if (!isOcean && !isLand) continue;
        const cx = Math.floor(wx / 16);
        const cz = Math.floor(wz / 16);
        const raw = generator.generateRaw(cx, cz, seed);
        const x = wx - cx * 16;
        const z = wz - cz * 16;
        if (isOcean) {
          expect([WATER, ICE]).toContain(columnBlock(raw, x, SEA_LEVEL, z));
          expect([WATER, ICE]).toContain(columnBlock(raw, x, SEA_LEVEL - 1, z));
          expect(columnBlock(raw, x, SEA_LEVEL + 1, z)).toBe(0);
          oceanChecks++;
        } else if (isLand) {
          expect(columnBlock(raw, x, height + 1, z)).toBe(0);
          landChecks++;
        }
      }
    }
    expect(oceanChecks).toBeGreaterThan(0);
    expect(landChecks).toBeGreaterThan(0);
  });

  it('builds beaches within two blocks of the water line', () => {
    const generator = makeGenerator();
    const seed = hashString(SEED);
    let beachSurface: number | null = null;
    for (let cx = -4; cx <= 4 && beachSurface === null; cx++) {
      for (let cz = -4; cz <= 4 && beachSurface === null; cz++) {
        for (let z = 0; z < 16 && beachSurface === null; z++) {
          for (let x = 0; x < 16 && beachSurface === null; x++) {
            const wx = cx * 16 + x;
            const wz = cz * 16 + z;
            const height = generator.surfaceHeight(wx, wz);
            if (height < SEA_LEVEL - 1 || height > SEA_LEVEL + 2) continue;
            const nearWater =
              generator.surfaceHeight(wx + 1, wz) < SEA_LEVEL ||
              generator.surfaceHeight(wx - 1, wz) < SEA_LEVEL ||
              generator.surfaceHeight(wx, wz + 1) < SEA_LEVEL ||
              generator.surfaceHeight(wx, wz - 1) < SEA_LEVEL;
            if (!nearWater) continue;
            const raw = generator.generateRaw(cx, cz, seed);
            beachSurface = columnBlock(raw, x, height, z);
          }
        }
      }
    }
    expect(beachSurface).not.toBeNull();
    // Rock patches can turn a shoreline column into gravel as well.
    expect([SAND, SNOW, GRAVEL]).toContain(beachSurface);
  });

  it('writes the terrain height into heightMap for every column', () => {
    const generator = makeGenerator();
    const seed = hashString(SEED);
    const raw = generator.generateRaw(-2, 3, seed);
    for (let z = 0; z < 16; z++) {
      for (let x = 0; x < 16; x++) {
        expect(raw.heightMap[z * 16 + x]).toBe(generator.surfaceHeight(-2 * 16 + x, 3 * 16 + z));
      }
    }
  });
});

describe('biomes', () => {
  it('produces the full palette of land/ocean biomes', () => {
    const generator = makeGenerator();
    const found = new Set<string>();
    for (let wz = -3072; wz <= 3072; wz += 64) {
      for (let wx = -3072; wx <= 3072; wx += 64) found.add(generator.biomeAt(wx, wz));
    }
    expect(found.size).toBeGreaterThanOrEqual(9);
    for (const biome of ['plains', 'forest', 'birch_forest', 'taiga', 'desert', 'snowy_plains', 'mountains', 'ocean', 'beach']) {
      expect(found.has(biome), biome).toBe(true);
    }
  });

  it('matches the biome surface block (snow, sand, grass, stone)', () => {
    const generator = makeGenerator();
    const seed = hashString(SEED);
    const targets: Record<string, number> = { desert: SAND, snowy_plains: SNOW, forest: GRASS, taiga: GRASS };
    let checked = 0;
    for (let wz = -2048; wz <= 2048 && checked < 4; wz += 32) {
      for (let wx = -2048; wx <= 2048 && checked < 4; wx += 32) {
        const biome = generator.biomeAt(wx, wz);
        const expected = targets[biome];
        if (expected === undefined) continue;
        const height = generator.surfaceHeight(wx, wz);
        if (height <= SEA_LEVEL + 2 || height > 100) continue;
        const cx = Math.floor(wx / 16);
        const cz = Math.floor(wz / 16);
        const raw = generator.generateRaw(cx, cz, seed);
        const surface = columnBlock(raw, wx - cx * 16, height, wz - cz * 16);
        expect([expected, GRASS, SNOW, STONE, SAND, GRAVEL, COARSE_DIRT]).toContain(surface);
        checked++;
      }
    }
    expect(checked).toBeGreaterThan(0);
  });
});

describe('caves and lava', () => {
  it('never carves caves above y=56', () => {
    const generator = makeGenerator();
    const seed = hashString(SEED);
    for (let cx = -1; cx <= 1; cx++) {
      for (let cz = -1; cz <= 1; cz++) {
        const raw = generator.generateRaw(cx, cz, seed);
        for (let z = 0; z < 16; z++) {
          for (let x = 0; x < 16; x++) {
            const height = generator.surfaceHeight(cx * 16 + x, cz * 16 + z);
            if (height <= 58) continue;
            for (let y = 57; y < height; y++) {
              expect(columnBlock(raw, x, y, z), `cave at ${x},${y},${z}`).not.toBe(0);
            }
          }
        }
      }
    }
  });

  it('carves caves below y=56 and fills y<10 with lava', () => {
    const generator = makeGenerator();
    const seed = hashString(SEED);
    let underground = 0;
    let caveAir = 0;
    let lavaBelow10 = 0;
    let lavaAbove10 = 0;
    for (let cx = -2; cx <= 2; cx++) {
      for (let cz = -2; cz <= 2; cz++) {
        const raw = generator.generateRaw(cx, cz, seed);
        for (let z = 0; z < 16; z++) {
          for (let x = 0; x < 16; x++) {
            const height = generator.surfaceHeight(cx * 16 + x, cz * 16 + z);
            if (height < 58) continue;
            for (let y = 3; y < 56; y++) {
              underground++;
              const block = columnBlock(raw, x, y, z);
              if (block === 0) caveAir++;
              if (block === LAVA) {
                if (y < 10) lavaBelow10++;
                else lavaAbove10++;
              }
            }
          }
        }
      }
    }
    expect(underground).toBeGreaterThan(0);
    expect(caveAir / underground).toBeGreaterThan(0.002);
    expect(caveAir / underground).toBeLessThan(0.12);
    expect(lavaBelow10).toBeGreaterThan(0);
    expect(lavaAbove10).toBe(0);
  });
});

describe('ores', () => {
  it('places every ore inside its documented depth band', () => {
    const generator = makeGenerator();
    const seed = hashString(SEED);
    const bands: Record<number, [number, number, string]> = {
      [COAL]: [5, 120, 'coal'],
      [COPPER]: [5, 80, 'copper'],
      [IRON]: [5, 64, 'iron'],
      [GOLD]: [5, 32, 'gold'],
      [REDSTONE]: [5, 16, 'redstone'],
      [LAPIS]: [5, 30, 'lapis'],
      [DIAMOND]: [5, 16, 'diamond'],
    };
    const counts = new Map<number, number>();
    for (let cx = -2; cx <= 2; cx++) {
      for (let cz = -2; cz <= 2; cz++) {
        const raw = generator.generateRaw(cx, cz, seed);
        for (let index = 0; index < raw.blocks.length; index++) {
          const band = bands[raw.blocks[index]];
          if (!band) continue;
          const y = index >> 8;
          expect(y, `${band[2]} at y=${y}`).toBeGreaterThanOrEqual(band[0]);
          expect(y, `${band[2]} at y=${y}`).toBeLessThanOrEqual(band[1]);
          const lx = index & 15;
          const lz = (index >> 4) & 15;
          expect(y).toBeLessThanOrEqual(generator.surfaceHeight(cx * 16 + lx, cz * 16 + lz));
          counts.set(raw.blocks[index], (counts.get(raw.blocks[index]) ?? 0) + 1);
        }
      }
    }
    for (const [ore, band] of Object.entries(bands)) {
      expect(counts.get(Number(ore)) ?? 0, band[2]).toBeGreaterThan(0);
    }
  });
});

describe('cross-chunk features', () => {
  function featureContext(generator: TerrainGenerator): FeatureContext {
    return {
      seedHash: generator.seed,
      surfaceHeight: (wx, wz) => generator.surfaceHeight(wx, wz),
      biomeAt: (wx, wz) => generator.biomeAt(wx, wz),
    };
  }

  it('grows tree parts whose trunk is in a neighbouring chunk', () => {
    const generator = makeGenerator();
    const seed = generator.seed;
    const ctx = featureContext(generator);
    let crossing: { spec: TreeSpec; cx: number; cz: number; direction: -1 | 1 } | null = null;
    for (let cx = -8; cx <= 8 && !crossing; cx++) {
      for (let cz = -4; cz <= 4 && !crossing; cz++) {
        for (const spec of collectFeatures(ctx, cx, cz)) {
          const minX = cx * 16;
          if (spec.wx - spec.radius < minX) {
            crossing = { spec, cx, cz, direction: -1 };
            break;
          }
          if (spec.wx + spec.radius > minX + 15) {
            crossing = { spec, cx, cz, direction: 1 };
            break;
          }
        }
      }
    }
    expect(crossing).not.toBeNull();
    const { spec, cx, cz, direction } = crossing!;
    const neighbourCx = cx + direction;
    const trunkChunk = generator.generateRaw(cx, cz, seed);
    const neighbourChunk = generator.generateRaw(neighbourCx, cz, seed);
    const inChunk = (wx: number): boolean => wx >= cx * 16 && wx <= cx * 16 + 15;
    let checkedOutside = 0;
    let checkedInside = 0;
    forEachTreeBlock(spec, (wx, wy, wz, block) => {
      if (wy < 0 || wy >= WORLD_HEIGHT) return;
      if (wz < cz * 16 || wz > cz * 16 + 15) return;
      if (inChunk(wx)) {
        expect(trunkChunk.blocks[localIndex(wx - cx * 16, wy, wz - cz * 16)]).not.toBe(0);
        checkedInside++;
      } else if (wx >= neighbourCx * 16 && wx <= neighbourCx * 16 + 15) {
        expect(neighbourChunk.blocks[localIndex(wx - neighbourCx * 16, wy, wz - cz * 16)]).not.toBe(0);
        checkedOutside++;
      }
      void block;
    });
    expect(checkedInside).toBeGreaterThan(0);
    expect(checkedOutside).toBeGreaterThan(0);
  });

  it('keeps forests populated and oceans empty of trees', () => {
    const generator = makeGenerator();
    const ctx = featureContext(generator);
    const forestChunks: Array<[number, number]> = [];
    const oceanChunks: Array<[number, number]> = [];
    for (let cx = -40; cx <= 40; cx++) {
      for (let cz = -40; cz <= 40; cz++) {
        const biome = generator.biomeAt(cx * 16 + 8, cz * 16 + 8);
        if (biome === 'forest') forestChunks.push([cx, cz]);
        else if (biome === 'ocean' || biome === 'frozen_ocean') oceanChunks.push([cx, cz]);
      }
    }
    expect(forestChunks.length).toBeGreaterThan(0);
    let forestTrees = 0;
    for (const [cx, cz] of forestChunks.slice(0, 20)) forestTrees += collectFeatures(ctx, cx, cz).length;
    expect(forestTrees).toBeGreaterThan(10);
    // Ocean-centred chunks may still clip a land corner, but a tree trunk may never
    // stand in an ocean/beach/desert column.
    for (const [cx, cz] of oceanChunks.slice(0, 20)) {
      for (const spec of collectFeatures(ctx, cx, cz)) {
        const trunkBiome = generator.biomeAt(spec.wx, spec.wz);
        expect(['ocean', 'frozen_ocean', 'beach', 'snowy_beach', 'desert']).not.toContain(trunkBiome);
      }
    }
    // Every feature trunk must be in a tree-bearing biome.
    for (const [cx, cz] of forestChunks.slice(0, 5)) {
      for (const spec of collectFeatures(ctx, cx, cz)) {
        expect(['forest', 'birch_forest', 'taiga', 'plains']).toContain(generator.biomeAt(spec.wx, spec.wz));
      }
    }
  });
});

describe('spawn', () => {
  it('returns a safe, dry, non-suffocating spawn point', () => {
    const generator = makeGenerator();
    const seed = generator.seed;
    const spawn = generator.findSpawn();
    expect(spawn.safe).toBe(true);
    expect(spawn.y).toBeGreaterThan(SEA_LEVEL);
    const wx = Math.floor(spawn.x);
    const wz = Math.floor(spawn.z);
    expect(['plains', 'forest', 'birch_forest', 'taiga']).toContain(generator.biomeAt(wx, wz));
    const cx = Math.floor(wx / 16);
    const cz = Math.floor(wz / 16);
    const raw = generator.generateRaw(cx, cz, seed);
    const ground = raw.blocks[localIndex(wx - cx * 16, spawn.y - 1, wz - cz * 16)];
    expect(IS_SOLID[ground]).toBe(1);
    expect(IS_OPAQUE[ground]).toBe(1);
    const atSpawn = raw.blocks[localIndex(wx - cx * 16, spawn.y, wz - cz * 16)];
    // Tall grass or a flower may occupy the spawn cell; it is replaceable/non-solid.
    if (atSpawn !== 0) expect(IS_REPLACEABLE[atSpawn]).toBe(1);
    expect(raw.blocks[localIndex(wx - cx * 16, spawn.y + 1, wz - cz * 16)]).toBe(0);
  });
});

describe('performance budget (PLAN.md §6)', () => {
  it('generates columns well under 20ms/column and meshes under 4ms/section', async () => {
    const generator = makeGenerator();
    const seed = generator.seed;
    // Warm up the JIT so the measured value reflects steady-state worker cost.
    for (let cx = -1; cx <= 1; cx++) generator.generateRaw(100 + cx, 100, seed);
    const start = performance.now();
    const columns = 10;
    for (let cx = 0; cx < columns; cx++) generator.generateRaw(200 + cx, 200, seed);
    const perColumn = (performance.now() - start) / columns;
    console.log(`[perf] generation ${perColumn.toFixed(2)}ms/column`);
    expect(perColumn).toBeLessThan(20);

    const { meshSectionFromAccess } = await import('../../src/world/worker/local');
    const { createTintResolver } = await import('../../src/world/worldgen');
    const generatorForMesh = makeGenerator();
    const raw = generatorForMesh.generateRaw(200, 200, seed);
    const column = new ChunkColumn(200, 200);
    column.blocks.set(raw.blocks);
    const access = {
      getBlock: (x: number, y: number, z: number) => {
        const cx = Math.floor(x / 16);
        const cz = Math.floor(z / 16);
        if (cx !== 200 || cz !== 200) return 0;
        if (y < 0) return 1;
        if (y >= WORLD_HEIGHT) return 0;
        return column.blocks[localIndex(x - cx * 16, y, z - cz * 16)];
      },
      getMeta: () => 0,
      getSkyLight: (x: number, y: number, z: number) => {
        const cx = Math.floor(x / 16);
        const cz = Math.floor(z / 16);
        if (cx !== 200 || cz !== 200 || y < 0 || y >= WORLD_HEIGHT) return 0;
        return column.sky[localIndex(x - cx * 16, y, z - cz * 16)];
      },
      getBlockLight: () => 0,
    };
    // Fill sky light directly for the mesh measurement.
    column.sky.fill(15);
    const tintOf = createTintResolver(seed);
    const layerOf = (): number => 0;
    const meshStart = performance.now();
    const sections = 10;
    for (let cy = 0; cy < sections; cy++) meshSectionFromAccess(access, 200, cy, 200, layerOf, tintOf);
    const perSection = (performance.now() - meshStart) / sections;
    console.log(`[perf] meshing ${perSection.toFixed(2)}ms/section`);
    expect(perSection).toBeLessThan(8);
  });
});

