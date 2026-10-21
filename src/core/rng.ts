/**
 * Deterministic hashing / PRNG utilities.
 * Nothing in world generation may use Math.random(): same seed => same world.
 */

/** 32-bit integer avalanche mixer. */
export function mix32(value: number): number {
  let x = value | 0;
  x = Math.imul(x ^ (x >>> 16), 0x7feb352d);
  x = Math.imul(x ^ (x >>> 15), 0x846ca68b);
  x = x ^ (x >>> 16);
  return x >>> 0;
}

export function hashString(text: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return mix32(h);
}

/** Stable 2D hash of integer coordinates. */
export function hash2i(seed: number, x: number, y: number): number {
  let h = mix32((x | 0) ^ 0x9e3779b1);
  h = mix32((y | 0) ^ h);
  return mix32(h ^ mix32(seed | 0));
}

/** Stable 3D hash of integer coordinates. */
export function hash3i(seed: number, x: number, y: number, z: number): number {
  let h = mix32((x | 0) ^ 0x9e3779b1);
  h = mix32((y | 0) ^ h);
  h = mix32((z | 0) ^ h);
  return mix32(h ^ mix32(seed | 0));
}

/** hash2i mapped to [0,1). */
export function hash2f(seed: number, x: number, y: number): number {
  return hash2i(seed, x, y) / 4294967296;
}

export function hash3f(seed: number, x: number, y: number, z: number): number {
  return hash3i(seed, x, y, z) / 4294967296;
}

/** Small fast deterministic PRNG (xorshift32). */
export class Rand {
  private state: number;

  constructor(seed: number) {
    this.state = mix32(seed) || 0x9e3779b9;
  }

  /** Raw uint32. */
  nextUint(): number {
    let x = this.state;
    x ^= x << 13;
    x ^= x >>> 17;
    x ^= x << 5;
    this.state = x >>> 0;
    return this.state;
  }

  /** Float in [0,1). */
  next(): number {
    return this.nextUint() / 4294967296;
  }

  /** Integer in [0, bound). */
  int(bound: number): number {
    return Math.floor(this.next() * bound);
  }

  /** Integer in [min, max] inclusive. */
  range(min: number, max: number): number {
    return min + this.int(max - min + 1);
  }

  chance(probability: number): boolean {
    return this.next() < probability;
  }

  pick<T>(values: readonly T[]): T {
    return values[this.int(values.length)];
  }
}

/** One-shot mulberry32 generator. */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
