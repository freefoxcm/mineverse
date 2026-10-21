/**
 * `GameUi` owns the whole DOM UI: HUD bindings, screen stack, keyboard routing,
 * slot cursor / click semantics, tooltips and the chat log.
 *
 * The Lead only needs to:
 *   1. implement `GameUiBridge` (see bridge.ts),
 *   2. create `const ui = new GameUi(uiRoot, bridge)`,
 *   3. call `ui.update(dtMs)` every frame,
 *   4. call `ui.handleKeyDown(event)` from the global keydown listener and stop
 *      the player input when it returns true.
 */
import type { Slot } from '../core/types';
import type { ChatEntry, GameUiBridge, ToastKind, UiScreenId, WorldSummary } from './bridge';
import type { ContainerAccess } from '../inventory/blockEntities';
import {
  addToSlots,
  cloneSlot,
  createEmptySlot,
  isEmpty,
  itemStackLimit,
  normalizeSlot,
} from '../inventory/inventory';
import type { Inventory } from '../inventory/inventory';
import { getItem } from '../world/items';
import { Hud } from './hud';
import { Tooltip, createSlotElement, el, itemTooltipLines, updateSlotElement } from './widgets';
import type { Screen, SlotHandle } from './screens/base';
import { CreateWorldScreen, ErrorScreen, LoadingScreen, TitleScreen, WorldListScreen } from './screens/menu';
import { ChatScreen, DeathScreen, OptionsScreen, PauseScreen } from './screens/gameplay';
import { ChestScreen, CraftingScreen, FurnaceScreen, InventoryScreen } from './screens/containers';
import { CreativeScreen } from './screens/creative';
import '../styles/ui.css';

export interface GameUiOptions {
  /** Reuse a HUD created by the Lead; otherwise GameUi creates its own. */
  hud?: Hud;
  /** Attach a document keydown listener (handy for quick wiring / E2E). */
  autoKeyboard?: boolean;
}

const CHAT_MAX_ENTRIES = 100;
const CHAT_OVERLAY_LINES = 8;

function isContainerAccess(value: unknown): value is ContainerAccess {
  if (!value || typeof value !== 'object') return false;
  const kind = (value as { kind?: unknown }).kind;
  return kind === 'chest' || kind === 'furnace';
}

export class GameUi {
  readonly root: HTMLElement;
  readonly bridge: GameUiBridge;
  readonly hud: Hud;
  private readonly tooltip: Tooltip;
  private readonly cursorEl: HTMLElement;
  private readonly chatLogEl: HTMLElement;
  private readonly stack: Screen[] = [];
  private cursor: Slot = createEmptySlot();
  private gameplayActive = false;
  private mouseX = 0;
  private mouseY = 0;
  private hoveredIndex = -1;
  private hoveredScreen: Screen | null = null;
  private chatLog: ChatEntry[] = [];
  private chatDirty = true;
  private disposed = false;
  private readonly onDocumentMouseMove: (event: MouseEvent) => void;
  private readonly onDocumentKeyDown: ((event: KeyboardEvent) => void) | null;

  constructor(parent: HTMLElement, bridge: GameUiBridge, options: GameUiOptions = {}) {
    this.bridge = bridge;
    this.root = el('div', 'mv-ui');
    parent.appendChild(this.root);
    this.hud = options.hud ?? new Hud(parent);
    this.hud.setVisible(false);
    this.tooltip = new Tooltip(this.root);

    this.cursorEl = createSlotElement('mv-cursor');
    this.cursorEl.style.display = 'none';
    this.root.appendChild(this.cursorEl);
    this.chatLogEl = el('div', 'mv-chatlog');
    this.root.appendChild(this.chatLogEl);

    this.root.addEventListener('mousedown', (event) => this.onMouseDown(event));
    this.root.addEventListener('contextmenu', (event) => event.preventDefault());

    this.onDocumentMouseMove = (event) => this.onMouseMove(event);
    document.addEventListener('mousemove', this.onDocumentMouseMove);

    if (options.autoKeyboard) {
      this.onDocumentKeyDown = (event) => {
        if (this.handleKeyDown(event)) event.preventDefault();
      };
      document.addEventListener('keydown', this.onDocumentKeyDown);
    } else {
      this.onDocumentKeyDown = null;
    }
  }

