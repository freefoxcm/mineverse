/**
 * Multi-noise terrain generator (M1).
 *
 * One `TerrainGenerator` implements the `ColumnGenerator` contract from
 * `src/world/world.ts`: `generate(column, seedHash)` fills a 16x16x160 column
 * deterministically. The same class is used inside the module worker via
 * `generateInto` / `generateRaw`, so main-thread fallback and worker output are
 * byte-identical.
 *
 * Layers of the world:
 *  - climate noises -> biome + base surface height (oceans, plains, mountains...)
 *  - 3D cave field (cheese caverns + spaghetti tunnels), carved only below y=56,
 *    lava below y=10
 *  - depth-banded ore veins
 *  - 3x3 chunk feature neighbourhood for seamless trees/cacti
 *  - ground cover (grass, flowers, reeds) and safe spawn search
 */
import { SEA_LEVEL, WORLD_HEIGHT } from '../../core/config';
import { Rand, hash2f, hash2i } from '../../core/rng';
import { IS_REPLACEABLE, IS_SOLID, TINT_KIND, blockNumeric } from '../blocks';
import { localIndex, type ChunkColumn } from '../chunk';
import type { ColumnGenerator } from '../world';
import { biomeDef, classifyBiome, type BiomeId, type ClimateSample } from './biomes';
import { collectFeatures, featureIntersectsChunk, forEachTreeBlock, type FeatureContext, type TreeSpec } from './features';
import { clamp, fbm2, lerpRange, ridged2, smoothstep, valueNoise3 } from './noise';

const STONE = blockNumeric('stone');
const BEDROCK = blockNumeric('bedrock');
const WATER = blockNumeric('water');
const LAVA = blockNumeric('lava');
const AIR = 0;
const GRASS = blockNumeric('grass_block');
const DIRT = blockNumeric('dirt');
const SAND = blockNumeric('sand');
const SANDSTONE = blockNumeric('sandstone');
const GRAVEL = blockNumeric('gravel');
const COARSE_DIRT = blockNumeric('coarse_dirt');
const CLAY = blockNumeric('clay');
const SNOW = blockNumeric('snow_block');
const ICE = blockNumeric('ice');
const TALL_GRASS = blockNumeric('tall_grass');
const POPPY = blockNumeric('poppy');
const DANDELION = blockNumeric('dandelion');
const DEAD_BUSH = blockNumeric('dead_bush');
const SUGAR_CANE = blockNumeric('sugar_cane');
const CACTUS = blockNumeric('cactus');

type LeafTable = Uint8Array;
const LEAF_TABLE: LeafTable = new Uint8Array(256);
for (const name of ['oak_leaves', 'birch_leaves', 'spruce_leaves']) {
  LEAF_TABLE[blockNumeric(name)] = 1;
}

/** Biomes that count as "non-water grass" for the preferred spawn search. */
const GRASS_BIOMES = new Set<BiomeId>(['plains', 'forest', 'birch_forest', 'taiga']);

const SALT = {
  continent: 0x1b873593,
  erosion: 0x2c1b3c6d,
  temperature: 0x297a2d39,
  humidity: 0x0f5d4e8b,
  ridge: 0x45d9f3b1,
  hills: 0x7f4a7c15,
  detail: 0x165667b1,
  cavesCheese: 0x3c6ef372,
  cavesTunnelA: 0x5be0cd19,
  cavesTunnelB: 0x1f83d9ab,
  ores: 0x6a09e667,
  plants: 0x2f6a3c11,
  flowers: 0x4c9eea27,
  flowerCluster: 0x3ac7f4d1,
  surfacePatch: 0x756d7e2b,
  rockPatch: 0x6f1c2a9d,
  reeds: 0x1a7f3b63,
  bedrock: 0x0badf00d,
  oceanFloor: 0x5eed5eed,
} as const;

const CAVE_MIN_Y = 3;
/** Caves are only carved strictly below this Y. */
const CAVE_MAX_Y = 56;
/** Carved cells strictly below this Y are filled with lava. */
const LAVA_LEVEL = 10;
const CAVE_GRID_X = 9;
const CAVE_GRID_Z = 9;
const CAVE_GRID_Y = 30;
const CHEESE_THRESHOLD = 0.86;
const TUNNEL_WIDTH = 0.022;
const MOUNTAIN_SNOW_LINE = 118;

