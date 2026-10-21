/**
 * Player inventory: 36 main slots (0..8 hotbar), 4 armor slots and a selected
 * hotbar slot. Pure logic — no DOM, no three.js, no world access — so it can be
 * unit tested and shared by the UI, the player and the save system.
 *
 * Slot addressing used across the codebase:
 *   slots[0..8]   hotbar (left to right)
 *   slots[9..35]  main storage
 *   armor[0..3]   helmet, chestplate, leggings, boots
 */
import { EMPTY_SLOT, type Slot } from '../core/types';
import { armorPoints, getItem, itemMaxStack } from '../world/items';

export const INVENTORY_SIZE = 36;
export const HOTBAR_SIZE = 9;
export const MAIN_SIZE = 27;
export const ARMOR_SIZE = 4;
export const MAIN_START = HOTBAR_SIZE;
export const MAIN_END = INVENTORY_SIZE;

/** Armor slot index: 0 helmet, 1 chestplate, 2 leggings, 3 boots. */
export type ArmorIndex = 0 | 1 | 2 | 3;

export interface InventoryOptions {
  /** Live slot array to wrap (shared by reference with the player). */
  slots?: Slot[];
  /** Live armor slot array to wrap. Takes precedence over `armorIds`. */
  armor?: Slot[];
  /** Player-facing armor representation: helmet..boots item ids. */
  armorIds?: readonly (string | null)[];
  selected?: number;
}

export interface InventorySaveData {
  slots: Slot[];
  armor: Slot[];
  selected: number;
}

export interface DamageResult {
  /** The destroyed stack when durability reached zero, else null. */
  broken: Slot | null;
  /** Durability remaining in the damaged slot (0 when broken/not damageable). */
  durability: number;
}

// ---------------------------------------------------------------------------
// Slot value helpers (also used by containers / crafting grids)
// ---------------------------------------------------------------------------

export function createEmptySlot(): Slot {
  return { item: null, count: 0 };
}

export function isEmpty(slot: Slot | null | undefined): boolean {
  return !slot || slot.item === null || slot.item === 'air' || slot.count <= 0;
}

export function cloneSlot(slot: Slot): Slot {
  if (isEmpty(slot)) return createEmptySlot();
  const copy: Slot = { item: slot.item, count: slot.count };
  if (slot.durability !== undefined) copy.durability = slot.durability;
  if (slot.tag) copy.tag = { ...slot.tag };
  return copy;
}

/** Max stack size for an item id (`0` for air / unknown non-stackable). */
export function itemStackLimit(item: string | null | undefined): number {
  if (!item || item === 'air') return 0;
  const def = getItem(item);
  if (!def) return 64;
  return Math.max(0, itemMaxStack(item));
}

/** Base durability of a damageable item, or undefined for stackable items. */
export function itemMaxDurability(item: string | null | undefined): number | undefined {
  if (!item) return undefined;
  const def = getItem(item);
  return def?.tool?.durability ?? def?.armor?.durability;
}

/** Resolve the durability of a slot, defaulting to the item's base durability. */
export function slotDurability(slot: Slot): number {
  if (isEmpty(slot) || !slot.item) return 0;
  return slot.durability ?? itemMaxDurability(slot.item) ?? 0;
}

export function isDamageable(item: string | null | undefined): boolean {
  return (itemMaxDurability(item) ?? 0) > 0;
}

export function slotsEqual(a: Slot, b: Slot): boolean {
  if (isEmpty(a) || isEmpty(b)) return isEmpty(a) && isEmpty(b);
  return a.item === b.item && a.count === b.count && a.durability === b.durability;
}

/** Normalize a slot: clamp counts, default durability, drop invalid items. */
export function normalizeSlot(slot: Slot): Slot {
  if (isEmpty(slot) || !slot.item) return createEmptySlot();
  const limit = itemStackLimit(slot.item);
  if (limit <= 0) return createEmptySlot();
  const normalized: Slot = { item: slot.item, count: Math.max(1, Math.min(limit, Math.floor(slot.count))) };
  const baseDurability = itemMaxDurability(slot.item);
  if (baseDurability !== undefined) {
    const durability = slot.durability ?? baseDurability;
    normalized.durability = Math.max(0, Math.min(baseDurability, Math.floor(durability)));
  } else if (slot.durability !== undefined) {
    normalized.durability = slot.durability;
  }
  if (slot.tag) normalized.tag = { ...slot.tag };
  return normalized;
}

