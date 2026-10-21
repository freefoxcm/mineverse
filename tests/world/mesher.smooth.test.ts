import { describe, expect, it } from 'vitest';
import { BLOCK, blockNumeric } from '../../src/world/blocks';
import { meshSection, type MeshContext, type MeshLayerData } from '../../src/world/mesher';

interface ContextOptions {
  readonly sky?: Map<string, number> | number;
  readonly blockLight?: Map<string, number> | number;
  readonly meta?: Map<string, number>;
  readonly layers?: Record<string, number>;
  readonly tint?: [number, number, number];
}

function makeContext(blocks: Map<string, number>, options: ContextOptions = {}): MeshContext {
  const sky = options.sky ?? 15;
  const blockLight = options.blockLight ?? 0;
  const meta = options.meta;
  const tint = options.tint ?? [255, 255, 255];
  return {
    getBlock: (x, y, z) => blocks.get(`${x},${y},${z}`) ?? 0,
    getMeta: (x, y, z) => meta?.get(`${x},${y},${z}`) ?? 0,
    getSkyLight: (x, y, z) => (typeof sky === 'number' ? sky : (sky.get(`${x},${y},${z}`) ?? 0)),
    getBlockLight: (x, y, z) => (typeof blockLight === 'number' ? blockLight : (blockLight.get(`${x},${y},${z}`) ?? 0)),
    layerOf: (tile) => options.layers?.[tile] ?? 0,
    tintOf: () => tint,
  };
}

function vertices(layer: MeshLayerData | null): number {
  return layer ? layer.positions.length / 3 : 0;
}

function skyBytes(layer: MeshLayerData): number[] {
  const result: number[] = [];
  for (let i = 0; i < layer.lights.length; i += 2) result.push(layer.lights[i]);
  return result;
}

function maxY(layer: MeshLayerData): number {
  let max = -Infinity;
  for (let i = 1; i < layer.positions.length; i += 3) max = Math.max(max, layer.positions[i]);
  return max;
}

function minY(layer: MeshLayerData): number {
  let min = Infinity;
  for (let i = 1; i < layer.positions.length; i += 3) min = Math.min(min, layer.positions[i]);
  return min;
}

describe('smooth lighting', () => {
  it('averages the four cells touching a face corner', () => {
    const blocks = new Map([['5,5,5', BLOCK.stone]]);
    const sky = new Map<string, number>();
    // Outward cell of the -Z face and the three neighbours around one corner are dim;
    // the corner light must be their average (15 + 3 + 3 + 3) / 4 = 6 -> 102.
    sky.set('5,5,4', 15);
    for (let dx = 4; dx <= 6; dx++) {
      for (let dy = 4; dy <= 6; dy++) {
        for (let dz = 4; dz <= 6; dz++) {
          const key = `${dx},${dy},${dz}`;
          if (key === '5,5,4') continue;
          sky.set(key, 3);
        }
      }
    }
    const data = meshSection(makeContext(blocks, { sky }), 0, 0, 0);
    // -Z face is the 6th face; all four corner vertices share the same blend here.
    const values = skyBytes(data.opaque!);
    expect(values.length).toBe(24);
    const negativeZ = values.slice(20, 24);
    for (const value of negativeZ) expect(value).toBe(102);
  });

  it('keeps 255 when the whole neighbourhood is fully lit', () => {
    const blocks = new Map([['5,5,5', BLOCK.stone]]);
    const data = meshSection(makeContext(blocks, { sky: 15 }), 0, 0, 0);
    for (const value of skyBytes(data.opaque!)) expect(value).toBe(255);
  });

  it('uses the face cell only when both side cells are opaque', () => {
    // Only the block at (0,0,0) is inside the section; the AO/light samples sit in the
    // neighbouring section and are therefore not emitted as their own geometry.
    const blocks = new Map<string, number>([
      ['0,0,0', BLOCK.stone],
      ['1,0,-1', BLOCK.stone],
      ['0,-1,-1', BLOCK.stone],
      ['1,-1,-1', BLOCK.stone],
    ]);
    const sky = new Map<string, number>([['0,0,-1', 15]]);
    const data = meshSection(makeContext(blocks, { sky }), 0, 0, 0);
    const values = skyBytes(data.opaque!);
    // First corner of the -Z face has both sides blocked: it reads the face cell (255).
    expect(values[20]).toBe(255);
    expect(values.slice(20, 24).some((value) => value < 255)).toBe(true);
  });
});