  // =========================================================================
  // Public automation / Lead API
  // =========================================================================

  /** Current screen id, `'none'` while playing with the HUD only. */
  getScreen(): UiScreenId {
    return this.currentScreen()?.id ?? 'none';
  }

  openScreen(name: string, data?: unknown): boolean {
    switch (name) {
      case 'none':
        this.closeAllScreens();
        this.onStackChanged();
        return true;
      case 'title':
        this.openTitle();
        return true;
      case 'worldList':
      case 'worldlist':
      case 'worlds':
        this.openWorldList();
        return true;
      case 'createWorld':
      case 'createworld':
        this.openCreateWorld();
        return true;
      case 'loading':
        this.showLoading(0, '正在加载…');
        return true;
      case 'error':
        this.showError(typeof data === 'string' ? data : '发生未知错误。');
        return true;
      case 'pause':
        this.openPause();
        return true;
      case 'options':
      case 'settings':
        this.openOptions();
        return true;
      case 'inventory':
        this.openInventory();
        return true;
      case 'crafting':
      case 'craftingTable':
        this.openCraftingTable();
        return true;
      case 'furnace':
        this.openFurnace(isContainerAccess(data) ? data : undefined);
        return true;
      case 'chest':
        this.openChest(isContainerAccess(data) ? data : undefined);
        return true;
      case 'creative':
        this.openCreative();
        return true;
      case 'death':
        this.openDeath();
        return true;
      case 'chat':
        this.openChat();
        return true;
      default:
        return false;
    }
  }

  closeScreen(): boolean {
    if (this.stack.length === 0) return false;
    this.popScreen();
    return true;
  }

  /** Turn on HUD/gameplay mode once a world finished loading. */
  setGameplayActive(active: boolean): void {
    this.gameplayActive = active;
    if (!active) this.closeAllScreens();
    this.onStackChanged();
  }

  isGameplayActive(): boolean {
    return this.gameplayActive;
  }

  // -- world/flow -----------------------------------------------------------

  openTitle(): void {
    this.gameplayActive = false;
    this.closeAllScreens(false);
    this.showScreen(new TitleScreen(this));
    this.onStackChanged();
  }

  openWorldList(): void {
    this.showScreen(new WorldListScreen(this));
  }

  openCreateWorld(): void {
    this.showScreen(new CreateWorldScreen(this));
  }

  showLoading(progress: number, status: string): void {
    const current = this.currentScreen();
    if (current && current.id === 'loading' && current instanceof LoadingScreen) {
      current.setProgress(progress, status);
      return;
    }
    this.showScreen(new LoadingScreen(this, progress, status));
  }

  hideLoading(): void {
    if (this.getScreen() === 'loading') {
      this.closeScreen();
    }
  }

  showError(message: string): void {
    this.gameplayActive = false;
    this.closeAllScreens(false);
    this.showScreen(new ErrorScreen(this, message));
    this.onStackChanged();
  }

  // -- overlays -------------------------------------------------------------

  openPause(): void {
    if (this.getScreen() === 'pause') return;
    this.showScreen(new PauseScreen(this));
  }

  openOptions(): void {
    this.showScreen(new OptionsScreen(this));
  }

  openInventory(): void {
    this.showScreen(new InventoryScreen(this));
  }

  openCraftingTable(): void {
    this.showScreen(new CraftingScreen(this));
  }

  openChest(access?: ContainerAccess): void {
    this.showScreen(new ChestScreen(this, access));
  }

  openFurnace(access?: ContainerAccess): void {
    this.showScreen(new FurnaceScreen(this, access));
  }

  openCreative(): void {
    this.showScreen(new CreativeScreen(this));
  }

  openDeath(): void {
    this.closeAllScreens(false);
    this.showScreen(new DeathScreen(this));
    this.onStackChanged();
  }

