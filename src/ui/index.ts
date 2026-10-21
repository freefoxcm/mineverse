/**
 * Public UI surface for `main.ts`:
 *   import { GameUi, Hud } from './ui';
 *   import type { GameUiBridge } from './ui';
 */
export { GameUi, type GameUiOptions } from './gameUi';
export { Hud, type HudVitals, type ToastKind } from './hud';
export {
  DEFAULT_UI_SETTINGS,
  type ChatEntry,
  type CommandResult,
  type ContainerScreenData,
  type CreateWorldOptions,
  type GameUiBridge,
  type ScreenData,
  type UiPlayerSnapshot,
  type UiScreenId,
  type UiSettings,
  type UiWorldInfo,
  type WorldSummary,
} from './bridge';
export { getItemIcon, getUiIcon, hasArtItemIcon, clearIconCaches, type UiIconName } from './icons';
export type { Screen, SlotHandle } from './screens/base';
