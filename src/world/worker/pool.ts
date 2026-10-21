/**
 * Module-worker pools for column generation and section meshing.
 *
 * - `new Worker(new URL('./generationWorker.ts', import.meta.url), { type: 'module' })`
 *   so Vite bundles the worker entry and serves it correctly in dev + build.
 * - Requests/results use transferable ArrayBuffers (structured clone without copy).
 * - Every task is retried exactly once on worker error/timeout; if it still fails
 *   the promise rejects and `ChunkManager` falls back to the main thread.
 * - `jobId` matches responses to requests; `version` lets the caller discard stale
 *   results (see protocol.ts / JobVersionGate).
 */
import {
  createJobIds,
  meshJobTransferables,
  parseGenerateResponse,
  parseMeshResponse,
  type GenerateJobMessage,
  type GenerateResultMessage,
  type MeshJobMessage,
  type MeshResultMessage,
  type WorkerErrorMessage,
  type InitLayersMessage,
} from './protocol';
import { buildTileLayers, type MeshSectionPayload } from './local';

/** 3-4 workers: leave the main thread a couple of cores (PLAN.md §3.1). */
export function defaultWorkerCount(): number {
  const cores =
    typeof navigator !== 'undefined' && typeof navigator.hardwareConcurrency === 'number' ? navigator.hardwareConcurrency : 4;
  return Math.max(1, Math.min(4, cores - 2));
}

export function canUseWorkers(): boolean {
  return typeof Worker !== 'undefined' && typeof URL !== 'undefined';
}

/**
 * Worker entry points. Kept as narrow top-level factories so Vite's static analysis
 * can always find `new Worker(new URL(...), { type: 'module' })`.
 */
function spawnGenerationWorker(): Worker {
  return new Worker(new URL('./generationWorker.ts', import.meta.url), { type: 'module' });
}

function spawnMeshWorker(): Worker {
  return new Worker(new URL('./meshWorker.ts', import.meta.url), { type: 'module' });
}

interface PoolTask<TReq, TRes> {
  readonly jobId: number;
  readonly build: (jobId: number) => { request: TReq; transfer: Transferable[] };
  readonly resolve: (result: TRes) => void;
  readonly reject: (error: Error) => void;
  attempts: number;
  slot: number;
  timer: ReturnType<typeof setTimeout> | null;
}

interface PoolSlot<TReq, TRes> {
  worker: Worker | null;
  task: PoolTask<TReq, TRes> | null;
}

interface PoolOptions<TReq, TRes> {
  readonly size: number;
  readonly label: string;
  readonly spawn: () => Worker;
  readonly parse: (data: unknown) => TRes | WorkerErrorMessage | null;
  readonly expectedKind: string;
  readonly onSpawn?: (worker: Worker) => void;
  readonly timeoutMs?: number;
  readonly maxQueue?: number;
}

const DEFAULT_TIMEOUT_MS = 20000;
const DEFAULT_MAX_QUEUE = 256;

function toError(value: unknown): Error {
  return value instanceof Error ? value : new Error(String(value));
}

/** Generic job pool over `Worker` instances. Not exported: use the concrete pools. */
class WorkerJobPool<TReq extends { jobId: number }, TRes extends { jobId: number; kind: string }> {
  private readonly slots: PoolSlot<TReq, TRes>[] = [];
  private readonly tasks = new Map<number, PoolTask<TReq, TRes>>();
  private readonly queue: PoolTask<TReq, TRes>[] = [];
  private readonly nextJobId = createJobIds();
  private disposed = false;

  constructor(private readonly config: PoolOptions<TReq, TRes>) {
    for (let i = 0; i < config.size; i++) this.slots.push(this.createSlot());
    if (this.slots.length === 0) throw new Error(`${config.label} pool has no workers`);
  }

  get available(): boolean {
    return !this.disposed && this.slots.some((slot) => slot.worker !== null);
  }

  get busyCount(): number {
    return this.tasks.size;
  }

  get queuedCount(): number {
    return this.queue.length;
  }

