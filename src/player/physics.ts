/**
 * Minecraft-like player physics. Pure, deterministic functions with no DOM and
 * no Three.js dependency, so everything here is unit-testable in Node.
 *
 * Units are blocks and seconds. The game runs at 20 fixed ticks per second;
 * callers pass `dtTicks` and convert with `TICK_SECONDS` (player.ts does this).
 *
 * The player collider is a box centered horizontally on `position`, standing
 * on `position.y` (feet) with size `PLAYER_WIDTH x PLAYER_HEIGHT`.
 */

import type { GameMode, Vec3 } from '../core/types';
import { FLUID_KIND, IS_COLLIDABLE } from '../world/blocks';

export const TICKS_PER_SECOND = 20;
export const TICK_SECONDS = 1 / TICKS_PER_SECOND;

// ---------------------------------------------------------------------------
// Player dimensions / movement constants (PLAN §2)
// ---------------------------------------------------------------------------

export const PLAYER_WIDTH = 0.6;
export const PLAYER_HEIGHT = 1.8;
export const PLAYER_HALF_WIDTH = PLAYER_WIDTH / 2;
export const EYE_HEIGHT = 1.62;
/** Eye height while sneaking (PLAN §2: 潜行 1.5). */
export const SNEAK_EYE_HEIGHT = 1.5;

export const GRAVITY = 32;
export const JUMP_VELOCITY = 8.9;
export const TERMINAL_VELOCITY = -78.4;

export const WALK_SPEED = 4.317;
export const SPRINT_SPEED = 5.612;
export const SNEAK_SPEED = 1.295;
export const FLY_SPEED = 10.89;
export const FLY_SPRINT_SPEED = 21.78;
export const SWIM_SPEED = 2.2;
export const LAVA_SPEED = 1.1;

/** Downward pull while submerged; much weaker than air gravity. */
export const WATER_GRAVITY = 5;
export const WATER_SINK_SPEED = -1.1;
export const SWIM_UP_SPEED = 2.7;
export const LAVA_SINK_SPEED = -0.5;

/** How high the player can automatically step up (slabs/stairs later). */
export const STEP_HEIGHT = 0.6;

/** Fall damage starts after falling more than this many blocks. */
export const FALL_DAMAGE_THRESHOLD = 3;

/** Tolerance used when shrinking AABBs so touching blocks does not collide. */
export const EPSILON = 1e-4;

// ---------------------------------------------------------------------------
// World access
// ---------------------------------------------------------------------------

/** Minimal world view required by physics (structurally compatible with WorldView). */
export interface BlockWorld {
  getBlock(x: number, y: number, z: number): number;
}

export type Axis = 'x' | 'y' | 'z';
export type FluidKind = 'water' | 'lava' | null;

export function isSolidBlock(id: number): boolean {
  return IS_COLLIDABLE[id] === 1;
}

/** Fluid at a single world point, `null` for non-fluid blocks. */
export function fluidAtPoint(world: BlockWorld, x: number, y: number, z: number): FluidKind {
  const kind = FLUID_KIND[world.getBlock(Math.floor(x), Math.floor(y), Math.floor(z))];
  return kind === 1 ? 'water' : kind === 2 ? 'lava' : null;
}

/**
 * Fluid occupying the player's body volume. Lava wins over water. Uses small
 * inward samples so standing on the shore does not count as swimming.
 */
export function bodyFluid(
  world: BlockWorld,
  position: Vec3,
  width = PLAYER_WIDTH,
  height = PLAYER_HEIGHT,
): FluidKind {
  const half = width / 2;
  const x0 = Math.floor(position.x - half + EPSILON);
  const x1 = Math.floor(position.x + half - EPSILON);
  const y0 = Math.floor(position.y + EPSILON);
  const y1 = Math.floor(position.y + height - EPSILON);
  const z0 = Math.floor(position.z - half + EPSILON);
  const z1 = Math.floor(position.z + half - EPSILON);
  let water = false;
  for (let by = y0; by <= y1; by++) {
    for (let bz = z0; bz <= z1; bz++) {
      for (let bx = x0; bx <= x1; bx++) {
        const kind = FLUID_KIND[world.getBlock(bx, by, bz)];
        if (kind === 2) return 'lava';
        if (kind === 1) water = true;
      }
    }
  }
  return water ? 'water' : null;
}

/** Whether the player's eye is inside water (for underwater rendering/drowning). */
export function isEyeInFluid(
  world: BlockWorld,
  position: Vec3,
  eyeHeight = EYE_HEIGHT,
): FluidKind {
  return fluidAtPoint(world, position.x, position.y + eyeHeight, position.z);
}

