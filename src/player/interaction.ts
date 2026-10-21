/**
 * First-person block interaction: DDA ray casting, mining progress, tool
 * durability, block placement rules, eating, flint & steel, bow charging.
 *
 * The module never imports main.ts. World edits go through
 * `WorldView.setBlock`; drops, sounds and particles are reported to Lead via
 * callbacks so it can spawn item entities / play audio / emit particles.
 *
 * main.ts wiring:
 *   const interaction = new InteractionController({
 *     onBreak: (hit, def, drops) => { ...spawn item entities... },
 *     onPlace: (hit, x, y, z, blockId, meta, itemId) => { ... },
 *     onSound: (id, x, y, z) => audio.play(id, { position: { x, y, z } }),
 *     onParticles: (kind, x, y, z, color) => particles.spawn(kind, { x, y, z }, { color }),
 *     onUse: (itemId, hit) => { ...open UI... return false; },
 *     onIgniteTnt: (x, y, z) => { ...spawn primed TNT... },
 *     onShootArrow: (charge, origin, direction) => { ...spawn arrow... },
 *     ...
 *   });
 *   // each frame:
 *   const result = interaction.update(world, player, dtMs, {
 *     attack: state.attack, attackPressed: state.attackPressed,
 *     use: state.use, usePressed: state.usePressed, useReleased: state.useReleased,
 *   });
 *   // result.hit -> selection box, result.progress -> crack overlay
 */

import { PLAYER_REACH, WORLD_HEIGHT } from '../core/config';
import { clamp } from '../core/math';
import { hash3i, hashString, Rand } from '../core/rng';
import type { WorldView } from '../core/contracts';
import type { BlockHit, Vec3 } from '../core/types';
import {
  AIR,
  BLOCK,
  FLUID_KIND,
  IS_REPLACEABLE,
  blockNumeric,
  getBlockDef,
  type BlockDef,
  type BlockSound,
} from '../world/blocks';
import { type ItemDef } from '../world/items';
import { breakSoundFor, placeSoundFor, type SoundId } from '../audio/audio';
import type { ParticleKind } from './particles';
import { PLAYER_HALF_WIDTH, PLAYER_HEIGHT } from './physics';
import type { EatResult, Player } from './player';

// ---------------------------------------------------------------------------
// Ray casting (Amanatides & Woo DDA)
// ---------------------------------------------------------------------------

export interface RaycastWorld {
  getBlock(x: number, y: number, z: number): number;
  getMeta?(x: number, y: number, z: number): number;
}

export interface RaycastOptions {
  /** When true, water/lava are hit too (default false, like Minecraft). */
  includeFluids?: boolean;
}

