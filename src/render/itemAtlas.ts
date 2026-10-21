import * as THREE from 'three';
import { PixelPainter } from '../art/pixels';
import { ITEM_ICON_NAMES, paintItemIcon } from '../art/items';
import { allItems } from '../world/items';

const ICON_SIZE = 32;

/**
 * Texture array for item sprites (held item + future UI textures).
 * Built from Art-E's procedural `src/art/items.ts` painters.
 */
export class ItemIconAtlas {
  readonly texture: THREE.DataArrayTexture;
  private readonly layerMap = new Map<string, number>();
  private readonly fallbackLayer: number;

  constructor(maxAnisotropy = 4) {
    const painterNames = new Set(ITEM_ICON_NAMES);
    const ids = allItems()
      .filter((item) => item.icon === 'sprite' && painterNames.has(item.id))
      .map((item) => item.id)
      .sort();
    const layers = ids.length + 1;
    const data = new Uint8Array(ICON_SIZE * ICON_SIZE * 4 * layers);
    const painter = new PixelPainter(ICON_SIZE, ICON_SIZE);
    let layer = 0;
    for (const id of ids) {
      this.layerMap.set(id, layer);
      painter.fill('rgba(0,0,0,0)');
      if (!paintItemIcon(id, painter)) painter.checker('#ff00ff', '#1a1a1a', 4);
      data.set(painter.data, layer * ICON_SIZE * ICON_SIZE * 4);
      layer++;
    }
    // Missing-icon fallback tile (dark grey cross).
    painter.fill('rgba(0,0,0,0)');
    painter.checker('#6a6a6a', '#3a3a3a', 8);
    data.set(painter.data, layer * ICON_SIZE * ICON_SIZE * 4);
    this.fallbackLayer = layer;

    const texture = new THREE.DataArrayTexture(data, ICON_SIZE, ICON_SIZE, layers);
    texture.format = THREE.RGBAFormat;
    texture.type = THREE.UnsignedByteType;
    texture.magFilter = THREE.NearestFilter;
    texture.minFilter = THREE.NearestMipmapNearestFilter;
    texture.wrapS = THREE.ClampToEdgeWrapping;
    texture.wrapT = THREE.ClampToEdgeWrapping;
    texture.generateMipmaps = true;
    texture.colorSpace = THREE.NoColorSpace;
    texture.anisotropy = maxAnisotropy;
    texture.needsUpdate = true;
    this.texture = texture;
  }

  layerOf(itemId: string): number {
    return this.layerMap.get(itemId) ?? this.fallbackLayer;
  }

  hasItem(itemId: string): boolean {
    return this.layerMap.has(itemId);
  }

  get layerCount(): number {
    return this.layerMap.size + 1;
  }

  dispose(): void {
    this.texture.dispose();
  }
}
