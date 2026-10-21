# MineVerse 子系统契约（M0 基线）

> 所有 teammate 开工前必读。Lead 维护本文件；如需改共享接口，先消息 Lead，由 Lead 修改并广播。
> 目标与总计划见 `docs/PLAN.md`；当前基线已通过 `typecheck / test(35) / build / e2e`。

## 0. 命令与环境

```bash
pnpm install          # 已安装
pnpm typecheck        # 必过
pnpm test             # 单元测试（Vitest）
pnpm build            # 仅 Lead 在集成时运行
pnpm e2e              # 仅 Lead 运行（占用 5199 端口 + 无头 Chromium）
pnpm dev              # 仅 Lead 运行开发服务器（127.0.0.1:5199）
```

- **teammate 只运行 `pnpm typecheck` 和 `pnpm test -- <你的测试文件>`**；不要运行 build / e2e / dev / preview，避免端口与产物冲突。
- 不要新增 npm 依赖（需要时先消息 Lead）。
- 不要改 `package.json`、`tsconfig.json`、`vite.config.ts`、`index.html`、`src/main.ts`、`src/core/**`、`src/render/**`（除标注给你的文件）、`src/world/blocks.ts`、`src/world/items.ts`、`src/world/world.ts`、`src/world/chunk.ts`、`scripts/**`、`docs/**`。
- 所有代码 TypeScript strict；不得使用 `any` 除非确有外部边界且注释原因；不得 `Math.random()` 参与世界/存档/战斗判定（只能用 `core/rng`）。
- 文件写完必须 `pnpm typecheck` 通过；新增逻辑写 Vitest 测试放各自 `tests/<scope>/`。
- 每完成一个阶段用 `send_message` 向 Lead 汇报：改了哪些文件、测试结果、遗留问题、需要 Lead 集成的点。完成后 `team_task_update` 标记 complete。

## 1. 目录与所有权

| 范围 | 所有者 | 说明 |
|---|---|---|
| `src/core/**` `src/main.ts` `src/render/**`(除 firstPerson/entityRenderer) `src/world/{blocks,items,chunk,world}.ts` `src/save/**` `src/debug/**` `scripts/**` `docs/**` | Lead | 只读（除明确邀请） |
| `src/art/**` `tests/art/**` | Art-E | 程序化纹理/图标/皮肤/pixel 工具 |
| `src/world/worldgen/**` `src/world/lighting.ts` `src/world/mesher.ts` `src/world/worker/**` `src/world/chunkManager.ts` `tests/world/**`(除 blocks.test.ts) | World-A | 地形生成、光照、网格、流式加载 |
| `src/player/**` `src/audio/**` `src/render/firstPerson.ts` `tests/player/**` | Gameplay-B | 物理/交互/音频/手持 |
| `src/inventory/**` `src/ui/**` `src/styles/**` `tests/inventory/**` | UI-C | 背包/配方/容器/全部界面/HUD |
| `src/entities/**` `src/render/entityRenderer.ts` `tests/entities/**` | Entities-D | 生物模型/AI/战斗/掉落物 |

`src/ui/hud.ts` 是 Lead 写的占位，UI-C 可以完全重写（保持构造函数 `new Hud(parent)`、`hideBoot()`、`updateMetrics()` 可供 Lead 暂时调用；最终以 UI-C 的 API 为准并通知 Lead）。

## 2. 坐标、区块、世界

- 右手坐标系；+Y 向上。区块列 `16×16`，世界高 `160`（10 段），海平面 `63`。世界无限水平。
- 列内方块索引：`index = (y << 8) | (z << 4) | x`（`y*256 + z*16 + x`），`x,z ∈ [0,15]`，`y ∈ [0,159]`。
- 世界坐标转区块：`cx = floor(x/16)`，局部 `lx = x - cx*16`。
- `ChunkColumn`（`src/world/chunk.ts`）：`blocks/meta/sky/blockLight: Uint8Array(40960)`、`heightMap: Uint8Array(256)`（表面高度）、`edits: Map<index,{id,meta}>`、`blockEntities: Map<index,BlockEntity>`、`dirtySections`、`version`。
- 光照值语义：`0..15`；**网格顶点里的光照字节 = level × 17**（0..255，shader 归一化即 level/15）。天光与方块光分开。
- 方块 id：数字 0..N（`blocks.ts`），`meta` 8 位（原木轴向、流体 level、朝向、熔炉点燃等）。存档用字符串 palette。
- 方块属性热数组：`IS_OPAQUE / IS_SOLID / IS_COLLIDABLE / IS_REPLACEABLE / LIGHT_OPACITY / LIGHT_EMISSION / GRAVITY_BLOCK / FLUID_KIND / TINT_KIND / RENDER_KIND / ALPHA_KIND`（全部 Uint8Array(256)）。
- `WorldView` 接口见 `src/core/contracts.ts`；`World`（`src/world/world.ts`）另有：`columns`、`ensureColumn/insertColumn/removeColumn`、`generator: ColumnGenerator`、`lightUpdater`、`onBlockChanged/onColumnGenerated`、`spawnY`、`tick()/time()/setTicks()`、`setBlock(x,y,z,id,meta)`。
- **World-A 接入方式**：实现 `ColumnGenerator.generate(column, seedHash)`（同步、纯函数风格），并写 `ChunkManager` 负责 worker 生成、光照、网格队列、加载/卸载、把 `meshSection` 结果通过回调交给 Lead 的 `ChunkRenderer.setSection(cx,cy,cz,data,version)`，同时设置 `world.generator` / `world.lightUpdater`。Lead 在 M1 集成时把 main 的同步生成替换为 `ChunkManager`。

