import { BLOCKS } from './blocks';
import type { ToolType } from './blocks';

export type ItemKind = 'material' | 'food' | 'tool' | 'armor' | 'weapon' | 'block' | 'misc';

export interface ToolSpec {
  type: ToolType;
  /** Mining tier: 1 wood/gold, 2 stone, 3 iron, 4 diamond. */
  tier: number;
  /** Mining speed multiplier. */
  speed: number;
  durability: number;
  /** Attack damage in half-hearts. */
  damage: number;
}

export interface ArmorSpec {
  /** 0 helmet, 1 chestplate, 2 leggings, 3 boots. */
  slot: 0 | 1 | 2 | 3;
  points: number;
  durability: number;
}

export interface FoodSpec {
  hunger: number;
  saturation: number;
}

export interface ItemDef {
  id: string;
  name: string;
  kind: ItemKind;
  maxStack: number;
  icon: 'block' | 'sprite';
  /** When set, placing this item places the given block. */
  block?: string;
  tool?: ToolSpec;
  armor?: ArmorSpec;
  food?: FoodSpec;
  /** Furnace burn time in ticks (0 = not a fuel). */
  fuelTicks?: number;
}

const ITEMS = new Map<string, ItemDef>();

function item(def: ItemDef): void {
  ITEMS.set(def.id, def);
}

function material(id: string, name: string, fuelTicks = 0): void {
  item({ id, name, kind: 'material', maxStack: 64, icon: 'sprite', fuelTicks });
}

function food(id: string, name: string, hunger: number, saturation: number): void {
  item({ id, name, kind: 'food', maxStack: 64, icon: 'sprite', food: { hunger, saturation } });
}

// ---------------------------------------------------------------------------
// Materials
// ---------------------------------------------------------------------------
material('stick', '木棍', 100);
material('coal', '煤炭', 1600);
material('charcoal', '木炭', 1600);
material('raw_iron', '粗铁');
material('iron_ingot', '铁锭');
material('raw_gold', '粗金');
material('gold_ingot', '金锭');
material('raw_copper', '粗铜');
material('copper_ingot', '铜锭');
material('diamond', '钻石');
material('lapis_lazuli', '青金石');
material('redstone', '红石');
material('flint', '燧石');
material('string', '线');
material('feather', '羽毛');
material('gunpowder', '火药');
material('bone', '骨头');
material('leather', '皮革');
material('clay_ball', '黏土球');
material('brick', '红砖');
material('paper', '纸');
material('red_dye', '红色染料');
material('yellow_dye', '黄色染料');
material('blue_dye', '蓝色染料');
material('black_dye', '黑色染料');

// ---------------------------------------------------------------------------
// Food
// ---------------------------------------------------------------------------
food('apple', '苹果', 4, 2.4);
food('bread', '面包', 5, 6);
food('raw_porkchop', '生猪排', 3, 1.8);
food('cooked_porkchop', '熟猪排', 8, 12.8);
food('raw_beef', '生牛肉', 3, 1.8);
food('steak', '牛排', 8, 12.8);
food('raw_chicken', '生鸡肉', 2, 1.2);
food('cooked_chicken', '熟鸡肉', 6, 7.2);
food('raw_mutton', '生羊肉', 2, 1.2);
food('cooked_mutton', '熟羊肉', 6, 9.6);
food('rotten_flesh', '腐肉', 4, 0.8);

// ---------------------------------------------------------------------------
// Tools / weapons / armor
// ---------------------------------------------------------------------------
interface MaterialTier {
  prefix: string;
  name: string;
  tier: number;
  speed: number;
  durability: number;
  swordDamage: number;
}

const TOOL_MATERIALS: MaterialTier[] = [
  { prefix: 'wooden', name: '木', tier: 1, speed: 2, durability: 59, swordDamage: 4 },
  { prefix: 'stone', name: '石', tier: 2, speed: 4, durability: 131, swordDamage: 5 },
  { prefix: 'iron', name: '铁', tier: 3, speed: 6, durability: 250, swordDamage: 6 },
  { prefix: 'golden', name: '金', tier: 1, speed: 12, durability: 32, swordDamage: 4 },
  { prefix: 'diamond', name: '钻石', tier: 4, speed: 8, durability: 1561, swordDamage: 7 },
];

