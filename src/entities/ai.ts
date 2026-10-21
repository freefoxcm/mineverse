/**
 * Pure AI helpers shared by the mob state machine: voxel line of sight,
 * daylight/exposure checks, state-transition decisions and deterministic
 * target picking. No state is kept here so every function is unit-testable.
 */

import type { WorldView } from '../core/contracts';
import type { Vec3 } from '../core/types';
import { IS_OPAQUE } from '../world/blocks';
import type { MobType } from './models';
import { isHostileMob } from './models';

export type MobState = 'idle' | 'wander' | 'chase' | 'attack' | 'flee' | 'hurt' | 'dead';

/** Creeper fuse length in ticks (1.5 s). */
export const CREEPER_FUSE_TICKS = 30;
/** Distance at which a creeper starts priming. */
export const CREEPER_FUSE_RANGE = 3;
/** Distance a primed creeper may run before the fuse is cancelled. */
export const CREEPER_FUSE_CANCEL_RANGE = 7;
/** Heal/attack melee reach for mobs (blocks). */
export const MELEE_REACH = 2.2;
/** Passive mobs flee for this many ticks after being hurt. */
export const FLEE_TICKS = 120;
/** How far a passive mob runs from its attacker. */
export const FLEE_DISTANCE = 10;

/**
 * Voxel line of sight using an Amanatides & Woo DDA. Opaque blocks block sight;
 * water, leaves, glass and plants do not. Returns false when the target is
 * farther away than `maxDistance`.
 */
export function hasLineOfSight(
  world: WorldView,
  from: Vec3,
  to: Vec3,
  maxDistance = 64,
): boolean {
  let dx = to.x - from.x;
  let dy = to.y - from.y;
  let dz = to.z - from.z;
  const distance = Math.sqrt(dx * dx + dy * dy + dz * dz);
  if (distance < 1e-6) return true;
  if (distance > maxDistance) return false;
  dx /= distance;
  dy /= distance;
  dz /= distance;

  const startX = Math.floor(from.x);
  const startY = Math.floor(from.y);
  const startZ = Math.floor(from.z);
  let x = startX;
  let y = startY;
  let z = startZ;

  const stepX = dx > 0 ? 1 : dx < 0 ? -1 : 0;
  const stepY = dy > 0 ? 1 : dy < 0 ? -1 : 0;
  const stepZ = dz > 0 ? 1 : dz < 0 ? -1 : 0;

  const tDeltaX = stepX !== 0 ? Math.abs(1 / dx) : Infinity;
  const tDeltaY = stepY !== 0 ? Math.abs(1 / dy) : Infinity;
  const tDeltaZ = stepZ !== 0 ? Math.abs(1 / dz) : Infinity;
  let tMaxX =
    stepX > 0 ? (startX + 1 - from.x) / dx : stepX < 0 ? (startX - from.x) / dx : Infinity;
  let tMaxY =
    stepY > 0 ? (startY + 1 - from.y) / dy : stepY < 0 ? (startY - from.y) / dy : Infinity;
  let tMaxZ =
    stepZ > 0 ? (startZ + 1 - from.z) / dz : stepZ < 0 ? (startZ - from.z) / dz : Infinity;

  let travelled = 0;
  // Bounded loop: one iteration per voxel boundary crossing.
  for (let guard = 0; guard < 512; guard++) {
    if (travelled > distance) break;
    if (!(x === startX && y === startY && z === startZ)) {
      if (IS_OPAQUE[world.getBlock(x, y, z)]) return false;
      if (travelled >= distance) break;
    }
    if (tMaxX <= tMaxY && tMaxX <= tMaxZ) {
      x += stepX;
      travelled = tMaxX;
      tMaxX += tDeltaX;
    } else if (tMaxY <= tMaxZ) {
      y += stepY;
      travelled = tMaxY;
      tMaxY += tDeltaY;
    } else {
      z += stepZ;
      travelled = tMaxZ;
      tMaxZ += tDeltaZ;
    }
  }
  return true;
}

/** True when the mob can see the target point within `range`. */
export function canSee(world: WorldView, eye: Vec3, target: Vec3, range: number): boolean {
  const dx = target.x - eye.x;
  const dy = target.y - eye.y;
  const dz = target.z - eye.z;
  if (dx * dx + dy * dy + dz * dz > range * range) return false;
  return hasLineOfSight(world, eye, target, range);
}

/** Daytime factor from WorldView.time(). 0..1; >0.5 is treated as day. */
export function daylightFactor(world: WorldView): number {
  return world.time().daylight;
}

export function isDaytime(world: WorldView): boolean {
  return daylightFactor(world) >= 0.5;
}

/**
 * True when a position is directly exposed to daylight: it is day and the sky
 * light at the eye cell is at least 12 (i.e. not under deep cover).
 */
export function isExposedToDaylight(world: WorldView, position: Vec3): boolean {
  if (!isDaytime(world)) return false;
  const x = Math.floor(position.x);
  const y = Math.floor(position.y);
  const z = Math.floor(position.z);
  return world.getSkyLight(x, y, z) >= 12;
}

/** Zombies and skeletons burn when exposed to daylight. */
export function shouldBurnInDaylight(type: MobType, world: WorldView, position: Vec3): boolean {
  if (type !== 'zombie' && type !== 'skeleton') return false;
  return isExposedToDaylight(world, position);
}

