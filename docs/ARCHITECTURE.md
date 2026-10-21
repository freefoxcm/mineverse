# MineVerse 架构说明

## 1. 总览

```text
输入(键鼠/指针锁) ──► Game(20 TPS 固定步长) ──► Player / Interaction / EntityManager
                              │
                              ├─► World.setBlock ──► ChunkManager(增量光照 + 脏段重网格)
                              │
世界 Worker 池 ──► TerrainGenerator ──► ChunkColumn ──► Lighting BFS ──► Mesh Worker
     (种子+坐标)                                               (18³ 边界数据 → 顶点数组)
                                                                  │
                                                       ChunkRenderer(逐段 BufferGeometry)
                                                                  │
                           Sky / 地形 Shader / 实体渲染 / 第一人称手持 / 粒子 / HUD
                                                                  │
                                              WebGL2 Canvas + DOM/CSS 像素 UI
                                                                  │
                                    存档(IndexedDB)：种子 + edits + 玩家/时间/方块实体
```

- **主线程**：渲染、物理、AI、交互、UI、音频、存档。
- **Worker**：区块生成（2 个/帧预算）与网格化（16 段/帧预算），模块 Worker + transferable，jobId/version 丢弃过期结果；Workers 不可用时回退主线程。
- **渲染**：Three.js WebGL2，纹理数组（`DataArrayTexture`）逐 tile 分层，避免图集接缝；地形使用自定义 ShaderMaterial（天光/方块光/AO/雾/水下/昼夜），水面与玻璃分层处理。

## 2. 目录职责

| 目录 | 职责 |
|---|---|
| `src/core` | 常量、类型、子系统契约、确定性 RNG、数学、设置、命令解析 |
| `src/world` | 方块/物品注册表、区块列、世界容器、地形生成、光照、网格、ChunkManager 流式加载、Worker 协议 |
| `src/render` | 渲染器、纹理数组、地形材质、天空/云/日月/星、区块渲染、选中框/裂纹、实体渲染、第一人称手持、第三人称玩家模型 |
| `src/player` | 玩家状态、AABB 物理、输入、DDA 交互/挖掘/放置/吃/弓、粒子系统 |
| `src/inventory` | 背包 36+4、81 条合成配方+14 条熔炼、配方匹配、容器/熔炉逻辑 |
| `src/entities` | 实体基类、8 种生物模型与 AI、A* 寻路、刷怪、箭、爆炸、掉落物、EntityManager |
| `src/ui` | HUD、标题/世界列表/创建世界/加载/暂停/设置/背包/工作台/熔炉/箱子/创造/死亡/聊天/错误界面、图标缓存 |
| `src/art` | 程序化像素美术：89 个方块 tile、75 个物品图标、26 个 UI 贴图、29 张生物皮肤 |
| `src/save` | 存档 schema、EditStore（增量方块改动）、IndexedDB 读写、导入导出 |
| `src/audio` | 42 种 WebAudio 程序化音效、距离衰减、音量 |
| `src/debug` | `window.__MC__` 自动化接口（E2E/截图） |

## 3. 数据模型

### 3.1 方块与区块
- 方块数字 id 0..N（`blocks.ts`），附带 `meta` 8 位；热路径属性表（opaque/collidable/light 等）为 Uint8Array。
- 区块列 16×16×160，列内索引 `(y<<8)|(z<<4)|x`；`blocks/meta/sky/blockLight` 各 40,960 字节，`heightMap` 256 字节。
- 光照值 0..15；网格顶点里编码为 `level*17`（0..255）。

### 3.2 网格顶点格式
`position(vec3) / uv(vec2) / layer(uint16) / light(vec2 sky,block) / shade(AO×面明暗) / tint(RGB) / index(uint32)`；
面序 `+X -X +Y -Y +Z -Z`，顶点顺序 `(0,0)(1,0)(1,1)(0,1)`，UV 在 shader 中翻转 V（tile buffer 行 0 = 美术顶部）。

