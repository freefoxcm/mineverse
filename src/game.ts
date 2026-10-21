import * as THREE from 'three';
import { PLAYER_REACH, TICK_MS } from './core/config';
import { executeCommand, type CommandContext } from './core/commands';
import { loadSettings, saveSettings, type GameSettings } from './core/settings';
import type { BlockHit, Difficulty, GameMode, Metrics } from './core/types';
import { installDebugApi } from './debug/api';
import { AudioEngine, stepSoundFor, type SoundId } from './audio/audio';
import {
  EntityManager,
  MOB_TYPES,
  TNT_EXPLOSION_POWER,
  type EntitySnapshot,
  type MobType,
} from './entities/index';
import { EntityRenderer } from './render/entityRenderer';
import { MOB_SKINS } from './art/mobSkins';
import { attachInput, toPlayerInput, type InputManager } from './player/input';
import { InteractionController, breakStage } from './player/interaction';
import { Player } from './player/player';
import { maxDurabilityOf } from './player/player';
import { ParticleRenderer, ParticleSystem, type ParticleKind } from './player/particles';
import { TextureAtlas } from './render/atlas';
import { ItemIconAtlas } from './render/itemAtlas';
import { BlockOverlay } from './render/blockOverlay';
import { ChunkRenderer } from './render/chunkRenderer';
import { FirstPersonHand } from './render/firstPerson';
import { PlayerModel } from './render/playerModel';
import { GameRenderer } from './render/renderer';
import { Sky } from './render/sky';
import { createTerrainMaterials, type TerrainMaterials } from './render/terrainMaterial';
import { Inventory } from './inventory/inventory';
import {
  createChestData,
  createFurnaceState,
  deserializeChest,
  deserializeFurnace,
  isFurnaceLit,
  serializeChest,
  serializeFurnace,
  tickFurnace,
  type ChestData,
  type ChestSaveData,
  type FurnaceSaveData,
  type FurnaceState,
} from './inventory/blockEntities';
import { EditStore } from './save/editStore';
import { applyWorldSave, createSave, createWorldMeta } from './save/savegame';
import { deleteWorldSave, listWorldSaves, loadWorldSave, writeWorldSave } from './save/storage';
import type { SavedPlayer, WorldMeta } from './save/types';
import type { GameUiBridge, UiScreenId, WorldSummary, CreateWorldOptions } from './ui/bridge';
import { GameUi } from './ui/gameUi';
import { Hud } from './ui/hud';
import { blockNumeric, getBlockDef } from './world/blocks';
import { localIndex, type ChunkColumn } from './world/chunk';
import { getItem } from './world/items';
import { World } from './world/world';
import { createTintResolver, type TintResolver } from './world/worldgen';
import { ChunkManager } from './world/chunkManager';

const TICK_SECONDS = TICK_MS / 1000;
const MAX_FRAME_DELTA = 0.25;
const MAX_BOOT_RENDER_DISTANCE = 8;

const WATER_FOG = new THREE.Color(0x1d4a63);
const LAVA_FOG = new THREE.Color(0x8a2a00);

/** Starting inventory for brand-new worlds (survival gets tools, creative gets blocks). */
const SURVIVAL_STARTER_KIT: ReadonlyArray<readonly [string, number]> = [
  ['stone_pickaxe', 1],
  ['stone_axe', 1],
  ['stone_sword', 1],
  ['torch', 16],
  ['oak_planks', 32],
  ['cobblestone', 32],
  ['crafting_table', 1],
  ['apple', 8],
];

const CREATIVE_STARTER_KIT: ReadonlyArray<readonly [string, number]> = [
  ['grass_block', 64],
  ['oak_planks', 64],
  ['cobblestone', 64],
  ['glass', 64],
  ['torch', 64],
  ['oak_log', 64],
  ['sand', 64],
  ['crafting_table', 64],
  ['white_wool', 64],
];

const MOB_SOUND_IDS: Record<string, SoundId | null> = {
  zombie: 'zombie',
  skeleton: 'skeleton',
  creeper: 'creeper',
  pig: 'pig',
  cow: 'cow',
  sheep: 'sheep',
  chicken: 'chicken',
  spider: null,
};

function mapEntitySound(name: string): SoundId | null {
  if (name.startsWith('mob.')) {
    const type = name.split('.')[1] ?? '';
    return MOB_SOUND_IDS[type] ?? null;
  }
  if (name.startsWith('explosion')) return 'explosion';
  if (name === 'entity.arrow.shoot') return 'bow_shoot';
  if (name === 'entity.arrow.hit') return 'arrow_hit';
  if (name === 'item.pickup') return 'pickup';
  return null;
}

function mapEntityParticle(kind: string): ParticleKind | null {
  switch (kind) {
    case 'explosion':
      return 'explosion';
    case 'hurt':
    case 'crit':
    case 'pickup':
      return 'crit';
    case 'poof':
    case 'mob_death':
      return 'smoke';
    default:
      return null;
  }
}

interface SpawnPoint {
  x: number;
  y: number;
  z: number;
}

interface PendingExplosion {
  x: number;
  y: number;
  z: number;
  power: number;
  timer: number;
}

/**
 * Top-level game orchestrator: owns renderer, world, player, input, gameplay
 * modules and the HUD, drives the 20 TPS simulation and exposes the automation
 * API. World streaming/lighting is synchronous M0 while World-A's ChunkManager
 * lands; everything else (interaction, entities, audio, particles) is wired here.
 */
export class Game {
  readonly renderer: GameRenderer;
  readonly atlas: TextureAtlas;
  readonly itemAtlas: ItemIconAtlas;
  readonly materials: TerrainMaterials;
  readonly sky: Sky;
  readonly world: World;
  readonly chunkRenderer: ChunkRenderer;
  readonly hud: Hud;
  readonly blockOverlay: BlockOverlay;
  readonly player: Player;
  readonly input: InputManager;
  readonly audio: AudioEngine;
  readonly particles: ParticleSystem;
  readonly particleRenderer: ParticleRenderer;
  readonly firstPerson: FirstPersonHand;
  readonly playerModel: PlayerModel;
  readonly interaction: InteractionController;
  readonly entityManager: EntityManager;
  readonly entityRenderer: EntityRenderer;
  readonly inventory: Inventory;
  readonly ui: GameUi;
  readonly chunkManager: ChunkManager;
  readonly renderRadius: number;
  readonly editStore = new EditStore();
  readonly settings: GameSettings;

  errors: string[] = [];
  spawn: SpawnPoint = { x: 0.5, y: 80, z: 0.5 };
  worldMeta: WorldMeta;

