/**
 * Chunk streaming manager (M1): spiral load/unload around the player, generation via
 * worker pool (main-thread fallback), incremental lighting, neighbour-ready meshing
 * with a per-frame budget, and uploads through `ChunkMeshSink.setSection(...)`
 * (`ChunkRenderer.setSection` satisfies it structurally).
 *
 * Integration (Lead, in `src/main.ts`):
 * ```ts
 * const chunkManager = new ChunkManager({
 *   world,
 *   meshSink: chunkRenderer,
 *   layerOf: (tile) => atlas.layerOf(tile),
 *   renderDistance: RENDER_DISTANCE,
 * });
 * const spawn = chunkManager.findSpawn();
 * while (!chunkManager.isReady) { chunkManager.update(spawn.x, spawn.z); await nextFrame(); }
 * // in the frame loop:
 * chunkManager.update(player.position.x, player.position.z);
 * ```
 * The manager installs `world.generator` and `world.lightUpdater` itself; block edits
 * made through `world.setBlock` automatically update light and dirty sections, so the
 * old `remeshAround`/sync generation code in main can be removed.
 */
import { CHUNK_GEN_BUDGET_PER_FRAME, DEFAULT_RENDER_DISTANCE, MAX_RENDER_DISTANCE, SECTION_COUNT } from '../core/config';
import { chunkKey, type ChunkColumn } from './chunk';
import { LightEngine } from './lighting';
import type { SectionMeshData } from './mesher';
import { sectionHasBlocks } from './mesher';
import { createTintResolver, TerrainGenerator, type SpawnPoint, type TintResolver } from './worldgen';
import type { World } from './world';
import { buildMeshPayload, createColumnFromRaw, generateColumnRaw, meshSectionFromAccess, type BlockAccess } from './worker/local';
import { createGenerationPool, createMeshPool } from './worker/pool';
import type { GenerateResultMessage, MeshResultMessage } from './worker/protocol';

/** Structural sink: `ChunkRenderer` from `src/render/chunkRenderer.ts` satisfies it. */
export interface ChunkMeshSink {
  setSection(cx: number, cy: number, cz: number, data: SectionMeshData, version: number): void;
  removeColumn(cx: number, cz: number): void;
}

/** Pool facades so tests can inject deterministic fake workers. */
export interface GenerationPoolLike {
  readonly available: boolean;
  readonly busyCount?: number;
  generate(spec: { cx: number; cz: number; version: number; seedHash: number }): Promise<GenerateResultMessage>;
  dispose(): void;
}

export interface MeshPoolLike {
  readonly available: boolean;
  readonly busyCount?: number;
  mesh(spec: {
    cx: number;
    cy: number;
    cz: number;
    version: number;
    seedHash: number;
    buildPayload: () => import('./worker/local').MeshSectionPayload;
  }): Promise<MeshResultMessage>;
  dispose(): void;
}

export interface ChunkManagerOptions {
  readonly world: World;
  readonly meshSink: ChunkMeshSink;
  /** Atlas texture-array layer lookup (needed by the mesher, main thread and worker). */
  readonly layerOf: (tile: string) => number;
  readonly generator?: TerrainGenerator;
  readonly renderDistance?: number;
  readonly generatePerFrame?: number;
  readonly meshPerFrame?: number;
  readonly relightPerFrame?: number;
  /** Use module workers when available (default true; falls back to main thread). */
  readonly workers?: boolean;
  readonly workerCount?: number;
  /** Test/integration hooks (default: created when `workers` is enabled). */
  readonly generationPool?: GenerationPoolLike | null;
  readonly meshPool?: MeshPoolLike | null;
  /** Biome tint override; defaults to the terrain generator's climate tint. */
  readonly tintOf?: TintResolver;
  readonly spawn?: SpawnPoint | null;
  /**
   * Called on every freshly generated column *before* lighting/meshing so saved
   * edits and block entities can be restored (Lead wires `EditStore.apply` here).
   * EditStore already records gameplay edits through `world.onBlockChanged`, so the
   * manager's own unload archive is only a fallback for callers that do not use it.
   */
  readonly applyColumnEdits?: (column: ChunkColumn) => void;
  readonly onColumnLoaded?: (column: ChunkColumn) => void;
  readonly onColumnUnloaded?: (column: ChunkColumn) => void;
}

