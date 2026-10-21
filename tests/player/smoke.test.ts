import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import {
  SOUND_IDS,
  attenuationFor,
  breakSoundFor,
  placeSoundFor,
  stepSoundFor,
} from '../../src/audio/audio';
import { ParticleSystem, createParticleTexture } from '../../src/player/particles';
import {
  FirstPersonHand,
  HAND_POSES,
  HAND_SCALES,
  buildBlockGeometry,
  buildSpriteGeometry,
  tintForBlock,
} from '../../src/render/firstPerson';
import { BLOCK, faceTexture, getBlockDef, blockNumeric } from '../../src/world/blocks';
import { makeSlot } from '../../src/core/types';
import {
  createInputState,
  endFrameInput,
  handleKeyDown,
  handleKeyUp,
  handleMouseButton,
  releaseAllInput,
  toPlayerInput,
} from '../../src/player/input';
import type { TextureAtlas } from '../../src/render/atlas';

describe('audio: registry and 3D attenuation', () => {
  it('registers at least 24 unique procedurally synthesised sounds', () => {
    expect(SOUND_IDS.length).toBeGreaterThanOrEqual(24);
    expect(new Set(SOUND_IDS).size).toBe(SOUND_IDS.length);
  });

  it('attentuates linearly with distance and culls past max distance', () => {
    expect(attenuationFor(0)).toBe(1);
    expect(attenuationFor(2)).toBe(1);
    expect(attenuationFor(17)).toBeCloseTo(0.5, 6);
    expect(attenuationFor(32)).toBe(0);
    expect(attenuationFor(100)).toBe(0);
    expect(attenuationFor(8)).toBeGreaterThan(attenuationFor(16));
    expect(attenuationFor(Number.NaN)).toBe(0);
  });

  it('maps block materials to break/place/step sounds', () => {
    expect(breakSoundFor('stone')).toBe('break_stone');
    expect(breakSoundFor('glass')).toBe('break_glass');
    expect(breakSoundFor('wood')).toBe('break_wood');
    expect(placeSoundFor('wood')).toBe('place_wood');
    expect(placeSoundFor('stone')).toBe('place_stone');
    expect(stepSoundFor('grass')).toBe('step_grass');
    expect(stepSoundFor('sand')).toBe('step_sand');
    expect(stepSoundFor('dirt')).toBe('step_dirt');
  });
});

describe('particles: deterministic simulation', () => {
  it('spawns deterministic bursts from the same seed', () => {
    const a = new ParticleSystem(64, 1234);
    const b = new ParticleSystem(64, 1234);
    expect(a.spawnBlockBreak(1, 2, 3, [1, 0, 0], 8)).toBe(8);
    expect(b.spawnBlockBreak(1, 2, 3, [1, 0, 0], 8)).toBe(8);
    expect(a.activeCount).toBe(8);
    for (let i = 0; i < 8; i++) {
      expect(a.px[i]).toBeCloseTo(b.px[i], 6);
      expect(a.py[i]).toBeCloseTo(b.py[i], 6);
      expect(a.vz[i]).toBeCloseTo(b.vz[i], 6);
    }
  });

  it('moves, ages and expires particles; clear() empties the pool', () => {
    const system = new ParticleSystem(16, 7);
    system.spawnExplosion(0, 10, 0, 6);
    const startY = system.py[0];
    system.update(0.1);
    expect(system.py[0]).not.toBeCloseTo(startY, 6);
    expect(system.age[0]).toBeGreaterThan(0);
    for (let i = 0; i < 20; i++) system.update(0.1);
    expect(system.activeCount).toBe(0);
    system.spawnSplash(0, 0, 0, 3);
    expect(system.activeCount).toBe(3);
    system.clear();
    expect(system.activeCount).toBe(0);
  });

  it('never exceeds capacity and produces a valid procedural texture', () => {
    const system = new ParticleSystem(4, 99);
    const spawned = system.spawnExplosion(0, 0, 0, 40);
    expect(spawned).toBe(4);
    expect(system.activeCount).toBe(4);
    const texture = createParticleTexture(8);
    expect(texture.image.width).toBe(8);
    expect(texture.image.data).toHaveLength(8 * 8 * 4);
    texture.dispose();
  });
});