/** Integer block hit result including the face normal pointing at the ray. */
export function raycastBlocks(
  world: RaycastWorld,
  origin: Vec3,
  direction: Vec3,
  maxDistance = PLAYER_REACH,
  options: RaycastOptions = {},
): BlockHit | null {
  const length = Math.hypot(direction.x, direction.y, direction.z);
  if (length < 1e-9 || maxDistance <= 0) return null;
  const dx = direction.x / length;
  const dy = direction.y / length;
  const dz = direction.z / length;

  let x = Math.floor(origin.x);
  let y = Math.floor(origin.y);
  let z = Math.floor(origin.z);

  const stepX = dx > 0 ? 1 : dx < 0 ? -1 : 0;
  const stepY = dy > 0 ? 1 : dy < 0 ? -1 : 0;
  const stepZ = dz > 0 ? 1 : dz < 0 ? -1 : 0;

  const tDeltaX = stepX === 0 ? Infinity : Math.abs(1 / dx);
  const tDeltaY = stepY === 0 ? Infinity : Math.abs(1 / dy);
  const tDeltaZ = stepZ === 0 ? Infinity : Math.abs(1 / dz);

  let tMaxX = stepX === 0 ? Infinity : stepX > 0 ? (x + 1 - origin.x) / dx : (x - origin.x) / dx;
  let tMaxY = stepY === 0 ? Infinity : stepY > 0 ? (y + 1 - origin.y) / dy : (y - origin.y) / dy;
  let tMaxZ = stepZ === 0 ? Infinity : stepZ > 0 ? (z + 1 - origin.z) / dz : (z - origin.z) / dz;

  const isTarget = (id: number): boolean =>
    id !== AIR && (options.includeFluids === true || FLUID_KIND[id] === 0);

  // Starting voxel (eye inside a block — normal points back along the ray).
  if (isTarget(world.getBlock(x, y, z))) {
    const normalX = Math.abs(dx) >= Math.abs(dy) && Math.abs(dx) >= Math.abs(dz) ? -Math.sign(dx) : 0;
    const normalY = normalX === 0 && Math.abs(dy) >= Math.abs(dz) ? -Math.sign(dy) : 0;
    const normalZ = normalX === 0 && normalY === 0 ? -Math.sign(dz) : 0;
    return {
      x,
      y,
      z,
      nx: normalX,
      ny: normalY,
      nz: normalZ,
      distance: 0,
      id: world.getBlock(x, y, z),
      meta: world.getMeta?.(x, y, z) ?? 0,
    };
  }

  let tMax = Math.min(tMaxX, tMaxY, tMaxZ);
  let normalX = 0;
  let normalY = 0;
  let normalZ = 0;
  let guard = 0;
  while (tMax <= maxDistance && guard++ < 512) {
    if (tMaxX <= tMaxY && tMaxX <= tMaxZ) {
      x += stepX;
      tMax = tMaxX;
      tMaxX += tDeltaX;
      normalX = -stepX;
      normalY = 0;
      normalZ = 0;
    } else if (tMaxY <= tMaxZ) {
      y += stepY;
      tMax = tMaxY;
      tMaxY += tDeltaY;
      normalX = 0;
      normalY = -stepY;
      normalZ = 0;
    } else {
      z += stepZ;
      tMax = tMaxZ;
      tMaxZ += tDeltaZ;
      normalX = 0;
      normalY = 0;
      normalZ = -stepZ;
    }
    if (tMax > maxDistance) break;
    const id = world.getBlock(x, y, z);
    if (isTarget(id)) {
      return {
        x,
        y,
        z,
        nx: normalX,
        ny: normalY,
        nz: normalZ,
        distance: tMax,
        id,
        meta: world.getMeta?.(x, y, z) ?? 0,
      };
    }
  }
  return null;
}

// ---------------------------------------------------------------------------
// Mining speed / drops
// ---------------------------------------------------------------------------

/** Whether the given item can harvest (drop) the block. */
export function canHarvest(block: BlockDef, item: ItemDef | null): boolean {
  if (!block.requiresTool) return true;
  const tool = item?.tool;
  if (!tool || tool.type !== block.tool) return false;
  return tool.tier >= block.tier;
}

/** Mining speed multiplier of the held item for this block. */
export function toolSpeedFor(block: BlockDef, item: ItemDef | null): number {
  const tool = item?.tool;
  if (!tool || tool.type !== block.tool) return 1;
  return Math.max(1, tool.speed);
}

/**
 * Seconds needed to break `block` (PLAN §3.5 formula):
 *   hardness × (correct tool ? 1.5 : 5) / tool speed
 * Unbreakable blocks (hardness -1) return Infinity; creative/instant blocks 0.
 */
export function breakTimeSeconds(block: BlockDef, item: ItemDef | null, creative = false): number {
  if (creative) return 0;
  if (block.hardness < 0) return Infinity;
  if (block.hardness === 0) return 0;
  const multiplier = canHarvest(block, item) ? 1.5 : 5;
  return (block.hardness * multiplier) / toolSpeedFor(block, item);
}

/** Progress per second (0 for unbreakable, Infinity for instant). */
export function breakSpeedFor(block: BlockDef, item: ItemDef | null, creative = false): number {
  const time = breakTimeSeconds(block, item, creative);
  if (time === 0) return Infinity;
  if (!Number.isFinite(time)) return 0;
  return 1 / time;
}

/** Crack overlay stage 0..9 (-1 = no overlay). */
export function breakStage(progress: number): number {
  if (progress <= 0) return -1;
  return Math.min(9, Math.floor(progress * 10));
}

