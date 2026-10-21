import { describe, expect, it } from 'vitest';
import { makeSlot } from '../../src/core/types';
import {
  CHEST_SIZE,
  FURNACE_SIZE,
  createChestData,
  createFurnaceState,
  createStandaloneChestAccess,
  createStandaloneFurnaceAccess,
  containerSlots,
  deserializeChest,
  deserializeFurnace,
  furnaceBurnProgress,
  furnaceCookProgress,
  furnaceOutput,
  isFurnaceLit,
  serializeChest,
  serializeFurnace,
  tickFurnace,
} from '../../src/inventory/blockEntities';
import { Inventory } from '../../src/inventory/inventory';
import { SMELTING_TIME_TICKS } from '../../src/inventory/recipes';

function furnaceWith(input: string, inputCount: number, fuel: string, fuelCount: number) {
  const furnace = createFurnaceState();
  furnace.slots[0] = makeSlot(input, inputCount);
  furnace.slots[1] = makeSlot(fuel, fuelCount);
  return furnace;
}

describe('chest block entity', () => {
  it('creates 27 empty slots', () => {
    const chest = createChestData();
    expect(chest.slots).toHaveLength(CHEST_SIZE);
    expect(chest.slots.every((slot) => slot.item === null)).toBe(true);
  });

  it('serializes and restores contents', () => {
    const chest = createChestData();
    chest.slots[3] = makeSlot('diamond', 5);
    chest.slots[20] = makeSlot('iron_pickaxe', 1);
    const restored = deserializeChest(serializeChest(chest));
    expect(restored.slots[3]).toMatchObject({ item: 'diamond', count: 5 });
    expect(restored.slots[20].durability).toBe(250);
    expect(restored.slots[0].item).toBeNull();
  });

  it('exposes a standalone access object for the UI', () => {
    const access = createStandaloneChestAccess();
    expect(access.kind).toBe('chest');
    expect(access.slots).toHaveLength(CHEST_SIZE);
    expect(containerSlots(access)).toBe(access.slots);
    access.onChange();
  });
});

