import { describe, expect, it } from 'vitest';
import { ChunkColumn } from '../../src/world/chunk';
import { BLOCK, blockNumeric } from '../../src/world/blocks';
import {
  buildMeshPayload,
  buildTileLayers,
  collectTileNames,
  createColumnFromRaw,
  generateColumnRaw,
  meshPayloadIndex,
  meshSectionFromAccess,
  meshSectionFromPayload,
  MESH_DIM,
  type BlockAccess,
} from '../../src/world/worker/local';
import {
  createJobIds,
  generationResultTransferables,
  isGenerateJob,
  isMeshJob,
  isStaleVersion,
  JobVersionGate,
  jobKey,
  meshJobTransferables,
  meshResultTransferables,
  parseGenerateResponse,
  parseMeshResponse,
  type GenerateResultMessage,
} from '../../src/world/worker/protocol';
import { canUseWorkers, createGenerationPool, createMeshPool } from '../../src/world/worker/pool';
import { spiralOffsets } from '../../src/world/chunkManager';
import { TerrainGenerator } from '../../src/world/worldgen';
import { createTintResolver } from '../../src/world/worldgen';

function makeAccess(blocks: Map<string, number>, sky = 15, blockLight = 0): BlockAccess {
  return {
    getBlock: (x, y, z) => blocks.get(`${x},${y},${z}`) ?? 0,
    getMeta: () => 0,
    getSkyLight: () => sky,
    getBlockLight: () => blockLight,
  };
}

describe('mesh payload', () => {
  it('pads the section neighbourhood to 18^3 and round-trips exactly', () => {
    const blocks = new Map<string, number>();
    blocks.set('5,5,5', BLOCK.stone);
    blocks.set('6,5,5', BLOCK.oak_leaves);
    blocks.set('7,5,5', BLOCK.water);
    blocks.set('4,5,5', blockNumeric('tall_grass'));
    blocks.set('-1,4,-1', BLOCK.stone); // outside section 0,0,0 but inside padding
    const access = makeAccess(blocks, 12, 3);
    const payload = buildMeshPayload(access, 0, 0, 0);
    expect(payload.blocks.length).toBe(MESH_DIM ** 3);
    expect(payload.meta.length).toBe(MESH_DIM ** 3);
    expect(payload.blocks[meshPayloadIndex(6, 6, 6)]).toBe(BLOCK.stone); // world (5,5,5)
    expect(payload.blocks[meshPayloadIndex(0, 5, 0)]).toBe(BLOCK.stone); // world (-1,4,-1)

    const layerOf = (tile: string): number => collectTileNames().indexOf(tile);
    const tintOf = createTintResolver(123);
    const viaAccess = meshSectionFromAccess(access, 0, 0, 0, layerOf, tintOf);
    const viaPayload = meshSectionFromPayload(payload, 0, 0, 0, layerOf, tintOf);
    for (const layer of ['opaque', 'cutout', 'transparent'] as const) {
      const a = viaAccess[layer];
      const b = viaPayload[layer];
      if (!a || !b) {
        expect(a).toBe(b);
        continue;
      }
      expect([...b.positions]).toEqual([...a.positions]);
      expect([...b.uvs]).toEqual([...a.uvs]);
      expect([...b.layers]).toEqual([...a.layers]);
      expect([...b.lights]).toEqual([...a.lights]);
      expect([...b.shades]).toEqual([...a.shades]);
      expect([...b.tints]).toEqual([...a.tints]);
      expect([...b.indices]).toEqual([...a.indices]);
    }
  });

  it('maps world coordinates to padded indices correctly', () => {
    const ix000 = meshPayloadIndex(0, 0, 0);
    const ix100 = meshPayloadIndex(1, 0, 0);
    const ix010 = meshPayloadIndex(0, 1, 0);
    const ix001 = meshPayloadIndex(0, 0, 1);
    expect(ix100 - ix000).toBe(1);
    expect(ix010 - ix000).toBe(MESH_DIM * MESH_DIM);
    expect(ix001 - ix000).toBe(MESH_DIM);
  });
});

describe('generation fallback helpers', () => {
  it('generateColumnRaw matches TerrainGenerator.generate byte for byte', () => {
    const seedHash = 0x1234abcd;
    const generator = new TerrainGenerator(seedHash);
    const raw = generateColumnRaw(generator, seedHash, 3, -2);
    const column = new ChunkColumn(3, -2);
    generator.generate(column, seedHash);
    expect(raw.blocks.length).toBe(column.blocks.length);
    expect([...raw.blocks]).toEqual([...column.blocks]);
    expect([...raw.meta]).toEqual([...column.meta]);
    expect([...raw.heightMap]).toEqual([...column.heightMap]);
  });

  it('createColumnFromRaw copies arrays into a ChunkColumn', () => {
    const generator = new TerrainGenerator(7);
    const raw = generateColumnRaw(generator, 7, 0, 0);
    const column = createColumnFromRaw(0, 0, raw);
    expect(column.getBlock(0, 0, 0)).toBe(BLOCK.bedrock);
    expect(column.blocks.length).toBe(raw.blocks.length);
    expect(column.heightMap.length).toBe(256);
    // Must be a copy, not the same buffer: the raw arrays were transferred.
    expect(column.blocks.buffer).not.toBe(raw.blocks.buffer);
  });
});

