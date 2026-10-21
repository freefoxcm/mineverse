/**
 * EntityManager: owns every mob/item/arrow, drives AI + physics, spawning,
 * combat resolution, explosions and item pickup. The Lead wires it into main;
 * it never touches the DOM or the game loop itself.
 *
 * Feedback contract (all optional, wired by Lead):
 *   onSound(name, position)
 *   onParticles(kind, position, count)
 *   onBlockBreak(x, y, z, blockId)      // explosion broke a block
 *   onPlayerHurt({ damage, knockback, ... })
 *   onItemPickup(slot) => accepted count
 *   onExplosion(result)                 // screen shake / stats
 *   onMobSpawned(mob)                   // debug/E2E bookkeeping
 */

import { hashString, Rand } from '../core/rng';
import type { WorldView } from '../core/contracts';
import type { BlockId, Difficulty, GameMode, Slot, Vec3 } from '../core/types';
import {
  aabbOverlap,
  DEATH_ANIM_TICKS,
  type AABB,
  type Entity,
  type EntityKind,
  rayAABB,
} from './entity';
import {
  explode,
  type ExplosionOptions,
  type ExplosionResult,
  type ExplosionTarget,
} from './explosion';
import { consumeStack, ITEM_PICKUP_RADIUS, ItemEntity, type ItemSpawnOptions } from './itemEntity';
import { Mob, MOB_STATS, rollMobDrops, type MobAIContext } from './mob';
import { isHostileMob, type MobType } from './models';
import { Arrow, createArrow, type ArrowSpawnOptions } from './projectile';
import type { EntitySnapshot } from './snapshot';
import { Spawner, type SpawnerOptions } from './spawner';

/** Minimal player view the entity system needs; implemented by main/B. */
export interface EntityPlayerView {
  position: Vec3;
  yaw?: number;
  pitch?: number;
  gameMode?: GameMode;
  health?: number;
  maxHealth?: number;
  inventory?: readonly Slot[];
  /** Current melee damage (half-hearts), informational only. */
  attack?: number;
  onGround?: boolean;
  inWater?: boolean;
}

export interface PlayerHurtEvent {
  damage: number;
  /** Player position at the moment of the hit. */
  position: Vec3;
  sourceId: number;
  sourceType: string;
  sourcePosition: Vec3;
  /** Velocity impulse the Lead should add to the player. */
  knockback: Vec3;
  cause: 'melee' | 'arrow' | 'explosion';
}

export interface EntityFeedback {
  onSound?: (name: string, position: Vec3) => void;
  onParticles?: (kind: string, position: Vec3, count: number) => void;
  onBlockBreak?: (x: number, y: number, z: number, id: BlockId) => void;
  onPlayerHurt?: (event: PlayerHurtEvent) => void;
  onItemPickup?: (slot: Slot) => number;
  onExplosion?: (result: ExplosionResult) => void;
  onMobSpawned?: (mob: Mob) => void;
}

export interface EntityManagerOptions {
  difficulty?: Difficulty | (() => Difficulty);
  /** World seed; used to derive the deterministic spawn RNG. */
  seed?: string | number;
  /** Explicit deterministic random in [0,1); overrides seed. */
  random?: () => number;
  feedback?: EntityFeedback;
  /** Custom spawner instance or rule overrides. */
  spawner?: Spawner | SpawnerOptions;
  /** Disable natural spawning (tests / E2E determinism). */
  spawnEnabled?: boolean;
}

export interface EntityRayHit {
  entity: Entity;
  distance: number;
  point: Vec3;
}

export interface PlayerAttackResult {
  entityId: number;
  type: string;
  kind: EntityKind;
  position: Vec3;
  distance: number;
  damageDealt: number;
  healthBefore: number;
  healthAfter: number;
  killed: boolean;
}

export interface RaycastEntityOptions {
  /** Restrict to these entity kinds (default: mobs only). */
  kinds?: readonly EntityKind[];
  ignoreId?: number;
}

/** Difficulty multiplier for damage dealt to the player. */
export function difficultyDamageScale(difficulty: Difficulty): number {
  switch (difficulty) {
    case 'peaceful':
      return 0;
    case 'easy':
      return 0.5;
    case 'normal':
      return 1;
    case 'hard':
      return 1.5;
  }
}

const ITEM_PICKUP_COOLDOWN_SOUND = 'item.pickup';