interface OreVein {
  readonly block: number;
  readonly count: number;
  readonly minSize: number;
  readonly maxSize: number;
  readonly minY: number;
  readonly maxY: number;
}

/** Depth bands from PLAN.md §3.2: coal 5-120, copper 5-80, iron 5-64, gold 5-32, redstone 5-16, lapis 5-30, diamond 5-16. */
const ORE_VEINS: readonly OreVein[] = [
  { block: blockNumeric('coal_ore'), count: 14, minSize: 5, maxSize: 13, minY: 5, maxY: 120 },
  { block: blockNumeric('copper_ore'), count: 9, minSize: 5, maxSize: 10, minY: 5, maxY: 80 },
  { block: blockNumeric('iron_ore'), count: 7, minSize: 4, maxSize: 9, minY: 5, maxY: 64 },
  { block: blockNumeric('gold_ore'), count: 2, minSize: 3, maxSize: 6, minY: 5, maxY: 32 },
  { block: blockNumeric('redstone_ore'), count: 3, minSize: 3, maxSize: 6, minY: 5, maxY: 16 },
  { block: blockNumeric('lapis_ore'), count: 1, minSize: 3, maxSize: 5, minY: 5, maxY: 30 },
  { block: blockNumeric('diamond_ore'), count: 1, minSize: 2, maxSize: 4, minY: 5, maxY: 16 },
];

export interface TerrainSample {
  readonly height: number;
  readonly biome: BiomeId;
  readonly climate: ClimateSample;
}

export interface TerrainOptions {
  readonly seaLevel?: number;
}

/** `safe` is false when no suitable land was found within the search radius. */
export interface SpawnPoint {
  x: number;
  y: number;
  z: number;
  safe: boolean;
}

export interface RawColumnData {
  blocks: Uint8Array;
  meta: Uint8Array;
  heightMap: Uint8Array;
}

const BASE_HEIGHT = 63;

function amplify(raw: number, strength: number): number {
  return clamp(0.5 + (raw - 0.5) * strength, 0, 1);
}

function rawTemperature(seed: number, wx: number, wz: number): number {
  return (
    fbm2((seed ^ SALT.temperature) | 0, wx / 940, wz / 940, 3) * 0.72 +
    fbm2((seed ^ (SALT.temperature + 1)) | 0, wx / 170, wz / 170, 2) * 0.28
  );
}

function rawHumidity(seed: number, wx: number, wz: number): number {
  return (
    fbm2((seed ^ SALT.humidity) | 0, wx / 780, wz / 780, 3) * 0.75 +
    fbm2((seed ^ (SALT.humidity + 1)) | 0, wx / 140, wz / 140, 2) * 0.25
  );
}

function computeClimate(seed: number, wx: number, wz: number): ClimateSample {
  const continentalness = fbm2((seed ^ SALT.continent) | 0, wx / 720, wz / 720, 4);
  const erosion = fbm2((seed ^ SALT.erosion) | 0, wx / 460, wz / 460, 3);
  const temperature = amplify(rawTemperature(seed, wx, wz), 1.9);
  const humidity = amplify(rawHumidity(seed, wx, wz), 1.7);
  const ridge = ridged2((seed ^ SALT.ridge) | 0, wx / 340, wz / 340, 3);
  return { continentalness, erosion, temperature, humidity, ridge };
}

/**
 * PLAN.md §3.2 height formula:
 *   `64 + 18*fbm(1/180) + 14*ridged(1/90) + 6*fbm(1/28)`
 * modulated by continentalness (ocean <-> inland) and erosion (flat <-> jagged),
 * plus an extra ridged peak term so real mountains reach the 100+ range.
 * Clamped to 4..150.
 */
