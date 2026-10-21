import type { Difficulty, GameMode, Slot, Vec3 } from '../core/types';

export interface WorldMeta {
  id: string;
  name: string;
  seed: string;
  gameMode: GameMode;
  difficulty: Difficulty;
  createdAt: number;
  lastPlayed: number;
  playtimeSeconds: number;
  gameVersion: string;
}

export interface SavedPlayer {
  pos: { x: number; y: number; z: number };
  yaw: number;
  pitch: number;
  health: number;
  hunger: number;
  saturation: number;
  air: number;
  gameMode: GameMode;
  inventory: Slot[];
  armor: Slot[];
  selectedSlot: number;
}

export interface SavedChunkEdits {
  cx: number;
  cz: number;
  /** Column-local block indices (0..40959). */
  indices: number[];
  /** Palette indices into SaveV1.palette. */
  blocks: number[];
  metas: number[];
}

export interface SavedBlockEntity {
  x: number;
  y: number;
  z: number;
  type: 'chest' | 'furnace';
  data: unknown;
}

export interface SaveV1 {
  version: 1;
  meta: WorldMeta;
  player: SavedPlayer;
  /** World ticks. */
  time: number;
  /** Block string ids; edits reference by index. */
  palette: string[];
  edits: SavedChunkEdits[];
  blockEntities: SavedBlockEntity[];
}

export interface WorldListEntry {
  id: string;
  name: string;
  seed: string;
  gameMode: GameMode;
  difficulty: Difficulty;
  createdAt: number;
  lastPlayed: number;
  playtimeSeconds: number;
  gameVersion: string;
}

export function defaultSavedPlayer(pos: Vec3): SavedPlayer {
  return {
    pos: { x: pos.x, y: pos.y, z: pos.z },
    yaw: 0,
    pitch: 0,
    health: 20,
    hunger: 20,
    saturation: 5,
    air: 10,
    gameMode: 'survival',
    inventory: Array.from({ length: 36 }, () => ({ item: null, count: 0 })),
    armor: Array.from({ length: 4 }, () => ({ item: null, count: 0 })),
    selectedSlot: 0,
  };
}