## 3. 网格格式（World-A 必须保持或与 Lead 协商升级）

`src/world/mesher.ts`：

```ts
interface MeshLayerData {
  positions: Float32Array;   // 3/vertex，段内局部坐标 0..16
  uvs: Float32Array;         // 2/vertex，0..1
  layers: Uint16Array;       // 1/vertex，纹理数组层号
  lights: Uint8Array;        // 2/vertex：sky、block（level*17）
  shades: Uint8Array;        // 1/vertex：AO × 面明暗（0..255）
  tints: Uint8Array;         // 3/vertex：RGB tint（255=原色）
  indices: Uint32Array;
}
interface SectionMeshData { opaque, cutout, transparent: MeshLayerData | null }
```

- 图层：`opaque` 不透明；`cutout` alpha discard（树叶/花草/玻璃/火把）；`transparent` 混合（水/冰）。
- 面序：`+X -X +Y -Y +Z -Z`；UV 由 shader 做 `1-v` 翻转（tile buffer 第 0 行是美术顶部）。
- 纹理层号用 `MeshContext.layerOf(tileName)`；`TextureAtlas` 由 Lead 维护，无需 worker 访问 atlas 数据。
- 顶点顺序必须保持 `p0(u=0,v=0), p1(1,0), p2(1,1), p3(0,1)` 与索引 `(0,1,2),(0,2,3)`。
- World-A 可扩展 `MeshContext`（新增方法必须同时更新 `main.ts` 中的构造，由 Lead 做）；worker 使用时数据自行传入，不依赖 `World` 实例。

## 4. 注册表面向 API

```ts
// src/world/blocks.ts
getBlockDef(id: number): BlockDef
blockNumeric(name: string): number
faceTexture(def: BlockDef, face: number): string
BLOCK // 常用方块数字 id 常量
// src/world/items.ts
getItem(id: string): ItemDef | undefined
allItems(): ItemDef[]
itemMaxStack(id): number
armorPoints(armor: (string|null)[]): number
```

- 新方块/物品只允许 Lead 添加；teammate 需要新内容时把清单发给 Lead。
- 掉落、工具等级、护甲、食物数值都在 `BlockDef/ItemDef` 中；UI-C 的配方直接引用字符串 id。

## 5. 美术契约（Art-E）

- `src/art/pixels.ts`：`PixelPainter`（32×32 默认，`set/fill/rect/blend/line/speckle/noiseFill/checker`），纯数据、无 DOM、可在 Node 测试。
- `src/art/types.ts`：`TILE_SIZE=32`、`TilePainter = (p: PixelPainter)=>void`。
- `src/art/tiles.ts`：导出 `TILES: Record<string, TilePainter>`。**必须覆盖所有方块面引用**（从 `blocks.ts` 的 `faceTexture` 收集；缺失会显示品红棋盘 + console.warn）。命名已确定（如 `grass_top/grass_side/oak_log/oak_log_top/...`）。另需 `crack_0..crack_9`。
- 待 Art-E 新增：`src/art/items.ts` 导出 `ITEM_ICONS: Record<string, ItemPainter>`（32×32，透明背景，键为 item id；块类物品可画等轴立方体图标）；`src/art/ui.ts` 导出 HUD/界面像素贴图（心、饥饿、护甲、气泡、槽位、按钮、logo），供 UI-C 用 canvas 转 dataURL；`src/art/mobSkins.ts` 在 D 给出部位清单后补。
- 所有绘制必须确定性；透明用 `rgba(0,0,0,0)`；不要用外部图片。

## 6. 渲染与素材集成（只读，Lead 改）

- `TextureAtlas`（`src/render/atlas.ts`）：收集 `blocks.ts` 的面 + `crack_*`，按名字排序建 DataArrayTexture；`layerOf(name)`。
- `createTerrainMaterials(atlas)`：`opaque/cutout/transparent` + `all`；uniform：`uDaylight/uFogColor/uFogNear/uFogFar/uAlphaTest/uOpacity/uUnderwater/uSkyTint/uBlockTint`。
- `ChunkRenderer.setSection(cx,cy,cz,data,version)`；`removeColumn(cx,cz)`；`meshCount/sectionCount`。
- `GameRenderer`：`webgl/scene/camera`；`resize()/render()`；相机 `rotation.order='YXZ'`，主线程每帧 `sky.update(camera,time.timeOfDay,time.daylight)` 后渲染。
- 第一人称 / 实体渲染分别由 B / D 写独立模块，Lead 在 main 中接线。