function computeHeight(climate: ClimateSample, seed: number, wx: number, wz: number, seaLevel: number): number {
  const c = climate.continentalness;
  const landness = smoothstep(0.3, 0.46, c);
  const flat = 0.35 + 0.65 * (1 - climate.erosion);
  const hills = (fbm2((seed ^ SALT.hills) | 0, wx / 180, wz / 180, 4) - 0.5) * 2 * 18 * flat;
  const ridge = ridged2((seed ^ SALT.ridge) | 0, wx / 90, wz / 90, 3);
  const mountains = ridge * 14 * landness * (0.4 + 1.1 * (1 - climate.erosion));
  const detail = (fbm2((seed ^ SALT.detail) | 0, wx / 28, wz / 28, 3) - 0.5) * 2 * 6 * (0.5 + 0.5 * (1 - climate.erosion));
  const landHeight = seaLevel + 1 + hills + mountains + detail;

  const oceanFloor = 26 + 20 * fbm2((seed ^ (SALT.oceanFloor + 1)) | 0, wx / 240, wz / 240, 3);
  const peak =
    smoothstep(0.5, 0.82, c) * smoothstep(0.55, 0.12, climate.erosion) * ridge * ridge * 82 * landness;

  const height = oceanFloor + (landHeight - oceanFloor) * landness + peak;
  return Math.round(clamp(height, 4, 150));
}

interface CaveGrid {
  readonly cheese: Float32Array;
  readonly tunnelA: Float32Array;
  readonly tunnelB: Float32Array;
}

function caveGridIndex(ix: number, iy: number, iz: number): number {
  return (iy * CAVE_GRID_Z + iz) * CAVE_GRID_X + ix;
}

function buildCaveGrid(seed: number, baseX: number, baseZ: number): CaveGrid {
  const volume = CAVE_GRID_X * CAVE_GRID_Y * CAVE_GRID_Z;
  const cheese = new Float32Array(volume);
  const tunnelA = new Float32Array(volume);
  const tunnelB = new Float32Array(volume);
  const cheeseSeed = (seed ^ SALT.cavesCheese) | 0;
  const tunnelSeedA = (seed ^ SALT.cavesTunnelA) | 0;
  const tunnelSeedB = (seed ^ SALT.cavesTunnelB) | 0;
  for (let iy = 0; iy < CAVE_GRID_Y; iy++) {
    const wy = iy * 2;
    for (let iz = 0; iz < CAVE_GRID_Z; iz++) {
      const wz = baseZ + iz * 2;
      for (let ix = 0; ix < CAVE_GRID_X; ix++) {
        const wx = baseX + ix * 2;
        const index = caveGridIndex(ix, iy, iz);
        cheese[index] = valueNoise3(cheeseSeed, wx / 38, wy / 22, wz / 38);
        tunnelA[index] = valueNoise3(tunnelSeedA, wx / 56, wy / 30, wz / 56);
        tunnelB[index] = valueNoise3(tunnelSeedB, wx / 56, wy / 30, wz / 56);
      }
    }
  }
  return { cheese, tunnelA, tunnelB };
}

function sampleCaveGrid(grid: CaveGrid, field: Float32Array, lx: number, y: number, lz: number): number {
  const tx = lx / 2;
  const ty = y / 2;
  const tz = lz / 2;
  const ix = Math.min(CAVE_GRID_X - 2, tx | 0);
  const iy = Math.min(CAVE_GRID_Y - 2, ty | 0);
  const iz = Math.min(CAVE_GRID_Z - 2, tz | 0);
  const fx = tx - ix;
  const fy = ty - iy;
  const fz = tz - iz;
  const c000 = field[caveGridIndex(ix, iy, iz)];
  const c100 = field[caveGridIndex(ix + 1, iy, iz)];
  const c010 = field[caveGridIndex(ix, iy + 1, iz)];
  const c110 = field[caveGridIndex(ix + 1, iy + 1, iz)];
  const c001 = field[caveGridIndex(ix, iy, iz + 1)];
  const c101 = field[caveGridIndex(ix + 1, iy, iz + 1)];
  const c011 = field[caveGridIndex(ix, iy + 1, iz + 1)];
  const c111 = field[caveGridIndex(ix + 1, iy + 1, iz + 1)];
  const x00 = c000 + (c100 - c000) * fx;
  const x10 = c010 + (c110 - c010) * fx;
  const x01 = c001 + (c101 - c001) * fx;
  const x11 = c011 + (c111 - c011) * fx;
  const y0 = x00 + (x10 - x00) * fy;
  const y1 = x01 + (x11 - x01) * fy;
  void grid;
  return y0 + (y1 - y0) * fz;
}

