/**
 * Global world/game constants. Shared by every subsystem.
 * Changing WORLD_HEIGHT requires clearing saves (block indices are y-major).
 */
export const CHUNK_SIZE = 16;
export const WORLD_HEIGHT = 160;
export const SEA_LEVEL = 63;

export const SECTION_SIZE = 16;
export const SECTION_COUNT = WORLD_HEIGHT / SECTION_SIZE; // 10
export const SECTION_VOLUME = SECTION_SIZE ** 3; // 4096
export const COLUMN_VOLUME = CHUNK_SIZE * CHUNK_SIZE * WORLD_HEIGHT; // 40960

/** Fixed simulation tick: 20 TPS, like Minecraft. */
export const TICK_MS = 50;
export const MAX_TICKS_PER_FRAME = 5;

/** One Minecraft day = 24000 ticks = 20 minutes. */
export const TICKS_PER_DAY = 24000;

export const DEFAULT_RENDER_DISTANCE = 8;
export const MIN_RENDER_DISTANCE = 4;
export const MAX_RENDER_DISTANCE = 12;

export const PLAYER_REACH = 5;

export const GAME_NAME = 'MineVerse';
export const GAME_VERSION = '0.1.0';

export const SAVE_DB_NAME = 'mineverse';
export const SAVE_DB_VERSION = 1;

/** How many chunk columns may be generated around the player per second at most. */
export const CHUNK_GEN_BUDGET_PER_FRAME = 2;
