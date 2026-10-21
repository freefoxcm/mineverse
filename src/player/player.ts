/**
 * The local player: movement physics state, camera, survival stats, inventory
 * slots and the save-facing fields Lead's `save` module reads.
 *
 * Pure simulation lives in `physics.ts`; this class owns identity/state plus
 * survival bookkeeping (fall damage, hunger, air, armor). It never imports the
 * renderer, DOM or `main.ts`, so it can be unit-tested headless.
 */

import { MOUSE_SENSITIVITY_BASE, clamp } from '../core/math';
import type { PlayerView } from '../core/contracts';
import { EMPTY_SLOT, type GameMode, type Slot, type Vec3 } from '../core/types';
import { armorPoints, getItem, itemMaxStack, type ItemDef } from '../world/items';
import {
  TICK_SECONDS,
  eyeHeightFor,
  isEyeInFluid,
  lookDirection,
  stepPhysics,
  type BlockWorld,
  type MovementInput,
  type PhysicsBodyState,
} from './physics';

// ---------------------------------------------------------------------------
// Survival / presentation constants
// ---------------------------------------------------------------------------

export const MAX_HEALTH = 20;
export const MAX_HUNGER = 20;
export const MAX_AIR_TICKS = 300;
export const INVULNERABLE_TICKS = 10; // 0.5 s at 20 TPS
export const ARMOR_REDUCTION_PER_POINT = 0.04;
export const MAX_ARMOR_REDUCTION = 0.8;
export const BASE_FOV = 70;
export const SPRINT_FOV_BONUS = 8;
export const WATER_FOV_PENALTY = 4;
export const HOTBAR_SIZE = 9;
export const INVENTORY_SIZE = 36;
export const ARMOR_SIZE = 4;

export interface PlayerInput extends MovementInput {
  /** Edge from a double tap of Space; toggles creative flight. */
  toggleFly?: boolean;
}

export interface PlayerOptions {
  gameMode?: GameMode;
  position?: Vec3;
  yaw?: number;
  pitch?: number;
  health?: number;
  hunger?: number;
  saturation?: number;
  air?: number;
  inventory?: Slot[];
  armor?: Slot[];
  selectedSlot?: number;
  baseFov?: number;
  sensitivity?: number;
}

/** Structural camera interface satisfied by THREE.PerspectiveCamera. */
export interface CameraLike {
  position: { set(x: number, y: number, z: number): void };
  rotation: { set(x: number, y: number, z: number): void };
  fov?: number;
  updateProjectionMatrix?: () => void;
}

export interface DamageOptions {
  cause?: string;
  /** Set false for fall/drowning damage which ignores armor points. */
  armor?: boolean;
  ignoreInvulnerable?: boolean;
}

export interface EatResult {
  item: string;
  hunger: number;
  saturation: number;
}

export interface PlayerAnimationState {
  moving: boolean;
  sprinting: boolean;
  sneaking: boolean;
  onGround: boolean;
  inWater: boolean;
  flying: boolean;
  horizontalSpeed: number;
}

/** Serialised player fields for Lead's save v1 (`meta/player/...`). */
export interface PlayerSaveData {
  position: Vec3;
  yaw: number;
  pitch: number;
  health: number;
  hunger: number;
  saturation: number;
  air: number;
  gameMode: GameMode;
  inventory: Slot[];
  armor: Slot[];
  selectedSlot: number;
  flying?: boolean;
}

function cloneSlots(slots: Slot[] | undefined, size: number): Slot[] {
  const result: Slot[] = [];
  for (let i = 0; i < size; i++) {
    const source = slots?.[i];
    result.push(source ? { ...source } : { ...EMPTY_SLOT });
  }
  return result;
}

/** Maximum durability for an item stack, or 0 when it is not damageable. */
export function maxDurabilityOf(itemId: string | null): number {
  if (!itemId) return 0;
  const def = getItem(itemId);
  return def?.tool?.durability ?? def?.armor?.durability ?? 0;
}

