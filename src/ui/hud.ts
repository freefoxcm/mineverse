import type { Metrics, Slot } from '../core/types';
import type { GameMode } from '../core/types';

export interface HudVitals {
  health: number;
  maxHealth: number;
  hunger: number;
  air: number;
  armor: number;
  gameMode: GameMode;
}

const HOTBAR_SLOTS = 9;

/** Minimal Minecraft-style HUD. UI-C extends this with themed pixel widgets. */
export class Hud {
  private readonly root: HTMLElement;
  private readonly debugEl: HTMLElement;
  private readonly toastEl: HTMLElement;
  private readonly hotbarEl: HTMLElement;
  private readonly heartsEl: HTMLElement;
  private readonly hungerEl: HTMLElement;
  private readonly armorEl: HTMLElement;
  private readonly airEl: HTMLElement;
  private readonly slotEls: HTMLElement[] = [];
  private debugVisible = false;
  private toastTimer = 0;
  private lastVitalsKey = '';

  constructor(parent: HTMLElement) {
    this.root = document.createElement('div');
    this.root.className = 'hud';
    this.root.innerHTML = `
      <div class="crosshair"></div>
      <div class="hud-bottom">
        <div class="vitals">
          <div class="vitals-row">
            <div class="hearts"></div>
            <div class="armor"></div>
          </div>
          <div class="vitals-row">
            <div class="hunger"></div>
            <div class="air"></div>
          </div>
        </div>
        <div class="hotbar"></div>
      </div>
      <div class="debug-panel" hidden></div>
      <div class="toast"></div>
    `;
    parent.appendChild(this.root);
    this.debugEl = this.root.querySelector('.debug-panel')!;
    this.toastEl = this.root.querySelector('.toast')!;
    this.hotbarEl = this.root.querySelector('.hotbar')!;
    this.heartsEl = this.root.querySelector('.hearts')!;
    this.hungerEl = this.root.querySelector('.hunger')!;
    this.armorEl = this.root.querySelector('.armor')!;
    this.airEl = this.root.querySelector('.air')!;

    for (let i = 0; i < HOTBAR_SLOTS; i++) {
      const slot = document.createElement('div');
      slot.className = 'hotbar-slot';
      this.hotbarEl.appendChild(slot);
      this.slotEls.push(slot);
    }
    this.updateVitals({ health: 20, maxHealth: 20, hunger: 20, air: 10, armor: 0, gameMode: 'survival' });
  }

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

  updateHotbar(slots: Slot[], selected: number): void {
    for (let i = 0; i < HOTBAR_SLOTS; i++) {
      const element = this.slotEls[i];
      element.classList.toggle('selected', i === selected);
      const slot = slots[i];
      element.dataset.item = slot?.item ?? '';
    }
  }

  updateVitals(vitals: HudVitals): void {
    const key = `${vitals.health}|${vitals.hunger}|${vitals.air}|${vitals.armor}|${vitals.gameMode}`;
    if (key === this.lastVitalsKey) return;
    this.lastVitalsKey = key;
    if (vitals.gameMode === 'creative') {
      this.heartsEl.classList.add('creative');
      this.hungerEl.classList.add('creative');
      return;
    }
    this.heartsEl.innerHTML = this.renderIconRow('heart', vitals.health, vitals.maxHealth, 2);
    this.hungerEl.innerHTML = this.renderIconRow('hunger', vitals.hunger, 20, 2);
    this.armorEl.innerHTML =
      vitals.armor > 0 ? this.renderIconRow('armor', vitals.armor, 20, 2) : '';
    this.airEl.innerHTML = vitals.air < 10 ? this.renderIconRow('bubble', vitals.air, 10, 1) : '';
  }

  private renderIconRow(kind: string, value: number, max: number, perIcon: number): string {
    const count = Math.ceil(max / perIcon);
    let html = '';
    for (let i = 0; i < count; i++) {
      const filled = Math.max(0, Math.min(perIcon, value - i * perIcon));
      const state = filled === perIcon ? 'full' : filled > 0 ? 'half' : 'empty';
      html += `<span class="icon icon-${kind} ${state}"></span>`;
    }
    return html;
  }

  showToast(message: string, kind: 'info' | 'warn' | 'error' = 'info'): void {
    this.toastEl.textContent = message;
    this.toastEl.className = `toast toast-visible toast-${kind}`;
    window.clearTimeout(this.toastTimer);
    this.toastTimer = window.setTimeout(() => {
      this.toastEl.className = 'toast';
    }, 3200);
  }

  updateDebug(text: string): void {
    this.debugEl.textContent = text;
  }

  setDebugVisible(visible: boolean): void {
    this.debugVisible = visible;
    this.debugEl.hidden = !visible;
  }

  toggleDebug(): boolean {
    this.setDebugVisible(!this.debugVisible);
    return this.debugVisible;
  }

  updateMetrics(metrics: Metrics): void {
    if (!this.debugVisible) return;
    const lines = [
      `MineVerse ${metrics.fps.toFixed(0)} fps  ${metrics.frameMs.toFixed(2)} ms`,
      `draw calls ${metrics.drawCalls}  tris ${metrics.triangles.toLocaleString()}`,
      `columns ${metrics.columns}  meshes ${metrics.meshes}  heap ${metrics.heapMB.toFixed(0)} MB`,
      `seed ${(window as unknown as { __MC__?: { world: { seed: string } } }).__MC__?.world.seed ?? ''}`,
    ];
    this.updateDebug(lines.join('\n'));
  }

  setVisible(visible: boolean): void {
    this.root.style.display = visible ? '' : 'none';
  }

  dispose(): void {
    this.root.remove();
  }
}
