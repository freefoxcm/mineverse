/**
 * Pure, environment-agnostic helpers shared by the main thread and the workers.
 *
 * Anything in this file must be safe to import in a module worker: no DOM, no
 * three.js, no `Worker` construction. Keeping generation/meshing here is what makes
 * the worker path and the main-thread fallback byte-identical.
 */
import { CHUNK_SIZE, WORLD_HEIGHT } from '../../core/config';
import { BLOCKS, blockNumeric, faceTexture } from '../blocks';
import { ChunkColumn } from '../chunk';
import { meshSection, type MeshContext, type SectionMeshData } from '../mesher';
import { createTintResolver, type TerrainGenerator, type TintResolver } from '../worldgen';

export interface RawColumnPayload {
  blocks: Uint8Array;
  meta: Uint8Array;
  heightMap: Uint8Array;
}

/** Minimal typed view of a dedicated worker global scope (avoids DOM/WebWorker lib clashes). */
export interface WorkerScope {
  addEventListener(type: 'message', listener: (event: MessageEvent<unknown>) => void): void;
  postMessage(message: unknown, transfer?: Transferable[]): void;
}

/** Generate a raw column (allocates fresh transferable arrays). */
export function generateColumnRaw(generator: TerrainGenerator, seedHash: number, cx: number, cz: number): RawColumnPayload {
  const volume = CHUNK_SIZE * CHUNK_SIZE * WORLD_HEIGHT;
  const blocks = new Uint8Array(volume);
  const meta = new Uint8Array(volume);
  const heightMap = new Uint8Array(CHUNK_SIZE * CHUNK_SIZE);
  generator.generateInto(cx, cz, seedHash, blocks, meta, heightMap);
  return { blocks, meta, heightMap };
}

/** Wrap a worker-generated (or main-thread generated) raw column into a `ChunkColumn`. */
export function createColumnFromRaw(cx: number, cz: number, raw: RawColumnPayload): ChunkColumn {
  const column = new ChunkColumn(cx, cz);
  column.blocks.set(raw.blocks);
  column.meta.set(raw.meta);
  column.heightMap.set(raw.heightMap);
  return column;
}

// ---------------------------------------------------------------------------
// Mesh payload: an 18^3 padded block of the section neighbourhood. Only blocks,
// meta and the two light arrays are needed by `meshSection`; everything else
// (layer mapping, tints) is deterministic data the worker can rebuild.
// ---------------------------------------------------------------------------

export const MESH_PAD = 1;
export const MESH_DIM = CHUNK_SIZE + MESH_PAD * 2; // 18
export const MESH_VOLUME = MESH_DIM * MESH_DIM * MESH_DIM;

export interface MeshSectionPayload {
  blocks: Uint8Array;
  meta: Uint8Array;
  sky: Uint8Array;
  blockLight: Uint8Array;
}

export interface BlockAccess {
  getBlock(x: number, y: number, z: number): number;
  getMeta(x: number, y: number, z: number): number;
  getSkyLight(x: number, y: number, z: number): number;
  getBlockLight(x: number, y: number, z: number): number;
}

export function meshPayloadIndex(px: number, py: number, pz: number): number {
  return (py * MESH_DIM + pz) * MESH_DIM + px;
}

/** Build the padded payload for section (cx, cy, cz). */
export function buildMeshPayload(read: BlockAccess, cx: number, cy: number, cz: number): MeshSectionPayload {
  const blocks = new Uint8Array(MESH_VOLUME);
  const meta = new Uint8Array(MESH_VOLUME);
  const sky = new Uint8Array(MESH_VOLUME);
  const blockLight = new Uint8Array(MESH_VOLUME);
  const originX = cx * CHUNK_SIZE - MESH_PAD;
  const originY = cy * CHUNK_SIZE - MESH_PAD;
  const originZ = cz * CHUNK_SIZE - MESH_PAD;
  let index = 0;
  for (let py = 0; py < MESH_DIM; py++) {
    const wy = originY + py;
    for (let pz = 0; pz < MESH_DIM; pz++) {
      const wz = originZ + pz;
      for (let px = 0; px < MESH_DIM; px++) {
        const wx = originX + px;
        blocks[index] = read.getBlock(wx, wy, wz);
        meta[index] = read.getMeta(wx, wy, wz);
        sky[index] = read.getSkyLight(wx, wy, wz);
        blockLight[index] = read.getBlockLight(wx, wy, wz);
        index++;
      }
    }
  }
  return { blocks, meta, sky, blockLight };
}