  private readonly startParams: URLSearchParams;
  private readonly titleOnly: boolean;
  private readonly activeFurnaces = new Map<
    string,
    { x: number; y: number; z: number; furnace: FurnaceState; wasLit: boolean }
  >();
  private pendingExplosions: PendingExplosion[] = [];
  private ready = false;
  private lastTime = performance.now();
  private accumulator = 0;
  private fps = 60;
  private frameMs = 16.67;
  private frameCounter = 0;
  private fpsTimer = 0;
  private deathTimer = 0;
  private deathScreenOpen = false;
  private thirdPerson = false;
  private outlineEnabled = true;
  private handVisible = true;
  private autoSaveTimer = 0;
  private firstFrame = true;
  private lastHandSignature = '';
  private lastFogColor = new THREE.Color(0x9fc4ff);
  private fogNear = 60;
  private fogFar = 94;
  private shake = 0;
  private stepDistance = 0;
  private waterLayer = 0;
  private lavaLayer = 0;
  private lastDrawCalls = 0;
  private lastTriangles = 0;
  private currentScreen: UiScreenId = 'none';
  private readonly waterOverlay: HTMLDivElement;
  private readonly lavaOverlay: HTMLDivElement;

  constructor(
    readonly canvas: HTMLCanvasElement,
    readonly uiRoot: HTMLElement,
  ) {
    this.settings = loadSettings();
    this.startParams = new URLSearchParams(location.search);
    const seed = this.startParams.get('seed') ?? 'mineverse';
    const mode: GameMode = this.startParams.get('mode') === 'creative' ? 'creative' : 'survival';
    const difficultyParam = this.startParams.get('difficulty');
    const difficulty: Difficulty =
      difficultyParam === 'peaceful' || difficultyParam === 'easy' || difficultyParam === 'hard'
        ? difficultyParam
        : 'normal';
    this.settings.difficulty = difficulty;
    const renderDistanceParam = Number(this.startParams.get('rd'));
    if (Number.isFinite(renderDistanceParam) && renderDistanceParam > 0) {
      this.settings.renderDistance = Math.max(4, Math.min(12, Math.round(renderDistanceParam)));
    }
    this.titleOnly = this.startParams.get('title') === '1';
    this.renderer = new GameRenderer(canvas);
    this.atlas = new TextureAtlas(this.renderer.maxAnisotropy);
    this.itemAtlas = new ItemIconAtlas(this.renderer.maxAnisotropy);
    this.materials = createTerrainMaterials(this.atlas);
    this.sky = new Sky(this.renderer.scene);
    this.sky.setCloudsVisible(this.settings.clouds);
    this.world = new World(seed);
    this.chunkRenderer = new ChunkRenderer(this.renderer.scene, this.materials);
    this.blockOverlay = new BlockOverlay(this.renderer.scene, this.atlas);
    this.hud = new Hud(uiRoot);

    this.player = new Player({
      gameMode: mode,
      baseFov: this.settings.fov,
      sensitivity: this.settings.sensitivity,
    });
    this.inventory = new Inventory({
      slots: this.player.inventory,
      armor: this.player.armor,
      selected: this.player.selectedSlot,
    });
    this.worldMeta = createWorldMeta(
      this.startParams.get('name') ?? '新的世界',
      seed,
      mode,
      difficulty,
      { x: 0.5, y: 80, z: 0.5 },
    );
    this.input = attachInput(canvas, {
      sensitivity: this.settings.sensitivity,
      autoRequestPointerLock: true,
      preventDefault: true,
    });

    this.audio = new AudioEngine({ masterVolume: this.settings.masterVolume });
    this.audio.attachAutoUnlock(window);
    this.particles = new ParticleSystem(2048);
    this.particleRenderer = new ParticleRenderer(this.renderer.scene, { capacity: 2048 });
    this.firstPerson = new FirstPersonHand(this.atlas, {
      baseFov: this.settings.fov,
      itemTexture: this.itemAtlas.texture,
      itemLayerOf: (itemId) => this.itemAtlas.layerOf(itemId),
    });
    this.playerModel = new PlayerModel(this.renderer.scene);

    this.interaction = new InteractionController({
      reach: PLAYER_REACH,
      onBreak: (hit, _block, drops) => this.handleBlockBreak(hit.x, hit.y, hit.z, drops),
      onPlace: () => this.firstPerson.swing('place'),
      onUse: (itemId, hit) => this.handleUseBlock(itemId, hit),
      onEat: () => this.firstPerson.triggerEat(),
      onIgniteTnt: (x, y, z) => this.igniteTnt(x, y, z),
      onShootArrow: (charge, origin, direction) => this.entityManager.shootBow(origin, direction, charge),
      onSwing: () => this.firstPerson.swing('attack'),
      onAttack: (origin, direction) => this.handlePlayerAttack(origin, direction),
      onToolBroken: (itemId) => {
        this.audio.play('tool_break', {});
        this.hud.showToast(`${itemId} 已损坏`, 'warn');
      },
      onSound: (id, x, y, z) => this.audio.play(id, { position: { x, y, z } }),
      onParticles: (kind, x, y, z, color) => {
        this.particles.spawn(kind, { x, y, z }, {
          color: color ? [color[0] / 255, color[1] / 255, color[2] / 255] : undefined,
        });
      },
    });

    this.entityManager = new EntityManager({
      difficulty: () => this.settings.difficulty,
      seed: this.world.seed,
      spawnEnabled: true,
      feedback: {
        onSound: (name, position) => {
          const id = mapEntitySound(name);
          if (id) this.audio.play(id, { position });
        },
        onParticles: (kind, position, count) => {
          const mapped = mapEntityParticle(kind);
          if (mapped) this.particles.spawn(mapped, position, { count });
        },
        onBlockBreak: () => {
          // Dirty marking + save recording happens in world.onBlockChanged.
        },
        onPlayerHurt: (event) => this.handlePlayerHurt(event),
        onItemPickup: (slot) => this.handleItemPickup(slot),
        onExplosion: (result) => {
          this.shake = Math.min(0.55, 0.12 + result.power * 0.06);
        },
      },
    });
    this.entityRenderer = new EntityRenderer(this.renderer.scene, (tile: string) => this.atlas.layerOf(tile), {
      atlasTexture: this.atlas.texture,
      skins: MOB_SKINS,
      itemTexture: this.itemAtlas.texture,
      itemLayerOf: (itemId: string) => (this.itemAtlas.hasItem(itemId) ? this.itemAtlas.layerOf(itemId) : null),
    });

    this.renderRadius = Math.min(MAX_BOOT_RENDER_DISTANCE, this.settings.renderDistance);
    // Mild biome tint on top of finished-colour textures: keeps plains/forest/
    // desert grass visually distinct without turning dirt sides olive.
    const biomeTint = createTintResolver(this.world.seedHash);
    const mildTint: TintResolver = (block, x, z) => {
      const [r, g, b] = biomeTint(block, x, z);
      return [Math.round(255 - (255 - r) * 0.45), Math.round(255 - (255 - g) * 0.45), Math.round(255 - (255 - b) * 0.45)];
    };
    this.waterLayer = this.atlas.layerOf('water');
    this.lavaLayer = this.atlas.layerOf('lava');
    this.chunkManager = new ChunkManager({
      world: this.world,
      meshSink: this.chunkRenderer,
      layerOf: (tile) => this.atlas.layerOf(tile),
      renderDistance: this.renderRadius,
      generatePerFrame: 2,
      meshPerFrame: 16,
      workers: true,
      tintOf: mildTint,
      applyColumnEdits: (column) => this.editStore.apply(column),
    });

    this.world.onBlockChanged = (event) => {
      this.editStore.record(event.x, event.y, event.z, event.current, event.meta);
    };

    this.waterOverlay = document.createElement('div');
    this.waterOverlay.className = 'screen-overlay water-overlay';
    uiRoot.appendChild(this.waterOverlay);
    this.lavaOverlay = document.createElement('div');
    this.lavaOverlay.className = 'screen-overlay lava-overlay';
    uiRoot.appendChild(this.lavaOverlay);

    this.ui = new GameUi(uiRoot, this.createUiBridge(), { hud: this.hud, autoKeyboard: true });

    this.installErrorCapture();
    this.installGlobalKeys();
    window.addEventListener('resize', this.handleResize);
  }

