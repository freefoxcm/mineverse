import { describe, expect, it } from 'vitest';
import { makeSlot, type Slot } from '../../src/core/types';
import {
  ARMOR_SIZE,
  HOTBAR_SIZE,
  INVENTORY_SIZE,
  Inventory,
  addToSlots,
  cloneSlot,
  countItem,
  isEmpty,
  itemMaxDurability,
  itemStackLimit,
  normalizeSlot,
  slotDurability,
} from '../../src/inventory/inventory';

function filled(count: number, item = 'stone'): Slot {
  return makeSlot(item, count);
}

function fillAll(inventory: Inventory, item = 'dirt', count = 64): void {
  for (let i = 0; i < INVENTORY_SIZE; i++) inventory.setSlot(i, makeSlot(item, count));
}

describe('inventory basics', () => {
  it('starts empty with 36 slots, 4 armor slots and selection 0', () => {
    const inventory = new Inventory();
    expect(inventory.slots).toHaveLength(INVENTORY_SIZE);
    expect(inventory.armor).toHaveLength(ARMOR_SIZE);
    expect(HOTBAR_SIZE).toBe(9);
    expect(inventory.selected).toBe(0);
    expect(inventory.usedSlots()).toBe(0);
    expect(inventory.isFull()).toBe(false);
  });

  it('clamps the selected slot and supports scroll wrapping', () => {
    const inventory = new Inventory({ selected: 4 });
    expect(inventory.selected).toBe(4);
    inventory.selected = 99;
    expect(inventory.selected).toBe(8);
    inventory.selected = -3;
    expect(inventory.selected).toBe(0);
    expect(inventory.setSelectedSlot(3)).toBe(3);
    inventory.scrollSelected(1);
    expect(inventory.selected).toBe(4);
    inventory.scrollSelected(-1);
    inventory.scrollSelected(-1);
    expect(inventory.selected).toBe(2);
    inventory.selected = 0;
    inventory.scrollSelected(-1);
    expect(inventory.selected).toBe(8);
  });

  it('exposes the held stack from the selected hotbar slot', () => {
    const inventory = new Inventory({ selected: 2 });
    inventory.setSlot(2, makeSlot('diamond_sword', 1));
    expect(inventory.getHeld().item).toBe('diamond_sword');
    expect(inventory.selectedSlot.item).toBe('diamond_sword');
    expect(inventory.selectedSlotIndex).toBe(2);
    inventory.selectedSlotIndex = 7;
    expect(inventory.selected).toBe(7);
  });

  it('normalizes slots when written directly', () => {
    const inventory = new Inventory();
    inventory.setSlot(0, makeSlot('stone', 999));
    expect(inventory.slots[0].count).toBe(64);
    inventory.setSlot(1, makeSlot('iron_pickaxe', 1));
    expect(inventory.slots[1].durability).toBe(250);
    expect(slotDurability(inventory.slots[1])).toBe(250);
    expect(itemStackLimit('iron_pickaxe')).toBe(1);
    expect(itemMaxDurability('iron_pickaxe')).toBe(250);
    expect(itemMaxDurability('stone')).toBeUndefined();
    expect(isEmpty(makeSlot(null, 0))).toBe(true);
    expect(normalizeSlot(makeSlot('stick', 0))).toEqual({ item: null, count: 0 });
  });
});

