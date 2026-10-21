/**
 * Block/sky lighting (PLAN.md §3.3).
 *
 * - Sky light: 0..15, computed top-down per column (direct sunlight at 15 does not
 *   decay going straight down), then spread with a BFS that decays by 1 per block.
 * - Block light: emitters (torch 14 / lit furnace 13 / lava 15) seeded into a BFS.
 * - Both spread across chunk borders into already loaded columns; a column that is
 *   not loaded simply absorbs light (its contribution is re-seeded when it loads).
 * - Block edits run an incremental remove + re-seed pass so removing a light source
 *   or covering a hole produces correct darkness.
 *
 * The engine never touches `World` directly; it talks to a `LightWorld` facade so it
 * can be unit tested with plain `ChunkColumn` maps and used by `ChunkManager`.
 */
import { WORLD_HEIGHT } from '../core/config';
import { LIGHT_EMISSION, LIGHT_OPACITY } from './blocks';
import { localIndex, type ChunkColumn } from './chunk';

export const MAX_LIGHT = 15;
const SECTION_COUNT = WORLD_HEIGHT / 16;

export interface LightWorld {
  getColumn(cx: number, cz: number): ChunkColumn | undefined;
  /** Mark the mesh section owning (wx, wy, wz) dirty (plus edge-adjacent sections). */
  markDirty?(wx: number, wy: number, wz: number): void;
}

type FlatQueue = number[];

const DIRS: ReadonlyArray<readonly [number, number, number]> = [
  [1, 0, 0],
  [-1, 0, 0],
  [0, 1, 0],
  [0, -1, 0],
  [0, 0, 1],
  [0, 0, -1],
];

function inWorldY(y: number): boolean {
  return y >= 0 && y < WORLD_HEIGHT;
}

/** Downward sunlight keeps level 15 when it travels through fully transparent air. */
function skyDecay(dy: number, level: number, opacity: number): number {
  if (dy === -1 && level === MAX_LIGHT && opacity === 0) return 0;
  return Math.max(1, opacity);
}

export class LightEngine {
  constructor(private readonly world: LightWorld) {}

  // ------------------------------------------------------------------ reading

  getSkyLight(x: number, y: number, z: number): number {
    if (y < 0) return 0;
    if (y >= WORLD_HEIGHT) return MAX_LIGHT;
    const column = this.world.getColumn(Math.floor(x / 16), Math.floor(z / 16));
    if (!column) return 0;
    return column.sky[localIndex(x - column.cx * 16, y, z - column.cz * 16)];
  }

  getBlockLight(x: number, y: number, z: number): number {
    if (!inWorldY(y)) return 0;
    const column = this.world.getColumn(Math.floor(x / 16), Math.floor(z / 16));
    if (!column) return 0;
    return column.blockLight[localIndex(x - column.cx * 16, y, z - column.cz * 16)];
  }

  // ------------------------------------------------------------- full columns

  /** Recompute one column's light from scratch (neighbours ignored). */
  lightColumn(column: ChunkColumn): void {
    const blocks = column.blocks;
    const sky = column.sky;
    const blockLight = column.blockLight;
    const baseX = column.cx * 16;
    const baseZ = column.cz * 16;
    sky.fill(0);
    blockLight.fill(0);

    // Direct sunlight: top-down, no decay at full strength through transparent air.
    for (let z = 0; z < 16; z++) {
      for (let x = 0; x < 16; x++) {
        let level = MAX_LIGHT;
        for (let y = WORLD_HEIGHT - 1; y >= 0; y--) {
          const index = localIndex(x, y, z);
          const opacity = LIGHT_OPACITY[blocks[index]];
          if (opacity >= MAX_LIGHT) {
            level = 0;
          } else if (opacity > 0) {
            level = Math.max(0, level - Math.max(1, opacity));
          }
          sky[index] = level;
        }
      }
    }

    // Seed the BFS where the direct pass left a brightness cliff (surface shadow,
    // cave mouths, overhangs, tree canopies...).
    const skySeeds: FlatQueue = [];
    for (let y = WORLD_HEIGHT - 1; y >= 0; y--) {
      for (let z = 0; z < 16; z++) {
        for (let x = 0; x < 16; x++) {
          const index = localIndex(x, y, z);
          const level = sky[index];
          if (level === 0) continue;
          if (this.lowerNeighbourLocal(sky, x, y, z, level)) {
            skySeeds.push(baseX + x, y, baseZ + z, level);
          }
        }
      }
    }
    this.propagateLocal(column, skySeeds, true);

    const blockSeeds: FlatQueue = [];
    for (let index = 0; index < blocks.length; index++) {
      const emission = LIGHT_EMISSION[blocks[index]];
      if (emission <= 0) continue;
      blockLight[index] = emission;
      const x = index & 15;
      const z = (index >> 4) & 15;
      const y = index >> 8;
      blockSeeds.push(baseX + x, y, baseZ + z, emission);
    }
    this.propagateLocal(column, blockSeeds, false);
  }

