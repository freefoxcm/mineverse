import { describe, expect, it } from 'vitest';
import { makeSlot, type BlockHit, type Slot } from '../../src/core/types';
import { BLOCK, blockNumeric, getBlockDef } from '../../src/world/blocks';
import { getItem } from '../../src/world/items';
import {
  InteractionController,
  breakStage,
  breakTimeSeconds,
  canHarvest,
  canPlaceBlock,
  particleColorForBlock,
  placementMetaFor,
  placementTarget,
  raycastBlocks,
  rollDrops,
  toolSpeedFor,
  type InteractionCallbacks,
  type InteractionInput,
} from '../../src/player/interaction';
import { Player, type PlayerOptions } from '../../src/player/player';
import { FakeWorldView, groundView } from './helpers';

const IDLE: InteractionInput = {
  attack: false,
  attackPressed: false,
  use: false,
  usePressed: false,
  useReleased: false,
};

function playerWith(
  inventory: (Slot | null)[],
  options: Partial<PlayerOptions> = {},
): Player {
  const slots: Slot[] = inventory.map((slot) => slot ?? { item: null, count: 0 });
  return new Player({
    position: { x: 0.5, y: 64, z: 0.5 },
    inventory: slots,
    ...options,
  });
}

function historyHit(
  x: number,
  y: number,
  z: number,
  nx: number,
  ny: number,
  nz: number,
  id = BLOCK.stone,
): BlockHit {
  return { x, y, z, nx, ny, nz, distance: 1, id, meta: 0 };
}

describe('interaction: DDA raycast', () => {
  it('hits a block, reports distance and the -X face normal from +X', () => {
    const world = new FakeWorldView().set(2, 65, 0, BLOCK.stone);
    const hit = raycastBlocks(world, { x: 0.5, y: 65.5, z: 0.5 }, { x: 1, y: 0, z: 0 }, 5);
    expect(hit).not.toBeNull();
    expect(hit?.x).toBe(2);
    expect(hit?.y).toBe(65);
    expect(hit?.z).toBe(0);
    expect(hit?.id).toBe(BLOCK.stone);
    expect(hit?.nx).toBe(-1);
    expect(hit?.distance).toBeCloseTo(1.5, 5);
  });

  it('reports the opposite face normal when raycasting from the other side', () => {
    const world = new FakeWorldView().set(0, 65, 0, BLOCK.stone);
    const hit = raycastBlocks(world, { x: 3.5, y: 65.5, z: 0.5 }, { x: -1, y: 0, z: 0 }, 5);
    expect(hit?.x).toBe(0);
    expect(hit?.nx).toBe(1);
    expect(hit?.distance).toBeCloseTo(2.5, 5);
  });

  it('returns null beyond the reach distance', () => {
    const world = new FakeWorldView().set(6, 65, 0, BLOCK.stone);
    const hit = raycastBlocks(world, { x: 0.5, y: 65.5, z: 0.5 }, { x: 1, y: 0, z: 0 }, 5);
    expect(hit).toBeNull();
  });

  it('skips fluids and hits the solid block behind them', () => {
    const world = new FakeWorldView()
      .set(1, 65, 0, BLOCK.water)
      .set(2, 65, 0, BLOCK.stone);
    const hit = raycastBlocks(world, { x: 0.5, y: 65.5, z: 0.5 }, { x: 1, y: 0, z: 0 }, 5);
    expect(hit?.x).toBe(2);
    // includeFluids makes the water surface the first hit.
    const wet = raycastBlocks(world, { x: 0.5, y: 65.5, z: 0.5 }, { x: 1, y: 0, z: 0 }, 5, {
      includeFluids: true,
    });
    expect(wet?.id).toBe(BLOCK.water);
  });

  it('hits the ground looking straight down with a +Y normal', () => {
    const world = groundView(63);
    const hit = raycastBlocks(world, { x: 0.5, y: 70, z: 0.5 }, { x: 0, y: -1, z: 0 }, 10);
    expect(hit?.y).toBe(63);
    expect(hit?.ny).toBe(1);
    expect(hit?.distance).toBeCloseTo(6, 5);
  });

  it('returns null in empty air and for zero direction', () => {
    const world = new FakeWorldView();
    expect(raycastBlocks(world, { x: 0.5, y: 65.5, z: 0.5 }, { x: 1, y: 0, z: 0 })).toBeNull();
    expect(raycastBlocks(world, { x: 0.5, y: 65.5, z: 0.5 }, { x: 0, y: 0, z: 0 })).toBeNull();
  });
});

