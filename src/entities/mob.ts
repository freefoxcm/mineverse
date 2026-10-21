/**
 * Mob entity: per-type stats, state machine (idle/wander/chase/attack/flee/
 * hurt/dead), path following, daylight burning, creeper fuse, skeleton archery
 * and spider leaping. Manager drives `updateAI` then `update` (physics).
 */

import type { WorldView } from '../core/contracts';
import type { Vec3 } from '../core/types';
import {
  canSee,
  CREEPER_FUSE_CANCEL_RANGE,
  CREEPER_FUSE_RANGE,
  CREEPER_FUSE_TICKS,
  decideMobState,
  FLEE_DISTANCE,
  FLEE_TICKS,
  isHostileAt,
  pickFleeTarget,
  pickWanderTarget,
  shouldBurnInDaylight,
  skeletonArrowDamage,
  turnTowards,
  yawOf,
  type MobState,
  type MobTargetInfo,
} from './ai';
import { Entity } from './entity';
import { findPath, type PathOptions } from './pathfinding';
import { MOB_MODELS, type MobType, isHostileMob, isPassiveMob } from './models';
import { FLUID_KIND } from '../world/blocks';

export interface MobDrop {
  item: string;
  min: number;
  max: number;
  /** 0..1 probability; when set the drop is only rolled once. */
  chance?: number;
}

export interface MobStats {
  /** Half-hearts. */
  health: number;
  /** Movement speed in blocks/second. */
  speed: number;
  /** Melee damage in half-hearts (0 for passive mobs). */
  damage: number;
  /** Target acquisition range in blocks. */
  followRange: number;
  /** Melee attack cooldown in ticks. */
  attackCooldown: number;
  burnsInDaylight: boolean;
  /** Creeper explosion power (0 = does not explode). */
  explosionPower: number;
  /** Skeleton-like ranged attacker. */
  ranged: boolean;
  drops: readonly MobDrop[];
}

export const MOB_STATS: Readonly<Record<MobType, MobStats>> = {
  zombie: {
    health: 20,
    speed: 2.3,
    damage: 3,
    followRange: 20,
    attackCooldown: 20,
    burnsInDaylight: true,
    explosionPower: 0,
    ranged: false,
    drops: [
      { item: 'rotten_flesh', min: 0, max: 2 },
      { item: 'iron_ingot', min: 1, max: 1, chance: 0.025 },
    ],
  },
  skeleton: {
    health: 20,
    speed: 2.5,
    damage: 2,
    followRange: 24,
    attackCooldown: 40,
    burnsInDaylight: true,
    explosionPower: 0,
    ranged: true,
    drops: [
      { item: 'bone', min: 0, max: 2 },
      { item: 'arrow', min: 0, max: 2 },
    ],
  },
  creeper: {
    health: 20,
    speed: 2.6,
    damage: 0,
    followRange: 20,
    attackCooldown: 20,
    burnsInDaylight: false,
    explosionPower: 3,
    ranged: false,
    drops: [{ item: 'gunpowder', min: 0, max: 2 }],
  },
  spider: {
    health: 16,
    speed: 3.2,
    damage: 2,
    followRange: 20,
    attackCooldown: 20,
    burnsInDaylight: false,
    explosionPower: 0,
    ranged: false,
    drops: [{ item: 'string', min: 0, max: 2 }],
  },
  pig: {
    health: 10,
    speed: 1.6,
    damage: 0,
    followRange: 0,
    attackCooldown: 20,
    burnsInDaylight: false,
    explosionPower: 0,
    ranged: false,
    drops: [{ item: 'raw_porkchop', min: 1, max: 3 }],
  },
  cow: {
    health: 10,
    speed: 1.4,
    damage: 0,
    followRange: 0,
    attackCooldown: 20,
    burnsInDaylight: false,
    explosionPower: 0,
    ranged: false,
    drops: [
      { item: 'raw_beef', min: 1, max: 3 },
      { item: 'leather', min: 0, max: 2 },
    ],
  },
  sheep: {
    health: 8,
    speed: 1.5,
    damage: 0,
    followRange: 0,
    attackCooldown: 20,
    burnsInDaylight: false,
    explosionPower: 0,
    ranged: false,
    drops: [
      { item: 'raw_mutton', min: 1, max: 2 },
      { item: 'white_wool', min: 1, max: 1 },
    ],
  },
  chicken: {
    health: 4,
    speed: 1.8,
    damage: 0,
    followRange: 0,
    attackCooldown: 20,
    burnsInDaylight: false,
    explosionPower: 0,
    ranged: false,
    drops: [
      { item: 'raw_chicken', min: 1, max: 1 },
      { item: 'feather', min: 0, max: 2 },
    ],
  },
};

