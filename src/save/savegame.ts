import { GAME_VERSION } from '../core/config';
import type { Difficulty, GameMode, Slot, Vec3 } from '../core/types';
import type { EditStore } from './editStore';
import type { SaveV1, SavedPlayer, WorldMeta } from './types';

export function createWorldId(): string {
  const cryptoApi = globalThis.crypto;
  if (cryptoApi && typeof cryptoApi.randomUUID === 'function') return cryptoApi.randomUUID();
  return `world-${Date.now().toString(36)}-${Math.floor(Math.random() * 1e9).toString(36)}`;
}

export function createWorldMeta(
  name: string,
  seed: string,
  gameMode: GameMode,
  difficulty: Difficulty,
  playerSpawn: Vec3,
): WorldMeta {
  const now = Date.now();
  return {
    id: createWorldId(),
    name: name.trim() || '新的世界',
    seed: seed.trim() || 'mineverse',
    gameMode,
    difficulty,
    createdAt: now,
    lastPlayed: now,
    playtimeSeconds: 0,
    gameVersion: GAME_VERSION,
  };
}

export function cloneSlot(slot: Slot): Slot {
  return {
    item: slot?.item ?? null,
    count: slot?.count ?? 0,
    ...(slot?.durability !== undefined ? { durability: slot.durability } : {}),
    ...(slot?.tag ? { tag: { ...slot.tag } } : {}),
  };
}

export function cloneSavedPlayer(player: SavedPlayer): SavedPlayer {
  return {
    ...player,
    pos: { ...player.pos },
    inventory: player.inventory.map(cloneSlot),
    armor: player.armor.map(cloneSlot),
  };
}

export function createSave(
  meta: WorldMeta,
  player: SavedPlayer,
  time: number,
  editStore: EditStore,
): SaveV1 {
  const { edits, blockEntities, palette } = editStore.collect();
  return {
    version: 1,
    meta: { ...meta, lastPlayed: Date.now(), gameVersion: GAME_VERSION },
    player: cloneSavedPlayer(player),
    time,
    palette,
    edits,
    blockEntities,
  };
}

export function applyWorldSave(save: SaveV1, editStore: EditStore): void {
  editStore.load(save.edits, save.palette, save.blockEntities);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

/** Validates an untrusted save object (Import JSON path) and returns a typed copy. */
export function validateSave(data: unknown): SaveV1 {
  if (!isRecord(data)) throw new Error('存档格式无效：根对象缺失');
  if (data.version !== 1) throw new Error(`不支持的存档版本：${String(data.version)}`);
  if (!isRecord(data.meta)) throw new Error('存档格式无效：meta 缺失');
  if (!isRecord(data.player)) throw new Error('存档格式无效：player 缺失');
  const meta = data.meta;
  for (const field of ['id', 'name', 'seed', 'gameMode', 'difficulty'] as const) {
    if (typeof meta[field] !== 'string') throw new Error(`存档格式无效：meta.${field}`);
  }
  if (!Array.isArray(data.palette) || data.palette.some((entry) => typeof entry !== 'string')) {
    throw new Error('存档格式无效：palette');
  }
  if (!Array.isArray(data.edits)) throw new Error('存档格式无效：edits');
  for (const chunk of data.edits) {
    if (!isRecord(chunk)) throw new Error('存档格式无效：edits 条目');
    if (!Array.isArray(chunk.indices) || !Array.isArray(chunk.blocks) || !Array.isArray(chunk.metas)) {
      throw new Error('存档格式无效：edits 数据');
    }
    if (chunk.indices.length !== chunk.blocks.length || chunk.blocks.length !== chunk.metas.length) {
      throw new Error('存档格式无效：edits 长度不一致');
    }
  }
  if (!Array.isArray(data.blockEntities)) throw new Error('存档格式无效：blockEntities');
  const player = data.player;
  if (!isRecord(player.pos)) throw new Error('存档格式无效：player.pos');
  if (!Array.isArray(player.inventory) || !Array.isArray(player.armor)) {
    throw new Error('存档格式无效：player 背包');
  }
  if (typeof data.time !== 'number' || !Number.isFinite(data.time)) {
    throw new Error('存档格式无效：time');
  }
  return data as unknown as SaveV1;
}

export function serializeSave(save: SaveV1): string {
  return JSON.stringify(save);
}

export function deserializeSave(text: string): SaveV1 {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new Error('存档不是有效的 JSON');
  }
  return validateSave(parsed);
}
