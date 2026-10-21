/**
 * Dropped item entity: bobs/spins (renderer), despawns after five minutes,
 * respects a short pickup delay and is collected by the manager.
 */

import type { WorldView } from '../core/contracts';
import type { Vec3 } from '../core/types';
import { Entity } from './entity';

/** 5 minutes at 20 TPS. */
export const ITEM_LIFETIME_TICKS = 6000;
/** Ticks before a freshly dropped item can be picked up. */
export const ITEM_PICKUP_DELAY_TICKS = 10;
/** Player/entity reach used for item pickup. */
export const ITEM_PICKUP_RADIUS = 1.4;
/** Collision box size of a dropped item. */
export const ITEM_WIDTH = 0.25;
export const ITEM_HEIGHT = 0.25;

export interface ItemSpawnOptions {
  velocity?: Vec3;
  pickupDelay?: number;
}

export class ItemEntity extends Entity {
  readonly kind = 'item';
  readonly typeName: string;
  readonly item: string;
  count: number;
  pickupDelay: number;
  /** Set when a player/entity picked this stack up (manager removes it). */
  pickedUp = false;

  constructor(item: string, count: number, x: number, y: number, z: number, opts: ItemSpawnOptions = {}) {
    const stackCount = Math.max(1, Math.floor(count));
    super({ x, y, z, width: ITEM_WIDTH, height: ITEM_HEIGHT, health: 1 });
    this.item = item;
    this.count = stackCount;
    this.typeName = item;
    this.pickupDelay = opts.pickupDelay ?? ITEM_PICKUP_DELAY_TICKS;
    this.noGravity = false;
    if (opts.velocity) this.velocity = { ...opts.velocity };
  }

  get canPickup(): boolean {
    return this.pickupDelay <= 0 && !this.removed && this.deathTime < 0;
  }

  get despawnTicksLeft(): number {
    return Math.max(0, ITEM_LIFETIME_TICKS - this.age);
  }

  override update(dtTicks: number, world: WorldView): void {
    if (this.removed) return;
    if (this.pickupDelay > 0) this.pickupDelay = Math.max(0, this.pickupDelay - dtTicks);
    // Items lose horizontal speed quickly on the ground, slowly in the air.
    const friction = this.onGround ? 0.55 : 0.985;
    const factor = Math.pow(friction, dtTicks);
    this.velocity.x *= factor;
    this.velocity.z *= factor;
    super.update(dtTicks, world);
    if (this.age >= ITEM_LIFETIME_TICKS) {
      this.removed = true;
      this.pickedUp = false;
    }
  }
}

/** Reduce a stack by `amount`; returns how many were actually removed. */
export function consumeStack(entity: ItemEntity, amount: number): number {
  const removed = Math.max(0, Math.min(entity.count, Math.floor(amount)));
  entity.count -= removed;
  if (entity.count <= 0) entity.removed = true;
  return removed;
}

/**
 * Placeholder colour per item used when the renderer has no block texture for
 * the drop (sprite items). Covers every mob drop + common BlockDrops items.
 */
export const ITEM_DROP_COLORS: Readonly<Record<string, number>> = {
  rotten_flesh: 0x8a5a44,
  iron_ingot: 0xd8d8d8,
  bone: 0xe8e4d4,
  arrow: 0xc8b48a,
  gunpowder: 0x6a6a6a,
  string: 0xe0e0e0,
  raw_porkchop: 0xe89090,
  raw_beef: 0xc85050,
  leather: 0xa06a3a,
  raw_mutton: 0xd87878,
  raw_chicken: 0xe8b0a0,
  feather: 0xf0f0f0,
  white_wool: 0xefefef,
  flint: 0x4a4a4a,
  coal: 0x2a2a2a,
  stick: 0x8a6a3a,
  apple: 0xd84040,
  clay_ball: 0xa0b0c0,
  brick: 0xb05040,
  paper: 0xf0f0e0,
  diamond: 0x60e8e0,
  redstone: 0xd02020,
  lapis_lazuli: 0x2040c0,
  brick_item: 0xb05040,
};

export function itemDropColor(item: string): number {
  return ITEM_DROP_COLORS[item] ?? 0xbfbfbf;
}
