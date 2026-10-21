import type { PixelPainter } from './pixels';

/** All procedural tiles are authored at this resolution (16 logical px, x2 detail). */
export const TILE_SIZE = 32;

/** Paints one 32x32 texture tile. Must be deterministic. */
export type TilePainter = (p: PixelPainter) => void;

/** Paints one 32x32 item sprite (transparent background expected). */
export type ItemPainter = (p: PixelPainter) => void;

/** Paints one mob/entity part texture. */
export type MobPainter = (p: PixelPainter) => void;

export interface ArtRegistry {
  tiles: Record<string, TilePainter>;
  items: Record<string, ItemPainter>;
  mobs: Record<string, MobPainter>;
}

/** Face indices used for mob part textures. */
export type MobFace = 'top' | 'bottom' | 'north' | 'south' | 'east' | 'west';
