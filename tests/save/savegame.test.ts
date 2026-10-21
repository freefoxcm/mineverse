import { describe, expect, it } from 'vitest';
import { BLOCK, blockNumeric } from '../../src/world/blocks';
import type { ChunkColumn } from '../../src/world/chunk';
import { EditStore } from '../../src/save/editStore';
import {
  applyWorldSave,
  createSave,
  createWorldMeta,
  deserializeSave,
  serializeSave,
  validateSave,
} from '../../src/save/savegame';
import { defaultSavedPlayer } from '../../src/save/types';
import { normalizeSettings } from '../../src/core/settings';
import { executeCommand, parseCommand, type CommandContext } from '../../src/core/commands';
import { World } from '../../src/world/world';

describe('edit store + save roundtrip', () => {
  it('records and applies edits to a generated column', () => {
    const store = new EditStore();
    store.record(3, 70, 5, BLOCK.stone, 2);
    const column = { cx: 0, cz: 0, blocks: new Uint8Array(16 * 16 * 160), meta: new Uint8Array(16 * 16 * 160), blockEntities: new Map() } as unknown as ChunkColumn;
    store.apply(column);
    const index = (70 << 8) | (5 << 4) | 3;
    expect(column.blocks[index]).toBe(BLOCK.stone);
    expect(column.meta[index]).toBe(2);
  });

  it('round-trips a save through JSON', () => {
    const world = new World('save-seed');
    world.ensureColumn(0, 0);
    world.setTicks(5000);
    const meta = createWorldMeta('测试世界', 'save-seed', 'survival', 'normal', { x: 8, y: 70, z: 8 });
    const player = defaultSavedPlayer({ x: 8, y: 70, z: 8 });
    player.inventory[0] = { item: 'stone', count: 32 };
    player.selectedSlot = 2;

    const store = new EditStore();
    store.record(1, 70, 1, BLOCK.stone);
    store.record(2, 70, 2, blockNumeric('oak_planks'));
    store.setBlockEntity(4, 70, 4, 'chest', { slots: [] });
    const save = createSave(meta, player, world.ticks, store);

    const restored = deserializeSave(serializeSave(save));
    expect(restored.meta.seed).toBe('save-seed');
    expect(restored.player.inventory[0]).toEqual({ item: 'stone', count: 32 });
    expect(restored.palette).toContain('air');
    expect(restored.palette).toContain('stone');
    expect(restored.edits.length).toBe(1);
    expect(restored.edits[0].indices.length).toBe(2);
    expect(restored.blockEntities).toHaveLength(1);

    const loaded = new EditStore();
    applyWorldSave(restored, loaded);
    expect(loaded.editCount).toBe(2);
    expect(loaded.getBlockEntity(4, 70, 4)?.type).toBe('chest');
  });

  it('rejects invalid saves', () => {
    expect(() => validateSave(null)).toThrow();
    expect(() => validateSave({ version: 2 })).toThrow(/版本/);
    expect(() => validateSave({ version: 1 })).toThrow();
    const valid = createSave(
      createWorldMeta('w', 's', 'creative', 'peaceful', { x: 0, y: 70, z: 0 }),
      defaultSavedPlayer({ x: 0, y: 70, z: 0 }),
      0,
      new EditStore(),
    );
    const broken = JSON.parse(JSON.stringify(valid));
    broken.palette = [1, 2];
    expect(() => validateSave(broken)).toThrow(/palette/);
  });

  it('palette index 0 is always air', () => {
    const store = new EditStore();
    store.record(0, 0, 0, BLOCK.stone);
    expect(store.collect().palette[0]).toBe('air');
  });
});

describe('settings normalize', () => {
  it('clamps values into valid ranges', () => {
    const settings = normalizeSettings({
      renderDistance: 999,
      fov: 10,
      sensitivity: 100,
      masterVolume: -1,
      pixelRatio: 99,
      guiScale: 0,
    });
    expect(settings.renderDistance).toBeLessThanOrEqual(12);
    expect(settings.fov).toBeGreaterThanOrEqual(50);
    expect(settings.sensitivity).toBeLessThanOrEqual(3);
    expect(settings.masterVolume).toBe(0);
    expect(settings.pixelRatio).toBeLessThanOrEqual(2);
    expect(settings.guiScale).toBe(1);
  });

  it('returns defaults for garbage input', () => {
    expect(normalizeSettings('nope')).toEqual(normalizeSettings(undefined));
  });
});

describe('commands', () => {
  function fakeContext(overrides: Partial<CommandContext> = {}): CommandContext {
    let mode: 'survival' | 'creative' = 'survival';
    let ticks = 6000;
    const spawn = { x: 0, y: 70, z: 0 };
    const position = { x: 1, y: 70, z: 2 };
    let inventoryCleared = false;
    let killed = false;
    const given: string[] = [];
    return {
      world: {
        getSeed: () => 'unit-seed',
        getTime: () => ({ ticks, timeOfDay: ticks % 24000, day: Math.floor(ticks / 24000), daylight: 1 }),
        setTime: (value) => {
          ticks = value;
        },
        getSpawnPoint: () => spawn,
        setSpawnPoint: (point) => Object.assign(spawn, point),
      },
      getGameMode: () => mode,
      setGameMode: (next) => {
        mode = next;
      },
      getPlayerPosition: () => position,
      teleport: (point) => Object.assign(position, point),
      giveItem: (id, count) => {
        given.push(`${id}:${count}`);
        return true;
      },
      clearInventory: () => {
        inventoryCleared = true;
      },
      killPlayer: () => {
        killed = true;
      },
      ...overrides,
    } as CommandContext & {
      __given?: string[];
      __cleared?: () => boolean;
      __killed?: () => boolean;
    };
  }

  it('parses slash commands and arguments', () => {
    expect(parseCommand('/give stone 32')).toEqual({ name: 'give', args: ['stone', '32'] });
    expect(parseCommand('   ')).toBeNull();
    expect(parseCommand('/tp 1 70 2')).toEqual({ name: 'tp', args: ['1', '70', '2'] });
  });

  it('handles time, gamemode, tp, give', () => {
    const ctx = fakeContext();
    expect(executeCommand('/time set night', ctx).ok).toBe(true);
    expect(ctx.world.getTime().timeOfDay).toBe(13000);
    expect(executeCommand('/gamemode creative', ctx).ok).toBe(true);
    expect(ctx.getGameMode()).toBe('creative');
    expect(executeCommand('/tp 10 72 -5', ctx).ok).toBe(true);
    expect(ctx.getPlayerPosition()).toEqual({ x: 10, y: 72, z: -5 });
    expect(executeCommand('/give diamond 3', ctx).ok).toBe(true);
  });

  it('rejects unknown commands and items', () => {
    const ctx = fakeContext();
    expect(executeCommand('/nope', ctx).ok).toBe(false);
    expect(executeCommand('/give not_an_item', ctx).ok).toBe(false);
    expect(executeCommand('/tp a b c', ctx).ok).toBe(false);
  });

  it('/kill and /clear invoke callbacks', () => {
    let killed = false;
    let cleared = false;
    const ctx = fakeContext({
      killPlayer: () => {
        killed = true;
      },
      clearInventory: () => {
        cleared = true;
      },
    });
    expect(executeCommand('/kill', ctx).ok).toBe(true);
    expect(killed).toBe(true);
    expect(executeCommand('/clear', ctx).ok).toBe(true);
    expect(cleared).toBe(true);
  });
});
