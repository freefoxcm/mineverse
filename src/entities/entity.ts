/**
 * Base entity: position/velocity, AABB collision, gravity, liquids, hurt with
 * invincibility frames, knockback and death timing.
 *
 * Simulation uses Minecraft-like units: positions in blocks, velocity in
 * blocks/second, and updates receive `dtTicks` (1 = one 20 TPS game tick).
 */

import type { WorldView } from '../core/contracts';
import type { Vec3 } from '../core/types';
import { FLUID_KIND, IS_COLLIDABLE } from '../world/blocks';

/** Fixed simulation step. */
export const TICK_SECONDS = 0.05;
/** 20 TPS. */
export const TICKS_PER_SECOND = 20;
/** Downward acceleration in blocks/s^2 (matches the player plan). */
export const GRAVITY = 32;
/** Maximum fall speed in blocks/s. */
export const TERMINAL_VELOCITY = 60;
/** How long the death animation lasts before the entity is removed (ticks). */
export const DEATH_ANIM_TICKS = 20;
/** Default invulnerability window after taking damage (ticks = 0.5s). */
export const HURT_TICKS = 10;
/** Height a walking entity can step/jump up in one move. */
export const STEP_HEIGHT = 1;
/** Contact epsilon for AABB-vs-voxel checks. */
const EPS = 1e-4;
/** Collision substep (blocks); keeps fast entities from tunnelling. */
const MAX_SUBSTEP = 0.08;

export interface AABB {
  minX: number;
  minY: number;
  minZ: number;
  maxX: number;
  maxY: number;
  maxZ: number;
}

export type EntityKind = 'mob' | 'item' | 'arrow';

let NEXT_ENTITY_ID = 1;

/** Test helper: make entity ids deterministic again. */
export function resetEntityIds(): void {
  NEXT_ENTITY_ID = 1;
}

export interface EntityInit {
  x: number;
  y: number;
  z: number;
  width: number;
  height: number;
  health: number;
  maxHealth?: number;
}

export abstract class Entity {
  readonly id: number;
  abstract readonly kind: EntityKind;
  /** Creature/item type name used by renderers and tests ('zombie', 'arrow'...). */
  abstract readonly typeName: string;

  position: Vec3;
  /** Position at the previous simulation tick (renderer interpolation). */
  previousPosition: Vec3;
  velocity: Vec3 = { x: 0, y: 0, z: 0 };

  yaw = 0;
  pitch = 0;
  width: number;
  height: number;
  /** Eye height above the feet. */
  eyeHeight: number;

  health: number;
  maxHealth: number;

  onGround = false;
  inWater = false;
  inLava = false;
  noGravity = false;

  /** Ticks lived. */
  age = 0;
  /** Remaining invulnerability ticks. */
  hurtTime = 0;
  maxHurtTime = HURT_TICKS;
  /** Remaining burning ticks (>0 while on fire). */
  fireTicks = 0;
  /** -1 while alive; ticks since death otherwise. */
  deathTime = -1;
  /** Set by the manager when the entity should be dropped from the world. */
  removed = false;
  /** Position of the last damage source (for knockback/AI). */
  lastHurtBy: Vec3 | null = null;
  /** Anonymous attack cooldown shared by melee/ranged logic. */
  attackCooldown = 0;
  /** Renderer walk-cycle phase in radians. */
  walkPhase = 0;
  /** Horizontal speed used to drive the walk cycle. */
  horizontalSpeed = 0;

  /** Called once when health reaches 0 (manager spawns drops/sounds here). */
  onDeath?: (entity: Entity) => void;

  constructor(init: EntityInit) {
    this.id = NEXT_ENTITY_ID++;
    this.position = { x: init.x, y: init.y, z: init.z };
    this.previousPosition = { ...this.position };
    this.width = init.width;
    this.height = init.height;
    this.health = init.health;
    this.maxHealth = init.maxHealth ?? init.health;
    this.eyeHeight = init.height * 0.85;
  }

  get isAlive(): boolean {
    return this.deathTime < 0 && !this.removed;
  }

  get isDead(): boolean {
    return this.deathTime >= 0;
  }

  get isDying(): boolean {
    return this.deathTime >= 0 && this.deathTime < DEATH_ANIM_TICKS;
  }

