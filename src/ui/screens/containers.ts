/** Inventory (2x2 crafting + armor), crafting table (3x3 + recipe book), chest and furnace screens. */
import type { Slot } from '../../core/types';
import {
  addToSlots,
  cloneSlot,
  createEmptySlot,
  isEmpty,
  itemStackLimit,
  slotDurability,
} from '../../inventory/inventory';
import {
  CraftingGrid,
  canCraftFromInventory,
  clearGridIntoInventory,
  craftFromGrid,
  fillGridFromRecipe,
  peekCraftResult,
} from '../../inventory/crafting';
import {
  type ChestAccess,
  type ContainerAccess,
  type FurnaceAccess,
  createStandaloneChestAccess,
  createStandaloneFurnaceAccess,
  furnaceBurnProgress,
  furnaceCookProgress,
  isFurnaceLit,
} from '../../inventory/blockEntities';
import { getItem } from '../../world/items';
import { fuelTicks, findSmeltingRecipe, recipeRequirements, recipesForSize, type CraftingRecipe } from '../../inventory/recipes';
import type { GameUi } from '../gameUi';
import { getItemIcon } from '../icons';
import { createButton, el, itemTooltipLines } from '../widgets';
import { BaseScreen, canMergeInto, inventorySlotHandle, type SlotHandle } from './base';

function itemName(itemId: string | null): string {
  if (!itemId) return '空';
  return getItem(itemId)?.name ?? itemId;
}

function clearSlot(slot: Slot): void {
  slot.item = null;
  slot.count = 0;
  slot.durability = undefined;
  slot.tag = undefined;
}

/** Crafting grid cell: items can be picked/placed; shift-click returns to the bag. */
function craftCellHandle(ui: GameUi, grid: CraftingGrid, index: number): SlotHandle {
  return {
    get: () => grid.slots[index] ?? createEmptySlot(),
    set: (slot) => {
      grid.slots[index] = slot;
    },
    shiftClick: () => {
      const slot = grid.slots[index];
      if (!slot || isEmpty(slot)) return false;
      const inventory = ui.bridge.getInventory();
      grid.slots[index] = addToSlots(inventory.slots, slot);
      return true;
    },
  };
}

/** Craft result: preview, take (consumes grid) or shift-craft into the bag. */
function craftResultHandle(ui: GameUi, grid: CraftingGrid): SlotHandle {
  return {
    get: () => peekCraftResult(grid.slots, grid.size) ?? createEmptySlot(),
    set: () => undefined,
    canPlace: () => false,
    take: (cursor) => {
      const preview = peekCraftResult(grid.slots, grid.size);
      if (!preview || !canMergeInto(cursor, preview)) return null;
      const crafted = craftFromGrid(grid.slots, grid.size);
      return crafted ? crafted.result : null;
    },
    shiftClick: () => {
      const preview = peekCraftResult(grid.slots, grid.size);
      if (!preview) return false;
      const inventory = ui.bridge.getInventory();
      const leftover = addToSlots(inventory.slots, preview);
      if (!isEmpty(leftover)) return false;
      craftFromGrid(grid.slots, grid.size);
      return true;
    },
    tooltip: () => {
      const recipe = grid.match();
      if (!recipe) return ['合成结果', '把材料摆成配方形状'];
      return [...itemTooltipLines(recipe.result.item), '左键取出 / Shift 一键合成'];
    },
  };
}

function armorSlotHandle(ui: GameUi, index: number): SlotHandle {
  const inventory = ui.bridge.getInventory();
  return {
    get: () => inventory.armor[index] ?? createEmptySlot(),
    set: (slot) => {
      inventory.armor[index] = slot;
    },
    canPlace: (slot) => {
      if (!slot.item) return true;
      const spec = getItem(slot.item)?.armor;
      return spec !== undefined && spec.slot === index;
    },
    shiftClick: () => inventory.unequipArmor(index),
  };
}

