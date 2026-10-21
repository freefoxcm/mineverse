import type { BlockId, Difficulty, GameMode, WorldTime } from './types';

/**
 * Stable contracts between subsystems. Teammates import these types and the
 * implementations behind them; do not change without Lead coordination.
 */

export interface WorldView {
  readonly seed: string;
  getBlock(x: number, y: number, z: number): BlockId;
  getMeta(x: number, y: number, z: number): number;
  getSkyLight(x: number, y: number, z: number): number;
  getBlockLight(x: number, y: number, z: number): number;
  /**
   * Place/remove a block. Returns false when out of bounds or rejected.
   * `cause` lets subsystems distinguish player edits from world simulation.
   */
  setBlock(x: number, y: number, z: number, id: BlockId, meta?: number, cause?: string): boolean;
  isChunkLoaded(cx: number, cz: number): boolean;
  time(): WorldTime;
  /** Y coordinate of the first safe standing spot at the world spawn. */
  spawnY(x: number, z: number): number;
}

export interface PlayerView {
  position: { x: number; y: number; z: number };
  velocity: { x: number; y: number; z: number };
  yaw: number;
  pitch: number;
  onGround: boolean;
  inWater: boolean;
  gameMode: GameMode;
  health: number;
  maxHealth: number;
  hunger: number;
  saturation: number;
  air: number;
  selectedSlot: number;
  sprinting: boolean;
  sneaking: boolean;
}

export interface WorldSettings {
  mode: GameMode;
  difficulty: Difficulty;
  renderDistance: number;
}

export interface GameServices {
  world: WorldView;
  player: PlayerView;
  settings: WorldSettings;
  showToast(message: string, kind?: 'info' | 'warn' | 'error'): void;
}

export type ScreenId =
  | 'none'
  | 'pause'
  | 'options'
  | 'inventory'
  | 'crafting'
  | 'furnace'
  | 'chest'
  | 'creative'
  | 'death'
  | 'chat'
  | 'debug';

export const DEFAULT_WORLD_SETTINGS: WorldSettings = {
  mode: 'survival',
  difficulty: 'normal',
  renderDistance: 8,
};
