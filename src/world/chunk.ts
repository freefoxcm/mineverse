import { WORLD_HEIGHT } from '../core/config';

export interface BlockEntity {
  type: 'chest' | 'furnace';
  data: unknown;
}

export function chunkKey(cx: number, cz: number): string {
  return `${cx},${cz}`;
}

/** Section index for a world Y. */
export function sectionOfY(y: number): number {
  return Math.floor(y / 16);
}

/** Column-local block index: y*256 + z*16 + x. */
export function localIndex(x: number, y: number, z: number): number {
  return (y << 8) | (z << 4) | x;
}

/**
 * A 16 x 16 x WORLD_HEIGHT voxel column plus its light data, height map and
 * the delta against generated terrain (for saving).
 */
export class ChunkColumn {
  readonly blocks: Uint8Array;
  readonly meta: Uint8Array;
  readonly sky: Uint8Array;
  readonly blockLight: Uint8Array;
  readonly heightMap: Uint8Array;
  /** Per-section dirty flags: bit 0 = needs remesh. */
  readonly dirtySections: Uint8Array;
  /** Player/world edits relative to generation; local index -> block state. */
  readonly edits = new Map<number, { id: number; meta: number }>();
  readonly blockEntities = new Map<number, BlockEntity>();
  /** Generation revision; incremented on edits so stale worker results are dropped. */
  version = 0;
  meshed = false;

  constructor(
    readonly cx: number,
    readonly cz: number,
  ) {
    const volume = 16 * 16 * WORLD_HEIGHT;
    this.blocks = new Uint8Array(volume);
    this.meta = new Uint8Array(volume);
    this.sky = new Uint8Array(volume);
    this.blockLight = new Uint8Array(volume);
    this.heightMap = new Uint8Array(256);
    this.dirtySections = new Uint8Array(WORLD_HEIGHT / 16);
  }

  getBlock(x: number, y: number, z: number): number {
    return this.blocks[localIndex(x, y, z)];
  }

  getMeta(x: number, y: number, z: number): number {
    return this.meta[localIndex(x, y, z)];
  }

  setBlockLocal(x: number, y: number, z: number, id: number, meta = 0): void {
    const index = localIndex(x, y, z);
    this.blocks[index] = id;
    this.meta[index] = meta;
    this.edits.set(index, { id, meta });
    this.version++;
  }

  setGenerated(x: number, y: number, z: number, id: number, meta = 0): void {
    const index = localIndex(x, y, z);
    this.blocks[index] = id;
    this.meta[index] = meta;
  }

  getSky(x: number, y: number, z: number): number {
    return this.sky[localIndex(x, y, z)];
  }

  getBlockLight(x: number, y: number, z: number): number {
    return this.blockLight[localIndex(x, y, z)];
  }

  markSectionDirty(y: number): void {
    const section = sectionOfY(y);
    if (section >= 0 && section < this.dirtySections.length) {
      this.dirtySections[section] = 1;
    }
  }

  clearDirty(): void {
    this.dirtySections.fill(0);
  }
}