describe('inventory add / remove / count', () => {
  it('adds items merging into existing stacks', () => {
    const inventory = new Inventory();
    expect(inventory.add('stone', 10)).toBe(0);
    expect(inventory.add('stone', 10)).toBe(0);
    expect(inventory.slots[0]).toEqual(makeSlot('stone', 20));
    expect(inventory.count('stone')).toBe(20);
  });

  it('fills empty slots and reports the leftover when full', () => {
    const inventory = new Inventory();
    expect(inventory.add('stone', 64 * 2 + 7)).toBe(0);
    expect(inventory.slots[0].count).toBe(64);
    expect(inventory.slots[1].count).toBe(64);
    expect(inventory.slots[2].count).toBe(7);
    fillAll(inventory, 'dirt');
    expect(inventory.add('dirt', 5)).toBe(5);
    expect(inventory.add('diamond', 1)).toBe(1);
    expect(inventory.isFull()).toBe(true);
    expect(inventory.isFullFor('dirt')).toBe(true);
    expect(inventory.freeCapacity('dirt')).toBe(0);
  });

  it('respects stack limits and does not stack tools', () => {
    const inventory = new Inventory();
    inventory.add('iron_pickaxe', 1);
    inventory.add('iron_pickaxe', 1);
    expect(inventory.slots[0].item).toBe('iron_pickaxe');
    expect(inventory.slots[1].item).toBe('iron_pickaxe');
    expect(inventory.count('iron_pickaxe')).toBe(2);
    expect(inventory.add('iron_pickaxe', 1)).toBe(0);
  });

  it('contains, counts across stacks and has()', () => {
    const inventory = new Inventory();
    inventory.setSlot(0, makeSlot('stick', 5));
    inventory.setSlot(10, makeSlot('stick', 7));
    expect(inventory.count('stick')).toBe(12);
    expect(inventory.has('stick', 12)).toBe(true);
    expect(inventory.has('stick', 13)).toBe(false);
    expect(countItem(inventory.slots, 'stick')).toBe(12);
  });

  it('removes items across stacks and frees emptied slots', () => {
    const inventory = new Inventory();
    inventory.setSlot(0, makeSlot('stone', 30));
    inventory.setSlot(1, makeSlot('stone', 64));
    expect(inventory.remove('stone', 80)).toBe(80);
    expect(inventory.count('stone')).toBe(14);
    expect(inventory.remove('stone', 100)).toBe(14);
    expect(inventory.count('stone')).toBe(0);
    expect(inventory.firstEmpty()).toBe(0);
  });

  it('removeAt and split take part of a stack', () => {
    const inventory = new Inventory();
    inventory.setSlot(0, makeSlot('apple', 9));
    const half = inventory.split(0);
    expect(half.count).toBe(5);
    expect(inventory.slots[0].count).toBe(4);
    const three = inventory.split(0, 3);
    expect(three.count).toBe(3);
    expect(inventory.slots[0].count).toBe(1);
    const rest = inventory.removeAt(0);
    expect(rest.count).toBe(1);
    expect(isEmpty(inventory.slots[0])).toBe(true);
    expect(inventory.split(0).count).toBe(0);
  });

  it('addSlot returns the leftover stack', () => {
    const inventory = new Inventory();
    fillAll(inventory, 'dirt');
    const leftover = inventory.addSlot(makeSlot('stone', 10));
    expect(leftover.item).toBe('stone');
    expect(leftover.count).toBe(10);
  });
});

