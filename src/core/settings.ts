import {
  DEFAULT_RENDER_DISTANCE,
  MAX_RENDER_DISTANCE,
  MIN_RENDER_DISTANCE,
} from './config';
import { clamp } from './math';

export interface GameSettings {
  renderDistance: number;
  fov: number;
  sensitivity: number;
  masterVolume: number;
  clouds: boolean;
  pixelRatio: number;
  showFps: boolean;
  guiScale: number;
}

export const DEFAULT_SETTINGS: GameSettings = {
  renderDistance: DEFAULT_RENDER_DISTANCE,
  fov: 70,
  sensitivity: 1,
  masterVolume: 0.8,
  clouds: true,
  pixelRatio: 1,
  showFps: false,
  guiScale: 2,
};

const STORAGE_KEY = 'mineverse.settings.v1';

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

/** Merges stored/partial settings into a valid, clamped settings object. */
export function normalizeSettings(input: unknown): GameSettings {
  const base = { ...DEFAULT_SETTINGS };
  if (!isRecord(input)) return base;
  if (typeof input.renderDistance === 'number') {
    base.renderDistance = Math.round(clamp(input.renderDistance, MIN_RENDER_DISTANCE, MAX_RENDER_DISTANCE));
  }
  if (typeof input.fov === 'number') base.fov = Math.round(clamp(input.fov, 50, 110));
  if (typeof input.sensitivity === 'number') base.sensitivity = clamp(input.sensitivity, 0.1, 3);
  if (typeof input.masterVolume === 'number') base.masterVolume = clamp(input.masterVolume, 0, 1);
  if (typeof input.clouds === 'boolean') base.clouds = input.clouds;
  if (typeof input.pixelRatio === 'number') base.pixelRatio = clamp(input.pixelRatio, 0.5, 2);
  if (typeof input.showFps === 'boolean') base.showFps = input.showFps;
  if (typeof input.guiScale === 'number') base.guiScale = Math.round(clamp(input.guiScale, 1, 4));
  return base;
}

export function loadSettings(): GameSettings {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return { ...DEFAULT_SETTINGS };
    return normalizeSettings(JSON.parse(raw));
  } catch {
    return { ...DEFAULT_SETTINGS };
  }
}

export function saveSettings(settings: GameSettings): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(settings));
  } catch {
    // Storage can be unavailable (private mode); settings simply won't persist.
  }
}

export function resetSettings(): GameSettings {
  try {
    localStorage.removeItem(STORAGE_KEY);
  } catch {
    // ignore
  }
  return { ...DEFAULT_SETTINGS };
}
