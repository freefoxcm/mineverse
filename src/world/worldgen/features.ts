/**
 * Deterministic cross-chunk features (trees / cacti).
 *
 * A feature candidate is chosen from a chunk-seeded PRNG, but its *shape* is
 * derived from the candidate's world position only. Every chunk therefore
 * agrees about where a tree is and how tall it is, and a chunk generates the
 * parts of trees whose trunk lies in one of its 8 neighbours. That is what makes
 * canopies seamless across chunk borders.
 */
import { SEA_LEVEL } from '../../core/config';
import { Rand, hash2i } from '../../core/rng';
import { blockNumeric } from '../blocks';
import { biomeDef, type BiomeId, type TreeKind } from './biomes';

const OAK_LOG = blockNumeric('oak_log');
const BIRCH_LOG = blockNumeric('birch_log');
const SPRUCE_LOG = blockNumeric('spruce_log');
const OAK_LEAVES = blockNumeric('oak_leaves');
const BIRCH_LEAVES = blockNumeric('birch_leaves');
const SPRUCE_LEAVES = blockNumeric('spruce_leaves');
const CACTUS = blockNumeric('cactus');

/** Candidate positions tried per chunk. Higher = denser forests. */
const FEATURE_ATTEMPTS = 14;
const CHUNK_FEATURE_SALT = 0x51ed270b;
const TREE_SALT = 0x27d4eb2f;

export interface FeatureContext {
  readonly seedHash: number;
  surfaceHeight(wx: number, wz: number): number;
  biomeAt(wx: number, wz: number): BiomeId;
}

export interface TreeSpec {
  readonly kind: Exclude<TreeKind, 'none'>;
  readonly wx: number;
  readonly wz: number;
  readonly groundY: number;
  readonly trunkHeight: number;
  /** Horizontal canopy radius; used to skip features that cannot reach a chunk. */
  readonly radius: number;
  readonly seed: number;
}

function treeBlocks(kind: Exclude<TreeKind, 'none'>): { log: number; leaves: number } {
  switch (kind) {
    case 'birch':
      return { log: BIRCH_LOG, leaves: BIRCH_LEAVES };
    case 'spruce':
      return { log: SPRUCE_LOG, leaves: SPRUCE_LEAVES };
    case 'cactus':
      return { log: CACTUS, leaves: 0 };
    case 'oak':
    default:
      return { log: OAK_LOG, leaves: OAK_LEAVES };
  }
}

export function makeTreeSpec(ctx: FeatureContext, kind: Exclude<TreeKind, 'none'>, wx: number, wz: number, groundY: number): TreeSpec {
  const seed = hash2i(ctx.seedHash ^ TREE_SALT, wx, wz);
  const rng = new Rand(seed);
  let trunkHeight: number;
  let radius: number;
  switch (kind) {
    case 'birch':
      trunkHeight = 5 + rng.int(3);
      radius = 2;
      break;
    case 'spruce':
      trunkHeight = 6 + rng.int(4);
      radius = 2;
      break;
    case 'cactus':
      trunkHeight = 1 + rng.int(3);
      radius = 0;
      break;
    case 'oak':
    default:
      trunkHeight = 4 + rng.int(3);
      radius = 2;
      break;
  }
  return { kind, wx, wz, groundY, trunkHeight, radius, seed };
}

/** All feature candidates whose trunk belongs to chunk (cx, cz). Deterministic. */
export function collectFeatures(ctx: FeatureContext, cx: number, cz: number): TreeSpec[] {
  const rng = new Rand(hash2i(ctx.seedHash ^ CHUNK_FEATURE_SALT, cx, cz));
  const baseX = cx * 16;
  const baseZ = cz * 16;
  const features: TreeSpec[] = [];
  for (let i = 0; i < FEATURE_ATTEMPTS; i++) {
    const wx = baseX + rng.int(16);
    const wz = baseZ + rng.int(16);
    const biome = ctx.biomeAt(wx, wz);
    const def = biomeDef(biome);
    if (def.tree === 'none' || def.treeDensity <= 0) continue;
    if (rng.next() >= def.treeDensity) continue;
    const groundY = ctx.surfaceHeight(wx, wz);
    if (groundY <= SEA_LEVEL) continue;
    features.push(makeTreeSpec(ctx, def.tree, wx, wz, groundY));
  }
  return features;
}

/** True when a feature's blocks can reach the given chunk. */
export function featureIntersectsChunk(spec: TreeSpec, cx: number, cz: number): boolean {
  const minX = cx * 16;
  const minZ = cz * 16;
  return (
    spec.wx + spec.radius >= minX &&
    spec.wx - spec.radius <= minX + 15 &&
    spec.wz + spec.radius >= minZ &&
    spec.wz - spec.radius <= minZ + 15
  );
}

export type TreeBlockVisitor = (wx: number, wy: number, wz: number, block: number, trunk: boolean) => void;

/**
 * Enumerate every block of a tree. The visitor gets world coordinates so the
 * caller can clip the shape to the chunk currently being generated.
 */
export function forEachTreeBlock(spec: TreeSpec, visit: TreeBlockVisitor): void {
  const { log, leaves } = treeBlocks(spec.kind);
  const topY = spec.groundY + spec.trunkHeight;

  // Trunk.
  for (let dy = 1; dy <= spec.trunkHeight; dy++) {
    visit(spec.wx, spec.groundY + dy, spec.wz, log, true);
  }

  if (spec.kind === 'cactus') return;

  const rng = new Rand(spec.seed ^ 0x5f3759df);

  if (spec.kind === 'spruce') {
    // Conical layers, narrower towards the top.
    for (let i = 0; i < spec.trunkHeight - 1; i++) {
      const y = topY - i;
      if (y <= spec.groundY + 1) break;
      const ring = i % 4;
      const radius = ring === 0 ? 1 : ring === 1 ? 2 : ring === 2 ? 1 : 1;
      for (let dx = -radius; dx <= radius; dx++) {
        for (let dz = -radius; dz <= radius; dz++) {
          if (dx === 0 && dz === 0) continue;
          if (Math.abs(dx) === radius && Math.abs(dz) === radius && radius > 1) continue;
          if (radius > 1 && rng.next() < 0.35) continue;
          visit(spec.wx + dx, y, spec.wz + dz, leaves, false);
        }
      }
    }
    visit(spec.wx, topY + 1, spec.wz, leaves, false);
    return;
  }

  // Oak / birch: a rounded canopy from two layers below the top to one above.
  const broad = spec.kind === 'birch' ? 0.35 : 0.25;
  for (let dy = -2; dy <= 1; dy++) {
    const y = topY + dy;
    const radius = dy <= 0 ? 2 : 1;
    for (let dx = -radius; dx <= radius; dx++) {
      for (let dz = -radius; dz <= radius; dz++) {
        if (dx === 0 && dz === 0 && dy <= 0) continue;
        const corner = Math.abs(dx) === radius && Math.abs(dz) === radius;
        if (corner && rng.next() < (dy === 1 ? 1 : 0.55 + broad)) continue;
        visit(spec.wx + dx, y, spec.wz + dz, leaves, false);
      }
    }
  }
}
