/**
 * Deterministic cross-chunk features (trees / cacti).
 *
 * A feature candidate is chosen from a chunk-seeded PRNG, but its *shape* is
 * derived from the candidate's world position only. Every chunk therefore
 * agrees about where a tree is and how tall it is, and a chunk generates the
 * parts of trees whose trunk lies in one of its 8 neighbours. That is what makes
 * canopies seamless across chunk borders.
 *
 * Shapes follow vanilla-ish organic silhouettes instead of solid blocks:
 *  - oak:        irregular 2-layer crown with holes, occasionally a big branching oak
 *  - birch:      taller, thin trunk, small sparse crown
 *  - spruce:     conical tiers of radius 2/1 with exposed trunk gaps
 *  - cactus:     plain column, unchanged
 * The trunk base is sometimes sunk one block into the ground (replaces the surface
 * block) so trees never look like they float on a grass block.
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
const SHAPE_SALT = 0x5f3759df;

/** Chance that a tree trunk is sunk one block into the ground instead of sitting on it. */
const BURIED_CHANCE: Record<Exclude<TreeKind, 'none'>, number> = {
  oak: 0.55,
  birch: 0.5,
  spruce: 0.25,
  cactus: 0,
};

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
  /** Logs above the ground line (the top log sits at groundY + trunkHeight). */
  readonly trunkHeight: number;
  /** Horizontal reach of the shape; used to skip features that cannot reach a chunk. */
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

/** Every ~6th oak becomes a big branching oak (pure function of the tree seed). */
function isBigOak(seed: number): boolean {
  return (seed >>> 9) % 100 < 17;
}

