import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { PixelPainter } from '../../src/art/pixels';
import { MOB_TYPES } from '../../src/entities/models';
import type { EntitySnapshot } from '../../src/entities/snapshot';
import { EntityRenderer, paintFallbackMobTexture } from '../../src/render/entityRenderer';
import { ItemIconAtlas } from '../../src/render/itemAtlas';

function snapshot(overrides: Partial<EntitySnapshot>): EntitySnapshot {
  const position = overrides.position ?? { x: 0.5, y: 10, z: 0.5 };
  return {
    id: 1,
    kind: 'mob',
    type: 'zombie',
    position,
    previousPosition: { ...position },
    velocity: { x: 0, y: 0, z: 0 },
    yaw: 0,
    headYaw: 0,
    headPitch: 0,
    health: 20,
    maxHealth: 20,
    hurtTime: 0,
    deathTime: -1,
    fireTicks: 0,
    fuse: 0,
    walkPhase: 0,
    speed: 0,
    onGround: true,
    age: 0,
    shadowY: 10,
    ...overrides,
  };
}

function itemSnapshot(
  id: number,
  itemId: string,
  position: { x: number; y: number; z: number } = { x: 1.5, y: 10.2, z: 1.5 },
): EntitySnapshot {
  return snapshot({
    id,
    kind: 'item',
    type: itemId,
    item: { item: itemId, count: 1 },
    position,
    previousPosition: { ...position },
    shadowY: 10,
    age: 20,
  });
}

function meshOf(group: THREE.Object3D): THREE.Mesh {
  return group.children.find((child): child is THREE.Mesh => child instanceof THREE.Mesh) as THREE.Mesh;
}

const ENVIRONMENT = {
  daylight: 1,
  fogColor: 0x9fc4ff,
  fogNear: 100,
  fogFar: 128,
};

function makeItemTexture(layers = 2): THREE.DataArrayTexture {
  const size = 32;
  const data = new Uint8Array(size * size * 4 * layers);
  for (let layer = 0; layer < layers; layer++) {
    for (let i = 0; i < size * size; i++) {
      const offset = layer * size * size * 4 + i * 4;
      data[offset] = 40 + layer * 30;
      data[offset + 1] = 80;
      data[offset + 2] = 120;
      data[offset + 3] = 255;
    }
  }
  const texture = new THREE.DataArrayTexture(data, size, size, layers);
  texture.format = THREE.RGBAFormat;
  texture.type = THREE.UnsignedByteType;
  texture.magFilter = THREE.NearestFilter;
  texture.minFilter = THREE.NearestFilter;
  texture.needsUpdate = true;
  return texture;
}

