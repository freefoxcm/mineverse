import { describe, expect, it } from 'vitest';
import { SEA_LEVEL, WORLD_HEIGHT } from '../../src/core/config';
import { hashString } from '../../src/core/rng';
import { IS_SOLID, blockNumeric } from '../../src/world/blocks';
import { localIndex } from '../../src/world/chunk';
import {
  TerrainGenerator,
  collectFeatures,
  featureIntersectsChunk,
  forEachTreeBlock,
  makeTreeSpec,
  type FeatureContext,
  type RawColumnData,
  type TreeSpec,
} from '../../src/world/worldgen';

const SEED_TEXT = 'organic-world-test';
const seedHash = hashString(SEED_TEXT);
const gen = new TerrainGenerator(seedHash);
const sampleCache = new Map<string, ReturnType<TerrainGenerator['sample']>>();
function sampleAt(wx: number, wz: number): ReturnType<TerrainGenerator['sample']> {
  const key = `${wx},${wz}`;
  const cached = sampleCache.get(key);
  if (cached) return cached;
  const value = gen.sample(wx, wz);
  sampleCache.set(key, value);
  return value;
}
const ctx: FeatureContext = {
  seedHash,
  surfaceHeight: (wx, wz) => sampleAt(wx, wz).height,
  biomeAt: (wx, wz) => sampleAt(wx, wz).biome,
};

const LOG_IDS = new Set(['oak_log', 'birch_log', 'spruce_log'].map(blockNumeric));
const LEAF_IDS = new Set(['oak_leaves', 'birch_leaves', 'spruce_leaves'].map(blockNumeric));
const TALL_GRASS = blockNumeric('tall_grass');
const POPPY = blockNumeric('poppy');
const DANDELION = blockNumeric('dandelion');
const CACTUS = blockNumeric('cactus');
const GRASS = blockNumeric('grass_block');
const SAND = blockNumeric('sand');
const SANDSTONE = blockNumeric('sandstone');
const SNOW = blockNumeric('snow_block');
const STONE = blockNumeric('stone');
const GRAVEL = blockNumeric('gravel');
const COARSE_DIRT = blockNumeric('coarse_dirt');
const ROCK_IDS = new Set([STONE, GRAVEL, COARSE_DIRT]);

// ---------------------------------------------------------------------------
// Shared caches so the organic checks stay fast (one generation per column).
// ---------------------------------------------------------------------------

const rawCache = new Map<string, RawColumnData>();
const specCache = new Map<string, TreeSpec[]>();

function raw(cx: number, cz: number): RawColumnData {
  const key = `${cx},${cz}`;
  const cached = rawCache.get(key);
  if (cached) return cached;
  const value = gen.generateRaw(cx, cz, seedHash);
  rawCache.set(key, value);
  return value;
}

function block(wx: number, wy: number, wz: number): number {
  if (wy < 0 || wy >= WORLD_HEIGHT) return 0;
  const cx = Math.floor(wx / 16);
  const cz = Math.floor(wz / 16);
  return raw(cx, cz).blocks[localIndex(wx - cx * 16, wy, wz - cz * 16)];
}

function specs(cx: number, cz: number): TreeSpec[] {
  const key = `${cx},${cz}`;
  const cached = specCache.get(key);
  if (cached) return cached;
  const value = collectFeatures(ctx, cx, cz);
  specCache.set(key, value);
  return value;
}

function findTree(kind: TreeSpec['kind'], predicate: (spec: TreeSpec) => boolean = () => true): TreeSpec | null {
  for (let radius = 0; radius <= 32; radius++) {
    for (let cx = -radius; cx <= radius; cx++) {
      for (let cz = -radius; cz <= radius; cz++) {
        if (Math.max(Math.abs(cx), Math.abs(cz)) !== radius) continue;
        for (const spec of specs(cx, cz)) {
          if (spec.kind === kind && predicate(spec)) return spec;
        }
      }
    }
  }
  return null;
}

interface Shape {
  readonly cells: Map<string, number>;
  readonly logs: Array<[number, number, number]>;
  readonly leaves: Array<[number, number, number]>;
  readonly leafCells: Set<string>;
}

