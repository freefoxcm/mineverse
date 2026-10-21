import { describe, expect, it } from 'vitest';
import { PixelPainter } from '../../src/art/pixels';
import {
  UI_ICONS,
  UI_ICON_NAMES,
  createDamageVignette,
  createLogo,
  createUiIcon,
  createUnderwaterOverlay,
  drawPixelText,
  measurePixelText,
} from '../../src/art/ui';
import { TILE_SIZE } from '../../src/art/types';

/**
 * Contract tests for HUD / UI sprites:
 * - the keys UI-C asked for exist (hearts, hunger, armour, bubbles, slot, logo,
 *   flame, arrow, xp_bar, buttons);
 * - all sprites are 32x32 and deterministic;
 * - icon sprites have a transparent background, frame sprites are opaque;
 * - logo / overlays / pixel-font helpers behave.
 */

function paint(id: string): PixelPainter {
  const p = new PixelPainter(TILE_SIZE, TILE_SIZE);
  p.fill('rgba(0,0,0,0)');
  UI_ICONS[id](p);
  return p;
}

/** Keys requested by UI-C plus the extra HUD sprites we provide. */
const REQUIRED_KEYS = [
  'heart_full',
  'heart_half',
  'heart_empty',
  'hunger_full',
  'hunger_half',
  'hunger_empty',
  'armor_full',
  'armor_half',
  'armor_empty',
  'bubble_full',
  'bubble_empty',
  'slot',
  'logo',
  'xp_bar',
  'flame',
  'arrow',
];

const OPAQUE_KEYS = new Set([
  'slot',
  'slot_selected',
  'button',
  'button_hover',
  'button_pressed',
  'button_disabled',
  'panel',
  'xp_bar',
  'xp_bar_empty',
]);

const TRANSLUCENT_KEYS = new Set(['hotbar', 'hotbar_selected']);

describe('ui icons: coverage', () => {
  it('provides every key UI-C requested', () => {
    const missing = REQUIRED_KEYS.filter((key) => !(key in UI_ICONS));
    expect(missing).toEqual([]);
  });

  it('UI_ICON_NAMES mirrors the registry', () => {
    expect([...UI_ICON_NAMES].sort()).toEqual(Object.keys(UI_ICONS).sort());
    expect(new Set(UI_ICON_NAMES).size).toBe(UI_ICON_NAMES.length);
  });
});

describe('ui icons: geometry / determinism / transparency', () => {
  it('paints 32x32 deterministic sprites', () => {
    for (const id of UI_ICON_NAMES) {
      const a = paint(id);
      const b = paint(id);
      expect(a.width, id).toBe(TILE_SIZE);
      expect(a.height, id).toBe(TILE_SIZE);
      expect(Buffer.from(a.data).equals(Buffer.from(b.data)), id).toBe(true);
    }
  });

  it('is idempotent on the same buffer', () => {
    for (const id of UI_ICON_NAMES) {
      const once = paint(id);
      const twice = new PixelPainter(TILE_SIZE, TILE_SIZE);
      twice.fill('rgba(0,0,0,0)');
      UI_ICONS[id](twice);
      UI_ICONS[id](twice);
      expect(Buffer.from(once.data).equals(Buffer.from(twice.data)), id).toBe(true);
    }
  });

  it('HUD icons are drawn on a transparent background', () => {
    for (const id of UI_ICON_NAMES) {
      if (OPAQUE_KEYS.has(id) || TRANSLUCENT_KEYS.has(id)) continue;
      const p = paint(id);
      expect(p.get(0, 0)[3], id).toBe(0);
      expect(p.get(TILE_SIZE - 1, TILE_SIZE - 1)[3], id).toBe(0);
    }
  });

  it('frame sprites are fully opaque', () => {
    for (const id of OPAQUE_KEYS) {
      const p = paint(id);
      for (let i = 3; i < p.data.length; i += 4) {
        expect(p.data[i], `${id} px ${i / 4}`).toBe(255);
      }
    }
  });

  it('heart / hunger / armor states differ from each other', () => {
    for (const family of ['heart', 'hunger', 'armor']) {
      const buffers = ['full', 'half', 'empty'].map((state) =>
        Buffer.from(paint(`${family}_${state}`).data),
      );
      expect(buffers[1].equals(buffers[0]), `${family}_half`).toBe(false);
      expect(buffers[2].equals(buffers[0]), `${family}_empty`).toBe(false);
      expect(buffers[2].equals(buffers[1]), `${family}_empty vs half`).toBe(false);
    }
  });

  it('crosshair has a solid white centre', () => {
    const p = paint('crosshair');
    expect(p.get(16, 16)).toEqual([255, 255, 255, 255]);
    expect(p.get(13, 15)[3]).toBe(255);
  });

  it('slot has a dark frame and a lighter centre', () => {
    const p = paint('slot');
    expect(p.get(0, 0)[0]).toBeLessThan(90);
    expect(p.get(16, 16)[0]).toBeGreaterThan(100);
  });
});

describe('ui helpers', () => {
  it('addresses icons by id and reports unknown ids', () => {
    const p = new PixelPainter(TILE_SIZE, TILE_SIZE);
    p.fill('#ff00ff');
    expect(createUiIcon('not_an_icon')).toBeNull();
    const icon = createUiIcon('heart_full');
    expect(icon?.width).toBe(TILE_SIZE);
    expect(UI_ICONS['heart_full']).toBeTypeOf('function');
  });

  it('measures and draws the pixel font', () => {
    expect(measurePixelText('', 2)).toBe(0);
    expect(measurePixelText('AB', 1)).toBe(11);
    const p = new PixelPainter(64, 16);
    p.fill('rgba(0,0,0,0)');
    drawPixelText(p, 'AB', 0, 0, 1, '#ffffff');
    let lit = 0;
    for (let i = 3; i < p.data.length; i += 4) if (p.data[i] === 255) lit++;
    expect(lit).toBeGreaterThan(10);
  });

  it('creates a deterministic wide logo with transparent background', () => {
    const logo = createLogo();
    expect(logo.width).toBeGreaterThan(200);
    expect(logo.height).toBeGreaterThan(30);
    const again = createLogo();
    expect(Buffer.from(logo.data).equals(Buffer.from(again.data))).toBe(true);
    const corner = (0 * logo.width + 0) * 4;
    expect(logo.data[corner + 3]).toBe(0);
    // the wordmark is filled with green pixels
    let green = 0;
    for (let i = 0; i < logo.data.length; i += 4) {
      if (logo.data[i + 1] > logo.data[i] && logo.data[i + 3] === 255) green++;
    }
    expect(green).toBeGreaterThan(1000);
  });

  it('creates viewport overlays of the requested size', () => {
    const damage = createDamageVignette(96, 64);
    expect(damage.width).toBe(96);
    expect(damage.height).toBe(64);
    const centre = (32 * 96 + 48) * 4;
    const corner = 0;
    expect(damage.data[centre + 3]).toBeLessThan(20);
    expect(damage.data[corner + 3]).toBeGreaterThan(120);

    const underwater = createUnderwaterOverlay(96, 64);
    expect(underwater.width).toBe(96);
    expect(underwater.data[3]).toBeGreaterThan(0);
    expect(underwater.data[(63 * 96) * 4 + 3]).toBeGreaterThan(underwater.data[3]);
  });
});
