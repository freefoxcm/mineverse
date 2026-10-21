/**
 * Block-entity data structures for containers. Pure data + deterministic tick
 * logic; the Lead owns persistence and wiring to the world's `blockEntities`.
 *
 *   ChestData    27 slots
 *   FurnaceState  3 slots [input, fuel, output] + burn/cook counters
 */
import type { Slot } from '../core/types';
import { createEmptySlot, isEmpty, normalizeSlot, slotDurability } from './inventory';
import { findSmeltingRecipe, fuelTicks, SMELTING_TIME_TICKS } from './recipes';

export const CHEST_SIZE = 27;
export const FURNACE_SIZE = 3;
export const FURNACE_INPUT = 0;
export const FURNACE_FUEL = 1;
export const FURNACE_OUTPUT = 2;

// ---------------------------------------------------------------------------
// Chest
// ---------------------------------------------------------------------------

export interface ChestData {
  slots: Slot[];
}

export function createChestData(): ChestData {
  return { slots: Array.from({ length: CHEST_SIZE }, () => createEmptySlot()) };
}

export interface ChestSaveData {
  slots: Slot[];
}

export function serializeChest(chest: ChestData): ChestSaveData {
  return { slots: chest.slots.map((slot) => normalizeSlot(slot)) };
}

export function deserializeChest(data: Partial<ChestSaveData> | undefined | null): ChestData {
  const chest = createChestData();
  const slots = data?.slots ?? [];
  for (let i = 0; i < CHEST_SIZE; i++) chest.slots[i] = normalizeSlot(slots[i] ?? createEmptySlot());
  return chest;
}

// ---------------------------------------------------------------------------
// Furnace
// ---------------------------------------------------------------------------

export interface FurnaceState {
  /** [input, fuel, output] */
  slots: Slot[];
  /** Remaining burn ticks of the currently burning fuel unit. */
  burnTicks: number;
  /** Total burn ticks of that unit (flame icon scaling). */
  burnTotalTicks: number;
  /** Progress towards the next smelt, 0..SMELTING_TIME_TICKS. */
  cookTicks: number;
  /** Accumulated experience released when the output is taken. */
  experience: number;
}

export function createFurnaceState(partial?: Partial<FurnaceState>): FurnaceState {
  const slots = Array.from({ length: FURNACE_SIZE }, () => createEmptySlot());
  if (partial?.slots) {
    for (let i = 0; i < FURNACE_SIZE; i++) slots[i] = normalizeSlot(partial.slots[i] ?? createEmptySlot());
  }
  return {
    slots,
    burnTicks: Math.max(0, partial?.burnTicks ?? 0),
    burnTotalTicks: Math.max(0, partial?.burnTotalTicks ?? 0),
    cookTicks: Math.max(0, partial?.cookTicks ?? 0),
    experience: Math.max(0, partial?.experience ?? 0),
  };
}

export function furnaceInput(furnace: FurnaceState): Slot {
  return furnace.slots[FURNACE_INPUT] ?? createEmptySlot();
}

export function furnaceFuel(furnace: FurnaceState): Slot {
  return furnace.slots[FURNACE_FUEL] ?? createEmptySlot();
}

export function furnaceOutput(furnace: FurnaceState): Slot {
  return furnace.slots[FURNACE_OUTPUT] ?? createEmptySlot();
}

export function isFurnaceLit(furnace: FurnaceState): boolean {
  return furnace.burnTicks > 0;
}

/** 0..1 progress of the current smelt. */
export function furnaceCookProgress(furnace: FurnaceState): number {
  return Math.max(0, Math.min(1, furnace.cookTicks / SMELTING_TIME_TICKS));
}

/** 0..1 remaining fuel fraction (flame icon). */
export function furnaceBurnProgress(furnace: FurnaceState): number {
  if (furnace.burnTotalTicks <= 0) return 0;
  return Math.max(0, Math.min(1, furnace.burnTicks / furnace.burnTotalTicks));
}

export interface FurnaceTickEvents {
  wasLit: boolean;
  isLit: boolean;
  consumedFuel: boolean;
  /** The freshly smelted stack, when a smelt completed during this call. */
  smelted: Slot | null;
  /** How many smelts completed during this call. */
  smeltedCount: number;
}

function outputCanAccept(furnace: FurnaceState, item: string, count: number): boolean {
  const output = furnaceOutput(furnace);
  if (isEmpty(output)) return true;
  if (output.item !== item) return false;
  return output.count + count <= 64;
}

function clearSlotFully(slot: Slot): void {
  slot.item = null;
  slot.count = 0;
  slot.durability = undefined;
  slot.tag = undefined;
}

/**
 * Advance the furnace by `ticks` game ticks (20 tps). Burns fuel, cooks the
 * input, and writes the result into the output slot. Deterministic / pure
 * except for mutating the passed state. The caller is responsible for updating
 * the block between `furnace` and `lit_furnace` from `isLit`.
 */