describe('protocol', () => {
  it('assigns increasing job ids', () => {
    const next = createJobIds(10);
    expect(next()).toBe(10);
    expect(next()).toBe(11);
    expect(next()).toBe(12);
  });

  it('builds unique keys and detects version staleness', () => {
    expect(jobKey('mesh', 1, 2, 3)).toBe('mesh:1,3,2');
    expect(isStaleVersion(2, 2)).toBe(false);
    expect(isStaleVersion(2, 3)).toBe(true);
  });

  it('discards superseded or outdated worker results', () => {
    const gate = new JobVersionGate();
    const idA = gate.begin('mesh', 0, 0, 5, 1);
    expect(gate.isStale('mesh', 0, 0, 1, idA, 5, 5)).toBe(false);
    // A newer job for the same section supersedes A.
    const idB = gate.begin('mesh', 0, 0, 5, 1);
    expect(gate.isStale('mesh', 0, 0, 1, idA, 5, 5)).toBe(true);
    expect(gate.isStale('mesh', 0, 0, 1, idB, 5, 5)).toBe(false);
    // Column edited after dispatch: version check catches it.
    expect(gate.isStale('mesh', 0, 0, 1, idB, 5, 6)).toBe(true);
    gate.settle(idB);
    expect(gate.isStale('mesh', 0, 0, 1, idB, 5, 5)).toBe(true);
  });

  it('validates worker messages and drops malformed data', () => {
    const blocks = new Uint8Array(40960);
    const meta = new Uint8Array(40960);
    const heightMap = new Uint8Array(256);
    const valid: GenerateResultMessage = { kind: 'generate-result', jobId: 4, cx: 1, cz: 2, version: 9, blocks, meta, heightMap };
    expect(parseGenerateResponse(valid)?.jobId).toBe(4);
    expect(parseGenerateResponse({ kind: 'generate-result', jobId: 4 })).toBeNull();
    expect(parseGenerateResponse({ kind: 'nope' })).toBeNull();
    expect(parseGenerateResponse({ kind: 'error', jobId: 7, message: 'boom' })).toEqual({ kind: 'error', jobId: 7, message: 'boom' });
    expect(parseMeshResponse({ kind: 'mesh-result', jobId: 1, cx: 0, cy: 0, cz: 0, version: 0, data: {} })?.jobId).toBe(1);
    expect(parseMeshResponse(null)).toBeNull();

    expect(isGenerateJob({ kind: 'generate', jobId: 1, cx: 0, cz: 0, version: 1, seedHash: 2 })).toBe(true);
    expect(isGenerateJob({ kind: 'generate', jobId: 'x' })).toBe(false);
    expect(
      isMeshJob({
        kind: 'mesh',
        jobId: 1,
        cx: 0,
        cy: 0,
        cz: 0,
        version: 0,
        seedHash: 0,
        payload: { blocks: new Uint8Array(1), meta: new Uint8Array(1), sky: new Uint8Array(1), blockLight: new Uint8Array(1) },
      }),
    ).toBe(true);
  });

  it('exposes transferable buffers for generation and mesh results', () => {
    const result: GenerateResultMessage = {
      kind: 'generate-result',
      jobId: 1,
      cx: 0,
      cz: 0,
      version: 0,
      blocks: new Uint8Array(3),
      meta: new Uint8Array(3),
      heightMap: new Uint8Array(3),
    };
    expect(generationResultTransferables(result).length).toBe(3);
    const volume = MESH_DIM ** 3;
    const payload = {
      blocks: new Uint8Array(volume),
      meta: new Uint8Array(volume),
      sky: new Uint8Array(volume).fill(15),
      blockLight: new Uint8Array(volume),
    };
    payload.blocks[meshPayloadIndex(9, 9, 9)] = BLOCK.stone;
    const mesh = meshSectionFromPayload(payload, 0, 0, 0, () => 0, createTintResolver(0));
    expect(mesh.opaque).not.toBeNull();
    expect(meshResultTransferables(mesh).length).toBe(7);
    expect(meshJobTransferables(payload).length).toBe(4);
  });
});

describe('tile layer mapping', () => {
  it('collects and sorts every block face tile plus crack tiles', () => {
    const names = collectTileNames();
    expect(names).toContain('grass_top');
    expect(names).toContain('oak_log_top');
    expect(names).toContain('crack_9');
    expect(names).toEqual([...names].sort());
    expect(new Set(names).size).toBe(names.length);
    const layers = buildTileLayers((tile) => names.indexOf(tile));
    expect(layers.length).toBe(names.length);
    expect(layers[0][1]).toBe(0);
  });
});

describe('worker availability / streaming priority', () => {
  it('reports module workers unavailable under Node and returns null pools', () => {
    expect(canUseWorkers()).toBe(typeof Worker !== 'undefined');
    if (!canUseWorkers()) {
      expect(createGenerationPool()).toBeNull();
      expect(createMeshPool(() => 0)).toBeNull();
    }
  });

  it('spiral offsets expand outwards without duplicates', () => {
    const offsets = spiralOffsets(2);
    expect(offsets[0]).toEqual({ dx: 0, dz: 0 });
    expect(offsets.length).toBe(21);
    const seen = new Set<string>();
    let previous = -1;
    for (const offset of offsets) {
      const distance = offset.dx * offset.dx + offset.dz * offset.dz;
      expect(distance).toBeGreaterThanOrEqual(previous);
      previous = distance;
      const key = `${offset.dx},${offset.dz}`;
      expect(seen.has(key)).toBe(false);
      seen.add(key);
    }
  });
});