  openChat(prefix = ''): void {
    if (this.getScreen() === 'chat') return;
    this.showScreen(new ChatScreen(this, prefix));
  }

  playWorld(world: WorldSummary): void {
    this.bridge.playWorld(world);
  }

  // -- inventory automation -------------------------------------------------

  selectSlot(index: number): void {
    const inventory = this.bridge.getInventory();
    inventory.setSelectedSlot(index);
    this.afterSlotChange();
  }

  getHotbarSlot(index: number): Slot {
    const inventory = this.bridge.getInventory();
    const clamped = Math.max(0, Math.min(8, Math.floor(index)));
    return cloneSlot(inventory.slots[clamped]);
  }

  /** Programmatically click slot `index` of the current screen (E2E helper). */
  clickSlot(index: number, button = 0, shift = false): void {
    const screen = this.currentScreen();
    if (!screen) return;
    const handle = screen.handleAt(index);
    if (!handle) return;
    this.applyClick(handle, button === 2 ? 2 : 0, shift);
  }

  getCursor(): Slot {
    return this.cursor;
  }

  setCursorStack(slot: Slot | null): void {
    this.setCursor(slot ?? createEmptySlot());
  }

  getHoveredSlotIndex(): number {
    return this.hoveredIndex;
  }

  isPointerLocked(): boolean {
    if (document.pointerLockElement !== null) return true;
    return this.bridge.isPointerLocked?.() === true;
  }

  // -- chat -----------------------------------------------------------------

  addChatLine(text: string, kind: ChatEntry['kind'] = 'chat'): void {
    if (!text) return;
    this.chatLog.push({ text, kind, time: Date.now() });
    if (this.chatLog.length > CHAT_MAX_ENTRIES) this.chatLog.splice(0, this.chatLog.length - CHAT_MAX_ENTRIES);
    this.chatDirty = true;
    if (this.getScreen() === 'chat') this.refreshScreen();
  }

  getChatLog(): readonly ChatEntry[] {
    return this.chatLog;
  }

  clearChatLog(): void {
    this.chatLog = [];
    this.chatDirty = true;
    this.renderChatLog();
  }

  // -- tooltip --------------------------------------------------------------

  showTooltip(lines: readonly string[]): void {
    this.tooltip.show(lines, this.mouseX, this.mouseY);
  }

  hideTooltip(): void {
    this.tooltip.hide();
  }

  toast(message: string, kind: ToastKind = 'info'): void {
    this.bridge.showToast(message, kind);
  }

  // =========================================================================
  // Frame update
  // =========================================================================

  update(dtMs: number): void {
    if (this.disposed) return;
    if (this.gameplayActive) {
      const player = this.bridge.getPlayer();
      this.hud.updateVitals({
        health: player.health,
        maxHealth: player.maxHealth,
        hunger: player.hunger,
        air: player.air,
        maxAir: player.maxAir ?? 10,
        armor: player.armorPoints,
        gameMode: player.gameMode,
        saturation: player.saturation,
      });
      const inventory = this.bridge.getInventory();
      this.hud.updateHotbar(inventory.slots, inventory.selected);
      this.hud.setUnderwater(player.inWater);
      this.hud.setGameMode(player.gameMode);
      this.updateDebugInfo();
    }
    const metrics = this.bridge.getMetrics?.();
    if (metrics) this.hud.updateMetrics(metrics);
    const screen = this.currentScreen();
    if (screen?.update) screen.update(dtMs);
    if (this.chatDirty) this.renderChatLog();
    this.updateCursorPosition();
  }

