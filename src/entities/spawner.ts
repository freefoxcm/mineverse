/**
 * Mob spawning rules: hostile mobs spawn 24–48 m from the player on dark solid
 * ground (effective light ≤ 7), passive mobs spawn on grass with light ≥ 9.
 * Caps: 24 hostile / 12 passive. Everything beyond 128 m despawns.
 *
 * All randomness comes from the injected `random()` so worlds are
 * reproducible and tests are deterministic.
 */

import { TICKS_PER_DAY } from '../core/config';
import type { WorldView } from '../core/contracts';
import type { Difficulty, Vec3 } from '../core/types';
import { BLOCK, FLUID_KIND, getBlockDef } from '../world/blocks';
import { canStandAt } from './pathfinding';
import { HOSTILE_MOBS, isHostileMob, PASSIVE_MOBS, type MobType } from './models';

export const HOSTILE_CAP = 24;
export const PASSIVE_CAP = 12;
export const MIN_SPAWN_DISTANCE = 24;
export const MAX_SPAWN_DISTANCE = 48;
export const DESPAWN_DISTANCE = 128;
export const HOSTILE_LIGHT_MAX = 7;
export const PASSIVE_LIGHT_MIN = 9;

/** Spawn attempt rate per spawn cycle (a cycle runs every 20 ticks). */
export const HOSTILE_ATTEMPTS = 8;
export const PASSIVE_ATTEMPTS = 4;

export interface SpawnerOptions {
  hostileCap?: number;
  passiveCap?: number;
  minDistance?: number;
  maxDistance?: number;
  despawnDistance?: number;
  hostileLightMax?: number;
  passiveLightMin?: number;
  hostileAttempts?: number;
  passiveAttempts?: number;
}

export interface SpawnerContext {
  world: WorldView;
  playerPosition: Vec3;
  difficulty: Difficulty;
  hostileCount: number;
  passiveCount: number;
  /** Deterministic random in [0,1). */
  random: () => number;
}

export interface SpawnPlan {
  type: MobType;
  position: Vec3;
}

export interface SpawnTickResult {
  hostile: SpawnPlan | null;
  passive: SpawnPlan | null;
}

/** Difficulty multiplier for spawn attempt count (peaceful = no hostiles). */
export function difficultySpawnMultiplier(difficulty: Difficulty): number {
  switch (difficulty) {
    case 'peaceful':
      return 0;
    case 'easy':
      return 0.5;
    case 'normal':
      return 1;
    case 'hard':
      return 1.5;
  }
}

/** Effective light level: block light or skylight scaled by daylight. */
export function effectiveLightLevel(world: WorldView, x: number, y: number, z: number): number {
  const sky = world.getSkyLight(x, y, z);
  const block = world.getBlockLight(x, y, z);
  const daylight = world.time().daylight;
  return Math.max(block, Math.floor(sky * daylight));
}

/** True when a hostile mob may spawn with its feet at (x, y, z). */
export function canSpawnHostileAt(
  world: WorldView,
  x: number,
  y: number,
  z: number,
  lightMax = HOSTILE_LIGHT_MAX,
): boolean {
  if (!canStandAt(world, x, y, z, { bodyHeight: 2, avoidLiquids: true })) return false;
  const ground = world.getBlock(x, y - 1, z);
  if (FLUID_KIND[ground] !== 0) return false;
  return effectiveLightLevel(world, x, y, z) <= lightMax;
}

/** True when a passive mob may spawn with its feet at (x, y, z) on grass. */
export function canSpawnPassiveAt(
  world: WorldView,
  x: number,
  y: number,
  z: number,
  lightMin = PASSIVE_LIGHT_MIN,
): boolean {
  if (!canStandAt(world, x, y, z, { bodyHeight: 2, avoidLiquids: true })) return false;
  if (world.getBlock(x, y - 1, z) !== BLOCK.grass_block) return false;
  return effectiveLightLevel(world, x, y, z) >= lightMin;
}

export class Spawner {
  readonly hostileCap: number;
  readonly passiveCap: number;
  readonly minDistance: number;
  readonly maxDistance: number;
  readonly despawnDistance: number;
  readonly hostileLightMax: number;
  readonly passiveLightMin: number;
  readonly hostileAttempts: number;
  readonly passiveAttempts: number;
  /** Cycles run so far (manager raises this every 20 ticks). */
  cycles = 0;

  constructor(options: SpawnerOptions = {}) {
    this.hostileCap = options.hostileCap ?? HOSTILE_CAP;
    this.passiveCap = options.passiveCap ?? PASSIVE_CAP;
    this.minDistance = options.minDistance ?? MIN_SPAWN_DISTANCE;
    this.maxDistance = options.maxDistance ?? MAX_SPAWN_DISTANCE;
    this.despawnDistance = options.despawnDistance ?? DESPAWN_DISTANCE;
    this.hostileLightMax = options.hostileLightMax ?? HOSTILE_LIGHT_MAX;
    this.passiveLightMin = options.passiveLightMin ?? PASSIVE_LIGHT_MIN;
    this.hostileAttempts = options.hostileAttempts ?? HOSTILE_ATTEMPTS;
    this.passiveAttempts = options.passiveAttempts ?? PASSIVE_ATTEMPTS;
  }

