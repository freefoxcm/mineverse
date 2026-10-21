/**
 * Climate -> biome classification and per-biome surface/vegetation definitions.
 *
 * The four climate noises (continentalness / erosion / temperature / humidity)
 * plus a ridged mountain noise are sampled by `TerrainGenerator`; this module only
 * turns those numbers into a biome id and exposes the block palette used by the
 * terrain generator and the feature generator.
 */
import { SEA_LEVEL } from '../../core/config';
import { blockNumeric } from '../blocks';

export type BiomeId =
  | 'ocean'
  | 'frozen_ocean'
  | 'beach'
  | 'snowy_beach'
  | 'plains'
  | 'forest'
  | 'birch_forest'
  | 'taiga'
  | 'desert'
  | 'snowy_plains'
  | 'mountains';

export type TreeKind = 'oak' | 'birch' | 'spruce' | 'cactus' | 'none';

export interface BiomeDef {
  readonly id: BiomeId;
  /** Top solid block of the terrain column. */
  readonly surface: number;
  /** Block used for the few layers below the surface. */
  readonly filler: number;
  /** Tree/cactus kind placed by the cross-chunk feature pass. */
  readonly tree: TreeKind;
  /** Chance per candidate feature position (see features.ts). */
  readonly treeDensity: number;
  /** Chance per grass-covered column to get tall grass. */
  readonly grassDensity: number;
  /** Chance per grass-covered column to get a flower. */
  readonly flowerDensity: number;
  /** Chance per sand column to get a dead bush. */
  readonly deadBushDensity: number;
  /** Water surface freezes into ice. */
  readonly frozen: boolean;
  /** Snow covers the surface block. */
  readonly snowy: boolean;
  /** Ocean / deep water biome. */
  readonly ocean: boolean;
  /** Terrain is bare stone (mountain biome). */
  readonly mountain: boolean;
}

const AIR_GRASS = blockNumeric('grass_block');
const DIRT = blockNumeric('dirt');
const SAND = blockNumeric('sand');
const SANDSTONE = blockNumeric('sandstone');
const STONE = blockNumeric('stone');
const SNOW = blockNumeric('snow_block');
const GRAVEL = blockNumeric('gravel');

function define(def: BiomeDef): BiomeDef {
  return def;
}

