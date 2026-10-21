import { describe, expect, it } from 'vitest';
import { makeSlot, type Slot } from '../../src/core/types';
import {
  CraftingGrid,
  availableRecipes,
  canCraftFromInventory,
  clearGridIntoInventory,
  craftFromGrid,
  fillGridFromRecipe,
  peekCraftResult,
  planSmelt,
} from '../../src/inventory/crafting';
import { Inventory } from '../../src/inventory/inventory';
import { allCraftingRecipes, findCraftingRecipe, recipeById, recipeFitsSize, recipesForSize } from '../../src/inventory/recipes';

function emptyGrid(size: number): Slot[] {
  return Array.from({ length: size * size }, () => makeSlot(null, 0));
}

describe('crafting grid', () => {
  it('crafts a 2x2 recipe and consumes materials', () => {
    const grid = emptyGrid(2);
    grid.forEach((_slot, index) => {
      grid[index] = makeSlot('oak_planks', 1);
    });
    const result = craftFromGrid(grid, 2);
    expect(result?.recipe.result.item).toBe('crafting_table');
    expect(result?.result).toMatchObject({ item: 'crafting_table', count: 1 });
    for (const slot of grid) expect(slot.item).toBeNull();
  });

  it('crafts a shapeless recipe', () => {
    const grid = emptyGrid(3);
    grid[4] = makeSlot('oak_log', 1);
    const result = craftFromGrid(grid, 3);
    expect(result?.result.item).toBe('oak_planks');
    expect(result?.result.count).toBe(4);
    expect(grid[4].item).toBeNull();
  });

  it('crafts forged tools with durability initialised', () => {
    const grid = emptyGrid(3);
    grid[0] = makeSlot('iron_ingot', 1);
    grid[3] = makeSlot('iron_ingot', 1);
    grid[6] = makeSlot('stick', 1);
    const result = craftFromGrid(grid, 3);
    expect(result?.result.item).toBe('iron_sword');
    expect(result?.result.durability).toBe(250);
  });

  it('only consumes one item from stacked grid cells', () => {
    const grid = emptyGrid(2);
    grid[0] = makeSlot('oak_planks', 5);
    grid[1] = makeSlot('oak_planks', 1);
    grid[2] = makeSlot('oak_planks', 1);
    grid[3] = makeSlot('oak_planks', 1);
    expect(peekCraftResult(grid, 2)?.item).toBe('crafting_table');
    const result = craftFromGrid(grid, 2);
    expect(result?.result.item).toBe('crafting_table');
    expect(grid[0].count).toBe(4);
  });

  it('returns null for an unmatched grid and does not consume', () => {
    const grid = emptyGrid(2);
    grid[0] = makeSlot('oak_planks', 1);
    expect(peekCraftResult(grid, 2)).toBeNull();
    expect(craftFromGrid(grid, 2)).toBeNull();
    expect(grid[0].count).toBe(1);
  });

  it('does not forge a 3x3-only recipe inside a 2x2 grid', () => {
    const grid = emptyGrid(2);
    grid[0] = makeSlot('iron_ingot', 1);
    grid[1] = makeSlot('iron_ingot', 1);
    grid[2] = makeSlot('stick', 1);
    expect(findCraftingRecipe(grid, 2)).toBeNull();
  });
});

describe('CraftingGrid class', () => {
  it('exposes size, slots and matching helpers', () => {
    const grid = new CraftingGrid(3);
    expect(grid.size).toBe(3);
    expect(grid.slots).toHaveLength(9);
    expect(grid.used()).toBe(0);
    grid.set(0, makeSlot('oak_log', 1));
    expect(grid.used()).toBe(1);
    expect(grid.match()?.result.item).toBe('oak_planks');
    expect(grid.previewResult()).toMatchObject({ item: 'oak_planks', count: 4 });
    const crafted = grid.craft();
    expect(crafted?.result.item).toBe('oak_planks');
    expect(grid.used()).toBe(0);
    grid.clear();
    expect(grid.get(0).item).toBeNull();
  });

  it('returns grid contents to the inventory', () => {
    const grid = new CraftingGrid(2);
    const inventory = new Inventory();
    grid.set(0, makeSlot('stone', 3));
    grid.set(3, makeSlot('stick', 2));
    const leftovers = grid.returnToInventory(inventory);
    expect(leftovers).toHaveLength(0);
    expect(inventory.count('stone')).toBe(3);
    expect(inventory.count('stick')).toBe(2);
    expect(grid.used()).toBe(0);
  });
});

