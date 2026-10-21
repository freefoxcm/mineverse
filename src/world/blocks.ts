import type { BlockId } from '../core/types';

export type BlockRender = 'cube' | 'cross' | 'torch' | 'liquid' | 'none';
export type ToolType = 'pickaxe' | 'axe' | 'shovel' | 'sword' | 'none';
export type BlockSound = 'stone' | 'dirt' | 'grass' | 'wood' | 'sand' | 'glass' | 'wool' | 'metal' | 'plant';
export type AlphaMode = 'opaque' | 'cutout' | 'transparent';

export interface BlockDrops {
  item: string;
  min: number;
  max: number;
  /** 0..1, defaults to 1. */
  chance?: number;
}

export interface BlockFaces {
  all?: string;
  top?: string;
  bottom?: string;
  side?: string;
  front?: string;
}

export interface BlockDef {
  numeric: BlockId;
  id: string;
  /** Display name (Chinese UI may localize later). */
  name: string;
  faces: BlockFaces;
  render: BlockRender;
  alpha: AlphaMode;
  solid: boolean;
  opaque: boolean;
  collidable: boolean;
  replaceable: boolean;
  lightOpacity: number;
  lightEmission: number;
  hardness: number;
  tool: ToolType;
  /** Required tool tier: 0 hand, 1 wood/gold, 2 stone, 3 iron, 4 diamond. */
  tier: number;
  requiresTool: boolean;
  drops: BlockDrops[];
  gravity: boolean;
  fluid: 'water' | 'lava' | null;
  tint: 'grass' | 'foliage' | 'water' | null;
  blastResistance: number;
  sound: BlockSound;
  /** Heat source for the environment (lava/torch/fire). */
  ignites: boolean;
}

type BlockSpec = Partial<Omit<BlockDef, 'numeric' | 'id' | 'name' | 'faces'>> & {
  name?: string;
  tex?: string | BlockFaces;
  /** Defaults to the block id. */
  faces?: BlockFaces;
};

const DEFAULTS: Omit<BlockDef, 'numeric' | 'id' | 'name' | 'faces'> = {
  render: 'cube',
  alpha: 'opaque',
  solid: true,
  opaque: true,
  collidable: true,
  replaceable: false,
  lightOpacity: 15,
  lightEmission: 0,
  hardness: 1,
  tool: 'none',
  tier: 0,
  requiresTool: false,
  drops: [],
  gravity: false,
  fluid: null,
  tint: null,
  blastResistance: 1,
  sound: 'stone',
  ignites: false,
};

const BLOCK_LIST: BlockDef[] = [];

function defineBlock(id: string, spec: BlockSpec = {}): BlockDef {
  const numeric = BLOCK_LIST.length;
  const faces: BlockFaces =
    spec.faces ??
    (typeof spec.tex === 'string'
      ? { all: spec.tex }
      : spec.tex
        ? spec.tex
        : { all: id });
  const def: BlockDef = {
    ...DEFAULTS,
    ...spec,
    numeric,
    id,
    name: spec.name ?? id,
    faces,
    drops: spec.drops ?? [{ item: id, min: 1, max: 1 }],
  };
  if (spec.hardness === -1) {
    def.requiresTool = true;
    def.drops = [];
    def.tier = 99;
  }
  BLOCK_LIST.push(def);
  return def;
}

// ---------------------------------------------------------------------------
// Block registry. Order defines numeric ids; append new blocks at the end.
// ---------------------------------------------------------------------------

defineBlock('air', {
  name: '空气',
  render: 'none',
  alpha: 'cutout',
  solid: false,
  opaque: false,
  collidable: false,
  replaceable: true,
  lightOpacity: 0,
  hardness: 0,
  drops: [],
  tex: 'air',
});

