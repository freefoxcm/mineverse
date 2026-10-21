/** Creative inventory: category tabs + search + all items + hotbar. */
import type { ItemDef } from '../../world/items';
import { allItems, getItem } from '../../world/items';
import { itemStackLimit } from '../../inventory/inventory';
import type { GameUi } from '../gameUi';
import { getItemIcon } from '../icons';
import { createButton, el } from '../widgets';
import { BaseScreen, inventorySlotHandle } from './base';

type CreativeCategory = 'all' | 'building' | 'decoration' | 'tools' | 'combat' | 'food' | 'materials' | 'misc';

const CATEGORIES: readonly { id: CreativeCategory; label: string }[] = [
  { id: 'all', label: '全部' },
  { id: 'building', label: '建筑' },
  { id: 'decoration', label: '装饰' },
  { id: 'tools', label: '工具' },
  { id: 'combat', label: '战斗' },
  { id: 'food', label: '食物' },
  { id: 'materials', label: '材料' },
  { id: 'misc', label: '杂项' },
];

const DECORATION_BLOCKS = new Set([
  'tall_grass',
  'poppy',
  'dandelion',
  'dead_bush',
  'sugar_cane',
  'cactus',
  'oak_leaves',
  'birch_leaves',
  'spruce_leaves',
  'torch',
  'glass',
  'bookshelf',
  'crafting_table',
  'furnace',
  'lit_furnace',
  'chest',
  'white_wool',
  'red_wool',
  'yellow_wool',
  'blue_wool',
  'black_wool',
]);

interface CreativeEntry {
  id: string;
  name: string;
  category: CreativeCategory;
}

function categoryOf(def: ItemDef): CreativeCategory {
  if (def.kind === 'block') return DECORATION_BLOCKS.has(def.id) ? 'decoration' : 'building';
  switch (def.kind) {
    case 'tool':
      return 'tools';
    case 'weapon':
    case 'armor':
      return 'combat';
    case 'food':
      return 'food';
    case 'material':
      return 'materials';
    default:
      return 'misc';
  }
}

function buildEntries(): CreativeEntry[] {
  const entries: CreativeEntry[] = [];
  for (const def of allItems()) {
    if (def.id === 'air') continue;
    if (itemStackLimit(def.id) <= 0) continue;
    entries.push({ id: def.id, name: def.name, category: categoryOf(def) });
  }
  return entries.sort((a, b) => a.name.localeCompare(b.name, 'zh-CN'));
}

export class CreativeScreen extends BaseScreen {
  private readonly entries = buildEntries();
  private readonly itemsEl: HTMLElement;
  private readonly tabsEl: HTMLElement;
  private readonly statusEl: HTMLElement;
  private readonly searchInput: HTMLInputElement;
  private category: CreativeCategory = 'all';
  private search = '';
  private tabButtons = new Map<CreativeCategory, HTMLButtonElement>();

  constructor(ui: GameUi) {
    super(ui, 'creative', 'overlay', 'creative');
    this.addTitle('创造物品栏');

    // Automation slot order: hotbar 0-8 (item buttons are not slot handles).
    const hotbarGrid = this.grid('mv-hotbar-grid mv-creative-hotbar', 9);
    for (let i = 0; i < 9; i++) {
      hotbarGrid.appendChild(this.addSlot(inventorySlotHandle(ui, i), 'mv-inventory-hotbar-slot'));
    }

    const header = el('div', 'mv-creative-header');
    this.searchInput = el('input', 'mv-input mv-creative-search') as HTMLInputElement;
    this.searchInput.type = 'text';
    this.searchInput.placeholder = '搜索物品（名称 / id）…';
    this.searchInput.spellcheck = false;
    this.searchInput.addEventListener('input', () => {
      this.search = this.searchInput.value.trim().toLowerCase();
      this.renderItems();
    });
    this.statusEl = el('div', 'mv-creative-status');
    header.append(this.searchInput, this.statusEl);

    this.tabsEl = el('div', 'mv-creative-tabs');
    for (const category of CATEGORIES) {
      const button = createButton(category.label, () => {
        this.category = category.id;
        this.syncTabs();
        this.renderItems();
      }, { className: 'mv-option-button mv-creative-tab' });
      if (category.id === this.category) button.classList.add('mv-selected');
      this.tabButtons.set(category.id, button);
      this.tabsEl.appendChild(button);
    }

    this.itemsEl = el('div', 'mv-creative-items');
    const footer = el('div', 'mv-creative-footer');
    footer.append(
      createButton('清空背包', () => {
        if (!window.confirm('确定清空背包中的全部物品？')) return;
        ui.bridge.getInventory().clear();
        ui.afterSlotChange();
      }, { className: 'mv-button-danger' }),
      createButton('完成', () => ui.closeScreen(), { className: 'mv-button-primary' }),
    );

    this.panel.classList.add('mv-panel-creative');
    this.panel.append(header, this.tabsEl, this.itemsEl, hotbarGrid, footer);
    this.renderItems();
  }

  protected override onRefresh(): void {
    // Slot contents are updated by BaseScreen.refresh; nothing else is dynamic.
  }

  private syncTabs(): void {
    for (const [id, button] of this.tabButtons) button.classList.toggle('mv-selected', id === this.category);
  }

  private filteredEntries(): CreativeEntry[] {
    return this.entries.filter((entry) => {
      if (this.category !== 'all' && entry.category !== this.category) return false;
      if (!this.search) return true;
      return `${entry.name} ${entry.id}`.toLowerCase().includes(this.search);
    });
  }

  private renderItems(): void {
    const entries = this.filteredEntries();
    this.itemsEl.innerHTML = '';
    for (const entry of entries) {
      const button = el('div', 'mv-creative-item');
      button.dataset.item = entry.id;
      const iconUrl = getItemIcon(entry.id);
      if (iconUrl) {
        const image = el('img', 'mv-creative-item-icon');
        image.src = iconUrl;
        button.appendChild(image);
      }
      button.appendChild(el('span', 'mv-creative-item-name', entry.name));
      button.addEventListener('mouseenter', () => {
        const def = getItem(entry.id);
        const lines = [entry.name];
        if (def?.tool) lines.push(`工具 · 耐久 ${def.tool.durability}`);
        else if (def?.armor) lines.push(`护甲 · ${def.armor.points} 点`);
        else if (def?.food) lines.push(`食物 · 恢复 ${def.food.hunger}`);
        else if (def?.block) lines.push('方块');
        else lines.push('材料');
        lines.push(`id: ${entry.id}`);
        this.ui.showTooltip(lines);
      });
      button.addEventListener('mouseleave', () => this.ui.hideTooltip());
      button.addEventListener('mousedown', (event) => {
        event.stopPropagation();
        event.preventDefault();
        const limit = itemStackLimit(entry.id);
        const count = event.button === 2 ? 1 : Math.max(1, limit);
        this.ui.setCursorStack({ item: entry.id, count });
      });
      button.addEventListener('contextmenu', (event) => event.preventDefault());
      this.itemsEl.appendChild(button);
    }
    this.statusEl.textContent = `${entries.length} 种物品 · 点击放入光标，再点击快捷栏存放`;
    if (entries.length === 0) this.itemsEl.appendChild(el('div', 'mv-creative-empty', '没有匹配的物品'));
  }
}
