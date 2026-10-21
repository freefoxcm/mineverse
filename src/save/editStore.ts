import { WORLD_HEIGHT } from '../core/config';
import { blockName, blockNumeric, BLOCK_COUNT } from '../world/blocks';
import { ChunkColumn, localIndex } from '../world/chunk';
import type { SavedBlockEntity, SavedChunkEdits } from './types';

interface EditState {
  id: number;
  meta: number;
}

/**
 * Authoritative store of player/world edits, persisted independently of the
 * generated terrain. ChunkManager applies it to freshly generated columns and
 * records changes made by gameplay/simulation.
 */
export class EditStore {
  private readonly chunks = new Map<string, Map<number, EditState>>();
  private readonly entities = new Map<string, SavedBlockEntity>();
  private palette: string[] = ['air'];
  private readonly paletteIndex = new Map<string, number>([['air', 0]]);

  static chunkKey(cx: number, cz: number): string {
    return `${cx},${cz}`;
  }

  private paletteId(blockId: number): number {
    const name = blockName(blockId);
    const existing = this.paletteIndex.get(name);
    if (existing !== undefined) return existing;
    const index = this.palette.length;
    this.palette.push(name);
    this.paletteIndex.set(name, index);
    return index;
  }

  private rebuildPalette(palette: string[]): void {
    this.palette = [...palette];
    this.paletteIndex.clear();
    palette.forEach((name, index) => this.paletteIndex.set(name, index));
    if (!this.paletteIndex.has('air')) {
      this.paletteIndex.set('air', 0);
      if (this.palette[0] !== 'air') this.palette.unshift('air');
    }
  }

  record(worldX: number, worldY: number, worldZ: number, id: number, meta = 0): void {
    if (worldY < 0 || worldY >= WORLD_HEIGHT) return;
    const cx = Math.floor(worldX / 16);
    const cz = Math.floor(worldZ / 16);
    const lx = worldX - cx * 16;
    const lz = worldZ - cz * 16;
    this.recordLocal(cx, cz, localIndex(lx, worldY, lz), id, meta);
  }

  recordLocal(cx: number, cz: number, index: number, id: number, meta = 0): void {
    const key = EditStore.chunkKey(cx, cz);
    let chunk = this.chunks.get(key);
    if (!chunk) {
      chunk = new Map<number, EditState>();
      this.chunks.set(key, chunk);
    }
    chunk.set(index, { id, meta });
    this.paletteId(id);
  }

  setBlockEntity(x: number, y: number, z: number, type: SavedBlockEntity['type'], data: unknown): void {
    this.entities.set(`${x},${y},${z}`, { x, y, z, type, data });
  }

  removeBlockEntity(x: number, y: number, z: number): void {
    this.entities.delete(`${x},${y},${z}`);
  }

  getBlockEntity(x: number, y: number, z: number): SavedBlockEntity | undefined {
    return this.entities.get(`${x},${y},${z}`);
  }

  /** Applies every stored edit/block entity to a freshly generated column. */
  apply(column: ChunkColumn): void {
    const key = EditStore.chunkKey(column.cx, column.cz);
    const edits = this.chunks.get(key);
    if (edits) {
      for (const [index, state] of edits) {
        column.blocks[index] = state.id;
        column.meta[index] = state.meta;
      }
    }
    for (const entity of this.entities.values()) {
      if (entity.x >> 4 !== column.cx || entity.z >> 4 !== column.cz) continue;
      const lx = entity.x - column.cx * 16;
      const lz = entity.z - column.cz * 16;
      if (entity.y < 0 || entity.y >= WORLD_HEIGHT) continue;
      column.blockEntities.set(localIndex(lx, entity.y, lz), { type: entity.type, data: entity.data });
    }
  }

  hasChunkEdits(cx: number, cz: number): boolean {
    return (this.chunks.get(EditStore.chunkKey(cx, cz))?.size ?? 0) > 0;
  }

  get editCount(): number {
    let total = 0;
    for (const chunk of this.chunks.values()) total += chunk.size;
    return total;
  }

  /** Export all edits, referencing the shared palette. */
  collect(): { edits: SavedChunkEdits[]; blockEntities: SavedBlockEntity[]; palette: string[] } {
    const edits: SavedChunkEdits[] = [];
    for (const [key, chunk] of this.chunks) {
      if (chunk.size === 0) continue;
      const [cx, cz] = key.split(',').map(Number);
      const indices: number[] = [];
      const blocks: number[] = [];
      const metas: number[] = [];
      for (const [index, state] of chunk) {
        indices.push(index);
        blocks.push(this.paletteId(state.id));
        metas.push(state.meta);
      }
      edits.push({ cx, cz, indices, blocks, metas });
    }
    return {
      edits,
      blockEntities: [...this.entities.values()].map((entity) => ({ ...entity })),
      palette: [...this.palette],
    };
  }

  /** Import persisted edits (called when a world save is loaded). */
  load(edits: SavedChunkEdits[], palette: string[], blockEntities: SavedBlockEntity[]): void {
    this.chunks.clear();
    this.entities.clear();
    this.rebuildPalette(palette.length > 0 ? palette : ['air']);
    for (const chunk of edits) {
      const map = new Map<number, EditState>();
      for (let i = 0; i < chunk.indices.length; i++) {
        const name = this.palette[chunk.blocks[i]] ?? 'air';
        const id = blockNumeric(name);
        if (id < 0 || id >= BLOCK_COUNT) continue;
        map.set(chunk.indices[i], { id, meta: chunk.metas[i] ?? 0 });
      }
      this.chunks.set(EditStore.chunkKey(chunk.cx, chunk.cz), map);
    }
    for (const entity of blockEntities) {
      this.entities.set(`${entity.x},${entity.y},${entity.z}`, { ...entity });
    }
  }

  /** Clears all edits (used after a world is deleted/reset). */
  clear(): void {
    this.chunks.clear();
    this.entities.clear();
    this.palette = ['air'];
    this.paletteIndex.clear();
    this.paletteIndex.set('air', 0);
  }
}
