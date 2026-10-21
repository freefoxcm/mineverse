import '@fontsource/silkscreen/400.css';
import './styles/main.css';

import { DEFAULT_RENDER_DISTANCE, SECTION_COUNT, TICK_MS } from './core/config';
import { makeSlot, type Metrics, type Slot } from './core/types';
import { installDebugApi } from './debug/api';
import { TextureAtlas } from './render/atlas';
import { ChunkRenderer } from './render/chunkRenderer';
import { GameRenderer } from './render/renderer';
import { Sky } from './render/sky';
import { createTerrainMaterials } from './render/terrainMaterial';
import { Hud } from './ui/hud';
import { blockNumeric } from './world/blocks';
import { meshSection, type MeshContext } from './world/mesher';
import { World } from './world/world';
import type { ChunkColumn } from './world/chunk';

const RENDER_DISTANCE = Math.min(6, DEFAULT_RENDER_DISTANCE);
const SEED = new URLSearchParams(location.search).get('seed') ?? 'mineverse';

const canvas = document.getElementById('game-canvas') as HTMLCanvasElement;
const uiRoot = document.getElementById('ui-root') as HTMLElement;

const errors: string[] = [];
window.addEventListener('error', (event) => errors.push(event.message));
window.addEventListener('unhandledrejection', (event) => errors.push(String(event.reason)));
const originalConsoleError = console.error.bind(console);
console.error = (...args: unknown[]) => {
  errors.push(args.map((value) => String(value)).join(' '));
  originalConsoleError(...args);
};

const renderer = new GameRenderer(canvas);
const atlas = new TextureAtlas(renderer.maxAnisotropy);
const materials = createTerrainMaterials(atlas);
const sky = new Sky(renderer.scene);
const world = new World(SEED);
const chunkRenderer = new ChunkRenderer(renderer.scene, materials);
const hud = new Hud(uiRoot);

const meshContext: MeshContext = {
  getBlock: (x, y, z) => world.getBlock(x, y, z),
  getMeta: (x, y, z) => world.getMeta(x, y, z),
  getSkyLight: (x, y, z) => world.getSkyLight(x, y, z),
  getBlockLight: (x, y, z) => world.getBlockLight(x, y, z),
  layerOf: (tile) => atlas.layerOf(tile),
  tintOf: () => [255, 255, 255],
};

let ready = false;

function meshColumn(column: ChunkColumn): void {
  for (let section = 0; section < SECTION_COUNT; section++) {
    const data = meshSection(meshContext, column.cx, section, column.cz);
    chunkRenderer.setSection(column.cx, section, column.cz, data, column.version);
  }
}

function remeshAround(worldX: number, worldZ: number): void {
  const cx = Math.floor(worldX / 16);
  const cz = Math.floor(worldZ / 16);
  for (let dz = -1; dz <= 1; dz++) {
    for (let dx = -1; dx <= 1; dx++) {
      const column = world.column(cx + dx, cz + dz);
      if (column) meshColumn(column);
    }
  }
}

function remeshAll(): void {
  for (const column of world.columns.values()) meshColumn(column);
}

function applyBlock(x: number, y: number, z: number, id: number, meta = 0): boolean {
  const changed = world.setBlock(x, y, z, id, meta);
  if (changed) remeshAround(x, z);
  return changed;
}

function nextFrame(): Promise<void> {
  return new Promise((resolve) => requestAnimationFrame(() => resolve()));
}

function findSpawn(): { x: number; y: number; z: number } {
  let best: { x: number; y: number; z: number } | null = null;
  for (let radius = 0; radius <= 48 && !best; radius += 8) {
    for (let dz = -radius; dz <= radius && !best; dz += 8) {
      for (let dx = -radius; dx <= radius && !best; dx += 8) {
        if (radius > 0 && Math.abs(dx) !== radius && Math.abs(dz) !== radius) continue;
        const cx = Math.floor(dx / 16);
        const cz = Math.floor(dz / 16);
        world.ensureColumn(cx, cz);
        const surface = world.spawnY(dx, dz);
        const ground = world.getBlock(dx, surface - 1, dz);
        if (surface > 64 && (ground === blockNumeric('grass_block') || ground === blockNumeric('sand'))) {
          best = { x: dx + 0.5, y: surface + 0.2, z: dz + 0.5 };
        }
      }
    }
  }
  return best ?? { x: 8.5, y: 80, z: 8.5 };
}

function initialHotbar(): Slot[] {
  const items = ['grass_block', 'dirt', 'cobblestone', 'oak_log', 'oak_planks', 'sand', 'torch', 'glass', 'water'];
  return items.map((item) => makeSlot(item, 64));
}