/** Total count of an item across a slot array. */
export function countItem(slots: readonly Slot[], item: string): number {
  let total = 0;
  for (const slot of slots) {
    if (!isEmpty(slot) && slot.item === item) total += slot.count;
  }
  return total;
}

export function firstEmptyIndex(slots: readonly Slot[]): number {
  for (let i = 0; i < slots.length; i++) {
    if (isEmpty(slots[i])) return i;
  }
  return -1;
}

/**
 * Merge as much of `incoming` as possible into `slots`, visiting indices in
 * `order` (defaults to ascending). Mutates both. Returns the leftover stack
 * (empty slot when everything fit).
 */
export function addToSlots(slots: Slot[], incoming: Slot, order?: readonly number[]): Slot {
  let remaining = cloneSlot(incoming);
  if (isEmpty(remaining) || !remaining.item) return createEmptySlot();
  const limit = itemStackLimit(remaining.item);
  if (limit <= 0) return remaining;
  const indices: readonly number[] = order ?? slots.map((_slot, index) => index);

  // Pass 1: top up existing stacks of the same item.
  if (limit > 1) {
    for (const index of indices) {
      if (remaining.count <= 0) break;
      const target = slots[index];
      if (!target || isEmpty(target) || target.item !== remaining.item) continue;
      const space = limit - target.count;
      if (space <= 0) continue;
      const moved = Math.min(space, remaining.count);
      target.count += moved;
      remaining.count -= moved;
    }
  }

  // Pass 2: drop into empty slots.
  if (remaining.count > 0) {
    for (const index of indices) {
      if (remaining.count <= 0) break;
      const target = slots[index];
      if (target && !isEmpty(target)) continue;
      const moved = Math.min(limit, remaining.count);
      const placed: Slot = { item: remaining.item, count: moved };
      const baseDurability = itemMaxDurability(remaining.item);
      if (remaining.durability !== undefined) placed.durability = remaining.durability;
      else if (baseDurability !== undefined) placed.durability = baseDurability;
      if (remaining.tag) placed.tag = { ...remaining.tag };
      slots[index] = placed;
      remaining.count -= moved;
    }
  }

  return isEmpty(remaining) ? createEmptySlot() : remaining;
}

/**
 * Move/merge one stack into another single slot. Returns the number of items
 * moved. `source` is cleared when fully moved.
 */
export function mergeIntoSlot(dest: Slot, source: Slot): number {
  if (isEmpty(source) || !source.item) return 0;
  const limit = itemStackLimit(source.item);
  if (limit <= 0) return 0;
  if (isEmpty(dest)) {
    dest.item = source.item;
    dest.count = Math.min(limit, source.count);
    dest.durability = source.durability ?? itemMaxDurability(source.item);
    dest.tag = source.tag ? { ...source.tag } : undefined;
    source.count -= dest.count;
    if (source.count <= 0) {
      source.item = null;
      source.count = 0;
      source.durability = undefined;
      source.tag = undefined;
    }
    return dest.count;
  }
  if (dest.item !== source.item || limit <= 1) return 0;
  const space = limit - dest.count;
  if (space <= 0) return 0;
  const moved = Math.min(space, source.count);
  dest.count += moved;
  source.count -= moved;
  if (source.count <= 0) {
    source.item = null;
    source.count = 0;
    source.durability = undefined;
    source.tag = undefined;
  }
  return moved;
}