describe('first person hand geometry', () => {
  it('builds a 6-face cube with atlas layers in blocks.ts face order', () => {
    const stone = getBlockDef(BLOCK.stone);
    const tiles: string[] = [];
    const result = buildBlockGeometry(stone, (tile) => {
      tiles.push(tile);
      return tiles.length;
    });
    expect(tiles).toHaveLength(6);
    expect(result.layers).toEqual([1, 2, 3, 4, 5, 6]);
    for (let face = 0; face < 6; face++) {
      expect(tiles[face]).toBe(faceTexture(stone, face));
    }
    const positions = result.geometry.getAttribute('position');
    const layers = result.geometry.getAttribute('aLayer');
    const uvs = result.geometry.getAttribute('aUv');
    const index = result.geometry.getIndex();
    expect(positions.count).toBe(24);
    expect(layers.count).toBe(24);
    expect(uvs.count).toBe(24);
    expect(index?.count).toBe(36);
    // p0..p3 UV convention per face (shader flips V).
    expect(uvs.getX(0)).toBe(0);
    expect(uvs.getY(0)).toBe(0);
    expect(uvs.getX(1)).toBe(1);
    expect(uvs.getY(2)).toBe(1);
    result.geometry.dispose();
  });

  it('builds a flat sprite quad and tints grass/foliage blocks', () => {
    const sprite = buildSpriteGeometry(7);
    expect(sprite.getAttribute('position').count).toBe(4);
    expect(sprite.getIndex()?.count).toBe(6);
    expect(sprite.getAttribute('aLayer')?.getX(0)).toBe(7);
    sprite.dispose();

    const grassTint = tintForBlock(getBlockDef(BLOCK.grass_block));
    expect(grassTint[1]).toBeGreaterThan(grassTint[0]);
    const stoneTint = tintForBlock(getBlockDef(BLOCK.stone));
    expect(stoneTint).toEqual([1, 1, 1]);
  });

  it('constructs a FirstPersonHand and swaps held items without DOM', () => {
    const data = new Uint8Array(32 * 32 * 4);
    const texture = new THREE.DataArrayTexture(data, 32, 32, 1);
    const fakeAtlas = {
      texture,
      layerCount: 1,
      layerOf: () => 0,
      dispose: () => undefined,
    } as unknown as TextureAtlas;
    const hand = new FirstPersonHand(fakeAtlas);
    expect(hand.heldItemId).toBeNull();
    expect(hand.heldItemKind).toBe('none');
    hand.setItem(makeSlot('dirt', 1));
    expect(hand.heldItemId).toBe('dirt');
    expect(hand.heldItemKind).toBe('block');
    hand.swing('attack');
    hand.triggerEat();
    hand.update(0.05, { moving: true, onGround: true, horizontalSpeed: 4.3 });
    hand.setDaylight(0.5);
    hand.setItem(makeSlot('apple', 1));
    expect(hand.heldItemId).toBe('apple');
    // No item atlas supplied -> colored placeholder fallback.
    expect(hand.heldItemKind).toBe('fallback');
    hand.setItem(makeSlot('iron_pickaxe', 1));
    expect(hand.heldItemId).toBe('iron_pickaxe');
    hand.setItem(null);
    expect(hand.heldItemId).toBeNull();
    expect(hand.heldItemKind).toBe('none');
    hand.dispose();
    texture.dispose();
  });

  it('uses the item icon atlas for sprite items when provided', () => {
    const blockTexture = new THREE.DataArrayTexture(new Uint8Array(32 * 32 * 4), 32, 32, 1);
    const itemTexture = new THREE.DataArrayTexture(new Uint8Array(32 * 32 * 4 * 2), 32, 32, 2);
    const fakeAtlas = {
      texture: blockTexture,
      layerCount: 1,
      layerOf: () => 0,
      dispose: () => undefined,
    } as unknown as TextureAtlas;
    const hand = new FirstPersonHand(fakeAtlas, {
      itemTexture,
      itemLayerOf: () => 1,
    });
    expect(hand.heldItemKind).toBe('none');
    hand.setItem(makeSlot('dirt', 1));
    expect(hand.heldItemKind).toBe('block');
    hand.setItem(makeSlot('iron_pickaxe', 1));
    expect(hand.heldItemKind).toBe('sprite');
    hand.dispose();
    blockTexture.dispose();
    itemTexture.dispose();
  });

  it('places the hand bottom-right at a MC-like 20-25% screen height', () => {
    const camera = new THREE.PerspectiveCamera(70, 16 / 9, 0.01, 10);
    camera.updateProjectionMatrix();
    camera.updateMatrixWorld(true);

    const project = (mesh: THREE.Mesh): { minX: number; maxX: number; minY: number; maxY: number } => {
      mesh.updateMatrixWorld(true);
      const position = mesh.geometry.getAttribute('position') as THREE.BufferAttribute;
      const vertex = new THREE.Vector3();
      let minX = Infinity;
      let maxX = -Infinity;
      let minY = Infinity;
      let maxY = -Infinity;
      for (let i = 0; i < position.count; i++) {
        vertex.fromBufferAttribute(position, i).applyMatrix4(mesh.matrixWorld).project(camera);
        minX = Math.min(minX, vertex.x);
        maxX = Math.max(maxX, vertex.x);
        minY = Math.min(minY, vertex.y);
        maxY = Math.max(maxY, vertex.y);
      }
      return { minX, maxX, minY, maxY };
    };

    const applyPose = (
      mesh: THREE.Mesh,
      scale: number,
      pose: { position: readonly number[]; rotation: readonly number[] },
    ): void => {
      mesh.scale.setScalar(scale);
      mesh.position.set(pose.position[0], pose.position[1], pose.position[2]);
      mesh.rotation.set(pose.rotation[0], pose.rotation[1], pose.rotation[2]);
      mesh.updateMatrixWorld(true);
    };

    const blockMesh = new THREE.Mesh(buildBlockGeometry(getBlockDef(BLOCK.stone), () => 0).geometry);
    applyPose(blockMesh, HAND_SCALES.block, HAND_POSES.block);
    const block = project(blockMesh);
    const blockHeight = (block.maxY - block.minY) / 2; // NDC -> fraction of screen height
    expect(blockHeight).toBeGreaterThan(0.18);
    expect(blockHeight).toBeLessThan(0.3);
    expect((block.minX + block.maxX) / 2).toBeGreaterThan(0.25);
    expect((block.minY + block.maxY) / 2).toBeLessThan(-0.35);

    const spriteMesh = new THREE.Mesh(buildSpriteGeometry(0));
    applyPose(spriteMesh, HAND_SCALES.sprite, HAND_POSES.sprite);
    const sprite = project(spriteMesh);
    const spriteHeight = (sprite.maxY - sprite.minY) / 2;
    const spriteWidth = (sprite.maxX - sprite.minX) / 2;
    expect(spriteHeight).toBeGreaterThan(0.18);
    expect(spriteHeight).toBeLessThan(0.3);
    // Nearly camera-facing (not a heavily skewed trapezoid).
    expect(spriteWidth / spriteHeight).toBeLessThan(1.4);
    expect((sprite.minY + sprite.maxY) / 2).toBeLessThan(-0.35);

    const armMesh = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.14, 0.55));
    applyPose(armMesh, 1, HAND_POSES.arm);
    const arm = project(armMesh);
    expect((arm.minX + arm.maxX) / 2).toBeGreaterThan(0.2);
    // Bare arm hangs low and never covers the crosshair.
    expect(arm.maxY).toBeLessThan(0.05);
  });
});