export function tickFurnace(furnace: FurnaceState, ticks = 1): FurnaceTickEvents {
  const events: FurnaceTickEvents = {
    wasLit: isFurnaceLit(furnace),
    isLit: false,
    consumedFuel: false,
    smelted: null,
    smeltedCount: 0,
  };
  const steps = Math.max(0, Math.floor(ticks));
  for (let step = 0; step < steps; step++) {
    const input = furnaceInput(furnace);
    const fuel = furnaceFuel(furnace);
    const recipe = isEmpty(input) ? undefined : findSmeltingRecipe(input.item);
    const canSmelt = !!recipe && outputCanAccept(furnace, recipe.output.item, recipe.output.count);

    // Ignite the next fuel unit when not currently burning.
    if (furnace.burnTicks <= 0) {
      const burn = fuelTicks(fuel.item);
      if (canSmelt && burn > 0) {
        fuel.count -= 1;
        if (fuel.count <= 0) clearSlotFully(fuel);
        furnace.burnTicks = burn;
        furnace.burnTotalTicks = burn;
        events.consumedFuel = true;
      }
    }

    if (furnace.burnTicks > 0) {
      if (canSmelt && recipe) {
        furnace.cookTicks += 1;
        if (furnace.cookTicks >= SMELTING_TIME_TICKS) {
          furnace.cookTicks = 0;
          input.count -= 1;
          if (input.count <= 0) clearSlotFully(input);
          const output = furnaceOutput(furnace);
          if (isEmpty(output)) {
            furnace.slots[FURNACE_OUTPUT] = normalizeSlot({ item: recipe.output.item, count: recipe.output.count });
          } else {
            output.count = Math.min(64, output.count + recipe.output.count);
          }
          furnace.experience += recipe.experience;
          events.smelted = normalizeSlot({ item: recipe.output.item, count: recipe.output.count });
          events.smeltedCount += 1;
        }
      } else {
        furnace.cookTicks = 0;
      }
      furnace.burnTicks -= 1;
    } else {
      furnace.cookTicks = 0;
    }
  }
  events.isLit = isFurnaceLit(furnace);
  return events;
}

export interface FurnaceSaveData {
  slots: Slot[];
  burnTicks: number;
  burnTotalTicks: number;
  cookTicks: number;
  experience: number;
}

export function serializeFurnace(furnace: FurnaceState): FurnaceSaveData {
  return {
    slots: furnace.slots.map((slot) => normalizeSlot(slot)),
    burnTicks: furnace.burnTicks,
    burnTotalTicks: furnace.burnTotalTicks,
    cookTicks: furnace.cookTicks,
    experience: furnace.experience,
  };
}

export function deserializeFurnace(data: Partial<FurnaceSaveData> | undefined | null): FurnaceState {
  return createFurnaceState({
    slots: data?.slots,
    burnTicks: data?.burnTicks,
    burnTotalTicks: data?.burnTotalTicks,
    cookTicks: data?.cookTicks,
    experience: data?.experience,
  });
}

// ---------------------------------------------------------------------------
// Container access (UI <-> world bridge)
// ---------------------------------------------------------------------------

export type ContainerKind = 'chest' | 'furnace';

export interface ContainerAccessBase {
  /** Notify the world that the container contents changed (mark dirty/save). */
  onChange(): void;
}

export interface ChestAccess extends ContainerAccessBase {
  kind: 'chest';
  slots: Slot[];
}

export interface FurnaceAccess extends ContainerAccessBase {
  kind: 'furnace';
  /** Same array as `furnace.slots` */
  slots: Slot[];
  furnace: FurnaceState;
}

export type ContainerAccess = ChestAccess | FurnaceAccess;

export function containerSlots(access: ContainerAccess): Slot[] {
  return access.kind === 'chest' ? access.slots : access.furnace.slots;
}

/** Standalone (unsaved) chest used by URLs/E2E screenshots and previews. */
export function createStandaloneChestAccess(): ChestAccess {
  const chest = createChestData();
  // Demo contents so unattached previews/E2E screenshots show real icons.
  chest.slots[0] = normalizeSlot({ item: 'diamond', count: 12 });
  chest.slots[1] = normalizeSlot({ item: 'iron_ingot', count: 32 });
  chest.slots[2] = normalizeSlot({ item: 'gold_ingot', count: 16 });
  chest.slots[4] = normalizeSlot({ item: 'bread', count: 4 });
  chest.slots[9] = normalizeSlot({ item: 'torch', count: 16 });
  chest.slots[10] = normalizeSlot({ item: 'oak_planks', count: 48 });
  chest.slots[13] = normalizeSlot({ item: 'iron_pickaxe', count: 1, durability: 187 });
  chest.slots[18] = normalizeSlot({ item: 'apple', count: 6 });
  chest.slots[20] = normalizeSlot({ item: 'coal', count: 24 });
  chest.slots[23] = normalizeSlot({ item: 'stone_bricks', count: 32 });
  return { kind: 'chest', slots: chest.slots, onChange: () => undefined };
}

/** Standalone (unsaved) furnace used by URLs/E2E screenshots and previews. */
export function createStandaloneFurnaceAccess(): FurnaceAccess {
  const furnace = createFurnaceState({
    // Demo state: mid-burn and mid-smelt so the flame/progress widgets show up.
    slots: [
      { item: 'raw_iron', count: 5 },
      { item: 'coal', count: 3 },
      { item: 'iron_ingot', count: 2 },
    ],
    burnTicks: 1100,
    burnTotalTicks: 1600,
    cookTicks: 132,
    experience: 1.4,
  });
  return { kind: 'furnace', slots: furnace.slots, furnace, onChange: () => undefined };
}