/** Build the player preview silhouette (pure CSS, no external images). */
function createPlayerPreview(): HTMLElement {
  const figure = el('div', 'mv-player-preview');
  const inner = el('div', 'mv-player-figure');
  inner.append(
    el('div', 'mv-player-head'),
    el('div', 'mv-player-body'),
    el('div', 'mv-player-arm mv-player-arm-left'),
    el('div', 'mv-player-arm mv-player-arm-right'),
    el('div', 'mv-player-leg mv-player-leg-left'),
    el('div', 'mv-player-leg mv-player-leg-right'),
  );
  figure.appendChild(inner);
  figure.appendChild(el('div', 'mv-player-caption', '玩家'));
  return figure;
}

// ---------------------------------------------------------------------------
// Inventory screen (36 + armor + 2x2 crafting)
// ---------------------------------------------------------------------------

export class InventoryScreen extends BaseScreen {
  private readonly craftGrid = new CraftingGrid(2);

  constructor(ui: GameUi) {
    super(ui, 'inventory', 'overlay', 'inventory');
    this.addTitle('背包');

    // Slot order for automation: hotbar 0-8, main 9-35, armor 36-39,
    // crafting grid 40-43, result 44.
    const hotbarEls: HTMLElement[] = [];
    for (let i = 0; i < 9; i++) hotbarEls.push(this.addSlot(inventorySlotHandle(ui, i), 'mv-inventory-hotbar-slot'));
    const mainEls: HTMLElement[] = [];
    for (let i = 0; i < 27; i++) mainEls.push(this.addSlot(inventorySlotHandle(ui, 9 + i)));
    const armorEls: HTMLElement[] = [];
    for (let i = 0; i < 4; i++) armorEls.push(this.addSlot(armorSlotHandle(ui, i), 'mv-armor-slot'));
    const craftEls: HTMLElement[] = [];
    for (let i = 0; i < 4; i++) craftEls.push(this.addSlot(craftCellHandle(ui, this.craftGrid, i)));
    const resultEl = this.addSlot(craftResultHandle(ui, this.craftGrid), 'mv-result-slot');

    // Layout: craft block | player (armor + preview) on top; main grid + hotbar below.
    const top = el('div', 'mv-inventory-top');
    const craftBlock = el('div', 'mv-crafting-block');
    const craftGrid = this.grid('mv-craft-grid mv-craft-grid-2', 2);
    craftGrid.append(...craftEls);
    craftBlock.append(craftGrid, el('div', 'mv-craft-arrow'), resultEl);
    const playerBlock = el('div', 'mv-player-block');
    const armorColumn = el('div', 'mv-armor-column');
    armorColumn.append(...armorEls);
    playerBlock.append(armorColumn, createPlayerPreview());
    top.append(craftBlock, playerBlock);

    const mainGrid = this.grid('mv-main-grid', 9);
    mainGrid.append(...mainEls);
    const hotbarGrid = this.grid('mv-hotbar-grid', 9);
    hotbarGrid.append(...hotbarEls);

    this.panel.append(top, mainGrid, hotbarGrid);
    this.panel.classList.add('mv-panel-inventory');
  }

  override unmount(): void {
    const leftovers = clearGridIntoInventory(this.craftGrid.slots, this.craftGrid.size, this.ui.bridge.getInventory());
    for (const leftover of leftovers) {
      if (leftover.item) this.ui.bridge.dropItem(leftover.item, leftover.count, leftover.durability);
    }
    super.unmount();
  }
}

// ---------------------------------------------------------------------------
// Crafting table screen (3x3 + recipe book)
// ---------------------------------------------------------------------------

interface RecipeBookState {
  onlyCraftable: boolean;
  search: string;
}

export class CraftingScreen extends BaseScreen {
  private readonly craftGrid = new CraftingGrid(3);
  private readonly book: RecipeBookState = { onlyCraftable: false, search: '' };
  private readonly recipeListEl: HTMLElement;
  private readonly bookStatusEl: HTMLElement;
  private readonly allButton: HTMLButtonElement;
  private readonly craftableButton: HTMLButtonElement;