export class EntityManager {
  readonly spawner: Spawner;
  private readonly entities: Entity[] = [];
  private readonly feedback: EntityFeedback;
  private difficultyOption: Difficulty | (() => Difficulty);
  private readonly randomFn: () => number;
  private readonly rng: Rand;
  private spawnEnabled: boolean;
  private world: WorldView | null = null;
  private player: EntityPlayerView | null = null;
  private tickCount = 0;
  private ambientTimer = 0;

  constructor(options: EntityManagerOptions = {}) {
    this.feedback = options.feedback ?? {};
    this.difficultyOption = options.difficulty ?? 'normal';
    this.spawnEnabled = options.spawnEnabled ?? true;
    const seed = options.seed ?? 'mineverse';
    const numericSeed = typeof seed === 'number' ? seed >>> 0 : hashString(seed);
    this.rng = new Rand(numericSeed);
    this.randomFn = options.random ?? (() => this.rng.next());
    this.spawner =
      options.spawner instanceof Spawner
        ? options.spawner
        : new Spawner(options.spawner ?? {});
  }

  // -------------------------------------------------------------------------
  // Accessors
  // -------------------------------------------------------------------------

  get all(): readonly Entity[] {
    return this.entities;
  }

  get mobs(): readonly Mob[] {
    return this.entities.filter((entity): entity is Mob => entity.kind === 'mob');
  }

  get items(): readonly ItemEntity[] {
    return this.entities.filter((entity): entity is ItemEntity => entity.kind === 'item');
  }

  get arrows(): readonly Arrow[] {
    return this.entities.filter((entity): entity is Arrow => entity.kind === 'arrow');
  }

  get entityCount(): number {
    return this.entities.length;
  }

  get hostileCount(): number {
    return this.mobs.filter((mob) => isHostileMob(mob.type) && mob.isAlive).length;
  }

  get passiveCount(): number {
    return this.mobs.filter((mob) => !isHostileMob(mob.type) && mob.isAlive).length;
  }

  get tick(): number {
    return this.tickCount;
  }

  get currentWorld(): WorldView | null {
    return this.world;
  }

  get currentDifficulty(): Difficulty {
    return typeof this.difficultyOption === 'function'
      ? this.difficultyOption()
      : this.difficultyOption;
  }

  setSpawnEnabled(enabled: boolean): void {
    this.spawnEnabled = enabled;
  }

  setDifficulty(difficulty: Difficulty | (() => Difficulty)): void {
    this.difficultyOption = difficulty;
  }

  /** Random source used for spawning/drops; deterministic by default. */
  random(): number {
    return this.randomFn();
  }

  // -------------------------------------------------------------------------
  // Spawning
  // -------------------------------------------------------------------------

  spawn(type: MobType, x: number, y: number, z: number): Mob {
    const mob = new Mob(type, x, y, z);
    mob.onDeath = (entity) => this.handleMobDeath(entity as Mob);
    this.entities.push(mob);
    this.feedback.onMobSpawned?.(mob);
    return mob;
  }

  spawnItem(itemId: string, count: number, pos: Vec3, options: ItemSpawnOptions = {}): ItemEntity {
    const velocity =
      options.velocity ??
      ({
        x: (this.randomFn() - 0.5) * 1.6,
        y: 1.8 + this.randomFn() * 1.2,
        z: (this.randomFn() - 0.5) * 1.6,
      } as Vec3);
    const item = new ItemEntity(itemId, count, pos.x, pos.y, pos.z, {
      ...options,
      velocity,
    });
    this.entities.push(item);
    return item;
  }

  spawnArrow(origin: Vec3, direction: Vec3, options: ArrowSpawnOptions = {}): Arrow {
    const arrow = createArrow(origin, direction, options);
    this.entities.push(arrow);
    return arrow;
  }

  /** Player bow: charge 0..1 (Lead/B calls this when the bow is released). */
  shootBow(eye: Vec3, direction: Vec3, charge: number, ownerId = -1): Arrow {
    const arrow = this.spawnArrow(eye, direction, {
      speed: 20 + Math.max(0, Math.min(1, charge)) * 40,
      damage: Math.round(2 + Math.max(0, Math.min(1, charge)) * 7),
      ownerId,
    });
    this.feedback.onSound?.('entity.arrow.shoot', { ...eye });
    return arrow;
  }