function isCaveAt(grid: CaveGrid, lx: number, y: number, lz: number): boolean {
  const cheese = sampleCaveGrid(grid, grid.cheese, lx, y, lz);
  if (cheese > CHEESE_THRESHOLD) return true;
  const a = sampleCaveGrid(grid, grid.tunnelA, lx, y, lz);
  if (Math.abs(a - 0.5) >= TUNNEL_WIDTH) return false;
  const b = sampleCaveGrid(grid, grid.tunnelB, lx, y, lz);
  return Math.abs(b - 0.5) < TUNNEL_WIDTH;
}

export class TerrainGenerator implements ColumnGenerator {
  readonly seaLevel: number;
  private seedHash: number;

  constructor(seedHash = 0, options: TerrainOptions = {}) {
    this.seedHash = seedHash | 0;
    this.seaLevel = options.seaLevel ?? SEA_LEVEL;
  }

  /** Current world seed hash; used by `surfaceHeight`/`biomeAt`/`findSpawn`. */
  get seed(): number {
    return this.seedHash;
  }

  setSeed(seedHash: number): void {
    this.seedHash = seedHash | 0;
  }

  /** `ColumnGenerator` entry point used by `World.ensureColumn` and `ChunkManager`. */
  generate(column: ChunkColumn, seedHash: number): void {
    this.seedHash = seedHash | 0;
    this.generateInto(column.cx, column.cz, seedHash, column.blocks, column.meta, column.heightMap);
  }

  /** Allocate a fresh raw column (worker / generation fallback payload). */
  generateRaw(cx: number, cz: number, seedHash: number): RawColumnData {
    const blocks = new Uint8Array(16 * 16 * WORLD_HEIGHT);
    const meta = new Uint8Array(blocks.length);
    const heightMap = new Uint8Array(256);
    this.generateInto(cx, cz, seedHash, blocks, meta, heightMap);
    return { blocks, meta, heightMap };
  }

