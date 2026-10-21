/**
 * Crafting / smelting recipe registry. Pure data + matching helpers, no DOM.
 *
 * Recipe ids reference string item ids from `src/world/items.ts`; the registry
 * itself is append-only and validated by `validateRecipeRegistry()` (used in
 * tests). Shaped patterns are trimmed on registration and matched with an
 * automatic offset, so a 2x2 recipe matches anywhere inside a 3x3 grid.
 */
import type { Slot } from '../core/types';
import { getItem, allItems } from '../world/items';

export type RecipeCategory = 'building' | 'tools' | 'combat' | 'food' | 'materials' | 'misc';

export interface ItemStackSpec {
  item: string;
  count: number;
}

export interface ShapedRecipe {
  id: string;
  kind: 'shaped';
  /** Tight pattern rows (no all-empty rows/columns). `' '` = empty cell. */
  pattern: string[];
  key: Record<string, string>;
  result: ItemStackSpec;
  /** Recipes are mirrorable by default (like vanilla shaped recipes). */
  mirror: boolean;
  category: RecipeCategory;
}

export interface ShapelessRecipe {
  id: string;
  kind: 'shapeless';
  ingredients: ItemStackSpec[];
  result: ItemStackSpec;
  category: RecipeCategory;
}

export type CraftingRecipe = ShapedRecipe | ShapelessRecipe;

export interface SmeltingRecipe {
  id: string;
  input: string;
  output: ItemStackSpec;
  experience: number;
}

/** One smelt takes 10 seconds at the fixed 20 TPS simulation rate. */
export const SMELTING_TIME_TICKS = 200;
export const MAX_GRID_SIZE = 3;

/** Loose grid representation accepted by matchers (live slots or ids). */
export type RecipeGrid = readonly (Slot | string | null | undefined)[];

const SHAPED: ShapedRecipe[] = [];
const SHAPELESS: ShapelessRecipe[] = [];
const SMELTING: SmeltingRecipe[] = [];
let recipeCounter = 0;

// ---------------------------------------------------------------------------
// Registration helpers
// ---------------------------------------------------------------------------