export interface MobDropStack {
  item: string;
  count: number;
}

/** Roll a mob's drop table with a deterministic random source. */
export function rollMobDrops(type: MobType, random: () => number): MobDropStack[] {
  const stacks: MobDropStack[] = [];
  for (const drop of MOB_STATS[type].drops) {
    if (drop.chance !== undefined && random() >= drop.chance) continue;
    const count = drop.min + Math.floor(random() * (drop.max - drop.min + 1));
    if (count > 0) stacks.push({ item: drop.item, count });
  }
  return stacks;
}

/** Player snapshot mobs need; kept minimal so it does not import gameplay-b. */
export interface MobTargetView {
  position: Vec3;
  yaw?: number;
  pitch?: number;
  gameMode?: 'survival' | 'creative';
  health?: number;
}

export interface MobAIContext {
  world: WorldView;
  target: MobTargetView | null;
  /** Deterministic random in [0,1). */
  random: () => number;
  /** Difficulty damage multiplier (easy 0.5, normal 1, hard 1.5). */
  difficultyDamageScale?: number;
  onMeleeHit?: (mob: Mob, damage: number) => void;
  onRangedAttack?: (mob: Mob, damage: number, direction: Vec3) => void;
  onFuseStart?: (mob: Mob) => void;
  onFuseEnd?: (mob: Mob) => void;
}

const WANDER_RADIUS = 8;
const CHASE_REPATH_TICKS = 10;

export class Mob extends Entity {
  readonly kind = 'mob';
  readonly type: MobType;
  readonly typeName: string;
  readonly stats: MobStats;

  state: MobState = 'idle';
  /** Creeper fuse progress in ticks (0 = not primed). */
  fuse = 0;
  /** Set by the manager right before a fuse explosion so drops are skipped. */
  deathCause: 'normal' | 'explosion' = 'normal';
  headYaw: number;
  headPitch = 0;
  /** Ticks a spider stays aggravated after being hit. */
  private provokedTicks = 0;
  private fleeTicks = 0;
  private fleeTarget: Vec3 | null = null;
  private wanderTimer = 0;
  private idleTimer = 0;
  private wanderTarget: Vec3 | null = null;
  private rangedCooldown = 0;
  private spiderJumpCooldown = 0;
  private repathTimer = 0;
  private path: Vec3[] = [];
  private pathIndex = 0;
  private pathTarget: Vec3 | null = null;
  private burnDamageTimer = 0;
  private lavaDamageTimer = 0;
  private lastStuckPos: Vec3 | null = null;
  private stuckTicks = 0;
  private fuseFired = false;

  constructor(type: MobType, x: number, y: number, z: number) {
    const model = MOB_MODELS[type];
    super({
      x,
      y,
      z,
      width: model.width,
      height: model.height,
      health: MOB_STATS[type].health,
    });
    this.type = type;
    this.typeName = type;
    this.stats = MOB_STATS[type];
    this.eyeHeight = model.eyeHeight;
    this.headYaw = this.yaw;
    this.noGravity = false;
    this.idleTimer = 20;
  }

  get isHostile(): boolean {
    return isHostileMob(this.type);
  }