  private updateDebugInfo(): void {
    try {
      const player = this.bridge.getPlayer();
      const world = this.bridge.getWorld();
      const inventory = this.bridge.getInventory();
      const cx = Math.floor(player.position.x / 16);
      const cz = Math.floor(player.position.z / 16);
      const yaw = ((player.yaw * 180) / Math.PI).toFixed(1);
      const pitch = ((player.pitch * 180) / Math.PI).toFixed(1);
      const tickTime = ((world.timeOfDay % 24000) + 24000) % 24000;
      const totalMinutes = Math.floor(((tickTime / 1000 + 6) % 24) * 60);
      const clock = `${String(Math.floor(totalMinutes / 60)).padStart(2, '0')}:${String(totalMinutes % 60).padStart(2, '0')}`;
      const flags = [
        player.onGround ? '着地' : '空中',
        player.inWater ? '水中' : '',
        player.sprinting ? '疾跑' : '',
        player.sneaking ? '潜行' : '',
      ].filter(Boolean);
      this.hud.setDebugContext([
        `XYZ ${player.position.x.toFixed(2)} / ${player.position.y.toFixed(2)} / ${player.position.z.toFixed(2)}   区块 ${cx} ${cz}`,
        `朝向 ${yaw}° / ${pitch}°   ${flags.join(' ')}`,
        `生命 ${player.health.toFixed(1)}/${player.maxHealth}   饥饿 ${player.hunger.toFixed(1)}/20   护甲 ${player.armorPoints}   空气 ${player.air}`,
        `${player.gameMode === 'creative' ? '创造' : '生存'} · ${world.difficulty} · 第 ${world.day} 天 ${clock} · 手持 ${this.heldItemName(inventory)}`,
        `seed ${world.seed}  区块 ${world.loadedColumns ?? '?'}  背包 ${inventory.usedSlots()}/36`,
      ]);
    } catch {
      // The bridge is not fully wired yet; keep the HUD alive.
    }
  }

  private heldItemName(inventory: Inventory): string {
    const held = inventory.getHeld();
    if (isEmpty(held) || !held.item) return '空手';
    return getItem(held.item)?.name ?? held.item;
  }

  // =========================================================================
  // Keyboard
  // =========================================================================

  /**
   * Route one keydown through the UI. Returns true when the UI consumed it and
   * the player input should ignore the event.
   */
  handleKeyDown(event: KeyboardEvent): boolean {
    if (this.disposed) return false;
    const target = event.target as HTMLElement | null;
    const inFormField =
      target instanceof HTMLElement &&
      (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.tagName === 'SELECT');
    const screen = this.currentScreen();

    if (event.code === 'F3' && !inFormField) {
      this.hud.toggleDebug();
      return true;
    }

    if (screen) {
      if (inFormField) {
        if (event.code === 'Escape') {
          this.handleEscape();
          return true;
        }
        return false;
      }
      if (screen.onKeyDown?.(event)) return true;
      if (event.code === 'Escape') {
        this.handleEscape();
        return true;
      }
      // Swallow gameplay keys while a screen is open.
      if (event.code === 'KeyW' || event.code === 'KeyA' || event.code === 'KeyS' || event.code === 'KeyD' || event.code === 'Space') {
        return true;
      }
      return false;
    }

    if (!this.gameplayActive) return false;
    switch (event.code) {
      case 'Escape':
        this.openPause();
        return true;
      case 'KeyE': {
        const player = this.bridge.getPlayer();
        if (player.dead) return true;
        if (player.gameMode === 'creative') this.openCreative();
        else this.openInventory();
        return true;
      }
      case 'KeyT':
        this.openChat();
        return true;
      case 'Slash':
        this.openChat('/');
        return true;
      default:
        return false;
    }
  }

  private handleEscape(): void {
    const screen = this.currentScreen();
    if (!screen) {
      if (this.gameplayActive) this.openPause();
      return;
    }
    if (screen.kind === 'menu') {
      if (screen.id === 'worldList') this.openTitle();
      else if (screen.id === 'createWorld') this.openWorldList();
      else if (screen.id === 'loading') this.closeScreen();
      return;
    }
    if (screen.id === 'pause') {
      this.closeScreen();
      return;
    }
    if (screen.id === 'death') return;
    this.closeScreen();
  }

  // =========================================================================
  // Screen stack
  // =========================================================================

  private currentScreen(): Screen | null {
    return this.stack.length > 0 ? this.stack[this.stack.length - 1] : null;
  }