export function meshPayloadTransferables(payload: MeshSectionPayload): Transferable[] {
  return [payload.blocks.buffer, payload.meta.buffer, payload.sky.buffer, payload.blockLight.buffer];
}

/** Reconstruct the mesher's world view from a padded payload. */
export function createMeshContextFromPayload(
  payload: MeshSectionPayload,
  cx: number,
  cy: number,
  cz: number,
  layerOf: (tile: string) => number,
  tintOf: TintResolver,
): MeshContext {
  const originX = cx * CHUNK_SIZE - MESH_PAD;
  const originY = cy * CHUNK_SIZE - MESH_PAD;
  const originZ = cz * CHUNK_SIZE - MESH_PAD;
  const indexOrMinusOne = (x: number, y: number, z: number): number => {
    const px = x - originX;
    const py = y - originY;
    const pz = z - originZ;
    if (px < 0 || px >= MESH_DIM || py < 0 || py >= MESH_DIM || pz < 0 || pz >= MESH_DIM) return -1;
    return meshPayloadIndex(px, py, pz);
  };
  return {
    getBlock(x, y, z) {
      if (y < 0) return BEDROCK_ID; // bedrock below the world, matching World.getBlock
      const index = indexOrMinusOne(x, y, z);
      return index < 0 ? 0 : payload.blocks[index];
    },
    getMeta(x, y, z) {
      const index = indexOrMinusOne(x, y, z);
      return index < 0 ? 0 : payload.meta[index];
    },
    getSkyLight(x, y, z) {
      if (y >= WORLD_HEIGHT) return 15;
      const index = indexOrMinusOne(x, y, z);
      return index < 0 ? 0 : payload.sky[index];
    },
    getBlockLight(x, y, z) {
      const index = indexOrMinusOne(x, y, z);
      return index < 0 ? 0 : payload.blockLight[index];
    },
    layerOf,
    tintOf: (blockId, x, z) => tintOf(blockId, x, z),
  };
}

/** Mesh a section from a padded payload (used by the worker and the fallback). */
export function meshSectionFromPayload(
  payload: MeshSectionPayload,
  cx: number,
  cy: number,
  cz: number,
  layerOf: (tile: string) => number,
  tintOf: TintResolver,
): SectionMeshData {
  const context = createMeshContextFromPayload(payload, cx, cy, cz, layerOf, tintOf);
  return meshSection(context, cx, cy, cz);
}

/** Mesh a section straight from the live world (main-thread fallback). */
export function meshSectionFromAccess(
  read: BlockAccess,
  cx: number,
  cy: number,
  cz: number,
  layerOf: (tile: string) => number,
  tintOf: TintResolver,
): SectionMeshData {
  const context: MeshContext = {
    getBlock: (x, y, z) => read.getBlock(x, y, z),
    getMeta: (x, y, z) => read.getMeta(x, y, z),
    getSkyLight: (x, y, z) => read.getSkyLight(x, y, z),
    getBlockLight: (x, y, z) => read.getBlockLight(x, y, z),
    layerOf,
    tintOf: (blockId, x, z) => tintOf(blockId, x, z),
  };
  return meshSection(context, cx, cy, cz);
}

// ---------------------------------------------------------------------------
// Texture layer mapping. `TextureAtlas` (Lead-owned) builds layers from the same
// deterministic name set, so the worker can reproduce layer numbers by asking the
// main thread for `layerOf(name)` once and sending the resulting name -> layer map.
// ---------------------------------------------------------------------------

const EXTRA_TILES: readonly string[] = Array.from({ length: 10 }, (_, i) => `crack_${i}`);

const BEDROCK_ID = blockNumeric('bedrock');

/** Same deterministic collection order as `TextureAtlas`, sorted by tile name. */
export function collectTileNames(): string[] {
  const names = new Set<string>(EXTRA_TILES);
  for (const block of BLOCKS) {
    for (let face = 0; face < 6; face++) names.add(faceTexture(block, face));
  }
  return [...names].sort();
}

/** Build the serialisable name -> layer map from the live atlas lookup. */
export function buildTileLayers(layerOf: (tile: string) => number): Array<[string, number]> {
  return collectTileNames().map((name) => [name, layerOf(name)] as [string, number]);
}

/** Memoised tint resolvers, one per world seed. */
const tintResolvers = new Map<number, TintResolver>();

export function getTintResolver(seedHash: number): TintResolver {
  const cached = tintResolvers.get(seedHash);
  if (cached) return cached;
  const resolver = createTintResolver(seedHash);
  tintResolvers.set(seedHash, resolver);
  return resolver;
}

