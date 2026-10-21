import { GAME_VERSION } from '../core/config';
import type { Metrics, WorldTime } from '../core/types';
import type { World } from '../world/world';

export interface DebugContext {
  world: World;
  metrics(): Metrics;
  teleport(x: number, y: number, z: number): void;
  look(yaw: number, pitch: number): void;
  applyBlock(x: number, y: number, z: number, id: number, meta?: number): boolean;
  remeshAll(): void;
  isReady(): boolean;
  errors: string[];
}

export interface DebugApi {
  version: string;
  readonly ready: boolean;
  errors: string[];
  metrics(): Metrics;
  getBlock(x: number, y: number, z: number): number;
  setBlock(x: number, y: number, z: number, id: number, meta?: number): boolean;
  teleport(x: number, y: number, z: number): void;
  look(yaw: number, pitch: number): void;
  forceRemesh(): void;
  world: {
    readonly seed: string;
    readonly time: WorldTime;
    readonly columns: number;
    readonly gamemode: string;
  };
}

declare global {
  interface Window {
    __MC__?: DebugApi;
  }
}

/** Exposes the automation/debug surface used by the screenshot + E2E harness. */
export function installDebugApi(context: DebugContext): void {
  const api: DebugApi = {
    version: GAME_VERSION,
    get ready() {
      return context.isReady();
    },
    errors: context.errors,
    metrics: () => context.metrics(),
    getBlock: (x, y, z) => context.world.getBlock(x, y, z),
    setBlock: (x, y, z, id, meta = 0) => context.applyBlock(x, y, z, id, meta),
    teleport: (x, y, z) => context.teleport(x, y, z),
    look: (yaw, pitch) => context.look(yaw, pitch),
    forceRemesh: () => context.remeshAll(),
    world: {
      get seed() {
        return context.world.seed;
      },
      get time() {
        return context.world.time();
      },
      get columns() {
        return context.world.loadedColumnCount;
      },
      get gamemode() {
        return 'survival';
      },
    },
  };
  window.__MC__ = api;
}