export interface ChunkManagerStats {
  readonly loadedColumns: number;
  readonly desiredColumns: number;
  readonly dirtyColumns: number;
  readonly pendingGeneration: number;
  readonly pendingMeshSections: number;
  readonly fallbackJobs: number;
  readonly generationWorkers: boolean;
  readonly meshWorkers: boolean;
}

interface DesiredEntry {
  readonly cx: number;
  readonly cz: number;
  readonly key: string;
}

interface Offset {
  readonly dx: number;
  readonly dz: number;
}

const EMPTY_MESH: SectionMeshData = { opaque: null, cutout: null, transparent: null };
const NEIGHBOUR_DIRS: ReadonlyArray<readonly [number, number]> = [
  [1, 0],
  [-1, 0],
  [0, 1],
  [0, -1],
];
const DIAGONAL_DIRS: ReadonlyArray<readonly [number, number]> = [
  [1, 0],
  [-1, 0],
  [0, 1],
  [0, -1],
  [1, 1],
  [1, -1],
  [-1, 1],
  [-1, -1],
];

const spiralCache = new Map<number, readonly Offset[]>();

/**
 * Loading priority: every chunk offset within `radius` sorted by distance, then by
 * angle, which visits the world in a square spiral expanding outwards.
 */
export function spiralOffsets(radius: number): readonly Offset[] {
  const cached = spiralCache.get(radius);
  if (cached) return cached;
  const offsets: Offset[] = [];
  const limit = (radius + 0.5) * (radius + 0.5);
  for (let dz = -radius; dz <= radius; dz++) {
    for (let dx = -radius; dx <= radius; dx++) {
      if (dx * dx + dz * dz > limit) continue;
      offsets.push({ dx, dz });
    }
  }
  offsets.sort((a, b) => {
    const da = a.dx * a.dx + a.dz * a.dz;
    const db = b.dx * b.dx + b.dz * b.dz;
    if (da !== db) return da - db;
    const angleA = Math.atan2(a.dz, a.dx);
    const angleB = Math.atan2(b.dz, b.dx);
    if (angleA !== angleB) return angleA - angleB;
    if (a.dx !== b.dx) return a.dx - b.dx;
    return a.dz - b.dz;
  });
  spiralCache.set(radius, offsets);
  return offsets;
}

function parseColumnKey(key: string): [number, number] {
  const comma = key.indexOf(',');
  return [Number(key.slice(0, comma)), Number(key.slice(comma + 1))];
}

function sectionKey(cx: number, cy: number, cz: number): string {
  return `${cx},${cy},${cz}`;
}

function clampRenderDistance(value: number): number {
  // Gameplay setting is 4..12, but tests/tools may use a smaller radius for speed.
  return Math.max(1, Math.min(MAX_RENDER_DISTANCE, Math.floor(value)));
}

export class ChunkManager {
  readonly world: World;
  readonly generator: TerrainGenerator;
  readonly renderDistance: number;
  readonly lightEngine: LightEngine;
  readonly loadRadius: number;
  readonly unloadRadius: number;

  private readonly sink: ChunkMeshSink;
  private readonly layerOf: (tile: string) => number;
  private readonly tintOf: TintResolver;
  private readonly read: BlockAccess;
  private readonly generateBudget: number;
  private readonly meshBudget: number;
  private readonly relightBudget: number;
  private readonly genPool: GenerationPoolLike | null;
  private readonly meshPool: MeshPoolLike | null;
  private readonly maxGenerationInFlight: number;
  private readonly maxMeshInFlight: number;
  private readonly spawnOption: SpawnPoint | null;
  private readonly applyColumnEdits?: (column: ChunkColumn) => void;
  private readonly onColumnLoaded?: (column: ChunkColumn) => void;
  private readonly onColumnUnloaded?: (column: ChunkColumn) => void;

  private desiredKeys = new Set<string>();
  private desiredOrder: readonly Offset[] = [];
  private generationQueue: DesiredEntry[] = [];
  private pendingGeneration = new Map<string, number>();
  private nextToken = 1;
  private meshingSections = new Set<string>();
  private geometrySections = new Set<string>();
  private columnEpochs = new Map<string, number>();
  private relightQueue: string[] = [];
  private relightPending = new Set<string>();
  private archivedEdits = new Map<string, Map<number, { id: number; meta: number }>>();
  private meshWork: string[] = [];
  private workRevision = 0;
  private builtWorkRevision = -1;
  private centerX = Number.NaN;
  private centerZ = Number.NaN;
  private disposed = false;
  private fallbackJobs = 0;
  private spawnResult: SpawnPoint | null = null;
  private readonly previousSetBlock: World['setBlock'];
  private readonly previousLightUpdater: ((column: ChunkColumn, x: number, y: number, z: number) => void) | null;

