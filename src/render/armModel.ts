import * as THREE from 'three';
import { createPlayerArmSkin, createPlayerSleeveSkin } from '../art/playerSkin';
import type { PixelBuffer } from '../art/pixels';
type Vec3Tuple = [number, number, number];

/**
 * 3D first-person arm/fist model with real skin and sleeve textures.
 *
 * The arm is a tapered 6-face prism (elbow wider than wrist) plus a palm, four
 * finger ridges and a thumb. Per-face vertex colours provide a stable light
 * direction, while the 32x32 skin/sleeve textures add larger colour clumps and
 * creases. A single `MeshBasicMaterial` per texture is used so `setLight()` can
 * follow the world's daylight like the old placeholder arm did.
 */

const BOX_SHADES: Readonly<Record<'px' | 'nx' | 'py' | 'ny' | 'pz' | 'nz', number>> = {
  px: 0.9,
  nx: 0.78,
  py: 1.0,
  ny: 0.68,
  pz: 0.86,
  nz: 0.72,
};

export interface ArmMaterials {
  readonly arm: THREE.MeshBasicMaterial;
  readonly sleeve: THREE.MeshBasicMaterial;
  setLight(light: number): void;
}

export interface ArmModel {
  readonly group: THREE.Group;
  readonly materials: ArmMaterials;
  /** Hand grip point in handRoot space (arm scale applied). */
  readonly handAnchor: THREE.Vector3;
  setHolding(holding: boolean): void;
  dispose(): void;
}

function pixelTexture(buffer: PixelBuffer): THREE.DataTexture {
  const data = new Uint8Array(buffer.data.length);
  data.set(buffer.data);
  const texture = new THREE.DataTexture(data, buffer.width, buffer.height, THREE.RGBAFormat);
  texture.magFilter = THREE.NearestFilter;
  texture.minFilter = THREE.NearestFilter;
  texture.generateMipmaps = false;
  texture.colorSpace = THREE.NoColorSpace;
  texture.needsUpdate = true;
  return texture;
}

interface MaterialOptions {
  map?: THREE.Texture;
  base: number;
}

function createShadedMaterial(options: MaterialOptions): { material: THREE.MeshBasicMaterial; base: THREE.Color } {
  const material = new THREE.MeshBasicMaterial({
    map: options.map,
    color: options.map ? 0xffffff : options.base,
    vertexColors: true,
    side: THREE.DoubleSide,
  });
  return { material, base: new THREE.Color(options.map ? 0xffffff : options.base) };
}

function pushQuad(
  positions: number[],
  uvs: number[],
  colors: number[],
  indices: number[],
  corners: readonly Vec3Tuple[],
  shade: number,
): void {
  const offset = positions.length / 3;
  for (let i = 0; i < 4; i++) {
    positions.push(corners[i][0], corners[i][1], corners[i][2]);
    uvs.push(i === 0 || i === 3 ? 0 : 1, i >= 2 ? 1 : 0);
    colors.push(shade, shade, shade);
  }
  indices.push(offset, offset + 1, offset + 2, offset, offset + 2, offset + 3);
}

/**
 * Tapered prism along Z. Near cap (+Z) is wider (elbow/cuff side), far cap (-Z)
 * is narrower (wrist side). Normals are not needed (BasicMaterial + DoubleSide).
 */
export function createTaperedBoxGeometry(
  nearWidth: number,
  nearHeight: number,
  farWidth: number,
  farHeight: number,
  length: number,
  shadeScale = 1,
): THREE.BufferGeometry {
  const nw = nearWidth / 2;
  const nh = nearHeight / 2;
  const fw = farWidth / 2;
  const fh = farHeight / 2;
  const nz = length / 2;
  const fz = -length / 2;
  const near = (sx: number, sy: number): Vec3Tuple => [sx * nw, sy * nh, nz];
  const far = (sx: number, sy: number): Vec3Tuple => [sx * fw, sy * fh, fz];

  const positions: number[] = [];
  const uvs: number[] = [];
  const colors: number[] = [];
  const indices: number[] = [];

  // +Z / -Z caps
  pushQuad(positions, uvs, colors, indices, [near(-1, -1), near(1, -1), near(1, 1), near(-1, 1)], BOX_SHADES.pz * shadeScale);
  pushQuad(positions, uvs, colors, indices, [far(-1, -1), far(-1, 1), far(1, 1), far(1, -1)], BOX_SHADES.nz * shadeScale);
  // +X / -X sides
  pushQuad(positions, uvs, colors, indices, [near(1, -1), far(1, -1), far(1, 1), near(1, 1)], BOX_SHADES.px * shadeScale);
  pushQuad(positions, uvs, colors, indices, [near(-1, -1), near(-1, 1), far(-1, 1), far(-1, -1)], BOX_SHADES.nx * shadeScale);
  // +Y / -Y sides
  pushQuad(positions, uvs, colors, indices, [near(-1, 1), near(1, 1), far(1, 1), far(-1, 1)], BOX_SHADES.py * shadeScale);
  pushQuad(positions, uvs, colors, indices, [near(-1, -1), far(-1, -1), far(1, -1), near(1, -1)], BOX_SHADES.ny * shadeScale);

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  geometry.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
  geometry.setIndex(indices);
  return geometry;
}

function createBoxGeometry(width: number, height: number, depth: number): THREE.BufferGeometry {
  return createTaperedBoxGeometry(width, height, width, height, depth);
}