defineBlock('stone', { name: '石头', tex: 'stone', hardness: 1.5, tool: 'pickaxe', requiresTool: true, drops: [{ item: 'cobblestone', min: 1, max: 1 }], blastResistance: 6 });
defineBlock('granite', { name: '花岗岩', tex: 'granite', hardness: 1.5, tool: 'pickaxe', requiresTool: true, drops: [{ item: 'granite', min: 1, max: 1 }] });
defineBlock('diorite', { name: '闪长岩', tex: 'diorite', hardness: 1.5, tool: 'pickaxe', requiresTool: true, drops: [{ item: 'diorite', min: 1, max: 1 }] });
defineBlock('andesite', { name: '安山岩', tex: 'andesite', hardness: 1.5, tool: 'pickaxe', requiresTool: true, drops: [{ item: 'andesite', min: 1, max: 1 }] });
defineBlock('cobblestone', { name: '圆石', tex: 'cobblestone', hardness: 2, tool: 'pickaxe', requiresTool: true, blastResistance: 6 });
defineBlock('mossy_cobblestone', { name: '苔石', tex: 'mossy_cobblestone', hardness: 2, tool: 'pickaxe', requiresTool: true, blastResistance: 6 });
defineBlock('dirt', { name: '泥土', tex: 'dirt', hardness: 0.5, tool: 'shovel', sound: 'dirt', blastResistance: 0.5 });
defineBlock('coarse_dirt', { name: '砂土', tex: 'coarse_dirt', hardness: 0.5, tool: 'shovel', sound: 'dirt', blastResistance: 0.5 });
defineBlock('grass_block', {
  name: '草方块',
  faces: { top: 'grass_top', side: 'grass_side', bottom: 'dirt' },
  hardness: 0.6,
  tool: 'shovel',
  sound: 'grass',
  tint: 'grass',
  drops: [{ item: 'dirt', min: 1, max: 1 }],
  blastResistance: 0.6,
});
defineBlock('sand', { name: '沙子', tex: 'sand', hardness: 0.5, tool: 'shovel', sound: 'sand', gravity: true, blastResistance: 0.5 });
defineBlock('sandstone', {
  name: '砂岩',
  faces: { top: 'sandstone_top', side: 'sandstone_side', bottom: 'sandstone_bottom' },
  hardness: 0.8,
  tool: 'pickaxe',
  requiresTool: true,
  sound: 'stone',
});
defineBlock('gravel', {
  name: '沙砾',
  tex: 'gravel',
  hardness: 0.6,
  tool: 'shovel',
  sound: 'dirt',
  gravity: true,
  drops: [
    { item: 'gravel', min: 1, max: 1, chance: 0.9 },
    { item: 'flint', min: 1, max: 1, chance: 0.1 },
  ],
});
defineBlock('clay', {
  name: '黏土',
  tex: 'clay',
  hardness: 0.6,
  tool: 'shovel',
  sound: 'dirt',
  drops: [{ item: 'clay_ball', min: 4, max: 4 }],
});
defineBlock('bedrock', {
  name: '基岩',
  tex: 'bedrock',
  hardness: -1,
  blastResistance: 3600000,
});
defineBlock('snow_block', { name: '雪块', tex: 'snow', hardness: 0.2, tool: 'shovel', sound: 'sand' });
defineBlock('ice', { name: '冰', tex: 'ice', alpha: 'transparent', opaque: false, lightOpacity: 2, hardness: 0.5, tool: 'pickaxe', sound: 'glass', drops: [], blastResistance: 0.5 });
defineBlock('water', {
  name: '水',
  tex: 'water',
  render: 'liquid',
  alpha: 'transparent',
  solid: false,
  opaque: false,
  collidable: false,
  replaceable: true,
  lightOpacity: 1,
  hardness: -1,
  fluid: 'water',
  tint: 'water',
  drops: [],
  blastResistance: 100,
});
defineBlock('lava', {
  name: '岩浆',
  tex: 'lava',
  render: 'liquid',
  alpha: 'transparent',
  solid: false,
  opaque: false,
  collidable: false,
  replaceable: true,
  lightOpacity: 0,
  lightEmission: 15,
  hardness: -1,
  fluid: 'lava',
  drops: [],
  ignites: true,
  blastResistance: 100,
});

