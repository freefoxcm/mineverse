/** Title / world-list / create-world / loading / fatal-error screens. */
import { GAME_NAME, GAME_VERSION } from '../../core/config';
import type { Difficulty, GameMode } from '../../core/types';
import type { WorldSummary } from '../bridge';
import type { GameUi } from '../gameUi';
import { createButton, createSlider, el } from '../widgets';
import { BaseScreen } from './base';

const MODE_NAMES: Record<GameMode, string> = { survival: '生存', creative: '创造' };
const DIFFICULTY_NAMES: Record<Difficulty, string> = {
  peaceful: '和平',
  easy: '简单',
  normal: '普通',
  hard: '困难',
};

function formatTimestamp(timestamp: number): string {
  if (!Number.isFinite(timestamp) || timestamp <= 0) return '未知';
  const date = new Date(timestamp);
  const pad = (value: number): string => String(value).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

/** A row of mutually exclusive option buttons. */
function optionGroup(
  labels: readonly string[],
  initial: number,
  onSelect: (index: number) => void,
): { element: HTMLElement; select: (index: number) => void } {
  const element = el('div', 'mv-option-group');
  const buttons: HTMLButtonElement[] = [];
  const select = (index: number): void => {
    buttons.forEach((button, i) => button.classList.toggle('mv-selected', i === index));
    onSelect(index);
  };
  labels.forEach((label, index) => {
    const button = createButton(label, () => select(index), { className: 'mv-option-button' });
    buttons.push(button);
    element.appendChild(button);
  });
  select(initial);
  return { element, select };
}

// ---------------------------------------------------------------------------
// Title
// ---------------------------------------------------------------------------

export class TitleScreen extends BaseScreen {
  constructor(ui: GameUi) {
    super(ui, 'title', 'menu', 'main-title');
    this.element.classList.add('mv-title-screen');
    const logo = el('div', 'mv-logo');
    logo.appendChild(el('div', 'mv-logo-main', GAME_NAME));
    logo.appendChild(el('div', 'mv-logo-sub', '方块宇宙'));

    const menu = el('div', 'mv-title-menu');
    menu.appendChild(createButton('单人游戏', () => ui.openWorldList(), { className: 'mv-button-primary mv-button-wide' }));
    menu.appendChild(createButton('设置', () => ui.openOptions(), { className: 'mv-button-wide' }));

    const help = el('div', 'mv-help-panel');
    help.hidden = true;
    const helpLines = [
      '移动 WASD   跳跃 空格   潜行 Shift   疾跑 双击 W',
      '破坏/攻击 左键   放置/使用 右键   拾取/互动 E',
      '背包 E   丢弃 Q   聊天 T   命令 /   暂停 Esc',
      '调试 F3   切换选中 1-9 / 滚轮   创造飞行 双击空格',
    ];
    for (const line of helpLines) help.appendChild(el('div', 'mv-help-line', line));
    menu.appendChild(createButton('操作说明', () => {
      help.hidden = !help.hidden;
    }, { className: 'mv-button-wide' }));

    const footer = el('div', 'mv-title-footer', `${GAME_VERSION} · 程序化体素沙盒 · WebGL2 / TypeScript`);
    this.panel.classList.add('mv-title-panel');
    this.panel.append(logo, menu, help, footer);
    this.element.appendChild(el('div', 'mv-title-splash', '程序化方块世界'));
  }
}

// ---------------------------------------------------------------------------
// World list
// ---------------------------------------------------------------------------

export class WorldListScreen extends BaseScreen {
  private readonly listEl: HTMLElement;
  private readonly emptyEl: HTMLElement;
  private readonly playButton: HTMLButtonElement;
  private readonly deleteButton: HTMLButtonElement;
  private worlds: WorldSummary[] = [];
  private selectedId: string | null = null;
  private busy = false;

  constructor(ui: GameUi) {
    super(ui, 'worldList', 'menu', 'world-list');
    this.addTitle('选择世界');
    this.listEl = el('div', 'mv-world-list');
    this.emptyEl = el('div', 'mv-world-empty', '还没有存档。点击“创建新世界”开始冒险。');
    const buttons = el('div', 'mv-button-row');
    this.playButton = createButton('进入世界', () => this.playSelected(), { className: 'mv-button-primary' });
    this.deleteButton = createButton('删除', () => this.deleteSelected(), { className: 'mv-button-danger' });
    buttons.append(
      this.playButton,
      createButton('创建新世界', () => this.ui.openCreateWorld()),
      this.deleteButton,
      createButton('返回', () => this.ui.openTitle()),
    );
    this.panel.append(this.emptyEl, this.listEl, buttons);
    void this.reload();
  }

  private async reload(): Promise<void> {
    this.busy = true;
    this.render();
    try {
      const result = this.ui.bridge.listWorlds();
      const worlds = await Promise.resolve(result);
      this.worlds = Array.isArray(worlds) ? [...worlds] : [];
    } catch {
      this.worlds = [];
      this.ui.toast('读取存档失败', 'error');
    }
    this.busy = false;
    if (this.selectedId && !this.worlds.some((world) => world.id === this.selectedId)) this.selectedId = null;
    if (!this.selectedId && this.worlds.length > 0) this.selectedId = this.worlds[0].id;
    this.render();
  }

  private render(): void {
    this.listEl.innerHTML = '';
    this.emptyEl.style.display = this.worlds.length === 0 && !this.busy ? '' : 'none';
    if (this.busy) {
      this.listEl.appendChild(el('div', 'mv-world-loading', '正在读取存档…'));
    }
    for (const world of this.worlds) {
      const row = el('div', 'mv-world-row');
      row.dataset.worldId = world.id;
      if (world.id === this.selectedId) row.classList.add('mv-selected');
      row.appendChild(el('div', 'mv-world-name', world.name));
      row.appendChild(
        el(
          'div',
          'mv-world-meta',
          `${MODE_NAMES[world.gameMode] ?? world.gameMode} · ${DIFFICULTY_NAMES[world.difficulty] ?? world.difficulty} · seed ${world.seed} · ${formatTimestamp(world.lastPlayed)}`,
        ),
      );
      row.addEventListener('mousedown', (event) => {
        event.stopPropagation();
        this.selectedId = world.id;
        this.render();
      });
      row.addEventListener('dblclick', () => {
        this.selectedId = world.id;
        this.playSelected();
      });
      this.listEl.appendChild(row);
    }
    const hasSelection = this.selectedId !== null;
    this.playButton.disabled = !hasSelection || this.busy;
    this.deleteButton.disabled = !hasSelection || this.busy;
  }

  private selectedWorld(): WorldSummary | null {
    return this.worlds.find((world) => world.id === this.selectedId) ?? null;
  }

  private playSelected(): void {
    const world = this.selectedWorld();
    if (!world) {
      this.ui.toast('请先选择一个世界', 'warn');
      return;
    }
    this.ui.playWorld(world);
  }

  private deleteSelected(): void {
    const world = this.selectedWorld();
    if (!world) return;
    if (!window.confirm(`确定删除世界“${world.name}”？此操作不可恢复。`)) return;
    try {
      const result: unknown = this.ui.bridge.deleteWorld(world.id);
      void Promise.resolve(result).then(() => this.reload());
    } catch {
      this.ui.toast('删除失败', 'error');
    }
  }
}

// ---------------------------------------------------------------------------
// Create world
// ---------------------------------------------------------------------------

export class CreateWorldScreen extends BaseScreen {
  private readonly nameInput: HTMLInputElement;
  private readonly seedInput: HTMLInputElement;
  private gameMode: GameMode = 'survival';
  private difficulty: Difficulty = 'normal';
  private renderDistance = 8;

  constructor(ui: GameUi) {
    super(ui, 'createWorld', 'menu', 'create-world');
    this.addTitle('创建新世界');
    const settings = this.safeSettings();

    const form = el('div', 'mv-form');
    const nameRow = el('label', 'mv-form-row');
    nameRow.appendChild(el('span', 'mv-form-label', '世界名称'));
    this.nameInput = el('input', 'mv-input') as HTMLInputElement;
    this.nameInput.type = 'text';
    this.nameInput.maxLength = 32;
    this.nameInput.value = '新的世界';
    this.nameInput.spellcheck = false;
    nameRow.appendChild(this.nameInput);
    form.appendChild(nameRow);

    const seedRow = el('label', 'mv-form-row');
    seedRow.appendChild(el('span', 'mv-form-label', '种子'));
    this.seedInput = el('input', 'mv-input') as HTMLInputElement;
    this.seedInput.type = 'text';
    this.seedInput.maxLength = 64;
    this.seedInput.placeholder = '留空则随机';
    this.seedInput.spellcheck = false;
    seedRow.appendChild(this.seedInput);
    form.appendChild(seedRow);

    const modeRow = el('div', 'mv-form-row');
    modeRow.appendChild(el('span', 'mv-form-label', '游戏模式'));
    const modes = [
      { key: 'survival' as GameMode, label: '生存' },
      { key: 'creative' as GameMode, label: '创造' },
    ];
    const modeGroup = optionGroup(modes.map((mode) => mode.label), 0, (index) => {
      this.gameMode = modes[index].key;
    });
    modeGroup.select(0);
    modeRow.appendChild(modeGroup.element);
    form.appendChild(modeRow);

    const difficultyRow = el('div', 'mv-form-row');
    difficultyRow.appendChild(el('span', 'mv-form-label', '难度'));
    const difficulties: Difficulty[] = ['peaceful', 'easy', 'normal', 'hard'];
    const initialDifficulty = Math.max(0, difficulties.indexOf(settings.difficulty));
    const difficultyGroup = optionGroup(difficulties.map((difficulty) => DIFFICULTY_NAMES[difficulty]), initialDifficulty, (index) => {
      this.difficulty = difficulties[index];
    });
    this.difficulty = difficulties[initialDifficulty];
    difficultyRow.appendChild(difficultyGroup.element);
    form.appendChild(difficultyRow);

    this.renderDistance = Math.max(4, Math.min(12, Math.round(settings.renderDistance)));
    form.appendChild(
      createSlider('渲染距离', this.renderDistance, 4, 12, 1, (value) => `${value} 区块`, (value) => {
        this.renderDistance = Math.round(value);
      }),
    );

    const buttons = el('div', 'mv-button-row');
    buttons.append(
      createButton('创建世界', () => this.create(), { className: 'mv-button-primary' }),
      createButton('返回', () => this.ui.openWorldList()),
    );
    this.panel.append(form, buttons);
    this.nameInput.focus();
    this.nameInput.select();
  }

  private safeSettings(): { difficulty: Difficulty; renderDistance: number } {
    try {
      const settings = this.ui.bridge.getSettings();
      return { difficulty: settings.difficulty, renderDistance: settings.renderDistance };
    } catch {
      return { difficulty: 'normal', renderDistance: 8 };
    }
  }

  private create(): void {
    const name = this.nameInput.value.trim() || '新的世界';
    const seed = this.seedInput.value.trim();
    this.ui.bridge.createWorld({
      name,
      seed,
      gameMode: this.gameMode,
      difficulty: this.difficulty,
      renderDistance: this.renderDistance,
    });
  }
}

// ---------------------------------------------------------------------------
// Loading
// ---------------------------------------------------------------------------

export class LoadingScreen extends BaseScreen {
  private readonly barEl: HTMLElement;
  private readonly statusEl: HTMLElement;

  constructor(ui: GameUi, progress: number, status: string) {
    super(ui, 'loading', 'menu', 'loading');
    const wrap = el('div', 'mv-loading');
    wrap.appendChild(el('div', 'mv-loading-title', 'MineVerse'));
    wrap.appendChild(el('div', 'mv-loading-sub', '正在进入世界'));
    const bar = el('div', 'mv-loading-bar');
    this.barEl = el('div', 'mv-loading-progress');
    bar.appendChild(this.barEl);
    this.statusEl = el('div', 'mv-loading-status', status);
    wrap.append(bar, this.statusEl);
    this.panel.classList.add('mv-loading-panel');
    this.panel.appendChild(wrap);
    this.setProgress(progress, status);
  }

  setProgress(progress: number, status: string): void {
    const clamped = Math.max(0, Math.min(1, progress));
    this.barEl.style.width = `${Math.round(clamped * 100)}%`;
    this.statusEl.textContent = status;
  }
}

// ---------------------------------------------------------------------------
// Fatal error page (WebGL missing / renderer crash)
// ---------------------------------------------------------------------------

export class ErrorScreen extends BaseScreen {
  constructor(ui: GameUi, message: string) {
    super(ui, 'error', 'menu', 'error');
    this.addTitle('无法启动 MineVerse');
    const body = el('div', 'mv-error-body');
    body.appendChild(el('div', 'mv-error-message', message));
    body.appendChild(
      el(
        'div',
        'mv-error-hint',
        '请使用最新版 Chrome / Edge / Firefox，并确认已开启浏览器的硬件加速（WebGL2 支持）。如果刚更新过显卡驱动或切换了远程桌面，请重启浏览器后重试。',
      ),
    );
    const detail = el('pre', 'mv-error-detail');
    detail.textContent = message;
    const buttons = el('div', 'mv-button-row');
    buttons.append(
      createButton('重新加载', () => location.reload(), { className: 'mv-button-primary' }),
      createButton('查看调试信息', () => {
        const errors = (window as unknown as { __MC__?: { errors?: string[] } }).__MC__?.errors;
        if (errors && errors.length > 0) detail.textContent = errors.join('\n');
        detail.hidden = !detail.hidden;
      }),
    );
    this.panel.append(body, detail, buttons);
  }
}
