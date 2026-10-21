import { CHUNK_SIZE, SECTION_SIZE, WORLD_HEIGHT } from '../core/config';
import { faceShade, faceTexture, getBlockDef, IS_OPAQUE, RENDER_KIND, ALPHA_KIND, type BlockDef } from './blocks';
import { localIndex, type ChunkColumn } from './chunk';

export interface MeshLayerData {
  positions: Float32Array;
  uvs: Float32Array;
  layers: Uint16Array;
  /** Two bytes per vertex: sky light, block light (0..15 scaled by 17). */
  lights: Uint8Array;
  /** One byte per vertex: AO * face shade, 255 = full brightness. */
  shades: Uint8Array;
  /** Three bytes per vertex: RGB tint, 255 = untinted. */
  tints: Uint8Array;
  indices: Uint32Array;
}

export interface SectionMeshData {
  opaque: MeshLayerData | null;
  cutout: MeshLayerData | null;
  transparent: MeshLayerData | null;
}

export interface MeshContext {
  getBlock(x: number, y: number, z: number): number;
  getMeta(x: number, y: number, z: number): number;
  getSkyLight(x: number, y: number, z: number): number;
  getBlockLight(x: number, y: number, z: number): number;
  layerOf(tile: string): number;
  /** RGB tint bytes 0..255 for a block position. */
  tintOf(blockId: number, x: number, z: number): [number, number, number];
}

const FACE_COUNT = 6;

interface FaceDef {
  normal: readonly [number, number, number];
  p0: readonly [number, number, number];
  u: readonly [number, number, number];
  v: readonly [number, number, number];
  shade: number;
}

/** Face order: +X -X +Y -Y +Z -Z. */
const FACES: readonly FaceDef[] = [
  { normal: [1, 0, 0], p0: [1, 0, 1], u: [0, 0, -1], v: [0, 1, 0], shade: 0.62 },
  { normal: [-1, 0, 0], p0: [0, 0, 0], u: [0, 0, 1], v: [0, 1, 0], shade: 0.62 },
  { normal: [0, 1, 0], p0: [0, 1, 1], u: [1, 0, 0], v: [0, 0, -1], shade: 1.0 },
  { normal: [0, -1, 0], p0: [0, 0, 0], u: [1, 0, 0], v: [0, 0, 1], shade: 0.48 },
  { normal: [0, 0, 1], p0: [0, 0, 1], u: [1, 0, 0], v: [0, 1, 0], shade: 0.8 },
  { normal: [0, 0, -1], p0: [1, 0, 0], u: [-1, 0, 0], v: [0, 1, 0], shade: 0.8 },
];

const AO_SHADE = [0.45, 0.62, 0.8, 1.0];

class LayerBuilder {
  positions: number[] = [];
  uvs: number[] = [];
  layers: number[] = [];
  lights: number[] = [];
  shades: number[] = [];
  tints: number[] = [];
  indices: number[] = [];
  private vertexCount = 0;

  addVertex(
    x: number,
    y: number,
    z: number,
    u: number,
    v: number,
    layer: number,
    sky: number,
    blockLight: number,
    shade: number,
    tint: readonly [number, number, number],
  ): void {
    this.positions.push(x, y, z);
    this.uvs.push(u, v);
    this.layers.push(layer);
    this.lights.push(sky, blockLight);
    this.shades.push(Math.max(0, Math.min(255, Math.round(shade * 255))));
    this.tints.push(tint[0], tint[1], tint[2]);
    this.vertexCount++;
  }

  addQuadIndices(): void {
    const base = this.vertexCount - 4;
    this.indices.push(base, base + 1, base + 2, base, base + 2, base + 3);
  }

  isEmpty(): boolean {
    return this.vertexCount === 0;
  }

  build(): MeshLayerData | null {
    if (this.vertexCount === 0) return null;
    return {
      positions: new Float32Array(this.positions),
      uvs: new Float32Array(this.uvs),
      layers: new Uint16Array(this.layers),
      lights: new Uint8Array(this.lights),
      shades: new Uint8Array(this.shades),
      tints: new Uint8Array(this.tints),
      indices: new Uint32Array(this.indices),
    };
  }
}

interface Builders {
  opaque: LayerBuilder;
  cutout: LayerBuilder;
  transparent: LayerBuilder;
}