  get isHurt(): boolean {
    return this.hurtTime > 0;
  }

  get isOnFire(): boolean {
    return this.fireTicks > 0;
  }

  aabb(): AABB {
    const half = this.width / 2;
    return {
      minX: this.position.x - half,
      minY: this.position.y,
      minZ: this.position.z - half,
      maxX: this.position.x + half,
      maxY: this.position.y + this.height,
      maxZ: this.position.z + half,
    };
  }

  eyePosition(): Vec3 {
    return { x: this.position.x, y: this.position.y + this.eyeHeight, z: this.position.z };
  }

  /** XZ forward vector for the current yaw (yaw 0 faces +Z, like Minecraft). */
  forward(): Vec3 {
    return { x: Math.sin(this.yaw), y: 0, z: Math.cos(this.yaw) };
  }

  distanceTo(target: Vec3): number {
    const dx = this.position.x - target.x;
    const dy = this.position.y - target.y;
    const dz = this.position.z - target.z;
    return Math.sqrt(dx * dx + dy * dy + dz * dz);
  }

  distanceToSq(target: Vec3): number {
    const dx = this.position.x - target.x;
    const dy = this.position.y - target.y;
    const dz = this.position.z - target.z;
    return dx * dx + dy * dy + dz * dz;
  }

  setPosition(x: number, y: number, z: number): void {
    this.position = { x, y, z };
    this.previousPosition = { x, y, z };
  }

  /**
   * Apply damage. Returns false when the hit was rejected (invincibility,
   * already dead or zero damage). Applies knockback away from `source`.
   */
  hurt(amount: number, source: Vec3 | null = null, knockback = 4): boolean {
    if (this.deathTime >= 0 || this.removed) return false;
    if (amount <= 0) return false;
    if (this.hurtTime > 0) return false;
    this.health = Math.max(0, this.health - amount);
    this.hurtTime = this.maxHurtTime;
    this.lastHurtBy = source ? { ...source } : null;
    if (source) this.applyKnockbackFrom(source.x, source.z, knockback);
    if (this.health <= 0) this.die();
    return true;
  }

  /** Push the entity away from (fromX, fromZ). */
  applyKnockbackFrom(fromX: number, fromZ: number, strength: number, lift = 0.4): void {
    let dx = this.position.x - fromX;
    let dz = this.position.z - fromZ;
    const len = Math.hypot(dx, dz);
    if (len < 1e-6) {
      dx = 0;
      dz = 1;
    } else {
      dx /= len;
      dz /= len;
    }
    this.velocity.x += dx * strength;
    this.velocity.z += dz * strength;
    this.velocity.y = Math.max(this.velocity.y, strength * lift);
  }

  /** Add an arbitrary impulse. */
  applyImpulse(dx: number, dy: number, dz: number): void {
    this.velocity.x += dx;
    this.velocity.y += dy;
    this.velocity.z += dz;
  }

  protected die(): void {
    if (this.deathTime >= 0) return;
    this.health = 0;
    this.deathTime = 0;
    this.velocity.x = 0;
    this.velocity.z = 0;
    this.onDeath?.(this);
  }

  /** Instantly remove (no death animation); used by despawn/explosion cleanup. */
  discard(): void {
    this.removed = true;
    this.deathTime = Math.max(this.deathTime, DEATH_ANIM_TICKS);
  }