  /**
   * Light a freshly loaded column and exchange light with already loaded neighbours
   * across the four borders. Only border cells need comparing: any light that
   * crosses into another column must pass through a border.
   */
  lightColumnWithNeighbors(column: ChunkColumn): void {
    this.lightColumn(column);
    this.exchangeBorders(column);
  }

  /** Full relight (e.g. after an unloaded neighbour invalidated the border). */
  relightColumn(column: ChunkColumn): void {
    this.lightColumnWithNeighbors(column);
  }

  private exchangeBorders(column: ChunkColumn): void {
    const sides: ReadonlyArray<readonly [number, number, number, number]> = [
      // dx, dz, own local coordinate is at the border, neighbour coordinate is opposite
      [1, 0, 15, 0],
      [-1, 0, 0, 15],
      [0, 1, 15, 0],
      [0, -1, 0, 15],
    ];
    for (const [dx, dz, ownBorder, neighbourBorder] of sides) {
      const neighbour = this.world.getColumn(column.cx + dx, column.cz + dz);
      if (!neighbour) continue;
      const widthBorder = dx === 0;
      for (let along = 0; along < 16; along++) {
        const ownLocalX = widthBorder ? along : ownBorder;
        const ownLocalZ = widthBorder ? ownBorder : along;
        const nbLocalX = widthBorder ? along : neighbourBorder;
        const nbLocalZ = widthBorder ? neighbourBorder : along;
        for (let y = 0; y < WORLD_HEIGHT; y++) {
          const ownIndex = localIndex(ownLocalX, y, ownLocalZ);
          const nbIndex = localIndex(nbLocalX, y, nbLocalZ);
          const ownWorldX = column.cx * 16 + ownLocalX;
          const ownWorldZ = column.cz * 16 + ownLocalZ;
          const nbWorldX = neighbour.cx * 16 + nbLocalX;
          const nbWorldZ = neighbour.cz * 16 + nbLocalZ;

          // Sky.
          this.crossBorder(
            column.sky,
            ownIndex,
            LIGHT_OPACITY[column.blocks[ownIndex]],
            neighbour.sky,
            nbIndex,
            LIGHT_OPACITY[neighbour.blocks[nbIndex]],
            ownWorldX,
            y,
            ownWorldZ,
            nbWorldX,
            nbWorldZ,
            true,
          );
          // Block light.
          this.crossBorder(
            column.blockLight,
            ownIndex,
            LIGHT_OPACITY[column.blocks[ownIndex]],
            neighbour.blockLight,
            nbIndex,
            LIGHT_OPACITY[neighbour.blocks[nbIndex]],
            ownWorldX,
            y,
            ownWorldZ,
            nbWorldX,
            nbWorldZ,
            false,
          );
        }
      }
    }
  }

  private crossBorder(
    ownLight: Uint8Array,
    ownIndex: number,
    ownOpacity: number,
    nbLight: Uint8Array,
    nbIndex: number,
    nbOpacity: number,
    ownWorldX: number,
    y: number,
    ownWorldZ: number,
    nbWorldX: number,
    nbWorldZ: number,
    isSky: boolean,
  ): void {
    const ownLevel = ownLight[ownIndex];
    const nbLevel = nbLight[nbIndex];
    if (nbLevel > 0) {
      const required = nbLevel - Math.max(1, ownOpacity);
      if (required > ownLevel) {
        ownLight[ownIndex] = required;
        this.world.markDirty?.(ownWorldX, y, ownWorldZ);
        this.propagateWorld([ownWorldX, y, ownWorldZ, required], isSky);
      }
    }
    if (ownLevel > 0) {
      const required = ownLevel - Math.max(1, nbOpacity);
      if (required > nbLevel) {
        nbLight[nbIndex] = required;
        this.world.markDirty?.(nbWorldX, y, nbWorldZ);
        this.propagateWorld([nbWorldX, y, nbWorldZ, required], isSky);
      }
    }
  }

  // --------------------------------------------------------------- incremental