export class Player implements PlayerView {
  // Save-facing fields (Lead's save v1 reads these).
  position: Vec3;
  velocity: Vec3 = { x: 0, y: 0, z: 0 };
  yaw: number;
  pitch: number;
  health: number;
  hunger: number;
  saturation: number;
  air: number;
  gameMode: GameMode;
  inventory: Slot[];
  armor: Slot[];
  selectedSlot: number;

  // Physics state surfaced to other systems.
  onGround = false;
  inWater = false;
  inLava = false;
  sprinting = false;
  sneaking = false;
  flying = false;
  fallDistance = 0;
  /** Fall damage applied by the most recent update (0 when none). */
  lastFallDamage = 0;
  /** Whether the eye is currently submerged (renderer/underwater overlay). */
  eyeInWater = false;
  eyeInLava = false;
  dead = false;
  healthFlash = 0;

  maxHealth = MAX_HEALTH;
  maxHunger = MAX_HUNGER;
  maxAir = MAX_AIR_TICKS;

  // Presentation.
  baseFov: number;
  fov: number;
  sensitivity: number;
  horizontalSpeed = 0;

  /** Movement input reused when callers do not pass one to update(). */
  readonly input: PlayerInput = {
    forward: 0,
    strafe: 0,
    jump: false,
    jumpPressed: false,
    sneak: false,
    sprint: false,
    flyVertical: 0,
    toggleFly: false,
  };

  private ticks = 0;
  private invulnerableTicks = 0;
  private exhaustion = 0;
  private regenTimer = 0;
  private starveTimer = 0;
  private airDamageTimer = 0;
  private lavaDamageTimer = 0;

  constructor(options: PlayerOptions = {}) {
    this.position = { ...(options.position ?? { x: 0.5, y: 80, z: 0.5 }) };
    this.yaw = options.yaw ?? 0;
    this.pitch = options.pitch ?? 0;
    this.gameMode = options.gameMode ?? 'survival';
    this.health = options.health ?? MAX_HEALTH;
    this.hunger = options.hunger ?? MAX_HUNGER;
    this.saturation = options.saturation ?? 5;
    this.air = options.air ?? MAX_AIR_TICKS;
    this.inventory = cloneSlots(options.inventory, INVENTORY_SIZE);
    this.armor = cloneSlots(options.armor, ARMOR_SIZE);
    this.selectedSlot = clamp(options.selectedSlot ?? 0, 0, HOTBAR_SIZE - 1);
    this.baseFov = options.baseFov ?? BASE_FOV;
    this.fov = this.baseFov;
    this.sensitivity = options.sensitivity ?? 1;
  }

  // -------------------------------------------------------------------------
  // Simulation
  // -------------------------------------------------------------------------

  /**
   * Advance one or more fixed ticks. Lead calls `player.update(dtTicks, world)`
   * after copying the frame's input into `player.input` (or passes it here).
   */
  update(dtTicks: number, world: BlockWorld, input: PlayerInput = this.input): void {
    const ticks = clamp(dtTicks, 0, 5);
    if (ticks <= 0 || this.dead) return;
    const dtSeconds = ticks * TICK_SECONDS;
    this.input.forward = input.forward;
    this.input.strafe = input.strafe;
    this.input.jump = input.jump;
    this.input.jumpPressed = input.jumpPressed;
    this.input.sneak = input.sneak;
    this.input.sprint = input.sprint;
    this.input.flyVertical = input.flyVertical;
    this.input.toggleFly = input.toggleFly;

    if (input.toggleFly && this.gameMode === 'creative') this.flying = !this.flying;
    if (this.gameMode !== 'creative') this.flying = false;

    const state: PhysicsBodyState = {
      position: this.position,
      velocity: this.velocity,
      yaw: this.yaw,
      onGround: this.onGround,
      inWater: this.inWater,
      inLava: this.inLava,
      fallDistance: this.fallDistance,
      flying: this.flying,
      sprinting: this.sprinting,
      sneaking: this.sneaking,
      gameMode: this.gameMode,
    };
    const result = stepPhysics(world, state, input, dtSeconds);

    this.position = result.position;
    this.velocity = result.velocity;
    this.onGround = result.onGround;
    this.inWater = result.inWater;
    this.inLava = result.inLava;
    this.fallDistance = result.fallDistance;
    this.sprinting = result.sprinting;
    this.sneaking = result.sneaking;
    if (result.landedFallDamage > 0) {
      this.lastFallDamage = result.landedFallDamage;
      this.damage(result.landedFallDamage, { cause: 'fall', armor: false });
    }

    this.ticks += ticks;
    this.horizontalSpeed = Math.hypot(this.velocity.x, this.velocity.z);
    this.updateSurvival(world, ticks);
    this.updateFov(dtSeconds);
    // One-shot edges must not be re-applied when update() reuses this.input.
    this.input.jumpPressed = false;
    this.input.toggleFly = false;
  }