  /** Advance one simulation step (physics + timers). */
  update(dtTicks: number, world: WorldView): void {
    const dt = dtTicks * TICK_SECONDS;
    this.age += dtTicks;
    this.previousPosition = { ...this.position };

    if (this.hurtTime > 0) this.hurtTime = Math.max(0, this.hurtTime - dtTicks);
    if (this.attackCooldown > 0) this.attackCooldown = Math.max(0, this.attackCooldown - dtTicks);
    if (this.fireTicks > 0) this.fireTicks = Math.max(0, this.fireTicks - dtTicks);

    if (this.deathTime >= 0) {
      this.deathTime += dtTicks;
      if (this.deathTime >= DEATH_ANIM_TICKS) this.removed = true;
      return;
    }

    this.updateLiquidState(world);
    if (!this.noGravity) {
      this.velocity.y -= GRAVITY * dt;
      if (this.velocity.y < -TERMINAL_VELOCITY) this.velocity.y = -TERMINAL_VELOCITY;
    }
    this.applyFluidDrag(dtTicks);

    const startX = this.position.x;
    const startZ = this.position.z;
    this.onGround = false;
    this.moveAxis(world, 'y', this.velocity.y * dt);
    if (this.position.y < -32) {
      // Fell out of the world: die silently so the manager can clean up.
      this.health = 0;
      this.discard();
      return;
    }
    const intendedX = this.velocity.x * dt;
    const intendedZ = this.velocity.z * dt;
    const blockedX = this.moveAxis(world, 'x', intendedX);
    const blockedZ = this.moveAxis(world, 'z', intendedZ);
    if ((blockedX || blockedZ) && this.onGround) {
      this.tryStepUp(world, blockedX ? intendedX : 0, blockedZ ? intendedZ : 0);
    }

    if (!this.onGround) this.onGround = this.isSupported(world);
    this.updateWalkPhase(dtTicks, startX, startZ);
  }

  protected updateWalkPhase(dtTicks: number, startX: number, startZ: number): void {
    const dx = this.position.x - startX;
    const dz = this.position.z - startZ;
    const dist = Math.hypot(dx, dz);
    this.horizontalSpeed = dist / (dtTicks * TICK_SECONDS);
    this.walkPhase += dist * 6;
    if (this.walkPhase > Math.PI * 2) this.walkPhase -= Math.PI * 2;
  }

  protected updateLiquidState(world: WorldView): void {
    const bx = Math.floor(this.position.x);
    const bz = Math.floor(this.position.z);
    const feetId = world.getBlock(bx, Math.floor(this.position.y + 0.1), bz);
    const midId = world.getBlock(bx, Math.floor(this.position.y + this.height * 0.5), bz);
    const headId = world.getBlock(bx, Math.floor(this.position.y + this.height * 0.9), bz);
    const k1 = FLUID_KIND[feetId];
    const k2 = FLUID_KIND[midId];
    const k3 = FLUID_KIND[headId];
    this.inWater = k1 === 1 || k2 === 1 || k3 === 1;
    this.inLava = k1 === 2 || k2 === 2 || k3 === 2;
  }

  /** Slow down in liquids (and float up a little so mobs don't sink forever). */
  protected applyFluidDrag(dtTicks: number): void {
    if (this.inWater) {
      const factor = Math.pow(0.82, dtTicks);
      this.velocity.x *= factor;
      this.velocity.z *= factor;
      this.velocity.y *= Math.pow(0.8, dtTicks);
      this.velocity.y += 9 * dtTicks * TICK_SECONDS;
    } else if (this.inLava) {
      const factor = Math.pow(0.55, dtTicks);
      this.velocity.x *= factor;
      this.velocity.z *= factor;
      this.velocity.y *= factor;
    }
  }

  /** True when a collidable block is inside the entity AABB (or <EPS> above it). */
  protected collidesAt(world: WorldView, x: number, y: number, z: number): boolean {
    const half = this.width / 2;
    return boxCollides(world, x - half, y, z - half, x + half, y + this.height, z + half);
  }

  /**
   * Move along one axis with substepping. Returns true when the move was cut
   * short by a collision.
   */
  protected moveAxis(world: WorldView, axis: 'x' | 'y' | 'z', delta: number): boolean {
    if (delta === 0) return false;
    const steps = Math.max(1, Math.ceil(Math.abs(delta) / MAX_SUBSTEP));
    const step = delta / steps;
    const sign = Math.sign(delta);
    let blocked = false;
    for (let i = 0; i < steps; i++) {
      const nx = axis === 'x' ? this.position.x + step : this.position.x;
      const ny = axis === 'y' ? this.position.y + step : this.position.y;
      const nz = axis === 'z' ? this.position.z + step : this.position.z;
      if (this.collidesAt(world, nx, ny, nz)) {
        blocked = true;
        break;
      }
      this.position.x = nx;
      this.position.y = ny;
      this.position.z = nz;
    }
    if (blocked) {
      if (axis === 'y') {
        if (sign < 0) this.onGround = true;
        this.velocity.y = 0;
      } else if (axis === 'x') {
        this.velocity.x = 0;
      } else {
        this.velocity.z = 0;
      }
    }
    return blocked;
  }