/** Roll a block's drop table. `random` must be deterministic (core/rng). */
export function rollDrops(
  block: BlockDef,
  harvestable: boolean,
  random: () => number,
): ItemDropResult[] {
  if (!harvestable) return [];
  const drops: ItemDropResult[] = [];
  for (const drop of block.drops) {
    if (drop.chance !== undefined && random() > drop.chance) continue;
    const span = Math.max(0, drop.max - drop.min);
    const count = drop.min + Math.floor(random() * (span + 1));
    if (count > 0) drops.push({ item: drop.item, count });
  }
  return drops;
}

function deterministicRandom(world: WorldView, hit: BlockHit): () => number {
  const seed = hashString(world.seed) ^ hash3i(world.time().ticks, hit.x, hit.y, hit.z);
  const rand = new Rand(seed);
  return () => rand.next();
}

// ---------------------------------------------------------------------------
// Particles / colors (pure helpers shared with Lead)
// ---------------------------------------------------------------------------

const SOUND_COLORS: Record<BlockSound, [number, number, number]> = {
  stone: [0.49, 0.49, 0.49],
  dirt: [0.45, 0.34, 0.24],
  grass: [0.36, 0.58, 0.26],
  wood: [0.52, 0.38, 0.2],
  sand: [0.86, 0.81, 0.64],
  glass: [0.78, 0.88, 0.92],
  wool: [0.86, 0.86, 0.86],
  metal: [0.62, 0.64, 0.68],
  plant: [0.34, 0.6, 0.24],
};

const BLOCK_PARTICLE_COLORS: Record<string, [number, number, number]> = {
  grass_block: [0.36, 0.6, 0.27],
  dirt: [0.45, 0.34, 0.24],
  coarse_dirt: [0.42, 0.32, 0.22],
  sand: [0.86, 0.81, 0.64],
  sandstone: [0.82, 0.78, 0.6],
  gravel: [0.5, 0.48, 0.46],
  clay: [0.62, 0.66, 0.72],
  snow_block: [0.93, 0.95, 0.98],
  ice: [0.68, 0.83, 0.94],
  water: [0.25, 0.45, 0.9],
  lava: [0.95, 0.45, 0.1],
  oak_log: [0.36, 0.27, 0.16],
  birch_log: [0.72, 0.68, 0.56],
  spruce_log: [0.3, 0.21, 0.12],
  oak_leaves: [0.24, 0.48, 0.18],
  coal_ore: [0.24, 0.24, 0.24],
  iron_ore: [0.72, 0.6, 0.5],
  gold_ore: [0.86, 0.74, 0.3],
  diamond_ore: [0.4, 0.78, 0.78],
  redstone_ore: [0.6, 0.16, 0.16],
  lapis_ore: [0.2, 0.32, 0.7],
  obsidian: [0.12, 0.1, 0.18],
  oak_planks: [0.66, 0.52, 0.32],
  birch_planks: [0.78, 0.72, 0.55],
  spruce_planks: [0.45, 0.33, 0.18],
  stone_bricks: [0.47, 0.47, 0.47],
  bricks: [0.58, 0.28, 0.22],
  glass: [0.78, 0.88, 0.92],
  white_wool: [0.9, 0.9, 0.9],
  red_wool: [0.72, 0.16, 0.16],
  yellow_wool: [0.86, 0.78, 0.2],
  blue_wool: [0.2, 0.3, 0.7],
  black_wool: [0.1, 0.1, 0.1],
  torch: [0.95, 0.72, 0.25],
  tnt: [0.8, 0.2, 0.15],
  bookshelf: [0.55, 0.43, 0.26],
  coal_block: [0.12, 0.12, 0.12],
  iron_block: [0.76, 0.76, 0.76],
  gold_block: [0.9, 0.78, 0.3],
  diamond_block: [0.4, 0.85, 0.85],
  lapis_block: [0.2, 0.32, 0.72],
  redstone_block: [0.62, 0.12, 0.12],
};

/** Approximate particle color for a block (linear RGB 0..1). */
export function particleColorForBlock(block: BlockDef): [number, number, number] {
  return BLOCK_PARTICLE_COLORS[block.id] ?? SOUND_COLORS[block.sound] ?? [0.6, 0.6, 0.6];
}

// ---------------------------------------------------------------------------
// Placement
// ---------------------------------------------------------------------------