describe('interaction: mining speed and drops', () => {
  const stone = getBlockDef(BLOCK.stone);
  const dirt = getBlockDef(BLOCK.dirt);
  const obsidian = getBlockDef(blockNumeric('obsidian'));
  const bedrock = getBlockDef(BLOCK.bedrock);
  const woodenPick = getItem('wooden_pickaxe')!;
  const ironPick = getItem('iron_pickaxe')!;
  const diamondPick = getItem('diamond_pickaxe')!;

  it('uses hardness × (correct tool ? 1.5 : 5) / tool speed', () => {
    expect(breakTimeSeconds(stone, null)).toBeCloseTo(7.5, 6); // 1.5 × 5
    expect(breakTimeSeconds(stone, woodenPick)).toBeCloseTo(1.125, 6); // 1.5 × 1.5 / 2
    expect(breakTimeSeconds(dirt, null)).toBeCloseTo(0.75, 6); // 0.5 × 1.5
    expect(breakTimeSeconds(obsidian, diamondPick)).toBeCloseTo(9.375, 6); // 50 × 1.5 / 8
  });

  it('cannot harvest blocks above the tool tier (wrong tool gets 5× time)', () => {
    expect(canHarvest(stone, null)).toBe(false);
    expect(canHarvest(stone, woodenPick)).toBe(true);
    expect(canHarvest(obsidian, ironPick)).toBe(false);
    expect(breakTimeSeconds(obsidian, ironPick)).toBeCloseTo((50 * 5) / 6, 6);
    expect(toolSpeedFor(stone, woodenPick)).toBe(2);
    expect(toolSpeedFor(stone, null)).toBe(1);
  });

  it('treats creative, hardness-0 and bedrock blocks specially', () => {
    expect(breakTimeSeconds(stone, null, true)).toBe(0);
    expect(breakTimeSeconds(getBlockDef(BLOCK.torch), null)).toBe(0);
    expect(breakTimeSeconds(bedrock, diamondPick)).toBe(Infinity);
  });

  it('maps progress to the ten crack stages', () => {
    expect(breakStage(0)).toBe(-1);
    expect(breakStage(0.01)).toBe(0);
    expect(breakStage(0.34)).toBe(3);
    expect(breakStage(0.99)).toBe(9);
    expect(breakStage(1)).toBe(9);
  });

  it('rolls deterministic drops respecting harvest rules and chances', () => {
    expect(rollDrops(stone, false, () => 0)).toEqual([]);
    expect(rollDrops(stone, true, () => 0)).toEqual([{ item: 'cobblestone', count: 1 }]);
    const gravel = getBlockDef(BLOCK.gravel);
    const rolls = [0.95, 0.05, 0]; // skip gravel (chance .9), pass flint (chance .1), min count
    let index = 0;
    const drops = rollDrops(gravel, true, () => rolls[index++] ?? 0);
    expect(drops).toEqual([{ item: 'flint', count: 1 }]);
  });

  it('provides particle colors for blocks', () => {
    const grassColor = particleColorForBlock(getBlockDef(BLOCK.grass_block));
    expect(grassColor[1]).toBeGreaterThan(grassColor[0]);
    const stoneColor = particleColorForBlock(stone);
    expect(stoneColor[0]).toBeCloseTo(stoneColor[1], 6);
  });
});

