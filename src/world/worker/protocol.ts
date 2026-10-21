/**
 * Worker message protocol + pure bookkeeping helpers.
 *
 * Kept free of DOM/Worker references so it can be unit tested in Node. Both workers
 * and the pool import these types; `parseWorkerResponse` validates untrusted worker
 * output before the main thread uses it.
 */
import type { SectionMeshData } from '../mesher';
import { meshPayloadTransferables, type MeshSectionPayload } from './local';

export type JobKind = 'generate' | 'mesh';

export interface GenerateJobMessage {
  readonly kind: 'generate';
  readonly jobId: number;
  readonly cx: number;
  readonly cz: number;
  /** Generation token: a result with a different token is stale. */
  readonly version: number;
  readonly seedHash: number;
}

export interface MeshJobMessage {
  readonly kind: 'mesh';
  readonly jobId: number;
  readonly cx: number;
  readonly cy: number;
  readonly cz: number;
  /** Column version at dispatch time: results for an edited column are discarded. */
  readonly version: number;
  readonly seedHash: number;
  readonly payload: MeshSectionPayload;
}

/** Sent once per worker so it can reproduce atlas layer numbers. */
export interface InitLayersMessage {
  readonly kind: 'init-layers';
  readonly layers: ReadonlyArray<readonly [string, number]>;
}

export type WorkerRequest = GenerateJobMessage | MeshJobMessage | InitLayersMessage;

export interface GenerateResultMessage {
  readonly kind: 'generate-result';
  readonly jobId: number;
  readonly cx: number;
  readonly cz: number;
  readonly version: number;
  readonly blocks: Uint8Array;
  readonly meta: Uint8Array;
  readonly heightMap: Uint8Array;
}

export interface MeshResultMessage {
  readonly kind: 'mesh-result';
  readonly jobId: number;
  readonly cx: number;
  readonly cy: number;
  readonly cz: number;
  readonly version: number;
  readonly data: SectionMeshData;
}

export interface WorkerErrorMessage {
  readonly kind: 'error';
  readonly jobId: number;
  readonly message: string;
}

export type GenerateResponse = GenerateResultMessage | WorkerErrorMessage;
export type MeshResponse = MeshResultMessage | WorkerErrorMessage;

export function generationResultTransferables(result: GenerateResultMessage): Transferable[] {
  return [result.blocks.buffer, result.meta.buffer, result.heightMap.buffer];
}

export function meshResultTransferables(data: SectionMeshData): Transferable[] {
  const buffers: Transferable[] = [];
  for (const layer of [data.opaque, data.cutout, data.transparent]) {
    if (!layer) continue;
    buffers.push(
      layer.positions.buffer,
      layer.uvs.buffer,
      layer.layers.buffer,
      layer.lights.buffer,
      layer.shades.buffer,
      layer.tints.buffer,
      layer.indices.buffer,
    );
  }
  return buffers;
}

export function meshJobTransferables(payload: MeshSectionPayload): Transferable[] {
  return meshPayloadTransferables(payload);
}

// ---------------------------------------------------------------------------
// Validation (worker output is untrusted data)
// ---------------------------------------------------------------------------

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function isTypedArray(value: unknown, ctor: typeof Uint8Array): boolean {
  return value instanceof ctor;
}

function hasNumber(record: Record<string, unknown>, key: string): boolean {
  return typeof record[key] === 'number' && Number.isFinite(record[key] as number);
}

export function isGenerateJob(data: unknown): data is GenerateJobMessage {
  if (!isRecord(data) || data.kind !== 'generate') return false;
  return hasNumber(data, 'jobId') && hasNumber(data, 'cx') && hasNumber(data, 'cz') && hasNumber(data, 'version') && hasNumber(data, 'seedHash');
}

export function isMeshJob(data: unknown): data is MeshJobMessage {
  if (!isRecord(data) || data.kind !== 'mesh') return false;
  if (!hasNumber(data, 'jobId') || !hasNumber(data, 'cx') || !hasNumber(data, 'cy') || !hasNumber(data, 'cz')) return false;
  if (!hasNumber(data, 'version') || !hasNumber(data, 'seedHash')) return false;
  const payload = data.payload;
  return (
    isRecord(payload) &&
    isTypedArray(payload.blocks, Uint8Array) &&
    isTypedArray(payload.meta, Uint8Array) &&
    isTypedArray(payload.sky, Uint8Array) &&
    isTypedArray(payload.blockLight, Uint8Array)
  );
}