defineBlock('oak_log', { name: '橡木原木', faces: { top: 'oak_log_top', side: 'oak_log', bottom: 'oak_log_top' }, hardness: 2, tool: 'axe', sound: 'wood', blastResistance: 2 });
defineBlock('birch_log', { name: '白桦原木', faces: { top: 'birch_log_top', side: 'birch_log', bottom: 'birch_log_top' }, hardness: 2, tool: 'axe', sound: 'wood', blastResistance: 2 });
defineBlock('spruce_log', { name: '云杉原木', faces: { top: 'spruce_log_top', side: 'spruce_log', bottom: 'spruce_log_top' }, hardness: 2, tool: 'axe', sound: 'wood', blastResistance: 2 });
defineBlock('oak_leaves', {
  name: '橡树树叶',
  tex: 'oak_leaves',
  alpha: 'cutout',
  opaque: false,
  lightOpacity: 1,
  hardness: 0.2,
  tool: 'axe',
  sound: 'grass',
  tint: 'foliage',
  drops: [{ item: 'apple', min: 1, max: 1, chance: 0.02 }],
  blastResistance: 0.2,
});
defineBlock('birch_leaves', {
  name: '白桦树叶',
  tex: 'birch_leaves',
  alpha: 'cutout',
  opaque: false,
  lightOpacity: 1,
  hardness: 0.2,
  tool: 'axe',
  sound: 'grass',
  tint: 'foliage',
  drops: [],
  blastResistance: 0.2,
});
defineBlock('spruce_leaves', {
  name: '云杉树叶',
  tex: 'spruce_leaves',
  alpha: 'cutout',
  opaque: false,
  lightOpacity: 1,
  hardness: 0.2,
  tool: 'axe',
  sound: 'grass',
  tint: 'foliage',
  drops: [],
  blastResistance: 0.2,
});

defineBlock('coal_ore', { name: '煤矿石', tex: 'coal_ore', hardness: 3, tool: 'pickaxe', requiresTool: true, tier: 1, drops: [{ item: 'coal', min: 1, max: 1 }], blastResistance: 3 });
defineBlock('copper_ore', { name: '铜矿石', tex: 'copper_ore', hardness: 3, tool: 'pickaxe', requiresTool: true, tier: 2, drops: [{ item: 'raw_copper', min: 2, max: 4 }], blastResistance: 3 });
defineBlock('iron_ore', { name: '铁矿石', tex: 'iron_ore', hardness: 3, tool: 'pickaxe', requiresTool: true, tier: 2, drops: [{ item: 'raw_iron', min: 1, max: 1 }], blastResistance: 3 });
defineBlock('gold_ore', { name: '金矿石', tex: 'gold_ore', hardness: 3, tool: 'pickaxe', requiresTool: true, tier: 3, drops: [{ item: 'raw_gold', min: 1, max: 1 }], blastResistance: 3 });
defineBlock('redstone_ore', {
  name: '红石矿石',
  tex: 'redstone_ore',
  hardness: 3,
  tool: 'pickaxe',
  requiresTool: true,
  tier: 3,
  lightEmission: 0,
  drops: [{ item: 'redstone', min: 4, max: 5 }],
  blastResistance: 3,
});
defineBlock('lapis_ore', { name: '青金石矿石', tex: 'lapis_ore', hardness: 3, tool: 'pickaxe', requiresTool: true, tier: 2, drops: [{ item: 'lapis_lazuli', min: 4, max: 8 }], blastResistance: 3 });
defineBlock('diamond_ore', { name: '钻石矿石', tex: 'diamond_ore', hardness: 3, tool: 'pickaxe', requiresTool: true, tier: 3, drops: [{ item: 'diamond', min: 1, max: 1 }], blastResistance: 3 });
defineBlock('obsidian', { name: '黑曜石', tex: 'obsidian', hardness: 50, tool: 'pickaxe', requiresTool: true, tier: 4, blastResistance: 1200 });