  remove(entity: Entity): void {
    entity.discard();
    const index = this.entities.indexOf(entity);
    if (index >= 0) this.entities.splice(index, 1);
  }

  clear(): void {
    this.entities.length = 0;
  }

  /** Remove every dropped item (e.g. on world change). */
  clearItems(): void {
    for (const item of this.items) item.removed = true;
  }

  // -------------------------------------------------------------------------
  // Update
  // -------------------------------------------------------------------------

  update(
    tick: number,
    world: WorldView,
    player: EntityPlayerView | null,
    dtTicks = 1,
  ): void {
    this.world = world;
    this.player = player;
    this.tickCount = tick;
    const difficulty = this.currentDifficulty;
    const damageScale = difficultyDamageScale(difficulty);
    const targetablePlayer =
      player && (player.health ?? 20) > 0 && (player.gameMode ?? 'survival') !== 'creative'
        ? player
        : null;

    // --- Mobs: AI then physics. ------------------------------------------
    const aiContext: MobAIContext = {
      world,
      target: player,
      random: this.randomFn,
      difficultyDamageScale: damageScale,
      onMeleeHit: (mob, damage) => this.onMobMelee(mob, damage),
      onRangedAttack: (mob, damage, direction) => this.onMobRangedAttack(mob, damage, direction),
      onFuseStart: (mob) =>
        this.feedback.onSound?.('mob.creeper.primed', { ...mob.position }),
      onFuseEnd: (mob) => this.detonateCreeper(mob),
    };
    for (const mob of this.mobs) {
      if (!mob.isDead) mob.updateAI(dtTicks, aiContext);
      mob.update(dtTicks, world);
    }

    // --- Items: physics then player pickup. -------------------------------
    for (const item of this.items) {
      if (item.removed) continue;
      item.update(dtTicks, world);
      if (targetablePlayer) this.tryPickup(item, targetablePlayer);
    }

    // --- Arrows: physics then entity collision. ---------------------------
    for (const arrow of this.arrows) {
      if (arrow.removed) continue;
      arrow.update(dtTicks, world);
      this.resolveArrowCollision(arrow, targetablePlayer);
    }

    // --- Natural spawning (once per second). ------------------------------
    if (this.spawnEnabled && player && tick % 20 === 0) {
      this.runSpawnCycle(world, player, difficulty);
    }

    // --- Despawn checks. --------------------------------------------------
    if (player) this.despawnFarEntities(player, difficulty);

    // --- Ambient mob sounds (deterministic, throttled). -------------------
    this.ambientTimer += dtTicks;
    if (this.ambientTimer >= 100) {
      this.ambientTimer = 0;
      for (const mob of this.mobs) {
        if (mob.isDead) continue;
        if (this.randomFn() < 0.06) {
          this.feedback.onSound?.(mobSound(mob.type, 'say'), { ...mob.position });
        }
      }
    }

    // --- Cleanup removed entities. ---------------------------------------
    for (let i = this.entities.length - 1; i >= 0; i--) {
      if (this.entities[i].removed) this.entities.splice(i, 1);
    }
  }

  private runSpawnCycle(world: WorldView, player: EntityPlayerView, difficulty: Difficulty): void {
    const result = this.spawner.tick({
      world,
      playerPosition: player.position,
      difficulty,
      hostileCount: this.hostileCount,
      passiveCount: this.passiveCount,
      random: this.randomFn,
    });
    if (result.hostile) {
      this.spawn(result.hostile.type, result.hostile.position.x, result.hostile.position.y, result.hostile.position.z);
    }
    if (result.passive) {
      this.spawn(result.passive.type, result.passive.position.x, result.passive.position.y, result.passive.position.z);
    }
  }

  private despawnFarEntities(player: EntityPlayerView, difficulty: Difficulty): void {
    for (const mob of this.mobs) {
      if (!mob.isAlive) continue;
      if (this.spawner.shouldDespawn(mob.type, mob.position, player.position, difficulty)) {
        mob.discard();
        this.feedback.onParticles?.('poof', { ...mob.position }, 6);
      }
    }
  }

  // -------------------------------------------------------------------------
  // Combat: mobs -> player, arrows, explosions
  // -------------------------------------------------------------------------