  constructor(ui: GameUi) {
    super(ui, 'crafting', 'overlay', 'crafting');
    this.addTitle('工作台');

    // Slot order: crafting 0-8, result 9, main 10-36, hotbar 37-45.
    const craftEls: HTMLElement[] = [];
    for (let i = 0; i < 9; i++) craftEls.push(this.addSlot(craftCellHandle(ui, this.craftGrid, i)));
    const resultEl = this.addSlot(craftResultHandle(ui, this.craftGrid), 'mv-result-slot');
    const mainEls: HTMLElement[] = [];
    for (let i = 0; i < 27; i++) mainEls.push(this.addSlot(inventorySlotHandle(ui, 9 + i)));
    const hotbarEls: HTMLElement[] = [];
    for (let i = 0; i < 9; i++) hotbarEls.push(this.addSlot(inventorySlotHandle(ui, i), 'mv-inventory-hotbar-slot'));

    const left = el('div', 'mv-crafting-left');
    const craftBlock = el('div', 'mv-crafting-block mv-crafting-block-3');
    const craftGrid = this.grid('mv-craft-grid mv-craft-grid-3', 3);
    craftGrid.append(...craftEls);
    craftBlock.append(craftGrid, el('div', 'mv-craft-arrow'), resultEl);
    left.appendChild(craftBlock);

    // Recipe book panel.
    const bookPanel = el('div', 'mv-recipe-book');
    bookPanel.appendChild(el('div', 'mv-recipe-book-title', '配方书'));
    const filterRow = el('div', 'mv-recipe-filter');
    this.allButton = createButton('全部', () => {
      this.book.onlyCraftable = false;
      this.syncFilterButtons();
      this.renderBook();
    }, { className: 'mv-option-button mv-selected' });
    this.craftableButton = createButton('可合成', () => {
      this.book.onlyCraftable = true;
      this.syncFilterButtons();
      this.renderBook();
    }, { className: 'mv-option-button' });
    filterRow.append(this.allButton, this.craftableButton);
    const search = el('input', 'mv-input mv-recipe-search') as HTMLInputElement;
    search.type = 'text';
    search.placeholder = '搜索配方…';
    search.spellcheck = false;
    search.addEventListener('input', () => {
      this.book.search = search.value.trim().toLowerCase();
      this.renderBook();
    });
    this.bookStatusEl = el('div', 'mv-recipe-status');
    this.recipeListEl = el('div', 'mv-recipe-list');
    bookPanel.append(filterRow, search, this.bookStatusEl, this.recipeListEl);
    left.appendChild(bookPanel);

    const right = el('div', 'mv-crafting-right');
    const mainGrid = this.grid('mv-main-grid', 9);
    mainGrid.append(...mainEls);
    const hotbarGrid = this.grid('mv-hotbar-grid', 9);
    hotbarGrid.append(...hotbarEls);
    right.append(mainGrid, hotbarGrid);

    this.panel.append(left, right);
    this.panel.classList.add('mv-panel-crafting');
    this.renderBook();
  }

  private syncFilterButtons(): void {
    this.allButton.classList.toggle('mv-selected', !this.book.onlyCraftable);
    this.craftableButton.classList.toggle('mv-selected', this.book.onlyCraftable);
  }

  protected override onRefresh(): void {
    this.renderBook();
  }

  private renderBook(): void {
    if (!this.recipeListEl) return;
    const inventory = this.ui.bridge.getInventory();
    const recipes = recipesForSize(3).filter((recipe) => {
      if (this.book.onlyCraftable && !canCraftFromInventory(recipe, inventory)) return false;
      if (!this.book.search) return true;
      const name = getItem(recipe.result.item)?.name ?? recipe.result.item;
      return `${name} ${recipe.result.item}`.toLowerCase().includes(this.book.search);
    });
    this.recipeListEl.innerHTML = '';
    let craftableCount = 0;
    for (const recipe of recipes) {
      const craftable = canCraftFromInventory(recipe, inventory);
      if (craftable) craftableCount++;
      this.recipeListEl.appendChild(this.createRecipeRow(recipe, craftable));
    }
    this.bookStatusEl.textContent = `${recipes.length} 条配方 · 可合成 ${craftableCount} 条`;
  }

