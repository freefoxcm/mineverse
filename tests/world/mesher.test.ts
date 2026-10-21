import { describe, expect, it } from 'vitest';
import { meshSection, type MeshContext, type MeshLayerData } from '../../src/world/mesher';
import { BLOCK } from '../../src/world/blocks';

function makeContext(blocks: Map<string, number>, sky = 15): MeshContext {
  return {
    getBlock: (x, y, z) => blocks.get(`${x},${y},${z}`) ?? 0,
    getMeta: () => 0,
    getSkyLight: () => sky,
    getBlockLight: () => 0,
    layerOf: () => 3,
    tintOf: () => [255, 255, 255],
  };
}

function vertexCount(layer: MeshLayerData | null): number {
  return layer ? layer.positions.length / 3 : 0;
}

describe('mesher', () => {
  it('a lone cube emits six faces (24 vertices, 36 indices)', () => {
    const blocks = new Map([['5,5,5', BLOCK.stone]]);
    const data = meshSection(makeContext(blocks), 0, 0, 0);
    expect(vertexCount(data.opaque)).toBe(24);
    expect(data.opaque!.indices.length).toBe(36);
    expect(data.cutout).toBeNull();
    expect(data.transparent).toBeNull();
  });

  it('two adjacent cubes cull the shared face', () => {
    const blocks = new Map([
      ['5,5,5', BLOCK.stone],
      ['6,5,5', BLOCK.stone],
    ]);
    const data = meshSection(makeContext(blocks), 0, 0, 0);
    expect(vertexCount(data.opaque)).toBe(40);
  });

  it('culls faces against opaque neighbours but not air', () => {
    const blocks = new Map([['5,5,5', BLOCK.stone]]);
    const data = meshSection(makeContext(blocks), 0, 0, 0);
    // All six sides see air, so all render.
    expect(data.opaque!.indices.length / 6).toBe(6);
  });

  it('puts alpha-tested blocks in the cutout layer', () => {
    const blocks = new Map([['5,5,5', BLOCK.oak_leaves]]);
    const data = meshSection(makeContext(blocks), 0, 0, 0);
    expect(data.opaque).toBeNull();
    expect(vertexCount(data.cutout)).toBe(24);
  });

  it('puts water in the transparent layer', () => {
    const blocks = new Map([['5,5,5', BLOCK.water]]);
    const data = meshSection(makeContext(blocks), 0, 0, 0);
    expect(data.opaque).toBeNull();
    expect(vertexCount(data.transparent)).toBeGreaterThan(0);
  });

  it('plants use cross geometry in the cutout layer', () => {
    const blocks = new Map([['5,5,5', BLOCK.tall_grass]]);
    const data = meshSection(makeContext(blocks), 0, 0, 0);
    // Two crossing quads (4 vertices each), rendered double-sided.
    expect(vertexCount(data.cutout)).toBe(8);
    expect(data.cutout!.indices.length).toBe(12);
  });

  it('bakes light bytes scaled to 0..255', () => {
    const blocks = new Map([['5,5,5', BLOCK.stone]]);
    const data = meshSection(makeContext(blocks, 15), 0, 0, 0);
    for (let i = 0; i < data.opaque!.lights.length; i += 2) {
      expect(data.opaque!.lights[i]).toBe(255);
      expect(data.opaque!.lights[i + 1]).toBe(0);
    }
  });

  it('emits nothing for an empty section', () => {
    const data = meshSection(makeContext(new Map()), 3, 2, 1);
    expect(data.opaque).toBeNull();
    expect(data.cutout).toBeNull();
    expect(data.transparent).toBeNull();
  });
});