  private onMobMelee(mob: Mob, damage: number): void {
    this.feedback.onSound?.(mobSound(mob.type, 'attack'), { ...mob.position });
    if (!this.player) return;
    if ((this.player.gameMode ?? 'survival') === 'creative') return;
    const dx = this.player.position.x - mob.position.x;
    const dz = this.player.position.z - mob.position.z;
    const len = Math.hypot(dx, dz) || 1;
    const strength = 3.5;
    this.emitPlayerHurt({
      damage,
      position: { ...this.player.position },
      sourceId: mob.id,
      sourceType: mob.type,
      sourcePosition: { ...mob.position },
      knockback: { x: (dx / len) * strength, y: 2.5, z: (dz / len) * strength },
      cause: 'melee',
    });
  }

  private onMobRangedAttack(mob: Mob, damage: number, direction: Vec3): void {
    const eye = mob.eyePosition();
    this.spawnArrow(
      { x: eye.x + direction.x * 0.5, y: eye.y - 0.1, z: eye.z + direction.z * 0.5 },
      direction,
      { speed: 42, damage, ownerId: mob.id },
    );
    this.feedback.onSound?.(mobSound(mob.type, 'shoot'), { ...mob.position });
  }

  private resolveArrowCollision(arrow: Arrow, player: EntityPlayerView | null): void {
    if (arrow.stuck || arrow.removed) return;
    const tip = arrow.tipBox();
    for (const entity of this.entities) {
      if (entity === arrow || entity.kind !== 'mob') continue;
      if (!entity.isAlive) continue;
      if (entity.id === arrow.ownerId && arrow.age < 20) continue;
      const mob = entity as Mob;
      if (!aabbOverlap(tip, mob.aabb())) continue;
      const damage = arrow.damage;
      const applied = mob.hurt(damage, { ...arrow.position }, 3);
      this.feedback.onParticles?.('crit', { ...arrow.position }, 4);
      this.feedback.onSound?.(mobSound(mob.type, 'hurt'), { ...mob.position });
      arrow.stickIntoEntity();
      if (applied) this.feedback.onSound?.('entity.arrow.hit', { ...arrow.position });
      return;
    }
    if (!player) return;
    if ((player.gameMode ?? 'survival') === 'creative') return;
    const playerBox: AABB = {
      minX: player.position.x - 0.3,
      minY: player.position.y,
      minZ: player.position.z - 0.3,
      maxX: player.position.x + 0.3,
      maxY: player.position.y + 1.8,
      maxZ: player.position.z + 0.3,
    };
    if (!aabbOverlap(tip, playerBox)) return;
    if (arrow.ownerId === -1 && arrow.age < 20) return;
    const owner = this.entities.find((entity) => entity.id === arrow.ownerId);
    this.emitPlayerHurt({
      damage: arrow.damage,
      position: { ...player.position },
      sourceId: arrow.ownerId,
      sourceType: owner?.typeName ?? 'arrow',
      sourcePosition: { ...arrow.position },
      knockback: {
        x: arrow.velocity.x * 0.15,
        y: 1.5,
        z: arrow.velocity.z * 0.15,
      },
      cause: 'arrow',
    });
    this.feedback.onParticles?.('crit', { ...arrow.position }, 4);
    arrow.stickIntoEntity();
  }

  private emitPlayerHurt(event: PlayerHurtEvent): void {
    if (event.damage <= 0) return;
    this.feedback.onParticles?.('hurt', { ...event.position }, 4);
    this.feedback.onPlayerHurt?.(event);
  }

  /** Creeper reached the end of its fuse: explode and remove the mob. */
  private detonateCreeper(mob: Mob): void {
    mob.deathCause = 'explosion';
    const center = {
      x: mob.position.x,
      y: mob.position.y + mob.height * 0.5,
      z: mob.position.z,
    };
    this.remove(mob);
    this.explodeAt(center, MOB_STATS.creeper.explosionPower, 'creeper');
  }