  // -------------------------------------------------------------------------
  // Boot
  // -------------------------------------------------------------------------

  async init(): Promise<void> {
    this.hud.setBootProgress(0.02, '正在生成地形…');
    const worldId = this.startParams.get('world');
    if (worldId) {
      try {
        const save = await loadWorldSave(worldId);
        if (save) {
          this.worldMeta = save.meta;
          this.world.setTicks(save.time);
          applyWorldSave(save, this.editStore);
          this.applySavedPlayer(save.player);
        } else {
          this.hud.showToast('存档不存在，已创建新世界', 'error');
        }
      } catch (error) {
        console.error(error);
        this.hud.showToast(`读取存档失败：${String(error)}`, 'error');
      }
    }

    if (!worldId) this.world.setTicks(3200);

    const spawn = this.chunkManager.findSpawn();
    this.spawn = { x: spawn.x, y: spawn.y, z: spawn.z };
    if (!worldId) {
      this.player.position = { x: spawn.x, y: spawn.y, z: spawn.z };
      this.player.velocity = { x: 0, y: 0, z: 0 };
      this.player.setLook(0.9, -0.08);
      if (this.startParams.get('kit') !== '0') this.applyStarterKit();
    }

    this.hud.setBootProgress(0.05, '正在生成地形…');
    const centerX = this.player.position.x;
    const centerZ = this.player.position.z;
    let guard = 0;
    while (!this.chunkManager.isReady && guard < 900) {
      this.chunkManager.update(centerX, centerZ);
      if (guard % 2 === 0) {
        const progress = this.chunkManager.progress;
        this.hud.setBootProgress(0.05 + progress * 0.9, `正在生成地形… ${Math.round(progress * 100)}%`);
      }
      guard++;
      await nextFrame();
    }
    this.chunkManager.update(centerX, centerZ);

    this.hud.setBootProgress(0.97, '正在构建区块网格…');
    for (let i = 0; i < 4; i++) {
      this.chunkManager.update(centerX, centerZ);
      await nextFrame();
    }

    this.hud.setBootProgress(1, '完成');
    this.ui.setGameplayActive(!this.titleOnly);
    if (this.titleOnly) this.ui.openTitle();

    this.installDebugApi();
    this.lastTime = performance.now();
    requestAnimationFrame(this.frame);
  }

  private applyStarterKit(): void {
    const kit = this.player.gameMode === 'creative' ? CREATIVE_STARTER_KIT : SURVIVAL_STARTER_KIT;
    for (const [itemId, count] of kit) {
      const durability = maxDurabilityOf(itemId);
      this.player.addItem(itemId, count, durability > 0 ? durability : undefined);
    }
    this.inventory.setSelectedSlot(0);
    this.player.setSelectedSlot(0);
    this.lastHandSignature = '';
  }

  private applySavedPlayer(saved: SavedPlayer): void {
    this.player.position = { ...saved.pos };
    this.player.velocity = { x: 0, y: 0, z: 0 };
    this.player.yaw = saved.yaw;
    this.player.pitch = saved.pitch;
    this.player.health = saved.health;
    this.player.hunger = saved.hunger;
    this.player.saturation = saved.saturation;
    this.player.air = saved.air;
    this.player.gameMode = saved.gameMode;
    this.player.dead = saved.health <= 0;
    this.player.inventory.length = 0;
    for (let i = 0; i < 36; i++) {
      const slot = saved.inventory[i];
      this.player.inventory.push(slot ? { ...slot } : { item: null, count: 0 });
    }
    this.player.armor.length = 0;
    for (let i = 0; i < 4; i++) {
      const slot = saved.armor[i];
      this.player.armor.push(slot ? { ...slot } : { item: null, count: 0 });
    }
    this.inventory.setSelectedSlot(saved.selectedSlot);
    this.player.setSelectedSlot(saved.selectedSlot);
    this.player.fallDistance = 0;
    this.player.velocity = { x: 0, y: 0, z: 0 };
  }

  // -------------------------------------------------------------------------
  // Main loop
  // -------------------------------------------------------------------------

  private frame = (now: number): void => {
    const delta = Math.min(MAX_FRAME_DELTA, (now - this.lastTime) / 1000);
    this.lastTime = now;
    this.update(delta);
    requestAnimationFrame(this.frame);
  };