  private showScreen(screen: Screen): void {
    if (screen.kind === 'menu') this.hud.hideBoot();
    const top = this.currentScreen();
    if (screen.kind === 'menu') {
      this.closeAllScreens(false);
    } else if (top) {
      const canStack = screen.id === 'options' && (top.id === 'pause' || top.kind === 'menu');
      if (!canStack) this.popScreen(false);
    }
    this.stack.push(screen);
    this.root.appendChild(screen.element);
    screen.mount();
    this.onStackChanged();
    this.hideTooltip();
  }

  private popScreen(updateState = true): Screen | null {
    const top = this.stack.pop();
    if (!top) return null;
    this.returnCursorToInventory();
    top.unmount();
    top.element.remove();
    this.hoveredIndex = -1;
    this.hoveredScreen = null;
    if (updateState) this.onStackChanged();
    return top;
  }

  private closeAllScreens(updateState = true): void {
    while (this.stack.length > 0) this.popScreen(false);
    if (updateState) this.onStackChanged();
  }

  private onStackChanged(): void {
    const screen = this.currentScreen();
    const paused = this.stack.length > 0 || !this.gameplayActive;
    this.bridge.setPaused(paused);
    this.bridge.onScreenChange(screen?.id ?? 'none');
    const hudVisible = this.gameplayActive && this.stack.length === 0;
    this.hud.setVisible(hudVisible);
    this.hud.setCrosshairVisible(hudVisible);
    if (hudVisible) {
      this.refreshHotbar();
    } else {
      this.hideTooltip();
    }
    this.updateCursor();
    this.renderChatLog();
  }

  private refreshScreen(): void {
    this.currentScreen()?.refresh?.();
  }

  private refreshHotbar(): void {
    const inventory = this.bridge.getInventory();
    this.hud.updateHotbar(inventory.slots, inventory.selected);
  }

  /** Refresh UI after any inventory mutation; notifies the Lead's bridge. */
  afterSlotChange(): void {
    this.bridge.notifyInventoryChanged();
    this.refreshScreen();
    this.refreshHotbar();
    this.updateCursor();
  }

  // =========================================================================
  // Cursor stack
  // =========================================================================

  private setCursor(slot: Slot | null): void {
    this.cursor = slot && !isEmpty(slot) ? cloneSlot(slot) : createEmptySlot();
    this.updateCursor();
  }

  private updateCursor(): void {
    updateSlotElement(this.cursorEl, this.cursor);
    this.cursorEl.style.display = isEmpty(this.cursor) ? 'none' : '';
    this.updateCursorPosition();
  }

  private updateCursorPosition(): void {
    if (this.cursorEl.style.display === 'none') return;
    this.cursorEl.style.left = `${this.mouseX - 20}px`;
    this.cursorEl.style.top = `${this.mouseY - 20}px`;
  }

  private returnCursorToInventory(): void {
    if (isEmpty(this.cursor)) return;
    const inventory = this.bridge.getInventory();
    const leftover = addToSlots(inventory.slots, this.cursor);
    if (!isEmpty(leftover) && leftover.item) {
      this.bridge.dropItem(leftover.item, leftover.count, leftover.durability);
    }
    this.setCursor(createEmptySlot());
    this.bridge.notifyInventoryChanged();
  }

  // =========================================================================
  // Mouse / slot interactions
  // =========================================================================

  private onMouseMove(event: MouseEvent): void {
    this.mouseX = event.clientX;
    this.mouseY = event.clientY;
    this.updateCursorPosition();
    const screen = this.currentScreen();
    if (!screen) {
      this.hoveredIndex = -1;
      this.tooltip.hide();
      return;
    }
    const target = event.target;
    const slotElement = target instanceof HTMLElement ? (target.closest('.mv-slot') as HTMLElement | null) : null;
    if (slotElement && screen.element.contains(slotElement)) {
      const index = Number(slotElement.dataset.slotIndex);
      if (Number.isInteger(index)) {
        if (this.hoveredIndex !== index || this.hoveredScreen !== screen) {
          this.hoveredIndex = index;
          this.hoveredScreen = screen;
          this.refreshTooltipForHover();
        } else {
          this.tooltip.move(this.mouseX, this.mouseY);
        }
        return;
      }
    }
    if (this.hoveredIndex !== -1) {
      this.hoveredIndex = -1;
      this.tooltip.hide();
    }
  }

