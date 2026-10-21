/**
 * Crafting operations on top of the recipe registry: grid matching, material
 * consumption, recipe book helpers (availability + auto-fill) and furnace
 * smelting helpers. Pure logic, no DOM.
 */
import type { Slot } from '../core/types';
import type { Inventory } from './inventory';
import { createEmptySlot, isEmpty, itemStackLimit, normalizeSlot } from './inventory';
import {
  findCraftingRecipe,
  findSmeltingRecipe,
  recipeRequirements,
  recipesForSize,
  SMELTING_TIME_TICKS,
  type CraftingRecipe,
  type RecipeGrid,
} from './recipes';

export type CraftingGridSize = 2 | 3;

export interface CraftResult {
  recipe: CraftingRecipe;
  /** Result stack (normalized, count = recipe result count). */
  result: Slot;
}

/** A 2x2 or 3x3 crafting grid; used by the inventory and crafting-table UIs. */
export class CraftingGrid {
  readonly size: CraftingGridSize;
  readonly slots: Slot[];

  constructor(size: CraftingGridSize = 2, slots?: Slot[]) {
    this.size = size;
    this.slots = slots ?? [];
    for (let i = 0; i < size * size; i++) {
      if (!this.slots[i]) this.slots[i] = createEmptySlot();
    }
  }

  get(index: number): Slot {
    return this.slots[index] ?? createEmptySlot();
  }

  set(index: number, slot: Slot): void {
    if (index < 0 || index >= this.size * this.size) return;
    this.slots[index] = normalizeSlot(slot);
  }

  clear(): void {
    for (let i = 0; i < this.size * this.size; i++) this.slots[i] = createEmptySlot();
  }

  /** Number of occupied cells. */
  used(): number {
    let used = 0;
    for (let i = 0; i < this.size * this.size; i++) if (!isEmpty(this.slots[i])) used++;
    return used;
  }

  /** Recipe matching the current grid contents (no consumption). */
  match(): CraftingRecipe | null {
    return findCraftingRecipe(this.slots, this.size);
  }

  /** Result stack preview for the current grid. */
  previewResult(): Slot | null {
    const recipe = this.match();
    if (!recipe) return null;
    return normalizeSlot({ item: recipe.result.item, count: recipe.result.count });
  }

  /** Consume one ingredient per occupied cell when a recipe matches. */
  craft(): CraftResult | null {
    return craftFromGrid(this.slots, this.size);
  }

  /** Return all grid stacks into the inventory (leftovers are returned). */
  returnToInventory(inventory: Inventory): Slot[] {
    return clearGridIntoInventory(this.slots, this.size, inventory);
  }
}

/** Consume one item per occupied cell when a recipe matches. */
export function craftFromGrid(grid: Slot[], size: CraftingGridSize): CraftResult | null {
  const recipe = findCraftingRecipe(grid, size);
  if (!recipe) return null;
  consumeGridOnce(grid, size);
  return { recipe, result: normalizeSlot({ item: recipe.result.item, count: recipe.result.count }) };
}

function consumeGridOnce(grid: Slot[], size: number): void {
  const cells = size * size;
  for (let i = 0; i < cells; i++) {
    const slot = grid[i];
    if (!slot || isEmpty(slot)) continue;
    slot.count -= 1;
    if (slot.count <= 0) {
      slot.item = null;
      slot.count = 0;
      slot.durability = undefined;
      slot.tag = undefined;
    }
  }
}

export function peekCraftResult(grid: RecipeGrid, size: CraftingGridSize): Slot | null {
  const recipe = findCraftingRecipe(grid, size);
  if (!recipe) return null;
  return normalizeSlot({ item: recipe.result.item, count: recipe.result.count });
}

/** Can one unit of every ingredient be taken from the inventory? */
export function canCraftFromInventory(recipe: CraftingRecipe, inventory: Inventory): boolean {
  for (const [item, count] of recipeRequirements(recipe)) {
    if (inventory.count(item) < count) return false;
  }
  return true;
}

/**
 * Recipes the player can currently craft in a grid of `size`.
 * `onlyCraftable` filters out recipes missing materials.
 */
