import '@fontsource/silkscreen/400.css';
import './styles/main.css';

import { Game } from './game';

const canvas = document.getElementById('game-canvas') as HTMLCanvasElement | null;
const uiRoot = document.getElementById('ui-root') as HTMLElement | null;
const bootStatus = document.getElementById('boot-status');

if (!canvas || !uiRoot) {
  throw new Error('MineVerse: 缺少 canvas 或 ui-root 节点');
}

const game = new Game(canvas, uiRoot);

game.init().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  if (bootStatus) bootStatus.textContent = `初始化失败：${message}`;
  console.error(error);
});
