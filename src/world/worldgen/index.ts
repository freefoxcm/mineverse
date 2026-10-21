/**
 * Public surface of the deterministic world-generation module.
 *
 * `TerrainGenerator` implements the `ColumnGenerator` contract from
 * `src/world/world.ts`; the other exports are building blocks useful for tests
 * and tools (noise sampling, biome classification, feature enumeration).
 */
export { TerrainGenerator, BASE_HEIGHT, CAVE_MAX_Y, LAVA_LEVEL, createTintResolver } from './terrain';
export type { TerrainSample, TerrainOptions, SpawnPoint, RawColumnData, TintResolver } from './terrain';
export { BIOMES, BIOME_IDS, biomeDef, classifyBiome } from './biomes';
export type { BiomeId, BiomeDef, ClimateSample, TreeKind } from './biomes';
export { collectFeatures, featureIntersectsChunk, forEachTreeBlock, makeTreeSpec } from './features';
export type { FeatureContext, TreeSpec, TreeBlockVisitor } from './features';
export {
  clamp,
  clamp01,
  fbm2,
  fbm3,
  lerpRange,
  noise2,
  ridged2,
  smoothstep,
  valueNoise2,
  valueNoise3,
} from './noise';