/** Remove up to `count` of `item` from `slots`, visiting indices in `order`. */
export function removeFromSlots(slots: Slot[], item: string, count: number, order?: readonly number[]): number {
  let removed = 0;
  const indices: readonly number[] = order ?? slots.map((_slot, index) => index);
  for (const index of indices) {
    if (removed >= count) break;
    const slot = slots[index];
    if (!slot || isEmpty(slot) || slot.item !== item) continue;
    const take = Math.min(slot.count, count - removed);
    slot.count -= take;
    removed += take;
    if (slot.count <= 0) {
      slot.item = null;
      slot.count = 0;
      slot.durability = undefined;
      slot.tag = undefined;
    }
  }
  return removed;
}

export function cloneSlots(slots: readonly Slot[], size: number): Slot[] {
  const result: Slot[] = [];
  for (let i = 0; i < size; i++) result.push(cloneSlot(slots[i] ?? EMPTY_SLOT));
  return result;
}

// ---------------------------------------------------------------------------
// Inventory
// ---------------------------------------------------------------------------

export class Inventory {
  /** 36 main slots; index 0..8 are the hotbar. Shared by reference when provided. */
  readonly slots: Slot[];
  /** 4 armor slots (helmet..boots). */
  readonly armor: Slot[];
  private selectedIndex = 0;

  constructor(options: InventoryOptions = {}) {
    this.slots = options.slots ?? [];
    for (let i = 0; i < INVENTORY_SIZE; i++) {
      if (!this.slots[i]) this.slots[i] = createEmptySlot();
      else if (!isEmpty(this.slots[i])) this.slots[i] = normalizeSlot(this.slots[i]);
    }
    if (this.slots.length > INVENTORY_SIZE) this.slots.length = INVENTORY_SIZE;

    if (options.armor) {
      this.armor = options.armor;
    } else if (options.armorIds) {
      this.armor = options.armorIds.map((id) => (id ? normalizeSlot({ item: id, count: 1 }) : createEmptySlot()));
    } else {
      this.armor = [];
    }
    for (let i = 0; i < ARMOR_SIZE; i++) {
      if (!this.armor[i]) this.armor[i] = createEmptySlot();
      else if (!isEmpty(this.armor[i])) this.armor[i] = normalizeSlot(this.armor[i]);
    }
    if (this.armor.length > ARMOR_SIZE) this.armor.length = ARMOR_SIZE;

    if (options.selected !== undefined) this.selected = options.selected;
  }

  // -- selection ------------------------------------------------------------

  get selected(): number {
    return this.selectedIndex;
  }

  set selected(index: number) {
    this.selectedIndex = this.clampSelected(index);
  }

  get selectedSlot(): Slot {
    return this.slots[this.selectedIndex];
  }

  /** Alias for `selected` (hotbar index 0..8); handy for Player sync code. */
  get selectedSlotIndex(): number {
    return this.selectedIndex;
  }

  set selectedSlotIndex(index: number) {
    this.selectedIndex = this.clampSelected(index);
  }

  /** The stack currently held in the hotbar (alias kept for Lead/Gameplay-B). */
  getHeld(): Slot {
    return this.slots[this.selectedIndex];
  }

  setSelectedSlot(index: number): number {
    this.selectedIndex = this.clampSelected(index);
    return this.selectedIndex;
  }

  private clampSelected(index: number): number {
    if (!Number.isFinite(index)) return 0;
    return Math.max(0, Math.min(HOTBAR_SIZE - 1, Math.floor(index)));
  }

  scrollSelected(delta: number): number {
    const step = delta === 0 ? 0 : delta > 0 ? 1 : -1;
    this.selectedIndex = (this.selectedIndex + step + HOTBAR_SIZE) % HOTBAR_SIZE;
    return this.selectedIndex;
  }

  slot(index: number): Slot {
    return this.slots[index] ?? createEmptySlot();
  }

  setSlot(index: number, slot: Slot): void {
    if (index < 0 || index >= INVENTORY_SIZE) return;
    this.slots[index] = normalizeSlot(slot);
  }

  hotbarSlots(): Slot[] {
    return this.slots.slice(0, HOTBAR_SIZE);
  }

  // -- adding / removing ----------------------------------------------------