export type PlaceFailure =
  | 'not_a_block'
  | 'no_hit'
  | 'out_of_bounds'
  | 'occupied'
  | 'player_overlap'
  | 'no_support';

export interface PlacementResult {
  ok: boolean;
  x: number;
  y: number;
  z: number;
  blockId: number;
  meta: number;
  failure?: PlaceFailure;
}

const SUPPORT_SUBSTRATE: Readonly<Record<string, readonly string[]>> = {
  sugar_cane: ['grass_block', 'dirt', 'sand'],
  tall_grass: ['grass_block', 'dirt'],
  poppy: ['grass_block', 'dirt'],
  dandelion: ['grass_block', 'dirt'],
  dead_bush: ['sand'],
  cactus: ['sand', 'cactus'],
};

const LOG_BLOCKS = new Set(['oak_log', 'birch_log', 'spruce_log']);
const FACING_BLOCKS = new Set(['furnace', 'lit_furnace', 'chest', 'crafting_table']);

/** Blocks with UI/behaviour handled by Lead (chest/furnace/crafting). */
export const INTERACTIVE_BLOCKS = new Set(['crafting_table', 'furnace', 'lit_furnace', 'chest']);

/** Position where a new block would be placed, respecting replaceable blocks. */
export function placementTarget(
  world: RaycastWorld,
  hit: BlockHit | null,
): { x: number; y: number; z: number } | null {
  if (!hit) return null;
  // Clicking a replaceable plant replaces it in place; otherwise use the face.
  if (IS_REPLACEABLE[hit.id] === 1 && hit.id !== AIR) {
    return { x: hit.x, y: hit.y, z: hit.z };
  }
  void world;
  return { x: hit.x + hit.nx, y: hit.y + hit.ny, z: hit.z + hit.nz };
}

/** Orientation byte for blocks that care about it (logs / furnaces / chests). */
export function placementMetaFor(
  block: BlockDef,
  hit: BlockHit | null,
  playerPosition: Vec3,
  target: { x: number; y: number; z: number },
): number {
  if (LOG_BLOCKS.has(block.id)) {
    if (!hit) return 0;
    if (hit.ny !== 0) return 0; // vertical
    if (hit.nx !== 0) return 1; // X axis
    return 2; // Z axis
  }
  if (FACING_BLOCKS.has(block.id)) {
    // Front faces the player: 2 north(-Z), 3 south(+Z), 4 west(-X), 5 east(+X).
    const dx = playerPosition.x - (target.x + 0.5);
    const dz = playerPosition.z - (target.z + 0.5);
    if (Math.abs(dx) > Math.abs(dz)) return dx > 0 ? 5 : 4;
    return dz > 0 ? 3 : 2;
  }
  return 0;
}

function blockOverlapsPlayer(
  x: number,
  y: number,
  z: number,
  playerPosition: Vec3,
): boolean {
  const epsilon = 1e-4;
  const px0 = playerPosition.x - PLAYER_HALF_WIDTH + epsilon;
  const px1 = playerPosition.x + PLAYER_HALF_WIDTH - epsilon;
  const py0 = playerPosition.y + epsilon;
  const py1 = playerPosition.y + PLAYER_HEIGHT - epsilon;
  const pz0 = playerPosition.z - PLAYER_HALF_WIDTH + epsilon;
  const pz1 = playerPosition.z + PLAYER_HALF_WIDTH - epsilon;
  return x + 1 > px0 && x < px1 && y + 1 > py0 && y < py1 && z + 1 > pz0 && z < pz1;
}

function hasSupport(world: RaycastWorld, x: number, y: number, z: number, blockId: string): boolean {
  const below = getBlockDef(world.getBlock(x, y - 1, z));
  if (blockId === 'torch') {
    return below.solid && below.fluid === null && below.collidable;
  }
  const substrates = SUPPORT_SUBSTRATE[blockId];
  if (substrates) return substrates.includes(below.id);
  return true;
}

/**
 * Validate a placement without mutating anything. Pure; used by the controller
 * and directly unit-tested.
 */