describe('ambient occlusion', () => {
  it('darkens corners that are enclosed by opaque blocks', () => {
    const blocks = new Map<string, number>([
      ['0,0,0', BLOCK.stone],
      ['1,0,-1', BLOCK.stone],
      ['0,-1,-1', BLOCK.stone],
      ['1,-1,-1', BLOCK.stone],
    ]);
    const data = meshSection(makeContext(blocks), 0, 0, 0);
    const layer = data.opaque!;
    // First corner of the -Z face is fully enclosed -> AO 0, face shade 0.8 => 92.
    expect(layer.shades[20]).toBe(Math.round(0.8 * 0.45 * 255));
    // The unoccluded +Y face keeps full brightness.
    expect(Math.max(...layer.shades)).toBe(255);
  });

  it('leaves a lone cube with uniform face shading', () => {
    const blocks = new Map([['5,5,5', BLOCK.stone]]);
    const data = meshSection(makeContext(blocks), 0, 0, 0);
    const opaques = data.opaque!;
    const perFace = new Set<number>();
    for (let vertex = 0; vertex < opaques.shades.length; vertex++) perFace.add(opaques.shades[vertex]);
    // +X/-X = .62, +Y = 1, -Y = .48, +Z/-Z = .8
    expect([...perFace].sort((a, b) => a - b)).toEqual([
      Math.round(0.48 * 255),
      Math.round(0.62 * 255),
      Math.round(0.8 * 255),
      255,
    ]);
  });
});

describe('layer separation and culling', () => {
  it('culls shared faces between same-type cutout blocks (glass/leaves)', () => {
    for (const block of [blockNumeric('glass'), BLOCK.oak_leaves]) {
      const blocks = new Map<string, number>([
        ['5,5,5', block],
        ['6,5,5', block],
      ]);
      const data = meshSection(makeContext(blocks), 0, 0, 0);
      // 12 faces - 2 shared = 10 faces = 40 vertices.
      expect(vertices(data.cutout)).toBe(40);
      expect(data.opaque).toBeNull();
    }
  });

  it('culls shared faces between water cells and keeps water in the transparent layer', () => {
    const blocks = new Map<string, number>([
      ['5,5,5', BLOCK.water],
      ['6,5,5', BLOCK.water],
    ]);
    const data = meshSection(makeContext(blocks), 0, 0, 0);
    expect(data.opaque).toBeNull();
    expect(data.cutout).toBeNull();
    expect(vertices(data.transparent)).toBe(40);
  });

  it('keeps faces between different transparent block types', () => {
    const blocks = new Map<string, number>([
      ['5,5,5', BLOCK.water],
      ['6,5,5', blockNumeric('glass')],
    ]);
    const data = meshSection(makeContext(blocks), 0, 0, 0);
    expect(vertices(data.transparent)).toBeGreaterThan(0);
    expect(vertices(data.cutout)).toBeGreaterThan(0);
  });

  it('culls an opaque face against water but keeps the water side', () => {
    const blocks = new Map<string, number>([
      ['5,5,5', BLOCK.stone],
      ['6,5,5', BLOCK.water],
    ]);
    const data = meshSection(makeContext(blocks), 0, 0, 0);
    expect(vertices(data.opaque)).toBe(24);
    expect(vertices(data.transparent)).toBeGreaterThan(0);
  });

  it('culls faces against blocks in a neighbouring section', () => {
    const blocks = new Map<string, number>([
      ['0,5,0', BLOCK.stone],
      ['-1,5,0', BLOCK.stone],
    ]);
    const data = meshSection(makeContext(blocks), 0, 0, 0);
    expect(vertices(data.opaque)).toBe(20); // one face hidden across the section border
  });
});

