/** Cross-cutting value types shared by every subsystem. */

export type GameMode = 'survival' | 'creative';
export type Difficulty = 'peaceful' | 'easy' | 'normal' | 'hard';

export interface Vec3 {
  x: number;
  y: number;
  z: number;
}

export interface Vec2 {
  x: number;
  y: number;
}

export type BlockId = number;

/** A single inventory stack. `item` is a registry string id (`null` = empty). */
export interface Slot {
  item: string | null;
  count: number;
  /** Remaining tool/armor durability (only for damageable items). */
  durability?: number;
  /** Arbitrary per-stack tag, e.g. fuel value overrides. */
  tag?: Record<string, number>;
}

export const EMPTY_SLOT: Slot = { item: null, count: 0 };

export interface BlockHit {
  /** Hit block world coordinates. */
  x: number;
  y: number;
  z: number;
  /** Face normal that was hit (one component is ±1). */
  nx: number;
  ny: number;
  nz: number;
  distance: number;
  id: BlockId;
  meta: number;
}

export interface WorldTime {
  ticks: number;
  /** 0 = sunrise, 6000 = noon, 12000 = sunset, 18000 = midnight. */
  timeOfDay: number;
  day: number;
  /** 0..1 daylight factor used by the renderer. */
  daylight: number;
}

export interface Metrics {
  fps: number;
  frameMs: number;
  drawCalls: number;
  triangles: number;
  columns: number;
  meshes: number;
  entities: number;
  heapMB: number;
}

export interface ChunkCoord {
  cx: number;
  cz: number;
}

export function makeSlot(item: string | null, count = 1, durability?: number): Slot {
  return durability === undefined ? { item, count } : { item, count, durability };
}