  /**
   * Add items to the inventory. Merges into existing stacks starting at the
   * selected hotbar slot, then the rest of the hotbar, then main storage.
   * Returns the amount that did NOT fit (0 = success).
   */
  add(item: string, count = 1, durability?: number): number {
    if (!item || item === 'air' || count <= 0) return Math.max(0, count);
    const incoming: Slot = { item, count };
    if (durability !== undefined) incoming.durability = durability;
    const leftover = addToSlots(this.slots, incoming, this.addOrder());
    return isEmpty(leftover) ? 0 : leftover.count;
  }

  /** Add an existing stack; returns the leftover stack (empty when all fit). */
  addSlot(slot: Slot): Slot {
    if (isEmpty(slot)) return createEmptySlot();
    return addToSlots(this.slots, slot, this.addOrder());
  }

  addStack(item: string, count: number, durability?: number): boolean {
    return this.add(item, count, durability) === 0;
  }

  /** Remove up to `count` of `item`; consumes main storage before the hotbar. */
  remove(item: string, count = 1): number {
    if (!item || count <= 0) return 0;
    return removeFromSlots(this.slots, item, count, this.removeOrder());
  }

  /** Remove up to `count` items from one slot, returning the removed stack. */
  removeAt(index: number, count = Number.POSITIVE_INFINITY): Slot {
    const slot = this.slots[index];
    if (!slot || isEmpty(slot)) return createEmptySlot();
    const take = Math.max(1, Math.min(slot.count, Math.floor(count)));
    const removed: Slot = cloneSlot(slot);
    removed.count = take;
    slot.count -= take;
    if (slot.count <= 0) {
      slot.item = null;
      slot.count = 0;
      slot.durability = undefined;
      slot.tag = undefined;
    }
    return removed;
  }

  count(item: string): number {
    return countItem(this.slots, item);
  }

  has(item: string, count = 1): boolean {
    return this.count(item) >= count;
  }

  // -- queries --------------------------------------------------------------

  firstEmpty(): number {
    return firstEmptyIndex(this.slots);
  }

  isFull(): boolean {
    return this.firstEmpty() === -1;
  }

  /** True when no additional item of this id can be stored. */
  isFullFor(item: string): boolean {
    const limit = itemStackLimit(item);
    if (limit <= 0) return true;
    if (limit > 1) {
      for (const slot of this.slots) {
        if (!isEmpty(slot) && slot.item === item && slot.count < limit) return false;
      }
    }
    return this.firstEmpty() === -1;
  }

  freeCapacity(item: string): number {
    const limit = itemStackLimit(item);
    if (limit <= 0) return 0;
    let capacity = 0;
    for (const slot of this.slots) {
      if (isEmpty(slot)) capacity += limit;
      else if (slot.item === item && limit > 1) capacity += Math.max(0, limit - slot.count);
    }
    return capacity;
  }

  /** Total main slots that contain something. */
  usedSlots(): number {
    let used = 0;
    for (const slot of this.slots) if (!isEmpty(slot)) used++;
    return used;
  }

  // -- moving items ---------------------------------------------------------

  /** Swap two main slots; identical stackable items merge instead. */
  swap(a: number, b: number): void {
    if (a === b) return;
    const first = this.slots[a];
    const second = this.slots[b];
    if (!first || !second) return;
    if (!isEmpty(first) && !isEmpty(second) && first.item === second.item && itemStackLimit(first.item) > 1) {
      mergeIntoSlot(second, first);
      return;
    }
    this.slots[a] = second;
    this.slots[b] = first;
  }

  /** Move up to `count` items from one slot to another. Returns moved amount. */
  moveTo(from: number, to: number, count = Number.POSITIVE_INFINITY): number {
    if (from === to) return 0;
    const source = this.slots[from];
    const dest = this.slots[to];
    if (!source || !dest || isEmpty(source)) return 0;
    const before = source.count;
    if (isEmpty(dest)) {
      mergeIntoSlot(dest, source);
    } else if (dest.item === source.item) {
      mergeIntoSlot(dest, source);
    } else {
      return 0;
    }
    const moved = before - source.count;
    void count;
    return moved;
  }

