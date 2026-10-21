/**
 * In-game HUD: health / hunger / armor / air, hotbar with icons, counts and
 * durability, crosshair, underwater tint, damage vignette, toasts and the F3
 * debug overlay.
 *
 * Compatibility: the Lead's `main.ts` may keep calling the M0 API while the
 * rest of the UI is wired (`setBootProgress`, `hideBoot`, `updateHotbar`,
 * `updateVitals`, `updateMetrics`, `toggleDebug`). All methods are preserved.
 */
import { GAME_NAME, GAME_VERSION } from '../core/config';
import type { GameMode, Metrics, Slot } from '../core/types';
import { getItem } from '../world/items';
import { getItemIcon, getUiIcon, type UiIconName } from './icons';
import { createSlotElement, el, updateSlotElement } from './widgets';
import '../styles/hud.css';

export interface HudVitals {
  health: number;
  maxHealth: number;
  hunger: number;
  air: number;
  armor: number;
  gameMode: GameMode;
  saturation?: number;
  /** Bubbles shown; defaults to 10 (matches the M0 placeholder HUD). */
  maxAir?: number;
}

export type ToastKind = 'info' | 'warn' | 'error';

const HOTBAR_SLOTS = 9;

interface VitalsState extends HudVitals {
  maxAir: number;
}

export class Hud {
  readonly root: HTMLElement;
  private readonly underwaterEl: HTMLElement;
  private readonly damageEl: HTMLElement;
  private readonly crosshairEl: HTMLElement;
  private readonly heartsEl: HTMLElement;
  private readonly hungerEl: HTMLElement;
  private readonly armorEl: HTMLElement;
  private readonly airEl: HTMLElement;
  private readonly hotbarEl: HTMLElement;
  private readonly heldNameEl: HTMLElement;
  private readonly debugEl: HTMLElement;
  private readonly toastEl: HTMLElement;
  private readonly slotEls: HTMLElement[] = [];
  private readonly iconCache = new Map<string, string>();
  private vitalsKey = '';
  private lastHealth = -1;
  private debugVisible = false;
  private metricsText = '';
  private debugContext: string[] = [];
  private toastTimer = 0;
  private heldNameTimer = 0;
  private lastSelected = -1;
  private lastHotbarKey = '';
  private hasHotbar = false;

  constructor(parent: HTMLElement) {
    this.root = el('div', 'mv-hud');
    this.root.innerHTML = `
      <div class="mv-underwater"></div>
      <div class="mv-damage-flash"></div>
      <div class="mv-crosshair"></div>
      <div class="mv-hud-bottom">
        <div class="mv-vitals">
          <div class="mv-vitals-column mv-vitals-left">
            <div class="mv-vitals-row mv-armor-row"></div>
            <div class="mv-vitals-row mv-hearts-row"></div>
          </div>
          <div class="mv-vitals-column mv-vitals-right">
            <div class="mv-vitals-row mv-air-row"></div>
            <div class="mv-vitals-row mv-hunger-row"></div>
          </div>
        </div>
        <div class="mv-hotbar-wrap">
          <div class="mv-held-name"></div>
          <div class="mv-hotbar"></div>
        </div>
      </div>
      <div class="mv-debug" hidden></div>
      <div class="mv-toast"></div>
    `;
    parent.appendChild(this.root);
    this.underwaterEl = this.root.querySelector('.mv-underwater')!;
    this.damageEl = this.root.querySelector('.mv-damage-flash')!;
    this.crosshairEl = this.root.querySelector('.mv-crosshair')!;
    this.heartsEl = this.root.querySelector('.mv-hearts-row')!;
    this.hungerEl = this.root.querySelector('.mv-hunger-row')!;
    this.armorEl = this.root.querySelector('.mv-armor-row')!;
    this.airEl = this.root.querySelector('.mv-air-row')!;
    this.hotbarEl = this.root.querySelector('.mv-hotbar')!;
    this.heldNameEl = this.root.querySelector('.mv-held-name')!;
    this.debugEl = this.root.querySelector('.mv-debug')!;
    this.toastEl = this.root.querySelector('.mv-toast')!;

    for (let i = 0; i < HOTBAR_SLOTS; i++) {
      const slot = createSlotElement('mv-hotbar-slot');
      slot.appendChild(el('span', 'mv-hotbar-index', String(i + 1)));
      this.hotbarEl.appendChild(slot);
      this.slotEls.push(slot);
    }
  }