  /**
   * Fill raw arrays for a column. Pure with respect to (seedHash, cx, cz): the
   * same arguments always produce the same bytes, independent of call order.
   */
  generateInto(cx: number, cz: number, seedHash: number, blocks: Uint8Array, meta: Uint8Array, heightMap?: Uint8Array): void {
    blocks.fill(0);
    meta.fill(0);
    const seed = seedHash | 0;
    const baseX = cx * 16;
    const baseZ = cz * 16;
    const seaLevel = this.seaLevel;

    const samples: TerrainSample[] = new Array(256);
    const sampleCache = new Map<string, TerrainSample>();
    for (let z = 0; z < 16; z++) {
      for (let x = 0; x < 16; x++) {
        const sample = this.sampleWithSeed(seed, baseX + x, baseZ + z);
        samples[z * 16 + x] = sample;
        sampleCache.set(`${baseX + x},${baseZ + z}`, sample);
      }
    }
    const sampleAt = (wx: number, wz: number): TerrainSample => {
      const key = `${wx},${wz}`;
      const cached = sampleCache.get(key);
      if (cached) return cached;
      const value = this.sampleWithSeed(seed, wx, wz);
      sampleCache.set(key, value);
      return value;
    };

    // ---------------------------------------------------------------- terrain
    for (let z = 0; z < 16; z++) {
      for (let x = 0; x < 16; x++) {
        const wx = baseX + x;
        const wz = baseZ + z;
        const sample = samples[z * 16 + x];
        const height = sample.height;
        const biome = sample.biome;
        const def = biomeDef(biome);

        // PLAN.md §3.2: beach fades into land for up to 2 blocks around water.
        let nearWater = false;
        if (height >= seaLevel - 1 && height <= seaLevel + 2) {
          nearWater =
            sampleAt(wx + 1, wz).height < seaLevel ||
            sampleAt(wx - 1, wz).height < seaLevel ||
            sampleAt(wx, wz + 1).height < seaLevel ||
            sampleAt(wx, wz - 1).height < seaLevel;
        }

        let surface = def.surface;
        let filler = def.filler;
        if (def.ocean) {
          const patch = hash2f((seed ^ SALT.oceanFloor) | 0, wx, wz);
          if (patch < 0.1) surface = CLAY;
          else if (patch < 0.4) surface = GRAVEL;
          filler = SAND;
        } else if (nearWater) {
          // Pebble pockets along the waterline break up the pure sand beach.
          if (sample.climate.temperature < 0.3) surface = SNOW;
          else surface = hash2f((seed ^ SALT.rockPatch) | 0, wx, wz) < 0.14 ? GRAVEL : SAND;
          filler = SAND;
        } else if (def.mountain && height >= MOUNTAIN_SNOW_LINE) {
          surface = SNOW;
        } else if (!def.snowy && !def.ocean && height > seaLevel + 2) {
          // Bare stone / gravel / coarse-dirt patches on cliffs, highlands and mountain
          // slopes. Only the top block changes, so nothing ever floats; the slope is
          // measured on the analytic height field, not on generated blocks.
          const patch = fbm2((seed ^ SALT.surfacePatch) | 0, wx / 11, wz / 11, 2);
          if (patch > 0.58) {
            const slope =
              Math.abs(height - sampleAt(wx + 1, wz).height) + Math.abs(height - sampleAt(wx, wz + 1).height);
            const rocky = def.mountain || height > 88 || slope >= 3;
            if (rocky) {
              const roll = hash2f((seed ^ SALT.rockPatch) | 0, wx, wz);
              if (def.mountain || slope >= 5 || roll < 0.4) surface = STONE;
              else if (roll < 0.78) surface = GRAVEL;
              else surface = COARSE_DIRT;
            }
          }
        }

        for (let y = 0; y <= height; y++) {
          let block: number;
          if (y === 0) {
            block = BEDROCK;
          } else if (y === 1) {
            block = BEDROCK;
          } else if (y === 2) {
            block = hash2f((seed ^ SALT.bedrock) | 0, wx * 3 + y, wz) < 0.7 ? BEDROCK : STONE;
          } else if (y === height) {
            block = surface;
          } else if (y >= height - 3) {
            block = filler;
          } else {
            block = STONE;
          }
          blocks[localIndex(x, y, z)] = block;
        }

        // Water / ice up to sea level.
        for (let y = height + 1; y <= seaLevel; y++) {
          blocks[localIndex(x, y, z)] = def.frozen && y === seaLevel ? ICE : WATER;
        }

        if (heightMap) heightMap[z * 16 + x] = Math.min(255, height);
      }
    }

    // ----------------------------------------------------------------- caves
    const caveGrid = buildCaveGrid(seed, baseX, baseZ);
    for (let z = 0; z < 16; z++) {
      for (let x = 0; x < 16; x++) {
        const height = samples[z * 16 + x].height;
        const maxY = Math.min(CAVE_MAX_Y - 1, height - 1);
        for (let y = CAVE_MIN_Y; y <= maxY; y++) {
          const index = localIndex(x, y, z);
          const block = blocks[index];
          if (block === AIR || block === BEDROCK || block === WATER || block === LAVA) continue;
          if (!isCaveAt(caveGrid, x, y, z)) continue;
          blocks[index] = y < LAVA_LEVEL ? LAVA : AIR;
        }
      }
    }

    // ------------------------------------------------------------------ ores
    const oreRng = new Rand(hash2i((seed ^ SALT.ores) | 0, cx, cz));
    for (const vein of ORE_VEINS) {
      for (let i = 0; i < vein.count; i++) {
        let ox = oreRng.int(16);
        let oz = oreRng.int(16);
        let oy = vein.minY + oreRng.int(vein.maxY - vein.minY + 1);
        const size = vein.minSize + oreRng.int(vein.maxSize - vein.minSize + 1);
        for (let step = 0; step < size; step++) {
          const index = localIndex(ox, oy, oz);
          if (blocks[index] === STONE) blocks[index] = vein.block;
          const dir = oreRng.int(6);
          if (dir === 0) ox -= 1;
          else if (dir === 1) ox += 1;
          else if (dir === 2) oz -= 1;
          else if (dir === 3) oz += 1;
          else if (dir === 4) oy -= 1;
          else oy += 1;
          ox = clampInt(ox, 0, 15);
          oz = clampInt(oz, 0, 15);
          oy = clampInt(oy, vein.minY, vein.maxY);
        }
      }
    }

    // -------------------------------------------------------------- features
    const featureCtx = this.makeFeatureContext(seed, samples, baseX, baseZ);
    for (let dz = -1; dz <= 1; dz++) {
      for (let dx = -1; dx <= 1; dx++) {
        const specs = collectFeatures(featureCtx, cx + dx, cz + dz);
        for (const spec of specs) {
          if (!featureIntersectsChunk(spec, cx, cz)) continue;
          forEachTreeBlock(spec, (wx, wy, wz, block, trunk) => {
            const lx = wx - baseX;
            const lz = wz - baseZ;
            if (lx < 0 || lx > 15 || lz < 0 || lz > 15) return;
            if (wy < 0 || wy >= WORLD_HEIGHT) return;
            const index = localIndex(lx, wy, lz);
            const existing = blocks[index];
            if (trunk) {
              // Logs may replace plants/leaves and, for the buried base block, the
              // surface solid (a tree must never float above the ground).
              if (
                existing === AIR ||
                IS_REPLACEABLE[existing] === 1 ||
                LEAF_TABLE[existing] === 1 ||
                IS_SOLID[existing] === 1
              ) {
                blocks[index] = block;
              }
            } else if (existing === AIR) {
              blocks[index] = block;
            }
          });
        }
      }
    }

    // ------------------------------------------------------- ground cover
    for (let z = 0; z < 16; z++) {
      for (let x = 0; x < 16; x++) {
        const wx = baseX + x;
        const wz = baseZ + z;
        const sample = samples[z * 16 + x];
        const def = biomeDef(sample.biome);
        const height = sample.height;
        if (height + 1 >= WORLD_HEIGHT) continue;
        const above = localIndex(x, height + 1, z);
        if (blocks[above] !== AIR) continue;
        const ground = blocks[localIndex(x, height, z)];

        if (ground === GRASS) {
          const grassRoll = hash2f((seed ^ SALT.plants) | 0, wx, wz);
          if (grassRoll < def.grassDensity) {
            blocks[above] = TALL_GRASS;
          } else {
            // Flowers grow in clusters (patch noise) instead of an even sprinkle, so
            // plains/forest meadows read as flower fields rather than noise.
            const cluster = fbm2((seed ^ SALT.flowerCluster) | 0, wx / 9, wz / 9, 2);
            const patchBoost = 0.16 + smoothstep(0.46, 0.68, cluster) * 2.7;
            const flowerChance = def.flowerDensity * patchBoost;
            const flowerRoll = hash2f((seed ^ SALT.flowers) | 0, wx, wz);
            if (flowerRoll < flowerChance) {
              blocks[above] = flowerRoll < flowerChance * 0.45 ? POPPY : DANDELION;
            }
          }
        } else if (ground === SAND && def.deadBushDensity > 0) {
          const roll = hash2f((seed ^ SALT.plants + 7) | 0, wx, wz);
          if (roll < def.deadBushDensity) blocks[above] = DEAD_BUSH;
        }

        // Reeds next to water at sea level.
        if (ground === GRASS || ground === SAND) {
          const shoreline = height <= seaLevel && height >= seaLevel - 1;
          if (shoreline) {
            const nearWater =
              sampleAt(wx + 1, wz).height < seaLevel ||
              sampleAt(wx - 1, wz).height < seaLevel ||
              sampleAt(wx, wz + 1).height < seaLevel ||
              sampleAt(wx, wz - 1).height < seaLevel;
            if (nearWater && hash2f((seed ^ SALT.reeds) | 0, wx, wz) < 0.24) {
              const reeds = 1 + Math.floor(hash2f((seed ^ (SALT.reeds + 1)) | 0, wx, wz) * 3);
              for (let dy = 1; dy <= reeds && height + dy < WORLD_HEIGHT; dy++) {
                if (blocks[localIndex(x, height + dy, z)] !== AIR) break;
                blocks[localIndex(x, height + dy, z)] = SUGAR_CANE;
              }
            }
          }
        }
      }
    }
  }

