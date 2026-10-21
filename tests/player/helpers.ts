/**
 * Shared test helpers for gameplay-B tests: a tiny in-memory world and a
 * physics simulation driver. Not a test file itself (vitest only picks *.test.ts).
 */

import { BLOCK } from '../../src/world/blocks';
import type { WorldView } from '../../src/core/contracts';
import type { GameMode, Vec3 } from '../../src/core/types';
import {
  TICK_SECONDS,
  stepPhysics,
  type BlockWorld,
  type MovementInput,
  type PhysicsBodyState,
  type PhysicsStepResult,
} from '../../src/player/physics';

/** Sparse in-memory block world for collision tests. */
export class TestWorld implements BlockWorld {
  private readonly blocks = new Map<string, number>();

  static key(x: number, y: number, z: number): string {
    return `${x},${y},${z}`;
  }

  set(x: number, y: number, z: number, id: number): this {
    this.blocks.set(TestWorld.key(x, y, z), id);
    return this;
  }

  fill(x0: number, y0: number, z0: number, x1: number, y1: number, z1: number, id: number): this {
    for (let x = x0; x <= x1; x++) {
      for (let y = y0; y <= y1; y++) {
        for (let z = z0; z <= z1; z++) this.set(x, y, z, id);
      }
    }
    return this;
  }

  getBlock(x: number, y: number, z: number): number {
    return this.blocks.get(TestWorld.key(x, y, z)) ?? BLOCK.air;
  }

  setBlock(x: number, y: number, z: number, id: number): boolean {
    this.set(x, y, z, id);
    return true;
  }
}

/** Full `WorldView` fake used by player/interaction tests. */
export class FakeWorldView implements WorldView {
  readonly seed = 'test-seed';
  private readonly blocks = new Map<string, { id: number; meta: number }>();
  tickCount = 0;
  /** Records every setBlock call for assertions. */
  readonly edits: { x: number; y: number; z: number; id: number; meta: number; cause?: string }[] = [];

  static key(x: number, y: number, z: number): string {
    return `${x},${y},${z}`;
  }

  set(x: number, y: number, z: number, id: number, meta = 0): this {
    this.blocks.set(FakeWorldView.key(x, y, z), { id, meta });
    return this;
  }

  fill(x0: number, y0: number, z0: number, x1: number, y1: number, z1: number, id: number, meta = 0): this {
    for (let x = x0; x <= x1; x++) {
      for (let y = y0; y <= y1; y++) {
        for (let z = z0; z <= z1; z++) this.set(x, y, z, id, meta);
      }
    }
    return this;
  }

  getBlock(x: number, y: number, z: number): number {
    return this.blocks.get(FakeWorldView.key(x, y, z))?.id ?? BLOCK.air;
  }

  getMeta(x: number, y: number, z: number): number {
    return this.blocks.get(FakeWorldView.key(x, y, z))?.meta ?? 0;
  }

  getSkyLight(): number {
    return 15;
  }

  getBlockLight(): number {
    return 0;
  }

  setBlock(x: number, y: number, z: number, id: number, meta = 0, cause?: string): boolean {
    this.edits.push({ x, y, z, id, meta, cause });
    this.set(x, y, z, id, meta);
    return true;
  }

  isChunkLoaded(): boolean {
    return true;
  }

  time(): { ticks: number; timeOfDay: number; day: number; daylight: number } {
    return { ticks: this.tickCount, timeOfDay: 6000, day: 0, daylight: 1 };
  }

  spawnY(): number {
    return 64;
  }
}

/** FakeWorldView with stone ground whose top block is `groundTop`. */
export function groundView(groundTop = 63, radius = 20): FakeWorldView {
  return new FakeWorldView().fill(-radius, 0, -radius, radius, groundTop, radius, BLOCK.stone);
}

/** Flat world with solid ground whose top block is `groundTop`. */
export function groundWorld(groundTop = 63, radius = 12): TestWorld {
  return new TestWorld().fill(-radius, 0, -radius, radius, groundTop, radius, BLOCK.stone);
}

export interface BodyOptions {
  x?: number;
  y?: number;
  z?: number;
  yaw?: number;
  gameMode?: GameMode;
  onGround?: boolean;
  flying?: boolean;
  velocity?: Vec3;
}

export function makeBody(options: BodyOptions = {}): PhysicsBodyState {
  return {
    position: { x: options.x ?? 0.5, y: options.y ?? 64, z: options.z ?? 0.5 },
    velocity: options.velocity ?? { x: 0, y: 0, z: 0 },
    yaw: options.yaw ?? 0,
    onGround: options.onGround ?? true,
    inWater: false,
    inLava: false,
    fallDistance: 0,
    flying: options.flying ?? false,
    sprinting: false,
    sneaking: false,
    gameMode: options.gameMode ?? 'survival',
  };
}

export function input(overrides: Partial<MovementInput> = {}): MovementInput {
  return {
    forward: 0,
    strafe: 0,
    jump: false,
    jumpPressed: false,
    sneak: false,
    sprint: false,
    flyVertical: 0,
    ...overrides,
  };
}

export interface SimulationResult {
  body: PhysicsBodyState;
  steps: PhysicsStepResult[];
}

/** Run fixed physics ticks, carrying the body state between steps. */
export function simulate(
  world: BlockWorld,
  body: PhysicsBodyState,
  movement: MovementInput | ((tick: number) => MovementInput),
  ticks: number,
): SimulationResult {
  let state = body;
  const steps: PhysicsStepResult[] = [];
  for (let tick = 0; tick < ticks; tick++) {
    const stepInput = typeof movement === 'function' ? movement(tick) : movement;
    const result = stepPhysics(world, state, stepInput, TICK_SECONDS);
    state = {
      ...state,
      position: result.position,
      velocity: result.velocity,
      onGround: result.onGround,
      inWater: result.inWater,
      inLava: result.inLava,
      fallDistance: result.fallDistance,
      sprinting: result.sprinting,
      sneaking: result.sneaking,
    };
    steps.push(result);
  }
  return { body: state, steps };
}