  private createRecipeRow(recipe: CraftingRecipe, craftable: boolean): HTMLElement {
    const row = el('div', `mv-recipe-entry${craftable ? ' mv-craftable' : ''}`);
    const iconUrl = getItemIcon(recipe.result.item);
    const icon = el('img', 'mv-recipe-icon');
    if (iconUrl) icon.src = iconUrl;
    row.appendChild(icon);
    const name = el('span', 'mv-recipe-name', getItem(recipe.result.item)?.name ?? recipe.result.item);
    row.appendChild(name);
    if (recipe.result.count > 1) row.appendChild(el('span', 'mv-recipe-count', `×${recipe.result.count}`));
    row.addEventListener('mouseenter', () => {
      this.ui.showTooltip(this.recipeTooltip(recipe, craftable));
    });
    row.addEventListener('mouseleave', () => this.ui.hideTooltip());
    if (craftable) {
      row.addEventListener('mousedown', (event) => {
        event.stopPropagation();
        this.autoFill(recipe);
      });
    }
    return row;
  }

  private recipeTooltip(recipe: CraftingRecipe, craftable: boolean): string[] {
    const lines = [`${getItem(recipe.result.item)?.name ?? recipe.result.item} ×${recipe.result.count}`];
    const requirements = recipeRequirements(recipe);
    for (const [item, count] of requirements) {
      lines.push(`${itemName(item)} ×${count}`);
    }
    lines.push(craftable ? '点击填入合成网格' : '材料不足');
    return lines;
  }

  private autoFill(recipe: CraftingRecipe): void {
    const inventory = this.ui.bridge.getInventory();
    if (!fillGridFromRecipe(recipe, this.craftGrid.slots, 3, inventory)) {
      this.ui.toast('材料不足或合成格已被占用', 'warn');
      return;
    }
    this.ui.afterSlotChange();
  }

  override unmount(): void {
    const leftovers = clearGridIntoInventory(this.craftGrid.slots, this.craftGrid.size, this.ui.bridge.getInventory());
    for (const leftover of leftovers) {
      if (leftover.item) this.ui.bridge.dropItem(leftover.item, leftover.count, leftover.durability);
    }
    super.unmount();
  }
}

// ---------------------------------------------------------------------------
// Chest screen
// ---------------------------------------------------------------------------

export class ChestScreen extends BaseScreen {
  private readonly access: ChestAccess;

  constructor(ui: GameUi, access?: ContainerAccess) {
    super(ui, 'chest', 'overlay', 'chest');
    this.access = access && access.kind === 'chest' ? access : createStandaloneChestAccess();
    this.addTitle('箱子');
    const chest = this.access;
    const inventory = ui.bridge.getInventory();

    // Slot order: chest 0-26, main 27-53, hotbar 54-62.
    const chestGrid = this.grid('mv-main-grid mv-chest-grid', 9);
    for (let i = 0; i < 27; i++) {
      const handle: SlotHandle = {
        get: () => chest.slots[i] ?? createEmptySlot(),
        set: (slot) => {
          chest.slots[i] = slot;
          chest.onChange();
        },
        shiftClick: () => {
          const slot = chest.slots[i];
          if (!slot || isEmpty(slot)) return false;
          chest.slots[i] = addToSlots(inventory.slots, slot);
          chest.onChange();
          return true;
        },
      };
      chestGrid.appendChild(this.addSlot(handle));
    }
    const mainEls: HTMLElement[] = [];
    for (let i = 0; i < 27; i++) mainEls.push(this.addSlot(this.chestToInventoryHandle(inventory.slots, 9 + i)));
    const hotbarEls: HTMLElement[] = [];
    for (let i = 0; i < 9; i++) hotbarEls.push(this.addSlot(this.chestToInventoryHandle(inventory.slots, i), 'mv-inventory-hotbar-slot'));

    const mainGrid = this.grid('mv-main-grid', 9);
    mainGrid.append(...mainEls);
    const hotbarGrid = this.grid('mv-hotbar-grid', 9);
    hotbarGrid.append(...hotbarEls);

    this.panel.append(chestGrid, mainGrid, hotbarGrid);
    this.panel.classList.add('mv-panel-chest');
  }