describe('furnace block entity', () => {
  it('creates three empty slots and no burn state', () => {
    const furnace = createFurnaceState();
    expect(furnace.slots).toHaveLength(FURNACE_SIZE);
    expect(furnace.slots.every((slot) => slot.item === null)).toBe(true);
    expect(furnace.burnTicks).toBe(0);
    expect(furnace.cookTicks).toBe(0);
    expect(isFurnaceLit(furnace)).toBe(false);
  });

  it('ignites fuel and starts cooking smeltable input', () => {
    const furnace = furnaceWith('raw_iron', 1, 'coal', 1);
    const events = tickFurnace(furnace, 1);
    expect(events.wasLit).toBe(false);
    expect(events.isLit).toBe(true);
    expect(events.consumedFuel).toBe(true);
    expect(isFurnaceLit(furnace)).toBe(true);
    expect(furnace.burnTicks).toBe(1599);
    expect(furnace.slots[1].count).toBe(0);
    expect(furnace.slots[1].item).toBeNull();
    expect(furnace.cookTicks).toBe(1);
    expect(furnaceCookProgress(furnace)).toBeCloseTo(1 / SMELTING_TIME_TICKS, 6);
  });

  it('smelts after 10 seconds (200 ticks) and writes the output', () => {
    const furnace = furnaceWith('raw_iron', 1, 'coal', 1);
    const first = tickFurnace(furnace, 1);
    expect(first.smeltedCount).toBe(0);
    const rest = tickFurnace(furnace, SMELTING_TIME_TICKS - 1);
    expect(rest.smeltedCount).toBe(1);
    expect(rest.smelted).toMatchObject({ item: 'iron_ingot', count: 1 });
    expect(furnace.slots[0].item).toBeNull();
    expect(furnaceOutput(furnace)).toMatchObject({ item: 'iron_ingot', count: 1 });
    expect(furnace.experience).toBeGreaterThan(0);
    expect(furnace.cookTicks).toBe(0);
  });

  it('does not consume fuel or cook without smeltable input', () => {
    const furnace = createFurnaceState();
    furnace.slots[1] = makeSlot('coal', 2);
    const events = tickFurnace(furnace, 50);
    expect(events.consumedFuel).toBe(false);
    expect(isFurnaceLit(furnace)).toBe(false);
    expect(furnace.slots[1].count).toBe(2);
    expect(furnace.cookTicks).toBe(0);
  });

  it('keeps burning fuel but stops cooking when the input is removed', () => {
    const furnace = furnaceWith('raw_iron', 1, 'coal', 1);
    tickFurnace(furnace, 10);
    const burnBefore = furnace.burnTicks;
    furnace.slots[0] = makeSlot(null, 0);
    tickFurnace(furnace, 5);
    expect(furnace.burnTicks).toBe(burnBefore - 5);
    expect(furnace.cookTicks).toBe(0);
  });

  it('does not smelt when the output slot is full', () => {
    const furnace = furnaceWith('raw_iron', 1, 'coal', 1);
    furnace.slots[2] = makeSlot('iron_ingot', 64);
    const events = tickFurnace(furnace, 30);
    expect(events.smeltedCount).toBe(0);
    expect(events.consumedFuel).toBe(false);
    expect(furnace.slots[1].count).toBe(1);
    expect(isFurnaceLit(furnace)).toBe(false);
  });

  it('limits output to the stack limit (64)', () => {
    const furnace = furnaceWith('raw_iron', 2, 'coal', 2);
    furnace.slots[2] = makeSlot('iron_ingot', 64);
    tickFurnace(furnace, 1);
    expect(furnace.slots[1].count).toBe(2);
    // With the output full there is nothing to do; keep the input intact.
    expect(furnace.slots[0].count).toBe(2);
  });

  it('reports burn progress for the flame animation', () => {
    const furnace = furnaceWith('raw_iron', 1, 'coal', 1);
    expect(furnaceBurnProgress(furnace)).toBe(0);
    tickFurnace(furnace, 800);
    expect(furnaceBurnProgress(furnace)).toBeCloseTo(0.5, 2);
  });

  it('serializes and restores the full state', () => {
    const furnace = furnaceWith('raw_iron', 3, 'coal', 2);
    tickFurnace(furnace, 25);
    const restored = deserializeFurnace(serializeFurnace(furnace));
    expect(restored.slots[0]).toMatchObject({ item: 'raw_iron', count: 3 });
    expect(restored.slots[1]).toMatchObject({ item: 'coal', count: 1 });
    expect(restored.burnTicks).toBe(furnace.burnTicks);
    expect(restored.cookTicks).toBe(furnace.cookTicks);
    expect(restored.burnTotalTicks).toBe(furnace.burnTotalTicks);
    restored.slots[0].count = 1;
    expect(furnace.slots[0].count).toBe(3);
  });

  it('serializes empty furnace data safely', () => {
    const fallback = deserializeFurnace(undefined);
    expect(fallback.slots).toHaveLength(3);
    expect(deserializeFurnace({ slots: [] }).slots[0].item).toBeNull();
  });

  it('exposes a standalone furnace access for screenshots / E2E', () => {
    const access = createStandaloneFurnaceAccess();
    expect(access.kind).toBe('furnace');
    expect(access.furnace).toBe(access.furnace);
    expect(containerSlots(access)).toBe(access.furnace.slots);
    access.onChange();
  });

  it('is shape-compatible with a player inventory (smelting loop integration)', () => {
    const inventory = new Inventory();
    inventory.add('raw_iron', 4);
    inventory.add('coal', 2);
    const furnace = createFurnaceState();
    furnace.slots[0] = inventory.removeAt(0, 4);
    furnace.slots[1] = inventory.removeAt(1, 2);
    const events = tickFurnace(furnace, 1);
    expect(events.consumedFuel).toBe(true);
    expect(inventory.count('raw_iron')).toBe(0);
    expect(inventory.count('coal')).toBe(0);
  });
});