function shapeOf(spec: TreeSpec): Shape {
  const cells = new Map<string, number>();
  forEachTreeBlock(spec, (x, y, z, blockId) => cells.set(`${x},${y},${z}`, blockId));
  const logs: Array<[number, number, number]> = [];
  const leaves: Array<[number, number, number]> = [];
  const leafCells = new Set<string>();
  for (const [key, blockId] of cells) {
    const [x, y, z] = key.split(',').map(Number);
    if (LOG_IDS.has(blockId)) logs.push([x, y, z]);
    else {
      leaves.push([x, y, z]);
      leafCells.add(key);
    }
  }
  return { cells, logs, leaves, leafCells };
}

/** Number of filled cells (leaf or log) of a horizontal square layer. */
function layerCount(shape: Shape, cx: number, y: number, cz: number, radius: number): number {
  let count = 0;
  for (let dx = -radius; dx <= radius; dx++) {
    for (let dz = -radius; dz <= radius; dz++) {
      if (shape.cells.has(`${cx + dx},${y},${cz + dz}`)) count++;
    }
  }
  return count;
}

/** Number of leaf blocks in a horizontal square layer (trunk excluded, so gaps show). */
function layerLeafCount(shape: Shape, cx: number, y: number, cz: number, radius: number): number {
  let count = 0;
  for (let dx = -radius; dx <= radius; dx++) {
    for (let dz = -radius; dz <= radius; dz++) {
      if (shape.leafCells.has(`${cx + dx},${y},${cz + dz}`)) count++;
    }
  }
  return count;
}

function findBiomeChunk(biome: string, minHeight = 64): [number, number] | null {
  for (let radius = 0; radius <= 48; radius++) {
    for (let cx = -radius; cx <= radius; cx++) {
      for (let cz = -radius; cz <= radius; cz++) {
        if (Math.max(Math.abs(cx), Math.abs(cz)) !== radius) continue;
        const sample = sampleAt(cx * 16 + 8, cz * 16 + 8);
        if (sample.biome === biome && sample.height >= minHeight) return [cx, cz];
      }
    }
  }
  return null;
}