  constructor(options: ChunkManagerOptions) {
    this.world = options.world;
    this.sink = options.meshSink;
    this.layerOf = options.layerOf;
    this.renderDistance = clampRenderDistance(options.renderDistance ?? DEFAULT_RENDER_DISTANCE);
    this.loadRadius = this.renderDistance + 1;
    this.unloadRadius = this.renderDistance + 2;
    this.generateBudget = Math.max(1, options.generatePerFrame ?? CHUNK_GEN_BUDGET_PER_FRAME);
    this.meshBudget = Math.max(1, options.meshPerFrame ?? 16);
    this.relightBudget = Math.max(1, options.relightPerFrame ?? 1);
    this.generator = options.generator ?? new TerrainGenerator(this.world.seedHash);
    this.generator.setSeed(this.world.seedHash);
    this.tintOf = options.tintOf ?? createTintResolver(this.world.seedHash);
    this.spawnOption = options.spawn ?? null;
    this.applyColumnEdits = options.applyColumnEdits;
    this.onColumnLoaded = options.onColumnLoaded;
    this.onColumnUnloaded = options.onColumnUnloaded;
    this.world.generator = this.generator;

    // Route edits through the incremental light engine. `World.setBlock` calls
    // `lightUpdater` *before* `onBlockChanged`; keeping the updater a no-op leaves the
    // old light values untouched until our wrapper below has run, which needs them for
    // the light-removal pass. Wrapping `setBlock` (instead of `onBlockChanged`) keeps
    // working even if the host application assigns its own `onBlockChanged` handler
    // (the Lead's Game does exactly that to record saves).
    this.previousLightUpdater = this.world.lightUpdater;
    this.lightEngine = new LightEngine({
      getColumn: (cx, cz) => this.world.column(cx, cz),
      markDirty: this.markLightDirty,
    });
    this.world.lightUpdater = (): void => {
      // no-op: light is updated in the setBlock wrapper below
    };
    this.previousSetBlock = this.world.setBlock;
    const manager = this;
    this.world.setBlock = function (x: number, y: number, z: number, id: number, meta = 0): boolean {
      const changed = manager.previousSetBlock.call(manager.world, x, y, z, id, meta);
      if (changed) manager.handleWorldBlockChange(x, y, z, id);
      return changed;
    };

    this.read = {
      getBlock: (x, y, z) => this.world.getBlock(x, y, z),
      getMeta: (x, y, z) => this.world.getMeta(x, y, z),
      getSkyLight: (x, y, z) => this.world.getSkyLight(x, y, z),
      getBlockLight: (x, y, z) => this.world.getBlockLight(x, y, z),
    };

    const workersEnabled = options.workers ?? true;
    this.genPool =
      options.generationPool !== undefined
        ? options.generationPool
        : workersEnabled
          ? createGenerationPool(options.workerCount)
          : null;
    this.meshPool =
      options.meshPool !== undefined ? options.meshPool : workersEnabled ? createMeshPool(options.layerOf, options.workerCount) : null;
    const workerCount = options.workerCount ?? 3;
    this.maxGenerationInFlight = this.genPool ? Math.max(2, workerCount * 2) : 0;
    this.maxMeshInFlight = this.meshPool ? Math.max(4, workerCount * 6) : 0;
  }

  // --------------------------------------------------------------------- update

  /** Drive streaming for one frame. Call once per rendered frame. */
  update(playerX: number, playerZ: number): void {
    if (this.disposed) return;
    const cx = Math.floor(playerX / 16);
    const cz = Math.floor(playerZ / 16);
    if (cx !== this.centerX || cz !== this.centerZ || this.desiredKeys.size === 0) {
      this.centerX = cx;
      this.centerZ = cz;
      this.refreshDesired(cx, cz);
    }
    this.processGeneration();
    this.processRelight();
    this.processMeshing();
  }