  /**
   * Take part of a stack out of a slot into a new (cursor/held) stack.
   * Defaults to half rounded up, like a right click in the container UI.
   */
  split(index: number, count?: number): Slot {
    const slot = this.slots[index];
    if (!slot || isEmpty(slot)) return createEmptySlot();
    const take = count === undefined ? Math.ceil(slot.count / 2) : Math.floor(count);
    return this.removeAt(index, Math.max(1, Math.min(slot.count, take)));
  }

  /**
   * Shift-click behaviour inside the inventory:
   *  - armor items equip into their armor slot when it is empty;
   *  - hotbar stacks move to main storage, main-storage stacks move to the hotbar.
   * Returns true when something moved.
   */
  quickMove(index: number): boolean {
    const slot = this.slots[index];
    if (!slot || isEmpty(slot) || !slot.item) return false;
    if (index < 0 || index >= INVENTORY_SIZE) return false;

    if (this.isArmorItem(slot.item)) {
      const armorIndex = this.armorIndexFor(slot.item);
      if (armorIndex !== -1 && isEmpty(this.armor[armorIndex])) {
        this.armor[armorIndex] = normalizeSlot(slot);
        this.clearSlot(index);
        return true;
      }
    }

    if (index < HOTBAR_SIZE) return this.moveRange(index, MAIN_START, MAIN_END);
    return this.moveRange(index, 0, HOTBAR_SIZE);
  }

  /** Merge/place a stack into a target slot range. Returns true when it moved. */
  private moveRange(fromIndex: number, start: number, end: number): boolean {
    const source = this.slots[fromIndex];
    if (!source || isEmpty(source) || !source.item) return false;
    const limit = itemStackLimit(source.item);
    let moved = false;

    if (limit > 1) {
      for (let i = start; i < end && source.count > 0; i++) {
        const target = this.slots[i];
        if (!target || isEmpty(target) || target.item !== source.item) continue;
        const space = limit - target.count;
        if (space <= 0) continue;
        const amount = Math.min(space, source.count);
        target.count += amount;
        source.count -= amount;
        moved = true;
        if (source.count <= 0) {
          this.clearSlot(fromIndex);
          return true;
        }
      }
    }

    for (let i = start; i < end; i++) {
      if (i === fromIndex) continue;
      const target = this.slots[i];
      if (target && !isEmpty(target)) continue;
      this.slots[i] = normalizeSlot(source);
      this.clearSlot(fromIndex);
      return true;
    }
    return moved;
  }

  // -- armor ----------------------------------------------------------------

  isArmorItem(item: string | null | undefined): boolean {
    if (!item) return false;
    return getItem(item)?.armor !== undefined;
  }

  armorIndexFor(item: string | null | undefined): number {
    if (!item) return -1;
    const spec = getItem(item)?.armor;
    return spec ? spec.slot : -1;
  }

  /** Equip an armor item from a main slot (swapping out any current piece). */
  equipArmorFrom(index: number): boolean {
    const slot = this.slots[index];
    if (!slot || isEmpty(slot) || !slot.item) return false;
    const armorIndex = this.armorIndexFor(slot.item);
    if (armorIndex === -1) return false;
    const previous = this.armor[armorIndex];
    this.armor[armorIndex] = normalizeSlot(slot);
    if (!isEmpty(previous)) this.slots[index] = normalizeSlot(previous);
    else this.clearSlot(index);
    return true;
  }

  /** Move an equipped armor piece back into the main inventory. */
  unequipArmor(armorIndex: number, targetIndex?: number): boolean {
    const piece = this.armor[armorIndex];
    if (!piece || isEmpty(piece)) return false;
    const destination = targetIndex !== undefined && isEmpty(this.slots[targetIndex]) ? targetIndex : this.firstEmpty();
    if (destination === -1) return false;
    this.slots[destination] = normalizeSlot(piece);
    this.armor[armorIndex] = createEmptySlot();
    return true;
  }

