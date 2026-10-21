/**
 * Deterministic value-noise toolkit for world generation.
 *
 * Every function here is pure: the same seed and coordinates always produce the
 * same value. No global RNG source may be consumed here — the whole world must be
 * reproducible from its seed (see docs/CONTRACTS.md).
 */
import { hash2f, hash3f } from '../../core/rng';

const OCTAVE_SEED_A = 0x9e3779b1;
const OCTAVE_SEED_B = 0x85ebca6b;
const OCTAVE_SEED_C = 0xc2b2ae35;

function fade(t: number): number {
  return t * t * t * (t * (t * 6 - 15) + 10);
}

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

export function clamp01(value: number): number {
  return value < 0 ? 0 : value > 1 ? 1 : value;
}

export function clamp(value: number, min: number, max: number): number {
  return value < min ? min : value > max ? max : value;
}

export function smoothstep(edge0: number, edge1: number, x: number): number {
  const t = clamp01((x - edge0) / (edge1 - edge0));
  return t * t * (3 - 2 * t);
}

export function lerpRange(a: number, b: number, t: number): number {
  return a + (b - a) * clamp01(t);
}

/** Value noise in [0, 1). Smoothly interpolated 2D lattice noise. */
export function valueNoise2(seed: number, x: number, z: number): number {
  const xi = Math.floor(x);
  const zi = Math.floor(z);
  const u = fade(x - xi);
  const v = fade(z - zi);
  const a = hash2f(seed, xi, zi);
  const b = hash2f(seed, xi + 1, zi);
  const c = hash2f(seed, xi, zi + 1);
  const d = hash2f(seed, xi + 1, zi + 1);
  return lerp(lerp(a, b, u), lerp(c, d, u), v);
}

/** Signed value noise in [-1, 1]. */
export function noise2(seed: number, x: number, z: number): number {
  return valueNoise2(seed, x, z) * 2 - 1;
}

/**
 * Fractal value noise in [0, 1]. Octaves use decorrelated seeds so features at
 * different frequencies do not line up.
 */
export function fbm2(seed: number, x: number, z: number, octaves = 4, gain = 0.5, lacunarity = 2): number {
  let amplitude = 1;
  let frequency = 1;
  let sum = 0;
  let norm = 0;
  for (let i = 0; i < octaves; i++) {
    const octaveSeed = (seed ^ Math.imul(i + 1, OCTAVE_SEED_A)) | 0;
    sum += amplitude * valueNoise2(octaveSeed, x * frequency, z * frequency);
    norm += amplitude;
    amplitude *= gain;
    frequency *= lacunarity;
  }
  return norm === 0 ? 0 : sum / norm;
}

/** Ridged fractal noise in [0, 1]; crests are 1, valleys 0. Used for mountains. */
export function ridged2(seed: number, x: number, z: number, octaves = 3): number {
  let amplitude = 1;
  let frequency = 1;
  let sum = 0;
  let norm = 0;
  for (let i = 0; i < octaves; i++) {
    const octaveSeed = (seed ^ Math.imul(i + 1, OCTAVE_SEED_B)) | 0;
    const n = 1 - Math.abs(valueNoise2(octaveSeed, x * frequency, z * frequency) * 2 - 1);
    sum += amplitude * n * n;
    norm += amplitude;
    amplitude *= 0.5;
    frequency *= 2;
  }
  return norm === 0 ? 0 : sum / norm;
}

/** Smoothly interpolated 3D value noise in [0, 1). */
export function valueNoise3(seed: number, x: number, y: number, z: number): number {
  const xi = Math.floor(x);
  const yi = Math.floor(y);
  const zi = Math.floor(z);
  const u = fade(x - xi);
  const v = fade(y - yi);
  const w = fade(z - zi);
  const c000 = hash3f(seed, xi, yi, zi);
  const c100 = hash3f(seed, xi + 1, yi, zi);
  const c010 = hash3f(seed, xi, yi + 1, zi);
  const c110 = hash3f(seed, xi + 1, yi + 1, zi);
  const c001 = hash3f(seed, xi, yi, zi + 1);
  const c101 = hash3f(seed, xi + 1, yi, zi + 1);
  const c011 = hash3f(seed, xi, yi + 1, zi + 1);
  const c111 = hash3f(seed, xi + 1, yi + 1, zi + 1);
  return lerp(
    lerp(lerp(c000, c100, u), lerp(c010, c110, u), v),
    lerp(lerp(c001, c101, u), lerp(c011, c111, u), v),
    w,
  );
}

/** Fractal 3D value noise in [0, 1). */
export function fbm3(seed: number, x: number, y: number, z: number, octaves = 2): number {
  let amplitude = 1;
  let frequency = 1;
  let sum = 0;
  let norm = 0;
  for (let i = 0; i < octaves; i++) {
    const octaveSeed = (seed ^ Math.imul(i + 1, OCTAVE_SEED_C)) | 0;
    sum += amplitude * valueNoise3(octaveSeed, x * frequency, y * frequency, z * frequency);
    norm += amplitude;
    amplitude *= 0.5;
    frequency *= 2;
  }
  return norm === 0 ? 0 : sum / norm;
}