export function canPlaceBlock(
  world: RaycastWorld,
  playerPosition: Vec3,
  hit: BlockHit | null,
  item: ItemDef | null,
): PlacementResult {
  const fail = (failure: PlaceFailure, x = 0, y = 0, z = 0): PlacementResult => ({
    ok: false,
    x,
    y,
    z,
    blockId: AIR,
    meta: 0,
    failure,
  });
  if (!item?.block) return fail('not_a_block');
  if (!hit) return fail('no_hit');
  const blockId = blockNumeric(item.block);
  if (blockId === AIR) return fail('not_a_block');
  const block = getBlockDef(blockId);
  const target = placementTarget(world, hit);
  if (!target) return fail('no_hit');
  if (target.y < 0 || target.y >= WORLD_HEIGHT) return fail('out_of_bounds', target.x, target.y, target.z);

  const existing = world.getBlock(target.x, target.y, target.z);
  if (IS_REPLACEABLE[existing] !== 1) return fail('occupied', target.x, target.y, target.z);
  if (!hasSupport(world, target.x, target.y, target.z, block.id)) {
    return fail('no_support', target.x, target.y, target.z);
  }
  if (block.collidable && blockOverlapsPlayer(target.x, target.y, target.z, playerPosition)) {
    return fail('player_overlap', target.x, target.y, target.z);
  }
  return {
    ok: true,
    x: target.x,
    y: target.y,
    z: target.z,
    blockId,
    meta: placementMetaFor(block, hit, playerPosition, target),
  };
}

// ---------------------------------------------------------------------------
// Interaction controller
// ---------------------------------------------------------------------------

export interface ItemDropResult {
  item: string;
  count: number;
}

export interface InteractionCallbacks {
  onSound?(id: SoundId, x: number, y: number, z: number): void;
  onParticles?(kind: ParticleKind, x: number, y: number, z: number, color?: [number, number, number]): void;
  /** A block was removed: spawn item entities / update UI here. */
  onBreak?(hit: BlockHit, block: BlockDef, drops: ItemDropResult[]): void;
  /** A block was placed (world.setBlock already succeeded). */
  onPlace?(
    hit: BlockHit | null,
    x: number,
    y: number,
    z: number,
    blockId: number,
    meta: number,
    itemId: string,
  ): void;
  /**
   * Right-click on a block. Return true when Lead handled it (chest UI, etc.),
   * which suppresses item use/placement for this click.
   */
  onUse?(itemId: string | null, hit: BlockHit | null): boolean | void;
  onEat?(eaten: EatResult): void;
  /** Flint & steel used on TNT; Lead spawns the primed TNT entity. */
  onIgniteTnt?(x: number, y: number, z: number): void;
  /** Bow released; Lead spawns the arrow projectile. charge is 0..1. */
  onShootArrow?(charge: number, origin: Vec3, direction: Vec3): void;
  onSwing?(itemId: string | null): void;
  /**
   * Attack pressed: Lead can ray-cast entities (Entities-D manager.playerAttack)
   * before/minstead of block mining. `blockHit` is the block under the crosshair.
   */
  onAttack?(origin: Vec3, direction: Vec3, blockHit: BlockHit | null): void;
  onToolBroken?(itemId: string): void;
}

export interface InteractionOptions extends InteractionCallbacks {
  reach?: number;
}

export interface InteractionInput {
  attack: boolean;
  attackPressed: boolean;
  use: boolean;
  usePressed: boolean;
  useReleased: boolean;
}

export interface InteractionUpdateResult {
  hit: BlockHit | null;
  progress: number;
  breaking: boolean;
}

export const EAT_DURATION_SECONDS = 1.6;

const EMPTY_INPUT: InteractionInput = {
  attack: false,
  attackPressed: false,
  use: false,
  usePressed: false,
  useReleased: false,
};

export class InteractionController {
  /** Current ray target (null = air). */
  hit: BlockHit | null = null;
  /** Mining progress 0..1 for the current target. */
  breakProgress = 0;
  /** Block currently being mined (x/y/z), or null. */
  breakTarget: BlockHit | null = null;
  breaking = false;
  bowCharge = 0;
  bowCharging = false;
  eating = false;
  eatProgress = 0;

  private readonly reach: number;
  private readonly callbacks: InteractionCallbacks;

