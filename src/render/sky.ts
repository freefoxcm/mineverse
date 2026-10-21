import * as THREE from 'three';
import { clamp01 } from '../core/math';

const SKY_DOME_VERT = /* glsl */ `
out vec3 vDirection;
void main() {
  vDirection = normalize(position);
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`;

const SKY_DOME_FRAG = /* glsl */ `
precision highp float;
uniform vec3 uTopColor;
uniform vec3 uHorizonColor;
in vec3 vDirection;
void main() {
  float h = vDirection.y;
  float t = pow(clamp(h, 0.0, 1.0), 0.55);
  vec3 color = mix(uHorizonColor, uTopColor, t);
  color = mix(color, uHorizonColor * 0.55, clamp(-h * 2.5, 0.0, 1.0));
  gl_FragColor = vec4(color, 1.0);
}
`;

const DAY_TOP = new THREE.Color(0x4a7fd6);
const DAY_HORIZON = new THREE.Color(0xbfd8ff);
const NIGHT_TOP = new THREE.Color(0x02040c);
const NIGHT_HORIZON = new THREE.Color(0x0b1530);
const DUSK_TOP = new THREE.Color(0x2a3a78);
const DUSK_HORIZON = new THREE.Color(0xff8752);

function makeSunTexture(): THREE.DataTexture {
  const size = 32;
  const data = new Uint8Array(size * size * 4);
  const center = size / 2 - 0.5;
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const dx = Math.abs(x - center);
      const dy = Math.abs(y - center);
      const inside = dx < 13 && dy < 13;
      const i = (y * size + x) * 4;
      if (!inside) continue;
      const edge = Math.min(13 - dx, 13 - dy);
      const alpha = edge < 2 ? Math.round(255 * (edge / 2)) : 255;
      data[i] = 255;
      data[i + 1] = 242;
      data[i + 2] = 200;
      data[i + 3] = alpha;
    }
  }
  const texture = new THREE.DataTexture(data, size, size, THREE.RGBAFormat);
  texture.magFilter = THREE.NearestFilter;
  texture.minFilter = THREE.NearestFilter;
  texture.needsUpdate = true;
  return texture;
}

function makeMoonTexture(): THREE.DataTexture {
  const size = 32;
  const data = new Uint8Array(size * size * 4);
  const center = size / 2 - 0.5;
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const dx = x - center;
      const dy = y - center;
      if (dx * dx + dy * dy > 11 * 11) continue;
      const crater = (x * 7 + y * 13) % 19 < 3;
      const i = (y * size + x) * 4;
      data[i] = crater ? 170 : 225;
      data[i + 1] = crater ? 170 : 230;
      data[i + 2] = crater ? 180 : 245;
      data[i + 3] = 255;
    }
  }
  const texture = new THREE.DataTexture(data, size, size, THREE.RGBAFormat);
  texture.magFilter = THREE.NearestFilter;
  texture.minFilter = THREE.NearestFilter;
  texture.needsUpdate = true;
  return texture;
}

function makeCloudTexture(): THREE.DataTexture {
  const size = 64;
  const data = new Uint8Array(size * size * 4);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const i = (y * size + x) * 4;
      // A few soft, deterministic cloud blobs.
      let value = 0;
      for (let k = 0; k < 5; k++) {
        const cx = ((k * 17 + 9) % size) - x;
        const cy = ((k * 29 + 4) % size) - y;
        const dist = Math.sqrt(cx * cx + cy * cy);
        value = Math.max(value, 1 - dist / (7 + (k % 3) * 3));
      }
      const alpha = clamp01((value - 0.35) * 2.2);
      data[i] = 255;
      data[i + 1] = 255;
      data[i + 2] = 255;
      data[i + 3] = Math.round(alpha * 190);
    }
  }
  const texture = new THREE.DataTexture(data, size, size, THREE.RGBAFormat);
  texture.wrapS = THREE.RepeatWrapping;
  texture.wrapT = THREE.RepeatWrapping;
  texture.repeat.set(5, 5);
  texture.magFilter = THREE.NearestFilter;
  texture.minFilter = THREE.NearestFilter;
  texture.needsUpdate = true;
  return texture;
}

/** Sky dome, sun, moon, stars and the flat cloud layer. */
export class Sky {
  readonly group = new THREE.Group();
  readonly fogColor = new THREE.Color(0xbfd8ff);
  private readonly topColor = new THREE.Color(0x4a7fd6);
  private readonly horizonColor = new THREE.Color(0xbfd8ff);
  private readonly domeMaterial: THREE.ShaderMaterial;
  private readonly sun: THREE.Sprite;
  private readonly moon: THREE.Sprite;
  private readonly stars: THREE.Points;
  private readonly starMaterial: THREE.PointsMaterial;
  private readonly clouds: THREE.Mesh;
  private readonly cloudMaterial: THREE.MeshBasicMaterial;

