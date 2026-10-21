import { describe, expect, it } from 'vitest';
import {
  MAX_GRID_SIZE,
  SMELTING_TIME_TICKS,
  allCraftingRecipes,
  allSmeltingRecipes,
  craftingRecipeCount,
  findCraftingRecipe,
  findSmeltingRecipe,
  fuelTicks,
  isFuel,
  matchRecipe,
  recipeById,
  recipeFitsSize,
  recipeRequirements,
  recipesForResult,
  recipesForSize,
  smeltingOutputFor,
  validateRecipeRegistry,
  type ShapedRecipe,
  type ShapelessRecipe,
} from '../../src/inventory/recipes';

function grid(size: number, entries: Record<number, string>): (string | null)[] {
  return Array.from({ length: size * size }, (_unused, index) => entries[index] ?? null);
}

function shapedRecipeFor(result: string): ShapedRecipe {
  const recipe = allCraftingRecipes().find(
    (candidate) => candidate.kind === 'shaped' && candidate.result.item === result,
  );
  if (!recipe) throw new Error(`no shaped recipe for ${result}`);
  return recipe as ShapedRecipe;
}

function shapelessRecipeFor(result: string): ShapelessRecipe {
  const recipe = allCraftingRecipes().find(
    (candidate) => candidate.kind === 'shapeless' && candidate.result.item === result,
  );
  if (!recipe) throw new Error(`no shapeless recipe for ${result}`);
  return recipe as ShapelessRecipe;
}

describe('recipe registry', () => {
  it('ships at least 70 crafting recipes and 10 smelting recipes', () => {
    expect(craftingRecipeCount()).toBeGreaterThanOrEqual(70);
    expect(allCraftingRecipes().length).toBe(craftingRecipeCount());
    expect(allSmeltingRecipes().length).toBeGreaterThanOrEqual(10);
    expect(SMELTING_TIME_TICKS).toBe(200);
    expect(MAX_GRID_SIZE).toBe(3);
  });

  it('has unique ids and valid item references', () => {
    expect(validateRecipeRegistry()).toEqual([]);
    const ids = new Set(allCraftingRecipes().map((recipe) => recipe.id));
    expect(ids.size).toBe(allCraftingRecipes().length);
    expect(recipeById(allCraftingRecipes()[0].id)).toBeDefined();
  });

  it('contains the expected core results', () => {
    for (const result of [
      'stick',
      'crafting_table',
      'furnace',
      'chest',
      'torch',
      'iron_pickaxe',
      'diamond_sword',
      'iron_helmet',
      'diamond_chestplate',
      'bow',
      'arrow',
      'flint_and_steel',
      'oak_planks',
      'white_wool',
      'tnt',
      'paper',
    ]) {
      expect(recipesForResult(result).length, `missing recipe for ${result}`).toBeGreaterThan(0);
    }
  });

  it('produces sensible result counts', () => {
    expect(shapelessRecipeFor('oak_planks').result.count).toBe(4);
    expect(shapedRecipeFor('stick').result.count).toBe(4);
    expect(shapedRecipeFor('torch').result.count).toBe(4);
    expect(shapedRecipeFor('arrow').result.count).toBe(4);
    expect(shapedRecipeFor('stone_bricks').result.count).toBe(4);
    expect(shapedRecipeFor('iron_block').result.count).toBe(1);
    expect(shapelessRecipeFor('iron_ingot').result.count).toBe(9);
  });

  it('computes ingredient requirements', () => {
    const pickaxe = shapedRecipeFor('iron_pickaxe');
    const required = recipeRequirements(pickaxe);
    expect(required.get('iron_ingot')).toBe(3);
    expect(required.get('stick')).toBe(2);
    const planks = shapelessRecipeFor('oak_planks');
    expect(recipeRequirements(planks).get('oak_log')).toBe(1);
  });
});