describe('input: pure state machine', () => {
  it('maps keys to movement and edges, and converts to player input', () => {
    const state = createInputState();
    expect(handleKeyDown(state, 'KeyW', 1000)).toBe(true);
    expect(handleKeyDown(state, 'KeyD', 1000)).toBe(true);
    handleKeyDown(state, 'Space', 1000);
    expect(handleKeyDown(state, 'F3', 1000)).toBe(false);
    const input = toPlayerInput(state);
    expect(input.forward).toBe(1);
    expect(input.strafe).toBe(1);
    expect(input.jump).toBe(true);
    expect(input.jumpPressed).toBe(true);
    endFrameInput(state);
    expect(toPlayerInput(state).jumpPressed).toBe(false);
    handleKeyUp(state, 'KeyW');
    expect(toPlayerInput(state).forward).toBe(0);
  });

  it('detects double-tap space for creative flight within the window', () => {
    const state = createInputState();
    handleKeyDown(state, 'Space', 1000);
    endFrameInput(state);
    handleKeyUp(state, 'Space');
    expect(state.doubleJump).toBe(false);
    handleKeyDown(state, 'Space', 1200);
    expect(state.doubleJump).toBe(true);
    expect(toPlayerInput(state).toggleFly).toBe(true);
    endFrameInput(state);
    expect(state.doubleJump).toBe(false);
  });

  it('handles mouse buttons and hotbar digit keys', () => {
    const state = createInputState();
    expect(handleMouseButton(state, 0, true)).toBe(true);
    expect(state.attackPressed).toBe(true);
    expect(state.attack).toBe(true);
    handleMouseButton(state, 2, true);
    expect(state.usePressed).toBe(true);
    handleMouseButton(state, 2, false);
    expect(state.useReleased).toBe(true);
    handleKeyDown(state, 'Digit5', 1000);
    expect(state.hotbarSlot).toBe(4);
    handleMouseButton(state, 2, false);
    releaseAllInput(state);
    expect(state.use).toBe(false);
    expect(state.attack).toBe(false);
  });
});

// Keep blockNumeric used in this file meaningful in strict mode.
void blockNumeric;