  get isPassive(): boolean {
    return isPassiveMob(this.type);
  }

  /** True while a spider is angry (hurt recently). */
  get isProvoked(): boolean {
    return this.provokedTicks > 0 || this.hurtTime > 0;
  }

  get pathLength(): number {
    return Math.max(0, this.path.length - this.pathIndex);
  }

  get currentPath(): readonly Vec3[] {
    return this.path.slice(this.pathIndex);
  }

  /** Override so environmental damage (fire/lava/void) also reacts like a hit. */
  override hurt(amount: number, source: Vec3 | null = null, knockback = 4): boolean {
    const applied = super.hurt(amount, source, knockback);
    if (applied) {
      this.provokedTicks = 200;
      if (this.isPassive) {
        this.fleeTicks = FLEE_TICKS;
        this.fleeTarget = null;
        this.path = [];
        this.pathIndex = 0;
      }
      if (this.state === 'idle' || this.state === 'wander') this.state = 'hurt';
    }
    return applied;
  }

  /** Physics + environment damage. AI runs separately via updateAI. */
  override update(dtTicks: number, world: WorldView): void {
    if (this.deathTime >= 0) {
      this.state = 'dead';
      super.update(dtTicks, world);
      return;
    }
    this.tickEnvironmentDamage(dtTicks, world);
    super.update(dtTicks, world);
  }

  private tickEnvironmentDamage(dtTicks: number, world: WorldView): void {
    // Daylight burning: zombies/skeletons ignite in the open during the day.
    if (this.stats.burnsInDaylight) {
      if (this.inWater) {
        this.fireTicks = 0;
      } else if (shouldBurnInDaylight(this.type, world, this.eyePosition())) {
        this.fireTicks = Math.max(this.fireTicks, 100);
      }
    }
    if (this.fireTicks > 0) {
      this.burnDamageTimer += dtTicks;
      if (this.burnDamageTimer >= 20) {
        this.burnDamageTimer -= 20;
        this.hurt(1, null, 0);
      }
    } else {
      this.burnDamageTimer = 0;
    }
    if (this.inLava) {
      this.lavaDamageTimer += dtTicks;
      if (this.lavaDamageTimer >= 20) {
        this.lavaDamageTimer -= 20;
        this.hurt(4, null, 0);
      }
    } else {
      this.lavaDamageTimer = 0;
    }
  }

  // -------------------------------------------------------------------------
  // AI
  // -------------------------------------------------------------------------

  updateAI(dtTicks: number, ctx: MobAIContext): void {
    if (this.deathTime >= 0) {
      this.state = 'dead';
      return;
    }
    const world = ctx.world;
    if (this.provokedTicks > 0) this.provokedTicks = Math.max(0, this.provokedTicks - dtTicks);
    if (this.fleeTicks > 0) this.fleeTicks = Math.max(0, this.fleeTicks - dtTicks);
    if (this.rangedCooldown > 0) this.rangedCooldown = Math.max(0, this.rangedCooldown - dtTicks);
    if (this.spiderJumpCooldown > 0) {
      this.spiderJumpCooldown = Math.max(0, this.spiderJumpCooldown - dtTicks);
    }
    if (this.repathTimer > 0) this.repathTimer = Math.max(0, this.repathTimer - dtTicks);

    const targetInfo = this.evaluateTarget(world, ctx.target);
    const hostileAt = isHostileAt(this.type, world, this.isProvoked);
    const rangedReady = this.rangedCooldown <= 0 && targetInfo !== null && targetInfo.visible;

    const decision = decideMobState({
      type: this.type,
      health: this.health,
      hurtTime: this.hurtTime,
      state: this.state,
      target: targetInfo,
      hostileAt,
      attackCooldown: this.attackCooldown,
      fuse: this.fuse,
      fleeTicks: this.fleeTicks,
      followRange: this.stats.followRange,
      rangedReady,
    });

    // Apply the decision, keeping idle/wander timers under mob control.
    if (decision === 'dead') {
      this.state = 'dead';
      return;
    }
    if (decision === 'hurt') {
      this.state = 'hurt';
      this.clearPath();
      return;
    }
    if (decision === 'flee') {
      this.state = 'flee';
      this.updateFlee(world, ctx.random);
      return;
    }
    if (decision === 'chase' || decision === 'attack') {
      this.state = decision;
      this.updateHostile(world, ctx, targetInfo, dtTicks);
      return;
    }

    // Passive / no-target behaviour.
    if (this.state === 'chase' || this.state === 'attack') this.state = 'wander';
    if (this.state === 'hurt') {
      this.state = 'idle';
      this.idleTimer = 20;
    }
    this.updatePassive(world, ctx.random, dtTicks);
  }