// ---------------------------------------------------------------------------
// AABB collision
// ---------------------------------------------------------------------------

export interface BlockRange {
  x0: number;
  x1: number;
  y0: number;
  y1: number;
  z0: number;
  z1: number;
}

/** Inclusive block coordinate range overlapped by the player's AABB. */
export function blockRangeFor(
  position: Vec3,
  width = PLAYER_WIDTH,
  height = PLAYER_HEIGHT,
): BlockRange {
  const half = width / 2;
  return {
    x0: Math.floor(position.x - half + EPSILON),
    x1: Math.floor(position.x + half - EPSILON),
    y0: Math.floor(position.y + EPSILON),
    y1: Math.floor(position.y + height - EPSILON),
    z0: Math.floor(position.z - half + EPSILON),
    z1: Math.floor(position.z + half - EPSILON),
  };
}

/** True when the player AABB intersects any collidable block. */
export function collidesWithWorld(
  world: BlockWorld,
  position: Vec3,
  width = PLAYER_WIDTH,
  height = PLAYER_HEIGHT,
): boolean {
  const r = blockRangeFor(position, width, height);
  for (let by = r.y0; by <= r.y1; by++) {
    for (let bz = r.z0; bz <= r.z1; bz++) {
      for (let bx = r.x0; bx <= r.x1; bx++) {
        if (IS_COLLIDABLE[world.getBlock(bx, by, bz)] === 1) return true;
      }
    }
  }
  return false;
}

function blockedX(world: BlockWorld, bx: number, r: BlockRange): boolean {
  for (let by = r.y0; by <= r.y1; by++) {
    for (let bz = r.z0; bz <= r.z1; bz++) {
      if (IS_COLLIDABLE[world.getBlock(bx, by, bz)] === 1) return true;
    }
  }
  return false;
}

function blockedY(world: BlockWorld, by: number, r: BlockRange): boolean {
  for (let bz = r.z0; bz <= r.z1; bz++) {
    for (let bx = r.x0; bx <= r.x1; bx++) {
      if (IS_COLLIDABLE[world.getBlock(bx, by, bz)] === 1) return true;
    }
  }
  return false;
}

function blockedZ(world: BlockWorld, bz: number, r: BlockRange): boolean {
  for (let by = r.y0; by <= r.y1; by++) {
    for (let bx = r.x0; bx <= r.x1; bx++) {
      if (IS_COLLIDABLE[world.getBlock(bx, by, bz)] === 1) return true;
    }
  }
  return false;
}

export interface AxisSweep {
  /** Resolved coordinate on the swept axis. */
  value: number;
  /** Whether the movement was blocked by a solid block. */
  hit: boolean;
}

/**
 * Swept AABB along one axis: moves the collider by `amount` and stops at the
 * first blocking block face. Touching a face exactly is allowed (the epsilon
 * shrink keeps contact non-colliding), so walking flush against a wall works.
 *
 * Other axes are kept fixed; `movePlayer` chains axes to slide along walls.
 */
export function sweepAxis(
  world: BlockWorld,
  position: Vec3,
  axis: Axis,
  amount: number,
  width = PLAYER_WIDTH,
  height = PLAYER_HEIGHT,
): AxisSweep {
  const current = position[axis];
  if (amount === 0) return { value: current, hit: false };
  const half = width / 2;
  const r = blockRangeFor(position, width, height);

  if (axis === 'x') {
    if (amount > 0) {
      const start = position.x + half;
      const end = start + amount;
      const last = Math.floor(end - EPSILON);
      for (let bx = Math.floor(start); bx <= last; bx++) {
        if (blockedX(world, bx, r)) return { value: bx - half, hit: true };
      }
      return { value: current + amount, hit: false };
    }
    const start = position.x - half;
    const end = start + amount;
    const last = Math.floor(end);
    for (let bx = Math.floor(start - EPSILON); bx >= last; bx--) {
      if (blockedX(world, bx, r)) return { value: bx + 1 + half, hit: true };
    }
    return { value: current + amount, hit: false };
  }

  if (axis === 'y') {
    if (amount > 0) {
      const start = position.y + height;
      const end = start + amount;
      const last = Math.floor(end - EPSILON);
      for (let by = Math.floor(start); by <= last; by++) {
        if (blockedY(world, by, r)) return { value: by - height, hit: true };
      }
      return { value: current + amount, hit: false };
    }
    const start = position.y;
    const end = start + amount;
    const last = Math.floor(end - EPSILON);
    for (let by = Math.floor(start - EPSILON); by >= last; by--) {
      if (blockedY(world, by, r)) return { value: by + 1, hit: true };
    }
    return { value: current + amount, hit: false };
  }

  if (amount > 0) {
    const start = position.z + half;
    const end = start + amount;
    const last = Math.floor(end - EPSILON);
    for (let bz = Math.floor(start); bz <= last; bz++) {
      if (blockedZ(world, bz, r)) return { value: bz - half, hit: true };
    }
    return { value: current + amount, hit: false };
  }
  const start = position.z - half;
  const end = start + amount;
  const last = Math.floor(end);
  for (let bz = Math.floor(start - EPSILON); bz >= last; bz--) {
    if (blockedZ(world, bz, r)) return { value: bz + 1 + half, hit: true };
  }
  return { value: current + amount, hit: false };
}