export function availableRecipes(inventory: Inventory, size: CraftingGridSize, onlyCraftable = false): CraftingRecipe[] {
  const recipes = recipesForSize(size);
  if (!onlyCraftable) return recipes;
  return recipes.filter((recipe) => canCraftFromInventory(recipe, inventory));
}

/** Fill an empty crafting grid from a recipe using inventory materials. */
export function fillGridFromRecipe(
  recipe: CraftingRecipe,
  grid: Slot[],
  size: CraftingGridSize,
  inventory: Inventory,
): boolean {
  if (gridHasItems(grid, size)) return false;
  const required = recipeRequirements(recipe);
  for (const [item, count] of required) {
    if (inventory.count(item) < count) return false;
  }
  if (recipe.kind === 'shaped') {
    const pattern = recipe.pattern;
    // Place at the top-left corner of the grid; centered when it fits at 1x1
    // would look odd, so mimic vanilla and use the top-left slot.
    for (let y = 0; y < pattern.length; y++) {
      for (let x = 0; x < pattern[y].length; x++) {
        const ch = pattern[y][x];
        if (!ch || ch === ' ') continue;
        const item = recipe.key[ch];
        if (!item) return false;
        const removed = inventory.remove(item, 1);
        if (removed !== 1) {
          // Should not happen after the count check; roll back what we placed.
          returnGridToInventoryPartial(grid, size, inventory);
          return false;
        }
        const index = y * size + x;
        if (index >= size * size) return false;
        grid[index] = normalizeSlot({ item, count: 1 });
      }
    }
    return true;
  }
  let index = 0;
  for (const ingredient of recipe.ingredients) {
    for (let n = 0; n < ingredient.count; n++) {
      while (index < size * size && !isEmpty(grid[index])) index++;
      if (index >= size * size) return false;
      const removed = inventory.remove(ingredient.item, 1);
      if (removed !== 1) {
        returnGridToInventoryPartial(grid, size, inventory);
        return false;
      }
      grid[index] = normalizeSlot({ item: ingredient.item, count: 1 });
      index++;
    }
  }
  return true;
}

function gridHasItems(grid: Slot[], size: number): boolean {
  for (let i = 0; i < size * size; i++) if (!isEmpty(grid[i])) return true;
  return false;
}

function returnGridToInventoryPartial(grid: Slot[], size: number, inventory: Inventory): void {
  for (let i = 0; i < size * size; i++) {
    const slot = grid[i];
    if (!slot || isEmpty(slot)) continue;
    const leftover = inventory.addSlot(slot);
    grid[i] = leftover;
  }
}

/** Move all grid stacks back into the inventory; returns leftovers. */
export function clearGridIntoInventory(grid: Slot[], size: number, inventory: Inventory): Slot[] {
  const leftovers: Slot[] = [];
  for (let i = 0; i < size * size; i++) {
    const slot = grid[i];
    if (!slot || isEmpty(slot)) {
      grid[i] = createEmptySlot();
      continue;
    }
    const leftover = inventory.addSlot(slot);
    if (!isEmpty(leftover)) leftovers.push(leftover);
    grid[i] = createEmptySlot();
  }
  return leftovers;
}

// ---------------------------------------------------------------------------
// Furnace helpers
// ---------------------------------------------------------------------------

export interface SmeltPlan {
  recipe: ReturnType<typeof findSmeltingRecipe>;
  /** True when the output slot can accept the smelting result. */
  outputFits: boolean;
}

/** Inspect what would happen when smelting `input` into `output`. */
export function planSmelt(input: Slot, output: Slot): SmeltPlan {
  const recipe = isEmpty(input) ? undefined : findSmeltingRecipe(input.item);
  let outputFits = false;
  if (recipe) {
    if (isEmpty(output)) outputFits = true;
    else if (output.item === recipe.output.item) {
      const limit = itemStackLimit(output.item) || 64;
      outputFits = output.count + recipe.output.count <= limit;
    }
  }
  return { recipe, outputFits };
}

/** Ticks left before the next smelt completes (0 when not cooking). */
export function smeltProgress(fractionSource: number): number {
  return Math.max(0, Math.min(SMELTING_TIME_TICKS, fractionSource));
}
