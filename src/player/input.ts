/**
 * Keyboard / mouse / pointer-lock input.
 *
 * The pure part (`InputState` + handle* functions) is DOM-free and unit-tested;
 * `InputManager` / `attachInput` wire real events in the browser. Lead only
 * needs to call `attachInput(canvas)` once and drive the player each frame:
 *
 *   const input = attachInput(canvas);
 *   input.requestPointerLock();              // on click / resume
 *   const look = input.consumeLook();        // pixels
 *   player.look(look.x, look.y, input.sensitivity);
 *   player.input.forward = ...;              // or:
 *   Object.assign(player.input, toPlayerInput(input.state));
 *   input.endFrame();                        // clears edge triggers
 */

import { MOUSE_SENSITIVITY_BASE } from '../core/math';
import type { PlayerInput } from './player';

export const DOUBLE_TAP_MS = 300;

export type KeyAction =
  | 'forward'
  | 'back'
  | 'left'
  | 'right'
  | 'jump'
  | 'sneak'
  | 'sprint'
  | 'inventory'
  | 'drop'
  | 'pause';

/** Default bindings: WASD, Space, Shift sneak, Ctrl sprint. */
export const DEFAULT_KEY_BINDINGS: Readonly<Record<string, KeyAction>> = {
  KeyW: 'forward',
  KeyS: 'back',
  KeyA: 'left',
  KeyD: 'right',
  Space: 'jump',
  ShiftLeft: 'sneak',
  ShiftRight: 'sneak',
  ControlLeft: 'sprint',
  ControlRight: 'sprint',
  KeyE: 'inventory',
  KeyQ: 'drop',
  Escape: 'pause',
};

export interface InputState {
  forward: boolean;
  back: boolean;
  left: boolean;
  right: boolean;
  jump: boolean;
  jumpPressed: boolean;
  sneak: boolean;
  sprint: boolean;
  attack: boolean;
  attackPressed: boolean;
  use: boolean;
  usePressed: boolean;
  useReleased: boolean;
  inventoryPressed: boolean;
  dropPressed: boolean;
  pausePressed: boolean;
  /** Edge: Space was double tapped within DOUBLE_TAP_MS (creative flight). */
  doubleJump: boolean;
  /** Edge: hotbar slot 0..8 selected with digit keys, else null. */
  hotbarSlot: number | null;
  /** Horizontal mouse motion accumulated since the last consume. */
  mouseDx: number;
  mouseDy: number;
  /** Wheel notches accumulated since the last consume. */
  scroll: number;
  /** performance.now() of the last Space press (for double-tap detection). */
  lastJumpAt: number;
  pointerLocked: boolean;
}

export function createInputState(): InputState {
  return {
    forward: false,
    back: false,
    left: false,
    right: false,
    jump: false,
    jumpPressed: false,
    sneak: false,
    sprint: false,
    attack: false,
    attackPressed: false,
    use: false,
    usePressed: false,
    useReleased: false,
    inventoryPressed: false,
    dropPressed: false,
    pausePressed: false,
    doubleJump: false,
    hotbarSlot: null,
    mouseDx: 0,
    mouseDy: 0,
    scroll: 0,
    lastJumpAt: Number.NEGATIVE_INFINITY,
    pointerLocked: false,
  };
}

/** Apply a keydown. Returns true when the key is bound and was handled. */
export function handleKeyDown(state: InputState, code: string, nowMs: number): boolean {
  // Hotbar digits 1..9.
  if (code.length === 6 && code.startsWith('Digit')) {
    const digit = Number(code.slice(5));
    if (digit >= 1 && digit <= 9) {
      state.hotbarSlot = digit - 1;
      return true;
    }
  }
  const action = DEFAULT_KEY_BINDINGS[code];
  if (!action) return false;
  switch (action) {
    case 'forward':
      state.forward = true;
      break;
    case 'back':
      state.back = true;
      break;
    case 'left':
      state.left = true;
      break;
    case 'right':
      state.right = true;
      break;
    case 'jump':
      if (!state.jump) {
        state.jumpPressed = true;
        if (nowMs - state.lastJumpAt <= DOUBLE_TAP_MS) state.doubleJump = true;
        state.lastJumpAt = nowMs;
      }
      state.jump = true;
      break;
    case 'sneak':
      state.sneak = true;
      break;
    case 'sprint':
      state.sprint = true;
      break;
    case 'inventory':
      state.inventoryPressed = true;
      break;
    case 'drop':
      state.dropPressed = true;
      break;
    case 'pause':
      state.pausePressed = true;
      break;
  }
  return true;
}