describe('organic tree shapes', () => {
  it('oak crowns are irregular leaf clusters with holes, never a solid 5x5 box', () => {
    const oak = findTree('oak', (spec) => spec.radius === 2);
    expect(oak).not.toBeNull();
    const shape = shapeOf(oak!);
    const topY = oak!.groundY + oak!.trunkHeight;
    // The two main crown layers each drop corners/leaf cells: not 25/25 filled.
    for (const y of [topY, topY - 1]) {
      const filled = layerCount(shape, oak!.wx, y, oak!.wz, 2);
      expect(filled).toBeGreaterThan(8);
      expect(filled).toBeLessThan(22);
    }
    // The crown spans at least two vertical layers (not one flat plate).
    const leafYs = new Set(shape.leaves.map(([, y]) => y));
    expect(leafYs.size).toBeGreaterThanOrEqual(3);
    // No trunk column overrides leaves: every leaf position has no log.
    for (const [key] of shape.leafCells) {
      expect(LOG_IDS.has(shape.cells.get(key)!)).toBe(false);
    }
  });

  it('rare big oaks have a wide crown and at least one diagonal branch', () => {
    const big = findTree('oak', (spec) => spec.radius === 3);
    expect(big).not.toBeNull();
    const shape = shapeOf(big!);
    const offTrunkLogs = shape.logs.filter(([x, , z]) => x !== big!.wx || z !== big!.wz);
    expect(offTrunkLogs.length).toBeGreaterThan(0);
    // Branch logs are attached to the trunk/crown instead of floating.
    for (const [x, y, z] of offTrunkLogs) {
      let supported = false;
      for (const [dx, dy, dz] of [
        [1, 0, 0],
        [-1, 0, 0],
        [0, 1, 0],
        [0, -1, 0],
        [0, 0, 1],
        [0, 0, -1],
      ]) {
        if (LOG_IDS.has(shape.cells.get(`${x + dx},${y + dy},${z + dz}`) ?? 0)) supported = true;
      }
      expect(supported, `branch log ${x},${y},${z}`).toBe(true);
    }
    const maxReach = Math.max(...shape.leaves.map(([x, , z]) => Math.max(Math.abs(x - big!.wx), Math.abs(z - big!.wz))));
    expect(maxReach).toBeGreaterThanOrEqual(2);
  });

  it('birches are taller and lighter than oaks', () => {
    const oaks: TreeSpec[] = [];
    const birches: TreeSpec[] = [];
    for (let cx = -30; cx <= 30; cx++) {
      for (let cz = -30; cz <= 30; cz++) {
        for (const spec of specs(cx, cz)) {
          if (spec.kind === 'oak') oaks.push(spec);
          else if (spec.kind === 'birch') birches.push(spec);
        }
      }
    }
    expect(oaks.length).toBeGreaterThan(10);
    expect(birches.length).toBeGreaterThan(10);
    const avg = (values: number[]): number => values.reduce((sum, value) => sum + value, 0) / values.length;
    expect(avg(birches.map((spec) => spec.trunkHeight))).toBeGreaterThan(avg(oaks.map((spec) => spec.trunkHeight)));
    expect(avg(birches.map((spec) => shapeOf(spec).leaves.length))).toBeLessThan(avg(oaks.map((spec) => shapeOf(spec).leaves.length)));
  });

  it('spruces are conical towers with exposed trunk gaps between tiers', () => {
    const spruce = findTree('spruce');
    expect(spruce).not.toBeNull();
    const shape = shapeOf(spruce!);
    const topY = spruce!.groundY + spruce!.trunkHeight;
    expect(spruce!.trunkHeight).toBeGreaterThanOrEqual(7);
    // Tip leaf above the trunk.
    expect(shape.cells.has(`${spruce!.wx},${topY + 1},${spruce!.wz}`)).toBe(true);
    // Radius never exceeds 2 and at least one layer shows bare trunk between tiers.
    let sawGap = false;
    for (let y = spruce!.groundY + 2; y <= topY; y++) {
      const leaves = layerLeafCount(shape, spruce!.wx, y, spruce!.wz, 2);
      if (leaves === 0) sawGap = true;
      expect(layerCount(shape, spruce!.wx, y, spruce!.wz, 2)).toBeLessThanOrEqual(21);
    }
    expect(sawGap).toBe(true);
  });

  it('tree shapes are deterministic and independent of the observing chunk', () => {
    const first = makeTreeSpec(ctx, 'oak', 123, -45, gen.surfaceHeight(123, -45));
    const second = makeTreeSpec(ctx, 'oak', 123, -45, gen.surfaceHeight(123, -45));
    expect(second).toEqual(first);
    expect([...shapeOf(second).cells.entries()]).toEqual([...shapeOf(first).cells.entries()]);

    // A tree crossing a chunk border must be reported identically from both chunks.
    const crossing = findTree('oak', (spec) => {
      const chunkOfTrunk = Math.floor(spec.wx / 16);
      return spec.wx - spec.radius < chunkOfTrunk * 16 || spec.wx + spec.radius > chunkOfTrunk * 16 + 15;
    });
    expect(crossing).not.toBeNull();
    const trunkCx = Math.floor(crossing!.wx / 16);
    const trunkCz = Math.floor(crossing!.wz / 16);
    const fromChunk = specs(trunkCx, trunkCz).find((spec) => spec.seed === crossing!.seed);
    const fromNeighbour = specs(trunkCx - 1, trunkCz).find((spec) => spec.seed === crossing!.seed) ??
      specs(trunkCx + 1, trunkCz).find((spec) => spec.seed === crossing!.seed);
    expect(fromChunk).toBeDefined();
    if (fromChunk && fromNeighbour) expect(fromNeighbour).toEqual(fromChunk);
    expect(featureIntersectsChunk(crossing!, trunkCx - 1, trunkCz) || featureIntersectsChunk(crossing!, trunkCx + 1, trunkCz)).toBe(true);
  });
});