/** Trim empty rows/columns off a pattern and pad it into a rectangle. */
export function trimPattern(pattern: readonly string[]): string[] {
  const rows = pattern.map((row) => row.replace(/[^A-Za-z0-9_#]/g, (ch) => (ch === ' ' ? ' ' : ch)));
  if (rows.length === 0) return [];
  const width = Math.max(0, ...rows.map((row) => row.length));
  const padded = rows.map((row) => row.padEnd(width, ' '));
  let minX = width;
  let minY = padded.length;
  let maxX = -1;
  let maxY = -1;
  for (let y = 0; y < padded.length; y++) {
    for (let x = 0; x < width; x++) {
      if (padded[y][x] !== ' ') {
        minX = Math.min(minX, x);
        maxX = Math.max(maxX, x);
        minY = Math.min(minY, y);
        maxY = Math.max(maxY, y);
      }
    }
  }
  if (maxX < 0) return [];
  const trimmed: string[] = [];
  for (let y = minY; y <= maxY; y++) trimmed.push(padded[y].slice(minX, maxX + 1));
  return trimmed;
}

function nextRecipeId(result: string): string {
  recipeCounter += 1;
  return `${result}_${recipeCounter}`;
}

export interface ShapedOptions {
  mirror?: boolean;
  category?: RecipeCategory;
  id?: string;
}

/** Register a shaped recipe. Pattern rows are trimmed to their content. */
export function registerShaped(
  result: ItemStackSpec,
  pattern: readonly string[],
  key: Record<string, string>,
  options: ShapedOptions = {},
): ShapedRecipe {
  const trimmed = trimPattern(pattern);
  const recipe: ShapedRecipe = {
    id: options.id ?? nextRecipeId(result.item),
    kind: 'shaped',
    pattern: trimmed,
    key: { ...key },
    result: { item: result.item, count: result.count },
    // PLAN §3.6: shaped recipes use an automatic offset but are not mirrored.
    mirror: options.mirror ?? false,
    category: options.category ?? 'misc',
  };
  SHAPED.push(recipe);
  return recipe;
}

export function registerShapeless(
  result: ItemStackSpec,
  ingredients: readonly (string | ItemStackSpec)[],
  options: { category?: RecipeCategory; id?: string } = {},
): ShapelessRecipe {
  const recipe: ShapelessRecipe = {
    id: options.id ?? nextRecipeId(result.item),
    kind: 'shapeless',
    ingredients: ingredients.map((entry) => (typeof entry === 'string' ? { item: entry, count: 1 } : { ...entry })),
    result: { item: result.item, count: result.count },
    category: options.category ?? 'misc',
  };
  SHAPELESS.push(recipe);
  return recipe;
}

export function registerSmelting(input: string, output: string, count = 1, experience = 0.1, id?: string): SmeltingRecipe {
  const recipe: SmeltingRecipe = {
    id: id ?? `smelt_${input}`,
    input,
    output: { item: output, count },
    experience,
  };
  SMELTING.push(recipe);
  return recipe;
}

function shaped(
  result: string,
  count: number,
  pattern: readonly string[],
  key: Record<string, string>,
  options: ShapedOptions = {},
): void {
  registerShaped({ item: result, count }, pattern, key, options);
}

function shapeless(result: string, count: number, ingredients: readonly (string | ItemStackSpec)[], category: RecipeCategory = 'misc'): void {
  registerShapeless({ item: result, count }, ingredients, { category });
}

function smelt(input: string, output: string, count = 1, experience = 0.1): void {
  registerSmelting(input, output, count, experience);
}

// ---------------------------------------------------------------------------
// Recipe data (>= 70 crafting recipes + smelting + fuels)
// ---------------------------------------------------------------------------

// --- wood / planks ---------------------------------------------------------
shapeless('oak_planks', 4, ['oak_log'], 'building');
shapeless('birch_planks', 4, ['birch_log'], 'building');
shapeless('spruce_planks', 4, ['spruce_log'], 'building');

shaped('stick', 4, ['#', '#'], { '#': 'oak_planks' }, { category: 'materials' });
shaped('crafting_table', 1, ['##', '##'], { '#': 'oak_planks' }, { category: 'building' });
shaped('furnace', 1, ['CCC', 'C C', 'CCC'], { C: 'cobblestone' }, { category: 'building' });
shaped('chest', 1, ['###', '# #', '###'], { '#': 'oak_planks' }, { category: 'building' });
shaped('torch', 4, ['C', 'S'], { C: 'coal', S: 'stick' }, { category: 'materials' });
shaped('torch', 4, ['C', 'S'], { C: 'charcoal', S: 'stick' }, { category: 'materials' });

// --- stone / building -----------------------------------------------------
shaped('sandstone', 1, ['SS', 'SS'], { S: 'sand' }, { category: 'building' });
shaped('stone_bricks', 4, ['SS', 'SS'], { S: 'stone' }, { category: 'building' });
shaped('bricks', 1, ['BB', 'BB'], { B: 'brick' }, { category: 'building' });
shaped('clay', 1, ['CC', 'CC'], { C: 'clay_ball' }, { category: 'building' });
shapeless('clay_ball', 4, ['clay'], 'materials');
shaped('white_wool', 1, ['SS', 'SS'], { S: 'string' }, { category: 'building' });
shaped('tnt', 1, ['GSG', 'SGS', 'GSG'], { G: 'gunpowder', S: 'sand' }, { category: 'combat' });
shapeless('paper', 3, ['sugar_cane', 'sugar_cane', 'sugar_cane'], 'materials');

// --- storage blocks -------------------------------------------------------
const COMPRESSIBLE: Record<string, string> = {
  iron_block: 'iron_ingot',
  gold_block: 'gold_ingot',
  diamond_block: 'diamond',
  lapis_block: 'lapis_lazuli',
  redstone_block: 'redstone',
  coal_block: 'coal',
};
for (const [block, material] of Object.entries(COMPRESSIBLE)) {
  shaped(block, 1, ['###', '###', '###'], { '#': material }, { category: 'building' });
  shapeless(material, 9, [block], 'materials');
}

// --- tools ----------------------------------------------------------------
const TOOL_TIERS: readonly { prefix: string; material: string }[] = [
  { prefix: 'wooden', material: 'oak_planks' },
  { prefix: 'stone', material: 'cobblestone' },
  { prefix: 'iron', material: 'iron_ingot' },
  { prefix: 'golden', material: 'gold_ingot' },
  { prefix: 'diamond', material: 'diamond' },
];
for (const tier of TOOL_TIERS) {
  shaped(`${tier.prefix}_pickaxe`, 1, ['MMM', ' S ', ' S '], { M: tier.material, S: 'stick' }, { category: 'tools' });
  shaped(`${tier.prefix}_axe`, 1, ['MM', 'MS', ' S'], { M: tier.material, S: 'stick' }, { category: 'tools' });
  shaped(`${tier.prefix}_shovel`, 1, ['M', 'S', 'S'], { M: tier.material, S: 'stick' }, { category: 'tools' });
  shaped(`${tier.prefix}_sword`, 1, ['M', 'M', 'S'], { M: tier.material, S: 'stick' }, { category: 'combat' });
}

// --- armor ----------------------------------------------------------------
const ARMOR_TIERS: readonly { prefix: string; material: string }[] = [
  { prefix: 'leather', material: 'leather' },
  { prefix: 'iron', material: 'iron_ingot' },
  { prefix: 'golden', material: 'gold_ingot' },
  { prefix: 'diamond', material: 'diamond' },
];
for (const tier of ARMOR_TIERS) {
  shaped(`${tier.prefix}_helmet`, 1, ['MMM', 'M M'], { M: tier.material }, { category: 'combat' });
  shaped(`${tier.prefix}_chestplate`, 1, ['M M', 'MMM', 'MMM'], { M: tier.material }, { category: 'combat' });
  shaped(`${tier.prefix}_leggings`, 1, ['MMM', 'M M', 'M M'], { M: tier.material }, { category: 'combat' });
  shaped(`${tier.prefix}_boots`, 1, ['M M', 'M M'], { M: tier.material }, { category: 'combat' });
}

// --- weapons / misc -------------------------------------------------------
shaped('bow', 1, [' #S', '# S', ' #S'], { '#': 'stick', S: 'string' }, { category: 'combat' });
shaped('arrow', 4, ['F', 'S', 'E'], { F: 'flint', S: 'stick', E: 'feather' }, { category: 'combat' });
shapeless('flint_and_steel', 1, ['iron_ingot', 'flint'], 'tools');

// --- dyes / wool ----------------------------------------------------------
shapeless('red_dye', 1, ['poppy'], 'materials');
shapeless('yellow_dye', 1, ['dandelion'], 'materials');
shapeless('blue_dye', 1, ['lapis_lazuli'], 'materials');
shapeless('black_dye', 1, ['coal'], 'materials');
const DYED_WOOL: readonly { wool: string; dye: string }[] = [
  { wool: 'white_wool', dye: 'red_dye' },
  { wool: 'white_wool', dye: 'yellow_dye' },
  { wool: 'white_wool', dye: 'blue_dye' },
  { wool: 'white_wool', dye: 'black_dye' },
];
const WOOL_RESULTS = ['red_wool', 'yellow_wool', 'blue_wool', 'black_wool'];
DYED_WOOL.forEach((entry, index) => {
  shapeless(WOOL_RESULTS[index], 1, [entry.wool, entry.dye], 'building');
});
for (const wool of ['white_wool', 'red_wool', 'yellow_wool', 'blue_wool', 'black_wool']) {
  shapeless('string', 4, [wool], 'materials');
}

// --- smelting -------------------------------------------------------------
smelt('raw_iron', 'iron_ingot', 1, 0.7);
smelt('raw_gold', 'gold_ingot', 1, 1.0);
smelt('raw_copper', 'copper_ingot', 1, 0.7);
smelt('raw_porkchop', 'cooked_porkchop', 1, 0.35);
smelt('raw_beef', 'steak', 1, 0.35);
smelt('raw_chicken', 'cooked_chicken', 1, 0.35);
smelt('raw_mutton', 'cooked_mutton', 1, 0.35);
smelt('sand', 'glass', 1, 0.1);
smelt('cobblestone', 'stone', 1, 0.1);
smelt('stone', 'smooth_stone', 1, 0.1);
smelt('clay_ball', 'brick', 1, 0.3);
smelt('oak_log', 'charcoal', 1, 0.15);
smelt('birch_log', 'charcoal', 1, 0.15);
smelt('spruce_log', 'charcoal', 1, 0.15);

// --- fuel table -----------------------------------------------------------
/** Items that burn but have no `fuelTicks` in the item registry. */
const FUEL_OVERRIDES: Readonly<Record<string, number>> = {
  oak_planks: 300,
  birch_planks: 300,
  spruce_planks: 300,
  oak_log: 300,
  birch_log: 300,
  spruce_log: 300,
  crafting_table: 300,
  chest: 300,
  bookshelf: 300,
  white_wool: 100,
  red_wool: 100,
  yellow_wool: 100,
  blue_wool: 100,
  black_wool: 100,
  wooden_pickaxe: 200,
  wooden_axe: 200,
  wooden_shovel: 200,
  wooden_sword: 200,
  coal_block: 16000,
};

/** Burn time of one unit of `item` in ticks (0 = not a fuel). */
export function fuelTicks(item: string | null | undefined): number {
  if (!item) return 0;
  const override = FUEL_OVERRIDES[item];
  if (override !== undefined) return override;
  return getItem(item)?.fuelTicks ?? 0;
}

export function isFuel(item: string | null | undefined): boolean {
  return fuelTicks(item) > 0;
}

// ---------------------------------------------------------------------------
// Lookup / validation
// ---------------------------------------------------------------------------

export function allCraftingRecipes(): readonly CraftingRecipe[] {
  return [...SHAPED, ...SHAPELESS];
}

export function allSmeltingRecipes(): readonly SmeltingRecipe[] {
  return SMELTING;
}

export function craftingRecipeCount(): number {
  return SHAPED.length + SHAPELESS.length;
}

export function smeltingRecipeCount(): number {
  return SMELTING.length;
}

export function recipeById(id: string): CraftingRecipe | undefined {
  return allCraftingRecipes().find((recipe) => recipe.id === id);
}

export function recipesForResult(item: string): CraftingRecipe[] {
  return allCraftingRecipes().filter((recipe) => recipe.result.item === item);
}

const SMELTING_BY_INPUT = new Map<string, SmeltingRecipe>();
for (const recipe of SMELTING) {
  if (!SMELTING_BY_INPUT.has(recipe.input)) SMELTING_BY_INPUT.set(recipe.input, recipe);
}

export function findSmeltingRecipe(input: string | null | undefined): SmeltingRecipe | undefined {
  if (!input) return undefined;
  return SMELTING_BY_INPUT.get(input);
}

export function smeltingOutputFor(input: string | null | undefined): ItemStackSpec | undefined {
  return findSmeltingRecipe(input)?.output;
}

/** Total amount of every ingredient needed by a recipe. */
export function recipeRequirements(recipe: CraftingRecipe): Map<string, number> {
  const required = new Map<string, number>();
  if (recipe.kind === 'shaped') {
    for (const row of recipe.pattern) {
      for (const ch of row) {
        const item = recipe.key[ch];
        if (!item) continue;
        required.set(item, (required.get(item) ?? 0) + 1);
      }
    }
  } else {
    for (const ingredient of recipe.ingredients) {
      required.set(ingredient.item, (required.get(ingredient.item) ?? 0) + ingredient.count);
    }
  }
  return required;
}

/** Validate that every recipe references real items and valid pattern keys. */
export function validateRecipeRegistry(): string[] {
  const errors: string[] = [];
  const known = new Set(allItems().map((item) => item.id));
  const ids = new Set<string>();
  for (const recipe of allCraftingRecipes()) {
    if (ids.has(recipe.id)) errors.push(`duplicate recipe id: ${recipe.id}`);
    ids.add(recipe.id);
    if (!known.has(recipe.result.item)) errors.push(`${recipe.id}: unknown result item ${recipe.result.item}`);
    if (recipe.result.count <= 0) errors.push(`${recipe.id}: non-positive result count`);
    if (recipe.kind === 'shaped') {
      if (recipe.pattern.length === 0) errors.push(`${recipe.id}: empty pattern`);
      if (recipe.pattern.length > MAX_GRID_SIZE) errors.push(`${recipe.id}: pattern taller than 3`);
      const width = recipe.pattern[0]?.length ?? 0;
      if (width > MAX_GRID_SIZE) errors.push(`${recipe.id}: pattern wider than 3`);
      const usedKeys = new Set<string>();
      for (const row of recipe.pattern) {
        if (row.length !== width) errors.push(`${recipe.id}: ragged pattern row`);
        for (const ch of row) {
          if (ch === ' ') continue;
          usedKeys.add(ch);
          const item = recipe.key[ch];
          if (!item) errors.push(`${recipe.id}: pattern key '${ch}' has no ingredient`);
          else if (!known.has(item)) errors.push(`${recipe.id}: unknown ingredient ${item}`);
        }
      }
      for (const ch of Object.keys(recipe.key)) {
        if (!usedKeys.has(ch)) errors.push(`${recipe.id}: unused pattern key '${ch}'`);
      }
    } else {
      if (recipe.ingredients.length === 0) errors.push(`${recipe.id}: empty shapeless recipe`);
      if (recipe.ingredients.length > MAX_GRID_SIZE * MAX_GRID_SIZE) errors.push(`${recipe.id}: too many ingredients`);
      for (const ingredient of recipe.ingredients) {
        if (!known.has(ingredient.item)) errors.push(`${recipe.id}: unknown ingredient ${ingredient.item}`);
        if (ingredient.count <= 0) errors.push(`${recipe.id}: non-positive ingredient count`);
      }
    }
  }
  for (const recipe of SMELTING) {
    if (!known.has(recipe.input)) errors.push(`${recipe.id}: unknown smelting input ${recipe.input}`);
    if (!known.has(recipe.output.item)) errors.push(`${recipe.id}: unknown smelting output ${recipe.output.item}`);
  }
  for (const item of Object.keys(FUEL_OVERRIDES)) {
    if (!known.has(item)) errors.push(`fuel override for unknown item ${item}`);
  }
  return errors;
}

// ---------------------------------------------------------------------------
// Grid matching
// ---------------------------------------------------------------------------

function cellItem(cell: Slot | string | null | undefined): string | null {
  if (!cell) return null;
  if (typeof cell === 'string') return cell === 'air' ? null : cell;
  if (!cell.item || cell.item === 'air' || cell.count <= 0) return null;
  return cell.item;
}

/** Read a row-major item-id matrix from a loose grid. */
export function readGridItems(grid: RecipeGrid, size: number): (string | null)[] {
  const cells: (string | null)[] = [];
  for (let i = 0; i < size * size; i++) cells.push(cellItem(grid[i]));
  return cells;
}

interface Bounds {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
  width: number;
  height: number;
}

function boundsOf(cells: readonly (string | null)[], size: number): Bounds | null {
  let minX = size;
  let minY = size;
  let maxX = -1;
  let maxY = -1;
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      if (cells[y * size + x]) {
        minX = Math.min(minX, x);
        maxX = Math.max(maxX, x);
        minY = Math.min(minY, y);
        maxY = Math.max(maxY, y);
      }
    }
  }
  if (maxX < 0) return null;
  return { minX, minY, maxX, maxY, width: maxX - minX + 1, height: maxY - minY + 1 };
}

/** True when the recipe's pattern can fit inside a grid of `size`. */
export function recipeFitsSize(recipe: CraftingRecipe, size: number): boolean {
  if (recipe.kind === 'shaped') {
    return recipe.pattern.length <= size && (recipe.pattern[0]?.length ?? 0) <= size;
  }
  return recipe.ingredients.length <= size * size;
}

function matchShaped(recipe: ShapedRecipe, cells: readonly (string | null)[], size: number): boolean {
  const bounds = boundsOf(cells, size);
  if (!bounds) return false;
  if (bounds.width !== (recipe.pattern[0]?.length ?? 0) || bounds.height !== recipe.pattern.length) return false;
  const attempts = recipe.mirror ? 2 : 1;
  for (let attempt = 0; attempt < attempts; attempt++) {
    const mirror = attempt === 1;
    let ok = true;
    for (let y = 0; y < bounds.height && ok; y++) {
      const row = recipe.pattern[y];
      for (let x = 0; x < bounds.width; x++) {
        const ch = mirror ? row[bounds.width - 1 - x] : row[x];
        const expected = ch && ch !== ' ' ? (recipe.key[ch] ?? null) : null;
        const actual = cells[(bounds.minY + y) * size + bounds.minX + x];
        if (expected !== actual) {
          ok = false;
          break;
        }
      }
    }
    if (ok) return true;
  }
  return false;
}

function matchShapeless(recipe: ShapelessRecipe, cells: readonly (string | null)[]): boolean {
  const present = new Map<string, number>();
  for (const cell of cells) {
    if (!cell) continue;
    present.set(cell, (present.get(cell) ?? 0) + 1);
  }
  const wanted = recipeRequirements(recipe);
  if (present.size !== wanted.size) return false;
  for (const [item, count] of wanted) {
    if ((present.get(item) ?? 0) !== count) return false;
  }
  return true;
}

/** Match one recipe against a grid of the given size. */
export function matchRecipe(recipe: CraftingRecipe, grid: RecipeGrid, size: number): boolean {
  if (!recipeFitsSize(recipe, size)) return false;
  const cells = readGridItems(grid, size);
  if (cells.every((cell) => cell === null)) return false;
  return recipe.kind === 'shaped' ? matchShaped(recipe, cells, size) : matchShapeless(recipe, cells);
}

/** All recipes that fit a grid of the given size. */
export function recipesForSize(size: number): CraftingRecipe[] {
  return allCraftingRecipes().filter((recipe) => recipeFitsSize(recipe, size));
}

/** First recipe matching the grid content (no consumption). */
export function findCraftingRecipe(grid: RecipeGrid, size: number): CraftingRecipe | null {
  const cells = readGridItems(grid, size);
  if (cells.every((cell) => cell === null)) return null;
  for (const recipe of allCraftingRecipes()) {
    if (!recipeFitsSize(recipe, size)) continue;
    const matched = recipe.kind === 'shaped' ? matchShaped(recipe, cells, size) : matchShapeless(recipe, cells);
    if (matched) return recipe;
  }
  return null;
}

// Convenience wrappers used by the UI / tests.
export function canCraft(grid: RecipeGrid, size: number): boolean {
  return findCraftingRecipe(grid, size) !== null;
}