  constructor(scene: THREE.Scene) {
    this.domeMaterial = new THREE.ShaderMaterial({
      uniforms: {
        uTopColor: { value: this.topColor },
        uHorizonColor: { value: this.horizonColor },
      },
      vertexShader: SKY_DOME_VERT,
      fragmentShader: SKY_DOME_FRAG,
      side: THREE.BackSide,
      depthWrite: false,
      depthTest: false,
      fog: false,
    });
    const dome = new THREE.Mesh(new THREE.SphereGeometry(500, 24, 16), this.domeMaterial);
    dome.renderOrder = -100;
    dome.frustumCulled = false;
    this.group.add(dome);

    this.sun = new THREE.Sprite(
      new THREE.SpriteMaterial({
        map: makeSunTexture(),
        transparent: true,
        depthWrite: false,
        depthTest: true,
        fog: false,
      }),
    );
    this.sun.scale.setScalar(60);
    this.sun.renderOrder = -90;
    this.group.add(this.sun);

    this.moon = new THREE.Sprite(
      new THREE.SpriteMaterial({
        map: makeMoonTexture(),
        transparent: true,
        depthWrite: false,
        depthTest: true,
        fog: false,
      }),
    );
    this.moon.scale.setScalar(40);
    this.moon.renderOrder = -90;
    this.group.add(this.moon);

    const starCount = 700;
    const positions = new Float32Array(starCount * 3);
    for (let i = 0; i < starCount; i++) {
      const theta = Math.random() * Math.PI * 2;
      const phi = Math.acos(Math.random() * 0.98);
      const r = 480;
      positions[i * 3] = Math.cos(theta) * Math.sin(phi) * r;
      positions[i * 3 + 1] = Math.cos(phi) * r;
      positions[i * 3 + 2] = Math.sin(theta) * Math.sin(phi) * r;
    }
    const starGeometry = new THREE.BufferGeometry();
    starGeometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    this.starMaterial = new THREE.PointsMaterial({
      color: 0xffffff,
      size: 3,
      sizeAttenuation: false,
      transparent: true,
      opacity: 0,
      depthWrite: false,
      fog: false,
    });
    this.stars = new THREE.Points(starGeometry, this.starMaterial);
    this.stars.renderOrder = -95;
    this.group.add(this.stars);

    scene.add(this.group);

    this.cloudMaterial = new THREE.MeshBasicMaterial({
      map: makeCloudTexture(),
      transparent: true,
      opacity: 0.82,
      depthWrite: false,
      side: THREE.DoubleSide,
      fog: false,
    });
    this.clouds = new THREE.Mesh(new THREE.PlaneGeometry(1600, 1600), this.cloudMaterial);
    this.clouds.rotation.x = -Math.PI / 2;
    this.clouds.position.y = 145;
    this.clouds.renderOrder = 1;
    scene.add(this.clouds);
  }

  update(camera: THREE.Camera, timeOfDay: number, daylight: number): void {
    const angle = (timeOfDay / 24000) * Math.PI * 2;
    const sunY = Math.sin(angle);
    const dayFactor = clamp01((sunY + 0.15) / 0.5);
    const duskFactor = clamp01(1 - Math.abs(sunY) * 2.2);

    this.topColor.copy(NIGHT_TOP).lerp(DAY_TOP, dayFactor).lerp(DUSK_TOP, duskFactor * 0.55);
    this.horizonColor.copy(NIGHT_HORIZON).lerp(DAY_HORIZON, dayFactor).lerp(DUSK_HORIZON, duskFactor * 0.7);
    this.fogColor.copy(this.horizonColor);

    this.group.position.copy(camera.position);
    const direction = new THREE.Vector3(Math.cos(angle), sunY, 0.22).normalize();
    this.sun.position.copy(direction).multiplyScalar(420);
    this.moon.position.copy(direction).multiplyScalar(-420);
    this.sun.visible = sunY > -0.2;
    this.moon.visible = sunY < 0.25;
    this.sun.material.opacity = clamp01((sunY + 0.2) * 6);
    this.moon.material.opacity = clamp01((-sunY + 0.2) * 6);
    this.starMaterial.opacity = clamp01(1 - dayFactor * 1.6);
    this.stars.visible = this.starMaterial.opacity > 0.02;

    this.cloudMaterial.opacity = 0.55 + dayFactor * 0.3;
    this.clouds.visible = true;
    this.cloudMaterial.map!.offset.x = (timeOfDay / 24000) * 0.6;
    this.cloudMaterial.map!.offset.y = (timeOfDay / 24000) * 0.25;

    // The dome shader only needs colours; daylight is applied by terrain materials.
    void daylight;
  }

  setCloudsVisible(visible: boolean): void {
    this.clouds.visible = visible;
  }

  dispose(): void {
    this.group.traverse((object) => {
      if (object instanceof THREE.Mesh || object instanceof THREE.Points || object instanceof THREE.Sprite) {
        object.geometry?.dispose();
        const material = object.material;
        if (Array.isArray(material)) material.forEach((m) => m.dispose());
        else material?.dispose();
      }
    });
    this.clouds.geometry.dispose();
    this.cloudMaterial.map?.dispose();
    this.cloudMaterial.dispose();
  }
}