defineBlock('oak_planks', { name: '橡木木板', tex: 'oak_planks', hardness: 2, tool: 'axe', sound: 'wood', blastResistance: 3 });
defineBlock('birch_planks', { name: '白桦木板', tex: 'birch_planks', hardness: 2, tool: 'axe', sound: 'wood', blastResistance: 3 });
defineBlock('spruce_planks', { name: '云杉木板', tex: 'spruce_planks', hardness: 2, tool: 'axe', sound: 'wood', blastResistance: 3 });
defineBlock('smooth_stone', { name: '平滑石头', tex: 'smooth_stone', hardness: 2, tool: 'pickaxe', requiresTool: true, blastResistance: 6 });
defineBlock('stone_bricks', { name: '石砖', tex: 'stone_bricks', hardness: 1.5, tool: 'pickaxe', requiresTool: true, blastResistance: 6 });
defineBlock('bricks', { name: '砖块', tex: 'bricks', hardness: 2, tool: 'pickaxe', requiresTool: true, blastResistance: 6 });
defineBlock('glass', { name: '玻璃', tex: 'glass', alpha: 'cutout', opaque: false, lightOpacity: 0, hardness: 0.3, sound: 'glass', drops: [], blastResistance: 0.3 });
defineBlock('white_wool', { name: '白色羊毛', tex: 'wool_white', hardness: 0.8, sound: 'wool' });
defineBlock('red_wool', { name: '红色羊毛', tex: 'wool_red', hardness: 0.8, sound: 'wool' });
defineBlock('yellow_wool', { name: '黄色羊毛', tex: 'wool_yellow', hardness: 0.8, sound: 'wool' });
defineBlock('blue_wool', { name: '蓝色羊毛', tex: 'wool_blue', hardness: 0.8, sound: 'wool' });
defineBlock('black_wool', { name: '黑色羊毛', tex: 'wool_black', hardness: 0.8, sound: 'wool' });

defineBlock('crafting_table', {
  name: '工作台',
  faces: { top: 'crafting_table_top', side: 'crafting_table_side', bottom: 'oak_planks', front: 'crafting_table_front' },
  hardness: 2.5,
  tool: 'axe',
  sound: 'wood',
  blastResistance: 2.5,
});
defineBlock('furnace', {
  name: '熔炉',
  faces: { top: 'furnace_top', side: 'furnace_side', bottom: 'furnace_top', front: 'furnace_front' },
  hardness: 3.5,
  tool: 'pickaxe',
  requiresTool: true,
  blastResistance: 3.5,
});
defineBlock('lit_furnace', {
  name: '燃烧的熔炉',
  faces: { top: 'furnace_top', side: 'furnace_side', bottom: 'furnace_top', front: 'furnace_front_lit' },
  hardness: 3.5,
  tool: 'pickaxe',
  requiresTool: true,
  lightEmission: 13,
  drops: [{ item: 'furnace', min: 1, max: 1 }],
  blastResistance: 3.5,
});
defineBlock('chest', {
  name: '箱子',
  faces: { top: 'chest_top', side: 'chest_side', bottom: 'chest_top', front: 'chest_front' },
  hardness: 2.5,
  tool: 'axe',
  sound: 'wood',
  blastResistance: 2.5,
});
defineBlock('torch', {
  name: '火把',
  tex: 'torch',
  render: 'cross',
  alpha: 'cutout',
  solid: false,
  opaque: false,
  collidable: false,
  replaceable: false,
  lightOpacity: 0,
  lightEmission: 14,
  hardness: 0,
  sound: 'wood',
  drops: [{ item: 'torch', min: 1, max: 1 }],
  blastResistance: 0,
});
defineBlock('tnt', {
  name: 'TNT',
  faces: { top: 'tnt_top', side: 'tnt_side', bottom: 'tnt_bottom' },
  hardness: 0,
  sound: 'grass',
  blastResistance: 0,
});
defineBlock('bookshelf', {
  name: '书架',
  faces: { top: 'oak_planks', side: 'bookshelf', bottom: 'oak_planks' },
  hardness: 1.5,
  tool: 'axe',
  sound: 'wood',
  blastResistance: 1.5,
});
defineBlock('coal_block', { name: '煤炭块', tex: 'coal_block', hardness: 5, tool: 'pickaxe', requiresTool: true, blastResistance: 6 });
defineBlock('iron_block', { name: '铁块', tex: 'iron_block', hardness: 5, tool: 'pickaxe', requiresTool: true, tier: 2, sound: 'metal', blastResistance: 6 });
defineBlock('gold_block', { name: '金块', tex: 'gold_block', hardness: 3, tool: 'pickaxe', requiresTool: true, tier: 3, sound: 'metal', blastResistance: 6 });
defineBlock('diamond_block', { name: '钻石块', tex: 'diamond_block', hardness: 5, tool: 'pickaxe', requiresTool: true, tier: 3, sound: 'metal', blastResistance: 6 });
defineBlock('lapis_block', { name: '青金石块', tex: 'lapis_block', hardness: 3, tool: 'pickaxe', requiresTool: true, tier: 2, blastResistance: 6 });
defineBlock('redstone_block', { name: '红石块', tex: 'redstone_block', hardness: 5, tool: 'pickaxe', requiresTool: true, tier: 2, blastResistance: 6 });

