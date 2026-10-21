/**
 * The only surface the UI depends on. `main.ts` implements this object and
 * injects it into `GameUi`; the UI never imports the world, player or main.
 *
 * See the final report / docs for wiring snippets:
 *   const inventory = new Inventory({ slots: player.slots, armorIds: player.armor });
 *   const bridge: GameUiBridge = { ... };
 *   const ui = new GameUi(uiRoot, bridge);
 *   // each frame: ui.update(dtMs)
 *   // keydown:  if (ui.handleKeyDown(event)) return;
 */
import type { Difficulty, GameMode, Metrics, Slot, Vec3 } from '../core/types';
import type { ContainerAccess } from '../inventory/blockEntities';
import type { Inventory } from '../inventory/inventory';

export type UiScreenId =
  | 'none'
  | 'title'
  | 'worldList'
  | 'createWorld'
  | 'loading'
  | 'pause'
  | 'options'
  | 'inventory'
  | 'crafting'
  | 'furnace'
  | 'chest'
  | 'creative'
  | 'death'
  | 'chat'
  | 'debug'
  | 'error';

export type ToastKind = 'info' | 'warn' | 'error';

export interface UiPlayerSnapshot {
  health: number;
  maxHealth: number;
  hunger: number;
  saturation: number;
  air: number;
  /** Bubbles shown by the HUD; defaults to 10 when omitted. */
  maxAir?: number;
  armorPoints: number;
  gameMode: GameMode;
  position: Vec3;
  yaw: number;
  pitch: number;
  onGround: boolean;
  inWater: boolean;
  sprinting: boolean;
  sneaking: boolean;
  dead: boolean;
  experienceLevel?: number;
  experienceProgress?: number;
}

export interface UiWorldInfo {
  name: string;
  seed: string;
  gameMode: GameMode;
  difficulty: Difficulty;
  day: number;
  timeOfDay: number;
  renderDistance: number;
  loadedColumns?: number;
}

export interface UiSettings {
  difficulty: Difficulty;
  renderDistance: number;
  fov: number;
  mouseSensitivity: number;
  volume: number;
  clouds: boolean;
  pixelRatio: number;
  showFps: boolean;
}

export const DEFAULT_UI_SETTINGS: UiSettings = {
  difficulty: 'normal',
  renderDistance: 8,
  fov: 75,
  mouseSensitivity: 1,
  volume: 0.8,
  clouds: true,
  pixelRatio: 1,
  showFps: true,
};

export interface WorldSummary {
  id: string;
  name: string;
  seed: string;
  gameMode: GameMode;
  difficulty: Difficulty;
  /** Epoch milliseconds of the last save. */
  lastPlayed: number;
  /** Save schema version, optional. */
  version?: string;
}

export interface CreateWorldOptions {
  name: string;
  seed: string;
  gameMode: GameMode;
  difficulty: Difficulty;
  renderDistance: number;
}

export interface CommandResult {
  ok: boolean;
  message?: string;
}

export interface ChatEntry {
  text: string;
  kind: 'chat' | 'system' | 'error';
  time: number;
}

export interface GameUiBridge {
  // ---- pause / lifecycle -------------------------------------------------
  /** Called when the first screen opens (true) and when all screens close (false). */
  setPaused(paused: boolean): void;
  /** Screen stack changed; `main` uses this for pointer lock + E2E state. */
  onScreenChange(screen: UiScreenId): void;

  // ---- state reads -------------------------------------------------------
  getPlayer(): UiPlayerSnapshot;
  getWorld(): UiWorldInfo;
  getSettings(): UiSettings;
  /** The single live inventory instance (slots + armor + selected slot). */
  getInventory(): Inventory;

  // ---- inventory feedback ------------------------------------------------
  /** UI mutated the inventory/armor/cursor: sync held item, hotbar and saves. */
  notifyInventoryChanged(): void;

  // ---- world menu actions -------------------------------------------------
  listWorlds(): Promise<WorldSummary[]> | WorldSummary[];
  playWorld(world: WorldSummary): void;
  createWorld(options: CreateWorldOptions): void;
  deleteWorld(id: string): void;
  save(): void | Promise<void>;
  /** Save the current world and return to the title screen. */
  saveAndQuit(): void;
  /** Return to the title screen without saving. */
  quitToTitle(): void;
  respawn(): void;
  updateSettings(patch: Partial<UiSettings>): void;

  // ---- chat / commands ----------------------------------------------------
  executeCommand(text: string): CommandResult | Promise<CommandResult>;
  chat(message: string): void;

  // ---- feedback / drops ---------------------------------------------------
  dropItem(item: string, count: number, durability?: number): void;
  showToast(message: string, kind?: ToastKind): void;

  // ---- optional hooks -----------------------------------------------------
  getMetrics?(): Metrics;
  requestPointerLock?(): void;
  exitPointerLock?(): void;
  isPointerLocked?(): boolean;
  getContainer?(): ContainerAccess | null;
}

/** Data passed to screens that operate on a container. */
export interface ContainerScreenData {
  access: ContainerAccess;
}

export type ScreenData = ContainerScreenData | undefined;