  private update(delta: number): void {
    this.frameMs = this.frameMs * 0.92 + delta * 1000 * 0.08;
    const gameplayActive = this.ui.isGameplayActive();

    if (gameplayActive) {
      const look = this.input.consumeLook();
      if (this.input.pointerLocked && (look.x !== 0 || look.y !== 0)) {
        this.player.look(look.x, look.y, this.settings.sensitivity);
      }
      const hotbarSlot = this.input.consumeHotbarSlot();
      if (hotbarSlot !== null) {
        this.player.setSelectedSlot(hotbarSlot);
        this.inventory.setSelectedSlot(hotbarSlot);
      }
      const scroll = this.input.consumeScroll();
      if (scroll !== 0) {
        this.player.setSelectedSlot(this.player.selectedSlot + scroll);
        this.inventory.setSelectedSlot(this.player.selectedSlot);
      }

      this.accumulator += delta;
      let ticks = 0;
      while (this.accumulator >= TICK_SECONDS && ticks < 5) {
        this.world.tick();
        this.accumulator -= TICK_SECONDS;
        ticks++;
      }

      if (ticks > 0) {
        if (!this.player.dead) {
          this.player.update(ticks, this.world, toPlayerInput(this.input.state));
          this.deathTimer = 0;
          this.updateStepSounds(delta);
        }
        this.tickFurnaces(ticks);
        this.entityManager.update(
          this.world.ticks,
          this.world,
          {
            position: this.player.position,
            yaw: this.player.yaw,
            pitch: this.player.pitch,
            gameMode: this.player.gameMode,
            health: this.player.health,
            maxHealth: this.player.maxHealth,
            inventory: this.player.inventory,
            onGround: this.player.onGround,
            inWater: this.player.inWater,
          },
          ticks,
        );
      }

      if (this.player.dead && !this.deathScreenOpen) {
        this.deathScreenOpen = true;
        this.deathTimer = 0;
        this.dropInventoryOnDeath();
        this.audio.play('death', { position: this.player.position });
        this.ui.openDeath();
      }

      this.chunkManager.update(this.player.position.x, this.player.position.z);
      this.updatePendingExplosions(delta);

      this.autoSaveTimer += delta;
      if (this.autoSaveTimer >= 60) {
        this.autoSaveTimer = 0;
        void this.saveWorld(true);
      }
    } else {
      this.input.consumeLook();
      this.input.consumeHotbarSlot();
      this.input.consumeScroll();
      this.chunkManager.update(this.player.position.x, this.player.position.z);
    }

    this.player.applyCamera(this.renderer.camera);
    if (this.thirdPerson && gameplayActive) this.applyThirdPersonCamera();
    this.applyScreenShake();

    const interactionResult =
      gameplayActive && !this.player.dead && this.ui.getScreen() === 'none'
        ? this.interaction.update(this.world, this.player, delta * 1000, {
            attack: this.input.state.attack,
            attackPressed: this.input.state.attackPressed,
            use: this.input.state.use,
            usePressed: this.input.state.usePressed,
            useReleased: this.input.state.useReleased,
          })
        : { hit: null, progress: 0, breaking: false };
    const stage = interactionResult.breaking ? breakStage(interactionResult.progress) : -1;
    this.blockOverlay.setTarget(this.outlineEnabled ? interactionResult.hit : null, this.outlineEnabled ? stage : -1, this.atlas);

    const time = this.world.time();
    this.sky.update(this.renderer.camera, time.timeOfDay, time.daylight);
    this.updateMaterials(time.daylight);
    this.updateHand(delta);
    this.playerModel.update(delta, this.player, this.thirdPerson && gameplayActive);
    this.particles.update(delta);
    this.particleRenderer.sync(this.particles, this.renderer.camera);
    this.entityRenderer.sync(this.entityManager.snapshots(), this.renderer.camera, 1, {
      daylight: time.daylight,
      fogColor: this.lastFogColor,
      fogNear: this.fogNear,
      fogFar: this.fogFar,
    });
    this.renderer.render();
    const renderInfo = this.renderer.webgl.info;
    this.lastDrawCalls = renderInfo.render.calls;
    this.lastTriangles = renderInfo.render.triangles;
    if (gameplayActive && !this.thirdPerson && this.handVisible && this.ui.getScreen() === 'none') {
      this.firstPerson.render(this.renderer.webgl, this.renderer.camera);
    }

    this.audio.setListenerPosition(
      this.renderer.camera.position.x,
      this.renderer.camera.position.y,
      this.renderer.camera.position.z,
    );
    this.audio.setListenerOrientation(this.player.yaw);

    this.ui.update(delta * 1000);
    this.updateOverlays();

    this.frameCounter++;
    this.fpsTimer += delta;
    if (this.fpsTimer >= 0.5) {
      this.fps = this.frameCounter / this.fpsTimer;
      this.frameCounter = 0;
      this.fpsTimer = 0;
    }

    this.input.endFrame();

    if (this.firstFrame) {
      this.firstFrame = false;
      this.ready = true;
      this.hud.hideBoot();
    }
  }

  private updateMaterials(daylight: number): void {
    const underwater = this.player.eyeInWater;
    const inLava = this.player.eyeInLava;
    const near = underwater || inLava ? 0.5 : this.renderRadius * 16 * 0.55;
    const far = underwater ? 22 : inLava ? 3 : this.renderRadius * 16 * 0.92;
    this.fogNear = near;
    this.fogFar = far;
    this.lastFogColor = inLava ? LAVA_FOG : underwater ? WATER_FOG : this.sky.fogColor;
    const now = performance.now() * 0.001;
    for (const material of this.materials.all) {
      material.uniforms.uDaylight.value = daylight;
      material.uniforms.uFogColor.value.copy(this.lastFogColor);
      material.uniforms.uFogNear.value = near;
      material.uniforms.uFogFar.value = far;
      material.uniforms.uUnderwater.value = underwater ? 1 : 0;
      material.uniforms.uTime.value = now;
      material.uniforms.uWaterLayer.value = this.waterLayer;
      material.uniforms.uLavaLayer.value = this.lavaLayer;
      (material.uniforms.uSkyTint.value as THREE.Color).setRGB(1.0, 0.985, 0.95);
      (material.uniforms.uBlockTint.value as THREE.Color).setRGB(1.0, 0.66, 0.32);
    }
    this.renderer.webgl.setClearColor(this.lastFogColor, 1);
  }

  private updateHand(delta: number): void {
    const stack = this.player.selectedStack();
    const signature = stack ? `${stack.item}:${stack.count}:${stack.durability ?? ''}` : '';
    if (signature !== this.lastHandSignature) {
      this.lastHandSignature = signature;
      this.firstPerson.setItem(stack);
    }
    this.firstPerson.setDaylight(this.world.time().daylight);
    this.firstPerson.update(delta, { ...this.player.animationState() });
  }

  private updateOverlays(): void {
    this.waterOverlay.classList.toggle('visible', this.player.eyeInWater);
    this.lavaOverlay.classList.toggle('visible', this.player.eyeInLava);
  }

  private updateStepSounds(delta: number): void {
    if (!this.player.onGround || this.player.inWater || this.player.flying) {
      this.stepDistance = 0;
      return;
    }
    this.stepDistance += Math.hypot(this.player.velocity.x, this.player.velocity.z) * delta;
    if (this.stepDistance < 2.4) return;
    this.stepDistance = 0;
    const below = this.world.getBlock(
      Math.floor(this.player.position.x),
      Math.floor(this.player.position.y - 0.1),
      Math.floor(this.player.position.z),
    );
    if (below === 0) return;
    const sound = stepSoundFor(getBlockDef(below).sound);
    this.audio.play(sound, { volume: 0.55, position: this.player.position });
  }

  // -------------------------------------------------------------------------
  // Player actions / feedback
  // -------------------------------------------------------------------------