  private evaluateTarget(world: WorldView, target: MobTargetView | null): MobTargetInfo | null {
    if (!target) return null;
    const health = target.health ?? 20;
    if (health <= 0) return null;
    const dx = target.position.x - this.position.x;
    const dz = target.position.z - this.position.z;
    const dy = target.position.y - this.position.y;
    const horizontalDistance = Math.hypot(dx, dz);
    const distance = Math.sqrt(dx * dx + dy * dy + dz * dz);
    const chest: Vec3 = {
      x: target.position.x,
      y: target.position.y + 1.4,
      z: target.position.z,
    };
    const visible = canSee(world, this.eyePosition(), chest, Math.max(this.stats.followRange, 24));
    return {
      distance,
      horizontalDistance,
      visible,
      alive: health > 0,
      targetable: (target.gameMode ?? 'survival') !== 'creative',
    };
  }

  // -------------------------------------------------------------------------
  // Hostile behaviour
  // -------------------------------------------------------------------------

  private updateHostile(
    world: WorldView,
    ctx: MobAIContext,
    target: MobTargetInfo | null,
    dtTicks: number,
  ): void {
    if (!target || !ctx.target) {
      this.state = 'wander';
      this.updatePassive(world, ctx.random, dtTicks);
      return;
    }
    const targetPos = ctx.target.position;
    this.faceTowards(targetPos);

    if (this.type === 'creeper') {
      this.updateCreeper(world, ctx, target, targetPos, dtTicks);
      return;
    }
    if (this.type === 'skeleton') {
      this.updateSkeleton(world, ctx, target, targetPos, dtTicks);
      return;
    }

    // Zombie / spider melee.
    if (
      target.visible &&
      target.horizontalDistance <= 2.2 &&
      Math.abs(targetPos.y - this.position.y) < 2.2
    ) {
      if (this.attackCooldown <= 0) {
        this.attackCooldown = this.stats.attackCooldown;
        const scale = ctx.difficultyDamageScale ?? 1;
        const damage = Math.max(0, Math.round(this.stats.damage * scale));
        if (damage > 0) ctx.onMeleeHit?.(this, damage);
      }
      this.velocity.x *= 0.5;
      this.velocity.z *= 0.5;
      return;
    }

    if (this.type === 'spider') this.maybeSpiderJump(target, targetPos);
    this.moveTowardsTarget(world, ctx.random, targetPos, 1);
  }

  private updateCreeper(
    world: WorldView,
    ctx: MobAIContext,
    target: MobTargetInfo,
    targetPos: Vec3,
    _dtTicks: number,
  ): void {
    const shouldPrime =
      target.visible && target.horizontalDistance <= CREEPER_FUSE_RANGE && Math.abs(targetPos.y - this.position.y) < 3;
    if (shouldPrime) {
      if (this.fuse === 0) ctx.onFuseStart?.(this);
      this.fuse = Math.min(CREEPER_FUSE_TICKS, this.fuse + 1);
    } else if (
      this.fuse > 0 &&
      (!target.visible || target.horizontalDistance > CREEPER_FUSE_CANCEL_RANGE)
    ) {
      this.fuse = 0;
    }
    if (this.fuse >= CREEPER_FUSE_TICKS && !this.fuseFired) {
      this.fuseFired = true;
      ctx.onFuseEnd?.(this);
      return;
    }
    // Creepers slow down while priming, sneaking up on the player.
    const speedScale = this.fuse > 0 ? 0.35 : target.horizontalDistance < 8 ? 0.8 : 1;
    this.moveTowardsTarget(world, ctx.random, targetPos, speedScale);
  }