  constructor(options: InteractionOptions = {}) {
    const { reach, ...callbacks } = options;
    this.reach = reach ?? PLAYER_REACH;
    this.callbacks = callbacks;
  }

  update(
    world: WorldView,
    player: Player,
    dtMs: number,
    input: InteractionInput = EMPTY_INPUT,
  ): InteractionUpdateResult {
    const dt = clamp(dtMs, 0, 250) / 1000;
    const eye = player.eyePosition();
    this.hit = raycastBlocks(world, eye, player.lookDirection(), this.reach);
    this.updateBreak(world, player, dt, input);
    this.updateUse(world, player, dt, input);
    return { hit: this.hit, progress: this.breakProgress, breaking: this.breaking };
  }

  // -------------------------------------------------------------------------
  // Mining
  // -------------------------------------------------------------------------

  private resetBreak(): void {
    this.breakProgress = 0;
    this.breakTarget = null;
    this.breaking = false;
  }

  private updateBreak(world: WorldView, player: Player, dt: number, input: InteractionInput): void {
    const item = player.selectedItem();
    if (input.attackPressed) {
      const itemId = item?.id ?? null;
      this.callbacks.onSwing?.(itemId);
      this.callbacks.onAttack?.(player.eyePosition(), player.lookDirection(), this.hit);
    }
    if (!input.attack || !this.hit) {
      this.resetBreak();
      return;
    }
    const hit = this.hit;
    const block = getBlockDef(hit.id);
    if (block.hardness < 0) {
      this.resetBreak();
      return;
    }
    if (player.gameMode === 'creative') {
      this.breaking = true;
      this.breakProgress = 1;
      this.breakBlock(world, player, hit, block, item);
      return;
    }
    const sameTarget =
      this.breakTarget !== null &&
      this.breakTarget.x === hit.x &&
      this.breakTarget.y === hit.y &&
      this.breakTarget.z === hit.z;
    if (!sameTarget) {
      this.breakTarget = hit;
      this.breakProgress = 0;
    }
    this.breaking = true;
    const time = breakTimeSeconds(block, item, false);
    if (time === 0) {
      this.breakProgress = 1;
      this.breakBlock(world, player, hit, block, item);
      return;
    }
    if (!Number.isFinite(time) || time <= 0) {
      this.resetBreak();
      return;
    }
    this.breakProgress += dt / time;
    if (this.breakProgress >= 1) this.breakBlock(world, player, hit, block, item);
  }

  private breakBlock(
    world: WorldView,
    player: Player,
    hit: BlockHit,
    block: BlockDef,
    item: ItemDef | null,
  ): void {
    this.resetBreak();
    const removed = world.setBlock(hit.x, hit.y, hit.z, AIR, 0, 'player');
    if (!removed) return;
    const centerX = hit.x + 0.5;
    const centerY = hit.y + 0.5;
    const centerZ = hit.z + 0.5;
    const drops = rollDrops(block, canHarvest(block, item), deterministicRandom(world, hit));
    this.callbacks.onSound?.(breakSoundFor(block.sound), centerX, centerY, centerZ);
    this.callbacks.onParticles?.('blockBreak', centerX, centerY, centerZ, particleColorForBlock(block));
    this.callbacks.onBreak?.(hit, block, drops);
    if (player.gameMode !== 'creative') {
      player.addExhaustion(0.005);
      if (item?.tool && item.tool.type !== 'none' && player.damageSelectedDurability(1)) {
        this.callbacks.onToolBroken?.(item.id);
      }
    }
  }

  // -------------------------------------------------------------------------
  // Use / eat / ignite / bow / place
  // -------------------------------------------------------------------------