describe('tree legality in the generated world', () => {
  it('logs are rooted and every leaf is attached (no floating blocks)', () => {
    const anchor = findBiomeChunk('forest');
    expect(anchor).not.toBeNull();
    const [acx, acz] = anchor!;
    const R = 2;
    // Generate one extra ring so every neighbour used by the checks exists.
    for (let cx = acx - R - 1; cx <= acx + R + 1; cx++) {
      for (let cz = acz - R - 1; cz <= acz + R + 1; cz++) raw(cx, cz);
    }
    const minX = (acx - R) * 16;
    const maxX = (acx + R) * 16 + 15;
    const minZ = (acz - R) * 16;
    const maxZ = (acz + R) * 16 + 15;
    let logs = 0;
    let leaves = 0;
    for (let wz = minZ; wz <= maxZ; wz++) {
      for (let wx = minX; wx <= maxX; wx++) {
        const height = gen.surfaceHeight(wx, wz);
        // Trees only exist above sea level; cap the scan to keep the test fast.
        for (let y = Math.max(0, height - 2); y < Math.min(WORLD_HEIGHT, height + 20); y++) {
          const id = block(wx, y, wz);
          if (LOG_IDS.has(id)) {
            logs++;
            expect(y).toBeGreaterThanOrEqual(height);
            let supported = IS_SOLID[block(wx, y - 1, wz)] === 1;
            if (!supported) {
              for (const [dx, dy, dz] of [
                [1, 0, 0],
                [-1, 0, 0],
                [0, 1, 0],
                [0, -1, 0],
                [0, 0, 1],
                [0, 0, -1],
              ]) {
                if (LOG_IDS.has(block(wx + dx, y + dy, wz + dz))) supported = true;
              }
            }
            expect(supported, `floating log at ${wx},${y},${wz}`).toBe(true);
          } else if (LEAF_IDS.has(id)) {
            leaves++;
            expect(y).toBeGreaterThan(height);
            let attached = false;
            for (let dx = -1; dx <= 1 && !attached; dx++) {
              for (let dy = -1; dy <= 1 && !attached; dy++) {
                for (let dz = -1; dz <= 1; dz++) {
                  if (dx === 0 && dy === 0 && dz === 0) continue;
                  if (block(wx + dx, y + dy, wz + dz) !== 0) {
                    attached = true;
                    break;
                  }
                }
              }
            }
            expect(attached, `floating leaf at ${wx},${y},${wz}`).toBe(true);
          }
        }
      }
    }
    expect(logs).toBeGreaterThan(20);
    expect(leaves).toBeGreaterThan(100);
  });
});