  private updateSkeleton(
    world: WorldView,
    ctx: MobAIContext,
    target: MobTargetInfo,
    targetPos: Vec3,
    _dtTicks: number,
  ): void {
    const distance = target.horizontalDistance;
    // Shoot when there is a clear line and the cooldown is ready.
    if (this.rangedCooldown <= 0 && target.visible && distance <= this.stats.followRange) {
      this.rangedCooldown = this.stats.attackCooldown;
      const damage = skeletonArrowDamage(distance);
      const eye = this.eyePosition();
      const dx = targetPos.x - eye.x;
      const dy = targetPos.y + 1.2 - eye.y;
      const dz = targetPos.z - eye.z;
      const len = Math.hypot(dx, dy, dz) || 1;
      // Small deterministic lead so arrows arc onto the player's chest.
      const direction: Vec3 = { x: dx / len, y: dy / len + 0.06, z: dz / len };
      const dirLen = Math.hypot(direction.x, direction.y, direction.z) || 1;
      direction.x /= dirLen;
      direction.y /= dirLen;
      direction.z /= dirLen;
      ctx.onRangedAttack?.(this, damage, direction);
    }

    // Keep distance: back off when too close, strafe at medium range.
    if (distance < 4) {
      this.steerAway(world, targetPos, 1.1);
    } else if (distance > 12) {
      this.moveTowardsTarget(world, ctx.random, targetPos, 1);
    } else {
      this.strafeAround(targetPos, 0.8);
    }
  }

  private maybeSpiderJump(target: MobTargetInfo, targetPos: Vec3): void {
    if (this.spiderJumpCooldown > 0 || !this.onGround) return;
    const verticalGap = targetPos.y - this.position.y;
    const shouldLeap =
      (verticalGap > 0.6 && target.horizontalDistance < 5) ||
      (target.horizontalDistance < 4 && this.age % 60 === 0);
    if (!shouldLeap) return;
    const dx = targetPos.x - this.position.x;
    const dz = targetPos.z - this.position.z;
    const len = Math.hypot(dx, dz) || 1;
    this.velocity.x = (dx / len) * 5.5;
    this.velocity.z = (dz / len) * 5.5;
    this.velocity.y = 8.2;
    this.spiderJumpCooldown = 30;
  }

  // -------------------------------------------------------------------------
  // Passive behaviour
  // -------------------------------------------------------------------------

  private updatePassive(world: WorldView, random: () => number, dtTicks: number): void {
    if (this.state === 'idle') {
      this.idleTimer -= dtTicks;
      this.velocity.x *= 0.7;
      this.velocity.z *= 0.7;
      if (this.idleTimer <= 0) {
        this.state = 'wander';
        this.wanderTimer = 0;
      }
      return;
    }
    if (this.state !== 'wander') return;

    this.wanderTimer -= dtTicks;
    if (this.wanderTarget === null || this.wanderTimer <= 0) {
      this.wanderTarget = pickWanderTarget(random, this.position, WANDER_RADIUS);
      this.wanderTimer = 80 + Math.floor(random() * 100);
      this.path = [];
      this.pathIndex = 0;
      this.lastStuckPos = null;
      this.stuckTicks = 0;
    }
    const dx = this.wanderTarget.x - this.position.x;
    const dz = this.wanderTarget.z - this.position.z;
    if (Math.hypot(dx, dz) < 0.8) {
      this.wanderTarget = null;
      this.state = 'idle';
      this.idleTimer = 30 + Math.floor(random() * 60);
      return;
    }
    this.steerTowards(world, this.wanderTarget, this.stats.speed * 0.55);
    this.detectStuck(dtTicks);
  }

