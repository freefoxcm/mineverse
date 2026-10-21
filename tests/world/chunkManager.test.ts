import { describe, expect, it } from 'vitest';
import { BLOCK, IS_SOLID } from '../../src/world/blocks';
import { localIndex } from '../../src/world/chunk';
import { ChunkManager, spiralOffsets, type ChunkMeshSink, type ChunkManagerOptions, type GenerationPoolLike, type MeshPoolLike } from '../../src/world/chunkManager';
import type { SectionMeshData } from '../../src/world/mesher';
import { World } from '../../src/world/world';
import { generateColumnRaw, type MeshSectionPayload } from '../../src/world/worker/local';
import type { GenerateResultMessage, MeshResultMessage } from '../../src/world/worker/protocol';
import { TerrainGenerator } from '../../src/world/worldgen';

class FakeSink implements ChunkMeshSink {
  readonly sections = new Map<string, { version: number; data: SectionMeshData }>();
  readonly removed: string[] = [];
  calls = 0;
  callsThisUpdate = 0;

  setSection(cx: number, cy: number, cz: number, data: SectionMeshData, version: number): void {
    this.sections.set(`${cx},${cy},${cz}`, { version, data });
    this.calls++;
    this.callsThisUpdate++;
  }

  removeColumn(cx: number, cz: number): void {
    this.removed.push(`${cx},${cz}`);
    for (const key of [...this.sections.keys()]) {
      const [sx, , sz] = key.split(',').map(Number);
      if (sx === cx && sz === cz) this.sections.delete(key);
    }
  }
}

interface Harness {
  manager: ChunkManager;
  world: World;
  sink: FakeSink;
}

function makeManager(options: Partial<ChunkManagerOptions> = {}): Harness {
  const world = new World('chunk-manager-test');
  const sink = new FakeSink();
  const manager = new ChunkManager({
    world,
    meshSink: sink,
    layerOf: () => 0,
    renderDistance: 1,
    generatePerFrame: 10,
    meshPerFrame: 20,
    workers: false,
    ...options,
  });
  return { manager, world, sink };
}

function updateMany(manager: ChunkManager, x: number, z: number, count: number): void {
  for (let i = 0; i < count; i++) manager.update(x, z);
}

async function flushMicrotasks(): Promise<void> {
  for (let i = 0; i < 20; i++) await Promise.resolve();
}

function loadUntilReady(manager: ChunkManager, x = 8, z = 8, limit = 300): void {
  for (let i = 0; i < limit && !manager.isReady; i++) manager.update(x, z);
}

function columnVersion(world: World, cx: number, cz: number): number {
  return world.column(cx, cz)?.version ?? -1;
}

