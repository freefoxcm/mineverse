import { WORLD_HEIGHT } from '../core/config';
import type { WorldView } from '../core/contracts';
import { hash2f, hash2i, hashString, Rand } from '../core/rng';
import type { WorldTime } from '../core/types';
import { BLOCK, blockNumeric, getBlockDef, LIGHT_OPACITY } from './blocks';
import { ChunkColumn, chunkKey, localIndex } from './chunk';

export interface BlockChangeEvent {
  x: number;
  y: number;
  z: number;
  previous: number;
  current: number;
  meta: number;
}

/**
 * Pluggable terrain generator. M1's multi-noise generator (with workers) implements
 * this; the M0 placeholder below keeps the engine runnable in the meantime.
 */
export interface ColumnGenerator {
  generate(column: ChunkColumn, seedHash: number): void;
}

/**
 * World container: owns loaded chunk columns, block access, time and edit deltas.
 * Chunk streaming/lighting are driven by the ChunkManager (World-A) which plugs in a
 * ColumnGenerator and an incremental light updater.
 */
export class World implements WorldView {
  readonly columns = new Map<string, ChunkColumn>();
  readonly seed: string;
  readonly seedHash: number;
  private tickCount = 0;
  generator: ColumnGenerator | null = null;
  /** Replaces the placeholder whole-column light recompute once lighting.ts lands. */
  lightUpdater: ((column: ChunkColumn, x: number, y: number, z: number) => void) | null = null;

  onBlockChanged?: (event: BlockChangeEvent) => void;
  onColumnGenerated?: (column: ChunkColumn) => void;

  constructor(seed: string) {
    this.seed = seed;
    this.seedHash = hashString(seed);
  }

  get loadedColumnCount(): number {
    return this.columns.size;
  }

  column(cx: number, cz: number): ChunkColumn | undefined {
    return this.columns.get(chunkKey(cx, cz));
  }

  ensureColumn(cx: number, cz: number): ChunkColumn {
    const key = chunkKey(cx, cz);
    const existing = this.columns.get(key);
    if (existing) return existing;
    const column = new ChunkColumn(cx, cz);
    if (this.generator) this.generator.generate(column, this.seedHash);
    else this.generateColumn(column);
    this.computeColumnLight(column);
    this.columns.set(key, column);
    this.onColumnGenerated?.(column);
    return column;
  }

  /** Registers a fully generated column (worker output). Edits are applied by the caller. */
  insertColumn(column: ChunkColumn): void {
    this.columns.set(chunkKey(column.cx, column.cz), column);
    this.onColumnGenerated?.(column);
  }

  /** Removes a column from the loaded set (its edits are expected to be queued already). */
  removeColumn(cx: number, cz: number): ChunkColumn | undefined {
    const key = chunkKey(cx, cz);
    const column = this.columns.get(key);
    if (column) this.columns.delete(key);
    return column;
  }