// Plants: non-solid, replaceable, tiny, instantly broken.
defineBlock('cactus', {
  name: '仙人掌',
  faces: { top: 'cactus_top', side: 'cactus_side', bottom: 'cactus_top' },
  solid: false,
  opaque: false,
  alpha: 'cutout',
  lightOpacity: 0,
  hardness: 0.4,
  sound: 'plant',
  blastResistance: 0.4,
});
defineBlock('sugar_cane', { name: '甘蔗', tex: 'sugar_cane', render: 'cross', alpha: 'cutout', solid: false, opaque: false, collidable: false, replaceable: true, lightOpacity: 0, hardness: 0, sound: 'plant', tint: 'foliage', drops: [], blastResistance: 0 });
defineBlock('tall_grass', { name: '草', tex: 'tall_grass', render: 'cross', alpha: 'cutout', solid: false, opaque: false, collidable: false, replaceable: true, lightOpacity: 0, hardness: 0, sound: 'plant', tint: 'grass', drops: [], blastResistance: 0 });
defineBlock('poppy', { name: '虞美人', tex: 'poppy', render: 'cross', alpha: 'cutout', solid: false, opaque: false, collidable: false, replaceable: true, lightOpacity: 0, hardness: 0, sound: 'plant', drops: [{ item: 'poppy', min: 1, max: 1 }], blastResistance: 0 });
defineBlock('dandelion', { name: '蒲公英', tex: 'dandelion', render: 'cross', alpha: 'cutout', solid: false, opaque: false, collidable: false, replaceable: true, lightOpacity: 0, hardness: 0, sound: 'plant', drops: [{ item: 'dandelion', min: 1, max: 1 }], blastResistance: 0 });
defineBlock('dead_bush', { name: '枯木', tex: 'dead_bush', render: 'cross', alpha: 'cutout', solid: false, opaque: false, collidable: false, replaceable: true, lightOpacity: 0, hardness: 0, sound: 'plant', drops: [], blastResistance: 0 });

export const BLOCKS: readonly BlockDef[] = BLOCK_LIST;
export const BLOCK_COUNT = BLOCK_LIST.length;

export const AIR = 0;
export const blockById = new Map<string, BlockDef>();
for (const def of BLOCK_LIST) blockById.set(def.id, def);

export function getBlockDef(id: BlockId): BlockDef {
  return BLOCK_LIST[id] ?? BLOCK_LIST[0];
}

export function blockNumeric(name: string): BlockId {
  return blockById.get(name)?.numeric ?? 0;
}

export function blockName(id: BlockId): string {
  return getBlockDef(id).id;
}