describe('biome vegetation and surface variety', () => {
  function vegetationAround(cx: number, cz: number, biome: string): { grass: number; flowers: number; logs: number; cacti: number; columns: number } {
    let grass = 0;
    let flowers = 0;
    let logs = 0;
    let cacti = 0;
    let columns = 0;
    for (let dcx = -1; dcx <= 1; dcx++) {
      for (let dcz = -1; dcz <= 1; dcz++) {
        for (let z = 0; z < 16; z++) {
          for (let x = 0; x < 16; x++) {
            const wx = (cx + dcx) * 16 + x;
            const wz = (cz + dcz) * 16 + z;
            if (gen.biomeAt(wx, wz) !== biome) continue;
            columns++;
            const h = gen.surfaceHeight(wx, wz);
            const above = block(wx, h + 1, wz);
            if (above === TALL_GRASS) grass++;
            else if (above === POPPY || above === DANDELION) flowers++;
            else if (above === CACTUS) cacti++;
            if (LOG_IDS.has(block(wx, h + 1, wz))) logs++;
          }
        }
      }
    }
    return { grass, flowers, logs, cacti, columns };
  }

  it('plains and forests are flowery meadows with dense tree cover', () => {
    const plains = findBiomeChunk('plains');
    const forest = findBiomeChunk('forest');
    expect(plains).not.toBeNull();
    expect(forest).not.toBeNull();
    const plainsStats = vegetationAround(plains![0], plains![1], 'plains');
    const forestStats = vegetationAround(forest![0], forest![1], 'forest');
    expect(plainsStats.columns).toBeGreaterThan(100);
    expect(forestStats.columns).toBeGreaterThan(100);
    expect(plainsStats.grass).toBeGreaterThan(5);
    expect(forestStats.grass).toBeGreaterThan(5);
    expect(plainsStats.flowers + forestStats.flowers).toBeGreaterThan(4);
    // Forest tree density wins by a wide margin (trunk columns with a log above ground).
    expect(forestStats.logs).toBeGreaterThan(plainsStats.logs);
  });

  it('deserts keep sand surfaces, cacti and no grass', () => {
    const desert = findBiomeChunk('desert');
    expect(desert).not.toBeNull();
    const stats = vegetationAround(desert![0], desert![1], 'desert');
    expect(stats.columns).toBeGreaterThan(100);
    expect(stats.grass).toBe(0);
    expect(stats.flowers).toBe(0);
    expect(stats.cacti).toBeGreaterThan(0);
    for (let dcx = -1; dcx <= 1; dcx++) {
      for (let dcz = -1; dcz <= 1; dcz++) {
        for (let z = 0; z < 16; z += 3) {
          for (let x = 0; x < 16; x += 3) {
            const wx = (desert![0] + dcx) * 16 + x;
            const wz = (desert![1] + dcz) * 16 + z;
            if (gen.biomeAt(wx, wz) !== 'desert') continue;
            const h = gen.surfaceHeight(wx, wz);
            if (h <= SEA_LEVEL + 2) continue;
            expect([SAND, SANDSTONE, GRAVEL]).toContain(block(wx, h, wz));
          }
        }
      }
    }
  });

  it('snowy biomes keep snow on top', () => {
    const snowy = findBiomeChunk('snowy_plains');
    expect(snowy).not.toBeNull();
    let snowColumns = 0;
    let checked = 0;
    for (let z = 0; z < 16; z++) {
      for (let x = 0; x < 16; x++) {
        const wx = snowy![0] * 16 + x;
        const wz = snowy![1] * 16 + z;
        if (gen.biomeAt(wx, wz) !== 'snowy_plains') continue;
        const h = gen.surfaceHeight(wx, wz);
        if (h <= SEA_LEVEL + 2) continue;
        checked++;
        if (block(wx, h, wz) === SNOW) snowColumns++;
      }
    }
    expect(checked).toBeGreaterThan(0);
    expect(snowColumns / checked).toBeGreaterThan(0.5);
  });

  it('steep/high ground shows bare stone/gravel/coarse-dirt patches without floating', () => {
    const highland = findBiomeChunk('mountains');
    expect(highland).not.toBeNull();
    let rocky = 0;
    let land = 0;
    for (let dcx = -1; dcx <= 1; dcx++) {
      for (let dcz = -1; dcz <= 1; dcz++) {
        for (let z = 0; z < 16; z++) {
          for (let x = 0; x < 16; x++) {
            const wx = (highland![0] + dcx) * 16 + x;
            const wz = (highland![1] + dcz) * 16 + z;
            const h = gen.surfaceHeight(wx, wz);
            if (h <= SEA_LEVEL + 2) continue;
            land++;
            const surface = block(wx, h, wz);
            if (ROCK_IDS.has(surface)) rocky++;
            // Stone/gravel/coarse dirt only ever replaces the top block: the block
            // below is still solid terrain, so nothing can float.
            expect(IS_SOLID[block(wx, h - 1, wz)]).toBe(1);
          }
        }
      }
    }
    expect(land).toBeGreaterThan(100);
    expect(rocky / land).toBeGreaterThan(0.02);
    expect(rocky / land).toBeLessThan(0.8);
  });

  it('flat lowland plains stay mostly grassy (patches are slope/highland features)', () => {
    const plains = findBiomeChunk('plains', 68);
    expect(plains).not.toBeNull();
    let grassSurface = 0;
    let rockySurface = 0;
    let flatLand = 0;
    for (let dcx = -1; dcx <= 1; dcx++) {
      for (let dcz = -1; dcz <= 1; dcz++) {
        for (let z = 0; z < 16; z += 2) {
          for (let x = 0; x < 16; x += 2) {
            const wx = (plains![0] + dcx) * 16 + x;
            const wz = (plains![1] + dcz) * 16 + z;
            const h = gen.surfaceHeight(wx, wz);
            if (h <= SEA_LEVEL + 3 || h > 82) continue;
            if (gen.biomeAt(wx, wz) !== 'plains') continue;
            flatLand++;
            const surface = block(wx, h, wz);
            if (surface === GRASS) grassSurface++;
            else if (ROCK_IDS.has(surface)) rockySurface++;
          }
        }
      }
    }
    expect(flatLand).toBeGreaterThan(20);
    expect(grassSurface / flatLand).toBeGreaterThan(0.7);
    expect(rockySurface / flatLand).toBeLessThan(0.15);
  });
});