  // ------------------------------------------------------------- sampling API

  /** Full climate/height/biome sample at a world column. */
  sample(wx: number, wz: number): TerrainSample {
    return this.sampleWithSeed(this.seedHash, wx, wz);
  }

  private sampleWithSeed(seed: number, wx: number, wz: number): TerrainSample {
    const climate = computeClimate(seed, wx, wz);
    const height = computeHeight(climate, seed, wx, wz, this.seaLevel);
    const biome = classifyBiome(climate, height, this.seaLevel);
    return { height, biome, climate };
  }

  surfaceHeight(wx: number, wz: number): number {
    return this.sample(wx, wz).height;
  }

  biomeAt(wx: number, wz: number): BiomeId {
    return this.sample(wx, wz).biome;
  }

  /**
   * Safe land spawn. PLAN.md §3.2 prefers grass within radius 64 of 0,0; when a seed
   * starts in an ocean/desert we keep expanding the deterministic spiral (still the
   * *nearest* safe spot) so the player never spawns in water or inside a tree.
   */
  findSpawn(searchRadius = 512): SpawnPoint {
    const seed = this.seedHash;
    const treeCache = new Map<string, TreeSpec[]>();
    const phases: ReadonlyArray<readonly [number, number, boolean]> = [
      [64, 4, true],
      [192, 8, true],
      [512, 16, true],
      [512, 16, false],
    ];
    for (const [radius, step, grassOnly] of phases) {
      if (radius > searchRadius && radius > 64) continue;
      const spawn = this.searchSpawnRings(seed, radius, step, grassOnly, treeCache);
      if (spawn) return spawn;
    }
    const fallback = this.sampleWithSeed(seed, 0, 0);
    return { x: 0.5, y: Math.max(this.seaLevel + 2, fallback.height + 1), z: 0.5, safe: false };
  }

