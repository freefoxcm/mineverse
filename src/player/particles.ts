/**
 * Parameterised billboard particle system (block break, explosion, splash,
 * smoke, bubbles, crits, flame).
 *
 * Two layers:
 *  - `ParticleSystem` is pure data / deterministic (Rand, no Math.random) and
 *    unit-testable in Node.
 *  - `ParticleRenderer` is a THREE.InstancedMesh billboard renderer added to
 *    the main scene by Lead.
 *
 * main.ts wiring:
 *
 *   const particles = new ParticleSystem(2048, 0xC0FFEE);
 *   const particleRenderer = new ParticleRenderer(renderer.scene, { capacity: 2048 });
 *   // each frame after rendering the world:
 *   particles.update(delta);
 *   particleRenderer.sync(particles, renderer.camera);
 *
 * Interaction callbacks can call `particles.spawnBlockBreak(x, y, z, color)` /
 * `spawnExplosion` / `spawnSplash` / `spawnSmoke` / `spawnCrit`.
 */

import * as THREE from 'three';
import { Rand } from '../core/rng';

export type ParticleKind =
  | 'blockBreak'
  | 'explosion'
  | 'splash'
  | 'smoke'
  | 'bubble'
  | 'crit'
  | 'flame';

export interface ParticleSpawnOptions {
  count?: number;
  /** Linear RGB 0..1. */
  color?: [number, number, number];
  speed?: number;
  /** Random spawn offset radius around the origin. */
  spread?: number;
  size?: number;
  life?: number;
  gravity?: number;
  /** Velocity damping per second. */
  drag?: number;
}

interface KindDefaults {
  count: number;
  speed: number;
  spread: number;
  size: number;
  life: number;
  gravity: number;
  drag: number;
  color: [number, number, number];
}

const KIND_DEFAULTS: Record<ParticleKind, KindDefaults> = {
  blockBreak: { count: 12, speed: 2.6, spread: 0.22, size: 0.12, life: 0.65, gravity: 18, drag: 1.2, color: [0.6, 0.6, 0.6] },
  explosion: { count: 40, speed: 7.5, spread: 0.6, size: 0.55, life: 1.15, gravity: 3.5, drag: 2.4, color: [1, 0.62, 0.18] },
  splash: { count: 16, speed: 3.2, spread: 0.22, size: 0.1, life: 0.7, gravity: 18, drag: 1.2, color: [0.6, 0.78, 1] },
  smoke: { count: 8, speed: 0.7, spread: 0.3, size: 0.38, life: 1.5, gravity: -0.45, drag: 0.4, color: [0.4, 0.4, 0.42] },
  bubble: { count: 6, speed: 1.2, spread: 0.2, size: 0.12, life: 1.0, gravity: -2, drag: 0.8, color: [0.75, 0.88, 1] },
  crit: { count: 8, speed: 4.2, spread: 0.12, size: 0.08, life: 0.42, gravity: 6, drag: 0.5, color: [1, 0.9, 0.4] },
  flame: { count: 8, speed: 0.9, spread: 0.2, size: 0.22, life: 0.8, gravity: -1.1, drag: 0.9, color: [1, 0.55, 0.12] },
};

/**
 * Struct-of-arrays particle simulation with swap-remove compaction: indices
 * `[0, activeCount)` are the live particles after every update.
 */
export class ParticleSystem {
  readonly capacity: number;
  readonly px: Float32Array;
  readonly py: Float32Array;
  readonly pz: Float32Array;
  readonly vx: Float32Array;
  readonly vy: Float32Array;
  readonly vz: Float32Array;
  readonly age: Float32Array;
  readonly life: Float32Array;
  readonly size: Float32Array;
  readonly gravity: Float32Array;
  readonly drag: Float32Array;
  readonly colorR: Float32Array;
  readonly colorG: Float32Array;
  readonly colorB: Float32Array;

  private count = 0;
  private readonly random: Rand;

  constructor(capacity = 2048, seed = 0x51ed270b) {
    this.capacity = Math.max(1, Math.floor(capacity));
    const n = this.capacity;
    this.px = new Float32Array(n);
    this.py = new Float32Array(n);
    this.pz = new Float32Array(n);
    this.vx = new Float32Array(n);
    this.vy = new Float32Array(n);
    this.vz = new Float32Array(n);
    this.age = new Float32Array(n);
    this.life = new Float32Array(n);
    this.size = new Float32Array(n);
    this.gravity = new Float32Array(n);
    this.drag = new Float32Array(n);
    this.colorR = new Float32Array(n);
    this.colorG = new Float32Array(n);
    this.colorB = new Float32Array(n);
    this.random = new Rand(seed);
  }