  /** Is there a collidable block right under the feet? */
  protected isSupported(world: WorldView): boolean {
    const half = this.width / 2 - EPS;
    return boxCollides(
      world,
      this.position.x - half,
      this.position.y - 0.06,
      this.position.z - half,
      this.position.x + half,
      this.position.y - EPS,
      this.position.z + half,
    );
  }

  /**
   * Auto step/jump up a single block when a horizontal move was blocked and a
   * one-block ledge is free. `intendedX/intendedZ` replay the blocked move at
   * the raised position so the entity lands on top of the ledge instead of
   * oscillating against its side.
   */
  protected tryStepUp(world: WorldView, intendedX: number, intendedZ: number): void {
    const x = this.position.x;
    const z = this.position.z;
    const targetY = this.position.y + STEP_HEIGHT;
    if (this.collidesAt(world, x, targetY, z)) return;
    this.position.y = targetY;
    if (Math.abs(intendedX) > 1e-6) this.moveAxis(world, 'x', intendedX);
    if (Math.abs(intendedZ) > 1e-6) this.moveAxis(world, 'z', intendedZ);
    this.velocity.y = 0;
  }
}

/** AABB-vs-voxel test used by entities and the pathfinder. */
export function boxCollides(
  world: WorldView,
  minX: number,
  minY: number,
  minZ: number,
  maxX: number,
  maxY: number,
  maxZ: number,
): boolean {
  const x0 = Math.floor(minX + EPS);
  const x1 = Math.floor(maxX - EPS);
  const y0 = Math.floor(minY + EPS);
  const y1 = Math.floor(maxY - EPS);
  const z0 = Math.floor(minZ + EPS);
  const z1 = Math.floor(maxZ - EPS);
  for (let y = y0; y <= y1; y++) {
    for (let z = z0; z <= z1; z++) {
      for (let x = x0; x <= x1; x++) {
        if (IS_COLLIDABLE[world.getBlock(x, y, z)]) return true;
      }
    }
  }
  return false;
}

/** True when the two boxes intersect (touching counts as overlapping). */
export function aabbOverlap(a: AABB, b: AABB): boolean {
  return (
    a.minX <= b.maxX &&
    a.maxX >= b.minX &&
    a.minY <= b.maxY &&
    a.maxY >= b.minY &&
    a.minZ <= b.maxZ &&
    a.maxZ >= b.minZ
  );
}

/**
 * Ray vs AABB slab test. `dir` must be normalized. Returns the hit distance or
 * null when the ray misses (or only hits behind the origin).
 */
export function rayAABB(
  origin: Vec3,
  dir: Vec3,
  maxDistance: number,
  box: AABB,
): number | null {
  let tmin = 0;
  let tmax = maxDistance;
  const origins = [origin.x, origin.y, origin.z];
  const dirs = [dir.x, dir.y, dir.z];
  const mins = [box.minX, box.minY, box.minZ];
  const maxs = [box.maxX, box.maxY, box.maxZ];
  for (let i = 0; i < 3; i++) {
    const originAxis = origins[i];
    const dirAxis = dirs[i];
    const min = mins[i];
    const max = maxs[i];
    if (Math.abs(dirAxis) < 1e-8) {
      if (originAxis < min || originAxis > max) return null;
      continue;
    }
    let t1 = (min - originAxis) / dirAxis;
    let t2 = (max - originAxis) / dirAxis;
    if (t1 > t2) {
      const tmp = t1;
      t1 = t2;
      t2 = tmp;
    }
    if (t1 > tmin) tmin = t1;
    if (t2 < tmax) tmax = t2;
    if (tmin > tmax) return null;
  }
  return tmin >= 0 ? tmin : null;
}

/** Distance from a point to an AABB (0 when inside). */
export function distanceToAABB(point: Vec3, box: AABB): number {
  const dx = Math.max(box.minX - point.x, 0, point.x - box.maxX);
  const dy = Math.max(box.minY - point.y, 0, point.y - box.maxY);
  const dz = Math.max(box.minZ - point.z, 0, point.z - box.maxZ);
  return Math.sqrt(dx * dx + dy * dy + dz * dz);
}