describe('interaction: placement rules', () => {
  const dirtItem = getItem('dirt')!;
  const torchItem = getItem('torch')!;
  const grassItem = getItem('tall_grass')!;
  const playerFar = { x: 5.5, y: 64, z: 5.5 };

  it('places on the clicked face into a replaceable block', () => {
    const world = new FakeWorldView().set(0, 63, 0, BLOCK.stone);
    const result = canPlaceBlock(world, playerFar, historyHit(0, 63, 0, 0, 1, 0), dirtItem);
    expect(result.ok).toBe(true);
    expect(result.x).toBe(0);
    expect(result.y).toBe(64);
    expect(result.z).toBe(0);
    expect(result.blockId).toBe(BLOCK.dirt);
  });

  it('rejects occupied targets and blocks overlapping the player', () => {
    const world = new FakeWorldView().set(0, 63, 0, BLOCK.stone).set(0, 64, 0, BLOCK.stone);
    const occupied = canPlaceBlock(world, playerFar, historyHit(0, 63, 0, 0, 1, 0), dirtItem);
    expect(occupied.ok).toBe(false);
    expect(occupied.failure).toBe('occupied');

    const clear = new FakeWorldView().set(0, 63, 0, BLOCK.stone);
    const overlap = canPlaceBlock(clear, { x: 0.5, y: 64, z: 0.5 }, historyHit(0, 63, 0, 0, 1, 0), dirtItem);
    expect(overlap.ok).toBe(false);
    expect(overlap.failure).toBe('player_overlap');
  });

  it('requires support for torches and plants', () => {
    const floating = new FakeWorldView().set(0, 65, 0, BLOCK.stone);
    const noSupport = canPlaceBlock(floating, playerFar, historyHit(0, 65, 0, 1, 0, 0), torchItem);
    expect(noSupport.ok).toBe(false);
    expect(noSupport.failure).toBe('no_support');

    const supported = new FakeWorldView()
      .set(0, 65, 0, BLOCK.stone)
      .set(1, 64, 0, BLOCK.stone);
    const withSupport = canPlaceBlock(supported, playerFar, historyHit(0, 65, 0, 1, 0, 0), torchItem);
    expect(withSupport.ok).toBe(true);

    const onStone = new FakeWorldView().set(0, 63, 0, BLOCK.stone);
    const grassOnStone = canPlaceBlock(onStone, playerFar, historyHit(0, 63, 0, 0, 1, 0), grassItem);
    expect(grassOnStone.failure).toBe('no_support');

    const onDirt = new FakeWorldView().set(0, 63, 0, BLOCK.dirt);
    const grassOnDirt = canPlaceBlock(onDirt, playerFar, historyHit(0, 63, 0, 0, 1, 0), grassItem);
    expect(grassOnDirt.ok).toBe(true);
  });

  it('replaces targeted replaceable plants in place and enforces world bounds', () => {
    const world = new FakeWorldView().set(0, 63, 0, BLOCK.tall_grass);
    const hit = historyHit(0, 63, 0, 0, 1, 0, BLOCK.tall_grass);
    expect(placementTarget(world, hit)).toEqual({ x: 0, y: 63, z: 0 });
    const result = canPlaceBlock(world, playerFar, hit, dirtItem);
    expect(result.ok).toBe(true);
    expect(result.x).toBe(0);
    expect(result.y).toBe(63);

    const high = canPlaceBlock(
      new FakeWorldView(),
      playerFar,
      historyHit(0, 159, 0, 0, 1, 0),
      dirtItem,
    );
    expect(high.failure).toBe('out_of_bounds');
    expect(high.ok).toBe(false);
  });

  it('computes log axis and furnace facing meta', () => {
    const log = getBlockDef(BLOCK.oak_log);
    const target = { x: 0, y: 64, z: 0 };
    expect(placementMetaFor(log, historyHit(0, 63, 0, 0, 1, 0), playerFar, target)).toBe(0);
    expect(placementMetaFor(log, historyHit(0, 63, 0, -1, 0, 0), playerFar, target)).toBe(1);
    expect(placementMetaFor(log, historyHit(0, 63, 0, 0, 0, 1), playerFar, target)).toBe(2);

    const furnace = getBlockDef(BLOCK.furnace);
    expect(placementMetaFor(furnace, null, { x: 5.5, y: 64, z: 0.5 }, target)).toBe(5); // player east
    expect(placementMetaFor(furnace, null, { x: -5.5, y: 64, z: 0.5 }, target)).toBe(4); // west
    expect(placementMetaFor(furnace, null, { x: 0.5, y: 64, z: 5.5 }, target)).toBe(3); // south
    expect(placementMetaFor(furnace, null, { x: 0.5, y: 64, z: -5.5 }, target)).toBe(2); // north
  });
});

