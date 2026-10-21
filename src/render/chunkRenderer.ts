import * as THREE from 'three';
import type { MeshLayerData, SectionMeshData } from '../world/mesher';
import type { TerrainMaterials } from './terrainMaterial';

interface SectionRecord {
  meshes: THREE.Mesh[];
  version: number;
}

function buildGeometry(data: MeshLayerData): THREE.BufferGeometry {
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(data.positions, 3));
  geometry.setAttribute('aUv', new THREE.BufferAttribute(data.uvs, 2));
  geometry.setAttribute('aLayer', new THREE.BufferAttribute(data.layers, 1));
  geometry.setAttribute('aLight', new THREE.BufferAttribute(data.lights, 2, true));
  geometry.setAttribute('aShade', new THREE.BufferAttribute(data.shades, 1, true));
  geometry.setAttribute('aTint', new THREE.BufferAttribute(data.tints, 3, true));
  geometry.setIndex(new THREE.BufferAttribute(data.indices, 1));
  geometry.computeBoundingSphere();
  return geometry;
}

/** Owns the GPU geometry for every loaded chunk section. */
export class ChunkRenderer {
  readonly root = new THREE.Group();
  private readonly records = new Map<string, SectionRecord>();

  constructor(scene: THREE.Scene, private readonly materials: TerrainMaterials) {
    scene.add(this.root);
  }

  get meshCount(): number {
    let count = 0;
    for (const record of this.records.values()) count += record.meshes.length;
    return count;
  }

  get sectionCount(): number {
    return this.records.size;
  }

  setSection(cx: number, cy: number, cz: number, data: SectionMeshData, version: number): void {
    const key = `${cx},${cy},${cz}`;
    const previous = this.records.get(key);
    if (previous && previous.version > version) return;
    if (previous) this.disposeRecord(key, previous);

    const meshes: THREE.Mesh[] = [];
    const layers: Array<[MeshLayerData | null, THREE.Material]> = [
      [data.opaque, this.materials.opaque],
      [data.cutout, this.materials.cutout],
      [data.transparent, this.materials.transparent],
    ];
    for (const [layerData, material] of layers) {
      if (!layerData) continue;
      const mesh = new THREE.Mesh(buildGeometry(layerData), material);
      mesh.position.set(cx * 16, cy * 16, cz * 16);
      mesh.matrixAutoUpdate = false;
      mesh.updateMatrix();
      this.root.add(mesh);
      meshes.push(mesh);
    }
    if (meshes.length > 0) {
      this.records.set(key, { meshes, version });
    }
  }

  removeSection(cx: number, cy: number, cz: number): void {
    const key = `${cx},${cy},${cz}`;
    const record = this.records.get(key);
    if (record) this.disposeRecord(key, record);
  }

  removeColumn(cx: number, cz: number): void {
    for (const key of [...this.records.keys()]) {
      const [rx, ry, rz] = key.split(',').map(Number);
      if (rx === cx && rz === cz) {
        const record = this.records.get(key);
        if (record) this.disposeRecord(key, record);
        void ry;
      }
    }
  }

  private disposeRecord(key: string, record: SectionRecord): void {
    for (const mesh of record.meshes) {
      this.root.remove(mesh);
      mesh.geometry.dispose();
    }
    this.records.delete(key);
  }

  dispose(): void {
    for (const [key, record] of [...this.records.entries()]) this.disposeRecord(key, record);
    this.root.removeFromParent();
  }
}