  private refreshTooltipForHover(): void {
    const screen = this.currentScreen();
    if (!screen || this.hoveredIndex < 0) return;
    const handle = screen.handleAt(this.hoveredIndex);
    if (!handle) return;
    const custom = handle.tooltip?.();
    const lines = custom ?? itemTooltipLines(handle.get().item, handle.get());
    this.tooltip.show(lines, this.mouseX, this.mouseY);
  }

  private onMouseDown(event: MouseEvent): void {
    if (event.button !== 0 && event.button !== 2) return;
    const screen = this.currentScreen();
    if (!screen) return;
    const target = event.target;
    const slotElement = target instanceof HTMLElement ? (target.closest('.mv-slot') as HTMLElement | null) : null;
    if (slotElement && screen.element.contains(slotElement)) {
      const index = Number(slotElement.dataset.slotIndex);
      const handle = Number.isInteger(index) ? screen.handleAt(index) : undefined;
      if (handle) {
        event.preventDefault();
        this.applyClick(handle, event.button === 2 ? 2 : 0, event.shiftKey);
        return;
      }
    }
    // Clicking the dark overlay while holding a stack drops it (vanilla-like).
    if (!isEmpty(this.cursor) && screen.element === target) {
      event.preventDefault();
      this.dropCursor();
    }
  }

  private dropCursor(): void {
    if (isEmpty(this.cursor)) return;
    const dropped = cloneSlot(this.cursor);
    this.setCursor(createEmptySlot());
    if (dropped.item) this.bridge.dropItem(dropped.item, dropped.count, dropped.durability);
    this.afterSlotChange();
  }

  private applyClick(handle: SlotHandle, button: 0 | 2, shift: boolean): void {
    if (shift) {
      if (handle.shiftClick) handle.shiftClick();
      else this.defaultShiftClick(handle);
      this.afterSlotChange();
      return;
    }
    if (handle.take) {
      const result = handle.take(this.cursor);
      if (result && !isEmpty(result)) {
        if (isEmpty(this.cursor)) {
          this.setCursor(result);
        } else {
          const merged = cloneSlot(this.cursor);
          merged.count += result.count;
          this.setCursor(merged);
        }
        this.afterSlotChange();
      }
      return;
    }
    if (button === 2) this.rightClick(handle);
    else this.leftClick(handle);
    this.afterSlotChange();
  }

  private canPlace(handle: SlotHandle, stack: Slot): boolean {
    return handle.canPlace ? handle.canPlace(stack) : true;
  }

  private leftClick(handle: SlotHandle): void {
    const slot = cloneSlot(handle.get());
    if (isEmpty(this.cursor)) {
      if (isEmpty(slot)) return;
      handle.set(createEmptySlot());
      this.setCursor(slot);
      return;
    }
    if (isEmpty(slot)) {
      if (!this.canPlace(handle, this.cursor)) return;
      handle.set(cloneSlot(this.cursor));
      this.setCursor(createEmptySlot());
      return;
    }
    const limit = itemStackLimit(slot.item);
    if (this.cursor.item === slot.item && limit > 1) {
      const space = limit - slot.count;
      const moved = Math.min(space, this.cursor.count);
      if (moved <= 0) return;
      slot.count += moved;
      handle.set(slot);
      const remaining = cloneSlot(this.cursor);
      remaining.count -= moved;
      this.setCursor(remaining);
      return;
    }
    if (!this.canPlace(handle, this.cursor)) return;
    handle.set(cloneSlot(this.cursor));
    this.setCursor(slot);
  }