  /** Safe spawn inside the search radius from PLAN.md §3.2. */
  findSpawn(): SpawnPoint {
    if (this.spawnOption) return this.spawnOption;
    if (!this.spawnResult) {
      this.generator.setSeed(this.world.seedHash);
      this.spawnResult = this.generator.findSpawn();
    }
    return this.spawnResult;
  }

  /** 0..1 streaming progress for the boot screen. */
  get progress(): number {
    if (this.desiredKeys.size === 0) return 0;
    let loaded = 0;
    let meshable = 0;
    let clean = 0;
    for (const key of this.desiredKeys) {
      const [cx, cz] = parseColumnKey(key);
      const column = this.world.column(cx, cz);
      if (!column) continue;
      loaded++;
      if (!this.neighboursReady(column)) continue;
      meshable++;
      if (this.columnClean(column)) clean++;
    }
    const loadPart = loaded / this.desiredKeys.size;
    const meshPart = meshable === 0 ? 1 : clean / meshable;
    return Math.min(1, loadPart * 0.55 + meshPart * 0.45);
  }

  /** True once every desired column is loaded and all meshable columns are meshed. */
  get isReady(): boolean {
    if (this.disposed || this.desiredKeys.size === 0) return false;
    if (this.pendingGeneration.size > 0) return false;
    for (const key of this.desiredKeys) {
      const [cx, cz] = parseColumnKey(key);
      if (!this.world.column(cx, cz)) return false;
    }
    for (const column of this.world.columns.values()) {
      if (!this.neighboursReady(column)) continue;
      if (!this.columnClean(column)) return false;
    }
    return true;
  }

  get stats(): ChunkManagerStats {
    let dirtyColumns = 0;
    for (const column of this.world.columns.values()) {
      for (let section = 0; section < SECTION_COUNT; section++) {
        if (column.dirtySections[section] === 1) {
          dirtyColumns++;
          break;
        }
      }
    }
    return {
      loadedColumns: this.world.loadedColumnCount,
      desiredColumns: this.desiredKeys.size,
      dirtyColumns,
      pendingGeneration: this.pendingGeneration.size,
      pendingMeshSections: this.meshingSections.size,
      fallbackJobs: this.fallbackJobs,
      generationWorkers: this.genPool !== null,
      meshWorkers: this.meshPool !== null,
    };
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.genPool?.dispose();
    this.meshPool?.dispose();
    this.pendingGeneration.clear();
    this.meshingSections.clear();
    this.generationQueue = [];
    this.relightQueue = [];
    this.world.setBlock = this.previousSetBlock;
    this.world.lightUpdater = this.previousLightUpdater;
  }

  // ---------------------------------------------------------------- desired set

  private refreshDesired(cx: number, cz: number): void {
    this.desiredOrder = spiralOffsets(this.loadRadius);
    const desired = new Set<string>();
    const wanted: DesiredEntry[] = [];
    for (const offset of this.desiredOrder) {
      const wx = cx + offset.dx;
      const wz = cz + offset.dz;
      const key = chunkKey(wx, wz);
      desired.add(key);
      if (!this.world.isChunkLoaded(wx, wz)) wanted.push({ cx: wx, cz: wz, key });
    }
    this.desiredKeys = desired;

    for (const column of [...this.world.columns.values()]) {
      if (!desired.has(chunkKey(column.cx, column.cz))) this.unloadColumn(column);
    }

    for (const key of [...this.pendingGeneration.keys()]) {
      if (!desired.has(key)) this.pendingGeneration.delete(key);
    }

    this.generationQueue = [];
    for (const entry of wanted) {
      if (this.pendingGeneration.has(entry.key)) continue;
      if (this.world.isChunkLoaded(entry.cx, entry.cz)) continue;
      this.generationQueue.push(entry);
    }
  }

  private unloadColumn(column: ChunkColumn): void {
    const key = chunkKey(column.cx, column.cz);
    this.relightPending.delete(key);
    if (column.edits.size > 0) this.archivedEdits.set(key, new Map(column.edits));
    const removed = this.world.removeColumn(column.cx, column.cz);
    if (removed) this.sink.removeColumn(column.cx, column.cz);
    this.dropSectionState(column.cx, column.cz);
    this.columnEpochs.set(key, (this.columnEpochs.get(key) ?? 0) + 1);
    this.neighboursForRemesh(column.cx, column.cz, true);
    for (const [dx, dz] of NEIGHBOUR_DIRS) this.scheduleRelight(column.cx + dx, column.cz + dz);
    this.workRevision++;
    this.onColumnUnloaded?.(column);
  }