export function isInitLayers(data: unknown): data is InitLayersMessage {
  return isRecord(data) && data.kind === 'init-layers' && Array.isArray(data.layers);
}

export function parseGenerateResponse(data: unknown): GenerateResponse | null {
  if (!isRecord(data) || !hasNumber(data, 'jobId')) return null;
  if (data.kind === 'error' && typeof data.message === 'string') {
    return { kind: 'error', jobId: data.jobId as number, message: data.message };
  }
  if (data.kind !== 'generate-result') return null;
  if (!hasNumber(data, 'cx') || !hasNumber(data, 'cz') || !hasNumber(data, 'version')) return null;
  if (!isTypedArray(data.blocks, Uint8Array) || !isTypedArray(data.meta, Uint8Array) || !isTypedArray(data.heightMap, Uint8Array)) {
    return null;
  }
  return {
    kind: 'generate-result',
    jobId: data.jobId as number,
    cx: data.cx as number,
    cz: data.cz as number,
    version: data.version as number,
    blocks: data.blocks as Uint8Array,
    meta: data.meta as Uint8Array,
    heightMap: data.heightMap as Uint8Array,
  };
}

export function parseMeshResponse(data: unknown): MeshResponse | null {
  if (!isRecord(data) || !hasNumber(data, 'jobId')) return null;
  if (data.kind === 'error' && typeof data.message === 'string') {
    return { kind: 'error', jobId: data.jobId as number, message: data.message };
  }
  if (data.kind !== 'mesh-result') return null;
  if (!hasNumber(data, 'cx') || !hasNumber(data, 'cy') || !hasNumber(data, 'cz') || !hasNumber(data, 'version')) return null;
  if (!isRecord(data.data)) return null;
  return {
    kind: 'mesh-result',
    jobId: data.jobId as number,
    cx: data.cx as number,
    cy: data.cy as number,
    cz: data.cz as number,
    version: data.version as number,
    data: data.data as unknown as SectionMeshData,
  };
}

// ---------------------------------------------------------------------------
// Staleness / job id helpers (pure, unit tested)
// ---------------------------------------------------------------------------

export function createJobIds(start = 1): () => number {
  let next = start;
  return () => next++;
}

export function jobKey(kind: JobKind, cx: number, cz: number, cy = 0): string {
  return `${kind}:${cx},${cy},${cz}`;
}

/** A result is stale when the world moved on (column version changed). */
export function isStaleVersion(resultVersion: number, currentVersion: number): boolean {
  return resultVersion !== currentVersion;
}

/**
 * Tracks the newest in-flight job per world position so older results can be
 * dropped. Also used to ignore results for columns that were unloaded meanwhile.
 */
export class JobVersionGate {
  private nextId: number;
  private readonly latest = new Map<string, { jobId: number; version: number }>();

  constructor(startId = 1) {
    this.nextId = startId;
  }

  begin(kind: JobKind, cx: number, cz: number, version: number, cy = 0): number {
    const jobId = this.nextId++;
    this.latest.set(jobKey(kind, cx, cz, cy), { jobId, version });
    return jobId;
  }

  /** Remove bookkeeping once a job settles (success or failure). */
  settle(jobId: number): void {
    for (const [key, entry] of this.latest) {
      if (entry.jobId === jobId) {
        this.latest.delete(key);
        return;
      }
    }
  }

  /**
   * True when the response must be discarded: unknown job, superseded job, or the
   * version no longer matches the current column version.
   */
  isStale(kind: JobKind, cx: number, cz: number, cy: number, jobId: number, version: number, currentVersion: number): boolean {
    const entry = this.latest.get(jobKey(kind, cx, cz, cy));
    if (!entry) return true;
    if (entry.jobId !== jobId) return true;
    return isStaleVersion(version, currentVersion);
  }

  /** Version recorded for a position (for tests/diagnostics). */
  versionOf(kind: JobKind, cx: number, cz: number, cy = 0): number | undefined {
    return this.latest.get(jobKey(kind, cx, cz, cy))?.version;
  }
}