  get activeCount(): number {
    return this.count;
  }

  clear(): void {
    this.count = 0;
  }

  /** Spawn a burst of particles. Extra particles above capacity are dropped. */
  spawn(kind: ParticleKind, origin: { x: number; y: number; z: number }, options: ParticleSpawnOptions = {}): number {
    const defaults = KIND_DEFAULTS[kind];
    const count = Math.max(0, Math.floor(options.count ?? defaults.count));
    const speed = options.speed ?? defaults.speed;
    const spread = options.spread ?? defaults.spread;
    const size = options.size ?? defaults.size;
    const life = options.life ?? defaults.life;
    const gravity = options.gravity ?? defaults.gravity;
    const drag = options.drag ?? defaults.drag;
    const [r, g, b] = options.color ?? defaults.color;
    const spawned = Math.min(count, this.capacity - this.count);
    for (let i = 0; i < spawned; i++) {
      const index = this.count++;
      const theta = this.random.next() * Math.PI * 2;
      const z = this.random.next() * 2 - 1;
      const radial = Math.sqrt(Math.max(0, 1 - z * z));
      // Explosions/block breaks bias upward; smoke/flame/bubbles too.
      const upward = kind === 'blockBreak' || kind === 'splash' || kind === 'explosion';
      const vertical = upward ? Math.abs(z) : kind === 'crit' ? z : Math.abs(z) * 0.7 + 0.3;
      const scale = 0.55 + this.random.next() * 0.75;
      this.px[index] = origin.x + (this.random.next() - 0.5) * spread * 2;
      this.py[index] = origin.y + (this.random.next() - 0.5) * spread * 2;
      this.pz[index] = origin.z + (this.random.next() - 0.5) * spread * 2;
      this.vx[index] = Math.cos(theta) * radial * speed * scale;
      this.vy[index] = vertical * speed * scale * (kind === 'smoke' || kind === 'flame' ? 0.5 : 1);
      this.vz[index] = Math.sin(theta) * radial * speed * scale;
      this.age[index] = 0;
      this.life[index] = life * (0.7 + this.random.next() * 0.6);
      this.size[index] = size * (0.75 + this.random.next() * 0.5);
      this.gravity[index] = gravity;
      this.drag[index] = drag;
      this.colorR[index] = r;
      this.colorG[index] = g;
      this.colorB[index] = b;
    }
    return spawned;
  }

  spawnBlockBreak(x: number, y: number, z: number, color?: [number, number, number], count = 12): number {
    return this.spawn('blockBreak', { x, y, z }, { color, count });
  }

  spawnExplosion(x: number, y: number, z: number, count = 40): number {
    return this.spawn('explosion', { x, y, z }, { count });
  }

  spawnSplash(x: number, y: number, z: number, count = 16): number {
    return this.spawn('splash', { x, y, z }, { count });
  }

  spawnSmoke(x: number, y: number, z: number, count = 8, color?: [number, number, number]): number {
    return this.spawn('smoke', { x, y, z }, { color, count });
  }

  spawnCrit(x: number, y: number, z: number, count = 8): number {
    return this.spawn('crit', { x, y, z }, { count });
  }

  /** Advance all particles by `dtSeconds` (no world collision, cheap). */
  update(dtSeconds: number): void {
    const dt = Math.min(0.1, Math.max(0, dtSeconds));
    if (dt <= 0) return;
    let i = 0;
    while (i < this.count) {
      this.age[i] += dt;
      if (this.age[i] >= this.life[i]) {
        this.remove(i);
        continue;
      }
      this.vy[i] -= this.gravity[i] * dt;
      const damping = Math.max(0, 1 - this.drag[i] * dt);
      this.vx[i] *= damping;
      this.vy[i] *= damping;
      this.vz[i] *= damping;
      this.px[i] += this.vx[i] * dt;
      this.py[i] += this.vy[i] * dt;
      this.pz[i] += this.vz[i] * dt;
      i++;
    }
  }

  private remove(index: number): void {
    const last = this.count - 1;
    if (index !== last) {
      this.copySlot(last, index);
    }
    this.count = last;
  }