describe('liquid, torch and cross geometry', () => {
  it('renders a lone water source at 0.89 height', () => {
    const blocks = new Map([['5,5,5', BLOCK.water]]);
    const data = meshSection(makeContext(blocks), 0, 0, 0);
    expect(maxY(data.transparent!)).toBeCloseTo(5.89, 5);
    expect(minY(data.transparent!)).toBeCloseTo(5, 5);
  });

  it('makes stacked water reach the next block so the column is seamless', () => {
    const blocks = new Map<string, number>([
      ['5,5,5', BLOCK.water],
      ['5,6,5', BLOCK.water],
    ]);
    const data = meshSection(makeContext(blocks), 0, 0, 0);
    // Lower water block spans y=5..6 because water is above it.
    const positions = data.transparent!.positions;
    let foundFullBlockSide = false;
    for (let i = 1; i < positions.length; i += 3) {
      if (Math.abs(positions[i] - 6) < 1e-6) foundFullBlockSide = true;
    }
    expect(foundFullBlockSide).toBe(true);
    expect(maxY(data.transparent!)).toBeCloseTo(6.89, 5);
  });

  it('renders liquid flow level from meta as a lower surface', () => {
    const blocks = new Map([['5,5,5', BLOCK.water]]);
    const meta = new Map([['5,5,5', 3]]);
    const data = meshSection(makeContext(blocks, { meta }), 0, 0, 0);
    expect(maxY(data.transparent!)).toBeCloseTo(5.59, 5);
  });

  it('builds the torch as a small cutout box', () => {
    const blocks = new Map([['5,5,5', BLOCK.torch]]);
    const data = meshSection(makeContext(blocks), 0, 0, 0);
    expect(data.opaque).toBeNull();
    const torch = data.cutout!;
    expect(vertices(torch)).toBe(24);
    expect(minY(torch)).toBeCloseTo(5, 5);
    expect(maxY(torch)).toBeCloseTo(5 + 10 / 16, 5);
    for (let i = 0; i < torch.positions.length; i += 3) {
      expect(torch.positions[i]).toBeGreaterThanOrEqual(5 + 7 / 16 - 1e-6);
      expect(torch.positions[i]).toBeLessThanOrEqual(5 + 9 / 16 + 1e-6);
    }
  });

  it('applies the biome tint to cross plants', () => {
    const blocks = new Map([['5,5,5', blockNumeric('tall_grass')]]);
    const tint: [number, number, number] = [12, 34, 56];
    const data = meshSection(makeContext(blocks, { tint }), 0, 0, 0);
    const layer = data.cutout!;
    expect(vertices(layer)).toBe(8);
    for (let i = 0; i < layer.tints.length; i += 3) {
      expect([layer.tints[i], layer.tints[i + 1], layer.tints[i + 2]]).toEqual(tint);
    }
  });
});

describe('face uv / layer mapping', () => {
  it('maps each grass face to its tile layer', () => {
    const blocks = new Map([['5,5,5', BLOCK.grass_block]]);
    const layers = { grass_top: 7, grass_side: 8, dirt: 9 };
    const data = meshSection(makeContext(blocks, { layers }), 0, 0, 0);
    const layer = data.opaque!;
    const used = new Set<number>();
    for (const value of layer.layers) used.add(value);
    expect([...used].sort((a, b) => a - b)).toEqual([7, 8, 9]);
    // Face order is +X -X +Y -Y +Z -Z; +Y (top) is the third face -> layer 7.
    expect(layer.layers[8]).toBe(7);
    expect(layer.layers[12]).toBe(9); // -Y bottom -> dirt
  });

  it('emits quad uvs in p0(0,0) p1(1,0) p2(1,1) p3(0,1) order', () => {
    const blocks = new Map([['5,5,5', BLOCK.stone]]);
    const data = meshSection(makeContext(blocks), 0, 0, 0);
    const uvs = data.opaque!.uvs;
    const top = uvs.slice(16, 24); // third face, four vertices -> 8 values
    expect([...top]).toEqual([0, 0, 1, 0, 1, 1, 0, 1]);
  });
});


