/** Small DOM/CSS building blocks shared by every UI screen. */
import type { Slot } from '../core/types';
import { getItem } from '../world/items';
import { isEmpty, slotDurability } from '../inventory/inventory';
import { getItemIcon, getUiIcon, type UiIconName } from './icons';

export function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  className?: string,
  text?: string,
): HTMLElementTagNameMap[K] {
  const element = document.createElement(tag);
  if (className) element.className = className;
  if (text !== undefined) element.textContent = text;
  return element;
}

export function clearElement(element: HTMLElement): void {
  while (element.firstChild) element.removeChild(element.firstChild);
}

export interface ButtonOptions {
  className?: string;
  disabled?: boolean;
  title?: string;
  icon?: UiIconName;
}

/** Minecraft-style button: label centered, optional leading icon. */
export function createButton(label: string, onClick: () => void, options: ButtonOptions = {}): HTMLButtonElement {
  const button = el('button', `mv-button${options.className ? ` ${options.className}` : ''}`);
  button.type = 'button';
  if (options.title) button.title = options.title;
  if (options.icon) {
    const url = getUiIcon(options.icon);
    if (url) {
      const image = el('img', 'mv-button-icon');
      image.src = url;
      image.alt = '';
      button.appendChild(image);
    }
  }
  button.appendChild(el('span', 'mv-button-label', label));
  if (options.disabled) button.disabled = true;
  button.addEventListener('click', (event) => {
    event.stopPropagation();
    if (!button.disabled) onClick();
  });
  return button;
}

export function createSlider(
  label: string,
  value: number,
  min: number,
  max: number,
  step: number,
  format: (value: number) => string,
  onInput: (value: number) => void,
): HTMLElement {
  const wrap = el('div', 'mv-slider-row');
  const labelEl = el('span', 'mv-slider-label', label);
  const input = el('input', 'mv-slider') as HTMLInputElement;
  input.type = 'range';
  input.min = String(min);
  input.max = String(max);
  input.step = String(step);
  input.value = String(value);
  const valueEl = el('span', 'mv-slider-value', format(value));
  input.addEventListener('input', () => {
    const next = Number(input.value);
    valueEl.textContent = format(next);
    onInput(next);
  });
  wrap.append(labelEl, input, valueEl);
  return wrap;
}

export function createToggle(label: string, value: boolean, onChange: (value: boolean) => void): HTMLElement {
  const wrap = el('div', 'mv-toggle-row');
  const button = createButton(value ? '开' : '关', () => {
    const next = button.dataset.value !== 'true';
    button.dataset.value = String(next);
    button.textContent = next ? '开' : '关';
    button.classList.toggle('mv-on', next);
    onChange(next);
  }, { className: 'mv-toggle' });
  button.dataset.value = String(value);
  button.classList.toggle('mv-on', value);
  wrap.append(el('span', 'mv-slider-label', label), button);
  return wrap;
}

// ---------------------------------------------------------------------------
// Item/slot widgets
// ---------------------------------------------------------------------------

/** DOM structure of one inventory slot; update via `updateSlotElement`. */
export function createSlotElement(extraClass = ''): HTMLElement {
  const element = el('div', `mv-slot${extraClass ? ` ${extraClass}` : ''}`);
  element.appendChild(el('img', 'mv-slot-icon'));
  element.appendChild(el('span', 'mv-slot-count'));
  const durability = el('span', 'mv-slot-durability');
  durability.appendChild(el('i', 'mv-slot-durability-fill'));
  element.appendChild(durability);
  return element;
}