describe('inventory slot moving', () => {
  it('swap merges identical stackable items', () => {
    const inventory = new Inventory();
    inventory.setSlot(0, makeSlot('stone', 10));
    inventory.setSlot(1, makeSlot('stone', 20));
    inventory.swap(0, 1);
    expect(inventory.slots[1]).toEqual(makeSlot('stone', 30));
    expect(isEmpty(inventory.slots[0])).toBe(true);
  });

  it('swap exchanges different items', () => {
    const inventory = new Inventory();
    inventory.setSlot(0, makeSlot('dirt', 5));
    inventory.setSlot(1, makeSlot('stone', 7));
    inventory.swap(0, 1);
    expect(inventory.slots[0].item).toBe('stone');
    expect(inventory.slots[1].item).toBe('dirt');
  });

  it('moveTo merges into a destination stack', () => {
    const inventory = new Inventory();
    inventory.setSlot(0, makeSlot('stone', 10));
    inventory.setSlot(1, makeSlot('stone', 20));
    expect(inventory.moveTo(0, 1)).toBe(10);
    expect(inventory.slots[1].count).toBe(30);
    expect(isEmpty(inventory.slots[0])).toBe(true);
    inventory.setSlot(2, makeSlot('dirt', 1));
    expect(inventory.moveTo(2, 1)).toBe(0);
  });

  it('quickMove shifts hotbar stacks to main storage', () => {
    const inventory = new Inventory();
    inventory.setSlot(2, makeSlot('stone', 10));
    expect(inventory.quickMove(2)).toBe(true);
    expect(isEmpty(inventory.slots[2])).toBe(true);
    expect(inventory.slots[HOTBAR_SIZE].count).toBe(10);
  });

  it('quickMove shifts main storage stacks to the hotbar', () => {
    const inventory = new Inventory();
    inventory.setSlot(10, makeSlot('stone', 10));
    expect(inventory.quickMove(10)).toBe(true);
    expect(inventory.slots[0].count).toBe(10);
    expect(isEmpty(inventory.slots[10])).toBe(true);
  });

  it('quickMove merges what fits and leaves the remainder', () => {
    const inventory = new Inventory();
    for (let i = 0; i < HOTBAR_SIZE; i++) inventory.setSlot(i, makeSlot('dirt', 64));
    inventory.setSlot(2, makeSlot('iron_ingot', 60));
    inventory.setSlot(20, makeSlot('iron_ingot', 10));
    expect(inventory.quickMove(20)).toBe(true);
    expect(inventory.slots[2].count).toBe(64);
    expect(inventory.slots[20].count).toBe(6);
  });

  it('quickMove auto-equips armor into an empty armor slot', () => {
    const inventory = new Inventory();
    inventory.setSlot(5, makeSlot('iron_helmet', 1));
    expect(inventory.quickMove(5)).toBe(true);
    expect(inventory.armor[0].item).toBe('iron_helmet');
    expect(isEmpty(inventory.slots[5])).toBe(true);
  });

  it('quickMove falls back to storage when the armor slot is occupied', () => {
    const inventory = new Inventory();
    inventory.armor[0] = makeSlot('leather_helmet', 1);
    inventory.setSlot(5, makeSlot('iron_helmet', 1));
    expect(inventory.quickMove(5)).toBe(true);
    expect(inventory.armor[0].item).toBe('leather_helmet');
    expect(inventory.count('iron_helmet')).toBe(1);
    expect(inventory.slots[5].item).not.toBe('iron_helmet');
  });

  it('quickMove does nothing for empty slots', () => {
    const inventory = new Inventory();
    expect(inventory.quickMove(0)).toBe(false);
  });
});