  private updateFlee(world: WorldView, random: () => number): void {
    const threat = this.lastHurtBy ?? this.fleeTarget ?? this.position;
    if (!this.fleeTarget) {
      this.fleeTarget = pickFleeTarget(random, this.position, threat, FLEE_DISTANCE);
      this.path = [];
      this.pathIndex = 0;
    }
    const dx = this.fleeTarget.x - this.position.x;
    const dz = this.fleeTarget.z - this.position.z;
    if (Math.hypot(dx, dz) < 1) {
      this.fleeTarget = pickFleeTarget(random, this.position, threat, FLEE_DISTANCE);
    }
    this.faceTowards(this.fleeTarget);
    this.steerTowards(world, this.fleeTarget, this.stats.speed * 1.6);
    if (this.fleeTicks <= 0) {
      this.fleeTarget = null;
      this.state = 'idle';
      this.idleTimer = 30;
    }
  }

  // -------------------------------------------------------------------------
  // Movement helpers
  // -------------------------------------------------------------------------

  private moveTowardsTarget(
    world: WorldView,
    random: () => number,
    targetPos: Vec3,
    speedScale: number,
  ): void {
    const speed = this.stats.speed * speedScale;
    const distance = Math.hypot(targetPos.x - this.position.x, targetPos.z - this.position.z);
    const verticalGap = targetPos.y - this.position.y;
    // Close range and visible: steer straight at the target.
    const direct =
      distance < 6 &&
      canSee(world, this.eyePosition(), { x: targetPos.x, y: targetPos.y + 0.9, z: targetPos.z }, 12) &&
      !this.isLiquidAhead(world, targetPos.x - this.position.x, targetPos.z - this.position.z);
    if (direct) {
      this.clearPath();
      this.steerTowards(world, targetPos, speed);
      if (verticalGap > 0.6 && this.onGround && distance < 3.2) this.velocity.y = 8.9;
      return;
    }

    // Pathfind around obstacles: repath periodically or when the target moved.
    const needsRepath =
      this.path.length === 0 ||
      this.pathIndex >= this.path.length ||
      this.repathTimer <= 0 ||
      this.pathTarget === null ||
      Math.hypot(this.pathTarget.x - targetPos.x, this.pathTarget.z - targetPos.z) > 2;
    if (needsRepath) {
      this.repath(world, targetPos, random);
      this.repathTimer = CHASE_REPATH_TICKS;
    }
    this.followPath(world, speed);
  }

  private repath(world: WorldView, targetPos: Vec3, _random: () => number): void {
    const options: PathOptions = {
      maxNodes: 300,
      timeBudgetMs: 500,
      bodyHeight: this.height > 1.2 ? 2 : 1,
      avoidLiquids: true,
      goalRadius: 1,
    };
    const result = findPath(world, this.position, targetPos, options);
    this.pathTarget = { ...targetPos };
    if (result.found && result.waypoints.length > 0) {
      this.path = result.waypoints;
      this.pathIndex = 0;
    } else {
      this.path = [];
      this.pathIndex = 0;
    }
  }

  private followPath(world: WorldView, speed: number): void {
    if (this.pathIndex >= this.path.length) {
      this.velocity.x *= 0.6;
      this.velocity.z *= 0.6;
      return;
    }
    const waypoint = this.path[this.pathIndex];
    const dx = waypoint.x - this.position.x;
    const dz = waypoint.z - this.position.z;
    const horizontal = Math.hypot(dx, dz);
    if (horizontal < 0.5 && waypoint.y - this.position.y < 1.2) {
      this.pathIndex++;
      return;
    }
    this.steerTowards(world, waypoint, speed);
    if (waypoint.y > this.position.y + 0.5 && this.onGround) {
      this.velocity.y = 8.9;
    }
  }