function builderFor(blockId: number, builders: Builders): LayerBuilder {
  const alpha = ALPHA_KIND[blockId];
  if (alpha === 0) return builders.opaque;
  if (alpha === 1) return builders.cutout;
  return builders.transparent;
}

function lightBytes(level: number): number {
  return Math.max(0, Math.min(255, level * 17));
}

const WHITE_TINT: [number, number, number] = [255, 255, 255];

interface Box {
  minX: number;
  minY: number;
  minZ: number;
  maxX: number;
  maxY: number;
  maxZ: number;
}

const CUBE: Box = { minX: 0, minY: 0, minZ: 0, maxX: 1, maxY: 1, maxZ: 1 };

/**
 * Builds one 16^3 section mesh. Pure function of the world view, usable from a
 * worker once the neighbour data is provided by the caller.
 */
export function meshSection(ctx: MeshContext, cx: number, cy: number, cz: number): SectionMeshData {
  const builders: Builders = {
    opaque: new LayerBuilder(),
    cutout: new LayerBuilder(),
    transparent: new LayerBuilder(),
  };
  const baseX = cx * CHUNK_SIZE;
  const baseY = cy * SECTION_SIZE;
  const baseZ = cz * CHUNK_SIZE;

  for (let ly = 0; ly < SECTION_SIZE; ly++) {
    const wy = baseY + ly;
    if (wy < 0 || wy >= WORLD_HEIGHT) continue;
    for (let lz = 0; lz < SECTION_SIZE; lz++) {
      const wz = baseZ + lz;
      for (let lx = 0; lx < SECTION_SIZE; lx++) {
        const wx = baseX + lx;
        const block = ctx.getBlock(wx, wy, wz);
        if (block === 0) continue;
        const def = getBlockDef(block);
        const render = RENDER_KIND[block];
        if (render === 0) continue;
        const tint = def.tint ? ctx.tintOf(block, wx, wz) : WHITE_TINT;
        const builder = builderFor(block, builders);

        if (render === 2) {
          addCross(ctx, builder, lx, ly, lz, wx, wy, wz, def, tint);
        } else if (render === 3) {
          const box: Box = { minX: 7 / 16, minY: 0, minZ: 7 / 16, maxX: 9 / 16, maxY: 10 / 16, maxZ: 9 / 16 };
          addBox(ctx, builder, lx, ly, lz, wx, wy, wz, box, def, tint, false, false);
        } else if (render === 4) {
          const level = ctx.getMeta(wx, wy, wz) & 7;
          const height = level === 0 ? 0.89 : Math.max(0.12, 0.89 - level * 0.1);
          const box: Box = { minX: 0, minY: 0, minZ: 0, maxX: 1, maxY: height, maxZ: 1 };
          addBox(ctx, builder, lx, ly, lz, wx, wy, wz, box, def, tint, true, true);
        } else {
          addBox(ctx, builder, lx, ly, lz, wx, wy, wz, CUBE, def, tint, true, true);
        }
      }
    }
  }

  return {
    opaque: builders.opaque.build(),
    cutout: builders.cutout.build(),
    transparent: builders.transparent.build(),
  };
}

