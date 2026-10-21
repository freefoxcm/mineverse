import * as THREE from 'three';
import { PixelPainter } from '../art/pixels';
import { TILE_SIZE } from '../art/types';
import { TILES } from '../art/tiles';
import { BLOCKS, faceTexture } from '../world/blocks';

/** Texture tiles that are not referenced by a block but are needed by the engine. */
const EXTRA_TILES = Array.from({ length: 10 }, (_, i) => `crack_${i}`);

/**
 * Builds a WebGL2 texture array from procedural pixel art. One layer per tile,
 * so block faces never bleed into each other and each tile keeps its own mipmaps.
 */
export class TextureAtlas {
  readonly texture: THREE.DataArrayTexture;
  readonly layerCount: number;
  private readonly layerMap = new Map<string, number>();

  constructor(maxAnisotropy = 4) {
    const names = this.collectTileNames();
    this.layerCount = names.length;
    const pixelCount = TILE_SIZE * TILE_SIZE;
    const data = new Uint8Array(pixelCount * 4 * names.length);
    const painter = new PixelPainter(TILE_SIZE, TILE_SIZE);

    names.forEach((name, layer) => {
      this.layerMap.set(name, layer);
      painter.fill('rgba(0,0,0,0)');
      const paint = TILES[name];
      if (paint) {
        paint(painter);
      } else {
        painter.checker('#ff00ff', '#000000', 4);
        console.warn(`[atlas] missing tile painter: ${name}`);
      }
      data.set(painter.data, layer * pixelCount * 4);
    });

    const texture = new THREE.DataArrayTexture(data, TILE_SIZE, TILE_SIZE, names.length);
    texture.format = THREE.RGBAFormat;
    texture.type = THREE.UnsignedByteType;
    texture.magFilter = THREE.NearestFilter;
    texture.minFilter = THREE.NearestMipmapLinearFilter;
    texture.wrapS = THREE.ClampToEdgeWrapping;
    texture.wrapT = THREE.ClampToEdgeWrapping;
    texture.generateMipmaps = true;
    texture.colorSpace = THREE.NoColorSpace;
    texture.anisotropy = maxAnisotropy;
    texture.needsUpdate = true;
    this.texture = texture;
  }

  private collectTileNames(): string[] {
    const names = new Set<string>(EXTRA_TILES);
    for (const block of BLOCKS) {
      for (let face = 0; face < 6; face++) {
        names.add(faceTexture(block, face));
      }
    }
    return [...names].sort();
  }

  layerOf(tile: string): number {
    return this.layerMap.get(tile) ?? 0;
  }

  dispose(): void {
    this.texture.dispose();
  }
}
