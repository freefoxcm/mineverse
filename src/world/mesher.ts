/**
 * Section mesher (M1). Builds the opaque / cutout / transparent vertex layers for
 * one 16x16x16 section. The byte format is fixed by docs/CONTRACTS.md §3 and must
 * not change: positions/uvs/layers/lights(sky,block)/shades(AO*faceShade)/tints
 * plus 32-bit indices with the (0,1,2),(0,2,3) quad order.
 *
 * M1 additions over the M0 skeleton:
 *  - per-corner smooth lighting (average of the four cells touching the face corner)
 *  - per-corner ambient occlusion, combined with the face shade
 *  - face culling between opaque blocks and between same-type transparent blocks
 *  - cutout / transparent layering, cross plants, torch boxes, liquid surface height
 *
 * `meshSection` is a pure function of the `MeshContext`, so it runs both on the main
 * thread and inside the mesh worker with an identical result.
 */
import { CHUNK_SIZE, SECTION_SIZE, WORLD_HEIGHT } from '../core/config';
import { hash3i } from '../core/rng';
import { faceShade, faceTexture, getBlockDef, ALPHA_KIND, IS_OPAQUE, RENDER_KIND, type BlockDef } from './blocks';
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
  { normal: [1, 0, 0], p0: [1, 0, 1], u: [0, 0, -1], v: [0, 1, 0], shade: 0.58 },
  { normal: [-1, 0, 0], p0: [0, 0, 0], u: [0, 0, 1], v: [0, 1, 0], shade: 0.58 },
  { normal: [0, 1, 0], p0: [0, 1, 1], u: [1, 0, 0], v: [0, 0, -1], shade: 1.0 },
  { normal: [0, -1, 0], p0: [0, 0, 0], u: [1, 0, 0], v: [0, 0, 1], shade: 0.4 },
  { normal: [0, 0, 1], p0: [0, 0, 1], u: [1, 0, 0], v: [0, 1, 0], shade: 0.74 },
  { normal: [0, 0, -1], p0: [1, 0, 0], u: [-1, 0, 0], v: [0, 1, 0], shade: 0.74 },
];

const AO_SHADE = [0.32, 0.55, 0.78, 1.0];
const WHITE_TINT: [number, number, number] = [255, 255, 255];

/** Scratch buffers for the 3x3 light/AO plane around one face (reused per section). */
interface PlaneScratch {
  sky: Float32Array;
  block: Float32Array;
  opaque: Uint8Array;
}

