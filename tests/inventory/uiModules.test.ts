/**
 * DOM-less smoke test: importing the UI module graph must not touch `document`
 * at module scope (the game itself only constructs UI widgets in the browser).
 * Icon helpers must degrade gracefully when canvas is unavailable.
 */
import { describe, expect, it } from 'vitest';
import { DEFAULT_UI_SETTINGS } from '../../src/ui/bridge';
import { artIconStats, clearIconCaches, getItemIcon, getUiIcon, hasArtItemIcon, hasArtUiIcon } from '../../src/ui/icons';

describe('UI module graph (no DOM)', () => {
  it('loads the bridge defaults', () => {
    expect(DEFAULT_UI_SETTINGS.renderDistance).toBeGreaterThanOrEqual(4);
    expect(DEFAULT_UI_SETTINGS.difficulty).toBe('normal');
    expect(typeof DEFAULT_UI_SETTINGS.volume).toBe('number');
  });

  it('discovers the Art-E icon registries through import.meta.glob', () => {
    const stats = artIconStats();
    expect(stats.items).toBeGreaterThan(50);
    expect(stats.ui).toBeGreaterThanOrEqual(10);
    expect(hasArtItemIcon('iron_pickaxe')).toBe(true);
    expect(hasArtItemIcon('apple')).toBe(true);
    expect(hasArtUiIcon('heart_full')).toBe(true);
    expect(hasArtUiIcon('bubble_empty')).toBe(true);
  });

  it('returns empty icon urls without a canvas', () => {
    clearIconCaches();
    expect(getItemIcon('iron_pickaxe')).toBe('');
    expect(getItemIcon(null)).toBe('');
    expect(getUiIcon('heart_full')).toBe('');
  });
});