function addBox(
  ctx: MeshContext,
  builder: LayerBuilder,
  lx: number,
  ly: number,
  lz: number,
  wx: number,
  wy: number,
  wz: number,
  box: Box,
  def: BlockDef,
  tint: readonly [number, number, number],
  cullNeighbours: boolean,
  liquid: boolean,
): void {
  const flatCube = box.minX === 0 && box.minY === 0 && box.minZ === 0 && box.maxX === 1 && box.maxY === 1 && box.maxZ === 1;
  const ops: number[] = [box.minX, box.minY, box.minZ, box.maxX, box.maxY, box.maxZ];

  for (let face = 0; face < FACE_COUNT; face++) {
    const fd = FACES[face];
    const nx = wx + fd.normal[0];
    const ny = wy + fd.normal[1];
    const nz = wz + fd.normal[2];
    const neighbour = ctx.getBlock(nx, ny, nz);

    if (cullNeighbours) {
      if (IS_OPAQUE[neighbour]) continue;
      if (liquid && (neighbour === def.numeric || neighbour === 0)) {
        // keep liquid faces against air, cull between liquid cells
        if (neighbour === def.numeric) continue;
      } else if (!liquid && ALPHA_KIND[def.numeric] !== 0 && neighbour === def.numeric) {
        continue;
      }
    }

    const sky = lightBytes(ctx.getSkyLight(nx, ny, nz));
    const blockLight = lightBytes(ctx.getBlockLight(nx, ny, nz));
    const tile = faceTexture(def, face);
    const layer = ctx.layerOf(tile);

    const p0: [number, number, number] = [
      fd.p0[0] === 1 ? box.maxX : box.minX,
      fd.p0[1] === 1 ? box.maxY : box.minY,
      fd.p0[2] === 1 ? box.maxZ : box.minZ,
    ];
    const uVec: [number, number, number] = [
      fd.u[0] * (box.maxX - box.minX),
      fd.u[1] * (box.maxY - box.minY),
      fd.u[2] * (box.maxZ - box.minZ),
    ];
    const vVec: [number, number, number] = [
      fd.v[0] * (box.maxX - box.minX),
      fd.v[1] * (box.maxY - box.minY),
      fd.v[2] * (box.maxZ - box.minZ),
    ];

    const ao: number[] = [3, 3, 3, 3];
    if (flatCube && ALPHA_KIND[def.numeric] === 0) {
      for (let corner = 0; corner < 4; corner++) {
        const du = corner === 1 || corner === 2 ? 1 : -1;
        const dv = corner === 2 || corner === 3 ? 1 : -1;
        const ax = fd.u[0] * du;
        const ay = fd.u[1] * du;
        const az = fd.u[2] * du;
        const bx = fd.v[0] * dv;
        const by = fd.v[1] * dv;
        const bz = fd.v[2] * dv;
        const side1 = IS_OPAQUE[ctx.getBlock(nx + ax, ny + ay, nz + az)] === 1;
        const side2 = IS_OPAQUE[ctx.getBlock(nx + bx, ny + by, nz + bz)] === 1;
        const cornerBlocked = IS_OPAQUE[ctx.getBlock(nx + ax + bx, ny + ay + by, nz + az + bz)] === 1;
        ao[corner] = side1 && side2 ? 0 : 3 - (Number(side1) + Number(side2) + Number(cornerBlocked));
      }
    }

    const corners: readonly [number, number][] = [
      [0, 0],
      [1, 0],
      [1, 1],
      [0, 1],
    ];
    for (let c = 0; c < 4; c++) {
      const [du, dv] = corners[c];
      const px = lx + p0[0] + uVec[0] * du + vVec[0] * dv;
      const py = ly + p0[1] + uVec[1] * du + vVec[1] * dv;
      const pz = lz + p0[2] + uVec[2] * du + vVec[2] * dv;
      const shade = fd.shade * AO_SHADE[ao[c]];
      builder.addVertex(px, py, pz, du, dv, layer, sky, blockLight, shade, tint);
    }
    builder.addQuadIndices();
  }
}

function addCross(
  ctx: MeshContext,
  builder: LayerBuilder,
  lx: number,
  ly: number,
  lz: number,
  wx: number,
  wy: number,
  wz: number,
  def: BlockDef,
  tint: readonly [number, number, number],
): void {
  const sky = lightBytes(ctx.getSkyLight(wx, wy, wz));
  const blockLight = lightBytes(ctx.getBlockLight(wx, wy, wz));
  const layer = ctx.layerOf(faceTexture(def, 2));
  const lo = 0.15;
  const hi = 0.85;

  const quads: readonly (readonly [number, number, number][])[] = [
    [
      [lo, 0, lo],
      [hi, 0, hi],
      [hi, 1, hi],
      [lo, 1, lo],
    ],
    [
      [lo, 0, hi],
      [hi, 0, lo],
      [hi, 1, lo],
      [lo, 1, hi],
    ],
  ];

  for (const quad of quads) {
    for (let c = 0; c < 4; c++) {
      const p = quad[c];
      builder.addVertex(lx + p[0], ly + p[1], lz + p[2], c === 1 || c === 2 ? 1 : 0, c >= 2 ? 1 : 0, layer, sky, blockLight, 1, tint);
    }
    builder.addQuadIndices();
  }
}

/** Convenience wrapper: build a whole column, section by section. */
export function meshColumn(ctx: MeshContext, column: ChunkColumn): SectionMeshData[] {
  const result: SectionMeshData[] = [];
  for (let section = 0; section < WORLD_HEIGHT / SECTION_SIZE; section++) {
    result.push(meshSection(ctx, column.cx, section, column.cz));
  }
  return result;
}

export { faceShade };