export function makeTreeSpec(ctx: FeatureContext, kind: Exclude<TreeKind, 'none'>, wx: number, wz: number, groundY: number): TreeSpec {
  const seed = hash2i(ctx.seedHash ^ TREE_SALT, wx, wz);
  const rng = new Rand(seed);
  let trunkHeight: number;
  let radius: number;
  switch (kind) {
    case 'birch':
      trunkHeight = 5 + rng.int(4); // 5-8
      radius = 2;
      break;
    case 'spruce':
      trunkHeight = 7 + rng.int(6); // 7-12
      radius = 2;
      break;
    case 'cactus':
      trunkHeight = 1 + rng.int(3);
      radius = 0;
      break;
    case 'oak':
    default:
      if (isBigOak(seed)) {
        trunkHeight = 6 + rng.int(3); // 6-8
        radius = 3; // radius-3 crown + short branches reach the same distance
      } else {
        trunkHeight = 4 + rng.int(4); // 4-7
        radius = 2;
      }
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

type Visit = TreeBlockVisitor;

interface ShapeCell {
  readonly x: number;
  readonly y: number;
  readonly z: number;
  readonly block: number;
  readonly trunk: boolean;
}

function shapeKey(x: number, y: number, z: number): string {
  return `${x},${y},${z}`;
}

/**
 * Drop leaf blocks that would float: a leaf survives only when another block of the
 * same tree touches it (log or leaf, including diagonals). Runs on the finished shape
 * so every chunk that observes this tree performs the identical pruning.
 */
function pruneIsolatedLeaves(cells: Map<string, ShapeCell>): void {
  const isolated: string[] = [];
  for (const [key, cell] of cells) {
    if (cell.trunk) continue;
    let supported = false;
    for (let dx = -1; dx <= 1 && !supported; dx++) {
      for (let dy = -1; dy <= 1 && !supported; dy++) {
        for (let dz = -1; dz <= 1; dz++) {
          if (dx === 0 && dy === 0 && dz === 0) continue;
          if (cells.has(shapeKey(cell.x + dx, cell.y + dy, cell.z + dz))) {
            supported = true;
            break;
          }
        }
      }
    }
    if (!supported) isolated.push(key);
  }
  for (const key of isolated) cells.delete(key);
}

/**
 * One horizontal leaf layer around (cx, y, cz). Density is higher near the middle
 * and lower towards the rim, corners are dropped for radius >= 2, and every cell
 * rolls independently so crowns have holes instead of being solid rectangles.
 */
function visitLeafLayer(
  visit: Visit,
  rng: Rand,
  cx: number,
  y: number,
  cz: number,
  radius: number,
  density: number,
  leaves: number,
  options: { readonly ringOnly?: boolean } = {},
): void {
  for (let dx = -radius; dx <= radius; dx++) {
    for (let dz = -radius; dz <= radius; dz++) {
      const distance = Math.abs(dx) + Math.abs(dz);
      if (radius >= 2 && distance >= radius * 2) continue; // trim square corners
      if (options.ringOnly && distance < radius) continue;
      let chance = density;
      if (distance > radius) chance *= 0.72;
      if (distance <= 1) chance = Math.min(1, chance * 1.12);
      if (rng.next() > chance) continue;
      visit(cx + dx, y, cz + dz, leaves, false);
    }
  }
}

/** A single leaf block (used for tips/tufts). */
function visitLeaf(visit: Visit, x: number, y: number, z: number, leaves: number): void {
  visit(x, y, z, leaves, false);
}

/**
 * Enumerate every block of a tree. The visitor gets world coordinates so the
 * caller can clip the shape to the chunk currently being generated. Trunk logs
 * take precedence over leaves, and isolated leaves are removed so canopies never
 * contain floating single blocks.
 */
export function forEachTreeBlock(spec: TreeSpec, visitor: Visit): void {
  const cells = new Map<string, ShapeCell>();
  const visit: Visit = (x, y, z, block, trunk) => {
    const key = shapeKey(x, y, z);
    const existing = cells.get(key);
    if (existing !== undefined && existing.trunk && !trunk) return;
    cells.set(key, { x, y, z, block, trunk });
  };
  buildTreeShape(spec, visit);
  pruneIsolatedLeaves(cells);
  for (const cell of cells.values()) visitor(cell.x, cell.y, cell.z, cell.block, cell.trunk);
}

function buildTreeShape(spec: TreeSpec, visit: Visit): void {
  const { log, leaves } = treeBlocks(spec.kind);
  const wx = spec.wx;
  const wz = spec.wz;
  const topY = spec.groundY + spec.trunkHeight;

  if (spec.kind === 'cactus') {
    for (let i = 1; i <= spec.trunkHeight; i++) visit(wx, spec.groundY + i, wz, log, true);
    return;
  }

  const rng = new Rand(spec.seed ^ SHAPE_SALT);
  const buried = rng.next() < BURIED_CHANCE[spec.kind];
  const startY = buried ? spec.groundY : spec.groundY + 1;
  for (let y = startY; y <= topY; y++) visit(wx, y, wz, log, true);

  if (spec.kind === 'spruce') {
    // Conical tower: a leaf tip, then tiers of radius 2 with the trunk showing through
    // for 1-2 blocks between tiers.
    visitLeaf(visit, wx, topY + 1, wz, leaves);
    let y = topY;
    let tier = 0;
    while (y > spec.groundY + 2) {
      const radius = tier === 0 ? 1 : 2;
      const layers = tier === 0 ? 1 : 2;
      for (let layer = 0; layer < layers && y > spec.groundY + 2; layer++, y--) {
        visitLeafLayer(visit, rng, wx, y, wz, radius, radius === 1 ? 0.9 : 0.78, leaves);
      }
      y -= 1 + rng.int(2);
      tier++;
    }
    return;
  }

  if (spec.kind === 'birch') {
    // Small, light, airy crown.
    visitLeaf(visit, wx, topY + 1, wz, leaves);
    visitLeafLayer(visit, rng, wx, topY, wz, 1, 0.85, leaves);
    visitLeafLayer(visit, rng, wx, topY - 1, wz, 2, 0.52, leaves);
    visitLeafLayer(visit, rng, wx, topY - 2, wz, 1, 0.38, leaves);
    return;
  }

  // Oak: normal rounded crown or a rare big branching oak.
  if (isBigOak(spec.seed)) {
    visitLeafLayer(visit, rng, wx, topY + 1, wz, 1, 0.8, leaves);
    visitLeafLayer(visit, rng, wx, topY, wz, 2, 0.88, leaves);
    visitLeafLayer(visit, rng, wx, topY - 1, wz, 3, 0.66, leaves);
    visitLeafLayer(visit, rng, wx, topY - 2, wz, 2, 0.82, leaves);
    visitLeafLayer(visit, rng, wx, topY - 3, wz, 2, 0.42, leaves, { ringOnly: true });

    // Short branches: a couple of logs stepping out and up, with a leaf tuft on top.
    const branchCount = 1 + rng.int(2);
    const dirs: ReadonlyArray<readonly [number, number]> = [
      [1, 0],
      [-1, 0],
      [0, 1],
      [0, -1],
    ];
    for (let i = 0; i < branchCount; i++) {
      const [dx, dz] = dirs[rng.int(dirs.length)];
      const branchY = topY - 1 - rng.int(2);
      visit(wx + dx, branchY, wz + dz, log, true);
      visit(wx + dx * 2, branchY, wz + dz * 2, log, true);
      const tuftY = branchY + 1;
      visitLeafLayer(visit, rng, wx + dx * 2, tuftY, wz + dz * 2, 1, 0.8, leaves);
      if (rng.next() < 0.5) visitLeaf(visit, wx + dx * 2, tuftY + 1, wz + dz * 2, leaves);
    }
    return;
  }

  visitLeaf(visit, wx, topY + 1, wz, leaves);
  visitLeafLayer(visit, rng, wx, topY, wz, 2, 0.84, leaves);
  visitLeafLayer(visit, rng, wx, topY - 1, wz, 2, 0.76, leaves);
  visitLeafLayer(visit, rng, wx, topY - 2, wz, 1, 0.48, leaves);
  // Occasional asymmetric side tuft so crowns are not mirror-symmetric.
  if (rng.next() < 0.45) {
    const ox = rng.next() < 0.5 ? -1 : 1;
    const oz = rng.next() < 0.5 ? -1 : 1;
    visitLeafLayer(visit, rng, wx + ox, topY - 1, wz + oz, 1, 0.6, leaves);
  }
}