  private updateSurvival(world: BlockWorld, ticks: number): void {
    this.invulnerableTicks = Math.max(0, this.invulnerableTicks - ticks);
    this.healthFlash = Math.max(0, this.healthFlash - ticks * TICK_SECONDS);

    // Exhaustion: sprinting and jumping burn food.
    if (this.sprinting) this.exhaustion += 0.4 * ticks * TICK_SECONDS;
    if (this.exhaustion >= 4) {
      this.exhaustion -= 4;
      if (this.saturation > 0) this.saturation = Math.max(0, this.saturation - 1);
      else if (this.hunger > 0) this.hunger--;
    }

    // Slow regeneration while well fed.
    if (this.hunger >= 18 && this.health < this.maxHealth && !this.dead) {
      this.regenTimer += ticks;
      if (this.regenTimer >= 80) {
        this.regenTimer = 0;
        this.health = Math.min(this.maxHealth, this.health + 1);
      }
    } else {
      this.regenTimer = 0;
    }

    // Starvation.
    if (this.hunger <= 0) {
      this.starveTimer += ticks;
      if (this.starveTimer >= 80) {
        this.starveTimer = 0;
        this.damage(1, { cause: 'starve', armor: false, ignoreInvulnerable: true });
      }
    } else {
      this.starveTimer = 0;
    }

    // Air / drowning (eye position determines the HUD bubbles).
    const eyeFluid = isEyeInFluid(world, this.position, this.eyeHeight());
    this.eyeInWater = eyeFluid === 'water';
    this.eyeInLava = eyeFluid === 'lava';
    if (this.eyeInWater) {
      this.air = Math.max(0, this.air - ticks);
      if (this.air <= 0) {
        this.airDamageTimer += ticks;
        if (this.airDamageTimer >= 20) {
          this.airDamageTimer = 0;
          this.damage(1, { cause: 'drown', armor: false, ignoreInvulnerable: true });
        }
      }
    } else {
      this.air = Math.min(this.maxAir, this.air + 4 * ticks);
      this.airDamageTimer = 0;
    }

    // Lava burns: 4 half-hearts every 0.5 s (MC-like).
    if (this.inLava) {
      this.lavaDamageTimer += ticks;
      if (this.lavaDamageTimer >= 10) {
        this.lavaDamageTimer = 0;
        this.damage(4, { cause: 'lava', ignoreInvulnerable: true });
      }
    } else {
      this.lavaDamageTimer = 0;
    }
  }

  private updateFov(dtSeconds: number): void {
    let target = this.baseFov;
    if (this.sprinting) target += SPRINT_FOV_BONUS;
    if (this.inWater || this.eyeInWater) target -= WATER_FOV_PENALTY;
    if (this.flying) target += 2;
    const blend = Math.min(1, dtSeconds * 10);
    this.fov += (target - this.fov) * blend;
  }

  // -------------------------------------------------------------------------
  // Camera / look
  // -------------------------------------------------------------------------

  /** Apply mouse movement in pixels (sensitivity relative to the base). */
  look(deltaPixelsX: number, deltaPixelsY: number, sensitivity = this.sensitivity): void {
    this.yaw -= deltaPixelsX * MOUSE_SENSITIVITY_BASE * sensitivity;
    this.pitch -= deltaPixelsY * MOUSE_SENSITIVITY_BASE * sensitivity;
    this.pitch = clamp(this.pitch, -Math.PI / 2 + 0.001, Math.PI / 2 - 0.001);
  }