  /**
   * Incremental relight after `World.setBlock`. `previousId`/`currentId` are the
   * numeric block ids before/after the change.
   */
  onBlockChanged(wx: number, wy: number, wz: number, previousId: number, currentId: number): void {
    void previousId;
    if (!inWorldY(wy)) return;
    const column = this.world.getColumn(Math.floor(wx / 16), Math.floor(wz / 16));
    if (!column) return;
    const lx = wx - column.cx * 16;
    const lz = wz - column.cz * 16;
    const index = localIndex(lx, wy, lz);
    this.updateSkyAt(column, index, wx, wy, wz, currentId);
    this.updateBlockLightAt(column, index, wx, wy, wz, currentId);
  }

  private updateSkyAt(column: ChunkColumn, index: number, wx: number, wy: number, wz: number, currentId: number): void {
    const oldLevel = column.sky[index];
    const opacity = LIGHT_OPACITY[currentId];
    let selfLevel = 0;
    if (opacity < MAX_LIGHT) {
      const above = wy + 1 >= WORLD_HEIGHT ? MAX_LIGHT : this.getSkyLight(wx, wy + 1, wz);
      if (above > 0) {
        const dec = above === MAX_LIGHT && opacity === 0 ? 0 : Math.max(1, opacity);
        selfLevel = Math.max(0, above - dec);
      }
    }
    column.sky[index] = selfLevel;

    const seeds: FlatQueue = [];
    if (oldLevel > selfLevel) {
      this.removeLight(wx, wy, wz, oldLevel, true, seeds);
    }
    if (selfLevel > 0) seeds.push(wx, wy, wz, selfLevel);
    this.pushNeighbourSeeds(wx, wy, wz, true, seeds);
    this.propagateWorld(seeds, true);
    this.world.markDirty?.(wx, wy, wz);
  }

  private updateBlockLightAt(column: ChunkColumn, index: number, wx: number, wy: number, wz: number, currentId: number): void {
    const oldLevel = column.blockLight[index];
    column.blockLight[index] = 0;
    const seeds: FlatQueue = [];
    if (oldLevel > 0) {
      this.removeLight(wx, wy, wz, oldLevel, false, seeds);
    }
    const emission = LIGHT_EMISSION[currentId];
    if (emission > 0) {
      column.blockLight[index] = emission;
      seeds.push(wx, wy, wz, emission);
    } else {
      column.blockLight[index] = 0;
    }
    this.pushNeighbourSeeds(wx, wy, wz, false, seeds);
    this.propagateWorld(seeds, false);
    this.world.markDirty?.(wx, wy, wz);
  }

  /**
   * Flood-remove light that depended on the removed source. Neighbours that are at
   * least as bright are independent sources and get collected for re-propagation.
   */
  private removeLight(
    startX: number,
    startY: number,
    startZ: number,
    startLevel: number,
    isSky: boolean,
    seeds: FlatQueue,
  ): void {
    const queue: FlatQueue = [startX, startY, startZ, startLevel];
    for (let head = 0; head < queue.length; head += 4) {
      const x = queue[head];
      const y = queue[head + 1];
      const z = queue[head + 2];
      const level = queue[head + 3];
      for (const [dx, dy, dz] of DIRS) {
        const nx = x + dx;
        const ny = y + dy;
        const nz = z + dz;
        if (!inWorldY(ny)) continue;
        const neighbour = this.world.getColumn(Math.floor(nx / 16), Math.floor(nz / 16));
        if (!neighbour) continue;
        const nIndex = localIndex(nx - neighbour.cx * 16, ny, nz - neighbour.cz * 16);
        const light = isSky ? neighbour.sky : neighbour.blockLight;
        const nLevel = light[nIndex];
        if (nLevel === 0) continue;
        // Sky light keeps 15 in a straight vertical column, so an equal-level cell
        // directly below a removed cell is also dependent.
        const verticalColumn = isSky && dy === -1 && nLevel === level && level === MAX_LIGHT;
        if (nLevel < level || verticalColumn) {
          light[nIndex] = 0;
          this.world.markDirty?.(nx, ny, nz);
          queue.push(nx, ny, nz, nLevel);
        } else {
          seeds.push(nx, ny, nz, nLevel);
        }
      }
    }
    this.pruneSeeds(seeds, isSky);
  }

  /**
   * Removal may collect a cell as an "independent source" before a later branch
   * clears it (equal-level neighbours can depend on different parts of the removed
   * region). Drop seeds that no longer carry light, otherwise we would re-add stale
   * brightness and the removal pass would be wrong.
   */
  private pruneSeeds(seeds: FlatQueue, isSky: boolean): void {
    let write = 0;
    for (let read = 0; read < seeds.length; read += 4) {
      const x = seeds[read];
      const y = seeds[read + 1];
      const z = seeds[read + 2];
      if (!inWorldY(y)) continue;
      const column = this.world.getColumn(Math.floor(x / 16), Math.floor(z / 16));
      if (!column) continue;
      const index = localIndex(x - column.cx * 16, y, z - column.cz * 16);
      const level = isSky ? column.sky[index] : column.blockLight[index];
      if (level === 0) continue;
      seeds[write++] = x;
      seeds[write++] = y;
      seeds[write++] = z;
      seeds[write++] = level;
    }
    seeds.length = write;
  }