// Hot-path lookup tables: indexed by numeric block id.
export const IS_OPAQUE = new Uint8Array(256);
export const IS_SOLID = new Uint8Array(256);
export const IS_COLLIDABLE = new Uint8Array(256);
export const IS_REPLACEABLE = new Uint8Array(256);
export const LIGHT_OPACITY = new Uint8Array(256);
export const LIGHT_EMISSION = new Uint8Array(256);
export const GRAVITY_BLOCK = new Uint8Array(256);
export const FLUID_KIND = new Uint8Array(256); // 0 none, 1 water, 2 lava
export const TINT_KIND = new Uint8Array(256); // 0 none, 1 grass, 2 foliage, 3 water
export const RENDER_KIND = new Uint8Array(256); // enum BlockRender
export const ALPHA_KIND = new Uint8Array(256); // 0 opaque, 1 cutout, 2 transparent

const RENDER_INDEX: Record<BlockRender, number> = { none: 0, cube: 1, cross: 2, torch: 3, liquid: 4 };
const ALPHA_INDEX: Record<AlphaMode, number> = { opaque: 0, cutout: 1, transparent: 2 };

for (const def of BLOCK_LIST) {
  const i = def.numeric;
  IS_OPAQUE[i] = def.opaque ? 1 : 0;
  IS_SOLID[i] = def.solid ? 1 : 0;
  IS_COLLIDABLE[i] = def.collidable ? 1 : 0;
  IS_REPLACEABLE[i] = def.replaceable ? 1 : 0;
  LIGHT_OPACITY[i] = def.lightOpacity;
  LIGHT_EMISSION[i] = def.lightEmission;
  GRAVITY_BLOCK[i] = def.gravity ? 1 : 0;
  FLUID_KIND[i] = def.fluid === 'water' ? 1 : def.fluid === 'lava' ? 2 : 0;
  TINT_KIND[i] = def.tint === 'grass' ? 1 : def.tint === 'foliage' ? 2 : def.tint === 'water' ? 3 : 0;
  RENDER_KIND[i] = RENDER_INDEX[def.render];
  ALPHA_KIND[i] = ALPHA_INDEX[def.alpha];
}

/** Face order used by the mesher and geometry builder: +X -X +Y -Y +Z -Z. */
export const FACE_DIRS: ReadonlyArray<readonly [number, number, number]> = [
  [1, 0, 0],
  [-1, 0, 0],
  [0, 1, 0],
  [0, -1, 0],
  [0, 0, 1],
  [0, 0, -1],
];

const FACE_SHADE = [0.8, 0.8, 1.0, 0.5, 0.6, 0.6];
export function faceShade(face: number): number {
  return FACE_SHADE[face];
}

/** Texture tile name for a block face index. */
export function faceTexture(def: BlockDef, face: number): string {
  const f = def.faces;
  if (face === 2) return f.top ?? f.all ?? def.id;
  if (face === 3) return f.bottom ?? f.all ?? def.id;
  if (face === 0 || face === 4) return f.front ?? f.side ?? f.all ?? def.id;
  return f.side ?? f.all ?? def.id;
}

// Convenience ids used by worldgen / gameplay code.
export const BLOCK = {
  air: 0,
  stone: blockNumeric('stone'),
  dirt: blockNumeric('dirt'),
  grass_block: blockNumeric('grass_block'),
  sand: blockNumeric('sand'),
  gravel: blockNumeric('gravel'),
  water: blockNumeric('water'),
  lava: blockNumeric('lava'),
  bedrock: blockNumeric('bedrock'),
  oak_log: blockNumeric('oak_log'),
  oak_leaves: blockNumeric('oak_leaves'),
  cactus: blockNumeric('cactus'),
  snow_block: blockNumeric('snow_block'),
  ice: blockNumeric('ice'),
  clay: blockNumeric('clay'),
  tall_grass: blockNumeric('tall_grass'),
  torch: blockNumeric('torch'),
  chest: blockNumeric('chest'),
  furnace: blockNumeric('furnace'),
  crafting_table: blockNumeric('crafting_table'),
  tnt: blockNumeric('tnt'),
} as const;