  // -------------------------------------------------------------------------
  // Placeholder terrain: rolling hills, ponds, trees and grass. Deterministic.
  // -------------------------------------------------------------------------
  private generateColumn(column: ChunkColumn): void {
    const baseX = column.cx * 16;
    const baseZ = column.cz * 16;
    for (let z = 0; z < 16; z++) {
      for (let x = 0; x < 16; x++) {
        const wx = baseX + x;
        const wz = baseZ + z;
        const height = this.surfaceHeight(wx, wz);
        for (let y = 0; y <= height; y++) {
          let block = BLOCK.stone;
          if (y <= 1) block = BLOCK.bedrock;
          else if (y === height) block = BLOCK.grass_block;
          else if (y >= height - 3) block = BLOCK.dirt;
          column.setGenerated(x, y, z, block);
        }
        for (let y = height + 1; y <= 62; y++) {
          column.setGenerated(x, y, z, BLOCK.water);
        }
        column.heightMap[z * 16 + x] = height;
      }
    }

    // Simple trees. Trunks are kept away from the column border so the canopy
    // stays inside this column (the real feature generator handles cross-chunk trees).
    const rng = new Rand(hash2i(this.seedHash, column.cx, column.cz) ^ 0x51ed270b);
    const treeCount = 2 + rng.int(4);
    for (let i = 0; i < treeCount; i++) {
      const lx = 2 + rng.int(12);
      const lz = 2 + rng.int(12);
      const wx = baseX + lx;
      const wz = baseZ + lz;
      const ground = this.surfaceHeight(wx, wz);
      if (ground <= 62 || ground > 70) continue;
      const existing = column.getBlock(lx, ground, lz);
      if (existing !== BLOCK.grass_block) continue;
      const trunk = 4 + rng.int(3);
      for (let dy = 1; dy <= trunk; dy++) {
        column.setGenerated(lx, ground + dy, lz, BLOCK.oak_log);
      }
      const top = ground + trunk;
      for (let dy = -2; dy <= 1; dy++) {
        const radius = dy <= 0 ? 2 : 1;
        for (let dx = -radius; dx <= radius; dx++) {
          for (let dz = -radius; dz <= radius; dz++) {
            if (Math.abs(dx) + Math.abs(dz) > radius + 1) continue;
            const px = lx + dx;
            const pz = lz + dz;
            if (px < 0 || pz < 0 || px > 15 || pz > 15) continue;
            if (dx === 0 && dz === 0 && dy <= 0) continue;
            const py = top + dy;
            if (column.getBlock(px, py, pz) === 0) {
              column.setGenerated(px, py, pz, BLOCK.oak_leaves);
            }
          }
        }
      }
    }

    // Ground cover.
    for (let z = 0; z < 16; z++) {
      for (let x = 0; x < 16; x++) {
        const h = column.heightMap[z * 16 + x];
        if (column.getBlock(x, h, z) !== BLOCK.grass_block) continue;
        if (column.getBlock(x, h + 1, z) !== 0) continue;
        const r = hash2f(this.seedHash ^ 0x2f6a3c11, baseX + x, baseZ + z);
        if (r < 0.03) column.setGenerated(x, h + 1, z, BLOCK.tall_grass);
        else if (r < 0.034) {
          column.setGenerated(x, h + 1, z, blockNumeric(this.seedHash % 2 === 0 ? 'poppy' : 'dandelion'));
        }
      }
    }
  }

  /** Rolling hill surface used by the M0 placeholder generator. */
  surfaceHeight(wx: number, wz: number): number {
    const h =
      65 +
      2.6 * Math.sin(wx / 13.7) +
      2.2 * Math.cos(wz / 11.3) +
      1.4 * Math.sin((wx + wz) / 7.9) +
      1.1 * Math.cos((wx - wz) / 9.1);
    return Math.max(4, Math.min(90, Math.round(h)));
  }

  /** Very simple vertical sky light for M0 (full BFS lighting arrives in M1). */
  computeColumnLight(column: ChunkColumn): void {
    for (let z = 0; z < 16; z++) {
      for (let x = 0; x < 16; x++) {
        let light = 15;
        for (let y = WORLD_HEIGHT - 1; y >= 0; y--) {
          const index = localIndex(x, y, z);
          const opacity = LIGHT_OPACITY[column.blocks[index]];
          if (opacity >= 15) {
            light = 0;
          } else if (opacity > 0) {
            light = Math.max(0, light - opacity * 2);
          }
          column.sky[index] = light;
          column.blockLight[index] = 0;
        }
      }
    }
  }

  // -------------------------------------------------------------------------
  // WorldView / accessors
  // -------------------------------------------------------------------------
  getBlock(x: number, y: number, z: number): number {
    if (y < 0) return BLOCK.bedrock;
    if (y >= WORLD_HEIGHT) return 0;
    const cx = Math.floor(x / 16);
    const cz = Math.floor(z / 16);
    const column = this.columns.get(chunkKey(cx, cz));
    if (!column) return 0;
    const lx = x - cx * 16;
    const lz = z - cz * 16;
    return column.blocks[localIndex(lx, y, lz)];
  }