  setLook(yaw: number, pitch: number): void {
    this.yaw = yaw;
    this.pitch = clamp(pitch, -Math.PI / 2 + 0.001, Math.PI / 2 - 0.001);
  }

  eyeHeight(): number {
    return eyeHeightFor(this.sneaking);
  }

  eyePosition(): Vec3 {
    return { x: this.position.x, y: this.position.y + this.eyeHeight(), z: this.position.z };
  }

  lookDirection(): Vec3 {
    return lookDirection(this.yaw, this.pitch);
  }

  /** Copy position/rotation/fov into Lead's THREE.PerspectiveCamera. */
  applyCamera(camera: CameraLike): void {
    const eye = this.eyePosition();
    camera.position.set(eye.x, eye.y, eye.z);
    camera.rotation.set(this.pitch, this.yaw, 0);
    if (typeof camera.fov === 'number' && Math.abs(camera.fov - this.fov) > 0.001) {
      camera.fov = this.fov;
      camera.updateProjectionMatrix?.();
    }
  }

  // -------------------------------------------------------------------------
  // Inventory helpers (UI-C's full Inventory class can replace this later)
  // -------------------------------------------------------------------------

  selectedStack(): Slot | null {
    const slot = this.inventory[this.selectedSlot];
    return slot && slot.item ? slot : null;
  }

  selectedItem(): ItemDef | null {
    const stack = this.selectedStack();
    return stack?.item ? (getItem(stack.item) ?? null) : null;
  }

  setSelectedSlot(index: number): void {
    this.selectedSlot = clamp(Math.floor(index), 0, HOTBAR_SIZE - 1);
  }

  /** Consume from the selected stack. Returns false when empty. */
  consumeSelected(count = 1): boolean {
    const stack = this.selectedStack();
    if (!stack) return false;
    if (stack.count < count) return false;
    stack.count -= count;
    if (stack.count <= 0) {
      const index = this.selectedSlot;
      this.inventory[index] = { ...EMPTY_SLOT };
    }
    return true;
  }

  /**
   * Damage the selected tool by `amount`. Returns true when the tool broke and
   * was removed from the inventory.
   */
  damageSelectedDurability(amount = 1): boolean {
    const stack = this.selectedStack();
    if (!stack?.item) return false;
    const max = maxDurabilityOf(stack.item);
    if (max <= 0) return false;
    const current = stack.durability ?? max;
    const next = current - amount;
    if (next <= 0) {
      this.inventory[this.selectedSlot] = { ...EMPTY_SLOT };
      return true;
    }
    stack.durability = next;
    return false;
  }

  addItem(itemId: string, count = 1, durability?: number): number {
    const def = getItem(itemId);
    const maxStack = def ? itemMaxStack(itemId) : count;
    let remaining = count;
    for (const slot of this.inventory) {
      if (remaining <= 0) break;
      if (slot.item !== itemId || (durability !== undefined && slot.durability !== durability)) continue;
      const space = maxStack - slot.count;
      if (space <= 0) continue;
      const moved = Math.min(space, remaining);
      slot.count += moved;
      remaining -= moved;
    }
    for (let i = 0; i < this.inventory.length && remaining > 0; i++) {
      const slot = this.inventory[i];
      if (slot.item) continue;
      const moved = Math.min(maxStack, remaining);
      this.inventory[i] = durability === undefined
        ? { item: itemId, count: moved }
        : { item: itemId, count: moved, durability };
      remaining -= moved;
    }
    return remaining;
  }

  countItem(itemId: string): number {
    let total = 0;
    for (const slot of this.inventory) if (slot.item === itemId) total += slot.count;
    return total;
  }

  /** Remove `count` of an item across the inventory. Returns false if missing. */
  consumeItem(itemId: string, count = 1): boolean {
    if (this.countItem(itemId) < count) return false;
    let remaining = count;
    for (let i = 0; i < this.inventory.length && remaining > 0; i++) {
      const slot = this.inventory[i];
      if (slot.item !== itemId) continue;
      const taken = Math.min(slot.count, remaining);
      slot.count -= taken;
      remaining -= taken;
      if (slot.count <= 0) this.inventory[i] = { ...EMPTY_SLOT };
    }
    return true;
  }