  private steerTowards(world: WorldView, point: Vec3, speed: number): void {
    let dx = point.x - this.position.x;
    let dz = point.z - this.position.z;
    const len = Math.hypot(dx, dz);
    if (len < 1e-4) {
      this.velocity.x *= 0.5;
      this.velocity.z *= 0.5;
      return;
    }
    dx /= len;
    dz /= len;
    if (this.isLiquidAhead(world, dx, dz)) {
      // Never voluntarily walk into water/lava; stop at the shore.
      this.velocity.x *= 0.3;
      this.velocity.z *= 0.3;
      return;
    }
    this.velocity.x = dx * speed;
    this.velocity.z = dz * speed;
    if (this.onGround) this.yaw = turnTowards(this.yaw, yawOf(dx, dz), 0.35);
  }

  private steerAway(world: WorldView, threat: Vec3, speed: number): void {
    let dx = this.position.x - threat.x;
    let dz = this.position.z - threat.z;
    const len = Math.hypot(dx, dz) || 1;
    dx /= len;
    dz /= len;
    if (this.isLiquidAhead(world, dx, dz)) {
      this.strafeAround(threat, speed);
      return;
    }
    this.velocity.x = dx * this.stats.speed * speed;
    this.velocity.z = dz * this.stats.speed * speed;
  }

  private strafeAround(threat: Vec3, speed: number): void {
    const dx = this.position.x - threat.x;
    const dz = this.position.z - threat.z;
    const len = Math.hypot(dx, dz) || 1;
    // Perpendicular direction; sign flips every few seconds for variety.
    const sign = Math.sin(this.age * 0.05) >= 0 ? 1 : -1;
    const perpX = (-dz / len) * sign;
    const perpZ = (dx / len) * sign;
    this.velocity.x = perpX * this.stats.speed * speed;
    this.velocity.z = perpZ * this.stats.speed * speed;
  }

  private isLiquidAhead(world: WorldView, dirX: number, dirZ: number): boolean {
    const len = Math.hypot(dirX, dirZ) || 1;
    const ax = Math.floor(this.position.x + (dirX / len) * 0.7);
    const az = Math.floor(this.position.z + (dirZ / len) * 0.7);
    const feet = world.getBlock(ax, Math.floor(this.position.y + 0.1), az);
    return FLUID_KIND[feet] !== 0;
  }

  private faceTowards(point: Vec3): void {
    const dx = point.x - this.position.x;
    const dz = point.z - this.position.z;
    if (Math.abs(dx) + Math.abs(dz) < 1e-4) return;
    this.yaw = turnTowards(this.yaw, yawOf(dx, dz), 0.4);
    this.headYaw = this.yaw;
    const dy = point.y + 1.2 - (this.position.y + this.eyeHeight);
    const horizontal = Math.hypot(dx, dz) || 1;
    this.headPitch = Math.max(-0.9, Math.min(0.9, Math.atan2(-dy, horizontal)));
  }

  private detectStuck(dtTicks: number): void {
    if (!this.lastStuckPos) {
      this.lastStuckPos = { ...this.position };
      this.stuckTicks = 0;
      return;
    }
    const moved = Math.hypot(
      this.position.x - this.lastStuckPos.x,
      this.position.z - this.lastStuckPos.z,
    );
    if (moved < 0.01 && this.onGround) {
      this.stuckTicks += dtTicks;
      if (this.stuckTicks > 20) {
        this.wanderTarget = null;
        this.wanderTimer = 0;
        this.stuckTicks = 0;
      }
    } else {
      this.stuckTicks = 0;
      this.lastStuckPos = { ...this.position };
    }
  }

  private clearPath(): void {
    this.path = [];
    this.pathIndex = 0;
    this.pathTarget = null;
  }

  /** Renderer/AI facing helper: set yaw/head directly (used by tests). */
  setLook(yaw: number, pitch = 0): void {
    this.yaw = yaw;
    this.headYaw = yaw;
    this.headPitch = pitch;
  }
}
