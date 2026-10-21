/** Shared deterministic WorldView fake + helpers for entity tests. */

import type { WorldView } from '../../src/core/contracts';
import type { BlockId, WorldTime } from '../../src/core/types';
import { TICKS_PER_DAY } from '../../src/core/config';
import { blockNumeric } from '../../src/world/blocks';
import type { EntityPlayerView } from '../../src/entities/manager';

export const TEST_BLOCKS = {
  air: 0,
  stone: blockNumeric('stone'),
  dirt: blockNumeric('dirt'),
  grass_block: blockNumeric('grass_block'),
  sand: blockNumeric('sand'),
  water: blockNumeric('water'),
  lava: blockNumeric('lava'),
  obsidian: blockNumeric('obsidian'),
  bedrock: blockNumeric('bedrock'),
  cobblestone: blockNumeric('cobblestone'),
  oak_log: blockNumeric('oak_log'),
} as const;

export const DAY_TICKS = 6000;
export const NIGHT_TICKS = 18000;

function blockKey(x: number, y: number, z: number): string {
  return `${x},${y},${z}`;
}

/** Minimal in-memory WorldView used by the entity tests. */
export class TestWorld implements WorldView {
  readonly seed = 'test-world';
  readonly height = 160;
  private readonly blocks = new Map<string, BlockId>();
  private readonly skyLightMap = new Map<string, number>();
  private readonly blockLightMap = new Map<string, number>();
  private defaultSkyLight = 15;
  private ticks = DAY_TICKS;
  /** Records the `cause` of the most recent successful setBlock. */
  lastBlockCause: string | undefined;
  readonly setBlockCalls: Array<{ x: number; y: number; z: number; id: BlockId }> = [];

  set(x: number, y: number, z: number, id: BlockId): this {
    this.blocks.set(blockKey(x, y, z), id);
    return this;
  }

  fill(
    x0: number,
    y0: number,
    z0: number,
    x1: number,
    y1: number,
    z1: number,
    id: BlockId,
  ): this {
    for (let y = y0; y <= y1; y++) {
      for (let z = z0; z <= z1; z++) {
        for (let x = x0; x <= x1; x++) this.blocks.set(blockKey(x, y, z), id);
      }
    }
    return this;
  }

  /** Solid ground from y=0 to groundY-1, with `topBlock` on the surface. */
  fillGround(groundY: number, halfSize: number, topBlock: BlockId = TEST_BLOCKS.grass_block): this {
    this.fill(-halfSize, 0, -halfSize, halfSize, groundY - 2, halfSize, TEST_BLOCKS.stone);
    this.fill(-halfSize, groundY - 1, -halfSize, halfSize, groundY - 1, halfSize, topBlock);
    return this;
  }

  setSkyLight(x: number, y: number, z: number, value: number): this {
    this.skyLightMap.set(blockKey(x, y, z), value);
    return this;
  }

  setBlockLight(x: number, y: number, z: number, value: number): this {
    this.blockLightMap.set(blockKey(x, y, z), value);
    return this;
  }

  setDefaultSkyLight(value: number): this {
    this.defaultSkyLight = value;
    return this;
  }

  setTicks(ticks: number): this {
    this.ticks = ticks;
    return this;
  }

  setDaytime(day: boolean): this {
    this.ticks = day ? DAY_TICKS : NIGHT_TICKS;
    return this;
  }

  getBlock(x: number, y: number, z: number): BlockId {
    if (y < 0) return TEST_BLOCKS.bedrock;
    if (y >= this.height) return TEST_BLOCKS.air;
    return this.blocks.get(blockKey(x, y, z)) ?? TEST_BLOCKS.air;
  }

  getMeta(_x: number, _y: number, _z: number): number {
    return 0;
  }

  getSkyLight(x: number, y: number, z: number): number {
    return this.skyLightMap.get(blockKey(x, y, z)) ?? this.defaultSkyLight;
  }

  getBlockLight(x: number, y: number, z: number): number {
    return this.blockLightMap.get(blockKey(x, y, z)) ?? 0;
  }

  setBlock(
    x: number,
    y: number,
    z: number,
    id: BlockId,
    _meta = 0,
    cause?: string,
  ): boolean {
    if (y < 0 || y >= this.height) return false;
    const previous = this.getBlock(x, y, z);
    if (previous === id) return false;
    this.blocks.set(blockKey(x, y, z), id);
    this.lastBlockCause = cause;
    this.setBlockCalls.push({ x, y, z, id });
    return true;
  }

  isChunkLoaded(_cx: number, _cz: number): boolean {
    return true;
  }

  time(): WorldTime {
    const timeOfDay = ((this.ticks % TICKS_PER_DAY) + TICKS_PER_DAY) % TICKS_PER_DAY;
    const day = Math.floor(this.ticks / TICKS_PER_DAY);
    const angle = (timeOfDay / TICKS_PER_DAY) * Math.PI * 2;
    const sunY = Math.sin(angle);
    const daylight = Math.max(0.08, Math.min(1, (sunY + 0.15) / 0.5));
    return { ticks: this.ticks, timeOfDay, day, daylight };
  }

  spawnY(x: number, z: number): number {
    for (let y = this.height - 1; y >= 0; y--) {
      if (this.getBlock(x, y, z) !== TEST_BLOCKS.air) return y + 1;
    }
    return 1;
  }
}

export interface FlatWorldOptions {
  halfSize?: number;
  groundY?: number;
  topBlock?: BlockId;
  daytime?: boolean;
}

/** Ground plane at `groundY` (feet stand at groundY); solid below. */
export function makeFlatWorld(options: FlatWorldOptions = {}): TestWorld {
  const halfSize = options.halfSize ?? 64;
  const groundY = options.groundY ?? 10;
  const topBlock = options.topBlock ?? TEST_BLOCKS.grass_block;
  const world = new TestWorld();
  world.fillGround(groundY, halfSize, topBlock);
  if (options.daytime === false) world.setDaytime(false);
  return world;
}

export function makePlayer(
  x = 0.5,
  y = 10,
  z = 0.5,
  overrides: Partial<EntityPlayerView> = {},
): EntityPlayerView {
  return {
    position: { x, y, z },
    yaw: 0,
    pitch: 0,
    gameMode: 'survival',
    health: 20,
    maxHealth: 20,
    ...overrides,
  };
}

/** Sum of block ids in a box (0 when everything was removed). */
export function countNonAir(world: TestWorld, x0: number, y0: number, z0: number, x1: number, y1: number, z1: number): number {
  let count = 0;
  for (let y = y0; y <= y1; y++) {
    for (let z = z0; z <= z1; z++) {
      for (let x = x0; x <= x1; x++) {
        if (world.getBlock(x, y, z) !== TEST_BLOCKS.air) count++;
      }
    }
  }
  return count;
}