describe('shaped matching', () => {
  it('matches a 2x2 recipe in a 2x2 grid', () => {
    const recipe = findCraftingRecipe(grid(2, { 0: 'oak_planks', 1: 'oak_planks', 2: 'oak_planks', 3: 'oak_planks' }), 2);
    expect(recipe?.result.item).toBe('crafting_table');
  });

  it('matches with automatic offset inside a 3x3 grid', () => {
    const recipe = findCraftingRecipe(
      grid(3, { 4: 'oak_planks', 5: 'oak_planks', 7: 'oak_planks', 8: 'oak_planks' }),
      3,
    );
    expect(recipe?.result.item).toBe('crafting_table');

    const furnace = findCraftingRecipe(
      grid(3, {
        0: 'cobblestone',
        1: 'cobblestone',
        2: 'cobblestone',
        3: 'cobblestone',
        5: 'cobblestone',
        6: 'cobblestone',
        7: 'cobblestone',
        8: 'cobblestone',
      }),
      3,
    );
    expect(furnace?.result.item).toBe('furnace');
  });

  it('does not match the wrong layout', () => {
    expect(findCraftingRecipe(grid(2, { 0: 'oak_planks', 1: 'oak_planks' }), 2)).toBeNull();
    expect(findCraftingRecipe(grid(2, { 0: 'oak_planks', 3: 'oak_planks' }), 2)).toBeNull();
    expect(findCraftingRecipe(grid(2, {}), 2)).toBeNull();
  });

  it('matches forged tools with the canonical layout (no mirroring by default)', () => {
    const sword = findCraftingRecipe(
      grid(3, { 0: 'iron_ingot', 3: 'iron_ingot', 6: 'stick' }),
      3,
    );
    expect(sword?.result.item).toBe('iron_sword');

    // Canonical axe: ["MM","MS"," S"].
    const axe = findCraftingRecipe(
      grid(3, { 0: 'iron_ingot', 1: 'iron_ingot', 3: 'iron_ingot', 4: 'stick', 7: 'stick' }),
      3,
    );
    expect(axe?.result.item).toBe('iron_axe');

    // The mirrored axe layout intentionally does not match (PLAN §3.6).
    const mirroredAxe = findCraftingRecipe(
      grid(3, { 0: 'iron_ingot', 1: 'iron_ingot', 3: 'stick', 4: 'iron_ingot', 6: 'stick' }),
      3,
    );
    expect(mirroredAxe).toBeNull();
    expect((axe as ShapedRecipe).mirror).toBe(false);
  });

  it('distinguishes key materials (coal vs charcoal torch)', () => {
    const coalTorch = findCraftingRecipe(grid(3, { 0: 'coal', 3: 'stick' }), 3);
    const charcoalTorch = findCraftingRecipe(grid(3, { 0: 'charcoal', 3: 'stick' }), 3);
    expect(coalTorch?.result.item).toBe('torch');
    expect(charcoalTorch?.result.item).toBe('torch');
    expect(coalTorch?.id).not.toBe(charcoalTorch?.id);
  });
});

describe('shapeless matching', () => {
  it('matches regardless of order', () => {
    const logLeft = findCraftingRecipe(grid(3, { 0: 'oak_log' }), 3);
    const logCenter = findCraftingRecipe(grid(3, { 4: 'oak_log' }), 3);
    expect(logLeft?.result.item).toBe('oak_planks');
    expect(logCenter?.result.item).toBe('oak_planks');
    expect(logLeft?.kind).toBe('shapeless');
  });

  it('matches multi-item shapeless recipes (dyed wool)', () => {
    const recipe = findCraftingRecipe(grid(3, { 0: 'white_wool', 4: 'red_dye' }), 3);
    expect(recipe?.result.item).toBe('red_wool');
  });

  it('does not match when ingredients are missing or extra', () => {
    expect(findCraftingRecipe(grid(3, { 0: 'red_dye' }), 3)).toBeNull();
    expect(findCraftingRecipe(grid(3, { 0: 'white_wool', 1: 'red_dye', 2: 'stone' }), 3)).toBeNull();
  });

  it('the same grid does not match a different shapeless recipe', () => {
    const recipe = findCraftingRecipe(grid(3, { 0: 'coal' }), 3);
    expect(recipe?.result.item).toBe('black_dye');
  });
});

describe('recipe sizing', () => {
  it('filters recipes that do not fit a 2x2 grid', () => {
    const twoByTwo = recipesForSize(2);
    expect(twoByTwo.length).toBeGreaterThan(0);
    for (const recipe of twoByTwo) {
      if (recipe.kind === 'shaped') {
        expect(recipe.pattern.length).toBeLessThanOrEqual(2);
        expect(recipe.pattern[0].length).toBeLessThanOrEqual(2);
      } else {
        expect(recipe.ingredients.length).toBeLessThanOrEqual(4);
      }
    }
    const pickaxe = shapedRecipeFor('iron_pickaxe');
    expect(recipeFitsSize(pickaxe, 2)).toBe(false);
    expect(recipeFitsSize(pickaxe, 3)).toBe(true);
    expect(twoByTwo.some((recipe) => recipe.result.item === 'iron_pickaxe')).toBe(false);
    expect(recipesForSize(3).length).toBeGreaterThan(recipesForSize(2).length);
  });

  it('matchRecipe rejects a 3x3 recipe in a 2x2 grid', () => {
    const pickaxe = shapedRecipeFor('iron_pickaxe');
    expect(matchRecipe(pickaxe, grid(2, { 0: 'iron_ingot', 1: 'iron_ingot' }), 2)).toBe(false);
  });
});

describe('smelting and fuel', () => {
  it('looks up smelting recipes', () => {
    expect(smeltingOutputFor('raw_iron')?.item).toBe('iron_ingot');
    expect(smeltingOutputFor('raw_beef')?.item).toBe('steak');
    expect(smeltingOutputFor('sand')?.item).toBe('glass');
    expect(findSmeltingRecipe('coal')).toBeUndefined();
    expect(findSmeltingRecipe(null)).toBeUndefined();
  });

  it('exposes fuel burn times', () => {
    expect(fuelTicks('coal')).toBe(1600);
    expect(fuelTicks('charcoal')).toBe(1600);
    expect(fuelTicks('stick')).toBe(100);
    expect(fuelTicks('oak_planks')).toBe(300);
    expect(fuelTicks('coal_block')).toBe(16000);
    expect(fuelTicks('stone')).toBe(0);
    expect(fuelTicks('not_an_item')).toBe(0);
    expect(isFuel('coal')).toBe(true);
    expect(isFuel('stone')).toBe(false);
  });

  it('smelting time is 10 seconds at 20 tps', () => {
    expect(SMELTING_TIME_TICKS).toBe(10 * 20);
  });
});