function deferred<T>(): { promise: Promise<T>; resolve: (value: T) => void; reject: (error: Error) => void } {
  let resolve!: (value: T) => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

describe('chunk streaming', () => {
  it('loads the closest column first and honours the per-frame generate budget', () => {
    const { manager, world } = makeManager({ generatePerFrame: 1 });
    manager.update(8, 8);
    expect(world.loadedColumnCount).toBe(1);
    expect(world.isChunkLoaded(0, 0)).toBe(true);
    expect(world.isChunkLoaded(1, 0)).toBe(false);
    manager.update(8, 8);
    expect(world.loadedColumnCount).toBe(2);
    manager.update(8, 8);
    expect(world.loadedColumnCount).toBe(3);
  });

  it('only meshes a column once all eight neighbours are loaded', () => {
    const { manager, world, sink } = makeManager();
    let firstKey: string | null = null;
    for (let i = 0; i < 40 && firstKey === null; i++) {
      manager.update(8, 8);
      const key = sink.sections.keys().next();
      if (!key.done) firstKey = key.value;
    }
    expect(firstKey).not.toBeNull();
    const [cx, , cz] = firstKey!.split(',').map(Number);
    expect(world.isChunkLoaded(cx, cz)).toBe(true);
    for (const [dx, dz] of [
      [1, 0],
      [-1, 0],
      [0, 1],
      [0, -1],
      [1, 1],
      [1, -1],
      [-1, 1],
      [-1, -1],
    ]) {
      expect(world.isChunkLoaded(cx + dx, cz + dz)).toBe(true);
    }
  });

  it('reaches the ready state and full progress', () => {
    const { manager } = makeManager();
    expect(manager.isReady).toBe(false);
    let frames = 0;
    while (!manager.isReady && frames < 300) {
      manager.update(8, 8);
      frames++;
    }
    expect(manager.isReady).toBe(true);
    expect(manager.progress).toBeCloseTo(1, 5);
    expect(manager.stats.desiredColumns).toBe(spiralOffsets(2).length);
  });

  it('unloads columns outside the unload radius and removes their meshes', () => {
    const { manager, world, sink } = makeManager();
    loadUntilReady(manager);
    const loadedBefore = world.loadedColumnCount;
    expect(loadedBefore).toBeGreaterThan(0);
    manager.update(10000, 10000);
    expect(world.isChunkLoaded(0, 0)).toBe(false);
    expect(sink.removed.length).toBeGreaterThan(0);
    // New area starts streaming in after a few frames.
    updateMany(manager, 10000, 10000, 30);
    expect(world.loadedColumnCount).toBeGreaterThan(0);
    expect(world.isChunkLoaded(Math.floor(10000 / 16), Math.floor(10000 / 16))).toBe(true);
  });

  it('re-meshes a section after a block edit with a higher version', () => {
    const { manager, world, sink } = makeManager();
    loadUntilReady(manager);
    const y = world.spawnY(8, 8);
    const section = y >> 4;
    const key = `${0},${section},0`;
    const before = sink.sections.get(key);
    expect(before).toBeDefined();
    expect(world.setBlock(8, y, 8, BLOCK.stone)).toBe(true);
    const versionAfterEdit = columnVersion(world, 0, 0);
    updateMany(manager, 8, 8, 3);
    const after = sink.sections.get(key);
    expect(after).toBeDefined();
    expect(after!.version).toBeGreaterThanOrEqual(versionAfterEdit);
    expect(after!.version).toBeGreaterThan(before!.version);
  });

  it('keeps streaming within the mesh budget per frame', () => {
    const { manager, sink } = makeManager({ meshPerFrame: 1 });
    for (let i = 0; i < 60; i++) {
      sink.callsThisUpdate = 0;
      manager.update(8, 8);
      expect(sink.callsThisUpdate).toBeLessThanOrEqual(1);
    }
  });

  it('persists edits across unload/reload', () => {
    const { manager, world } = makeManager();
    loadUntilReady(manager);
    const y = world.spawnY(8, 8);
    expect(world.setBlock(8, y, 8, BLOCK.stone)).toBe(true);
    manager.update(9000, 9000);
    expect(world.isChunkLoaded(0, 0)).toBe(false);
    updateMany(manager, 8, 8, 20);
    expect(world.isChunkLoaded(0, 0)).toBe(true);
    expect(world.getBlock(8, y, 8)).toBe(BLOCK.stone);
  });

  it('installs the generator and a working incremental light updater', () => {
    const { manager, world } = makeManager();
    expect(world.generator).toBe(manager.generator);
    expect(world.lightUpdater).not.toBeNull();
    loadUntilReady(manager);
    const y = world.spawnY(8, 8);
    expect(world.setBlock(8, y, 8, BLOCK.torch)).toBe(true);
    expect(world.getBlockLight(8, y, 8)).toBe(14);
    expect(world.getBlockLight(9, y, 8)).toBe(13);
    expect(world.getSkyLight(8, 159, 8)).toBe(15);
  });

  it('propagates torch light across a loaded chunk border', () => {
    const { manager, world } = makeManager();
    loadUntilReady(manager);
    const neighbour = world.column(1, 0);
    expect(neighbour).toBeDefined();
    const neighbourVersionBefore = neighbour!.version;
    const y = Math.max(world.spawnY(15, 8), world.spawnY(16, 8)) + 2;
    expect(world.setBlock(15, y, 8, BLOCK.torch)).toBe(true);
    expect(world.getBlockLight(15, y, 8)).toBe(14);
    expect(world.getBlockLight(16, y, 8)).toBe(13);
    // The light change invalidates the neighbour's in-flight/old meshes.
    expect(neighbour!.version).toBeGreaterThan(neighbourVersionBefore);
    expect(world.column(0, 0)!.dirtySections[y >> 4]).toBe(1);
  });

  it('applies host-provided saved edits before lighting and meshing', () => {
    const { manager, world, sink } = makeManager({
      applyColumnEdits: (column) => {
        if (column.cx !== 0 || column.cz !== 0) return;
        column.blocks[localIndex(8, 100, 8)] = BLOCK.torch;
      },
    });
    loadUntilReady(manager);
    expect(world.getBlock(8, 100, 8)).toBe(BLOCK.torch);
    expect(world.getBlockLight(8, 100, 8)).toBe(14);
    expect(sink.sections.get('0,6,0')).toBeDefined();
    manager.dispose();
  });

  it('still updates lighting when the host owns world.onBlockChanged', () => {
    const { manager, world } = makeManager();
    loadUntilReady(manager);
    let hostEvents = 0;
    world.onBlockChanged = () => {
      hostEvents++;
    };
    const y = world.spawnY(8, 8);
    expect(world.setBlock(8, y, 8, BLOCK.torch)).toBe(true);
    expect(hostEvents).toBe(1);
    expect(world.getBlockLight(8, y, 8)).toBe(14);
    expect(world.getBlockLight(9, y, 8)).toBe(13);
    manager.dispose();
  });

  it('finds a safe spawn above sea level', () => {
    const { manager, world } = makeManager();
    const spawn = manager.findSpawn();
    expect(spawn.safe).toBe(true);
    expect(spawn.y).toBeGreaterThan(63);
    expect(Number.isInteger(spawn.x)).toBe(false); // +0.5 centre
    manager.update(spawn.x, spawn.z);
    loadUntilReady(manager, spawn.x, spawn.z);
    const ground = world.getBlock(Math.floor(spawn.x), spawn.y - 1, Math.floor(spawn.z));
    expect(IS_SOLID[ground]).toBe(1);
    expect(world.getBlock(Math.floor(spawn.x), spawn.y, Math.floor(spawn.z))).toBe(0);
  });
});

describe('worker integration', () => {
  it('discards a stale mesh result after the column was edited', async () => {
    const pending: Array<{ spec: Parameters<MeshPoolLike['mesh']>[0]; deferred: ReturnType<typeof deferred<MeshResultMessage>> }> = [];
    const fakeMeshPool: MeshPoolLike = {
      available: true,
      mesh(spec) {
        const job = deferred<MeshResultMessage>();
        pending.push({ spec, deferred: job });
        return job.promise;
      },
      dispose() {
        // nothing
      },
    };
    const { manager, world, sink } = makeManager({ meshPool: fakeMeshPool });
    let target: (typeof pending)[number] | null = null;
    for (let i = 0; i < 30 && !target; i++) {
      manager.update(8, 8);
      const targetSection = world.spawnY(8, 8) >> 4;
      target = pending.find((entry) => entry.spec.cx === 0 && entry.spec.cz === 0 && entry.spec.cy === targetSection) ?? null;
    }
    expect(target).not.toBeNull();
    const spawnY = world.spawnY(8, 8);
    const staleVersion = target!.spec.version;
    // Edit inside that section while the "worker" is still busy.
    expect(world.setBlock(8, spawnY, 8, BLOCK.stone)).toBe(true);
    const data = target!.spec.buildPayload();
    target!.deferred.resolve({
      kind: 'mesh-result',
      jobId: 1,
      cx: target!.spec.cx,
      cy: target!.spec.cy,
      cz: target!.spec.cz,
      version: staleVersion,
      data: meshResult(data),
    });
    await flushMicrotasks();
    const sectionKey = `${target!.spec.cx},${target!.spec.cy},${target!.spec.cz}`;
    const applied = sink.sections.get(sectionKey);
    expect(applied === undefined || applied.version !== staleVersion).toBe(true);
    expect(world.column(0, 0)!.dirtySections[target!.spec.cy]).toBe(1);

    // The section is re-dispatched and a fresh result is accepted.
    const pendingBefore = pending.length;
    manager.update(8, 8);
    expect(pending.length).toBeGreaterThan(pendingBefore);
    const fresh = pending
      .slice(pendingBefore)
      .find((entry) => entry.spec.cx === 0 && entry.spec.cz === 0 && entry.spec.cy === target!.spec.cy);
    expect(fresh).toBeDefined();
    const freshData = meshResult(fresh!.spec.buildPayload());
    fresh!.deferred.resolve({
      kind: 'mesh-result',
      jobId: 2,
      cx: fresh!.spec.cx,
      cy: fresh!.spec.cy,
      cz: fresh!.spec.cz,
      version: fresh!.spec.version,
      data: freshData,
    });
    await flushMicrotasks();
    expect(sink.sections.get(sectionKey)?.version).toBe(fresh!.spec.version);
    manager.dispose();
  });

  it('falls back to main-thread generation when the worker pool keeps failing', async () => {
    const failingPool: GenerationPoolLike = {
      available: true,
      generate() {
        return Promise.reject(new Error('worker exploded'));
      },
      dispose() {
        // nothing
      },
    };
    const { manager, world } = makeManager({ generationPool: failingPool, generatePerFrame: 2 });
    manager.update(8, 8);
    await flushMicrotasks();
    expect(world.isChunkLoaded(0, 0)).toBe(true);
    expect(manager.stats.fallbackJobs).toBeGreaterThan(0);
    manager.dispose();
  });

  it('discards a generation result for a column the player already left', async () => {
    const requests: Array<{ cx: number; cz: number; job: ReturnType<typeof deferred<GenerateResultMessage>> }> = [];
    const slowPool: GenerationPoolLike = {
      available: true,
      generate(spec) {
        const job = deferred<GenerateResultMessage>();
        requests.push({ cx: spec.cx, cz: spec.cz, job });
        return job.promise;
      },
      dispose() {
        // nothing
      },
    };
    const { manager, world } = makeManager({ generationPool: slowPool, generatePerFrame: 1 });
    manager.update(8, 8);
    expect(requests.length).toBe(1);
    const first = requests[0];
    // Move the player far away before the worker responds.
    manager.update(30000, 30000);
    const generator = new TerrainGenerator(world.seedHash);
    const raw = generateColumnRaw(generator, world.seedHash, first.cx, first.cz);
    first.job.resolve({
      kind: 'generate-result',
      jobId: 1,
      cx: first.cx,
      cz: first.cz,
      version: 1,
      blocks: raw.blocks,
      meta: raw.meta,
      heightMap: raw.heightMap,
    });
    await flushMicrotasks();
    expect(world.isChunkLoaded(first.cx, first.cz)).toBe(false);
    manager.dispose();
  });
});

function meshResult(payload: MeshSectionPayload): SectionMeshData {
  // Reconstruct mesh from payload at section (0, targetSection, 0) is not needed for the
  // stale/fresh assertions; an empty mesh is enough as long as version bookkeeping is right.
  void payload;
  return { opaque: null, cutout: null, transparent: null };
}

