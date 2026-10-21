import type { GameMode, Vec3, WorldTime } from './types';
import { getItem } from '../world/items';

export interface CommandWorld {
  getSeed(): string;
  getTime(): WorldTime;
  setTime(ticks: number): void;
  getSpawnPoint(): Vec3;
  setSpawnPoint(point: Vec3): void;
}

export interface CommandContext {
  world: CommandWorld;
  getGameMode(): GameMode;
  setGameMode(mode: GameMode): void;
  getPlayerPosition(): Vec3;
  teleport(point: Vec3): void;
  giveItem(itemId: string, count: number): boolean;
  clearInventory(): void;
  killPlayer(): void;
}

export interface ParsedCommand {
  name: string;
  args: string[];
}

export interface CommandResult {
  ok: boolean;
  message: string;
}

const TIME_PRESETS: Record<string, number> = {
  sunrise: 0,
  morning: 0,
  day: 1000,
  noon: 6000,
  afternoon: 9000,
  sunset: 12000,
  night: 13000,
  midnight: 18000,
};

export const HELP_LINES = [
  '/help — 显示命令列表',
  '/seed — 显示世界种子',
  '/time set <day|noon|night|midnight|ticks> — 设置时间',
  '/gamemode <survival|creative> — 切换游戏模式',
  '/tp <x> <y> <z> — 传送',
  '/give <item> [count] — 给予物品',
  '/clear — 清空背包',
  '/kill — 自杀重生',
  '/spawnpoint — 将出生点设在此处',
];

export function parseCommand(raw: string): ParsedCommand | null {
  const trimmed = raw.trim();
  if (!trimmed) return null;
  const withoutSlash = trimmed.startsWith('/') ? trimmed.slice(1) : trimmed;
  const parts = withoutSlash.split(/\s+/).filter(Boolean);
  if (parts.length === 0) return null;
  const name = parts.shift()!.toLowerCase();
  return { name, args: parts };
}

function numberArg(value: string | undefined): number | null {
  if (value === undefined) return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function formatTime(time: WorldTime): string {
  return `第 ${time.day + 1} 天，${String(time.timeOfDay).padStart(5, '0')} tick`;
}

export function executeCommand(raw: string, ctx: CommandContext): CommandResult {
  const parsed = parseCommand(raw);
  if (!parsed) return { ok: false, message: '空命令' };

  switch (parsed.name) {
    case 'help':
      return { ok: true, message: HELP_LINES.join('\n') };

    case 'seed':
      return { ok: true, message: `世界种子：${ctx.world.getSeed()}` };

    case 'time': {
      const current = ctx.world.getTime();
      if (parsed.args.length === 0 || parsed.args[0] === 'query') {
        return { ok: true, message: `当前时间：${formatTime(current)}` };
      }
      if (parsed.args[0] !== 'set' || parsed.args.length < 2) {
        return { ok: false, message: '用法：/time set <day|noon|night|midnight|ticks>' };
      }
      const value = parsed.args[1].toLowerCase();
      const preset = TIME_PRESETS[value];
      const numeric = preset !== undefined ? preset : numberArg(value);
      if (numeric === null || numeric === undefined) {
        return { ok: false, message: `无效时间：${value}` };
      }
      const dayBase = Math.floor(current.ticks / 24000) * 24000;
      ctx.world.setTime(dayBase + ((Math.round(numeric) % 24000) + 24000) % 24000);
      return { ok: true, message: `时间已设置为 ${value}` };
    }

    case 'gamemode': {
      const value = parsed.args[0]?.toLowerCase();
      if (value === 'creative' || value === 'c' || value === '1') {
        ctx.setGameMode('creative');
        return { ok: true, message: '游戏模式已切换为创造模式' };
      }
      if (value === 'survival' || value === 's' || value === '0') {
        ctx.setGameMode('survival');
        return { ok: true, message: '游戏模式已切换为生存模式' };
      }
      return { ok: false, message: '用法：/gamemode <survival|creative>' };
    }

    case 'tp': {
      if (parsed.args.length < 3) return { ok: false, message: '用法：/tp <x> <y> <z>' };
      const x = numberArg(parsed.args[0]);
      const y = numberArg(parsed.args[1]);
      const z = numberArg(parsed.args[2]);
      if (x === null || y === null || z === null) {
        return { ok: false, message: '坐标必须是数字' };
      }
      ctx.teleport({ x, y, z });
      return { ok: true, message: `已传送到 ${x}, ${y}, ${z}` };
    }

    case 'give': {
      const itemId = parsed.args[0]?.toLowerCase();
      if (!itemId) return { ok: false, message: '用法：/give <item> [count]' };
      const item = getItem(itemId);
      if (!item) return { ok: false, message: `未知物品：${itemId}` };
      const requested = parsed.args[1] === undefined ? 1 : numberArg(parsed.args[1]);
      if (requested === null) return { ok: false, message: '数量必须是数字' };
      const count = Math.max(1, Math.min(6400, Math.floor(requested)));
      if (!ctx.giveItem(itemId, count)) return { ok: false, message: '背包已满' };
      return { ok: true, message: `已给予 ${count} 个 ${item.name}` };
    }

    case 'clear':
      ctx.clearInventory();
      return { ok: true, message: '背包已清空' };

    case 'kill':
      ctx.killPlayer();
      return { ok: true, message: '你死了' };

    case 'spawnpoint': {
      const position = ctx.getPlayerPosition();
      ctx.world.setSpawnPoint({ ...position });
      return { ok: true, message: `出生点已设置：${Math.floor(position.x)}, ${Math.floor(position.y)}, ${Math.floor(position.z)}` };
    }

    case 'spawn': {
      const spawn = ctx.world.getSpawnPoint();
      return { ok: true, message: `出生点：${spawn.x.toFixed(1)}, ${spawn.y.toFixed(1)}, ${spawn.z.toFixed(1)}` };
    }

    default:
      return { ok: false, message: `未知命令：/${parsed.name}（输入 /help 查看列表）` };
  }
}
