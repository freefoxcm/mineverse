import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { PixelPainter } from '../../src/art/pixels';
import { MOB_TYPES } from '../../src/entities/models';
import type { EntitySnapshot } from '../../src/entities/snapshot';
import { EntityRenderer, paintFallbackMobTexture } from '../../src/render/entityRenderer';

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

const ENVIRONMENT = {
  daylight: 1,
  fogColor: 0x9fc4ff,
  fogNear: 100,
  fogFar: 128,
};

describe('EntityRenderer (construction/sync smoke tests, no WebGL context)', () => {
  it('builds mob, item and arrow records and removes stale ones', () => {
    const scene = new THREE.Scene();
    const renderer = new EntityRenderer(scene, (tile) => (tile === 'stone' ? 3 : 0));
    expect(renderer.count).toBe(0);

    const mob = snapshot({ id: 1, kind: 'mob', type: 'zombie' });
    const item = snapshot({
      id: 2,
      kind: 'item',
      type: 'bone',
      item: { item: 'bone', count: 2 },
      position: { x: 1.5, y: 10.2, z: 1.5 },
      previousPosition: { x: 1.5, y: 10.2, z: 1.5 },
    });
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
});
