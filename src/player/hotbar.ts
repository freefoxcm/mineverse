import type { Slot } from '../core/types';
import { isEmpty } from '../inventory/inventory';

export const HOTBAR_SIZE = 9;

export type SlotDirection = 1 | -1;

/** Wraps an index into 0..8. */
export function wrapHotbar(index: number): number {
  return ((Math.floor(index) % HOTBAR_SIZE) + HOTBAR_SIZE) % HOTBAR_SIZE;
}

/**
 * Finds the first non-empty hotbar slot starting at `start`, walking in
 * `direction` and wrapping around. Returns null when all nine slots are empty.
 */
export function findOccupiedSlot(slots: readonly Slot[], start: number, direction: SlotDirection = 1): number | null {
  const base = wrapHotbar(start);
  for (let step = 0; step < HOTBAR_SIZE; step++) {
    const index = wrapHotbar(base + direction * step);
    if (!isEmpty(slots[index])) return index;
  }
  return null;
}

/**
 * Resolves a requested hotbar index to a non-empty slot so the first-person
 * view never enters an invisible "empty hand" state. Falls back to the current
 * slot when every hotbar slot is empty (the game then simply renders nothing).
 */
export function resolveHotbarSlot(
  slots: readonly Slot[],
  requested: number,
  fallback: number,
  direction: SlotDirection = 1,
): number {
  const base = wrapHotbar(requested);
  if (!isEmpty(slots[base])) return base;
  const forward = findOccupiedSlot(slots, base, direction);
  if (forward !== null) return forward;
  const backward = findOccupiedSlot(slots, base, direction === 1 ? -1 : 1);
  return backward ?? wrapHotbar(fallback);
}

/** Starting inventory for new worlds: exactly nine hotbar stacks. */
export const SURVIVAL_STARTER_KIT: ReadonlyArray<readonly [string, number]> = [
  ['stone_pickaxe', 1],
  ['stone_axe', 1],
  ['stone_sword', 1],
  ['torch', 16],
  ['oak_planks', 32],
  ['cobblestone', 32],
  ['crafting_table', 1],
  ['apple', 8],
  ['stone_shovel', 1],
];

export const CREATIVE_STARTER_KIT: ReadonlyArray<readonly [string, number]> = [
  ['grass_block', 64],
  ['oak_planks', 64],
  ['cobblestone', 64],
  ['glass', 64],
  ['torch', 64],
  ['oak_log', 64],
  ['sand', 64],
  ['crafting_table', 64],
  ['white_wool', 64],
];