describe('interaction: controller', () => {
  function collect(): { callbacks: InteractionCallbacks; calls: Record<string, unknown[]> } {
    const calls: Record<string, unknown[]> = {
      break: [],
      place: [],
      eat: [],
      ignite: [],
      shoot: [],
      sound: [],
      toolBroken: [],
      attack: [],
    };
    const callbacks: InteractionCallbacks = {
      onBreak: (hit, def, drops) => calls.break.push({ hit, def, drops }),
      onPlace: (hit, x, y, z, blockId, meta, itemId) =>
        calls.place.push({ hit, x, y, z, blockId, meta, itemId }),
      onEat: (eaten) => calls.eat.push(eaten),
      onIgniteTnt: (x, y, z) => calls.ignite.push({ x, y, z }),
      onShootArrow: (charge, origin, direction) => calls.shoot.push({ charge, origin, direction }),
      onSound: (id) => calls.sound.push(id),
      onToolBroken: (itemId) => calls.toolBroken.push(itemId),
      onAttack: (origin, direction, blockHit) => calls.attack.push({ origin, direction, blockHit }),
    };
    return { callbacks, calls };
  }

  it('mines stone by hand in 7.5 s and reports progress', () => {
    const world = groundView().set(1, 65, 0, BLOCK.stone);
    const player = new Player({ position: { x: 0.5, y: 64, z: 0.5 }, yaw: -Math.PI / 2 });
    const { callbacks, calls } = collect();
    const controller = new InteractionController(callbacks);
    const attack: InteractionInput = { ...IDLE, attack: true, attackPressed: true };

    for (let tick = 0; tick < 75; tick++) controller.update(world, player, 50, attack);
    expect(controller.breaking).toBe(true);
    expect(controller.breakProgress).toBeCloseTo(0.5, 2);
    expect(world.getBlock(1, 65, 0)).toBe(BLOCK.stone);
    expect(calls.attack.length).toBeGreaterThan(0);

    for (let tick = 0; tick < 76; tick++) controller.update(world, player, 50, attack);
    expect(world.getBlock(1, 65, 0)).toBe(BLOCK.air);
    expect(calls.break).toHaveLength(1);
    expect(controller.breakProgress).toBe(0);
    // Stone requires a pickaxe, so bare hands get no drops.
    const breakCall = calls.break[0] as { drops: unknown[] };
    expect(breakCall.drops).toEqual([]);
  });

  it('breaks blocks instantly in creative mode without consuming durability', () => {
    const world = groundView().set(1, 65, 0, BLOCK.stone);
    const player = new Player({
      gameMode: 'creative',
      position: { x: 0.5, y: 64, z: 0.5 },
      inventory: [makeSlot('wooden_pickaxe', 1)],
      yaw: -Math.PI / 2,
    });
    const { callbacks, calls } = collect();
    const controller = new InteractionController(callbacks);
    controller.update(world, player, 50, { ...IDLE, attack: true, attackPressed: true });
    expect(world.getBlock(1, 65, 0)).toBe(BLOCK.air);
    expect(calls.break).toHaveLength(1);
    expect(player.inventory[0].durability).toBeUndefined();
  });

  it('places a held block, consumes it and calls onPlace', () => {
    const world = groundView();
    const player = playerWith([makeSlot('dirt', 64)]);
    // Aim at the top of block (3, 63, 0) from the spawn position.
    const dx = 3.0;
    const dy = 64 - 65.62;
    const length = Math.hypot(dx, dy);
    player.setLook(-Math.PI / 2, Math.asin(dy / length));
    const { callbacks, calls } = collect();
    const controller = new InteractionController(callbacks);
    const result = controller.update(world, player, 50, { ...IDLE, use: true, usePressed: true });
    expect(result.hit).not.toBeNull();
    expect(world.getBlock(3, 64, 0)).toBe(BLOCK.dirt);
    expect(player.inventory[0].count).toBe(63);
    expect(calls.place).toHaveLength(1);
    const placed = calls.place[0] as { x: number; y: number; z: number; itemId: string };
    expect(placed).toMatchObject({ x: 3, y: 64, z: 0, itemId: 'dirt' });
  });

  it('eats food after holding use for 1.6 s', () => {
    const world = new FakeWorldView();
    const player = playerWith([makeSlot('apple', 2)], { hunger: 10, saturation: 0 });
    const { callbacks, calls } = collect();
    const controller = new InteractionController(callbacks);
    controller.update(world, player, 50, { ...IDLE, use: true, usePressed: true });
    expect(controller.eating).toBe(true);
    for (let tick = 0; tick < 32; tick++) controller.update(world, player, 50, { ...IDLE, use: true });
    expect(controller.eating).toBe(false);
    expect(player.hunger).toBe(14);
    expect(player.inventory[0].count).toBe(1);
    expect(calls.eat).toHaveLength(1);
  });

  it('does not eat when already full', () => {
    const world = new FakeWorldView();
    const player = playerWith([makeSlot('apple', 2)], { hunger: 20 });
    const controller = new InteractionController(collect().callbacks);
    controller.update(world, player, 50, { ...IDLE, use: true, usePressed: true });
    expect(controller.eating).toBe(false);
    for (let tick = 0; tick < 40; tick++) controller.update(world, player, 50, { ...IDLE, use: true });
    expect(player.hunger).toBe(20);
    expect(player.inventory[0].count).toBe(2);
  });

  it('ignites TNT with flint & steel and consumes durability', () => {
    const world = groundView().set(1, 65, 0, BLOCK.tnt);
    const player = playerWith([makeSlot('flint_and_steel', 1)], { yaw: -Math.PI / 2 });
    const { callbacks, calls } = collect();
    const controller = new InteractionController(callbacks);
    controller.update(world, player, 50, { ...IDLE, use: true, usePressed: true });
    expect(calls.ignite).toEqual([{ x: 1, y: 65, z: 0 }]);
    expect(player.inventory[0].durability).toBe(63);
  });

  it('charges and releases a bow, consuming an arrow and durability', () => {
    const world = new FakeWorldView();
    const player = playerWith([makeSlot('bow', 1), makeSlot('arrow', 2)]);
    const { callbacks, calls } = collect();
    const controller = new InteractionController(callbacks);
    controller.update(world, player, 50, { ...IDLE, use: true, usePressed: true });
    for (let tick = 0; tick < 19; tick++) controller.update(world, player, 50, { ...IDLE, use: true });
    expect(controller.bowCharge).toBeGreaterThan(0.9);
    controller.update(world, player, 50, { ...IDLE, use: false, useReleased: true });
    expect(calls.shoot).toHaveLength(1);
    const shot = calls.shoot[0] as { charge: number };
    expect(shot.charge).toBeCloseTo(1, 5);
    expect(player.countItem('arrow')).toBe(1);
    expect(player.inventory[0].durability).toBe(383);
    expect(controller.bowCharge).toBe(0);
  });
});