  private updateUse(world: WorldView, player: Player, dt: number, input: InteractionInput): void {
    const item = player.selectedItem();
    const itemId = item?.id ?? null;

    if (itemId === 'bow') {
      this.updateBow(player, dt, input);
      return;
    }

    if (this.eating) {
      if (!input.use) {
        this.eating = false;
        this.eatProgress = 0;
        return;
      }
      this.eatProgress += dt;
      if (this.eatProgress >= EAT_DURATION_SECONDS) {
        this.finishEating(player);
      }
      return;
    }

    if (!input.usePressed) return;

    // Flint & steel ignites TNT (before generic block interaction).
    if (itemId === 'flint_and_steel' && this.hit && getBlockDef(this.hit.id).id === 'tnt') {
      const hit = this.hit;
      this.callbacks.onIgniteTnt?.(hit.x, hit.y, hit.z);
      this.callbacks.onSound?.('tnt_primed', hit.x + 0.5, hit.y + 0.5, hit.z + 0.5);
      this.callbacks.onParticles?.('smoke', hit.x + 0.5, hit.y + 1, hit.z + 0.5);
      if (player.gameMode !== 'creative' && player.damageSelectedDurability(1)) {
        this.callbacks.onToolBroken?.('flint_and_steel');
      }
      return;
    }

    // Interactable blocks (chest/furnace/crafting table) take priority.
    if (this.hit && INTERACTIVE_BLOCKS.has(getBlockDef(this.hit.id).id)) {
      const handled = this.callbacks.onUse?.(itemId, this.hit) === true;
      if (handled) {
        this.callbacks.onSound?.('click', this.hit.x + 0.5, this.hit.y + 0.5, this.hit.z + 0.5);
        return;
      }
    }

    // Eat food while hungry.
    if (item?.food) {
      if (player.hunger < player.maxHunger) {
        this.eating = true;
        this.eatProgress = 0;
      }
      return;
    }

    // Place block items.
    if (item?.block) {
      this.placeBlock(world, player, item);
      return;
    }

    // Generic "use" for Lead (e.g. empty-hand interactions), then swing.
    const handled = this.callbacks.onUse?.(itemId, this.hit) === true;
    if (!handled) this.callbacks.onSwing?.(itemId);
  }

  private finishEating(player: Player): void {
    this.eating = false;
    this.eatProgress = 0;
    const eaten = player.eatSelected();
    if (!eaten) return;
    const eye = player.eyePosition();
    this.callbacks.onSound?.('eat', eye.x, eye.y, eye.z);
    this.callbacks.onEat?.(eaten);
  }

  private updateBow(player: Player, dt: number, input: InteractionInput): void {
    if (input.usePressed) {
      this.bowCharging = true;
      this.bowCharge = 0;
    }
    if (this.bowCharging) {
      this.bowCharge = Math.min(1, this.bowCharge + dt);
      if (input.useReleased || !input.use) this.releaseBow(player);
    }
  }

  private releaseBow(player: Player): void {
    const charge = this.bowCharge;
    this.bowCharging = false;
    this.bowCharge = 0;
    if (player.selectedItem()?.id !== 'bow') return;
    if (player.gameMode !== 'creative') {
      if (player.countItem('arrow') <= 0) {
        const eye = player.eyePosition();
        this.callbacks.onSound?.('click', eye.x, eye.y, eye.z);
        return;
      }
      player.consumeItem('arrow', 1);
      if (player.damageSelectedDurability(1)) this.callbacks.onToolBroken?.('bow');
    }
    const origin = player.eyePosition();
    this.callbacks.onSound?.('bow_shoot', origin.x, origin.y, origin.z);
    this.callbacks.onShootArrow?.(charge, origin, player.lookDirection());
  }

  private placeBlock(world: WorldView, player: Player, item: ItemDef): void {
    const result = canPlaceBlock(world, player.position, this.hit, item);
    if (!result.ok) {
      const soundX = this.hit ? this.hit.x + 0.5 : player.position.x;
      const soundY = this.hit ? this.hit.y + 0.5 : player.position.y + 1;
      const soundZ = this.hit ? this.hit.z + 0.5 : player.position.z;
      this.callbacks.onSound?.('click', soundX, soundY, soundZ);
      return;
    }
    const placed = world.setBlock(result.x, result.y, result.z, result.blockId, result.meta, 'player');
    if (!placed) return;
    const block = getBlockDef(result.blockId);
    this.callbacks.onPlace?.(this.hit, result.x, result.y, result.z, result.blockId, result.meta, item.id);
    this.callbacks.onSound?.(placeSoundFor(block.sound), result.x + 0.5, result.y + 0.5, result.z + 0.5);
    if (player.gameMode !== 'creative') player.consumeSelected(1);
  }
}