## 7. 玩家（Gameplay-B 设计，Lead 接线）

必须提供大致以下 API（可调整，但先消息 Lead）：

```ts
class Player {
  position: Vec3; velocity: Vec3; yaw; pitch; onGround; inWater; gameMode; health; hunger; ...
  inventory: Slot[]; armor: (string|null)[]; selectedSlot: number;
  update(dtTicks: number, input: InputState, world: WorldView): void;
  eyePosition(): Vec3;
}
class InteractionController {
  update(world, player, camera, dtMs): void; // 射线、挖掘进度、放置、使用
  hit: BlockHit | null;
}
```

- 输入由 Lead 的 input 模块提供/或 B 自行在 `src/player/input.ts` 监听（优先 B 实现，Lead 接线）。
- 破坏/放置必须走 `world.setBlock`；掉落入背包、粒子/音效通过回调/事件通知 Lead 或直接调用 B 的模块。
- 数值按计划 §2（AABB 0.6×1.8、重力 32、跳跃 8.9、20 TPS、触及 5、摔落 `floor(落差-3)`）。
- 物理写单元测试；不依赖 DOM/three 的纯函数优先（`src/player/physics.ts`）。

## 8. UI / 物品系统（UI-C 设计，Lead 接线）

- `src/inventory/inventory.ts`：`Inventory` 类（36 格 + 4 护甲 + 选中槽），方法：`add/remove/count/swap/split/moveTo/quickMove`，与 `Slot` 类型（`core/types.ts`）互操作；写单元测试。
- `src/inventory/recipes.ts` + `crafting.ts`：有序/无序配方、2×2/3×3 匹配、熔炉配方/燃料、可合成列表；写单元测试。
- `src/ui/**`：`Hud`、`ScreenManager`/各界面（标题、世界列表、创建世界、暂停、设置、背包、工作台、熔炉、箱子、创造物品栏、死亡、F3、聊天/命令、加载/错误）与 `src/styles/**`。
- 所有界面用 DOM/CSS；图标从 `art/items.ts` 的 pixel buffer 经 canvas 转 dataURL（`src/ui/icons.ts`），不要用外部图片。
- 与 Lead 的接线：UI 暴露 `GameUiBridge` 接口（玩家状态读取、背包操作、setScreen、命令回调、保存/退出回调），Lead 在 main 中实现并注入。UI 不得直接 import `World`/`main`。
- 创造物品栏需要全部物品与搜索；生存背包需要 2×2 合成 + 护甲槽；工作台 3×3；熔炉/箱子需方块实体 API（Lead 提供 `BlockEntityHost` 接口，C 先用接口类型）。

## 9. 实体（Entities-D 设计，Lead 接线）

- `src/entities/entity.ts` 基类（位置/速度/AABB/生命/onGround/update），`mob.ts`、`spawner.ts`、`projectile.ts`、`itemEntity.ts`、`explosion.ts`、`pathfinding.ts`。
- `EntityManager`：`update(tick, world, player, dt)`、`spawn(type,x,y,z)`、`raycastEntities(...)`，回调 `onSound/onParticles/onBlockBreak`。掉落物可入背包或交给 Lead。
- `src/render/entityRenderer.ts`：`EntityRenderer(scene, atlasLayerFn)`，`sync(entities, camera, alpha)`，方块拼装模型 + 行走/待机/受伤/死亡动画 + 脚底阴影；模型定义放 `src/entities/models.ts`，皮肤贴图提供 `src/art/mobSkins.ts` 所需部位清单给 Art-E（Lead 协调）。
- 生物数值/AI 按计划 §4.10；写寻路/刷怪/爆炸/AI 单元测试。实体不得直接改 main/DOM。

## 10. 存档 / 调试 API（Lead）

- 存档 schema 见计划 §4.11；IndexedDB `mineverse/worlds`；Lead 实现 `src/save/**`。
- `window.__MC__`（`src/debug/api.ts`）由 Lead 扩展：集成后会加入玩家/背包/界面/生物/命令等 E2E 控制。UI-C / Gameplay-B / Entities-D 若需要额外调试入口，把需求发给 Lead。
- E2E 仅由 Lead 运行：`scripts/e2e.mjs`，截图输出 `artifacts/screens/`。

## 11. 协作与验收

- 每个任务卡（`team_task_*`）有 write scope 与验收；先 `team_task_get` 看最新内容，开工时 `claim`。
- 分支/提交：teammate 不执行 git 操作；Lead 按里程碑统一 commit。工作区共享，不要回滚/格式化成批改别人的文件。
- 完成标准：实现 + 自测（新增测试）+ `pnpm typecheck` 通过；向 Lead 汇报文件清单、测试命令与结果、遗留项、需要的集成。
- 若发现契约不合理：先消息 Lead，不要擅自改共享文件。