describe('EntityRenderer (construction/sync smoke tests, no WebGL context)', () => {
  it('builds mob, item and arrow records and removes stale ones', () => {
    const scene = new THREE.Scene();
    const renderer = new EntityRenderer(scene, (tile) => (tile === 'stone' ? 3 : 0));
    expect(renderer.count).toBe(0);

    const mob = snapshot({ id: 1, kind: 'mob', type: 'zombie' });
    const item = itemSnapshot(2, 'bone');
    const arrow = snapshot({
      id: 3,
      kind: 'arrow',
      type: 'arrow',
      velocity: { x: 10, y: 0, z: 0 },
      position: { x: 2.5, y: 10.6, z: 0.5 },
      previousPosition: { x: 2.4, y: 10.6, z: 0.5 },
    });

    renderer.sync([mob, item, arrow], undefined, 0.5, ENVIRONMENT);
    expect(renderer.count).toBe(3);
    expect(scene.children).toContain(renderer.root);
    // Without an itemTexture the non-block drop is still a coloured mini cube.
    const fallbackItem = renderer.root.getObjectByName('item:bone');
    expect(fallbackItem).toBeDefined();
    expect(meshOf(fallbackItem!).geometry.getAttribute('position').count).toBe(24);

    // Walk / hurt / death animation values are accepted and stale records drop.
    renderer.sync(
      [{ ...mob, walkPhase: 1.2, hurtTime: 4, deathTime: 6, speed: 2.4, headYaw: 0.4 }],
      undefined,
      0.5,
    );
    expect(renderer.count).toBe(1);

    renderer.sync([], undefined, 1);
    expect(renderer.count).toBe(0);
    renderer.dispose();
    expect(scene.children).not.toContain(renderer.root);
  });

  it('instantiates a visible record for every mob type including creeper fuse', () => {
    const scene = new THREE.Scene();
    const renderer = new EntityRenderer(scene, () => 0, {
      shadows: true,
      skins: {
        zombie_head: (painter) => painter.fill('#3f7a3f'),
      },
    });
    const snapshots = MOB_TYPES.map((type, index) =>
      snapshot({
        id: index + 1,
        type,
        fuse: type === 'creeper' ? 21 : 0,
        fireTicks: type === 'skeleton' ? 5 : 0,
        position: { x: index * 2, y: 10, z: 0 },
        previousPosition: { x: index * 2 - 0.2, y: 10, z: 0 },
        shadowY: 10,
      }),
    );
    renderer.sync(snapshots, undefined, 1, ENVIRONMENT);
    expect(renderer.count).toBe(MOB_TYPES.length);
    renderer.dispose();
  });

  it('paints deterministic fallback skins', () => {
    const a = new PixelPainter(32, 32);
    const b = new PixelPainter(32, 32);
    paintFallbackMobTexture(a, 'zombie_head');
    paintFallbackMobTexture(b, 'zombie_head');
    expect([...a.data]).toEqual([...b.data]);
    // The head placeholder draws a face in the front-face UV region.
    expect(a.get(4, 6)[3]).toBe(255);
    const c = new PixelPainter(32, 32);
    paintFallbackMobTexture(c, 'zombie_head');
    expect([...a.data]).toEqual([...c.data]);
  });

  it('renders non-block drops as camera-facing item sprite billboards', () => {
    const scene = new THREE.Scene();
    const itemTexture = makeItemTexture(2);
    const renderer = new EntityRenderer(scene, () => 0, {
      itemTexture,
      itemLayerOf: (itemId) => (itemId === 'apple' ? 1 : itemId === 'bone' ? 0 : null),
    });
    const camera = new THREE.PerspectiveCamera();
    camera.position.set(0, 12, 4);
    camera.lookAt(1.5, 10.2, 1.5);

    renderer.sync(
      [
        itemSnapshot(10, 'apple'),
        itemSnapshot(13, 'bone'),
        itemSnapshot(11, 'oak_log'),
        itemSnapshot(12, 'mystery_drop'),
      ],
      camera,
      1,
      ENVIRONMENT,
    );
    expect(renderer.count).toBe(4);

    // Apple: 4-vertex billboard sampling itemTexture layer 1.
    const appleGroup = renderer.root.getObjectByName('item:apple');
    expect(appleGroup).toBeDefined();
    const appleMesh = meshOf(appleGroup!);
    expect(appleMesh.geometry.getAttribute('position').count).toBe(4);
    expect(appleMesh.geometry.getAttribute('aLayer').getX(0)).toBe(1);
    expect(appleMesh.material).toBeInstanceOf(THREE.ShaderMaterial);
    const appleMaterial = appleMesh.material as THREE.ShaderMaterial;
    expect(appleMaterial.transparent).toBe(true);
    expect(appleMaterial.alphaTest).toBeCloseTo(0.5);
    expect(appleMaterial.fragmentShader).toContain('discard');
    // Faces the camera exactly (billboard) and bobs above the snapshot feet Y.
    expect(appleGroup!.quaternion.angleTo(camera.quaternion)).toBeLessThan(1e-6);
    expect(appleGroup!.position.y).toBeGreaterThan(10.25);

    // Bone: sprite layer 0 comes from the resolver.
    const boneMesh = meshOf(renderer.root.getObjectByName('item:bone')!);
    expect(boneMesh.geometry.getAttribute('position').count).toBe(4);
    expect(boneMesh.geometry.getAttribute('aLayer').getX(0)).toBe(0);

    // Block items keep the mini-block mesh (BoxGeometry = 24 vertices).
    const logMesh = meshOf(renderer.root.getObjectByName('item:oak_log')!);
    expect(logMesh.geometry.getAttribute('position').count).toBe(24);

    // Unknown / unmapped non-block items fall back to the coloured cube.
    const unknownMesh = meshOf(renderer.root.getObjectByName('item:mystery_drop')!);
    expect(unknownMesh.geometry.getAttribute('position').count).toBe(24);

    renderer.dispose();
    itemTexture.dispose();
  });

  it('does not dispose the caller-owned item texture', () => {
    const scene = new THREE.Scene();
    const itemTexture = makeItemTexture(1);
    let disposed = false;
    itemTexture.addEventListener('dispose', () => {
      disposed = true;
    });
    const renderer = new EntityRenderer(scene, () => 0, {
      itemTexture,
      itemLayerOf: () => 0,
    });
    renderer.sync([itemSnapshot(1, 'apple')], undefined, 1, ENVIRONMENT);
    expect(renderer.count).toBe(1);
    renderer.dispose();
    expect(renderer.count).toBe(0);
    expect(disposed).toBe(false);
    expect(itemTexture.image).toBeDefined();
    itemTexture.dispose();
  });

  it('wires directly to the real ItemIconAtlas (game.ts integration shape)', () => {
    const scene = new THREE.Scene();
    const itemAtlas = new ItemIconAtlas(1);
    const renderer = new EntityRenderer(scene, () => 0, {
      itemTexture: itemAtlas.texture,
      itemLayerOf: (itemId) => itemAtlas.layerOf(itemId),
    });
    renderer.sync(
      [itemSnapshot(1, 'apple'), itemSnapshot(2, 'diamond_sword'), itemSnapshot(3, 'oak_log')],
      undefined,
      1,
      ENVIRONMENT,
    );
    expect(itemAtlas.hasItem('apple')).toBe(true);
    expect(itemAtlas.hasItem('diamond_sword')).toBe(true);
    const appleMesh = meshOf(renderer.root.getObjectByName('item:apple')!);
    const swordMesh = meshOf(renderer.root.getObjectByName('item:diamond_sword')!);
    expect(appleMesh.geometry.getAttribute('position').count).toBe(4);
    expect(swordMesh.geometry.getAttribute('position').count).toBe(4);
    expect(appleMesh.geometry.getAttribute('aLayer').getX(0)).toBe(itemAtlas.layerOf('apple'));
    expect(swordMesh.geometry.getAttribute('aLayer').getX(0)).toBe(
      itemAtlas.layerOf('diamond_sword'),
    );
    // Block items must stay mini blocks even when the item atlas is wired.
    expect(meshOf(renderer.root.getObjectByName('item:oak_log')!).geometry.getAttribute('position').count).toBe(24);
    renderer.dispose();
    itemAtlas.dispose();
  });
});