### 3.3 世界生成
- 高度：大陆度/侵蚀度调制的高度公式，海平面 63；10 种群系；3D 芝士+意面洞（y<56，y<10 岩浆）；七种按深度分布的矿脉；3×3 邻域确定性树/植被（跨区块无缝）。
- 生成在 Worker 中完成；`ChunkManager` 将 `editStore` 的存档改动在光照/网格前注入新列。

### 3.4 光照
- 天光：列顶向下 15 不衰减，横向 BFS 衰减 1；方块光：火把 14 / 熔炉 13 / 岩浆 15。
- 跨已加载区块传播，卸载邻居后进入修复队列；拆/放方块做增量移除+重播种。
- 网格顶点四邻平均 + AO 四角。

### 3.5 存档
```ts
SaveV1 {
  version: 1;
  meta: { id, name, seed, gameMode, difficulty, createdAt, lastPlayed, playtimeSeconds, gameVersion };
  player: { pos, yaw, pitch, health, hunger, saturation, air, gameMode, inventory[36], armor[4], selectedSlot };
  time: number;               // 世界 tick
  palette: string[];          // 存档内数字 → 方块字符串 id
  edits: { cx, cz, indices[], blocks[], metas[] }[];
  blockEntities: { x, y, z, type: 'chest'|'furnace', data }[];
}
```
- 世界地形由种子确定性重建，存档只保存改动（edits）+ 方块实体，体积小。
- IndexedDB `mineverse/worlds`；自动保存 60s、暂停/退出保存；支持导出/导入 JSON。
- 加载：先读存档 → `EditStore.load` → `ChunkManager` 生成列时注入 → 光照/网格 → 恢复玩家。

## 4. 生命周期

- `main.ts` → `Game`：构造渲染器/纹理/天空/世界/ChunkManager/玩家/交互/实体/UI/音频。
- `Game.init()`：可选加载存档 → 找出生点 → 循环驱动 `ChunkManager.update` 直到 `isReady`（进度条）→ 恢复玩家/位置 → 启动主循环。
- 固定步长 20 TPS：输入 → 玩家物理 → 实体 AI → 容器 tick → 交互；渲染每帧插值/相机；UI 每帧刷新。
- 标题/世界列表通过 URL 参数（`?title=1`、`?world=<id>&seed=...`、`?new=1&seed=...`）在页面加载时选择世界；创建/进入世界使用页面导航（保证渲染器与 Worker 干净重建）。
- 死亡：掉落背包物品实体 → 死亡界面 → 重生在出生点。

## 5. 性能预算（实测）

| 项 | 目标 | 实测 |
|---|---|---|
| 区块生成 | <20 ms/列 | ~3.8 ms/列（Worker） |
| 网格化 | <4 ms/段 | ~3.5 ms/段（Worker） |
| RD8 首屏 | <8 s | ~2–4 s（Worker 并行，取决于机器） |
| 渲染 | 1080p 60 fps（硬件） | 293 列 / 760 网格 / 212 draw calls / ~115k tris |
| SwiftShader E2E | 可用性 sanity | ~10–13 fps（软渲染，仅用于截图/功能验证） |

主要开销控制：逐段视锥剔除、纹理数组、无阴影贴图、地形单 Shader、按帧预算的生成/网格队列、透明层排序、几何/纹理卸载。

## 6. 测试与发布

- 单元测试（Vitest）408+ 条：RNG/噪声/地形不变量/光照/网格/物理/交互/背包/配方/容器/实体 AI/爆炸/存档/命令。
- E2E（`scripts/e2e.mjs`）：无头 Chromium + SwiftShader，真实构建 + 26 张截图 + 断言（世界/UI/挖掘放置/合成/生物/爆炸/火把光照/水下/第三人称/死亡重生/存档重载/无 console error）。
- 发布（`scripts/deploy-pages.mjs`）：验证 → 构建 → 推送 `main` + tag → 构造孤立 `gh-pages` 分支（仅 dist）→ 开通/更新 Pages → 轮询线上 → 在线冒烟 → 写 `artifacts/deploy.json`。
