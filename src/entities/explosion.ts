/**
 * Explosions: deterministic sphere sweep that damages blocks by blast
 * resistance and falls off with distance, plus entity damage/knockback.
 *
 * Block breaking always goes through `WorldView.setBlock(..., 'explosion')`
 * and reports every removed block to the caller so the Lead can remesh and
 * record the edit. Water/lava and high-resistance blocks survive.
 */

import type { WorldView } from '../core/contracts';
import type { BlockId, Vec3 } from '../core/types';
import { FLUID_KIND, getBlockDef } from '../world/blocks';
import { distanceToAABB } from './entity';

/** Creeper explosion power 3, TNT power 4 (see PLAN §3.8). */
export const CREEPER_EXPLOSION_POWER = 3;
export const TNT_EXPLOSION_POWER = 4;

/** Upper bound on blocks destroyed by one explosion (safety). */
const MAX_BROKEN_BLOCKS = 400;
/** Blocks are destroyed when explosion force beats a fraction of their resistance. */
const RESISTANCE_FACTOR = 0.25;

/** Minimal entity interface explosions need (Entity satisfies it). */
export interface ExplosionTarget {
  id: number;
  position: Vec3;
  width: number;
  height: number;
  hurt(amount: number, source?: Vec3 | null, knockback?: number): boolean;
  applyKnockbackFrom?(fromX: number, fromZ: number, strength: number, lift?: number): void;
}

export interface ExplosionBlockHit {
  x: number;
  y: number;
  z: number;
  id: BlockId;
}

export interface ExplosionEntityHit {
  entity: ExplosionTarget;
  damage: number;
  distance: number;
  killed: boolean;
}

export interface ExplosionOptions {
  /** Entities caught in the blast (mobs; player adapter supplied by manager). */
  targets?: readonly ExplosionTarget[];
  /** Callback for every block successfully removed (remesh + save hook). */
  onBlockBreak?: (x: number, y: number, z: number, id: BlockId) => void;
  onParticles?: (kind: string, position: Vec3, count: number) => void;
  onSound?: (name: string, position: Vec3) => void;
  /** Scale applied to entity damage (difficulty/source tweaks). */
  damageMultiplier?: number;
  /** Set false to only damage entities (creative/e2e tests). */
  blockDamage?: boolean;
  /** Source tag for callbacks and resistance tuning. */
  source?: 'creeper' | 'tnt' | 'other';
}

export interface ExplosionResult {
  center: Vec3;
  power: number;
  radius: number;
  blocksBroken: number;
  brokenBlocks: ExplosionBlockHit[];
  entityHits: ExplosionEntityHit[];
}

/**
 * Explode at `center`. Deterministic: the same world state always produces the
 * same block list and damage (no Math.random anywhere).
 */
export function explode(
  world: WorldView,
  center: Vec3,
  power: number,
  options: ExplosionOptions = {},
): ExplosionResult {
  // Crater radius: vanilla-ish ~4.5 blocks for a creeper (power 3).
  const radius = Math.max(1.5, power * 1.5);
  const result: ExplosionResult = {
    center: { ...center },
    power,
    radius,
    blocksBroken: 0,
    brokenBlocks: [],
    entityHits: [],
  };

  options.onSound?.(options.source === 'creeper' ? 'explosion.creeper' : 'explosion.tnt', {
    ...center,
  });
  options.onParticles?.('explosion', { ...center }, Math.round(40 + power * 12));

  // --- Blocks: sphere sweep, descending force by distance. -----------------
  if (options.blockDamage !== false) {
    const r = Math.ceil(radius);
    const cx = Math.floor(center.x);
    const cy = Math.floor(center.y);
    const cz = Math.floor(center.z);
    const maxResistance = 100;
    for (let dy = -r; dy <= r; dy++) {
      for (let dz = -r; dz <= r; dz++) {
        for (let dx = -r; dx <= r; dx++) {
          if (result.blocksBroken >= MAX_BROKEN_BLOCKS) break;
          const x = cx + dx;
          const y = cy + dy;
          const z = cz + dz;
          const id = world.getBlock(x, y, z);
          if (id === 0) continue;
          if (FLUID_KIND[id] !== 0) continue;
          const def = getBlockDef(id);
          if (def.blastResistance >= maxResistance) continue;
          // Distance from the explosion centre to the block centre.
          const bx = x + 0.5 - center.x;
          const by = y + 0.5 - center.y;
          const bz = z + 0.5 - center.z;
          const distance = Math.sqrt(bx * bx + by * by + bz * bz);
          if (distance > radius) continue;
          const force = power * (1 - distance / radius);
          if (force < 0.08) continue;
          if (force <= def.blastResistance * RESISTANCE_FACTOR) continue;
          const removed = world.setBlock(x, y, z, 0, 0, 'explosion');
          if (!removed) continue;
          result.blocksBroken++;
          result.brokenBlocks.push({ x, y, z, id });
          options.onBlockBreak?.(x, y, z, id);
        }
      }
    }
  }

  // --- Entities: damage with distance falloff + radial knockback. -----------
  const targets = options.targets ?? [];
  const damageMultiplier = options.damageMultiplier ?? 1;
  for (const target of targets) {
    const box = {
      minX: target.position.x - target.width / 2,
      minY: target.position.y,
      minZ: target.position.z - target.width / 2,
      maxX: target.position.x + target.width / 2,
      maxY: target.position.y + target.height,
      maxZ: target.position.z + target.width / 2,
    };
    const distance = distanceToAABB(center, box);
    if (distance > radius) continue;
    const falloff = 1 - distance / radius;
    const impact = power * falloff;
    const damage = Math.max(1, Math.round((impact * impact + impact) * 1.5 * damageMultiplier));
    const knockback = Math.min(9, impact * 1.4);
    // Apply damage without hurt's built-in knockback, then add the radial blast
    // impulse once so entities are not launched twice as hard.
    const applied = target.hurt(damage, { ...center }, 0);
    target.applyKnockbackFrom?.(center.x, center.z, knockback, 0.5);
    result.entityHits.push({
      entity: target,
      damage: applied ? damage : 0,
      distance,
      killed: target.position !== undefined && applied && isTargetDead(target),
    });
  }

  return result;
}

function isTargetDead(target: ExplosionTarget): boolean {
  const candidate = target as unknown as { isDead?: boolean; health?: number };
  return candidate.isDead === true || (typeof candidate.health === 'number' && candidate.health <= 0);
}

/** Convenience: creeper blast. */
export function explodeCreeper(
  world: WorldView,
  center: Vec3,
  options: ExplosionOptions = {},
): ExplosionResult {
  return explode(world, center, CREEPER_EXPLOSION_POWER, {
    source: 'creeper',
    ...options,
  });
}

/** Convenience: TNT blast. */
export function explodeTnt(
  world: WorldView,
  center: Vec3,
  options: ExplosionOptions = {},
): ExplosionResult {
  return explode(world, center, TNT_EXPLOSION_POWER, {
    source: 'tnt',
    ...options,
  });
}