  private copySlot(from: number, to: number): void {
    this.px[to] = this.px[from];
    this.py[to] = this.py[from];
    this.pz[to] = this.pz[from];
    this.vx[to] = this.vx[from];
    this.vy[to] = this.vy[from];
    this.vz[to] = this.vz[from];
    this.age[to] = this.age[from];
    this.life[to] = this.life[from];
    this.size[to] = this.size[from];
    this.gravity[to] = this.gravity[from];
    this.drag[to] = this.drag[from];
    this.colorR[to] = this.colorR[from];
    this.colorG[to] = this.colorG[from];
    this.colorB[to] = this.colorB[from];
  }
}

// ---------------------------------------------------------------------------
// Rendering (THREE)
// ---------------------------------------------------------------------------

/** Soft round white sprite generated procedurally (no image files). */
export function createParticleTexture(size = 16): THREE.DataTexture {
  const pixels = new Uint8Array(size * size * 4);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const nx = (x + 0.5) / size - 0.5;
      const ny = (y + 0.5) / size - 0.5;
      const distance = Math.hypot(nx, ny) * 2;
      const alpha = Math.max(0, 1 - distance);
      const offset = (y * size + x) * 4;
      pixels[offset] = 255;
      pixels[offset + 1] = 255;
      pixels[offset + 2] = 255;
      pixels[offset + 3] = Math.round(alpha * alpha * 255);
    }
  }
  const texture = new THREE.DataTexture(pixels, size, size, THREE.RGBAFormat);
  texture.magFilter = THREE.LinearFilter;
  texture.minFilter = THREE.LinearFilter;
  texture.needsUpdate = true;
  return texture;
}

export interface ParticleRendererOptions {
  capacity?: number;
  texture?: THREE.Texture;
}

/**
 * Instanced billboard particles. The mesh is added to the scene and `sync`
 * must be called each frame after `ParticleSystem.update` with the render
 * camera so the quads face it.
 */
export class ParticleRenderer {
  readonly mesh: THREE.InstancedMesh;
  private readonly scene: THREE.Scene;
  private readonly geometry: THREE.PlaneGeometry;
  private readonly material: THREE.MeshBasicMaterial;
  private readonly ownTexture: THREE.Texture | null;
  private readonly matrix = new THREE.Matrix4();
  private readonly position = new THREE.Vector3();
  private readonly scale = new THREE.Vector3();
  private readonly color = new THREE.Color();

  constructor(scene: THREE.Scene, options: ParticleRendererOptions = {}) {
    this.scene = scene;
    const capacity = Math.max(1, Math.floor(options.capacity ?? 2048));
    this.geometry = new THREE.PlaneGeometry(1, 1);
    this.ownTexture = options.texture ?? createParticleTexture();
    this.material = new THREE.MeshBasicMaterial({
      map: this.ownTexture,
      transparent: true,
      depthWrite: false,
      depthTest: true,
      side: THREE.DoubleSide,
      blending: THREE.NormalBlending,
    });
    this.mesh = new THREE.InstancedMesh(this.geometry, this.material, capacity);
    this.mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.mesh.frustumCulled = false;
    this.mesh.count = 0;
    this.mesh.renderOrder = 10;
    scene.add(this.mesh);
  }

  /** Upload live particles; call after `ParticleSystem.update`. */
  sync(system: ParticleSystem, camera: THREE.Camera): void {
    const capacity = this.mesh.instanceMatrix.count;
    const count = Math.min(system.activeCount, capacity);
    this.mesh.count = count;
    for (let i = 0; i < count; i++) {
      this.position.set(system.px[i], system.py[i], system.pz[i]);
      const shrink = Math.max(0, 1 - system.age[i] / system.life[i]);
      const size = system.size[i] * (0.35 + shrink * 0.65);
      this.scale.set(size, size, size);
      this.matrix.compose(this.position, camera.quaternion, this.scale);
      this.mesh.setMatrixAt(i, this.matrix);
      // Fade toward the end of life by dimming the unlit sprite.
      const fade = 0.25 + shrink * 0.75;
      this.color.setRGB(system.colorR[i] * fade, system.colorG[i] * fade, system.colorB[i] * fade);
      this.mesh.setColorAt(i, this.color);
    }
    this.mesh.instanceMatrix.needsUpdate = true;
    if (this.mesh.instanceColor) this.mesh.instanceColor.needsUpdate = true;
  }

  dispose(): void {
    this.scene.remove(this.mesh);
    this.geometry.dispose();
    this.material.dispose();
    if (this.ownTexture) this.ownTexture.dispose();
    this.mesh.dispose();
  }
}