  private searchSpawnRings(
    seed: number,
    radius: number,
    step: number,
    grassOnly: boolean,
    treeCache: Map<string, TreeSpec[]>,
  ): SpawnPoint | null {
    const maxRing = Math.ceil(radius / step);
    for (let ring = 0; ring <= maxRing; ring++) {
      const count = ring === 0 ? 1 : ring * 8;
      for (let i = 0; i < count; i++) {
        const gx = ring === 0 ? 0 : ringLatticeX(ring, i);
        const gz = ring === 0 ? 0 : ringLatticeZ(ring, i);
        const wx = gx * step;
        const wz = gz * step;
        const spawn = this.trySpawnAt(seed, wx, wz, treeCache, grassOnly);
        if (spawn) return spawn;
      }
    }
    return null;
  }

  private trySpawnAt(
    seed: number,
    wx: number,
    wz: number,
    treeCache: Map<string, TreeSpec[]>,
    grassOnly: boolean,
  ): SpawnPoint | null {
    const sample = this.sampleWithSeed(seed, wx, wz);
    const def = biomeDef(sample.biome);
    if (def.ocean) return null;
    if (grassOnly) {
      if (!GRASS_BIOMES.has(sample.biome)) return null;
      if (sample.height <= this.seaLevel + 1 || sample.height > 96) return null;
    } else {
      if (sample.height <= this.seaLevel || sample.height > 120) return null;
    }

    if (grassOnly) {
      for (let dz = -4; dz <= 4; dz += 4) {
        for (let dx = -4; dx <= 4; dx += 4) {
          const neighbour = this.sampleWithSeed(seed, wx + dx, wz + dz);
          const neighbourDef = biomeDef(neighbour.biome);
          if (neighbourDef.ocean) return null;
          if (Math.abs(neighbour.height - sample.height) > 3) return null;
        }
      }
    }

    // Reject columns that a tree trunk would occupy.
    const ccx = Math.floor(wx / 16);
    const ccz = Math.floor(wz / 16);
    const featureCtx = this.makeFeatureContext(seed, null, ccx * 16, ccz * 16);
    for (let dz = -1; dz <= 1; dz++) {
      for (let dx = -1; dx <= 1; dx++) {
        const key = `${ccx + dx},${ccz + dz}`;
        let specs = treeCache.get(key);
        if (!specs) {
          specs = collectFeatures(featureCtx, ccx + dx, ccz + dz);
          treeCache.set(key, specs);
        }
        for (const spec of specs) {
          if (Math.abs(spec.wx - wx) <= 2 && Math.abs(spec.wz - wz) <= 2) return null;
        }
      }
    }

    return { x: wx + 0.5, y: sample.height + 1, z: wz + 0.5, safe: true };
  }