async function init(): Promise<void> {
  hud.setBootProgress(0.02, '正在生成地形…');
  const radius = RENDER_DISTANCE;
  const total = (radius * 2 + 1) ** 2;
  let generated = 0;

  world.setTicks(3200);
  for (let cz = -radius; cz <= radius; cz++) {
    for (let cx = -radius; cx <= radius; cx++) {
      world.ensureColumn(cx, cz);
      generated++;
      if (generated % 12 === 0) {
        hud.setBootProgress(0.05 + (generated / total) * 0.5, `正在生成地形… ${generated}/${total}`);
        await nextFrame();
      }
    }
  }

  const spawn = findSpawn();
  hud.setBootProgress(0.6, '正在构建区块网格…');

  let meshed = 0;
  const columnCount = world.loadedColumnCount;
  for (const column of world.columns.values()) {
    meshColumn(column);
    meshed++;
    if (meshed % 6 === 0) {
      hud.setBootProgress(0.6 + (meshed / columnCount) * 0.35, `正在构建区块网格… ${meshed}/${columnCount}`);
      await nextFrame();
    }
  }

  renderer.camera.position.set(spawn.x, spawn.y + 1.62, spawn.z);
  renderer.camera.rotation.set(-0.16, 0.9, 0);
  hud.updateHotbar(initialHotbar(), 0);
  hud.setBootProgress(1, '完成');
  hud.hideBoot();
}

const hotbar = initialHotbar();

let lastTime = performance.now();
let accumulator = 0;
let frameCounter = 0;
let fpsTimer = 0;
let fps = 60;
let smoothedFrameMs = 16.67;

function metrics(): Metrics {
  const info = renderer.webgl.info;
  const memory = (performance as unknown as { memory?: { usedJSHeapSize: number } }).memory;
  return {
    fps,
    frameMs: smoothedFrameMs,
    drawCalls: info.render.calls,
    triangles: info.render.triangles,
    columns: world.loadedColumnCount,
    meshes: chunkRenderer.meshCount,
    entities: 0,
    heapMB: memory ? memory.usedJSHeapSize / (1024 * 1024) : 0,
  };
}

function updateMaterials(timeOfDay: number): void {
  const time = world.time();
  const near = RENDER_DISTANCE * 16 * 0.62;
  const far = RENDER_DISTANCE * 16 * 0.98;
  for (const material of materials.all) {
    material.uniforms.uDaylight.value = time.daylight;
    material.uniforms.uFogColor.value.copy(sky.fogColor);
    material.uniforms.uFogNear.value = near;
    material.uniforms.uFogFar.value = far;
  }
  renderer.webgl.setClearColor(sky.fogColor, 1);
  void timeOfDay;
}

function loop(now: number): void {
  const delta = Math.min(0.25, (now - lastTime) / 1000);
  lastTime = now;
  smoothedFrameMs = smoothedFrameMs * 0.92 + delta * 1000 * 0.08;

  accumulator += delta;
  let ticks = 0;
  while (accumulator >= TICK_MS / 1000 && ticks < 5) {
    world.tick();
    accumulator -= TICK_MS / 1000;
    ticks++;
  }

  const time = world.time();
  sky.update(renderer.camera, time.timeOfDay, time.daylight);
  updateMaterials(time.timeOfDay);
  renderer.render();

  frameCounter++;
  fpsTimer += delta;
  if (fpsTimer >= 0.5) {
    fps = frameCounter / fpsTimer;
    frameCounter = 0;
    fpsTimer = 0;
  }
  hud.updateMetrics(metrics());
  hud.updateVitals({ health: 20, maxHealth: 20, hunger: 20, air: 10, armor: 0, gameMode: 'survival' });
  if (!ready) ready = true;
  requestAnimationFrame(loop);
}

window.addEventListener('resize', () => renderer.resize());
document.addEventListener('keydown', (event) => {
  if (event.code === 'F3') {
    event.preventDefault();
    hud.toggleDebug();
  }
});

installDebugApi({
  world,
  metrics,
  teleport: (x, y, z) => {
    renderer.camera.position.set(x, y, z);
  },
  look: (yaw, pitch) => {
    renderer.camera.rotation.set(pitch, yaw, 0);
  },
  applyBlock,
  remeshAll,
  isReady: () => ready,
  errors,
});

init()
  .then(() => {
    requestAnimationFrame(loop);
  })
  .catch((error) => {
    errors.push(String(error));
    hud.setBootProgress(0, `初始化失败：${String(error)}`);
    console.error(error);
  });