  // -- boot overlay (M0 compatibility) -------------------------------------

  setBootProgress(progress: number, status: string): void {
    const bar = document.getElementById('boot-progress');
    const label = document.getElementById('boot-status');
    if (bar) bar.style.width = `${Math.round(Math.max(0, Math.min(1, progress)) * 100)}%`;
    if (label) label.textContent = status;
  }

  hideBoot(): void {
    const overlay = document.getElementById('boot-overlay');
    if (overlay) overlay.classList.add('boot-hidden');
  }

  // -- hotbar --------------------------------------------------------------

  updateHotbar(slots: readonly Slot[], selected: number): void {
    this.hasHotbar = true;
    const key =
      slots
        .slice(0, HOTBAR_SLOTS)
        .map((slot) => `${slot?.item ?? ''}:${slot?.count ?? 0}:${slot?.durability ?? 0}`)
        .join('|') + `#${selected}`;
    if (key === this.lastHotbarKey) return;
    const selectionChanged = selected !== this.lastSelected;
    this.lastHotbarKey = key;
    this.lastSelected = selected;
    for (let i = 0; i < HOTBAR_SLOTS; i++) {
      const slotEl = this.slotEls[i];
      updateSlotElement(slotEl, slots[i]);
      slotEl.classList.toggle('selected', i === selected);
    }
    const slot = slots[selected];
    if (selectionChanged) {
      this.showHeldName(slot?.item ? (getItem(slot.item)?.name ?? slot.item) : '');
    }
  }

  private showHeldName(name: string): void {
    this.heldNameEl.textContent = name;
    this.heldNameEl.classList.toggle('mv-visible', name.length > 0);
    window.clearTimeout(this.heldNameTimer);
    if (name) {
      this.heldNameTimer = window.setTimeout(() => this.heldNameEl.classList.remove('mv-visible'), 1800);
    }
  }

  // -- vitals --------------------------------------------------------------

  updateVitals(vitals: HudVitals): void {
    const state: VitalsState = { ...vitals, maxAir: vitals.maxAir ?? 10 };
    const key = `${state.health}|${state.maxHealth}|${state.hunger}|${state.air}|${state.maxAir}|${state.armor}|${state.gameMode}`;
    if (state.health < this.lastHealth && this.lastHealth > 0) this.flashDamage();
    this.lastHealth = state.health;
    if (key === this.vitalsKey) return;
    this.vitalsKey = key;
    const creative = state.gameMode === 'creative';
    this.root.classList.toggle('mv-creative', creative);
    this.root.classList.toggle('mv-low-health', !creative && state.health <= 6);
    if (creative) {
      this.renderIconRow(this.heartsEl, 'heart', 0, state.maxHealth, 2);
      this.renderIconRow(this.hungerEl, 'hunger', 0, 20, 2);
      this.renderIconRow(this.armorEl, 'armor', 0, 20, 2);
      this.renderIconRow(this.airEl, 'bubble', 0, state.maxAir, 1);
      return;
    }
    this.renderIconRow(this.heartsEl, 'heart', state.health, state.maxHealth, 2);
    this.renderIconRow(this.hungerEl, 'hunger', state.hunger, 20, 2);
    this.renderIconRow(this.armorEl, 'armor', state.armor, 20, 2);
    this.renderIconRow(this.airEl, 'bubble', state.air, state.maxAir, 1);
    this.airEl.classList.toggle('mv-row-hidden', state.air >= state.maxAir);
    this.armorEl.classList.toggle('mv-row-hidden', state.armor <= 0);
  }

  private iconUrl(kind: string, state: 'full' | 'half' | 'empty'): string {
    const key = `${kind}_${state}`;
    const cached = this.iconCache.get(key);
    if (cached !== undefined) return cached;
    const url = getUiIcon(key as UiIconName);
    this.iconCache.set(key, url);
    return url;
  }