  private handleBlockBreak(
    x: number,
    y: number,
    z: number,
    drops: readonly { item: string; count: number }[],
  ): void {
    this.firstPerson.swing('attack');
    if (this.player.gameMode === 'creative') return;
    for (const drop of drops) {
      if (!drop.item || drop.count <= 0) continue;
      this.entityManager.spawnItem(drop.item, drop.count, { x: x + 0.5, y: y + 0.5, z: z + 0.5 });
    }
  }

  private handlePlayerAttack(origin: { x: number; y: number; z: number }, direction: { x: number; y: number; z: number }): void {
    const damage = this.player.selectedItem()?.tool?.damage ?? 1;
    const hit = this.entityManager.playerAttack(origin, direction, PLAYER_REACH, damage, 4);
    if (!hit) return;
    this.firstPerson.swing('attack');
    this.particles.spawnCrit(hit.position.x, hit.position.y + 0.8, hit.position.z, 5);
    this.audio.play('hurt', { position: hit.position, volume: 0.7 });
    if (hit.killed) this.hud.showToast(`${hit.type} 被击败`);
  }

  private handlePlayerHurt(event: {
    damage: number;
    position: { x: number; y: number; z: number };
    knockback: { x: number; y: number; z: number };
    cause: string;
  }): void {
    if (this.player.gameMode === 'creative') return;
    const applied = this.player.damage(event.damage, { cause: event.cause });
    if (!applied) return;
    this.player.velocity.x += event.knockback.x;
    this.player.velocity.y += event.knockback.y;
    this.player.velocity.z += event.knockback.z;
    this.audio.play('hurt', { position: this.player.position });
    this.shake = Math.max(this.shake, 0.08);
    if (this.player.dead) {
      this.audio.play('death', { position: this.player.position });
      this.hud.showToast('你死了', 'error');
    }
  }

  private handleItemPickup(slot: { item: string | null; count: number; durability?: number }): number {
    if (!slot.item || slot.count <= 0) return 0;
    const remaining = this.player.addItem(slot.item, slot.count, slot.durability);
    const accepted = slot.count - Math.max(0, remaining);
    if (accepted > 0) this.audio.play('pickup', { volume: 0.6, position: this.player.position });
    return accepted;
  }

  private igniteTnt(x: number, y: number, z: number): void {
    if (this.world.getBlock(x, y, z) !== blockNumeric('tnt')) return;
    this.world.setBlock(x, y, z, 0);
    this.pendingExplosions.push({ x: x + 0.5, y: y + 0.5, z: z + 0.5, power: TNT_EXPLOSION_POWER, timer: 4 });
  }

  private updatePendingExplosions(delta: number): void {
    if (this.pendingExplosions.length === 0) return;
    const remaining: PendingExplosion[] = [];
    for (const explosion of this.pendingExplosions) {
      explosion.timer -= delta;
      if (explosion.timer <= 0) {
        this.world.setBlock(Math.floor(explosion.x), Math.floor(explosion.y), Math.floor(explosion.z), 0);
        this.entityManager.explodeAt({ x: explosion.x, y: explosion.y, z: explosion.z }, explosion.power, 'tnt');
      } else {
        remaining.push(explosion);
      }
    }
    this.pendingExplosions = remaining;
  }

  private applyScreenShake(): void {
    if (this.shake <= 0.002) return;
    const strength = this.shake;
    this.shake *= 0.86;
    const now = performance.now() * 0.001;
    this.renderer.camera.position.x += Math.sin(now * 41) * strength;
    this.renderer.camera.position.y += Math.cos(now * 53) * strength * 0.7;
  }

  private applyThirdPersonCamera(): void {
    const eye = this.player.eyePosition();
    const direction = this.player.lookDirection();
    const distance = 3.6;
    this.renderer.camera.position.set(
      eye.x - direction.x * distance,
      eye.y - direction.y * distance + 0.55,
      eye.z - direction.z * distance,
    );
    this.renderer.camera.lookAt(
      this.player.position.x,
      this.player.position.y + 1.25,
      this.player.position.z,
    );
  }

  setThirdPerson(enabled: boolean): void {
    this.thirdPerson = enabled;
    this.hud.showToast(enabled ? '第三人称视角' : '第一人称视角');
  }

  private dropInventoryOnDeath(): void {
    const position = this.player.position;
    const drop = (item: string, count: number, index: number): void => {
      if (!item || count <= 0) return;
      const spread = 0.35;
      this.entityManager.spawnItem(item, count, {
        x: position.x + ((index % 5) - 2) * spread,
        y: position.y + 0.8 + Math.floor(index / 5) * 0.1,
        z: position.z + (Math.floor(index / 5) % 5) * spread - spread * 2,
      });
    };
    let index = 0;
    for (const slot of this.inventory.slots) {
      if (slot.item) drop(slot.item, slot.count, index);
      index++;
    }
    for (const slot of this.inventory.armor) {
      if (slot.item) drop(slot.item, slot.count, index);
      index++;
    }
    this.inventory.clear();
    this.lastHandSignature = '';
  }

  respawn(): void {
    this.player.respawn({ x: this.spawn.x, y: this.spawn.y, z: this.spawn.z });
    this.player.setLook(0.9, -0.08);
    this.deathTimer = 0;
    this.deathScreenOpen = false;
    if (this.ui.getScreen() === 'death') this.ui.closeScreen();
    this.ui.setGameplayActive(true);
    this.hud.showToast('已重生');
  }

  setGameMode(mode: GameMode): void {
    this.player.setGameMode(mode);
    this.hud.showToast(mode === 'creative' ? '已切换到创造模式' : '已切换到生存模式');
  }

  give(item: string, count: number): boolean {
    const id = item.toLowerCase();
    const def = getItem(id);
    if (!def) return false;
    // Tools/armor do not stack: /give item 64 gives one piece, not 64 slots of them.
    const amount = def.maxStack <= 1 ? 1 : Math.max(1, Math.min(Math.floor(count), def.maxStack));
    const remaining = this.player.addItem(id, amount);
    return remaining <= 0;
  }

  // -------------------------------------------------------------------------
  // Containers / furnaces
  // -------------------------------------------------------------------------