/**
 * Push the collider out of any solid blocks it is embedded in (for example
 * after teleporting or when terrain changes under the player). Tries up first,
 * then down, then the four horizontal directions.
 */
export function resolvePenetration(
  world: BlockWorld,
  position: Vec3,
  width = PLAYER_WIDTH,
  height = PLAYER_HEIGHT,
): Vec3 {
  if (!collidesWithWorld(world, position, width, height)) return position;
  const probe = 0.05;
  const maxLift = height + 1;
  for (let d = probe; d <= maxLift; d += probe) {
    const up = { x: position.x, y: position.y + d, z: position.z };
    if (!collidesWithWorld(world, up, width, height)) return up;
  }
  const half = width / 2;
  for (let d = probe; d <= half + 1; d += probe) {
    for (const [dx, dz] of [
      [1, 0],
      [-1, 0],
      [0, 1],
      [0, -1],
      [1, 1],
      [-1, -1],
      [1, -1],
      [-1, 1],
    ] as const) {
      const out = { x: position.x + dx * d, y: position.y, z: position.z + dz * d };
      if (!collidesWithWorld(world, out, width, height)) return out;
    }
  }
  return position;
}

export interface MoveOptions {
  width?: number;
  height?: number;
  /** Automatic step-up height; 0 disables it. */
  stepHeight?: number;
}

export interface MoveResult {
  position: Vec3;
  hitX: boolean;
  hitY: boolean;
  hitZ: boolean;
  /** True when a downward move was stopped (standing on something). */
  onGround: boolean;
  /** True when the horizontal move succeeded via an automatic step-up. */
  steppedUp: boolean;
}

/**
 * Axis-separated swept movement (Y first, then X, then Z). This is what makes
 * diagonal wall collisions slide instead of sticking. Movement is resolved on
 * the given axes independently, so a wall on X never cancels Z motion.
 */
export function movePlayer(
  world: BlockWorld,
  position: Vec3,
  motion: Vec3,
  options: MoveOptions = {},
): MoveResult {
  const width = options.width ?? PLAYER_WIDTH;
  const height = options.height ?? PLAYER_HEIGHT;
  const stepHeight = options.stepHeight ?? 0;

  let pos = resolvePenetration(world, position, width, height);

  // Vertical first: land, then walk. (Vanilla entity order is Y, X, Z.)
  const ySweep = sweepAxis(world, pos, 'y', motion.y, width, height);
  const hitY = ySweep.hit;
  pos = { x: pos.x, y: ySweep.value, z: pos.z };
  const onGround = hitY && motion.y <= 0;

  // Horizontal X, with an optional step-up retry.
  let hitX = false;
  let steppedUp = false;
  const xSweep = sweepAxis(world, pos, 'x', motion.x, width, height);
  if (xSweep.hit && onGround && stepHeight > 0 && motion.x !== 0) {
    const step = 0.1;
    for (let lift = step; lift <= stepHeight + 1e-9; lift += step) {
      const lifted = { x: pos.x, y: pos.y + lift, z: pos.z };
      if (collidesWithWorld(world, lifted, width, height)) continue;
      const retry = sweepAxis(world, lifted, 'x', motion.x, width, height);
      if (!retry.hit) {
        pos = { x: retry.value, y: lifted.y, z: pos.z };
        hitX = false;
        steppedUp = true;
        break;
      }
    }
    if (!steppedUp) {
      pos = { x: xSweep.value, y: pos.y, z: pos.z };
      hitX = true;
    }
  } else {
    pos = { x: xSweep.value, y: pos.y, z: pos.z };
    hitX = xSweep.hit;
  }

  // Horizontal Z.
  const zSweep = sweepAxis(world, pos, 'z', motion.z, width, height);
  pos = { x: pos.x, y: pos.y, z: zSweep.value };

  return {
    position: pos,
    hitX,
    hitY,
    hitZ: zSweep.hit,
    onGround,
    steppedUp,
  };
}