export function updateSlotElement(element: HTMLElement, slot: Slot | null | undefined): void {
  const icon = element.querySelector<HTMLImageElement>('.mv-slot-icon');
  const count = element.querySelector<HTMLElement>('.mv-slot-count');
  const durability = element.querySelector<HTMLElement>('.mv-slot-durability');
  const durabilityFill = element.querySelector<HTMLElement>('.mv-slot-durability-fill');
  if (!icon || !count || !durability || !durabilityFill) return;
  if (!slot || isEmpty(slot) || !slot.item) {
    icon.removeAttribute('src');
    icon.style.visibility = 'hidden';
    count.textContent = '';
    count.style.display = 'none';
    durability.style.display = 'none';
    element.dataset.item = '';
    return;
  }
  const url = getItemIcon(slot.item);
  if (url) icon.src = url;
  else icon.removeAttribute('src');
  icon.style.visibility = url ? 'visible' : 'hidden';
  element.dataset.item = slot.item;
  if (slot.count > 1) {
    count.textContent = String(slot.count);
    count.style.display = '';
  } else {
    count.textContent = '';
    count.style.display = 'none';
  }
  const def = getItem(slot.item);
  const showDurability = def?.tool !== undefined || def?.armor !== undefined;
  if (showDurability) {
    const current = slotDurability(slot);
    const base = def?.tool?.durability ?? def?.armor?.durability ?? 0;
    if (base > 0) {
      const fraction = Math.max(0, Math.min(1, current / base));
      durability.style.display = '';
      durabilityFill.style.width = `${Math.max(2, fraction * 100)}%`;
      durabilityFill.style.background = fraction > 0.5 ? '#5dd35d' : fraction > 0.2 ? '#e3c93a' : '#e14b3a';
    } else {
      durability.style.display = 'none';
    }
  } else {
    durability.style.display = 'none';
  }
}

const ARMOR_NAMES = ['头盔', '胸甲', '护腿', '靴子'];
const TOOL_NAMES: Record<string, string> = { pickaxe: '镐', axe: '斧', shovel: '锹', sword: '剑', none: '' };

/** Tooltip lines for a slot stack (title first). */
export function itemTooltipLines(itemId: string | null | undefined, slot?: Slot | null): string[] {
  if (!itemId) return [];
  const def = getItem(itemId);
  if (!def) return [itemId];
  const lines = [def.name];
  if (def.tool) {
    const kind = TOOL_NAMES[def.tool.type] ?? '';
    if (kind) lines.push(`${kind} · 挖掘等级 ${def.tool.tier} · 速度 ${def.tool.speed}`);
    lines.push(`攻击伤害 ${def.tool.damage}`);
    const durability = slot ? slotDurability(slot) : def.tool.durability;
    lines.push(`耐久 ${durability} / ${def.tool.durability}`);
  } else if (def.armor) {
    lines.push(`${ARMOR_NAMES[def.armor.slot] ?? '护甲'} · 护甲值 ${def.armor.points}`);
    const durability = slot ? slotDurability(slot) : def.armor.durability;
    lines.push(`耐久 ${durability} / ${def.armor.durability}`);
  } else if (def.food) {
    lines.push(`恢复饥饿 ${def.food.hunger} · 饱和度 ${def.food.saturation}`);
  }
  if (def.fuelTicks && def.fuelTicks > 0) lines.push(`燃料 · 燃烧 ${(def.fuelTicks / 20).toFixed(0)} 秒`);
  if (slot && slot.count > 1) lines.push(`数量 ${slot.count}`);
  return lines;
}

// ---------------------------------------------------------------------------
// Tooltip
// ---------------------------------------------------------------------------

export class Tooltip {
  readonly element: HTMLElement;
  private visible = false;

  constructor(parent: HTMLElement) {
    this.element = el('div', 'mv-tooltip');
    this.element.hidden = true;
    parent.appendChild(this.element);
  }

  show(lines: readonly string[], x: number, y: number): void {
    if (lines.length === 0) {
      this.hide();
      return;
    }
    clearElement(this.element);
    lines.forEach((line, index) => {
      const row = el('div', index === 0 ? 'mv-tooltip-title' : 'mv-tooltip-line', line);
      this.element.appendChild(row);
    });
    this.element.hidden = false;
    this.visible = true;
    this.move(x, y);
  }

  move(x: number, y: number): void {
    if (!this.visible) return;
    const width = this.element.offsetWidth || 180;
    const height = this.element.offsetHeight || 40;
    const maxX = window.innerWidth - width - 8;
    const maxY = window.innerHeight - height - 8;
    this.element.style.left = `${Math.max(4, Math.min(maxX, x + 14))}px`;
    this.element.style.top = `${Math.max(4, Math.min(maxY, y + 12))}px`;
  }

  hide(): void {
    if (!this.visible) return;
    this.visible = false;
    this.element.hidden = true;
  }
}