export const BIOMES: Record<BiomeId, BiomeDef> = {
  ocean: define({
    id: 'ocean',
    surface: SAND,
    filler: SAND,
    tree: 'none',
    treeDensity: 0,
    grassDensity: 0,
    flowerDensity: 0,
    deadBushDensity: 0,
    frozen: false,
    snowy: false,
    ocean: true,
    mountain: false,
  }),
  frozen_ocean: define({
    id: 'frozen_ocean',
    surface: SAND,
    filler: GRAVEL,
    tree: 'none',
    treeDensity: 0,
    grassDensity: 0,
    flowerDensity: 0,
    deadBushDensity: 0,
    frozen: true,
    snowy: false,
    ocean: true,
    mountain: false,
  }),
  beach: define({
    id: 'beach',
    surface: SAND,
    filler: SANDSTONE,
    tree: 'none',
    treeDensity: 0,
    grassDensity: 0,
    flowerDensity: 0,
    deadBushDensity: 0,
    frozen: false,
    snowy: false,
    ocean: false,
    mountain: false,
  }),
  snowy_beach: define({
    id: 'snowy_beach',
    surface: SNOW,
    filler: SAND,
    tree: 'none',
    treeDensity: 0,
    grassDensity: 0,
    flowerDensity: 0,
    deadBushDensity: 0,
    frozen: true,
    snowy: true,
    ocean: false,
    mountain: false,
  }),
  plains: define({
    id: 'plains',
    surface: AIR_GRASS,
    filler: DIRT,
    tree: 'oak',
    treeDensity: 0.1,
    grassDensity: 0.16,
    flowerDensity: 0.03,
    deadBushDensity: 0,
    frozen: false,
    snowy: false,
    ocean: false,
    mountain: false,
  }),
  forest: define({
    id: 'forest',
    surface: AIR_GRASS,
    filler: DIRT,
    tree: 'oak',
    treeDensity: 0.72,
    grassDensity: 0.22,
    flowerDensity: 0.04,
    deadBushDensity: 0,
    frozen: false,
    snowy: false,
    ocean: false,
    mountain: false,
  }),
  birch_forest: define({
    id: 'birch_forest',
    surface: AIR_GRASS,
    filler: DIRT,
    tree: 'birch',
    treeDensity: 0.66,
    grassDensity: 0.2,
    flowerDensity: 0.03,
    deadBushDensity: 0,
    frozen: false,
    snowy: false,
    ocean: false,
    mountain: false,
  }),
  taiga: define({
    id: 'taiga',
    surface: AIR_GRASS,
    filler: DIRT,
    tree: 'spruce',
    treeDensity: 0.62,
    grassDensity: 0.1,
    flowerDensity: 0.01,
    deadBushDensity: 0,
    frozen: false,
    snowy: false,
    ocean: false,
    mountain: false,
  }),
  desert: define({
    id: 'desert',
    surface: SAND,
    filler: SANDSTONE,
    tree: 'cactus',
    treeDensity: 0.28,
    grassDensity: 0,
    flowerDensity: 0,
    deadBushDensity: 0.02,
    frozen: false,
    snowy: false,
    ocean: false,
    mountain: false,
  }),
  snowy_plains: define({
    id: 'snowy_plains',
    surface: SNOW,
    filler: DIRT,
    tree: 'spruce',
    treeDensity: 0.07,
    grassDensity: 0,
    flowerDensity: 0,
    deadBushDensity: 0,
    frozen: true,
    snowy: true,
    ocean: false,
    mountain: false,
  }),
  mountains: define({
    id: 'mountains',
    surface: STONE,
    filler: STONE,
    tree: 'none',
    treeDensity: 0,
    grassDensity: 0.01,
    flowerDensity: 0,
    deadBushDensity: 0,
    frozen: false,
    snowy: false,
    ocean: false,
    mountain: true,
  }),
};

export const BIOME_IDS: readonly BiomeId[] = Object.keys(BIOMES) as BiomeId[];

export function biomeDef(id: BiomeId): BiomeDef {
  return BIOMES[id];
}

export interface ClimateSample {
  /** 0 = deep ocean, 0.5 = coast, 1 = far inland. */
  readonly continentalness: number;
  /** 0 = very eroded/flat, 1 = jagged. */
  readonly erosion: number;
  /** 0 = freezing, 1 = hot. */
  readonly temperature: number;
  /** 0 = arid, 1 = wet. */
  readonly humidity: number;
  /** Ridged mountain noise, 0..1. */
  readonly ridge: number;
}

/**
 * Classify a location from its climate sample and final terrain height.
 * Height decides ocean/beach/mountain overrides; climate picks the land biome.
 */
export function classifyBiome(climate: ClimateSample, height: number, seaLevel = SEA_LEVEL): BiomeId {
  const { temperature, humidity, ridge, erosion, continentalness } = climate;

  if (height < seaLevel - 1) {
    return temperature < 0.3 ? 'frozen_ocean' : 'ocean';
  }

  if (height <= seaLevel + 1) {
    return temperature < 0.3 ? 'snowy_beach' : 'beach';
  }

  const mountainFactor =
    height > 100 ||
    (height > 88 && ridge > 0.55 && erosion < 0.5) ||
    (height > 82 && ridge > 0.62 && continentalness > 0.62);
  if (mountainFactor) return 'mountains';

  if (temperature < 0.32) {
    return humidity > 0.5 ? 'taiga' : 'snowy_plains';
  }

  if (temperature > 0.62 && humidity < 0.38) {
    return 'desert';
  }

  if (humidity > 0.56) {
    return temperature < 0.5 ? 'birch_forest' : 'forest';
  }

  if (humidity > 0.42 && temperature < 0.55) {
    return 'birch_forest';
  }

  return 'plains';
}