  private dropSectionState(cx: number, cz: number): void {
    for (const key of [...this.meshingSections]) {
      const [sx, , sz] = key.split(',').map(Number);
      if (sx === cx && sz === cz) this.meshingSections.delete(key);
    }
    for (const key of [...this.geometrySections]) {
      const [gx, , gz] = key.split(',').map(Number);
      if (gx === cx && gz === cz) this.geometrySections.delete(key);
    }
  }

  private scheduleRelight(cx: number, cz: number): void {
    const key = chunkKey(cx, cz);
    if (this.relightPending.has(key)) return;
    if (!this.world.isChunkLoaded(cx, cz)) return;
    this.relightPending.add(key);
    this.relightQueue.push(key);
  }

  // ----------------------------------------------------------------- generation

  private processGeneration(): void {
    if (this.generationQueue.length === 0) return;
    let budget = this.generateBudget;
    while (budget > 0 && this.generationQueue.length > 0) {
      if (this.genPool && this.pendingGeneration.size >= this.maxGenerationInFlight) break;
      const entry = this.generationQueue.shift();
      if (!entry) break;
      if (this.world.isChunkLoaded(entry.cx, entry.cz) || this.pendingGeneration.has(entry.key)) continue;
      budget--;
      if (this.genPool) this.dispatchGeneration(entry);
      else this.applyGenerationResult(entry.cx, entry.cz, generateColumnRaw(this.generator, this.world.seedHash, entry.cx, entry.cz));
    }
  }

  private dispatchGeneration(entry: DesiredEntry): void {
    const pool = this.genPool;
    if (!pool) return;
    const token = this.nextToken++;
    this.pendingGeneration.set(entry.key, token);
    pool
      .generate({ cx: entry.cx, cz: entry.cz, version: token, seedHash: this.world.seedHash })
      .then((result) => {
        if (this.pendingGeneration.get(entry.key) !== token) return;
        this.pendingGeneration.delete(entry.key);
        if (this.disposed || !this.desiredKeys.has(entry.key)) return;
        this.applyGenerationResult(result.cx, result.cz, result);
      })
      .catch(() => {
        if (this.pendingGeneration.get(entry.key) === token) this.pendingGeneration.delete(entry.key);
        if (this.disposed || !this.desiredKeys.has(entry.key) || this.world.isChunkLoaded(entry.cx, entry.cz)) return;
        this.fallbackJobs++;
        this.applyGenerationResult(entry.cx, entry.cz, generateColumnRaw(this.generator, this.world.seedHash, entry.cx, entry.cz));
      });
  }

  private applyGenerationResult(
    cx: number,
    cz: number,
    raw: { blocks: Uint8Array; meta: Uint8Array; heightMap: Uint8Array },
  ): void {
    if (this.disposed) return;
    const key = chunkKey(cx, cz);
    if (!this.desiredKeys.has(key) || this.world.isChunkLoaded(cx, cz)) return;
    const column = createColumnFromRaw(cx, cz, raw);
    const archived = this.archivedEdits.get(key);
    if (archived) {
      for (const [index, edit] of archived) {
        const lx = index & 15;
        const lz = (index >> 4) & 15;
        const y = index >> 8;
        column.setBlockLocal(lx, y, lz, edit.id, edit.meta);
      }
    }
    // Saved edits / block entities must be in place before lighting and meshing.
    this.applyColumnEdits?.(column);
    column.dirtySections.fill(1);
    this.columnEpochs.set(key, (this.columnEpochs.get(key) ?? 0) + 1);
    this.world.insertColumn(column);
    this.lightEngine.lightColumnWithNeighbors(column);
    // The new column changes face culling / border light of its neighbours.
    this.neighboursForRemesh(cx, cz, true);
    this.workRevision++;
    this.onColumnLoaded?.(column);
  }

  // ------------------------------------------------------------------- relight

  private processRelight(): void {
    let budget = this.relightBudget;
    while (budget > 0 && this.relightQueue.length > 0) {
      const key = this.relightQueue.shift();
      if (!key) break;
      this.relightPending.delete(key);
      const [cx, cz] = parseColumnKey(key);
      const column = this.world.column(cx, cz);
      if (!column) continue;
      // Full relight drops light that leaked from an unloaded neighbour.
      this.lightEngine.relightColumn(column);
      column.version++;
      column.dirtySections.fill(1);
      this.neighboursForRemesh(cx, cz, true);
      this.workRevision++;
      budget--;
    }
  }