  /**
   * Detonate at a world position. Used by creepers and by the Lead for TNT.
   * Block edits go through world.setBlock and are reported via onBlockBreak.
   */
  explodeAt(
    center: Vec3,
    power: number,
    source: 'creeper' | 'tnt' | 'other' = 'other',
    options: Omit<ExplosionOptions, 'targets' | 'source'> = {},
  ): ExplosionResult {
    const world = this.world;
    if (!world) throw new Error('EntityManager.explodeAt called before update() provided a world');
    const targets: ExplosionTarget[] = [];
    for (const mob of this.mobs) {
      if (mob.isAlive) targets.push(mob);
    }
    let playerDamage = 0;
    let playerKnockback: Vec3 = { x: 0, y: 0, z: 0 };
    const player = this.player;
    let playerTarget: ExplosionTarget | null = null;
    if (player && (player.gameMode ?? 'survival') !== 'creative' && (player.health ?? 20) > 0) {
      playerTarget = {
        id: -1,
        position: player.position,
        width: 0.6,
        height: 1.8,
        hurt: (amount: number) => {
          playerDamage = Math.max(playerDamage, amount);
          return true;
        },
        applyKnockbackFrom: (fromX: number, fromZ: number, strength: number, lift = 0.4) => {
          const dx = player.position.x - fromX;
          const dz = player.position.z - fromZ;
          const len = Math.hypot(dx, dz) || 1;
          playerKnockback = {
            x: (dx / len) * strength,
            y: strength * lift,
            z: (dz / len) * strength,
          };
        },
      };
      targets.push(playerTarget);
    }
    const result = explode(world, center, power, {
      ...options,
      source,
      targets,
      damageMultiplier: options.damageMultiplier ?? difficultyDamageScale(this.currentDifficulty),
      onBlockBreak: (x, y, z, id) => {
        this.feedback.onBlockBreak?.(x, y, z, id);
        options.onBlockBreak?.(x, y, z, id);
      },
      onParticles: (kind, position, count) => {
        this.feedback.onParticles?.(kind, position, count);
        options.onParticles?.(kind, position, count);
      },
      onSound: (name, position) => {
        this.feedback.onSound?.(name, position);
        options.onSound?.(name, position);
      },
    });
    if (playerDamage > 0 && player) {
      this.emitPlayerHurt({
        damage: playerDamage,
        position: { ...player.position },
        sourceId: -1,
        sourceType: source,
        sourcePosition: { ...center },
        knockback: playerKnockback,
        cause: 'explosion',
      });
    }
    this.feedback.onExplosion?.(result);
    return result;
  }

  // -------------------------------------------------------------------------
  // Player-facing combat API (Lead / InteractionController)
  // -------------------------------------------------------------------------

  /**
   * Ray-cast entities and hit the first mob within `reach`.
   * `dir` is normalized internally. Returns damage/health info for the HUD.
   */
  playerAttack(
    eyePos: Vec3,
    dir: Vec3,
    reach: number,
    damage: number,
    knockback = 4,
  ): PlayerAttackResult | null {
    const hit = this.raycastEntities(eyePos, dir, reach, { kinds: ['mob'] });
    if (!hit) return null;
    const mob = hit.entity as Mob;
    return this.attackEntity(mob, damage, eyePos, knockback);
  }

  /** Apply damage to a mob from a player-like source. */
  attackEntity(
    entity: Entity,
    damage: number,
    sourcePos: Vec3,
    knockback = 4,
  ): PlayerAttackResult {
    const healthBefore = entity.health;
    const applied = entity.hurt(damage, sourcePos, knockback);
    this.feedback.onParticles?.('crit', { ...entity.position }, applied ? 5 : 2);
    if (entity.kind === 'mob') {
      this.feedback.onSound?.(mobSound((entity as Mob).type, 'hurt'), { ...entity.position });
    }
    return {
      entityId: entity.id,
      type: entity.typeName,
      kind: entity.kind,
      position: { ...entity.position },
      distance: Math.hypot(
        entity.position.x - sourcePos.x,
        entity.position.y - sourcePos.y,
        entity.position.z - sourcePos.z,
      ),
      damageDealt: applied ? Math.min(damage, healthBefore) : 0,
      healthBefore,
      healthAfter: entity.health,
      killed: entity.isDead,
    };
  }

  /** Ray vs entity AABBs; returns the nearest hit within maxDistance. */
  raycastEntities(
    origin: Vec3,
    direction: Vec3,
    maxDistance: number,
    options: RaycastEntityOptions = {},
  ): EntityRayHit | null {
    const len = Math.hypot(direction.x, direction.y, direction.z);
    if (len < 1e-6) return null;
    const dir: Vec3 = { x: direction.x / len, y: direction.y / len, z: direction.z / len };
    const kinds = options.kinds ?? ['mob'];
    let best: EntityRayHit | null = null;
    for (const entity of this.entities) {
      if (entity.removed || entity.isDead) continue;
      if (entity.id === options.ignoreId) continue;
      if (!kinds.includes(entity.kind)) continue;
      const distance = rayAABB(origin, dir, maxDistance, entity.aabb());
      if (distance === null) continue;
      if (best === null || distance < best.distance) {
        best = {
          entity,
          distance,
          point: {
            x: origin.x + dir.x * distance,
            y: origin.y + dir.y * distance,
            z: origin.z + dir.z * distance,
          },
        };
      }
    }
    return best;
  }