  private rightClick(handle: SlotHandle): void {
    const slot = cloneSlot(handle.get());
    if (isEmpty(this.cursor)) {
      if (isEmpty(slot)) return;
      const take = Math.ceil(slot.count / 2);
      const picked = cloneSlot(slot);
      picked.count = take;
      slot.count -= take;
      handle.set(isEmpty(slot) ? createEmptySlot() : slot);
      this.setCursor(picked);
      return;
    }
    if (isEmpty(slot)) {
      if (!this.canPlace(handle, this.cursor)) return;
      const placed = cloneSlot(this.cursor);
      placed.count = 1;
      handle.set(placed);
      const remaining = cloneSlot(this.cursor);
      remaining.count -= 1;
      this.setCursor(remaining);
      return;
    }
    if (this.cursor.item === slot.item && itemStackLimit(slot.item) > 1 && slot.count < itemStackLimit(slot.item)) {
      slot.count += 1;
      handle.set(slot);
      const remaining = cloneSlot(this.cursor);
      remaining.count -= 1;
      this.setCursor(remaining);
    }
  }

  private defaultShiftClick(handle: SlotHandle): void {
    const slot = cloneSlot(handle.get());
    if (isEmpty(slot)) return;
    const inventory = this.bridge.getInventory();
    const leftover = addToSlots(inventory.slots, slot);
    handle.set(leftover);
  }

  // -- public helpers used by screens ---------------------------------------

  getHoveredHandle(): SlotHandle | null {
    const screen = this.currentScreen();
    if (!screen || this.hoveredIndex < 0) return null;
    return screen.handleAt(this.hoveredIndex) ?? null;
  }

  swapHandleWithHotbar(handle: SlotHandle, hotbarIndex: number): void {
    if (handle.take) return;
    const inventory = this.bridge.getInventory();
    const index = Math.max(0, Math.min(8, Math.floor(hotbarIndex)));
    const hotbarSlot = inventory.slots[index];
    if (handle.canPlace && !handle.canPlace(hotbarSlot) && !isEmpty(hotbarSlot)) return;
    const current = cloneSlot(handle.get());
    handle.set(isEmpty(hotbarSlot) ? createEmptySlot() : cloneSlot(hotbarSlot));
    inventory.slots[index] = normalizeSlot(current);
    this.afterSlotChange();
  }

  dropHoveredOrCursor(): void {
    if (!isEmpty(this.cursor)) {
      this.dropCursor();
      return;
    }
    const handle = this.getHoveredHandle();
    if (!handle || handle.take) return;
    const slot = handle.get();
    if (isEmpty(slot) || !slot.item) return;
    const dropped: Slot = { item: slot.item, count: 1 };
    if (slot.durability !== undefined) dropped.durability = slot.durability;
    slot.count -= 1;
    if (slot.count <= 0) handle.set(createEmptySlot());
    this.bridge.dropItem(slot.item, 1, dropped.durability);
    this.afterSlotChange();
  }

  // =========================================================================
  // Chat overlay
  // =========================================================================

  private renderChatLog(): void {
    this.chatDirty = false;
    const screen = this.currentScreen();
    if (screen?.id === 'chat' || this.chatLog.length === 0) {
      this.chatLogEl.style.display = 'none';
      return;
    }
    this.chatLogEl.style.display = '';
    this.chatLogEl.innerHTML = '';
    for (const entry of this.chatLog.slice(-CHAT_OVERLAY_LINES)) {
      const line = el('div', `mv-chatlog-line mv-chatlog-${entry.kind}`, entry.text);
      if (entry.kind === 'error') line.classList.add('mv-chatlog-error');
      this.chatLogEl.appendChild(line);
    }
  }

  // =========================================================================
  // Lifecycle
  // =========================================================================

  dispose(): void {
    this.disposed = true;
    document.removeEventListener('mousemove', this.onDocumentMouseMove);
    if (this.onDocumentKeyDown) document.removeEventListener('keydown', this.onDocumentKeyDown);
    for (const screen of this.stack) {
      screen.unmount();
      screen.element.remove();
    }
    this.stack.length = 0;
    this.root.remove();
  }
}