  run(build: (jobId: number) => { request: TReq; transfer: Transferable[] }): Promise<TRes> {
    return new Promise<TRes>((resolve, reject) => {
      if (this.disposed) {
        reject(new Error(`${this.config.label} pool disposed`));
        return;
      }
      if (this.queue.length >= (this.config.maxQueue ?? DEFAULT_MAX_QUEUE)) {
        reject(new Error(`${this.config.label} pool queue full`));
        return;
      }
      const task: PoolTask<TReq, TRes> = {
        jobId: this.nextJobId(),
        build,
        resolve,
        reject,
        attempts: 0,
        slot: -1,
        timer: null,
      };
      this.queue.push(task);
      this.pump();
    });
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    const error = new Error(`${this.config.label} pool disposed`);
    for (const task of this.queue.splice(0)) {
      if (task.timer !== null) clearTimeout(task.timer);
      task.reject(error);
    }
    for (const task of this.tasks.values()) {
      if (task.timer !== null) clearTimeout(task.timer);
      task.reject(error);
    }
    this.tasks.clear();
    for (const slot of this.slots) {
      slot.task = null;
      this.terminateWorker(slot);
    }
  }

  // ------------------------------------------------------------------ internals

  private createSlot(): PoolSlot<TReq, TRes> {
    const slot: PoolSlot<TReq, TRes> = { worker: null, task: null };
    this.spawnInto(slot);
    return slot;
  }

  private spawnInto(slot: PoolSlot<TReq, TRes>): void {
    const worker = this.config.spawn();
    slot.worker = worker;
    worker.addEventListener('message', (event: MessageEvent<unknown>) => this.handleMessage(slot, event.data));
    worker.addEventListener('error', (event: ErrorEvent) => {
      this.failSlotTask(slot, new Error(event.message || `${this.config.label} worker error`));
    });
    worker.addEventListener('messageerror', () => {
      this.failSlotTask(slot, new Error(`${this.config.label} worker messageerror`));
    });
    this.config.onSpawn?.(worker);
  }

  private terminateWorker(slot: PoolSlot<TReq, TRes>): void {
    const worker = slot.worker;
    slot.worker = null;
    if (worker) {
      try {
        worker.terminate();
      } catch {
        // best effort
      }
    }
  }

  private replaceWorker(slot: PoolSlot<TReq, TRes>): void {
    this.terminateWorker(slot);
    try {
      this.spawnInto(slot);
    } catch {
      slot.worker = null;
    }
  }

  private pump(): void {
    while (!this.disposed && this.queue.length > 0) {
      const slot = this.slots.find((candidate) => candidate.task === null && candidate.worker !== null);
      if (!slot) return;
      const task = this.queue.shift();
      if (!task) return;
      this.dispatch(slot, task);
    }
  }

  private dispatch(slot: PoolSlot<TReq, TRes>, task: PoolTask<TReq, TRes>): void {
    const slotIndex = this.slots.indexOf(slot);
    task.slot = slotIndex;
    task.attempts++;
    let payload: { request: TReq; transfer: Transferable[] };
    try {
      payload = task.build(task.jobId);
    } catch (error) {
      task.reject(toError(error));
      this.pump();
      return;
    }
    slot.task = task;
    this.tasks.set(task.jobId, task);
    const timeout = this.config.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    task.timer = setTimeout(() => {
      this.failSlotTask(slot, new Error(`${this.config.label} job ${task.jobId} timed out after ${timeout}ms`));
    }, timeout);
    try {
      slot.worker?.postMessage(payload.request, payload.transfer);
    } catch (error) {
      this.failSlotTask(slot, toError(error));
    }
  }

  private handleMessage(slot: PoolSlot<TReq, TRes>, data: unknown): void {
    const response = this.config.parse(data);
    if (!response) return;
    const task = this.tasks.get(response.jobId);
    if (!task) return; // unknown jobId: discarded (stale result)
    const failure = response as WorkerErrorMessage;
    if (failure.kind === 'error' && typeof failure.message === 'string') {
      this.failSlotTask(slot, new Error(failure.message));
      return;
    }
    if ((response as unknown as { kind: string }).kind !== this.config.expectedKind) return;
    this.finishTask(slot, task, response as TRes);
  }

  private finishTask(slot: PoolSlot<TReq, TRes>, task: PoolTask<TReq, TRes>, result: TRes): void {
    if (task.timer !== null) clearTimeout(task.timer);
    this.tasks.delete(task.jobId);
    if (slot.task === task) slot.task = null;
    task.resolve(result);
    this.pump();
  }

