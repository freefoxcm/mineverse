/** Pause / options / death / chat screens. */
import type { Difficulty, GameMode } from '../../core/types';
import type { CommandResult, UiSettings } from '../bridge';
import type { GameUi } from '../gameUi';
import { createButton, createSlider, createToggle, el } from '../widgets';
import { BaseScreen } from './base';

const DIFFICULTIES: readonly { key: Difficulty; label: string }[] = [
  { key: 'peaceful', label: '和平' },
  { key: 'easy', label: '简单' },
  { key: 'normal', label: '普通' },
  { key: 'hard', label: '困难' },
];

// ---------------------------------------------------------------------------
// Pause
// ---------------------------------------------------------------------------

export class PauseScreen extends BaseScreen {
  constructor(ui: GameUi) {
    super(ui, 'pause', 'overlay', 'pause');
    const panel = el('div', 'mv-pause-panel');
    panel.appendChild(el('div', 'mv-screen-title mv-pause-title', '游戏暂停'));
    const menu = el('div', 'mv-pause-menu');
    menu.append(
      createButton('返回游戏', () => ui.closeScreen(), { className: 'mv-button-primary mv-button-wide' }),
      createButton('设置', () => ui.openOptions(), { className: 'mv-button-wide' }),
      createButton('保存游戏', () => this.save(), { className: 'mv-button-wide' }),
      createButton('保存并退出', () => {
        const result: unknown = ui.bridge.saveAndQuit();
        void Promise.resolve(result);
      }, { className: 'mv-button-wide' }),
      createButton('返回标题', () => {
        void Promise.resolve(ui.bridge.quitToTitle());
      }, { className: 'mv-button-wide' }),
    );
    panel.appendChild(menu);
    this.panel.classList.add('mv-pause-panel-wrap');
    this.panel.appendChild(panel);
  }

  private save(): void {
    try {
      const result: unknown = this.ui.bridge.save();
      void Promise.resolve(result).then(
        () => this.ui.toast('世界已保存'),
        () => this.ui.toast('保存失败', 'error'),
      );
    } catch {
      this.ui.toast('保存失败', 'error');
    }
  }

  override onKeyDown(event: KeyboardEvent): boolean {
    if (event.code === 'Escape') {
      this.ui.closeScreen();
      return true;
    }
    return false;
  }
}

// ---------------------------------------------------------------------------
// Options / settings
// ---------------------------------------------------------------------------

export class OptionsScreen extends BaseScreen {
  private settings: UiSettings;

  constructor(ui: GameUi) {
    super(ui, 'options', 'overlay', 'options');
    this.addTitle('设置');
    this.settings = this.readSettings();
    const scroll = el('div', 'mv-options-scroll');

    // Difficulty
    const difficultyRow = el('div', 'mv-option-row');
    difficultyRow.appendChild(el('span', 'mv-option-label', '难度'));
    const difficultyGroup = el('div', 'mv-option-group');
    DIFFICULTIES.forEach((entry) => {
      const button = createButton(entry.label, () => {
        this.settings = { ...this.settings, difficulty: entry.key };
        for (const child of Array.from(difficultyGroup.children)) child.classList.remove('mv-selected');
        button.classList.add('mv-selected');
        this.apply({ difficulty: entry.key });
      }, { className: 'mv-option-button' });
      if (entry.key === this.settings.difficulty) button.classList.add('mv-selected');
      difficultyGroup.appendChild(button);
    });
    difficultyRow.appendChild(difficultyGroup);
    scroll.appendChild(difficultyRow);

    scroll.appendChild(
      createSlider('渲染距离', this.settings.renderDistance, 4, 12, 1, (value) => `${value} 区块`, (value) => {
        this.apply({ renderDistance: Math.round(value) });
      }),
    );
    scroll.appendChild(
      createSlider('视野 (FOV)', this.settings.fov, 50, 110, 1, (value) => `${Math.round(value)}°`, (value) => {
        this.apply({ fov: Math.round(value) });
      }),
    );
    scroll.appendChild(
      createSlider('鼠标灵敏度', this.settings.mouseSensitivity, 0.2, 2, 0.05, (value) => value.toFixed(2), (value) => {
        this.apply({ mouseSensitivity: Math.round(value * 100) / 100 });
      }),
    );
    scroll.appendChild(
      createSlider('音量', this.settings.volume, 0, 1, 0.05, (value) => `${Math.round(value * 100)}%`, (value) => {
        this.apply({ volume: Math.round(value * 100) / 100 });
      }),
    );
    scroll.appendChild(
      createSlider('渲染像素比', this.settings.pixelRatio, 1, 2, 0.25, (value) => `${value.toFixed(2)}x`, (value) => {
        this.apply({ pixelRatio: Math.round(value * 100) / 100 });
      }),
    );
    scroll.appendChild(
      createToggle('云层', this.settings.clouds, (value) => {
        this.apply({ clouds: value });
      }),
    );
    scroll.appendChild(
      createToggle('显示 FPS', this.settings.showFps, (value) => {
        this.apply({ showFps: value });
      }),
    );

    const buttons = el('div', 'mv-button-row');
    buttons.append(createButton('完成', () => ui.closeScreen(), { className: 'mv-button-primary' }));
    this.panel.append(scroll, buttons);
  }