describe('inventory armor and durability', () => {
  it('equips armor by slot kind and swaps the previous piece out', () => {
    const inventory = new Inventory();
    inventory.armor[1] = makeSlot('leather_chestplate', 1);
    inventory.setSlot(3, makeSlot('iron_chestplate', 1));
    expect(inventory.equipArmorFrom(3)).toBe(true);
    expect(inventory.armor[1].item).toBe('iron_chestplate');
    expect(inventory.slots[3].item).toBe('leather_chestplate');
    inventory.setSlot(4, makeSlot('stone', 5));
    expect(inventory.equipArmorFrom(4)).toBe(false);
    expect(inventory.unequipArmor(1)).toBe(true);
    expect(inventory.count('iron_chestplate')).toBe(1);
    expect(isEmpty(inventory.armor[1])).toBe(true);
  });

  it('computes armor points from equipped pieces', () => {
    const inventory = new Inventory();
    expect(inventory.armorPoints()).toBe(0);
    inventory.armor[0] = makeSlot('iron_helmet', 1);
    inventory.armor[1] = makeSlot('diamond_chestplate', 1);
    expect(inventory.armorPoints()).toBe(2 + 8);
  });

  it('damages tools and drops them when durability runs out', () => {
    const inventory = new Inventory();
    inventory.add('iron_pickaxe', 1);
    expect(inventory.slots[0].durability).toBe(250);
    const first = inventory.damageSlot(0, 100);
    expect(first.broken).toBeNull();
    expect(first.durability).toBe(150);
    const broken = inventory.damageSlot(0, 150);
    expect(broken.broken?.item).toBe('iron_pickaxe');
    expect(broken.durability).toBe(0);
    expect(isEmpty(inventory.slots[0])).toBe(true);
  });

  it('damageSelected targets the held tool', () => {
    const inventory = new Inventory({ selected: 3 });
    inventory.add('diamond_sword', 1);
    const result = inventory.damageSelected(1);
    expect(result.durability).toBe(1560);
    expect(inventory.slots[3].durability).toBe(1560);
  });

  it('does nothing when damaging a non-damageable stack', () => {
    const inventory = new Inventory();
    inventory.add('stone', 10);
    const result = inventory.damageSlot(0, 5);
    expect(result.broken).toBeNull();
    expect(result.durability).toBe(0);
    expect(inventory.slots[0].count).toBe(10);
  });

  it('damages armor and clears it when broken', () => {
    const inventory = new Inventory();
    inventory.armor[0] = makeSlot('leather_helmet', 1);
    expect(inventory.damageArmor(0, 10).durability).toBe(44);
    const broken = inventory.damageArmor(0, 1000);
    expect(broken.broken?.item).toBe('leather_helmet');
    expect(isEmpty(inventory.armor[0])).toBe(true);
  });

  it('clones slots without sharing tags', () => {
    const source: Slot = { item: 'stone', count: 3, tag: { value: 1 } };
    const copy = cloneSlot(source);
    copy.tag!.value = 2;
    expect(source.tag!.value).toBe(1);
  });

  it('addToSlots fills the provided order', () => {
    const slots: Slot[] = [makeSlot(null, 0), makeSlot(null, 0), makeSlot(null, 0)];
    const leftover = addToSlots(slots, makeSlot('stone', 100), [2, 0, 1]);
    expect(slots[2].count).toBe(64);
    expect(slots[0].count).toBe(36);
    expect(isEmpty(leftover)).toBe(true);
  });
});

describe('inventory persistence / clear', () => {
  it('serializes and restores slots, armor and selection', () => {
    const inventory = new Inventory({ selected: 5 });
    inventory.setSlot(0, makeSlot('stone', 12));
    inventory.armor[2] = makeSlot('iron_leggings', 1);
    const data = inventory.serialize();
    const restored = Inventory.fromSave(data);
    expect(restored.selected).toBe(5);
    expect(restored.slots[0]).toEqual(makeSlot('stone', 12));
    expect(restored.armor[2].item).toBe('iron_leggings');
    // Saved data is a snapshot, not a live reference.
    inventory.slots[0].count = 1;
    expect(restored.slots[0].count).toBe(12);
  });

  it('builds from armor ids and wraps the provided slot array by reference', () => {
    const slots: Slot[] = [];
    const inventory = new Inventory({ slots, armorIds: ['iron_helmet', null, 'diamond_leggings', null] });
    expect(inventory.slots).toBe(slots);
    expect(inventory.armor[0].item).toBe('iron_helmet');
    expect(inventory.armor[2].item).toBe('diamond_leggings');
    expect(inventory.armorPoints()).toBe(2 + 6);
  });

  it('clear returns all dropped stacks', () => {
    const inventory = new Inventory();
    inventory.setSlot(0, makeSlot('stone', 5));
    inventory.armor[0] = makeSlot('iron_helmet', 1);
    const dropped = inventory.clear();
    expect(dropped).toHaveLength(2);
    expect(inventory.usedSlots()).toBe(0);
    expect(isEmpty(inventory.armor[0])).toBe(true);
  });

  it('filled helper sanity check', () => {
    expect(filled(3).count).toBe(3);
  });
});