  // -------------------------------------------------------------------------
  // Items & drops
  // -------------------------------------------------------------------------

  private tryPickup(item: ItemEntity, player: EntityPlayerView): void {
    if (!item.canPickup) return;
    const dx = item.position.x - player.position.x;
    const dy = item.position.y - (player.position.y + 0.5);
    const dz = item.position.z - player.position.z;
    const reach = ITEM_PICKUP_RADIUS + 0.4;
    if (dx * dx + dy * dy + dz * dz > reach * reach) return;
    const slot: Slot = { item: item.item, count: item.count };
    const accepted = Math.max(0, Math.floor(this.feedback.onItemPickup?.(slot) ?? 0));
    if (accepted <= 0) return;
    consumeStack(item, accepted);
    this.feedback.onSound?.(ITEM_PICKUP_COOLDOWN_SOUND, { ...item.position });
    this.feedback.onParticles?.('pickup', { ...item.position }, 3);
  }

  private handleMobDeath(mob: Mob): void {
    this.feedback.onSound?.(mobSound(mob.type, 'death'), { ...mob.position });
    this.feedback.onParticles?.('mob_death', { ...mob.position }, 8);
    // A creeper that actually exploded leaves no loot.
    if (mob.type === 'creeper' && mob.deathCause === 'explosion') return;
    const drops = rollMobDrops(mob.type, this.randomFn);
    for (const drop of drops) {
      this.spawnItem(drop.item, drop.count, {
        x: mob.position.x,
        y: mob.position.y + 0.4,
        z: mob.position.z,
      });
    }
  }

  // -------------------------------------------------------------------------
  // Renderer snapshots
  // -------------------------------------------------------------------------

  snapshots(): EntitySnapshot[] {
    const world = this.world;
    const snapshots: EntitySnapshot[] = [];
    for (const entity of this.entities) {
      if (entity.removed) continue;
      const shadowY = world ? groundBelow(world, entity.position, 16) : entity.position.y;
      const base: EntitySnapshot = {
        id: entity.id,
        kind: entity.kind,
        type: entity.typeName,
        position: { ...entity.position },
        previousPosition: { ...entity.previousPosition },
        velocity: { ...entity.velocity },
        yaw: entity.yaw,
        headYaw: entity.yaw,
        headPitch: entity.pitch,
        health: entity.health,
        maxHealth: entity.maxHealth,
        hurtTime: entity.hurtTime,
        deathTime: entity.deathTime,
        fireTicks: entity.fireTicks,
        fuse: 0,
        walkPhase: entity.walkPhase,
        speed: entity.horizontalSpeed,
        onGround: entity.onGround,
        age: entity.age,
        shadowY,
      };
      if (entity.kind === 'mob') {
        const mob = entity as Mob;
        base.headYaw = mob.headYaw;
        base.headPitch = mob.headPitch;
        base.fuse = mob.fuse;
        base.state = mob.state;
      } else if (entity.kind === 'item') {
        const item = entity as ItemEntity;
        base.item = { item: item.item, count: item.count };
      }
      snapshots.push(base);
    }
    return snapshots;
  }
}

/** Scan down from the entity position for the first collidable block top. */
export function groundBelow(world: WorldView, position: Vec3, maxDepth = 16): number {
  const x = Math.floor(position.x);
  const z = Math.floor(position.z);
  const startY = Math.floor(position.y);
  for (let depth = 0; depth <= maxDepth; depth++) {
    const y = startY - depth;
    const id = world.getBlock(x, y, z);
    if (id !== 0 && world.getBlock(x, y + 1, z) === 0) {
      return y + 1;
    }
  }
  return position.y;
}

/** Vanilla-style sound key for a mob action. */
export function mobSound(type: MobType, action: 'say' | 'hurt' | 'death' | 'attack' | 'shoot'): string {
  return `mob.${type}.${action}`;
}

/** Number of death animation ticks exported for renderer/tests. */
export { DEATH_ANIM_TICKS };