  private pushNeighbourSeeds(wx: number, wy: number, wz: number, isSky: boolean, seeds: FlatQueue): void {
    for (const [dx, dy, dz] of DIRS) {
      const nx = wx + dx;
      const ny = wy + dy;
      const nz = wz + dz;
      if (!inWorldY(ny)) continue;
      const neighbour = this.world.getColumn(Math.floor(nx / 16), Math.floor(nz / 16));
      if (!neighbour) continue;
      const nIndex = localIndex(nx - neighbour.cx * 16, ny, nz - neighbour.cz * 16);
      const level = isSky ? neighbour.sky[nIndex] : neighbour.blockLight[nIndex];
      if (level > 0) seeds.push(nx, ny, nz, level);
    }
  }

  // --------------------------------------------------------------------- BFS

  /** Propagate one kind of light through a single column using world coordinates. */
  private propagateLocal(column: ChunkColumn, queue: FlatQueue, isSky: boolean): void {
    const light = isSky ? column.sky : column.blockLight;
    const blocks = column.blocks;
    const baseX = column.cx * 16;
    const baseZ = column.cz * 16;
    for (let head = 0; head < queue.length; head += 4) {
      const x = queue[head] - baseX;
      const y = queue[head + 1];
      const z = queue[head + 2] - baseZ;
      const level = queue[head + 3];
      for (const [dx, dy, dz] of DIRS) {
        const nx = x + dx;
        const ny = y + dy;
        const nz = z + dz;
        if (nx < 0 || nx > 15 || nz < 0 || nz > 15 || !inWorldY(ny)) continue;
        const nIndex = localIndex(nx, ny, nz);
        const opacity = LIGHT_OPACITY[blocks[nIndex]];
        const dec = isSky ? skyDecay(dy, level, opacity) : Math.max(1, opacity);
        if (dec >= MAX_LIGHT) continue;
        const required = level - dec;
        if (required <= light[nIndex]) continue;
        light[nIndex] = required;
        queue.push(nx + baseX, ny, nz + baseZ, required);
      }
    }
  }

  /** Propagate one kind of light across loaded columns using world coordinates. */
  private propagateWorld(initial: FlatQueue, isSky: boolean): void {
    const queue = initial;
    for (let head = 0; head < queue.length; head += 4) {
      const x = queue[head];
      const y = queue[head + 1];
      const z = queue[head + 2];
      const level = queue[head + 3];
      for (const [dx, dy, dz] of DIRS) {
        const nx = x + dx;
        const ny = y + dy;
        const nz = z + dz;
        if (!inWorldY(ny)) continue;
        const column = this.world.getColumn(Math.floor(nx / 16), Math.floor(nz / 16));
        if (!column) continue;
        const lx = nx - column.cx * 16;
        const lz = nz - column.cz * 16;
        const nIndex = localIndex(lx, ny, lz);
        const opacity = LIGHT_OPACITY[column.blocks[nIndex]];
        const dec = isSky ? skyDecay(dy, level, opacity) : Math.max(1, opacity);
        if (dec >= MAX_LIGHT) continue;
        const required = level - dec;
        const light = isSky ? column.sky : column.blockLight;
        if (required <= light[nIndex]) continue;
        light[nIndex] = required;
        this.world.markDirty?.(nx, ny, nz);
        queue.push(nx, ny, nz, required);
      }
    }
  }

  private lowerNeighbourLocal(sky: Uint8Array, x: number, y: number, z: number, level: number): boolean {
    if (x > 0 && sky[localIndex(x - 1, y, z)] < level) return true;
    if (x < 15 && sky[localIndex(x + 1, y, z)] < level) return true;
    if (z > 0 && sky[localIndex(x, y, z - 1)] < level) return true;
    if (z < 15 && sky[localIndex(x, y, z + 1)] < level) return true;
    if (y > 0 && sky[localIndex(x, y - 1, z)] < level) return true;
    if (y < WORLD_HEIGHT - 1 && sky[localIndex(x, y + 1, z)] < level) return true;
    return false;
  }
}

/** Handy for tooling/tests: number of light-bearing cells in a column. */
export function countLitCells(column: ChunkColumn): number {
  let count = 0;
  for (let i = 0; i < column.sky.length; i++) {
    if (column.sky[i] > 0) count++;
  }
  return count;
}

export { SECTION_COUNT };

