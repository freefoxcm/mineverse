# MineVerse · 方块宇宙

在浏览器里运行的体素沙盒（Minecraft 风格核心复刻），从零使用 **TypeScript + Three.js + WebGL2** 实现：程序化生成的无限地形、方块光照与 AO、生存闭环、创造模式、生物与战斗、存档与完整像素 UI。

> 原创粉丝作品：所有贴图、模型、音效均由代码程序化生成，不使用 Minecraft 官方素材、Logo 或音乐。

## 在线游玩

**https://freefoxcm.github.io/mineverse/**（发布后可用，见下方部署说明）

## 本地运行

```bash
pnpm install
pnpm dev        # http://127.0.0.1:5199
pnpm build      # 生产构建到 dist/
pnpm preview    # 预览生产构建
```

要求：Node 20.19+ / 22.12+（本项目在 Node 24 验证），浏览器需支持 WebGL2。

## 操作

| 按键 | 功能 |
|---|---|
| WASD | 移动 |
| 空格 | 跳跃 / 创造模式双击切换飞行 |
| Shift | 潜行 / 飞行下降 |
| Ctrl 或双击 W | 疾跑 |
| 鼠标左键 | 破坏方块 / 攻击 |
| 鼠标右键 | 放置方块 / 使用 / 进食 / 拉弓 |
| 鼠标中键 | 选取方块（创造） |
| 1–9 / 滚轮 | 选择快捷栏 |
| E | 背包 / 工作台界面 |
| Q | 丢弃物品 |
| T 或 / | 聊天 / 命令 |
| Esc | 暂停菜单 |
| F3 | 调试信息 |
| F5 | 第一/第三人称 |
| F1 | 隐藏 HUD（可选） |

## 系统

- 世界：16×16×160 区块、无限水平、生物群系（平原/森林/白桦林/针叶林/沙漠/雪原/山地/海洋）、洞穴、矿脉、树木与植被；种子确定性生成。
- 渲染：WebGL2 纹理数组、逐面光照与 AO、天光/方块光、昼夜/日落/星空/云、雾、水下效果、粒子与手持物品。
- 生存：生命/饥饿/护甲/氧气、摔落/溺水/岩浆/生物伤害、死亡掉落与重生、工具耐久、熔炉/箱子/工作台、≥70 条配方。
- 创造：飞行、无限方块、即时破坏、创造物品栏搜索。
- 生物：僵尸、骷髅、苦力怕、蜘蛛、猪、牛、羊、鸡；A* 寻路、刷怪、弓箭、爆炸破坏地形。
- 存档：IndexedDB 多世界、自动保存、导出/导入 JSON。
- 命令：`/help /seed /time /gamemode /tp /give /kill /clear /spawnpoint`。

## 工程

```text
src/core        常量、类型、契约、RNG、数学、设置、命令
src/world       方块/物品注册表、区块、世界、生成、光照、网格、流式
src/render      渲染器、纹理数组、地形材质、天空、区块渲染、覆盖层
src/player      玩家、物理、输入、交互、粒子、第一人称
src/inventory   背包、配方、合成、容器
src/entities    实体、生物 AI、刷怪、投射物、爆炸、掉落物
src/ui          HUD、全部界面、图标
src/art         程序化像素纹理/图标/皮肤
src/save        IndexedDB 存档、edits、导入导出
src/debug       自动化调试 API（window.__MC__）
```

质量门禁：

```bash
pnpm typecheck
pnpm test
pnpm build
pnpm e2e      # 无头 Chromium + SwiftShader 截图冒烟，输出 artifacts/
```

## 部署（GitHub Pages）

```bash
pnpm deploy
```

脚本会：跑验证 → 构建 → 推送 `main` → 生成 `gh-pages` 分支 → 开通/更新 Pages → 轮询构建 → 线上冒烟并输出 `artifacts/deploy.json`。目标仓库：`freefoxcm/mineverse`。

## 已知限制

单人、无红石/下界/末地/村民/附魔/农耕/楼梯半砖/天气/移动端；渲染距离默认 8 区块，可在设置中调整。

## 许可

代码与程序化素材为原创作品。默认未附开源许可证；如需指定 MIT/Apache 等请告知作者。