  armorPoints(): number {
    return armorPoints(this.armor.map((slot) => slot.item));
  }

  // -------------------------------------------------------------------------
  // Survival actions used by interaction.ts
  // -------------------------------------------------------------------------

  /** Eat the selected food if hungry. Returns what was eaten (or null). */
  eatSelected(): EatResult | null {
    const def = this.selectedItem();
    if (!def?.food) return null;
    if (this.hunger >= this.maxHunger) return null;
    const eaten = def.food;
    this.hunger = Math.min(this.maxHunger, this.hunger + eaten.hunger);
    this.saturation = Math.min(this.hunger, this.saturation + eaten.saturation);
    this.consumeSelected(1);
    return { item: def.id, hunger: this.hunger, saturation: this.saturation };
  }

  addExhaustion(amount: number): void {
    this.exhaustion += Math.max(0, amount);
  }

  damage(amount: number, options: DamageOptions = {}): boolean {
    if (this.dead || this.gameMode === 'creative' || amount <= 0) return false;
    if (this.invulnerableTicks > 0 && !options.ignoreInvulnerable) return false;
    let damage = amount;
    if (options.armor !== false) {
      const reduction = Math.min(MAX_ARMOR_REDUCTION, this.armorPoints() * ARMOR_REDUCTION_PER_POINT);
      damage *= 1 - reduction;
    }
    damage = Math.round(damage * 2) / 2;
    this.health = Math.max(0, this.health - damage);
    this.invulnerableTicks = INVULNERABLE_TICKS;
    this.healthFlash = 0.4;
    if (this.health <= 0) {
      this.health = 0;
      this.dead = true;
    }
    return true;
  }

  heal(amount: number): void {
    if (this.dead || amount <= 0) return;
    this.health = Math.min(this.maxHealth, this.health + amount);
  }

  setGameMode(mode: GameMode): void {
    this.gameMode = mode;
    if (mode !== 'creative') this.flying = false;
  }

  toggleFly(): boolean {
    if (this.gameMode !== 'creative') return false;
    this.flying = !this.flying;
    return this.flying;
  }

  respawn(position: Vec3): void {
    this.position = { ...position };
    this.velocity = { x: 0, y: 0, z: 0 };
    this.health = this.maxHealth;
    this.hunger = this.maxHunger;
    this.saturation = 5;
    this.air = this.maxAir;
    this.fallDistance = 0;
    this.dead = false;
    this.flying = false;
    this.lastFallDamage = 0;
  }

  animationState(): PlayerAnimationState {
    return {
      moving: this.horizontalSpeed > 0.2,
      sprinting: this.sprinting,
      sneaking: this.sneaking,
      onGround: this.onGround,
      inWater: this.inWater,
      flying: this.flying,
      horizontalSpeed: this.horizontalSpeed,
    };
  }

  /** Air bubbles 0..10 for the HUD (300 ticks = 10 bubbles). */
  get airBubbles(): number {
    return Math.ceil(this.air / 30);
  }

  /** Copy the save v1 player fields (Lead's save module serialises this). */
  toSaveData(): PlayerSaveData {
    return {
      position: { ...this.position },
      yaw: this.yaw,
      pitch: this.pitch,
      health: this.health,
      hunger: this.hunger,
      saturation: this.saturation,
      air: this.air,
      gameMode: this.gameMode,
      inventory: this.inventory.map((slot) => ({ ...slot })),
      armor: this.armor.map((slot) => ({ ...slot })),
      selectedSlot: this.selectedSlot,
      flying: this.flying,
    };
  }

  /** Restore a player from save v1 data. */
  static fromSaveData(data: PlayerSaveData): Player {
    const player = new Player({
      position: data.position,
      yaw: data.yaw,
      pitch: data.pitch,
      health: data.health,
      hunger: data.hunger,
      saturation: data.saturation,
      air: data.air,
      gameMode: data.gameMode,
      inventory: data.inventory,
      armor: data.armor,
      selectedSlot: data.selectedSlot,
    });
    player.flying = data.gameMode === 'creative' && data.flying === true;
    return player;
  }
}
