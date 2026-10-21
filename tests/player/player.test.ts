import { describe, expect, it } from 'vitest';
import { makeSlot } from '../../src/core/types';
import { BLOCK } from '../../src/world/blocks';
import { Player } from '../../src/player/player';
import { createInputState, handleKeyDown, handleKeyUp, toPlayerInput } from '../../src/player/input';
import { groundView, FakeWorldView } from './helpers';

const TICK = 1;

function emptyWorldWithWater(): FakeWorldView {
  return groundView(63).fill(-8, 64, -8, 8, 72, 8, BLOCK.water);
}

describe('player: save-facing state and inventory', () => {
  it('exposes every save v1 field with the agreed sizes', () => {
    const player = new Player({ position: { x: 4, y: 70, z: -2 }, yaw: 1.2, pitch: -0.3 });
    expect(player.position).toEqual({ x: 4, y: 70, z: -2 });
    expect(player.yaw).toBeCloseTo(1.2);
    expect(player.pitch).toBeCloseTo(-0.3);
    expect(player.health).toBe(20);
    expect(player.hunger).toBe(20);
    expect(player.saturation).toBe(5);
    expect(player.air).toBe(300);
    expect(player.gameMode).toBe('survival');
    expect(player.inventory).toHaveLength(36);
    expect(player.armor).toHaveLength(4);
    expect(player.selectedSlot).toBe(0);
    // Inventory slots are writable for save/load.
    player.inventory[0] = makeSlot('dirt', 12);
    player.armor[1] = makeSlot('iron_chestplate', 1);
    expect(player.selectedStack()?.item).toBe('dirt');
    expect(player.armorPoints()).toBe(6);
  });

  it('adds, counts, consumes and stacks items', () => {
    const player = new Player();
    expect(player.addItem('apple', 5)).toBe(0);
    expect(player.countItem('apple')).toBe(5);
    expect(player.addItem('apple', 70)).toBe(0);
    expect(player.countItem('apple')).toBe(75);
    expect(player.inventory[0].count).toBe(64);
    expect(player.inventory[1].count).toBe(11);
    expect(player.consumeItem('apple', 70)).toBe(true);
    expect(player.countItem('apple')).toBe(5);
    expect(player.consumeItem('apple', 99)).toBe(false);
    expect(player.addItem('stone_sword', 1, 131)).toBe(0);
    expect(player.countItem('stone_sword')).toBe(1);
  });

  it('selects hotbar slots and consumes the selected stack', () => {
    const player = new Player({ inventory: [makeSlot('dirt', 3), makeSlot('apple', 2)] });
    player.setSelectedSlot(1);
    expect(player.selectedStack()?.item).toBe('apple');
    expect(player.consumeSelected(1)).toBe(true);
    expect(player.inventory[1].count).toBe(1);
    player.consumeSelected(1);
    expect(player.selectedStack()).toBeNull();
    player.setSelectedSlot(99);
    expect(player.selectedSlot).toBe(8);
  });

  it('damages tool durability and removes broken tools', () => {
    const player = new Player({ inventory: [makeSlot('wooden_pickaxe', 1, 2)] });
    expect(player.damageSelectedDurability(1)).toBe(false);
    expect(player.inventory[0].durability).toBe(1);
    expect(player.damageSelectedDurability(1)).toBe(true);
    expect(player.selectedStack()).toBeNull();
    // Non-damageable items report false and are never removed.
    player.inventory[0] = makeSlot('dirt', 1);
    expect(player.damageSelectedDurability(1)).toBe(false);
    expect(player.countItem('dirt')).toBe(1);
  });

  it('eats selected food and applies hunger/saturation', () => {
    const player = new Player({ inventory: [makeSlot('apple', 2)], hunger: 10, saturation: 0 });
    const eaten = player.eatSelected();
    expect(eaten).toMatchObject({ item: 'apple', hunger: 14, saturation: 2.4 });
    expect(player.inventory[0].count).toBe(1);
    player.hunger = 20;
    expect(player.eatSelected()).toBeNull();
  });

  it('applies armor reduction and respects creative/invulnerability rules', () => {
    const armored = new Player({ armor: [makeSlot('iron_helmet', 1), makeSlot('iron_chestplate', 1)] });
    expect(armored.armorPoints()).toBe(8); // 2 + 6 points -> 32% reduction
    armored.damage(10);
    expect(armored.health).toBeCloseTo(13, 5); // 10 * 0.68 = 6.8 -> 7.0 rounded to half hearts
    // Invulnerable for 0.5 s.
    armored.damage(10);
    expect(armored.health).toBeCloseTo(13, 5);
    // Fall damage ignores armor.
    armored.damage(4, { armor: false, ignoreInvulnerable: true });
    expect(armored.health).toBeCloseTo(9, 5);

    const creative = new Player({ gameMode: 'creative' });
    expect(creative.damage(10)).toBe(false);
    expect(creative.health).toBe(20);
  });

  it('dies at zero health', () => {
    const player = new Player();
    player.damage(100, { ignoreInvulnerable: true });
    expect(player.health).toBe(0);
    expect(player.dead).toBe(true);
    player.respawn({ x: 0, y: 64, z: 0 });
    expect(player.dead).toBe(false);
    expect(player.health).toBe(20);
  });
});