  private renderIconRow(container: HTMLElement, kind: string, value: number, max: number, perIcon: number): void {
    const count = Math.ceil(max / perIcon);
    const total = Math.max(0, Math.min(max, value));
    while (container.children.length > count) container.removeChild(container.lastChild!);
    for (let i = 0; i < count; i++) {
      const filled = Math.max(0, Math.min(perIcon, total - i * perIcon));
      const state: 'full' | 'half' | 'empty' = filled >= perIcon ? 'full' : filled > 0 ? 'half' : 'empty';
      let image = container.children[i] as HTMLImageElement | undefined;
      if (!image) {
        image = el('img', 'mv-icon') as HTMLImageElement;
        image.alt = '';
        image.draggable = false;
        container.appendChild(image);
      }
      image.dataset.state = state;
      const url = this.iconUrl(kind, state);
      if (url && image.getAttribute('src') !== url) image.src = url;
    }
  }

  // -- overlays ------------------------------------------------------------

  flashDamage(): void {
    this.damageEl.classList.remove('mv-flash-active');
    // Force a reflow so the CSS animation restarts on rapid hits.
    void this.damageEl.offsetWidth;
    this.damageEl.classList.add('mv-flash-active');
  }

  setUnderwater(underwater: boolean): void {
    this.underwaterEl.classList.toggle('mv-active', underwater);
    this.root.classList.toggle('mv-underwater-active', underwater);
  }

  setCrosshairVisible(visible: boolean): void {
    this.crosshairEl.style.display = visible ? '' : 'none';
  }

  setGameMode(mode: GameMode): void {
    this.root.classList.toggle('mv-creative', mode === 'creative');
  }

  // -- toast ---------------------------------------------------------------

  showToast(message: string, kind: ToastKind = 'info'): void {
    this.toastEl.textContent = message;
    this.toastEl.className = `mv-toast mv-toast-visible mv-toast-${kind}`;
    window.clearTimeout(this.toastTimer);
    this.toastTimer = window.setTimeout(() => {
      this.toastEl.className = 'mv-toast';
    }, 3200);
  }

  // -- F3 debug ------------------------------------------------------------

  updateDebug(text: string): void {
    this.debugContext = text.length > 0 ? text.split('\n') : [];
    this.renderDebug();
  }

  setDebugContext(lines: readonly string[]): void {
    if (lines.length === this.debugContext.length && lines.every((line, index) => line === this.debugContext[index])) return;
    this.debugContext = [...lines];
    this.renderDebug();
  }

  updateMetrics(metrics: Metrics): void {
    const memory = (performance as unknown as { memory?: { usedJSHeapSize: number } }).memory;
    const heap = memory ? memory.usedJSHeapSize / (1024 * 1024) : metrics.heapMB;
    const lines = [
      `${GAME_NAME} ${GAME_VERSION}  ${metrics.fps.toFixed(0)} fps  ${metrics.frameMs.toFixed(2)} ms`,
      `draw calls ${metrics.drawCalls}  tris ${metrics.triangles.toLocaleString()}  heap ${heap.toFixed(0)} MB`,
      `columns ${metrics.columns}  meshes ${metrics.meshes}  entities ${metrics.entities}`,
    ];
    this.metricsText = lines.join('\n');
    this.renderDebug();
  }

  private renderDebug(): void {
    if (!this.debugVisible) return;
    const blocks = [this.metricsText, this.debugContext.join('\n')].filter((part) => part.length > 0);
    this.debugEl.textContent = blocks.join('\n');
  }

  setDebugVisible(visible: boolean): void {
    this.debugVisible = visible;
    this.debugEl.hidden = !visible;
    this.root.classList.toggle('mv-debug-visible', visible);
    if (visible) this.renderDebug();
  }

  isDebugVisible(): boolean {
    return this.debugVisible;
  }

  toggleDebug(): boolean {
    this.setDebugVisible(!this.debugVisible);
    return this.debugVisible;
  }

  // -- visibility / lifecycle ----------------------------------------------

  setVisible(visible: boolean): void {
    this.root.style.display = visible ? '' : 'none';
  }

  isVisible(): boolean {
    return this.root.style.display !== 'none';
  }

  setHotbarVisible(visible: boolean): void {
    this.hotbarEl.parentElement!.style.display = visible ? '' : 'none';
  }

  /** True after the first `updateHotbar` call (used by GameUi bootstrapping). */
  hasHotbarData(): boolean {
    return this.hasHotbar;
  }

  dispose(): void {
    window.clearTimeout(this.toastTimer);
    window.clearTimeout(this.heldNameTimer);
    this.root.remove();
  }
}

/** Convenience export for screens that need a raw item icon URL. */
export function itemIconUrl(itemId: string): string {
  return getItemIcon(itemId);
}