  getMeta(x: number, y: number, z: number): number {
    if (y < 0 || y >= WORLD_HEIGHT) return 0;
    const cx = Math.floor(x / 16);
    const cz = Math.floor(z / 16);
    const column = this.columns.get(chunkKey(cx, cz));
    if (!column) return 0;
    return column.meta[localIndex(x - cx * 16, y, z - cz * 16)];
  }

  getSkyLight(x: number, y: number, z: number): number {
    if (y < 0) return 0;
    if (y >= WORLD_HEIGHT) return 15;
    const cx = Math.floor(x / 16);
    const cz = Math.floor(z / 16);
    const column = this.columns.get(chunkKey(cx, cz));
    if (!column) return 15;
    return column.sky[localIndex(x - cx * 16, y, z - cz * 16)];
  }

  getBlockLight(x: number, y: number, z: number): number {
    if (y < 0 || y >= WORLD_HEIGHT) return 0;
    const cx = Math.floor(x / 16);
    const cz = Math.floor(z / 16);
    const column = this.columns.get(chunkKey(cx, cz));
    if (!column) return 0;
    return column.blockLight[localIndex(x - cx * 16, y, z - cz * 16)];
  }

  setBlock(x: number, y: number, z: number, id: number, meta = 0): boolean {
    if (y < 0 || y >= WORLD_HEIGHT) return false;
    const cx = Math.floor(x / 16);
    const cz = Math.floor(z / 16);
    const column = this.columns.get(chunkKey(cx, cz));
    if (!column) return false;
    const lx = x - cx * 16;
    const lz = z - cz * 16;
    const index = localIndex(lx, y, lz);
    const previous = column.blocks[index];
    if (previous === id && column.meta[index] === meta) return false;
    column.blocks[index] = id;
    column.meta[index] = meta;
    column.edits.set(index, { id, meta });
    column.version++;
    // Placeholder lighting: the ChunkManager installs an incremental light updater.
    if (this.lightUpdater) this.lightUpdater(column, x, y, z);
    else this.computeColumnLight(column);
    for (let dy = -1; dy <= 1; dy++) column.markSectionDirty(y + dy);
    if (lx === 0) this.column(cx - 1, cz)?.markSectionDirty(y);
    if (lx === 15) this.column(cx + 1, cz)?.markSectionDirty(y);
    if (lz === 0) this.column(cx, cz - 1)?.markSectionDirty(y);
    if (lz === 15) this.column(cx, cz + 1)?.markSectionDirty(y);
    this.onBlockChanged?.({ x, y, z, previous, current: id, meta });
    return true;
  }

  isChunkLoaded(cx: number, cz: number): boolean {
    return this.columns.has(chunkKey(cx, cz));
  }

  /** Highest terrain surface + 1 at the given column, minimum 1. */
  spawnY(x: number, z: number): number {
    const cx = Math.floor(x / 16);
    const cz = Math.floor(z / 16);
    const column = this.columns.get(chunkKey(cx, cz));
    if (!column) return 80;
    const lx = x - cx * 16;
    const lz = z - cz * 16;
    return column.heightMap[lz * 16 + lx] + 1;
  }

  time(): WorldTime {
    const ticks = this.tickCount;
    const timeOfDay = ((ticks % 24000) + 24000) % 24000;
    const day = Math.floor(ticks / 24000);
    const angle = (timeOfDay / 24000) * Math.PI * 2;
    const sunY = Math.sin(angle);
    const daylight = Math.max(0.08, Math.min(1, (sunY + 0.15) / 0.5));
    return { ticks, timeOfDay, day, daylight };
  }

  tick(): void {
    this.tickCount++;
  }

  get ticks(): number {
    return this.tickCount;
  }

  setTicks(ticks: number): void {
    this.tickCount = Math.max(0, Math.floor(ticks));
  }

  forEachColumn(fn: (column: ChunkColumn) => void): void {
    for (const column of this.columns.values()) fn(column);
  }

  /** Debug helper: total non-air blocks in loaded columns. */
  countSolidBlocks(): number {
    let total = 0;
    for (const column of this.columns.values()) {
      for (let i = 0; i < column.blocks.length; i++) {
        if (column.blocks[i] !== 0) total++;
      }
    }
    return total;
  }
}