  private readSettings(): UiSettings {
    try {
      return { ...this.ui.bridge.getSettings() };
    } catch {
      return {
        difficulty: 'normal',
        renderDistance: 8,
        fov: 75,
        mouseSensitivity: 1,
        volume: 0.8,
        clouds: true,
        pixelRatio: 1,
        showFps: true,
      };
    }
  }

  private apply(patch: Partial<UiSettings>): void {
    this.settings = { ...this.settings, ...patch };
    try {
      this.ui.bridge.updateSettings(patch);
    } catch {
      // ignore persistence errors; the UI still reflects the new value
    }
  }
}

// ---------------------------------------------------------------------------
// Death
// ---------------------------------------------------------------------------

export class DeathScreen extends BaseScreen {
  constructor(ui: GameUi) {
    super(ui, 'death', 'overlay', 'death');
    this.addTitle('你死了！');
    const body = el('div', 'mv-death-body');
    body.appendChild(el('div', 'mv-death-score', '生命归零，物品掉落在死亡地点。'));
    const buttons = el('div', 'mv-death-buttons');
    buttons.append(
      createButton('重生', () => this.respawn(), { className: 'mv-button-primary mv-button-wide' }),
      createButton('返回标题', () => {
        void Promise.resolve(ui.bridge.quitToTitle());
      }, { className: 'mv-button-wide' }),
    );
    body.appendChild(buttons);
    this.panel.classList.add('mv-death-panel');
    this.panel.appendChild(body);
  }

  private respawn(): void {
    try {
      this.ui.bridge.respawn();
    } catch {
      // the Lead will respawn the player; the screen still closes
    }
    this.ui.closeScreen();
  }

  override onKeyDown(event: KeyboardEvent): boolean {
    if (event.code === 'Escape') return true;
    if (event.code === 'Enter') {
      this.respawn();
      return true;
    }
    return false;
  }
}

// ---------------------------------------------------------------------------
// Chat / commands
// ---------------------------------------------------------------------------

export class ChatScreen extends BaseScreen {
  private readonly logEl: HTMLElement;
  private readonly input: HTMLInputElement;
  private readonly history: string[] = [];
  private historyIndex = -1;

  constructor(ui: GameUi, prefix = '') {
    super(ui, 'chat', 'overlay', 'chat');
    this.element.classList.add('mv-chat-screen');
    this.panel.classList.add('mv-chat-panel');
    this.logEl = el('div', 'mv-chat-log');
    const inputRow = el('div', 'mv-chat-input-row');
    const prompt = el('span', 'mv-chat-prompt', '>');
    this.input = el('input', 'mv-input mv-chat-input') as HTMLInputElement;
    this.input.type = 'text';
    this.input.maxLength = 256;
    this.input.spellcheck = false;
    this.input.autocomplete = 'off';
    this.input.value = prefix;
    inputRow.append(prompt, this.input);
    this.panel.append(this.logEl, inputRow);
    this.refresh();

    this.input.addEventListener('keydown', (event) => {
      event.stopPropagation();
      if (event.code === 'Enter') {
        event.preventDefault();
        this.submit();
      } else if (event.code === 'Escape') {
        event.preventDefault();
        this.ui.closeScreen();
      } else if (event.code === 'ArrowUp') {
        event.preventDefault();
        this.navigateHistory(-1);
      } else if (event.code === 'ArrowDown') {
        event.preventDefault();
        this.navigateHistory(1);
      }
    });
    // Focus after the screen has been mounted.
    window.setTimeout(() => {
      this.input.focus();
      const length = this.input.value.length;
      this.input.setSelectionRange(length, length);
    }, 0);
  }

  protected override onRefresh(): void {
    this.renderLog();
  }

  private renderLog(): void {
    this.logEl.innerHTML = '';
    for (const entry of this.ui.getChatLog()) {
      this.logEl.appendChild(el('div', `mv-chat-line mv-chat-${entry.kind}`, entry.text));
    }
    this.logEl.scrollTop = this.logEl.scrollHeight;
  }

  private navigateHistory(direction: number): void {
    if (this.history.length === 0) return;
    this.historyIndex = Math.max(-1, Math.min(this.history.length - 1, this.historyIndex + direction));
    this.input.value = this.historyIndex >= 0 ? this.history[this.historyIndex] : '';
    const length = this.input.value.length;
    this.input.setSelectionRange(length, length);
  }

  private submit(): void {
    const text = this.input.value.trim();
    this.input.value = '';
    if (!text) {
      this.ui.closeScreen();
      return;
    }
    this.history.push(text);
    this.historyIndex = this.history.length;
    if (text.startsWith('/')) {
      try {
        const result: CommandResult | Promise<CommandResult> = this.ui.bridge.executeCommand(text.slice(1));
        void Promise.resolve(result).then(
          (commandResult) => {
            if (commandResult?.message) this.ui.addChatLine(commandResult.message, commandResult.ok ? 'system' : 'error');
          },
          () => this.ui.addChatLine('命令执行失败', 'error'),
        );
      } catch {
        this.ui.addChatLine('命令执行失败', 'error');
      }
    } else {
      try {
        this.ui.bridge.chat(text);
      } catch {
        // ignore chat failures
      }
      this.ui.addChatLine(`[你] ${text}`);
    }
    this.ui.closeScreen();
  }
}

// Re-exported for screens that render the held game mode.
export type { GameMode };