  private chestToInventoryHandle(playerSlots: Slot[], index: number): SlotHandle {
    return {
      get: () => playerSlots[index] ?? createEmptySlot(),
      set: (slot) => {
        playerSlots[index] = slot;
      },
      shiftClick: () => {
        const slot = playerSlots[index];
        if (!slot || isEmpty(slot)) return false;
        playerSlots[index] = addToSlots(this.access.slots, slot);
        this.access.onChange();
        return true;
      },
    };
  }
}

// ---------------------------------------------------------------------------
// Furnace screen
// ---------------------------------------------------------------------------

export class FurnaceScreen extends BaseScreen {
  private readonly access: FurnaceAccess;
  private readonly flameEl: HTMLElement;
  private readonly cookEl: HTMLElement;
  private lastFlame = -1;
  private lastCook = -1;

  constructor(ui: GameUi, access?: ContainerAccess) {
    super(ui, 'furnace', 'overlay', 'furnace');
    this.access = access && access.kind === 'furnace' ? access : createStandaloneFurnaceAccess();
    this.addTitle('熔炉');
    const furnace = this.access.furnace;
    const inventory = ui.bridge.getInventory();
    const slots = furnace.slots;

    // Slot order: input 0, fuel 1, output 2, main 3-29, hotbar 30-38.
    const inputHandle: SlotHandle = {
      get: () => slots[0] ?? createEmptySlot(),
      set: (slot) => {
        slots[0] = slot;
        this.access.onChange();
      },
      shiftClick: () => this.transferToInventory(0),
    };
    const fuelHandle: SlotHandle = {
      get: () => slots[1] ?? createEmptySlot(),
      set: (slot) => {
        slots[1] = slot;
        this.access.onChange();
      },
      shiftClick: () => this.transferToInventory(1),
    };
    const outputHandle: SlotHandle = {
      get: () => slots[2] ?? createEmptySlot(),
      set: () => undefined,
      canPlace: () => false,
      take: (cursor) => {
        const output = slots[2];
        if (!output || isEmpty(output) || !canMergeInto(cursor, output)) return null;
        const taken = cloneSlot(output);
        clearSlot(output);
        furnace.experience = 0;
        this.access.onChange();
        return taken;
      },
      shiftClick: () => {
        const output = slots[2];
        if (!output || isEmpty(output)) return false;
        const leftover = addToSlots(inventory.slots, output);
        if (!isEmpty(leftover)) return false;
        clearSlot(output);
        furnace.experience = 0;
        this.access.onChange();
        return true;
      },
      tooltip: () => (isEmpty(slots[2]) ? ['烧炼产物', '把可烧炼的物品放到上方'] : [...itemTooltipLines(slots[2].item, slots[2])]),
    };

    this.flameEl = el('div', 'mv-furnace-flame');
    this.cookEl = el('div', 'mv-furnace-cook-fill');
    const arrow = el('div', 'mv-furnace-arrow');
    arrow.appendChild(this.cookEl);

    const machine = el('div', 'mv-furnace-machine');
    const leftColumn = el('div', 'mv-furnace-column');
    const inputRow = el('div', 'mv-furnace-slot-row mv-furnace-input-row');
    inputRow.appendChild(this.addSlot(inputHandle));
    const flameRow = el('div', 'mv-furnace-flame-row');
    flameRow.appendChild(this.flameEl);
    const fuelRow = el('div', 'mv-furnace-slot-row mv-furnace-fuel-row');
    fuelRow.appendChild(this.addSlot(fuelHandle));
    leftColumn.append(inputRow, flameRow, fuelRow);
    const rightColumn = el('div', 'mv-furnace-column');
    const outputRow = el('div', 'mv-furnace-slot-row mv-furnace-output-row');
    outputRow.appendChild(this.addSlot(outputHandle, 'mv-result-slot'));
    rightColumn.append(arrow, outputRow);
    machine.append(leftColumn, rightColumn);

    const mainEls: HTMLElement[] = [];
    for (let i = 0; i < 27; i++) mainEls.push(this.addSlot(this.inventoryToFurnaceHandle(9 + i)));
    const hotbarEls: HTMLElement[] = [];
    for (let i = 0; i < 9; i++) hotbarEls.push(this.addSlot(this.inventoryToFurnaceHandle(i), 'mv-inventory-hotbar-slot'));
    const mainGrid = this.grid('mv-main-grid', 9);
    mainGrid.append(...mainEls);
    const hotbarGrid = this.grid('mv-hotbar-grid', 9);
    hotbarGrid.append(...hotbarEls);

    this.panel.append(machine, mainGrid, hotbarGrid);
    this.panel.classList.add('mv-panel-furnace');
  }