  // ------------------------------------------------------------------ meshing

  private processMeshing(): void {
    if (this.workRevision !== this.builtWorkRevision) this.rebuildMeshWork();
    if (this.meshWork.length === 0) return;
    let budget = this.meshBudget;
    for (const key of this.meshWork) {
      if (budget <= 0) break;
      if (this.meshPool && this.meshingSections.size >= this.maxMeshInFlight) break;
      const [cx, cz] = parseColumnKey(key);
      const column = this.world.column(cx, cz);
      if (!column) continue;
      if (!this.neighboursReady(column)) continue;
      for (let cy = 0; cy < SECTION_COUNT && budget > 0; cy++) {
        if (column.dirtySections[cy] !== 1) continue;
        const sKey = sectionKey(cx, cy, cz);
        if (this.meshingSections.has(sKey)) continue;
        this.dispatchMesh(column, cy);
        budget--;
      }
    }
  }

  private rebuildMeshWork(): void {
    const centerX = Number.isNaN(this.centerX) ? 0 : this.centerX;
    const centerZ = Number.isNaN(this.centerZ) ? 0 : this.centerZ;
    const entries: Array<{ key: string; distance: number }> = [];
    for (const column of this.world.columns.values()) {
      let dirty = false;
      for (let cy = 0; cy < SECTION_COUNT; cy++) {
        if (column.dirtySections[cy] === 1) {
          dirty = true;
          break;
        }
      }
      if (!dirty) continue;
      const dx = column.cx - centerX;
      const dz = column.cz - centerZ;
      entries.push({ key: chunkKey(column.cx, column.cz), distance: dx * dx + dz * dz });
    }
    entries.sort((a, b) => a.distance - b.distance);
    this.meshWork = entries.map((entry) => entry.key);
    this.builtWorkRevision = this.workRevision;
  }

  private dispatchMesh(column: ChunkColumn, cy: number): void {
    const cx = column.cx;
    const cz = column.cz;
    const key = chunkKey(cx, cz);
    const sKey = sectionKey(cx, cy, cz);
    const epoch = this.columnEpochs.get(key) ?? 0;
    const version = column.version;
    // Clear now; on a discarded/failed result the flag is restored.
    column.dirtySections[cy] = 0;

    if (!sectionHasBlocks(column.blocks, cy)) {
      const hadGeometry = this.geometrySections.delete(sKey);
      if (hadGeometry) this.sink.setSection(cx, cy, cz, EMPTY_MESH, version);
      return;
    }

    this.meshingSections.add(sKey);
    const pool = this.meshPool;
    if (!pool) {
      const data = meshSectionFromAccess(this.read, cx, cy, cz, this.layerOf, this.tintOf);
      this.finishMesh(cx, cy, cz, version, epoch, data);
      return;
    }
    pool
      .mesh({
        cx,
        cy,
        cz,
        version,
        seedHash: this.world.seedHash,
        buildPayload: () => buildMeshPayload(this.read, cx, cy, cz),
      })
      .then((result) => {
        if (this.disposed) {
          this.meshingSections.delete(sKey);
          return;
        }
        const current = this.world.column(cx, cz);
        const currentEpoch = this.columnEpochs.get(key) ?? 0;
        const stale = !current || currentEpoch !== epoch || current.version !== result.version;
        if (stale) {
          this.meshingSections.delete(sKey);
          if (current && currentEpoch === epoch) current.dirtySections[cy] = 1;
          this.workRevision++;
          return;
        }
        this.finishMesh(cx, cy, cz, result.version, epoch, result.data);
      })
      .catch(() => {
        this.meshingSections.delete(sKey);
        const current = this.world.column(cx, cz);
        const currentEpoch = this.columnEpochs.get(key) ?? 0;
        if (this.disposed || !current || currentEpoch !== epoch) return;
        // Worker failed permanently: build the section on the main thread instead.
        this.fallbackJobs++;
        this.finishMesh(cx, cy, cz, current.version, epoch, meshSectionFromAccess(this.read, cx, cy, cz, this.layerOf, this.tintOf));
      });
  }