  private handleUseBlock(_itemId: string | null, hit: BlockHit | null): boolean {
    if (!hit) return false;
    const blockId = getBlockDef(hit.id).id;
    if (blockId === 'crafting_table') {
      this.ui.openCraftingTable();
      return true;
    }
    if (blockId !== 'chest' && blockId !== 'furnace' && blockId !== 'lit_furnace') return false;

    const cx = Math.floor(hit.x / 16);
    const cz = Math.floor(hit.z / 16);
    const column = this.world.column(cx, cz);
    if (!column) return false;
    const index = localIndex(hit.x - cx * 16, hit.y, hit.z - cz * 16);
    const existing = column.blockEntities.get(index);

    if (blockId === 'chest') {
      const chest: ChestData =
        existing?.type === 'chest'
          ? deserializeChest(existing.data as Partial<ChestSaveData>)
          : createChestData();
      column.blockEntities.set(index, { type: 'chest', data: serializeChest(chest) });
      this.ui.openChest({
        kind: 'chest',
        slots: chest.slots,
        onChange: () => {
          column.blockEntities.set(index, { type: 'chest', data: serializeChest(chest) });
          this.editStore.setBlockEntity(hit.x, hit.y, hit.z, 'chest', serializeChest(chest));
        },
      });
      return true;
    }

    const furnace: FurnaceState =
      existing?.type === 'furnace'
        ? deserializeFurnace(existing.data as Partial<FurnaceSaveData>)
        : createFurnaceState();
    column.blockEntities.set(index, { type: 'furnace', data: serializeFurnace(furnace) });
    this.activeFurnaces.set(`${hit.x},${hit.y},${hit.z}`, {
      x: hit.x,
      y: hit.y,
      z: hit.z,
      furnace,
      wasLit: isFurnaceLit(furnace),
    });
    this.ui.openFurnace({
      kind: 'furnace',
      slots: furnace.slots,
      furnace,
      onChange: () => {
        this.persistFurnace(hit.x, hit.y, hit.z, furnace, column, index);
      },
    });
    return true;
  }

  private persistFurnace(
    x: number,
    y: number,
    z: number,
    furnace: FurnaceState,
    column: ChunkColumn,
    index: number,
  ): void {
    const data = serializeFurnace(furnace);
    column.blockEntities.set(index, { type: 'furnace', data });
    this.editStore.setBlockEntity(x, y, z, 'furnace', data);
  }

  private tickFurnaces(ticks: number): void {
    for (const entry of this.activeFurnaces.values()) {
      const events = tickFurnace(entry.furnace, ticks);
      const lit = isFurnaceLit(entry.furnace);
      if (lit !== entry.wasLit) {
        entry.wasLit = lit;
        const meta = this.world.getMeta(entry.x, entry.y, entry.z);
        this.world.setBlock(
          entry.x,
          entry.y,
          entry.z,
          blockNumeric(lit ? 'lit_furnace' : 'furnace'),
          meta,
        );
        const cx = Math.floor(entry.x / 16);
        const cz = Math.floor(entry.z / 16);
        const column = this.world.column(cx, cz);
        if (column) {
          this.persistFurnace(entry.x, entry.y, entry.z, entry.furnace, column, localIndex(
            entry.x - cx * 16,
            entry.y,
            entry.z - cz * 16,
          ));
        }
      }
      if (events.smelted) {
        this.audio.play('fire_crackle', { volume: 0.5, position: { x: entry.x + 0.5, y: entry.y + 0.5, z: entry.z + 0.5 } });
      }
    }
  }

  // -------------------------------------------------------------------------
  // Save / world lifecycle
  // -------------------------------------------------------------------------

  /** Adapter: Player.toSaveData uses `position`; SaveV1's SavedPlayer uses `pos`. */
  private toSavedPlayer(): SavedPlayer {
    const data = this.player.toSaveData();
    return {
      pos: { ...data.position },
      yaw: data.yaw,
      pitch: data.pitch,
      health: data.health,
      hunger: data.hunger,
      saturation: data.saturation,
      air: data.air,
      gameMode: data.gameMode,
      inventory: data.inventory.map((slot) => ({ ...slot })),
      armor: data.armor.map((slot) => ({ ...slot })),
      selectedSlot: data.selectedSlot,
    };
  }

  async saveWorld(silent = false): Promise<boolean> {
    try {
      if (!Number.isFinite(this.player.position.x) || !Number.isFinite(this.player.position.y)) {
        throw new Error('玩家位置无效，已取消保存');
      }
      this.worldMeta.lastPlayed = Date.now();
      this.worldMeta.gameMode = this.player.gameMode;
      this.worldMeta.difficulty = this.settings.difficulty;
      const save = createSave(this.worldMeta, this.toSavedPlayer(), this.world.ticks, this.editStore);
      await writeWorldSave(save);
      this.syncWorldUrl();
      if (!silent) this.hud.showToast('世界已保存');
      return true;
    } catch (error) {
      console.error(error);
      this.hud.showToast(`保存失败：${String(error)}`, 'error');
      return false;
    }
  }

  private syncWorldUrl(): void {
    const params = new URLSearchParams();
    params.set('world', this.worldMeta.id);
    params.set('seed', this.worldMeta.seed);
    params.set('name', this.worldMeta.name);
    params.set('mode', this.player.gameMode);
    params.set('difficulty', this.settings.difficulty);
    try {
      history.replaceState(null, '', `${location.pathname}?${params.toString()}`);
    } catch {
      // ignore history errors (file:// or sandboxed contexts)
    }
  }

  private navigateTo(params: Record<string, string>): void {
    const search = new URLSearchParams(params);
    location.href = `${location.pathname}?${search.toString()}`;
  }

  private listWorldSummaries(): Promise<WorldSummary[]> {
    return listWorldSaves().then((entries) =>
      entries.map((entry) => ({
        id: entry.id,
        name: entry.name,
        seed: entry.seed,
        gameMode: entry.gameMode,
        difficulty: entry.difficulty,
        lastPlayed: entry.lastPlayed,
        version: entry.gameVersion,
      })),
    );
  }

  private updateGameSettings(patch: Partial<{
    difficulty: Difficulty;
    renderDistance: number;
    fov: number;
    mouseSensitivity: number;
    volume: number;
    clouds: boolean;
    pixelRatio: number;
    showFps: boolean;
  }>): void {
    const settings = this.settings;
    if (patch.difficulty) settings.difficulty = patch.difficulty;
    if (typeof patch.renderDistance === 'number') {
      settings.renderDistance = Math.max(4, Math.min(12, Math.round(patch.renderDistance)));
    }
    if (typeof patch.fov === 'number') {
      settings.fov = Math.max(50, Math.min(110, Math.round(patch.fov)));
      this.player.baseFov = settings.fov;
    }
    if (typeof patch.mouseSensitivity === 'number') {
      settings.sensitivity = Math.max(0.1, Math.min(3, patch.mouseSensitivity));
      this.player.sensitivity = settings.sensitivity;
      this.input.sensitivity = settings.sensitivity;
    }
    if (typeof patch.volume === 'number') {
      settings.masterVolume = Math.max(0, Math.min(1, patch.volume));
      this.audio.setMasterVolume(settings.masterVolume);
    }
    if (typeof patch.clouds === 'boolean') {
      settings.clouds = patch.clouds;
      this.sky.setCloudsVisible(settings.clouds);
    }
    if (typeof patch.pixelRatio === 'number') {
      settings.pixelRatio = Math.max(0.5, Math.min(2, patch.pixelRatio));
      this.renderer.setPixelRatio(settings.pixelRatio);
    }
    if (typeof patch.showFps === 'boolean') settings.showFps = patch.showFps;
    saveSettings(settings);
  }