  private failSlotTask(slot: PoolSlot<TReq, TRes>, error: Error): void {
    const task = slot.task;
    if (!task) return;
    this.failTask(slot, task, error);
  }

  private failTask(slot: PoolSlot<TReq, TRes>, task: PoolTask<TReq, TRes>, error: Error): void {
    if (task.timer !== null) clearTimeout(task.timer);
    this.tasks.delete(task.jobId);
    if (slot.task === task) slot.task = null;
    // A broken worker is replaced; the job gets one retry on a fresh worker.
    this.replaceWorker(slot);
    if (task.attempts < 2 && !this.disposed) {
      this.queue.unshift(task);
      this.pump();
      return;
    }
    task.reject(error);
    this.pump();
  }
}

// ---------------------------------------------------------------------------
// Concrete pools
// ---------------------------------------------------------------------------

export interface GenerationJobSpec {
  readonly cx: number;
  readonly cz: number;
  readonly version: number;
  readonly seedHash: number;
}

export interface MeshJobSpec {
  readonly cx: number;
  readonly cy: number;
  readonly cz: number;
  readonly version: number;
  readonly seedHash: number;
  /** Rebuild the padded payload for each attempt (transferables are detached on send). */
  readonly buildPayload: () => MeshSectionPayload;
}

export class GenerationWorkerPool {
  private readonly pool: WorkerJobPool<GenerateJobMessage, GenerateResultMessage>;

  constructor(size = defaultWorkerCount()) {
    this.pool = new WorkerJobPool<GenerateJobMessage, GenerateResultMessage>({
      size,
      label: 'generation',
      spawn: spawnGenerationWorker,
      parse: (data) => parseGenerateResponse(data),
      expectedKind: 'generate-result',
    });
  }

  get available(): boolean {
    return this.pool.available;
  }

  get busyCount(): number {
    return this.pool.busyCount;
  }

  generate(spec: GenerationJobSpec): Promise<GenerateResultMessage> {
    return this.pool.run((jobId) => ({
      request: {
        kind: 'generate',
        jobId,
        cx: spec.cx,
        cz: spec.cz,
        version: spec.version,
        seedHash: spec.seedHash,
      },
      transfer: [],
    }));
  }

  dispose(): void {
    this.pool.dispose();
  }
}

export class MeshWorkerPool {
  private readonly pool: WorkerJobPool<MeshJobMessage, MeshResultMessage>;

  constructor(layerOf: (tile: string) => number, size = defaultWorkerCount()) {
    const init: InitLayersMessage = { kind: 'init-layers', layers: buildTileLayers(layerOf) };
    this.pool = new WorkerJobPool<MeshJobMessage, MeshResultMessage>({
      size,
      label: 'mesh',
      spawn: spawnMeshWorker,
      parse: (data) => parseMeshResponse(data),
      expectedKind: 'mesh-result',
      onSpawn: (worker) => {
        worker.postMessage(init, []);
      },
    });
  }

  get available(): boolean {
    return this.pool.available;
  }

  get busyCount(): number {
    return this.pool.busyCount;
  }

  mesh(spec: MeshJobSpec): Promise<MeshResultMessage> {
    return this.pool.run((jobId) => {
      const payload = spec.buildPayload();
      return {
        request: {
          kind: 'mesh',
          jobId,
          cx: spec.cx,
          cy: spec.cy,
          cz: spec.cz,
          version: spec.version,
          seedHash: spec.seedHash,
          payload,
        },
        transfer: meshJobTransferables(payload),
      };
    });
  }

  dispose(): void {
    this.pool.dispose();
  }
}

export function createGenerationPool(size?: number): GenerationWorkerPool | null {
  if (!canUseWorkers()) return null;
  try {
    const pool = new GenerationWorkerPool(size);
    if (pool.available) return pool;
    pool.dispose();
    return null;
  } catch {
    return null;
  }
}

export function createMeshPool(layerOf: (tile: string) => number, size?: number): MeshWorkerPool | null {
  if (!canUseWorkers()) return null;
  try {
    const pool = new MeshWorkerPool(layerOf, size);
    if (pool.available) return pool;
    pool.dispose();
    return null;
  } catch {
    return null;
  }
}