describe('recipe book helpers', () => {
  it('checks material availability from the inventory', () => {
    const inventory = new Inventory();
    const pickaxe = allCraftingRecipes().find(
      (recipe) => recipe.result.item === 'iron_pickaxe' && recipe.kind === 'shaped',
    )!;
    expect(canCraftFromInventory(pickaxe, inventory)).toBe(false);
    inventory.add('iron_ingot', 3);
    inventory.add('stick', 2);
    expect(canCraftFromInventory(pickaxe, inventory)).toBe(true);
    inventory.remove('stick', 1);
    expect(canCraftFromInventory(pickaxe, inventory)).toBe(false);
  });

  it('lists available recipes filtered by grid size and materials', () => {
    const inventory = new Inventory();
    inventory.add('oak_log', 4);
    const all2 = availableRecipes(inventory, 2);
    const craftable2 = availableRecipes(inventory, 2, true);
    expect(all2.length).toBe(recipesForSize(2).length);
    expect(craftable2.length).toBeGreaterThan(0);
    expect(craftable2.every((recipe) => recipeFitsSize(recipe, 2))).toBe(true);
    expect(craftable2.some((recipe) => recipe.result.item === 'oak_planks')).toBe(true);
    expect(craftable2.some((recipe) => recipe.result.item === 'iron_pickaxe')).toBe(false);
  });

  it('fills an empty grid from a recipe using inventory materials', () => {
    const inventory = new Inventory();
    inventory.add('oak_planks', 4);
    const grid = emptyGrid(2);
    const tableRecipe = allCraftingRecipes().find(
      (recipe) => recipe.result.item === 'crafting_table' && recipe.kind === 'shaped',
    )!;
    expect(fillGridFromRecipe(tableRecipe, grid, 2, inventory)).toBe(true);
    expect(grid.filter((slot) => slot.item === 'oak_planks')).toHaveLength(4);
    expect(inventory.count('oak_planks')).toBe(0);
    expect(peekCraftResult(grid, 2)?.item).toBe('crafting_table');
    expect(craftFromGrid(grid, 2)?.result.item).toBe('crafting_table');
  });

  it('fills a shapeless recipe (planks from a log)', () => {
    const inventory = new Inventory();
    inventory.add('oak_log', 2);
    const grid = emptyGrid(3);
    const planks = allCraftingRecipes().find(
      (recipe) => recipe.result.item === 'oak_planks' && recipe.kind === 'shapeless',
    )!;
    expect(fillGridFromRecipe(planks, grid, 3, inventory)).toBe(true);
    expect(grid[0].item).toBe('oak_log');
    expect(inventory.count('oak_log')).toBe(1);
    expect(craftFromGrid(grid, 3)?.result.count).toBe(4);
  });

  it('fails without side effects when materials are missing or the grid is dirty', () => {
    const inventory = new Inventory();
    inventory.add('oak_planks', 2);
    const grid = emptyGrid(2);
    const tableRecipe = allCraftingRecipes().find(
      (recipe) => recipe.result.item === 'crafting_table' && recipe.kind === 'shaped',
    )!;
    expect(fillGridFromRecipe(tableRecipe, grid, 2, inventory)).toBe(false);
    expect(inventory.count('oak_planks')).toBe(2);
    expect(grid.every((slot) => slot.item === null)).toBe(true);

    inventory.add('oak_planks', 2);
    grid[3] = makeSlot('stone', 1);
    expect(fillGridFromRecipe(tableRecipe, grid, 2, inventory)).toBe(false);
  });

  it('returns leftovers when clearing a grid into a full inventory', () => {
    const inventory = new Inventory();
    for (let i = 0; i < 36; i++) inventory.setSlot(i, makeSlot('dirt', 64));
    const grid = emptyGrid(2);
    grid[0] = makeSlot('stone', 2);
    const leftovers = clearGridIntoInventory(grid, 2, inventory);
    expect(leftovers).toHaveLength(1);
    expect(leftovers[0]).toMatchObject({ item: 'stone', count: 2 });
    expect(grid[0].item).toBeNull();
  });

  it('keeps a recipe id lookup working for UI recipe book entries', () => {
    const recipe = allCraftingRecipes()[0];
    expect(recipeById(recipe.id)?.id).toBe(recipe.id);
  });
});

describe('furnace smelting plans', () => {
  it('plans a smelt when the output slot is empty', () => {
    const plan = planSmelt(makeSlot('raw_iron', 2), makeSlot(null, 0));
    expect(plan.recipe?.output.item).toBe('iron_ingot');
    expect(plan.outputFits).toBe(true);
  });

  it('rejects non-smeltable inputs and full output slots', () => {
    expect(planSmelt(makeSlot('coal', 2), makeSlot(null, 0)).recipe).toBeUndefined();
    expect(planSmelt(makeSlot('raw_iron', 1), makeSlot('stone', 1)).outputFits).toBe(false);
    expect(planSmelt(makeSlot('raw_iron', 1), makeSlot('iron_ingot', 64)).outputFits).toBe(false);
    expect(planSmelt(makeSlot('raw_iron', 1), makeSlot('iron_ingot', 63)).outputFits).toBe(true);
  });
});