// ---------------------------------------------------------------------------
// Fall damage
// ---------------------------------------------------------------------------

/** PLAN §3.5: fall damage = floor(distance - 3), never negative. */
export function fallDamageForDistance(distance: number): number {
  if (!Number.isFinite(distance) || distance <= FALL_DAMAGE_THRESHOLD) return 0;
  return Math.floor(distance - FALL_DAMAGE_THRESHOLD);
}

// ---------------------------------------------------------------------------
// Whole-body physics step
// ---------------------------------------------------------------------------

export interface MovementInput {
  /** -1 (back) .. 1 (forward). */
  forward: number;
  /** -1 (left) .. 1 (right). */
  strafe: number;
  /** Jump / swim up held. */
  jump: boolean;
  /** Jump pressed this tick (edge). */
  jumpPressed: boolean;
  /** Sneak / descend while flying. */
  sneak: boolean;
  /** Sprint held. */
  sprint: boolean;
  /** -1..1 vertical wish while flying (space/ctrl). */
  flyVertical: number;
}

export function emptyMovementInput(): MovementInput {
  return {
    forward: 0,
    strafe: 0,
    jump: false,
    jumpPressed: false,
    sneak: false,
    sprint: false,
    flyVertical: 0,
  };
}

export interface PhysicsBodyState {
  position: Vec3;
  velocity: Vec3;
  yaw: number;
  onGround: boolean;
  inWater: boolean;
  inLava: boolean;
  fallDistance: number;
  flying: boolean;
  sprinting: boolean;
  sneaking: boolean;
  gameMode: GameMode;
}

export interface SpeedContext {
  flying: boolean;
  sprinting: boolean;
  sneaking: boolean;
  inWater: boolean;
  inLava: boolean;
}

/** Target horizontal speed for the current movement mode. */
export function horizontalSpeedFor(context: SpeedContext): number {
  if (context.flying) return context.sprinting ? FLY_SPRINT_SPEED : FLY_SPEED;
  if (context.inLava) return context.sprinting ? LAVA_SPEED * 1.2 : LAVA_SPEED;
  if (context.inWater) return context.sprinting ? SWIM_SPEED * 1.15 : SWIM_SPEED;
  if (context.sneaking) return SNEAK_SPEED;
  if (context.sprinting) return SPRINT_SPEED;
  return WALK_SPEED;
}

function approach(current: number, target: number, maxDelta: number): number {
  if (current < target) return Math.min(target, current + maxDelta);
  if (current > target) return Math.max(target, current - maxDelta);
  return target;
}

export interface PhysicsStepResult {
  position: Vec3;
  velocity: Vec3;
  onGround: boolean;
  inWater: boolean;
  inLava: boolean;
  fallDistance: number;
  /** Damage (half-hearts, integer) to apply for the landing this tick. */
  landedFallDamage: number;
  hitWall: boolean;
  steppedUp: boolean;
  sprinting: boolean;
  sneaking: boolean;
}

/**
 * One fixed physics tick. Pure: returns the next state and does not mutate
 * `state`. Player.ts owns health/hunger and applies `landedFallDamage`.
 */