function createPlaneScratch(): PlaneScratch {
  return { sky: new Float32Array(9), block: new Float32Array(9), opaque: new Uint8Array(9) };
}

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
    this.lights.push(lightBytes(sky), lightBytes(blockLight));
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
  return Math.max(0, Math.min(255, Math.round(level * 17)));
}

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
  const scratch = createPlaneScratch();
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
          addBox(ctx, scratch, builder, lx, ly, lz, wx, wy, wz, box, def, tint, false, false, false, true);
        } else if (render === 4) {
          const level = ctx.getMeta(wx, wy, wz) & 7;
          const above = ctx.getBlock(wx, wy + 1, wz);
          // A water block with water above must reach y=1 so a stacked column has no
          // gaps between the 0.89-high surface boxes.
          const connectedAbove = above === block;
          const height = connectedAbove ? 1 : level === 0 ? 0.89 : Math.max(0.12, 0.89 - level * 0.1);
          const box: Box = { minX: 0, minY: 0, minZ: 0, maxX: 1, maxY: height, maxZ: 1 };
          addBox(ctx, scratch, builder, lx, ly, lz, wx, wy, wz, box, def, tint, true, true, false);
        } else {
          const ao = ALPHA_KIND[block] !== 2;
          addBox(ctx, scratch, builder, lx, ly, lz, wx, wy, wz, CUBE, def, tint, true, false, ao);
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

/** True when the face between `def` and its neighbour should not be emitted. */
function cullFace(def: BlockDef, neighbour: number): boolean {
  if (IS_OPAQUE[neighbour]) return true;
  const self = def.numeric;
  // Same-type transparent blocks (glass/leaves/cactus/water) share no visible face.
  if (neighbour === self && ALPHA_KIND[self] !== 0) return true;
  return false;
}

function addBox(
  ctx: MeshContext,
  scratch: PlaneScratch,
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
  applyAo: boolean,
  skipBottomIfOpaque = false,
): void {
  const flatCube = box.minX === 0 && box.minY === 0 && box.minZ === 0 && box.maxX === 1 && box.maxY === 1 && box.maxZ === 1;
  const alpha = ALPHA_KIND[def.numeric];

  for (let face = 0; face < FACE_COUNT; face++) {
    const fd = FACES[face];
    const nx = wx + fd.normal[0];
    const ny = wy + fd.normal[1];
    const nz = wz + fd.normal[2];
    const neighbour = ctx.getBlock(nx, ny, nz);
    if (cullNeighbours && cullFace(def, neighbour)) continue;
    // Small boxes (torches) are flush with the floor only at their bottom face.
    if (skipBottomIfOpaque && face === 3 && IS_OPAQUE[neighbour]) continue;
    // Liquid faces are only visible against non-opaque, non-same-liquid cells.
    if (liquid && neighbour === def.numeric) continue;

    const tile = faceTexture(def, face);
    const layer = ctx.layerOf(tile);
    samplePlane(ctx, scratch, fd, nx, ny, nz);
    // Finished-colour art: biome tint only makes sense on grass tops (the sides
    // show dirt, which must stay brown next to untinted dirt blocks). Leaves and
    // plants still receive their mild foliage tint on every face.
    const faceTint = def.tint === 'grass' && face !== 2 ? WHITE_TINT : tint;
    // Subtle per-block tint jitter breaks the "one flat green sheet" look of large
    // grass/leaf areas without changing the palette.
    let jitteredTint = faceTint;
    if (faceTint !== WHITE_TINT) {
      const jitter = 0.95 + ((hash3i(0x7f4a7c15, wx, wy, wz) >>> 24) / 255) * 0.1;
      jitteredTint = [
        Math.min(255, Math.round(faceTint[0] * jitter)),
        Math.min(255, Math.round(faceTint[1] * jitter)),
        Math.min(255, Math.round(faceTint[2] * jitter)),
      ];
    }

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

    const corners: readonly [number, number][] = [
      [0, 0],
      [1, 0],
      [1, 1],
      [0, 1],
    ];
    const uvRotation =
      def.uvVary || (def.tint === 'grass' && (face === 2 || face === 3))
        ? hash3i(0x51ed270b, wx, wy * 3 + face, wz) & 3
        : 0;
    for (let c = 0; c < 4; c++) {
      const [du, dv] = corners[c];
      let uu = du;
      let vv = dv;
      if (uvRotation === 1) {
        uu = 1 - dv;
        vv = du;
      } else if (uvRotation === 2) {
        uu = 1 - du;
        vv = 1 - dv;
      } else if (uvRotation === 3) {
        uu = dv;
        vv = 1 - du;
      }
      const su = du === 1 ? 1 : -1;
      const sv = dv === 1 ? 1 : -1;
      const ao = applyAo && flatCube && alpha !== 2 ? cornerAo(scratch, su, sv) : 3;
      const [skyLevel, blockLevel] = cornerLight(scratch, su, sv);
      const shade = fd.shade * AO_SHADE[ao];
      const px = lx + p0[0] + uVec[0] * du + vVec[0] * dv;
      const py = ly + p0[1] + uVec[1] * du + vVec[1] * dv;
      const pz = lz + p0[2] + uVec[2] * du + vVec[2] * dv;
      builder.addVertex(px, py, pz, uu, vv, layer, skyLevel, blockLevel, shade, jitteredTint);
    }
    builder.addQuadIndices();
  }
}

/** Fill the 3x3 plane of light/opacity samples around a face's outward cell. */
function samplePlane(ctx: MeshContext, scratch: PlaneScratch, fd: FaceDef, nx: number, ny: number, nz: number): void {
  let index = 0;
  for (let sv = -1; sv <= 1; sv++) {
    for (let su = -1; su <= 1; su++) {
      const x = nx + fd.u[0] * su + fd.v[0] * sv;
      const y = ny + fd.u[1] * su + fd.v[1] * sv;
      const z = nz + fd.u[2] * su + fd.v[2] * sv;
      const block = ctx.getBlock(x, y, z);
      scratch.opaque[index] = IS_OPAQUE[block];
      scratch.sky[index] = ctx.getSkyLight(x, y, z);
      scratch.block[index] = ctx.getBlockLight(x, y, z);
      index++;
    }
  }
}

function planeIndex(su: number, sv: number): number {
  return (sv + 1) * 3 + (su + 1);
}

/**
 * Smooth light for one corner: average of the outward cell and the two edge cells
 * plus the diagonal cell, skipping opaque cells (they carry no light).
 */
function cornerLight(scratch: PlaneScratch, su: number, sv: number): [number, number] {
  const base = planeIndex(0, 0);
  const side1 = planeIndex(su, 0);
  const side2 = planeIndex(0, sv);
  const corner = planeIndex(su, sv);
  const side1Opaque = scratch.opaque[side1] === 1;
  const side2Opaque = scratch.opaque[side2] === 1;
  if (side1Opaque && side2Opaque) {
    return [scratch.sky[base], scratch.block[base]];
  }
  let sky = scratch.sky[base];
  let block = scratch.block[base];
  let count = 1;
  if (!side1Opaque) {
    sky += scratch.sky[side1];
    block += scratch.block[side1];
    count++;
  }
  if (!side2Opaque) {
    sky += scratch.sky[side2];
    block += scratch.block[side2];
    count++;
  }
  if (scratch.opaque[corner] === 0) {
    sky += scratch.sky[corner];
    block += scratch.block[corner];
    count++;
  }
  return [sky / count, block / count];
}

/** AO level 0..3 for a corner: 3 = open, 0 = fully enclosed. */
function cornerAo(scratch: PlaneScratch, su: number, sv: number): number {
  const side1 = scratch.opaque[planeIndex(su, 0)] === 1;
  const side2 = scratch.opaque[planeIndex(0, sv)] === 1;
  const corner = scratch.opaque[planeIndex(su, sv)] === 1;
  if (side1 && side2) return 0;
  return 3 - (Number(side1) + Number(side2) + Number(corner));
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
  const sky = ctx.getSkyLight(wx, wy, wz);
  const blockLight = ctx.getBlockLight(wx, wy, wz);
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
      const u = c === 1 || c === 2 ? 1 : 0;
      const v = c >= 2 ? 1 : 0;
      builder.addVertex(lx + p[0], ly + p[1], lz + p[2], u, v, layer, sky, blockLight, 1, tint);
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

/** True when a section contains at least one renderable (non-air) block. */
export function sectionHasBlocks(blocks: Uint8Array, sectionY: number): boolean {
  const start = sectionY * 16 * 256;
  const end = start + 16 * 256;
  for (let i = start; i < end; i++) {
    if (blocks[i] !== 0) return true;
  }
  return false;
}

export { faceShade };