  /** Attempt both hostile and passive spawns for one cycle. */
  tick(ctx: SpawnerContext): SpawnTickResult {
    this.cycles++;
    const result: SpawnTickResult = { hostile: null, passive: null };
    const multiplier = difficultySpawnMultiplier(ctx.difficulty);
    if (ctx.hostileCount < this.hostileCap && multiplier > 0) {
      const attempts = Math.max(1, Math.round(this.hostileAttempts * multiplier));
      result.hostile = this.trySpawnHostile(ctx, attempts);
    }
    if (ctx.passiveCount < this.passiveCap) {
      result.passive = this.trySpawnPassive(ctx, this.passiveAttempts);
    }
    return result;
  }

  trySpawnHostile(ctx: SpawnerContext, attempts = this.hostileAttempts): SpawnPlan | null {
    for (let i = 0; i < attempts; i++) {
      const point = randomRingPoint(ctx.random, ctx.playerPosition, this.minDistance, this.maxDistance);
      const location = findHostileSpawn(ctx.world, point.x, point.z, this.hostileLightMax);
      if (!location) continue;
      const type = pickMobType(ctx.random, HOSTILE_MOBS);
      return {
        type,
        position: { x: point.x + 0.5, y: location.y, z: point.z + 0.5 },
      };
    }
    return null;
  }

  trySpawnPassive(ctx: SpawnerContext, attempts = this.passiveAttempts): SpawnPlan | null {
    for (let i = 0; i < attempts; i++) {
      const point = randomRingPoint(ctx.random, ctx.playerPosition, this.minDistance, this.maxDistance);
      const surface = ctx.world.spawnY(point.x, point.z);
      if (!canSpawnPassiveAt(ctx.world, point.x, surface, point.z, this.passiveLightMin)) continue;
      const type = pickMobType(ctx.random, PASSIVE_MOBS);
      return {
        type,
        position: { x: point.x + 0.5, y: surface, z: point.z + 0.5 },
      };
    }
    return null;
  }

  /** 128 m rule: mobs past the despawn radius vanish (hostiles instantly). */
  shouldDespawn(
    type: MobType,
    position: Vec3,
    playerPosition: Vec3,
    difficulty: Difficulty = 'normal',
  ): boolean {
    const dx = position.x - playerPosition.x;
    const dy = position.y - playerPosition.y;
    const dz = position.z - playerPosition.z;
    const distanceSq = dx * dx + dy * dy + dz * dz;
    if (distanceSq > this.despawnDistance * this.despawnDistance) return true;
    // Peaceful removes hostile mobs immediately; passive animals stay.
    if (difficulty === 'peaceful' && isHostileMob(type)) return true;
    return false;
  }

  /** True when the player/tick context still allows hostiles (used by manager). */
  isHostileAllowed(difficulty: Difficulty): boolean {
    return difficulty !== 'peaceful';
  }

  /** Day fraction helper for ambient logic: 0 = sunrise, 0.5 = sunset. */
  timeOfDayFraction(world: WorldView): number {
    return (world.time().ticks % TICKS_PER_DAY) / TICKS_PER_DAY;
  }
}

/** Deterministic random point in the ring [minDistance, maxDistance] around origin. */
export function randomRingPoint(
  random: () => number,
  origin: Vec3,
  minDistance: number,
  maxDistance: number,
): { x: number; z: number } {
  const angle = random() * Math.PI * 2;
  const distance = minDistance + random() * Math.max(0, maxDistance - minDistance);
  return {
    x: Math.floor(origin.x + Math.cos(angle) * distance),
    z: Math.floor(origin.z + Math.sin(angle) * distance),
  };
}

/** Pick a mob type from a pool, clamping hostile random sources to [0, len). */
function pickMobType(random: () => number, pool: readonly MobType[]): MobType {
  const index = Math.min(pool.length - 1, Math.max(0, Math.floor(random() * pool.length)));
  return pool[index];
}

/**
 * Find a standable hostile spawn Y near the surface: first the surface, then up
 * to `maxDepth` blocks down for dark caves/pockets.
 */
export function findHostileSpawn(
  world: WorldView,
  x: number,
  z: number,
  lightMax = HOSTILE_LIGHT_MAX,
  maxDepth = 24,
): { y: number } | null {
  const cx = Math.floor(x / 16);
  const cz = Math.floor(z / 16);
  if (!world.isChunkLoaded(cx, cz)) return null;
  const surface = world.spawnY(x, z);
  for (let depth = 0; depth <= maxDepth; depth++) {
    const y = surface - depth;
    if (y <= 1) break;
    if (canSpawnHostileAt(world, x, y, z, lightMax)) return { y };
  }
  return null;
}

/** Check that a candidate block id can be spawned on (solid, not liquid). */
export function isSolidSpawnFloor(id: number): boolean {
  return FLUID_KIND[id] === 0 && getBlockDef(id).collidable;
}