  armorPoints(): number {
    return armorPoints(this.armor.map((slot) => (isEmpty(slot) ? null : slot.item)));
  }

  // -- durability -----------------------------------------------------------

  /** Apply durability damage to a main slot. Returns what broke (if anything). */
  damageSlot(index: number, amount = 1): DamageResult {
    const slot = this.slots[index];
    if (!slot || isEmpty(slot) || !slot.item) return { broken: null, durability: 0 };
    const base = itemMaxDurability(slot.item);
    if (!base) return { broken: null, durability: 0 };
    const current = slot.durability ?? base;
    const remaining = current - Math.max(0, amount);
    if (remaining > 0) {
      slot.durability = remaining;
      return { broken: null, durability: remaining };
    }
    const broken = cloneSlot(slot);
    broken.durability = 0;
    this.clearSlot(index);
    return { broken, durability: 0 };
  }

  damageSelected(amount = 1): DamageResult {
    return this.damageSlot(this.selectedIndex, amount);
  }

  /** Apply durability damage to an armor piece. */
  damageArmor(armorIndex: number, amount = 1): DamageResult {
    const slot = this.armor[armorIndex];
    if (!slot || isEmpty(slot) || !slot.item) return { broken: null, durability: 0 };
    const base = itemMaxDurability(slot.item);
    if (!base) return { broken: null, durability: 0 };
    const current = slot.durability ?? base;
    const remaining = current - Math.max(0, amount);
    if (remaining > 0) {
      slot.durability = remaining;
      return { broken: null, durability: remaining };
    }
    const broken = cloneSlot(slot);
    broken.durability = 0;
    this.armor[armorIndex] = createEmptySlot();
    return { broken, durability: 0 };
  }

  // -- misc -----------------------------------------------------------------

  clearSlot(index: number): void {
    this.slots[index] = createEmptySlot();
  }

  clearArmor(armorIndex: number): void {
    this.armor[armorIndex] = createEmptySlot();
  }

  /** Drop everything; returns the stacks that were held (for item drops). */
  clear(): Slot[] {
    const dropped: Slot[] = [];
    for (let i = 0; i < INVENTORY_SIZE; i++) {
      if (!isEmpty(this.slots[i])) dropped.push(this.removeAt(i));
    }
    for (let i = 0; i < ARMOR_SIZE; i++) {
      if (!isEmpty(this.armor[i])) {
        dropped.push(cloneSlot(this.armor[i]));
        this.armor[i] = createEmptySlot();
      }
    }
    return dropped;
  }

  serialize(): InventorySaveData {
    return {
      slots: cloneSlots(this.slots, INVENTORY_SIZE),
      armor: cloneSlots(this.armor, ARMOR_SIZE),
      selected: this.selectedIndex,
    };
  }

  static fromSave(data: InventorySaveData | undefined | null): Inventory {
    if (!data) return new Inventory();
    return new Inventory({
      slots: cloneSlots(data.slots ?? [], INVENTORY_SIZE),
      armor: cloneSlots(data.armor ?? [], ARMOR_SIZE),
      selected: data.selected,
    });
  }

  // -- private ordering -----------------------------------------------------

  /** Merge/place order: selected hotbar slot, rest of the hotbar, then main. */
  private addOrder(): number[] {
    const order: number[] = [];
    const selected = this.selectedIndex;
    order.push(selected);
    for (let i = 0; i < HOTBAR_SIZE; i++) if (i !== selected) order.push(i);
    for (let i = MAIN_START; i < MAIN_END; i++) order.push(i);
    // Merge pass should look at the whole hotbar before main storage; because
    // addToSlots does merge+empty in one pass over `order`, the order above
    // already favours hotbar slots for merging and placement.
    return order;
  }

  /** Consume order: main storage first, then the hotbar (keeps hotbar intact). */
  private removeOrder(): number[] {
    const order: number[] = [];
    for (let i = MAIN_START; i < MAIN_END; i++) order.push(i);
    for (let i = 0; i < HOTBAR_SIZE; i++) order.push(i);
    return order;
  }
}