  private finishMesh(cx: number, cy: number, cz: number, version: number, epoch: number, data: SectionMeshData): void {
    const key = chunkKey(cx, cz);
    const sKey = sectionKey(cx, cy, cz);
    this.meshingSections.delete(sKey);
    const column = this.world.column(cx, cz);
    if (!column || (this.columnEpochs.get(key) ?? 0) !== epoch) return;
    const hasGeometry = data.opaque !== null || data.cutout !== null || data.transparent !== null;
    if (hasGeometry) this.geometrySections.add(sKey);
    else this.geometrySections.delete(sKey);
    column.dirtySections[cy] = 0;
    this.sink.setSection(cx, cy, cz, data, version);
  }

  // ------------------------------------------------------------------ helpers

  private neighboursReady(column: ChunkColumn): boolean {
    for (const [dx, dz] of DIAGONAL_DIRS) {
      if (!this.world.isChunkLoaded(column.cx + dx, column.cz + dz)) return false;
    }
    return true;
  }

  private columnClean(column: ChunkColumn): boolean {
    for (let cy = 0; cy < SECTION_COUNT; cy++) {
      if (column.dirtySections[cy] === 1) return false;
      if (this.meshingSections.has(sectionKey(column.cx, cy, column.cz))) return false;
    }
    return true;
  }

  private neighboursForRemesh(cx: number, cz: number, bumpVersion: boolean): void {
    for (const [dx, dz] of NEIGHBOUR_DIRS) {
      const neighbour = this.world.column(cx + dx, cz + dz);
      if (!neighbour) continue;
      neighbour.dirtySections.fill(1);
      if (bumpVersion) neighbour.version++;
    }
    this.workRevision++;
  }

  /**
   * Runs after every accepted `world.setBlock` (the original method has already
   * written the block and bumped the column version). The light arrays still hold the
   * pre-edit values because `world.lightUpdater` is a no-op, which the incremental
   * light engine needs to remove stale light correctly.
   */
  private handleWorldBlockChange(wx: number, wy: number, wz: number, currentId: number): void {
    this.lightEngine.onBlockChanged(wx, wy, wz, 0, currentId);
    this.markEditedNeighbours(wx, wz);
    this.workRevision++;
  }

  /** Border edits can change a neighbour's face culling; invalidate its in-flight meshes. */
  private markEditedNeighbours(wx: number, wz: number): void {
    const cx = Math.floor(wx / 16);
    const cz = Math.floor(wz / 16);
    const lx = wx - cx * 16;
    const lz = wz - cz * 16;
    if (lx === 0) this.bumpNeighbourVersion(cx - 1, cz);
    if (lx === 15) this.bumpNeighbourVersion(cx + 1, cz);
    if (lz === 0) this.bumpNeighbourVersion(cx, cz - 1);
    if (lz === 15) this.bumpNeighbourVersion(cx, cz + 1);
  }

  private bumpNeighbourVersion(cx: number, cz: number): void {
    const neighbour = this.world.column(cx, cz);
    if (!neighbour) return;
    neighbour.version++;
    neighbour.dirtySections.fill(1);
    this.workRevision++;
  }

  /**
   * Light changed at (wx, wy, wz): mark the owning section and any section that
   * samples this cell through its 1-block padding (including other columns).
   */
  private readonly markLightDirty = (wx: number, wy: number, wz: number): void => {
    if (wy < 0 || wy >= 160) return;
    const cx = Math.floor(wx / 16);
    const cz = Math.floor(wz / 16);
    const column = this.world.column(cx, cz);
    if (!column) return;
    const section = wy >> 4;
    column.dirtySections[section] = 1;
    // Any light change invalidates in-flight meshes for this column.
    column.version++;
    const lx = wx - cx * 16;
    const lz = wz - cz * 16;
    if (lx === 0) this.bumpNeighbourVersion(cx - 1, cz);
    if (lx === 15) this.bumpNeighbourVersion(cx + 1, cz);
    if (lz === 0) this.bumpNeighbourVersion(cx, cz - 1);
    if (lz === 15) this.bumpNeighbourVersion(cx, cz + 1);
    if ((wy & 15) === 0 && section > 0) column.dirtySections[section - 1] = 1;
    if ((wy & 15) === 15 && section < SECTION_COUNT - 1) column.dirtySections[section + 1] = 1;
    this.workRevision++;
  };
}