  private executeCommandText(text: string): { ok: boolean; message: string } {
    const context: CommandContext = {
      world: {
        getSeed: () => this.world.seed,
        getTime: () => this.world.time(),
        setTime: (ticks) => this.world.setTicks(ticks),
        getSpawnPoint: () => this.spawn,
        setSpawnPoint: (point) => {
          this.spawn = { x: point.x, y: point.y, z: point.z };
        },
      },
      getGameMode: () => this.player.gameMode,
      setGameMode: (mode) => this.setGameMode(mode),
      getPlayerPosition: () => this.player.position,
      teleport: (point) => this.teleport(point.x, point.y, point.z),
      giveItem: (id, count) => this.give(id, count),
      clearInventory: () => {
        this.inventory.clear();
        this.lastHandSignature = '';
      },
      killPlayer: () => {
        this.player.damage(1000, { cause: 'command', armor: false, ignoreInvulnerable: true });
      },
    };
    const result = executeCommand(text.replace(/^\//, ''), context);
    if (result.message) this.ui.addChatLine(result.message, result.ok ? 'system' : 'error');
    return result;
  }

  private dropItem(item: string, count: number, durability?: number): void {
    if (!item || count <= 0 || !getItem(item)) return;
    void durability;
    const direction = this.player.lookDirection();
    this.entityManager.spawnItem(item, Math.floor(count), {
      x: this.player.position.x + direction.x * 0.6,
      y: this.player.position.y + 1.3,
      z: this.player.position.z + direction.z * 0.6,
    });
  }

  private createUiBridge(): GameUiBridge {
    return {
      setPaused: (paused) => {
        this.input.setEnabled(!paused);
        if (paused) this.input.exitPointerLock();
      },
      onScreenChange: (screen) => {
        this.currentScreen = screen;
      },
      getPlayer: () => ({
        health: this.player.health,
        maxHealth: this.player.maxHealth,
        hunger: this.player.hunger,
        saturation: this.player.saturation,
        air: this.player.airBubbles,
        maxAir: 10,
        armorPoints: this.inventory.armorPoints(),
        gameMode: this.player.gameMode,
        position: this.player.position,
        yaw: this.player.yaw,
        pitch: this.player.pitch,
        onGround: this.player.onGround,
        inWater: this.player.inWater,
        sprinting: this.player.sprinting,
        sneaking: this.player.sneaking,
        dead: this.player.dead,
      }),
      getWorld: () => {
        const time = this.world.time();
        return {
          name: this.worldMeta.name,
          seed: this.world.seed,
          gameMode: this.player.gameMode,
          difficulty: this.settings.difficulty,
          day: time.day,
          timeOfDay: time.timeOfDay,
          renderDistance: this.settings.renderDistance,
          loadedColumns: this.world.loadedColumnCount,
        };
      },
      getSettings: () => ({
        difficulty: this.settings.difficulty,
        renderDistance: this.settings.renderDistance,
        fov: this.settings.fov,
        mouseSensitivity: this.settings.sensitivity,
        volume: this.settings.masterVolume,
        clouds: this.settings.clouds,
        pixelRatio: this.settings.pixelRatio,
        showFps: this.settings.showFps,
      }),
      getInventory: () => this.inventory,
      notifyInventoryChanged: () => {
        this.player.setSelectedSlot(this.inventory.selected);
        this.player.armor = this.inventory.armor;
        this.lastHandSignature = '';
      },
      listWorlds: () => this.listWorldSummaries(),
      playWorld: (world: WorldSummary) => {
        this.navigateTo({
          world: world.id,
          seed: world.seed,
          name: world.name,
          mode: world.gameMode,
          difficulty: world.difficulty,
        });
      },
      createWorld: (options: CreateWorldOptions) => {
        this.navigateTo({
          new: '1',
          name: options.name,
          seed: options.seed,
          mode: options.gameMode,
          difficulty: options.difficulty,
          rd: String(options.renderDistance),
        });
      },
      deleteWorld: (id: string) => {
        void deleteWorldSave(id).then(
          () => this.hud.showToast('世界已删除'),
          (error: unknown) => this.hud.showToast(`删除失败：${String(error)}`, 'error'),
        );
      },
      save: () => this.saveWorld(false).then(() => undefined),
      saveAndQuit: () => {
        void this.saveWorld(true).finally(() => this.navigateTo({ title: '1' }));
      },
      quitToTitle: () => this.navigateTo({ title: '1' }),
      respawn: () => this.respawn(),
      updateSettings: (patch) => this.updateGameSettings(patch),
      executeCommand: (text) => this.executeCommandText(text),
      chat: (message) => this.ui.addChatLine(message, 'chat'),
      dropItem: (item, count, durability) => this.dropItem(item, count, durability),
      showToast: (message, kind) => this.hud.showToast(message, kind),
      getMetrics: () => this.metrics(),
      requestPointerLock: () => this.input.requestPointerLock(),
      exitPointerLock: () => this.input.exitPointerLock(),
      isPointerLocked: () => this.input.pointerLocked,
    };
  }

  // -------------------------------------------------------------------------
  // Debug / automation API
  // -------------------------------------------------------------------------

  private metrics(): Metrics {
    const memory = (performance as unknown as { memory?: { usedJSHeapSize: number } }).memory;
    return {
      fps: this.fps,
      frameMs: this.frameMs,
      drawCalls: this.lastDrawCalls,
      triangles: this.lastTriangles,
      columns: this.world.loadedColumnCount,
      meshes: this.chunkRenderer.meshCount,
      entities: this.entityManager.entityCount,
      heapMB: memory ? memory.usedJSHeapSize / (1024 * 1024) : 0,
    };
  }

  teleport(x: number, y: number, z: number): void {
    this.player.position = { x, y, z };
    this.player.velocity = { x: 0, y: 0, z: 0 };
    this.player.fallDistance = 0;
  }

  spawnMob(type: string, x?: number, y?: number, z?: number): { id: number; type: string } | null {
    if (!(MOB_TYPES as readonly string[]).includes(type)) return null;
    const direction = this.player.lookDirection();
    const px = x ?? this.player.position.x + direction.x * 4;
    const pz = z ?? this.player.position.z + direction.z * 4;
    const py = y ?? Math.max(1, this.world.spawnY(Math.floor(px), Math.floor(pz)));
    const mob = this.entityManager.spawn(type as MobType, px, py, pz);
    return { id: mob.id, type };
  }

  spawnItem(item: string, count = 1): number {
    if (!getItem(item)) return 0;
    const dir = this.player.lookDirection();
    const entity = this.entityManager.spawnItem(item, Math.max(1, Math.floor(count)), {
      x: this.player.position.x + dir.x * 1.6,
      y: this.player.position.y + 1.1,
      z: this.player.position.z + dir.z * 1.6,
    });
    return entity.id;
  }

  explode(x?: number, y?: number, z?: number, power = 3): void {
    const dir = this.player.lookDirection();
    const center = {
      x: x ?? this.player.position.x + dir.x * 3,
      y: y ?? this.player.position.y + 1,
      z: z ?? this.player.position.z + dir.z * 3,
    };
    this.entityManager.explodeAt(center, power, 'tnt');
  }

  private installDebugApi(): void {
    installDebugApi({
      isReady: () => this.ready,
      errors: this.errors,
      metrics: () => this.metrics(),
      getSeed: () => this.world.seed,
      getTime: () => this.world.time(),
      setTime: (ticks) => this.world.setTicks(ticks),
      getColumns: () => this.world.loadedColumnCount,
      getGameMode: () => this.player.gameMode,
      setGameMode: (mode) => this.setGameMode(mode),
      getPlayer: () => ({
        position: { ...this.player.position },
        yaw: this.player.yaw,
        pitch: this.player.pitch,
        health: this.player.health,
        hunger: this.player.hunger,
        air: this.player.air,
        onGround: this.player.onGround,
        inWater: this.player.inWater,
        dead: this.player.dead,
        gameMode: this.player.gameMode,
        selectedSlot: this.player.selectedSlot,
      }),
      getHotbar: () => this.player.inventory.slice(0, 9).map((slot) => ({ ...slot })),
      getBlock: (x, y, z) => this.world.getBlock(x, y, z),
      blockId: (name) => blockNumeric(name),
      setBlock: (x, y, z, id, meta = 0) => this.world.setBlock(x, y, z, id, meta),
      teleport: (x, y, z) => this.teleport(x, y, z),
      look: (yaw, pitch) => this.player.setLook(yaw, pitch),
      applyLook: (dx, dy) => this.player.look(dx, dy, this.settings.sensitivity),
      pressKey: (code) => this.input.press(code),
      releaseKey: (code) => this.input.release(code),
      click: (button) => this.input.click(button),
      setAttack: (pressed) => {
        this.input.state.attack = pressed;
        if (pressed) this.input.state.attackPressed = true;
      },
      setUse: (pressed) => {
        if (pressed && !this.input.state.use) this.input.state.usePressed = true;
        if (!pressed && this.input.state.use) this.input.state.useReleased = true;
        this.input.state.use = pressed;
      },
      scroll: (notches) => {
        this.player.setSelectedSlot(this.player.selectedSlot + notches);
      },
      selectSlot: (index) => this.player.setSelectedSlot(index),
      give: (item, count) => this.give(item, count),
      isPointerLocked: () => this.input.pointerLocked,
      requestPointerLock: () => this.input.requestPointerLock(),
      spawnMob: (type, x, y, z) => this.spawnMob(type, x, y, z),
      spawnItem: (item, count) => this.spawnItem(item, count),
      explode: (x, y, z, power) => this.explode(x, y, z, power),
      entitySnapshots: () => this.entityManager.snapshots(),
      entityCounts: () => ({
        mobs: this.entityManager.mobs.length,
        items: this.entityManager.items.length,
        total: this.entityManager.entityCount,
      }),
      clearEntities: () => this.entityManager.clear(),
      setSpawnEnabled: (enabled) => this.entityManager.setSpawnEnabled(enabled),
      getInteraction: () => ({
        hit: this.interaction.hit
          ? { x: this.interaction.hit.x, y: this.interaction.hit.y, z: this.interaction.hit.z, id: this.interaction.hit.id }
          : null,
        breaking: this.interaction.breaking,
        progress: this.interaction.breakProgress,
      }),
      openScreen: (name) => this.ui.openScreen(name),
      closeScreen: () => this.ui.closeScreen(),
      getScreen: () => this.ui.getScreen(),
      clickSlot: (index, button = 0, shift = false) => this.ui.clickSlot(index, button, shift),
      getInventoryState: () => ({
        slots: this.inventory.slots.map((slot) => ({ ...slot })),
        armor: this.inventory.armor.map((slot) => ({ ...slot })),
        selected: this.inventory.selected,
      }),
      saveWorld: () => this.saveWorld(false),
      listWorlds: () => this.listWorldSummaries(),
      editCount: () => this.editStore.editCount,
      isColumnLoaded: (cx, cz) => this.world.isChunkLoaded(cx, cz),
      getLight: (x, y, z) => ({
        sky: this.world.getSkyLight(x, y, z),
        block: this.world.getBlockLight(x, y, z),
      }),
      setThirdPerson: (enabled) => this.setThirdPerson(enabled),
      respawn: () => this.respawn(),
      runCommand: (text) => this.executeCommandText(text),
      setBlockOutlineVisible: (visible) => {
        this.outlineEnabled = visible;
      },
      setFlying: (enabled) => {
        this.player.flying = enabled;
      },
      setHandVisible: (visible) => {
        this.handVisible = visible;
      },
    });
  }

  getSnapshots(): EntitySnapshot[] {
    return this.entityManager.snapshots();
  }

  // -------------------------------------------------------------------------
  // Global events
  // -------------------------------------------------------------------------

  private handleResize = (): void => {
    this.renderer.resize();
  };

  private installGlobalKeys(): void {
    document.addEventListener('keydown', (event) => {
      if (event.code === 'F5') {
        event.preventDefault();
        this.setThirdPerson(!this.thirdPerson);
      }
    });
  }

  private installErrorCapture(): void {
    window.addEventListener('error', (event) => this.errors.push(event.message));
    window.addEventListener('unhandledrejection', (event) => this.errors.push(String(event.reason)));
    const original = console.error.bind(console);
    console.error = (...args: unknown[]) => {
      this.errors.push(args.map((value) => String(value)).join(' '));
      original(...args);
    };
  }

  dispose(): void {
    this.input.dispose();
    window.removeEventListener('resize', this.handleResize);
    this.blockOverlay.dispose();
    this.playerModel.dispose();
    this.chunkRenderer.dispose();
    this.entityRenderer.dispose();
    this.sky.dispose();
    this.particleRenderer.dispose?.();
    this.firstPerson.dispose?.();
    this.audio.dispose();
    this.atlas.dispose();
    this.itemAtlas.dispose();
    this.hud.dispose();
    this.ui.dispose();
    this.renderer.webgl.dispose();
  }
}

function nextFrame(): Promise<void> {
  return new Promise((resolve) => requestAnimationFrame(() => resolve()));
}