  private makeFeatureContext(
    seed: number,
    ownSamples: TerrainSample[] | null,
    ownBaseX: number,
    ownBaseZ: number,
  ): FeatureContext {
    const cache = new Map<string, TerrainSample>();
    if (ownSamples) {
      for (let z = 0; z < 16; z++) {
        for (let x = 0; x < 16; x++) {
          cache.set(`${ownBaseX + x},${ownBaseZ + z}`, ownSamples[z * 16 + x]);
        }
      }
    }
    const lookup = (wx: number, wz: number): TerrainSample => {
      const key = `${wx},${wz}`;
      const cached = cache.get(key);
      if (cached) return cached;
      const value = this.sampleWithSeed(seed, wx, wz);
      cache.set(key, value);
      return value;
    };
    return {
      seedHash: seed,
      surfaceHeight: (wx, wz) => lookup(wx, wz).height,
      biomeAt: (wx, wz) => lookup(wx, wz).biome,
    };
  }
}

function clampInt(value: number, min: number, max: number): number {
  return value < min ? min : value > max ? max : value;
}

const WHITE_TINT: [number, number, number] = [255, 255, 255];

/** `MeshContext.tintOf` implementation: biome temperature/humidity tinted grass/leaves/water. */
export type TintResolver = (blockId: number, wx: number, wz: number) => [number, number, number];

export function createTintResolver(seedHash: number): TintResolver {
  const seed = seedHash | 0;
  return (blockId, wx, wz) => {
    const kind = TINT_KIND[blockId];
    if (kind === 0) return WHITE_TINT;
    if (kind === 3) {
      // Water: uniformly blue, colder climates slightly paler.
      const cold = amplify(rawTemperature(seed, wx, wz), 1.9);
      const pale = Math.round((1 - cold) * 26);
      return [96 + pale, 152 + pale, 226];
    }
    const temperature = amplify(rawTemperature(seed, wx, wz), 1.9);
    const humidity = amplify(rawHumidity(seed, wx, wz), 1.7);
    if (kind === 1) {
      // Grasstint: lush/wet -> saturated green, dry/cold -> yellowish.
      const r = 132 + 70 * (1 - humidity) + 26 * (1 - temperature);
      const g = 178 + 44 * humidity + 10 * (1 - temperature);
      const b = 84 + 34 * humidity - 22 * (1 - temperature);
      return [clampByte(r), clampByte(g), clampByte(b)];
    }
    // Foliage: a touch darker and cooler than grass.
    const r = 108 + 58 * (1 - humidity) + 22 * (1 - temperature);
    const g = 156 + 40 * humidity + 8 * (1 - temperature);
    const b = 72 + 30 * humidity - 16 * (1 - temperature);
    return [clampByte(r), clampByte(g), clampByte(b)];
  };
}

function clampByte(value: number): number {
  return value < 0 ? 0 : value > 255 ? 255 : Math.round(value);
}

/** x offset of the i-th point on a square spiral ring. */
function ringLatticeX(ring: number, index: number): number {
  const side = Math.max(1, Math.floor(index / (ring * 2)));
  const offset = index % (ring * 2);
  if (side === 0) return -ring + offset;
  if (side === 1) return ring;
  if (side === 2) return ring - offset;
  return -ring;
}

/** z offset of the i-th point on a square spiral ring. */
function ringLatticeZ(ring: number, index: number): number {
  const side = Math.max(1, Math.floor(index / (ring * 2)));
  const offset = index % (ring * 2);
  if (side === 0) return -ring;
  if (side === 1) return -ring + offset;
  if (side === 2) return ring;
  return ring - offset;
}

export { BASE_HEIGHT, LAVA_LEVEL, CAVE_MAX_Y };
