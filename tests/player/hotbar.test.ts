import { describe, expect, it } from 'vitest';
import { EMPTY_SLOT, makeSlot, type Slot } from '../../src/core/types';
import {
  CREATIVE_STARTER_KIT,
  SURVIVAL_STARTER_KIT,
  findOccupiedSlot,
  resolveHotbarSlot,
  wrapHotbar,
} from '../../src/player/hotbar';

function slots(pattern: Array<string | null>): Slot[] {
  return Array.from({ length: 9 }, (_unused, index) => {
    const item = pattern[index] ?? null;
    return item ? makeSlot(item, 1) : { ...EMPTY_SLOT };
  });
}

describe('hotbar empty-slot skipping', () => {
  it('wraps indices into 0..8', () => {
    expect(wrapHotbar(9)).toBe(0);
    expect(wrapHotbar(-1)).toBe(8);
    expect(wrapHotbar(12)).toBe(3);
  });

  it('skips empty slots in the requested direction and wraps', () => {
    const hotbar = slots([null, null, 'torch', null, null, null, null, null, 'apple']);
    expect(findOccupiedSlot(hotbar, 0, 1)).toBe(2);
    expect(findOccupiedSlot(hotbar, 8, -1)).toBe(8);
    expect(findOccupiedSlot(hotbar, 7, -1)).toBe(2);
    expect(findOccupiedSlot(hotbar, 4, -1)).toBe(2);
    expect(findOccupiedSlot(hotbar, 5, 1)).toBe(8);
  });

  it('returns null when every slot is empty', () => {
    expect(findOccupiedSlot(slots([]), 3, 1)).toBeNull();
  });

  it('resolves direct/scroll requests to an occupied slot without changing an occupied one', () => {
    const hotbar = slots([null, 'pickaxe', null, 'apple']);
    expect(resolveHotbarSlot(hotbar, 1, 0)).toBe(1);
    expect(resolveHotbarSlot(hotbar, 0, 0, 1)).toBe(1);
    expect(resolveHotbarSlot(hotbar, 2, 0, -1)).toBe(1);
    expect(resolveHotbarSlot(hotbar, 5, 0, 1)).toBe(1);
    // All empty: keep the fallback slot, the first person just renders nothing.
    expect(resolveHotbarSlot(slots([]), 4, 6, 1)).toBe(6);
  });

  it('keeps both starter kits at exactly nine hotbar stacks', () => {
    expect(SURVIVAL_STARTER_KIT).toHaveLength(9);
    expect(CREATIVE_STARTER_KIT).toHaveLength(9);
    expect(new Set(SURVIVAL_STARTER_KIT.map(([item]) => item)).size).toBe(9);
    expect(new Set(CREATIVE_STARTER_KIT.map(([item]) => item)).size).toBe(9);
  });
});
