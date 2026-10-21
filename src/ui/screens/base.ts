/**
 * Screen framework: every UI panel implements `Screen`. Screens only build DOM
 * and expose `SlotHandle`s; all click/hover/cursor logic lives in `GameUi`.
 */
import type { Slot } from '../../core/types';
import { addToSlots, cloneSlot, createEmptySlot, isEmpty, itemStackLimit } from '../../inventory/inventory';
import { createSlotElement, el, updateSlotElement } from '../widgets';
import type { GameUi } from '../gameUi';
import type { UiScreenId } from '../bridge';

export interface SlotHandle {
  get(): Slot;
  set(slot: Slot): void;
  /** Reject items that may not be placed in this slot (armor type, output...). */
  canPlace?(slot: Slot): boolean;
  /**
   * Output slots (craft result / furnace output): produce the stack that would
   * be taken, or null when the held cursor cannot accept it. Only called for
   * non-shift clicks. Must consume inputs only when it returns a stack.
   */
  take?(cursor: Slot): Slot | null;
  /** Shift-click transfer; when omitted the stack moves into the player inventory. */
  shiftClick?(): boolean;
  /** Custom tooltip lines (first line = title). */
  tooltip?(): string[] | null;
}

export interface Screen {
  readonly id: UiScreenId;
  readonly kind: 'menu' | 'overlay';
  readonly element: HTMLElement;
  mount(): void;
  unmount(): void;
  update?(dtMs: number): void;
  onKeyDown?(event: KeyboardEvent): boolean;
  refresh?(): void;
  handleAt(index: number): SlotHandle | undefined;
  handles(): readonly SlotHandle[];
}

/** True when `result` can be merged into the cursor/hand stack. */
export function canMergeInto(cursor: Slot, result: Slot): boolean {
  if (isEmpty(cursor)) return true;
  if (cursor.item !== result.item) return false;
  return cursor.count + result.count <= Math.max(1, itemStackLimit(result.item));
}

/** Move a stack into `dest` slots, returning the leftover stack. */
export function transferInto(source: Slot, dest: Slot[]): Slot {
  const copy = cloneSlot(source);
  if (isEmpty(copy)) return createEmptySlot();
  return addToSlots(dest, copy);
}

export abstract class BaseScreen implements Screen {
  readonly element: HTMLElement;
  readonly panel: HTMLElement;
  protected readonly handlesList: SlotHandle[] = [];
  protected readonly slotElements: HTMLElement[] = [];

  constructor(
    protected readonly ui: GameUi,
    readonly id: UiScreenId,
    readonly kind: 'menu' | 'overlay',
    className: string,
  ) {
    this.element = el('div', `mv-screen mv-screen-${className}`);
    this.panel = el('div', 'mv-panel');
    this.element.appendChild(this.panel);
  }

  mount(): void {
    this.element.classList.add('mv-screen-active');
    this.refresh();
  }

  unmount(): void {
    this.element.classList.remove('mv-screen-active');
  }

  handles(): readonly SlotHandle[] {
    return this.handlesList;
  }

  handleAt(index: number): SlotHandle | undefined {
    return this.handlesList[index];
  }

  /** Re-render every slot; screens can override `onRefresh` for extra widgets. */
  refresh(): void {
    this.handlesList.forEach((handle, index) => {
      const element = this.slotElements[index];
      if (element) updateSlotElement(element, handle.get());
    });
    this.onRefresh();
  }

  protected onRefresh(): void {
    // Overridden by screens with dynamic widgets (progress bars, lists...).
  }

  onKeyDown(event: KeyboardEvent): boolean {
    if (event.code === 'KeyQ') {
      this.ui.dropHoveredOrCursor();
      return true;
    }
    const digit = /^Digit([1-9])$/.exec(event.code);
    if (digit) {
      const index = this.ui.getHoveredSlotIndex();
      if (index < 0) return false;
      const handle = this.handlesList[index];
      if (!handle) return false;
      this.ui.swapHandleWithHotbar(handle, Number(digit[1]) - 1);
      return true;
    }
    if (
      event.code === 'KeyE' &&
      this.kind === 'overlay' &&
      this.id !== 'pause' &&
      this.id !== 'options' &&
      this.id !== 'death' &&
      this.id !== 'chat'
    ) {
      this.ui.closeScreen();
      return true;
    }
    return false;
  }

  // -- DOM helpers ---------------------------------------------------------

  protected addTitle(text: string): HTMLElement {
    const title = el('div', 'mv-screen-title', text);
    this.element.insertBefore(title, this.panel);
    return title;
  }

  protected addSlot(handle: SlotHandle, extraClass = ''): HTMLElement {
    const index = this.handlesList.length;
    this.handlesList.push(handle);
    const element = createSlotElement(extraClass ? `mv-grid-slot ${extraClass}` : 'mv-grid-slot');
    element.dataset.slotIndex = String(index);
    this.slotElements.push(element);
    return element;
  }

  protected grid(className: string, columns: number): HTMLElement {
    const element = el('div', `mv-grid ${className}`.trim());
    element.style.gridTemplateColumns = `repeat(${columns}, var(--mv-slot-size))`;
    return element;
  }

  /** Standard 27-slot main inventory grid + 9-slot hotbar row. */
  protected buildInventoryGrids(options: {
    mainHandles: (index: number) => SlotHandle;
    hotbarHandles: (index: number) => SlotHandle;
    mainClass?: string;
  }): { main: HTMLElement; hotbar: HTMLElement } {
    const main = this.grid(`mv-main-grid ${options.mainClass ?? ''}`.trim(), 9);
    for (let i = 0; i < 27; i++) main.appendChild(this.addSlot(options.mainHandles(i)));
    const hotbar = this.grid('mv-hotbar-grid', 9);
    for (let i = 0; i < 9; i++) hotbar.appendChild(this.addSlot(options.hotbarHandles(i), 'mv-inventory-hotbar-slot'));
    return { main, hotbar };
  }

  close(): void {
    this.ui.closeScreen();
  }
}

/** Player main-inventory slot handle: `index` is 0..35 (hotbar first). */
export function inventorySlotHandle(ui: GameUi, index: number): SlotHandle {
  const inventory = ui.bridge.getInventory();
  return {
    get: () => inventory.slots[index],
    set: (slot) => {
      inventory.slots[index] = slot;
    },
    shiftClick: () => {
      const moved = inventory.quickMove(index);
      if (moved) ui.afterSlotChange();
      return moved;
    },
  };
}
