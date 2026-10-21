export function clamp(value: number, min: number, max: number): number {
  return value < min ? min : value > max ? max : value;
}

export function clamp01(value: number): number {
  return value < 0 ? 0 : value > 1 ? 1 : value;
}

export function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

export function smoothstep(edge0: number, edge1: number, x: number): number {
  const t = clamp01((x - edge0) / (edge1 - edge0));
  return t * t * (3 - 2 * t);
}

export function sign(value: number): number {
  return value < 0 ? -1 : value > 0 ? 1 : 0;
}

/** Floor division that works for negative numbers. */
export function floorDiv(a: number, b: number): number {
  return Math.floor(a / b);
}

/** Positive modulo. */
export function posMod(a: number, b: number): number {
  return ((a % b) + b) % b;
}

export function distance2D(ax: number, az: number, bx: number, bz: number): number {
  const dx = ax - bx;
  const dz = az - bz;
  return Math.sqrt(dx * dx + dz * dz);
}

export function distance3D(
  ax: number,
  ay: number,
  az: number,
  bx: number,
  by: number,
  bz: number,
): number {
  const dx = ax - bx;
  const dy = ay - by;
  const dz = az - bz;
  return Math.sqrt(dx * dx + dy * dy + dz * dz);
}

/** Radians per pixel of mouse movement at sensitivity 1. */
export const MOUSE_SENSITIVITY_BASE = 0.0022;
export const DEG2RAD = Math.PI / 180;
export const RAD2DEG = 180 / Math.PI;
