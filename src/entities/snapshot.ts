/** Renderer-facing snapshot of an entity (no mutable entity references). */

import type { Vec3 } from '../core/types';
import type { EntityKind } from './entity';

export interface EntitySnapshot {
  id: number;
  kind: EntityKind;
  /** MobType for mobs, item id for drops, 'arrow' for projectiles. */
  type: string;
  position: Vec3;
  previousPosition: Vec3;
  velocity: Vec3;
  yaw: number;
  headYaw: number;
  headPitch: number;
  health: number;
  maxHealth: number;
  hurtTime: number;
  /** -1 while alive; 0..20 during the death animation. */
  deathTime: number;
  fireTicks: number;
  /** Creeper fuse ticks (0 = idle, 30 = about to explode). */
  fuse: number;
  walkPhase: number;
  /** Horizontal speed in blocks/s (drives the walk animation). */
  speed: number;
  onGround: boolean;
  age: number;
  /** Ground Y under the entity for the foot shadow. */
  shadowY: number;
  /** Mob AI state (debug/E2E), undefined for items/arrows. */
  state?: string;
  /** Item stack data (drops only). */
  item?: { item: string; count: number };
}