const TOOL_KINDS: { suffix: string; name: string; type: ToolType; damage: number }[] = [
  { suffix: 'pickaxe', name: '镐', type: 'pickaxe', damage: 2 },
  { suffix: 'axe', name: '斧', type: 'axe', damage: 7 },
  { suffix: 'shovel', name: '锹', type: 'shovel', damage: 2.5 },
  { suffix: 'sword', name: '剑', type: 'sword', damage: 4 },
];

for (const m of TOOL_MATERIALS) {
  for (const k of TOOL_KINDS) {
    item({
      id: `${m.prefix}_${k.suffix}`,
      name: `${m.name}${k.name}`,
      kind: k.suffix === 'sword' ? 'weapon' : 'tool',
      maxStack: 1,
      icon: 'sprite',
      tool: {
        type: k.type,
        tier: m.tier,
        speed: m.speed,
        durability: m.durability,
        damage: k.suffix === 'sword' ? m.swordDamage : k.damage + m.tier,
      },
    });
  }
}

const ARMOR_MATERIALS: { prefix: string; name: string; points: [number, number, number, number]; dur: number }[] = [
  { prefix: 'leather', name: '皮革', points: [1, 3, 2, 1], dur: 80 },
  { prefix: 'iron', name: '铁', points: [2, 6, 5, 2], dur: 240 },
  { prefix: 'golden', name: '金', points: [2, 5, 3, 1], dur: 112 },
  { prefix: 'diamond', name: '钻石', points: [3, 8, 6, 3], dur: 528 },
];

const ARMOR_KINDS: { suffix: string; name: string; slot: 0 | 1 | 2 | 3; durFactor: number }[] = [
  { suffix: 'helmet', name: '头盔', slot: 0, durFactor: 0.68 },
  { suffix: 'chestplate', name: '胸甲', slot: 1, durFactor: 1 },
  { suffix: 'leggings', name: '护腿', slot: 2, durFactor: 0.94 },
  { suffix: 'boots', name: '靴子', slot: 3, durFactor: 0.81 },
];

for (const m of ARMOR_MATERIALS) {
  for (const k of ARMOR_KINDS) {
    item({
      id: `${m.prefix}_${k.suffix}`,
      name: `${m.name}${k.name}`,
      kind: 'armor',
      maxStack: 1,
      icon: 'sprite',
      armor: {
        slot: k.slot,
        points: m.points[k.slot],
        durability: Math.round(m.dur * k.durFactor),
      },
    });
  }
}

item({ id: 'bow', name: '弓', kind: 'weapon', maxStack: 1, icon: 'sprite', tool: { type: 'none', tier: 0, speed: 1, durability: 384, damage: 1 } });
item({ id: 'arrow', name: '箭', kind: 'misc', maxStack: 64, icon: 'sprite' });
item({ id: 'flint_and_steel', name: '打火石', kind: 'tool', maxStack: 1, icon: 'sprite', tool: { type: 'none', tier: 0, speed: 1, durability: 64, damage: 1 } });

// ---------------------------------------------------------------------------
// Block items (auto-generated from the block registry)
// ---------------------------------------------------------------------------
for (const block of BLOCKS) {
  if (block.id === 'air') continue;
  item({
    id: block.id,
    name: block.name,
    kind: 'block',
    maxStack: 64,
    icon: 'block',
    block: block.id,
  });
}

const AIR_ITEM: ItemDef = { id: 'air', name: '空气', kind: 'misc', maxStack: 0, icon: 'sprite' };

export function getItem(id: string): ItemDef | undefined {
  return ITEMS.get(id);
}

export function requireItem(id: string): ItemDef {
  const def = ITEMS.get(id);
  if (!def) throw new Error(`Unknown item: ${id}`);
  return def;
}

export function allItems(): ItemDef[] {
  return [...ITEMS.values()];
}

export function itemDisplayName(id: string): string {
  return ITEMS.get(id)?.name ?? id;
}

export function itemMaxStack(id: string): number {
  return ITEMS.get(id)?.maxStack ?? 0;
}

/** Total armor points of a 4-slot armor inventory (helmet..boots). */
export function armorPoints(armor: (string | null)[]): number {
  let points = 0;
  for (let i = 0; i < 4; i++) {
    const id = armor[i];
    if (!id) continue;
    points += ITEMS.get(id)?.armor?.points ?? 0;
  }
  return points;
}

export { AIR_ITEM };