/** Apply a keyup. Returns true when handled. */
export function handleKeyUp(state: InputState, code: string): boolean {
  const action = DEFAULT_KEY_BINDINGS[code];
  if (!action) return false;
  switch (action) {
    case 'forward':
      state.forward = false;
      break;
    case 'back':
      state.back = false;
      break;
    case 'left':
      state.left = false;
      break;
    case 'right':
      state.right = false;
      break;
    case 'jump':
      state.jump = false;
      break;
    case 'sneak':
      state.sneak = false;
      break;
    case 'sprint':
      state.sprint = false;
      break;
    default:
      break;
  }
  return true;
}

/** Mouse buttons: 0 = attack, 2 = use. Returns true when handled. */
export function handleMouseButton(state: InputState, button: number, down: boolean): boolean {
  if (button === 0) {
    if (down && !state.attack) state.attackPressed = true;
    state.attack = down;
    return true;
  }
  if (button === 2) {
    if (down && !state.use) state.usePressed = true;
    if (!down && state.use) state.useReleased = true;
    state.use = down;
    return true;
  }
  return false;
}

/** Accumulate relative mouse motion (pointer-locked movementX/Y). */
export function applyLookDelta(state: InputState, deltaX: number, deltaY: number): void {
  state.mouseDx += deltaX;
  state.mouseDy += deltaY;
}

/** Clear held keys/buttons (window blur, pointer lock lost). */
export function releaseAllInput(state: InputState): void {
  state.forward = false;
  state.back = false;
  state.left = false;
  state.right = false;
  state.jump = false;
  state.sneak = false;
  state.sprint = false;
  state.attack = false;
  state.use = false;
}

/** Clear one-shot edges at the end of a frame. */
export function endFrameInput(state: InputState): void {
  state.jumpPressed = false;
  state.attackPressed = false;
  state.usePressed = false;
  state.useReleased = false;
  state.inventoryPressed = false;
  state.dropPressed = false;
  state.pausePressed = false;
  state.doubleJump = false;
  state.hotbarSlot = null;
}

/** Convert to the player's movement input structure. */
export function toPlayerInput(state: InputState): PlayerInput {
  return {
    forward: (state.forward ? 1 : 0) - (state.back ? 1 : 0),
    strafe: (state.right ? 1 : 0) - (state.left ? 1 : 0),
    jump: state.jump,
    jumpPressed: state.jumpPressed,
    sneak: state.sneak,
    sprint: state.sprint,
    flyVertical: state.jump ? 1 : state.sneak ? -1 : 0,
    toggleFly: state.doubleJump,
  };
}

// ---------------------------------------------------------------------------
// DOM wiring
// ---------------------------------------------------------------------------

export interface InputManagerOptions {
  /** Mouse sensitivity multiplier applied by the player when consuming look. */
  sensitivity?: number;
  /** Request pointer lock automatically on the first click (default true). */
  autoRequestPointerLock?: boolean;
  /** Prevent default browser behavior for handled keys/wheel (default true). */
  preventDefault?: boolean;
}

/**
 * DOM input controller. Attach events once, then read `state` / consume deltas
 * every frame. Programmatic `press`/`release`/`click` make automation possible
 * without pointer lock (used by E2E and tests).
 */
export class InputManager {
  readonly state = createInputState();
  readonly target: HTMLElement;
  sensitivity: number;
  private readonly options: Required<InputManagerOptions>;
  private readonly disposers: (() => void)[] = [];
  private enabled = true;

  constructor(target: HTMLElement, options: InputManagerOptions = {}) {
    this.target = target;
    this.sensitivity = options.sensitivity ?? 1;
    this.options = {
      sensitivity: this.sensitivity,
      autoRequestPointerLock: options.autoRequestPointerLock ?? true,
      preventDefault: options.preventDefault ?? true,
    };
    this.attach();
  }

  get pointerLocked(): boolean {
    return this.state.pointerLocked;
  }

  private add<K extends keyof DocumentEventMap>(
    target: Document | Window | HTMLElement,
    type: K,
    listener: (event: DocumentEventMap[K]) => void,
    options?: AddEventListenerOptions,
  ): void {
    target.addEventListener(type, listener as EventListener, options);
    this.disposers.push(() => target.removeEventListener(type, listener as EventListener, options));
  }