export function stepPhysics(
  world: BlockWorld,
  state: PhysicsBodyState,
  input: MovementInput,
  dtSeconds = TICK_SECONDS,
): PhysicsStepResult {
  const dt = Math.max(1e-6, Math.min(0.25, dtSeconds));
  const flying = state.flying && state.gameMode === 'creative';

  const startFluid = bodyFluid(world, state.position);
  const inWater = startFluid === 'water';
  const inLava = startFluid === 'lava';
  const sneaking = input.sneak && !flying && !inWater && !inLava;
  const sprinting = input.sprint && input.forward > 0.1 && !sneaking && !flying;
  const speed = horizontalSpeedFor({ flying, sprinting, sneaking, inWater, inLava });

  // Wish direction in world space from yaw.
  const sinYaw = Math.sin(state.yaw);
  const cosYaw = Math.cos(state.yaw);
  const forwardX = -sinYaw;
  const forwardZ = -cosYaw;
  const rightX = cosYaw;
  const rightZ = -sinYaw;
  let wishX = input.forward * forwardX + input.strafe * rightX;
  let wishZ = input.forward * forwardZ + input.strafe * rightZ;
  const wishLength = Math.hypot(wishX, wishZ);
  if (wishLength > 1) {
    wishX /= wishLength;
    wishZ /= wishLength;
  }

  const accelRate = flying ? 14 : inWater || inLava ? 8 : state.onGround ? 16 : 4;
  const blend = Math.min(1, accelRate * dt);
  let velocityX = state.velocity.x + (wishX * speed - state.velocity.x) * blend;
  let velocityZ = state.velocity.z + (wishZ * speed - state.velocity.z) * blend;

  let velocityY = state.velocity.y;
  let fallDistance = state.fallDistance;
  let verticalStart = velocityY;
  let landedInFluid = false;

  if (flying) {
    const verticalSpeed = input.flyVertical * (input.sprint ? FLY_SPRINT_SPEED : FLY_SPEED);
    velocityY = approach(velocityY, verticalSpeed, 40 * dt);
    fallDistance = 0;
  } else if (inWater) {
    fallDistance = 0;
    const swimUp = input.jump || input.flyVertical > 0;
    velocityY = approach(
      velocityY,
      swimUp ? SWIM_UP_SPEED : WATER_SINK_SPEED,
      (swimUp ? 20 : WATER_GRAVITY) * dt,
    );
    velocityY = Math.max(velocityY, -4);
  } else if (inLava) {
    fallDistance = 0;
    const swimUp = input.jump || input.flyVertical > 0;
    velocityY = approach(
      velocityY,
      swimUp ? SWIM_UP_SPEED * 0.55 : LAVA_SINK_SPEED,
      (swimUp ? 10 : 6) * dt,
    );
  } else {
    if (input.jumpPressed && state.onGround) {
      velocityY = JUMP_VELOCITY;
      verticalStart = JUMP_VELOCITY;
    }
    velocityY -= GRAVITY * dt;
    if (velocityY < TERMINAL_VELOCITY) velocityY = TERMINAL_VELOCITY;
  }

  // Trapezoidal vertical integration keeps jump height close to v^2 / 2g.
  const verticalMotion = flying || inWater || inLava ? velocityY * dt : ((verticalStart + velocityY) / 2) * dt;

  const move = movePlayer(
    world,
    state.position,
    { x: velocityX * dt, y: verticalMotion, z: velocityZ * dt },
    {
      width: PLAYER_WIDTH,
      height: PLAYER_HEIGHT,
      stepHeight: state.onGround && !flying && !inWater && !inLava ? STEP_HEIGHT : 0,
    },
  );

  let position = move.position;
  let onGround = false;
  if (move.hitY) {
    velocityY = 0;
    onGround = verticalMotion <= 0;
  }
  if (move.hitX) velocityX = 0;
  if (move.hitZ) velocityZ = 0;

  // Re-sample fluids at the new position so entering water on the same tick
  // suppresses fall damage and updates the swimming flag immediately.
  const endFluid = bodyFluid(world, position);
  const endedInWater = endFluid === 'water';
  const endedInLava = endFluid === 'lava';
  if (endedInWater || endedInLava) {
    landedInFluid = true;
    fallDistance = 0;
  }

  // Accumulate fall distance from the actual descent.
  if (!flying && !landedInFluid) {
    const descent = state.position.y - position.y;
    if (descent > 0) fallDistance += descent;
  } else if (flying) {
    fallDistance = 0;
  }

  let landedFallDamage = 0;
  if (!state.onGround && onGround && !landedInFluid && !flying && state.gameMode !== 'creative') {
    landedFallDamage = fallDamageForDistance(fallDistance);
    fallDistance = 0;
  }
  if (onGround) fallDistance = 0;

  return {
    position: endedInWater || endedInLava ? resolvePenetration(world, position) : position,
    velocity: { x: velocityX, y: velocityY, z: velocityZ },
    onGround,
    inWater: endedInWater,
    inLava: endedInLava,
    fallDistance,
    landedFallDamage,
    hitWall: move.hitX || move.hitZ,
    steppedUp: move.steppedUp,
    sprinting,
    sneaking,
  };
}

/** Horizontal eye-height helper matching the player's sneak pose. */
export function eyeHeightFor(sneaking: boolean): number {
  return sneaking ? SNEAK_EYE_HEIGHT : EYE_HEIGHT;
}

/** Unit look vector from yaw/pitch (matches THREE's YXZ camera rotation). */
export function lookDirection(yaw: number, pitch: number): Vec3 {
  const cosPitch = Math.cos(pitch);
  return {
    x: -Math.sin(yaw) * cosPitch,
    y: Math.sin(pitch),
    z: -Math.cos(yaw) * cosPitch,
  };
}
