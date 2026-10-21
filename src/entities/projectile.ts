/**
 * Arrow projectile: ballistic flight with gravity/drag, block collision (sticks)
 * and a hit hook the manager uses against entities. Reused by both skeleton
 * archers and the player's bow.
 */

import type { WorldView } from '../core/contracts';
import type { Vec3 } from '../core/types';
import { IS_COLLIDABLE } from '../world/blocks';
import { Entity } from './entity';

/** Downward acceleration in blocks/s^2 (vanilla arrows: 0.05 blocks/tick²). */
export const ARROW_GRAVITY = 20;
/** Per-tick velocity retention. */
export const ARROW_DRAG = 0.99;
/** 30 seconds until a flying/stuck arrow disappears. */
export const ARROW_LIFETIME_TICKS = 600;
/** Collision sweep step in blocks. */
const ARROW_STEP = 0.18;

export interface ArrowSpawnOptions {
  speed?: number;
  damage?: number;
  /** Entity id that fired the arrow (ignored for the first few ticks). */
  ownerId?: number;
}

export interface ArrowBlockHit {
  x: number;
  y: number;
  z: number;
  id: number;
}

export class Arrow extends Entity {
  readonly kind = 'arrow';
  readonly typeName = 'arrow';
  ownerId: number;
  /** Damage before distance falloff, in half-hearts. */
  baseDamage: number;
  traveled = 0;
  stuck = false;
  stuckTicks = 0;
  /** Block the arrow stuck into (null while flying). */
  blockHit: ArrowBlockHit | null = null;

  constructor(origin: Vec3, direction: Vec3, options: ArrowSpawnOptions = {}) {
    super({
      x: origin.x,
      y: origin.y,
      z: origin.z,
      width: 0.12,
      height: 0.12,
      health: 1,
    });
    this.ownerId = options.ownerId ?? 0;
    this.baseDamage = options.damage ?? 2;
    const speed = options.speed ?? 40;
    const len = Math.hypot(direction.x, direction.y, direction.z) || 1;
    this.velocity = {
      x: (direction.x / len) * speed,
      y: (direction.y / len) * speed,
      z: (direction.z / len) * speed,
    };
    this.noGravity = true;
    this.updateOrientation();
  }

  get speed(): number {
    return Math.hypot(this.velocity.x, this.velocity.y, this.velocity.z);
  }

  /** Damage after distance falloff: a long shot hits softer (min 1). */
  get damage(): number {
    const falloff = Math.max(0.35, 1 - this.traveled / 160);
    return Math.max(1, Math.round(this.baseDamage * falloff));
  }

  /** Axis aligned box around the arrow tip used for entity hit tests. */
  tipBox(): { minX: number; minY: number; minZ: number; maxX: number; maxY: number; maxZ: number } {
    const r = 0.18;
    return {
      minX: this.position.x - r,
      minY: this.position.y - r,
      minZ: this.position.z - r,
      maxX: this.position.x + r,
      maxY: this.position.y + r,
      maxZ: this.position.z + r,
    };
  }

  override update(dtTicks: number, world: WorldView): void {
    if (this.removed) return;
    const dt = dtTicks * 0.05;
    this.age += dtTicks;
    this.previousPosition = { ...this.position };

    if (this.stuck) {
      this.stuckTicks += dtTicks;
      this.updateOrientation();
      if (this.stuckTicks >= ARROW_LIFETIME_TICKS) this.removed = true;
      return;
    }

    if (this.age >= ARROW_LIFETIME_TICKS) {
      this.removed = true;
      return;
    }

    this.velocity.y -= ARROW_GRAVITY * dt;
    const drag = Math.pow(ARROW_DRAG, dtTicks);
    this.velocity.x *= drag;
    this.velocity.y *= drag;
    this.velocity.z *= drag;

    let moveX = this.velocity.x * dt;
    let moveY = this.velocity.y * dt;
    let moveZ = this.velocity.z * dt;
    const totalLength = Math.hypot(moveX, moveY, moveZ);
    if (totalLength < 1e-6) return;
    const steps = Math.max(1, Math.ceil(totalLength / ARROW_STEP));
    const stepX = moveX / steps;
    const stepY = moveY / steps;
    const stepZ = moveZ / steps;
    for (let i = 0; i < steps; i++) {
      this.position.x += stepX;
      this.position.y += stepY;
      this.position.z += stepZ;
      this.traveled += totalLength / steps;
      const bx = Math.floor(this.position.x);
      const by = Math.floor(this.position.y);
      const bz = Math.floor(this.position.z);
      const id = world.getBlock(bx, by, bz);
      if (IS_COLLIDABLE[id]) {
        // Back off to the previous sub-step so the arrow pokes out of the wall.
        this.position.x -= stepX;
        this.position.y -= stepY;
        this.position.z -= stepZ;
        this.stuck = true;
        this.blockHit = { x: bx, y: by, z: bz, id };
        this.velocity = { x: 0, y: 0, z: 0 };
        this.updateOrientation();
        return;
      }
    }
    this.updateOrientation();
  }

  /** Yaw/pitch used by the renderer when velocity is zero (stuck arrows). */
  updateOrientation(): void {
    const horizontal = Math.hypot(this.velocity.x, this.velocity.z);
    if (horizontal + Math.abs(this.velocity.y) < 1e-4) return;
    this.yaw = Math.atan2(this.velocity.x, this.velocity.z);
    this.pitch = Math.atan2(-this.velocity.y, horizontal);
  }

  /** Called by the manager when the arrow hits an entity. */
  stickIntoEntity(): void {
    this.stuck = true;
    this.velocity = { x: 0, y: 0, z: 0 };
    this.removed = true;
  }
}

/** Build an arrow travelling along `direction` (not necessarily normalized). */
export function createArrow(origin: Vec3, direction: Vec3, options?: ArrowSpawnOptions): Arrow {
  return new Arrow(origin, direction, options);
}

/**
 * Player bow arrow: `charge` 0..1 maps to speed 20..60 blocks/s and
 * 2..9 damage, matching the vanilla "full charge hurts a lot" feel.
 */
export function createBowArrow(
  eye: Vec3,
  direction: Vec3,
  charge: number,
  ownerId = 0,
): Arrow {
  const t = Math.max(0, Math.min(1, charge));
  const speed = 20 + t * 40;
  const damage = Math.round(2 + t * 7);
  return new Arrow(eye, direction, { speed, damage, ownerId });
}