describe('player: simulation and camera', () => {
  it('walks forward with physics integration', () => {
    const world = groundView();
    const player = new Player({ position: { x: 0.5, y: 64, z: 0.5 }, yaw: 0 });
    player.input.forward = 1;
    for (let tick = 0; tick < 40; tick++) player.update(TICK, world);
    expect(player.position.z).toBeLessThan(-5);
    expect(player.onGround).toBe(true);
    expect(player.velocity.y).toBe(0);
    expect(player.horizontalSpeed).toBeGreaterThan(3);
    expect(player.fov).toBeCloseTo(70, 3);
  });

  it('takes fall damage when landing', () => {
    const world = groundView();
    const player = new Player({ position: { x: 0.5, y: 70, z: 0.5 } });
    for (let tick = 0; tick < 60; tick++) player.update(TICK, world);
    expect(player.position.y).toBeCloseTo(64, 5);
    expect(player.onGround).toBe(true);
    expect(player.lastFallDamage).toBe(3); // 6 blocks -> floor(6 - 3)
    expect(player.health).toBe(17);
  });

  it('does not take fall damage in creative mode', () => {
    const world = groundView();
    const player = new Player({ gameMode: 'creative', position: { x: 0.5, y: 90, z: 0.5 } });
    for (let tick = 0; tick < 80; tick++) player.update(TICK, world);
    expect(player.health).toBe(20);
  });

  it('toggles creative flight on a double space tap and flies', () => {
    const world = groundView();
    const player = new Player({ gameMode: 'creative', position: { x: 0.5, y: 64, z: 0.5 } });
    const state = createInputState();
    handleKeyDown(state, 'Space', 1000);
    handleKeyUp(state, 'Space');
    handleKeyDown(state, 'Space', 1200);
    expect(state.doubleJump).toBe(true);
    expect(toPlayerInput(state).toggleFly).toBe(true);
    player.update(TICK, world, toPlayerInput(state));
    expect(player.flying).toBe(true);
    for (let tick = 0; tick < 20; tick++) {
      player.update(TICK, world, { ...toPlayerInput(state), toggleFly: false, flyVertical: 1 });
    }
    expect(player.position.y).toBeGreaterThan(66);
  });

  it('does not retoggle flight when update() reuses player.input', () => {
    const world = groundView();
    const player = new Player({ gameMode: 'creative', position: { x: 0.5, y: 64, z: 0.5 } });
    player.input.toggleFly = true;
    player.update(TICK, world);
    expect(player.flying).toBe(true);
    // Same input object, no fresh double-tap: must stay flying.
    player.update(TICK, world);
    expect(player.flying).toBe(true);
  });

  it('swims and does not drown immediately in water', () => {
    const world = emptyWorldWithWater();
    const player = new Player({ position: { x: 0.5, y: 66, z: 0.5 } });
    for (let tick = 0; tick < 40; tick++) player.update(TICK, world);
    expect(player.inWater).toBe(true);
    expect(player.health).toBe(20);
    expect(player.eyeInWater).toBe(true);
    expect(player.air).toBeLessThan(300);
  });

  it('takes burn damage while standing in lava', () => {
    const world = groundView(63).fill(-4, 64, -4, 4, 68, 4, BLOCK.lava);
    const player = new Player({ position: { x: 0.5, y: 64, z: 0.5 } });
    for (let tick = 0; tick < 12; tick++) player.update(TICK, world);
    expect(player.inLava).toBe(true);
    expect(player.health).toBeLessThan(20);
  });

  it('stretches FOV while sprinting', () => {
    const world = groundView();
    const player = new Player({ position: { x: 0.5, y: 64, z: 0.5 }, yaw: 0 });
    player.input.forward = 1;
    player.input.sprint = true;
    for (let tick = 0; tick < 30; tick++) player.update(TICK, world);
    expect(player.sprinting).toBe(true);
    expect(player.fov).toBeGreaterThan(72);
  });

  it('applies the camera eye position, rotation and fov', () => {
    const player = new Player({ position: { x: 1.5, y: 64, z: 2.5 }, yaw: 0.7, pitch: -0.2 });
    let px = 0;
    let py = 0;
    let pz = 0;
    let rx = 0;
    let ry = 0;
    let rz = 0;
    let projections = 0;
    player.applyCamera({
      position: {
        set(x: number, y: number, z: number) {
          px = x;
          py = y;
          pz = z;
        },
      },
      rotation: {
        set(x: number, y: number, z: number) {
          rx = x;
          ry = y;
          rz = z;
        },
      },
      fov: 70,
      updateProjectionMatrix: () => {
        projections++;
      },
    });
    expect(px).toBeCloseTo(1.5);
    expect(py).toBeCloseTo(64 + 1.62);
    expect(pz).toBeCloseTo(2.5);
    expect(rx).toBeCloseTo(-0.2);
    expect(ry).toBeCloseTo(0.7);
    expect(rz).toBe(0);
    // FOV cannot change in a single applyCamera call when unchanged.
    expect(projections).toBe(0);
    // Sneaking lowers the eye.
    player.sneaking = true;
    expect(player.eyePosition().y).toBeCloseTo(64 + 1.5);
  });

  it('clamps pitch to just under ±90 degrees', () => {
    const player = new Player();
    player.look(0, -100000);
    expect(player.pitch).toBeLessThanOrEqual(Math.PI / 2);
    expect(player.pitch).toBeGreaterThan(Math.PI / 2 - 0.01);
    player.look(0, 100000);
    expect(player.pitch).toBeGreaterThanOrEqual(-Math.PI / 2);
    expect(player.pitch).toBeLessThan(-Math.PI / 2 + 0.01);
  });

  it('toggles flight off and on and only in creative', () => {
    const survival = new Player({ gameMode: 'survival' });
    expect(survival.toggleFly()).toBe(false);
    const creative = new Player({ gameMode: 'creative' });
    expect(creative.toggleFly()).toBe(true);
    expect(creative.flying).toBe(true);
    creative.setGameMode('survival');
    expect(creative.flying).toBe(false);
  });
});