/**
 * Spiders are neutral during the day (they only attack after being hurt);
 * zombies, skeletons and creepers are always hostile; passive mobs never are.
 */
export function isHostileAt(type: MobType, world: WorldView, hurt: boolean): boolean {
  if (!isHostileMob(type)) return false;
  if (type === 'spider' && isDaytime(world) && !hurt) return false;
  return true;
}

export interface MobTargetInfo {
  distance: number;
  /** Distance ignoring Y (used for melee/reach checks). */
  horizontalDistance: number;
  visible: boolean;
  alive: boolean;
  /** Game mode allows being targeted (creative players are ignored). */
  targetable: boolean;
}

export interface MobDecisionInput {
  type: MobType;
  health: number;
  hurtTime: number;
  state: MobState;
  target: MobTargetInfo | null;
  hostileAt: boolean;
  attackCooldown: number;
  /** Remaining creeper fuse ticks (0 = not primed). */
  fuse: number;
  /** Ticks remaining in the current flee reaction. */
  fleeTicks: number;
  /** Follow range for this mob type (blocks). */
  followRange: number;
  /** Arrow/ranged attack cooldown ready flag (skeleton). */
  rangedReady?: boolean;
}

/**
 * Pure state-transition function: returns the state the mob should be in given
 * the current situation. Timers (wander/idle) are owned by the mob class; this
 * only encodes the priority rules.
 */
export function decideMobState(input: MobDecisionInput): MobState {
  if (input.health <= 0) return 'dead';
  if (input.hurtTime > 0 && input.fleeTicks <= 0 && input.fuse <= 0) return 'hurt';

  if (input.fleeTicks > 0) return 'flee';

  const target = input.target;
  const hostile = input.hostileAt;
  if (!target || !target.alive || !target.targetable) {
    return input.state === 'chase' || input.state === 'attack' ? 'wander' : input.state;
  }

  if (hostile) {
    if (input.fuse > 0) return 'attack';
    if (input.type === 'skeleton' && input.rangedReady && target.visible) return 'attack';
    if (
      target.visible &&
      target.distance <= MELEE_REACH &&
      target.horizontalDistance <= MELEE_REACH
    ) {
      return input.attackCooldown <= 0 ? 'attack' : 'chase';
    }
    if (target.visible && target.distance <= input.followRange) return 'chase';
    return input.state === 'chase' ? 'wander' : input.state;
  }

  return input.state === 'chase' || input.state === 'attack' ? 'wander' : input.state;
}

/** Deterministic random point in a horizontal disc, snapped to the block grid. */
export function pickWanderTarget(random: () => number, origin: Vec3, radius: number): Vec3 {
  const angle = random() * Math.PI * 2;
  const dist = 2 + random() * Math.max(0, radius - 2);
  return {
    x: origin.x + Math.cos(angle) * dist,
    y: origin.y,
    z: origin.z + Math.sin(angle) * dist,
  };
}

/** Deterministic point directly away from a threat, used by fleeing passives. */
export function pickFleeTarget(
  random: () => number,
  origin: Vec3,
  threat: Vec3,
  distance: number,
): Vec3 {
  let dx = origin.x - threat.x;
  let dz = origin.z - threat.z;
  const len = Math.hypot(dx, dz);
  if (len < 0.01) {
    const angle = random() * Math.PI * 2;
    dx = Math.cos(angle);
    dz = Math.sin(angle);
  } else {
    dx /= len;
    dz /= len;
  }
  const jitter = (random() - 0.5) * 0.6;
  const cos = Math.cos(jitter);
  const sin = Math.sin(jitter);
  const rx = dx * cos - dz * sin;
  const rz = dx * sin + dz * cos;
  return {
    x: origin.x + rx * distance,
    y: origin.y,
    z: origin.z + rz * distance,
  };
}

/**
 * Skeleton arrows: 2..4 damage, stronger the closer the target is (the
 * vanilla "fully charged up close" feel). Deterministic.
 */
export function skeletonArrowDamage(distance: number): number {
  if (distance <= 8) return 4;
  if (distance <= 16) return 3;
  return 2;
}

/** Normalized direction pointing from `from` to `to`. */
export function directionTo(from: Vec3, to: Vec3): Vec3 {
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  const dz = to.z - from.z;
  const len = Math.sqrt(dx * dx + dy * dy + dz * dz);
  if (len < 1e-6) return { x: 0, y: 0, z: 1 };
  return { x: dx / len, y: dy / len, z: dz / len };
}

/** Yaw in radians for a direction (matches Entity.forward: yaw 0 = +Z). */
export function yawOf(dx: number, dz: number): number {
  return Math.atan2(dx, dz);
}

/** Shortest signed angular difference a-b in radians, wrapped to [-PI, PI]. */
export function angleDifference(a: number, b: number): number {
  let diff = (a - b) % (Math.PI * 2);
  if (diff > Math.PI) diff -= Math.PI * 2;
  if (diff < -Math.PI) diff += Math.PI * 2;
  return diff;
}

/** Turn `current` toward `target` by at most `maxStep` radians. */
export function turnTowards(current: number, target: number, maxStep: number): number {
  const diff = angleDifference(target, current);
  if (Math.abs(diff) <= maxStep) return target;
  return current + Math.sign(diff) * maxStep;
}