  private transferToInventory(containerIndex: number): boolean {
    const inventory = this.ui.bridge.getInventory();
    const slot = this.access.furnace.slots[containerIndex];
    if (!slot || isEmpty(slot)) return false;
    this.access.furnace.slots[containerIndex] = addToSlots(inventory.slots, slot);
    this.access.onChange();
    return true;
  }

  private inventoryToFurnaceHandle(index: number): SlotHandle {
    const inventory = this.ui.bridge.getInventory();
    return {
      get: () => inventory.slots[index] ?? createEmptySlot(),
      set: (slot) => {
        inventory.slots[index] = slot;
      },
      shiftClick: () => {
        const slot = inventory.slots[index];
        if (!slot || isEmpty(slot)) return false;
        const target = this.furnaceTargetFor(slot);
        const moved = this.moveIntoSingleSlot(slot, target);
        if (moved === 0) return false;
        this.access.onChange();
        return true;
      },
    };
  }

  /** Merge/place as much as possible of `source` into furnace slot `target`. */
  private moveIntoSingleSlot(source: Slot, target: number): number {
    const dest = this.access.furnace.slots[target];
    if (!dest) return 0;
    const copy = cloneSlot(source);
    if (isEmpty(dest)) {
      this.access.furnace.slots[target] = copy;
      source.item = null;
      source.count = 0;
      source.durability = undefined;
      return copy.count;
    }
    if (dest.item !== copy.item) return 0;
    const limit = itemStackLimit(copy.item);
    if (limit <= 1) return 0;
    const space = limit - dest.count;
    const moved = Math.min(space, copy.count);
    if (moved <= 0) return 0;
    dest.count += moved;
    copy.count -= moved;
    if (copy.count <= 0) {
      source.item = null;
      source.count = 0;
      source.durability = undefined;
    } else {
      source.count = copy.count;
    }
    return moved;
  }

  /** Choose the furnace slot for a shift-clicked item: smeltable input else fuel. */
  private furnaceTargetFor(slot: Slot): number {
    if (findSmeltingRecipe(slot.item)) return 0;
    if (fuelTicks(slot.item) > 0) return 1;
    return 0;
  }

  update(): void {
    const burn = furnaceBurnProgress(this.access.furnace);
    const cook = furnaceCookProgress(this.access.furnace);
    const lit = isFurnaceLit(this.access.furnace);
    if (burn !== this.lastFlame) {
      this.lastFlame = burn;
      this.flameEl.style.height = burn > 0 ? `${Math.max(3, Math.round(burn * 18))}px` : '0px';
      this.flameEl.classList.toggle('mv-lit', lit);
    }
    if (cook !== this.lastCook) {
      this.lastCook = cook;
      this.cookEl.style.width = `${Math.round(cook * 100)}%`;
    }
  }

  protected override onRefresh(): void {
    this.update();
  }
}