  private attach(): void {
    if (typeof window === 'undefined' || typeof document === 'undefined') return;

    this.add(window, 'keydown', (event) => {
      if (!this.enabled) return;
      // Never swallow browser/OS shortcuts (Ctrl+F5, Ctrl+Shift+R, Ctrl+R,
      // Alt+…). Ctrl alone still drives sprint, so keep the Control keys.
      const controlKey = event.code === 'ControlLeft' || event.code === 'ControlRight';
      const modifier = event.ctrlKey || event.metaKey || event.altKey;
      const hardReload =
        (event.code === 'F5' && (event.ctrlKey || event.metaKey || event.shiftKey)) ||
        (event.code === 'KeyR' && (event.ctrlKey || event.metaKey));
      if (!controlKey && (modifier || hardReload)) return;
      if (handleKeyDown(this.state, event.code, performance.now()) && this.options.preventDefault) {
        event.preventDefault();
      }
    });
    this.add(window, 'keyup', (event) => {
      if (!this.enabled) return;
      if (handleKeyUp(this.state, event.code) && this.options.preventDefault) event.preventDefault();
    });
    this.add(this.target, 'mousedown', (event) => {
      if (!this.enabled) return;
      if (handleMouseButton(this.state, event.button, true)) {
        event.preventDefault();
        if (this.options.autoRequestPointerLock && !this.state.pointerLocked) {
          this.requestPointerLock();
        }
      }
    });
    this.add(window, 'mouseup', (event) => {
      if (!this.enabled) return;
      if (handleMouseButton(this.state, event.button, false) && this.options.preventDefault) {
        event.preventDefault();
      }
    });
    this.add(this.target, 'contextmenu', (event) => {
      if (this.enabled) event.preventDefault();
    });
    this.add(document, 'mousemove', (event) => {
      if (!this.enabled || !this.state.pointerLocked) return;
      applyLookDelta(this.state, event.movementX, event.movementY);
    });
    this.add(this.target, 'wheel', (event) => {
      if (!this.enabled) return;
      this.state.scroll += Math.sign(event.deltaY);
      if (this.options.preventDefault) event.preventDefault();
    }, { passive: false });
    this.add(document, 'pointerlockchange', () => {
      const locked = document.pointerLockElement === this.target;
      this.state.pointerLocked = locked;
      if (!locked) releaseAllInput(this.state);
    });
    this.add(window, 'blur', () => {
      releaseAllInput(this.state);
    });
  }

  requestPointerLock(): void {
    const element = this.target as HTMLElement & { requestPointerLock?: () => Promise<void> | void };
    if (typeof element.requestPointerLock !== 'function') return;
    try {
      const result = element.requestPointerLock();
      if (result && typeof (result as Promise<void>).catch === 'function') {
        (result as Promise<void>).catch(() => undefined);
      }
    } catch {
      // Pointer lock may be rejected (e.g. not from a user gesture); ignore.
    }
  }

  exitPointerLock(): void {
    if (typeof document !== 'undefined' && document.pointerLockElement) document.exitPointerLock();
  }

  /** Return accumulated mouse movement in pixels and reset it. */
  consumeLook(): { x: number; y: number } {
    const delta = { x: this.state.mouseDx, y: this.state.mouseDy };
    this.state.mouseDx = 0;
    this.state.mouseDy = 0;
    return delta;
  }

  consumeScroll(): number {
    const notches = this.state.scroll;
    this.state.scroll = 0;
    return notches;
  }

  consumeHotbarSlot(): number | null {
    const slot = this.state.hotbarSlot;
    this.state.hotbarSlot = null;
    return slot;
  }

  /** Clear one-shot edges; call once per rendered frame after reading input. */
  endFrame(): void {
    endFrameInput(this.state);
  }

  setEnabled(enabled: boolean): void {
    this.enabled = enabled;
    if (!enabled) releaseAllInput(this.state);
  }

  /** Programmatic key press (E2E / debug). */
  press(code: string): void {
    handleKeyDown(this.state, code, performance.now());
  }

  /** Programmatic key release. */
  release(code: string): void {
    handleKeyUp(this.state, code);
  }

  /** Programmatic mouse button (0 attack, 2 use). */
  click(button: number): void {
    handleMouseButton(this.state, button, true);
    handleMouseButton(this.state, button, false);
  }

  /** Programmatic look delta (pixels), useful before pointer lock is granted. */
  lookBy(deltaX: number, deltaY: number): void {
    applyLookDelta(this.state, deltaX, deltaY);
  }

  dispose(): void {
    for (const dispose of this.disposers) dispose();
    this.disposers.length = 0;
  }
}

/** Attach keyboard/mouse/pointer-lock input to the game canvas. */
export function attachInput(target: HTMLElement, options: InputManagerOptions = {}): InputManager {
  return new InputManager(target, options);
}

export { MOUSE_SENSITIVITY_BASE };