function createFist(skinMaterial: THREE.Material, scale = 1): THREE.Group {
  const group = new THREE.Group();
  const palm = new THREE.Mesh(createTaperedBoxGeometry(0.12, 0.11, 0.112, 0.102, 0.1), skinMaterial);
  group.add(palm);
  // Fingers curl around the handle on the camera-facing side.
  const fingerGeometry = createBoxGeometry(0.026, 0.058, 0.075);
  for (let i = 0; i < 4; i++) {
    const finger = new THREE.Mesh(fingerGeometry, skinMaterial);
    finger.position.set(-0.044 + i * 0.029, -0.005, 0.065);
    finger.rotation.x = -0.22;
    group.add(finger);
  }
  const creaseGeometry = createTaperedBoxGeometry(0.006, 0.05, 0.006, 0.05, 0.065, 0.5);
  for (let i = 0; i < 3; i++) {
    const crease = new THREE.Mesh(creaseGeometry, skinMaterial);
    crease.rotation.x = Math.PI / 2;
    crease.position.set(-0.029 + i * 0.029, 0.005, 0.09);
    group.add(crease);
  }
  const thumb = new THREE.Mesh(createBoxGeometry(0.04, 0.048, 0.075), skinMaterial);
  thumb.position.set(-0.07, 0.035, 0.045);
  thumb.rotation.set(0.1, -0.15, 0.55);
  group.add(thumb);
  group.scale.setScalar(scale);
  return group;
}

function createKnuckleFist(skinMaterial: THREE.Material): THREE.Group {
  const hand = new THREE.Group();
  // Palm slab at the end of the forearm; the back of the hand faces up/left.
  const palm = new THREE.Mesh(createTaperedBoxGeometry(0.15, 0.1, 0.14, 0.09, 0.11), skinMaterial);
  palm.position.z = -0.155;
  hand.add(palm);
  // Four finger ridges lie on top of the palm, pointing away from the wrist.
  const fingerGeometry = createBoxGeometry(0.034, 0.036, 0.1);
  for (let i = 0; i < 4; i++) {
    const finger = new THREE.Mesh(fingerGeometry, skinMaterial);
    finger.position.set(-0.054 + i * 0.036, 0.06, -0.185);
    hand.add(finger);
  }
  // Dark creases between the fingers so the knuckles read at a glance.
  const creaseGeometry = createTaperedBoxGeometry(0.007, 0.04, 0.007, 0.04, 0.085, 0.45);
  for (let i = 0; i < 3; i++) {
    const crease = new THREE.Mesh(creaseGeometry, skinMaterial);
    crease.rotation.x = Math.PI / 2;
    crease.position.set(-0.036 + i * 0.036, 0.064, -0.185);
    hand.add(crease);
  }
  const thumb = new THREE.Mesh(createBoxGeometry(0.045, 0.05, 0.085), skinMaterial);
  thumb.position.set(-0.088, 0.015, -0.14);
  thumb.rotation.set(0.1, -0.2, 0.5);
  hand.add(thumb);
  // Bend the wrist slightly toward the camera so the knuckles are visible.
  hand.rotation.x = 1.2;
  return hand;
}

export function createHeldFist(skinMaterial: THREE.Material, scale = 0.78): THREE.Group {
  return createFist(skinMaterial, scale);
}

/** Builds the empty-hand arm (forearm, sleeve, fist) in local hand space. */
export function createArmModel(): ArmModel {
  const armTexture = pixelTexture(createPlayerArmSkin());
  const sleeveTexture = pixelTexture(createPlayerSleeveSkin());
  const arm = createShadedMaterial({ map: armTexture, base: 0xc68f6b });
  const sleeve = createShadedMaterial({ map: sleeveTexture, base: 0x2f8f99 });

  const group = new THREE.Group();
  const forearm = new THREE.Mesh(createTaperedBoxGeometry(0.125, 0.115, 0.098, 0.092, 0.29), arm.material);
  forearm.position.z = 0.05;
  group.add(forearm);

  // Darker wrist crease separates the forearm from the hand.
  const wrist = new THREE.Mesh(createTaperedBoxGeometry(0.112, 0.106, 0.105, 0.1, 0.035, 0.68), arm.material);
  wrist.position.z = -0.105;
  group.add(wrist);

  const sleeveMesh = new THREE.Mesh(createTaperedBoxGeometry(0.145, 0.135, 0.128, 0.118, 0.16), sleeve.material);
  sleeveMesh.position.z = 0.265;
  group.add(sleeveMesh);

  const cuff = new THREE.Mesh(createBoxGeometry(0.15, 0.14, 0.028), sleeve.material);
  cuff.position.z = 0.185;
  group.add(cuff);

  const fist = createKnuckleFist(arm.material);
  group.add(fist);
  group.scale.setScalar(0.68);
  const materials: ArmMaterials = {
    arm: arm.material,
    sleeve: sleeve.material,
    setLight(light: number): void {
      arm.material.color.copy(arm.base).multiplyScalar(Math.max(0.05, light));
      sleeve.material.color.copy(sleeve.base).multiplyScalar(Math.max(0.05, light));
    },
  };
  materials.setLight(1);

  const handAnchor = new THREE.Vector3(0, 0, -0.16 * 0.68);

  const dispose = (): void => {
    const geometries = new Set<THREE.BufferGeometry>();
    group.traverse((object) => {
      if (object instanceof THREE.Mesh) geometries.add(object.geometry);
    });
    for (const geometry of geometries) geometry.dispose();
    arm.material.dispose();
    sleeve.material.dispose();
    armTexture.dispose();
    sleeveTexture.dispose();
  };

  return {
    group,
    materials,
    handAnchor,
    setHolding(holding: boolean): void {
      fist.visible = !holding;
    },
    dispose,
  };
}
