import { GAME_VERSION } from '../core/config';
import type { EntitySnapshot } from '../entities/snapshot';
import type { GameMode, Metrics, Slot, Vec3, WorldTime } from '../core/types';

export interface DebugPlayerState {
  position: Vec3;
  yaw: number;
  pitch: number;
  health: number;
  hunger: number;
  air: number;
  onGround: boolean;
  inWater: boolean;
  dead: boolean;
  gameMode: GameMode;
  selectedSlot: number;
}

export interface DebugInteractionInfo {
  hit: { x: number; y: number; z: number; id: number } | null;
  breaking: boolean;
  progress: number;
}

export interface DebugEntityCounts {
  mobs: number;
  items: number;
  total: number;
}

export interface DebugContext {
  isReady(): boolean;
  errors: string[];
  metrics(): Metrics;
  getSeed(): string;
  getTime(): WorldTime;
  setTime(ticks: number): void;
  getColumns(): number;
  getGameMode(): GameMode;
  setGameMode(mode: GameMode): void;
  getPlayer(): DebugPlayerState;
  getHotbar(): Slot[];
  getBlock(x: number, y: number, z: number): number;
  blockId(name: string): number;
  setBlock(x: number, y: number, z: number, id: number, meta?: number): boolean;
  teleport(x: number, y: number, z: number): void;
  look(yaw: number, pitch: number): void;
  applyLook(deltaX: number, deltaY: number): void;
  pressKey(code: string): void;
  releaseKey(code: string): void;
  click(button: number): void;
  setAttack(pressed: boolean): void;
  setUse(pressed: boolean): void;
  scroll(notches: number): void;
  selectSlot(index: number): void;
  give(item: string, count: number): boolean;
  isPointerLocked(): boolean;
  requestPointerLock(): void;
  spawnMob(type: string, x?: number, y?: number, z?: number): { id: number; type: string } | null;
  spawnItem(item: string, count?: number): number;
  explode(x?: number, y?: number, z?: number, power?: number): void;
  entitySnapshots(): EntitySnapshot[];
  entityCounts(): DebugEntityCounts;
  clearEntities(): void;
  setSpawnEnabled(enabled: boolean): void;
  getInteraction(): DebugInteractionInfo;
  openScreen(name: string): boolean;
  closeScreen(): boolean;
  getScreen(): string;
  clickSlot(index: number, button?: number, shift?: boolean): void;
  getInventoryState(): { slots: Slot[]; armor: Slot[]; selected: number };
  saveWorld(): Promise<boolean>;
  listWorlds(): Promise<{ id: string; name: string; seed: string; lastPlayed: number }[]>;
  editCount(): number;
  isColumnLoaded(cx: number, cz: number): boolean;
  getLight(x: number, y: number, z: number): { sky: number; block: number };
  setThirdPerson(enabled: boolean): void;
  respawn(): void;
  runCommand(text: string): { ok: boolean; message: string };
  setBlockOutlineVisible(visible: boolean): void;
  setFlying(enabled: boolean): void;
  setHandVisible(visible: boolean): void;
}

export interface DebugApi {
  version: string;
  readonly ready: boolean;
  errors: string[];
  metrics(): Metrics;
  getBlock(x: number, y: number, z: number): number;
  blockId(name: string): number;
  setBlock(x: number, y: number, z: number, id: number, meta?: number): boolean;
  teleport(x: number, y: number, z: number): void;
  look(yaw: number, pitch: number): void;
  applyLook(deltaX: number, deltaY: number): void;
  pressKey(code: string): void;
  releaseKey(code: string): void;
  click(button: number): void;
  setAttack(pressed: boolean): void;
  setUse(pressed: boolean): void;
  scroll(notches: number): void;
  selectSlot(index: number): void;
  setTime(ticks: number): void;
  setGamemode(mode: GameMode): void;
  give(item: string, count: number): boolean;
  requestPointerLock(): void;
  spawnMob(type: string, x?: number, y?: number, z?: number): { id: number; type: string } | null;
  spawnItem(item: string, count?: number): number;
  explode(x?: number, y?: number, z?: number, power?: number): void;
  entitySnapshots(): EntitySnapshot[];
  entityCounts(): DebugEntityCounts;
  clearEntities(): void;
  setSpawnEnabled(enabled: boolean): void;
  getInteraction(): DebugInteractionInfo;
  openScreen(name: string): boolean;
  closeScreen(): boolean;
  getScreen(): string;
  clickSlot(index: number, button?: number, shift?: boolean): void;
  getInventoryState(): { slots: Slot[]; armor: Slot[]; selected: number };
  saveWorld(): Promise<boolean>;
  listWorlds(): Promise<{ id: string; name: string; seed: string; lastPlayed: number }[]>;
  editCount(): number;
  isColumnLoaded(cx: number, cz: number): boolean;
  getLight(x: number, y: number, z: number): { sky: number; block: number };
  setThirdPerson(enabled: boolean): void;
  respawn(): void;
  runCommand(text: string): { ok: boolean; message: string };
  setBlockOutlineVisible(visible: boolean): void;
  setFlying(enabled: boolean): void;
  setHandVisible(visible: boolean): void;
  readonly world: {
    readonly seed: string;
    readonly time: WorldTime;
    readonly columns: number;
    readonly gamemode: GameMode;
  };
  readonly player: DebugPlayerState;
  readonly hotbar: Slot[];
  readonly pointerLocked: boolean;
}

declare global {
  interface Window {
    __MC__?: DebugApi;
  }
}

/** Installs the automation surface used by the screenshot/E2E harness. */
export function installDebugApi(context: DebugContext): DebugApi {
  const api: DebugApi = {
    version: GAME_VERSION,
    get ready() {
      return context.isReady();
    },
    errors: context.errors,
    metrics: () => context.metrics(),
    getBlock: (x, y, z) => context.getBlock(x, y, z),
    blockId: (name) => context.blockId(name),
    setBlock: (x, y, z, id, meta = 0) => context.setBlock(x, y, z, id, meta),
    teleport: (x, y, z) => context.teleport(x, y, z),
    look: (yaw, pitch) => context.look(yaw, pitch),
    applyLook: (deltaX, deltaY) => context.applyLook(deltaX, deltaY),
    pressKey: (code) => context.pressKey(code),
    releaseKey: (code) => context.releaseKey(code),
    click: (button) => context.click(button),
    setAttack: (pressed) => context.setAttack(pressed),
    setUse: (pressed) => context.setUse(pressed),
    scroll: (notches) => context.scroll(notches),
    selectSlot: (index) => context.selectSlot(index),
    setTime: (ticks) => context.setTime(ticks),
    setGamemode: (mode) => context.setGameMode(mode),
    give: (item, count) => context.give(item, count),
    requestPointerLock: () => context.requestPointerLock(),
    spawnMob: (type, x, y, z) => context.spawnMob(type, x, y, z),
    spawnItem: (item, count) => context.spawnItem(item, count),
    explode: (x, y, z, power) => context.explode(x, y, z, power),
    entitySnapshots: () => context.entitySnapshots(),
    entityCounts: () => context.entityCounts(),
    clearEntities: () => context.clearEntities(),
    setSpawnEnabled: (enabled) => context.setSpawnEnabled(enabled),
    getInteraction: () => context.getInteraction(),
    openScreen: (name) => context.openScreen(name),
    closeScreen: () => context.closeScreen(),
    getScreen: () => context.getScreen(),
    clickSlot: (index, button, shift) => context.clickSlot(index, button, shift),
    getInventoryState: () => context.getInventoryState(),
    saveWorld: () => context.saveWorld(),
    listWorlds: () => context.listWorlds(),
    editCount: () => context.editCount(),
    isColumnLoaded: (cx, cz) => context.isColumnLoaded(cx, cz),
    getLight: (x, y, z) => context.getLight(x, y, z),
    setThirdPerson: (enabled) => context.setThirdPerson(enabled),
    respawn: () => context.respawn(),
    runCommand: (text) => context.runCommand(text),
    setBlockOutlineVisible: (visible) => context.setBlockOutlineVisible(visible),
    setFlying: (enabled) => context.setFlying(enabled),
    setHandVisible: (visible) => context.setHandVisible(visible),
    world: {
      get seed() {
        return context.getSeed();
      },
      get time() {
        return context.getTime();
      },
      get columns() {
        return context.getColumns();
      },
      get gamemode() {
        return context.getGameMode();
      },
    },
    get player() {
      return context.getPlayer();
    },
    get hotbar() {
      return context.getHotbar();
    },
    get pointerLocked() {
      return context.isPointerLocked();
    },
  };
  window.__MC__ = api;
  return api;
}
