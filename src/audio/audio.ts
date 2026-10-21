/**
 * Procedural WebAudio sound effects — no external audio files.
 *
 * Every sound is synthesised on demand from oscillators + noise buffers. The
 * module is safe to import in Node: no AudioContext is created until
 * `AudioEngine.unlock()` is called from a real user gesture.
 *
 * Typical main.ts wiring:
 *
 *   const audio = new AudioEngine({ masterVolume: settings.volume });
 *   audio.attachAutoUnlock(window);            // pointerdown/keydown unlock
 *   audio.setListenerPosition(cam.x, cam.y, cam.z);
 *   audio.setListenerOrientation(player.yaw);
 *   audio.play('break_stone', { position: { x, y, z } });
 *
 * Interaction callbacks use the `breakSoundFor` / `placeSoundFor` /
 * `stepSoundFor` helpers to translate block materials into sound ids.
 */

import type { Vec3 } from '../core/types';
import type { BlockSound } from '../world/blocks';

// ---------------------------------------------------------------------------
// Sound registry
// ---------------------------------------------------------------------------

export const SOUND_IDS = [
  // Blocks: break
  'break_stone',
  'break_dirt',
  'break_grass',
  'break_wood',
  'break_sand',
  'break_glass',
  'break_wool',
  'break_metal',
  'break_plant',
  // Blocks: place
  'place_stone',
  'place_dirt',
  'place_wood',
  'place_glass',
  'place_plant',
  // Blocks: footsteps
  'step_stone',
  'step_dirt',
  'step_wood',
  'step_grass',
  'step_sand',
  // Player
  'hurt',
  'death',
  'eat',
  'burp',
  'tool_break',
  'pickup',
  'click',
  // Combat / explosion
  'explosion',
  'fuse',
  'tnt_primed',
  'bow_shoot',
  'arrow_hit',
  // Fluids
  'splash',
  'swim',
  'lava_pop',
  'fire_crackle',
  // Mobs
  'zombie',
  'skeleton',
  'creeper',
  'pig',
  'cow',
  'sheep',
  'chicken',
] as const;

export type SoundId = (typeof SOUND_IDS)[number];

// ---------------------------------------------------------------------------
// Block material → sound mappings
// ---------------------------------------------------------------------------

export function breakSoundFor(material: BlockSound): SoundId {
  switch (material) {
    case 'dirt':
      return 'break_dirt';
    case 'grass':
      return 'break_grass';
    case 'wood':
      return 'break_wood';
    case 'sand':
      return 'break_sand';
    case 'glass':
      return 'break_glass';
    case 'wool':
      return 'break_wool';
    case 'metal':
      return 'break_metal';
    case 'plant':
      return 'break_plant';
    default:
      return 'break_stone';
  }
}

export function placeSoundFor(material: BlockSound): SoundId {
  switch (material) {
    case 'dirt':
    case 'sand':
      return 'place_dirt';
    case 'wood':
    case 'wool':
      return 'place_wood';
    case 'glass':
      return 'place_glass';
    case 'plant':
    case 'grass':
      return 'place_plant';
    default:
      return 'place_stone';
  }
}

export function stepSoundFor(material: BlockSound): SoundId {
  switch (material) {
    case 'dirt':
    case 'plant':
      return 'step_dirt';
    case 'grass':
      return 'step_grass';
    case 'wood':
    case 'wool':
      return 'step_wood';
    case 'sand':
      return 'step_sand';
    default:
      return 'step_stone';
  }
}

// ---------------------------------------------------------------------------
// Synthesis helpers
// ---------------------------------------------------------------------------

interface SynthContext {
  ctx: AudioContext;
  out: AudioNode;
  now: number;
  pitch: number;
}

type SoundBuilder = (synth: SynthContext) => void;

interface ToneOptions {
  type: OscillatorType;
  freq: number;
  endFreq?: number;
  duration: number;
  gain: number;
  attack?: number;
}

function tone(synth: SynthContext, options: ToneOptions): void {
  const { ctx, out, now } = synth;
  const freq = Math.max(20, options.freq * synth.pitch);
  const osc = ctx.createOscillator();
  const gain = ctx.createGain();
  osc.type = options.type;
  osc.frequency.setValueAtTime(freq, now);
  if (options.endFreq !== undefined) {
    osc.frequency.exponentialRampToValueAtTime(Math.max(20, options.endFreq * synth.pitch), now + options.duration);
  }
  const attack = Math.max(0.001, options.attack ?? 0.004);
  gain.gain.setValueAtTime(0.0001, now);
  gain.gain.linearRampToValueAtTime(Math.max(0.0001, options.gain), now + attack);
  gain.gain.exponentialRampToValueAtTime(0.0001, now + options.duration);
  osc.connect(gain).connect(out);
  osc.start(now);
  osc.stop(now + options.duration + 0.03);
}

interface NoiseOptions {
  duration: number;
  gain: number;
  filterType?: BiquadFilterType;
  frequency?: number;
  endFrequency?: number;
  q?: number;
}

/**
 * White-noise burst through a biquad filter. `Math.random` is allowed *only*
 * for audio noise; gameplay logic stays deterministic.
 */
function noise(synth: SynthContext, options: NoiseOptions): void {
  const { ctx, out, now } = synth;
  const length = Math.max(1, Math.floor(ctx.sampleRate * options.duration));
  const buffer = ctx.createBuffer(1, length, ctx.sampleRate);
  const data = buffer.getChannelData(0);
  for (let i = 0; i < length; i++) data[i] = Math.random() * 2 - 1;

  const source = ctx.createBufferSource();
  source.buffer = buffer;

  const filter = ctx.createBiquadFilter();
  filter.type = options.filterType ?? 'lowpass';
  filter.frequency.setValueAtTime(Math.max(40, (options.frequency ?? 800) * synth.pitch), now);
  if (options.endFrequency !== undefined) {
    filter.frequency.exponentialRampToValueAtTime(Math.max(40, options.endFrequency * synth.pitch), now + options.duration);
  }
  filter.Q.value = options.q ?? 0.8;

  const gain = ctx.createGain();
  gain.gain.setValueAtTime(0.0001, now);
  gain.gain.linearRampToValueAtTime(Math.max(0.0001, options.gain), now + 0.006);
  gain.gain.exponentialRampToValueAtTime(0.0001, now + options.duration);

  source.connect(filter).connect(gain).connect(out);
  source.start(now);
  source.stop(now + options.duration + 0.02);
}

function blip(synth: SynthContext, freq: number, duration: number, gain: number, type: OscillatorType = 'square'): void {
  tone(synth, { type, freq, duration, gain });
}

function materialBreak(
  noiseFreq: number,
  filterType: BiquadFilterType,
  toneFreq: number,
  duration = 0.16,
  gain = 0.5,
): SoundBuilder {
  return (synth) => {
    noise(synth, { duration, gain, filterType, frequency: noiseFreq, endFrequency: noiseFreq * 0.45 });
    tone(synth, { type: 'triangle', freq: toneFreq, endFreq: toneFreq * 0.55, duration: duration * 0.9, gain: gain * 0.5 });
  };
}

function materialPlace(
  noiseFreq: number,
  filterType: BiquadFilterType,
  toneFreq: number,
): SoundBuilder {
  return (synth) => {
    noise(synth, { duration: 0.09, gain: 0.32, filterType, frequency: noiseFreq });
    tone(synth, { type: 'triangle', freq: toneFreq, endFreq: toneFreq * 0.7, duration: 0.08, gain: 0.16 });
  };
}

function materialStep(noiseFreq: number, filterType: BiquadFilterType, toneFreq: number): SoundBuilder {
  return (synth) => {
    noise(synth, { duration: 0.06, gain: 0.18, filterType, frequency: noiseFreq });
    tone(synth, { type: 'triangle', freq: toneFreq, endFreq: toneFreq * 0.7, duration: 0.05, gain: 0.08 });
  };
}

// ---------------------------------------------------------------------------
// Sound definitions (~40 distinct effects, all procedural)
// ---------------------------------------------------------------------------

const BUILDERS: Record<SoundId, SoundBuilder> = {
  break_stone: materialBreak(1100, 'lowpass', 130, 0.18, 0.5),
  break_dirt: materialBreak(500, 'lowpass', 90, 0.16, 0.45),
  break_grass: materialBreak(1800, 'highpass', 160, 0.14, 0.32),
  break_wood: materialBreak(750, 'bandpass', 190, 0.17, 0.45),
  break_sand: materialBreak(2200, 'highpass', 120, 0.15, 0.35),
  break_glass: (synth) => {
    noise(synth, { duration: 0.2, gain: 0.4, filterType: 'highpass', frequency: 2600 });
    blip(synth, 1800, 0.12, 0.18, 'sine');
    blip(synth, 2400, 0.09, 0.12, 'sine');
  },
  break_wool: materialBreak(380, 'lowpass', 80, 0.16, 0.32),
  break_metal: (synth) => {
    noise(synth, { duration: 0.16, gain: 0.3, filterType: 'bandpass', frequency: 1600, q: 3 });
    blip(synth, 900, 0.18, 0.2, 'sine');
    blip(synth, 1350, 0.14, 0.14, 'sine');
  },
  break_plant: materialBreak(1500, 'highpass', 220, 0.1, 0.22),

  place_stone: materialPlace(900, 'lowpass', 150),
  place_dirt: materialPlace(450, 'lowpass', 95),
  place_wood: materialPlace(700, 'bandpass', 180),
  place_glass: (synth) => {
    blip(synth, 1500, 0.08, 0.16, 'sine');
    noise(synth, { duration: 0.08, gain: 0.15, filterType: 'highpass', frequency: 2500 });
  },
  place_plant: materialPlace(1200, 'highpass', 200),

  step_stone: materialStep(700, 'lowpass', 110),
  step_dirt: materialStep(360, 'lowpass', 75),
  step_wood: materialStep(600, 'bandpass', 150),
  step_grass: materialStep(1500, 'highpass', 180),
  step_sand: materialStep(1400, 'highpass', 100),

  hurt: (synth) => {
    noise(synth, { duration: 0.18, gain: 0.3, filterType: 'bandpass', frequency: 700, q: 1.4 });
    tone(synth, { type: 'sawtooth', freq: 260, endFreq: 110, duration: 0.22, gain: 0.25 });
  },
  death: (synth) => {
    tone(synth, { type: 'sawtooth', freq: 330, endFreq: 80, duration: 0.65, gain: 0.3 });
    noise(synth, { duration: 0.4, gain: 0.2, filterType: 'lowpass', frequency: 600 });
  },
  eat: (synth) => {
    noise(synth, { duration: 0.07, gain: 0.25, filterType: 'bandpass', frequency: 1200, q: 2 });
    blip(synth, 180, 0.05, 0.1, 'triangle');
  },
  burp: (synth) => {
    tone(synth, { type: 'square', freq: 110, endFreq: 65, duration: 0.22, gain: 0.22 });
  },
  tool_break: (synth) => {
    noise(synth, { duration: 0.12, gain: 0.32, filterType: 'bandpass', frequency: 2200, q: 2 });
    blip(synth, 420, 0.14, 0.16, 'sawtooth');
  },
  pickup: (synth) => {
    blip(synth, 620, 0.06, 0.16, 'sine');
    tone(synth, { type: 'sine', freq: 900, duration: 0.1, gain: 0.16, attack: 0.02 });
  },
  click: (synth) => {
    blip(synth, 800, 0.035, 0.12, 'square');
  },

  explosion: (synth) => {
    noise(synth, { duration: 0.9, gain: 0.7, filterType: 'lowpass', frequency: 1600, endFrequency: 90 });
    tone(synth, { type: 'sine', freq: 90, endFreq: 28, duration: 0.8, gain: 0.55 });
    tone(synth, { type: 'triangle', freq: 220, endFreq: 45, duration: 0.35, gain: 0.25 });
  },
  fuse: (synth) => {
    noise(synth, { duration: 0.5, gain: 0.12, filterType: 'highpass', frequency: 2600 });
  },
  tnt_primed: (synth) => {
    noise(synth, { duration: 0.7, gain: 0.16, filterType: 'highpass', frequency: 3200 });
    blip(synth, 300, 0.08, 0.06, 'square');
  },
  bow_shoot: (synth) => {
    noise(synth, { duration: 0.22, gain: 0.28, filterType: 'highpass', frequency: 2200, endFrequency: 900 });
    tone(synth, { type: 'triangle', freq: 440, endFreq: 180, duration: 0.18, gain: 0.14 });
  },
  arrow_hit: (synth) => {
    noise(synth, { duration: 0.07, gain: 0.28, filterType: 'bandpass', frequency: 1400, q: 2 });
    blip(synth, 300, 0.05, 0.12, 'triangle');
  },

  splash: (synth) => {
    noise(synth, { duration: 0.32, gain: 0.34, filterType: 'lowpass', frequency: 2400, endFrequency: 350 });
  },
  swim: (synth) => {
    noise(synth, { duration: 0.25, gain: 0.14, filterType: 'lowpass', frequency: 900 });
  },
  lava_pop: (synth) => {
    tone(synth, { type: 'sine', freq: 220, endFreq: 70, duration: 0.2, gain: 0.22 });
    noise(synth, { duration: 0.12, gain: 0.12, filterType: 'lowpass', frequency: 500 });
  },
  fire_crackle: (synth) => {
    noise(synth, { duration: 0.3, gain: 0.14, filterType: 'highpass', frequency: 1800 });
    blip(synth, 1400, 0.03, 0.05, 'square');
  },

  zombie: (synth) => {
    tone(synth, { type: 'sawtooth', freq: 95, endFreq: 62, duration: 0.55, gain: 0.22, attack: 0.08 });
    noise(synth, { duration: 0.5, gain: 0.12, filterType: 'bandpass', frequency: 420, q: 1.2 });
  },
  skeleton: (synth) => {
    for (let i = 0; i < 3; i++) {
      noise(synth, { duration: 0.05, gain: 0.16, filterType: 'bandpass', frequency: 1800 + i * 350, q: 3 });
    }
  },
  creeper: (synth) => {
    noise(synth, { duration: 0.7, gain: 0.18, filterType: 'highpass', frequency: 2400 });
  },
  pig: (synth) => {
    tone(synth, { type: 'square', freq: 150, endFreq: 95, duration: 0.22, gain: 0.2 });
    tone(synth, { type: 'square', freq: 120, endFreq: 80, duration: 0.18, gain: 0.14, attack: 0.03 });
  },
  cow: (synth) => {
    tone(synth, { type: 'sawtooth', freq: 105, endFreq: 82, duration: 0.8, gain: 0.22, attack: 0.12 });
  },
  sheep: (synth) => {
    tone(synth, { type: 'square', freq: 320, endFreq: 260, duration: 0.35, gain: 0.16, attack: 0.03 });
    noise(synth, { duration: 0.3, gain: 0.06, filterType: 'bandpass', frequency: 900, q: 2 });
  },
  chicken: (synth) => {
    blip(synth, 620, 0.05, 0.14, 'square');
    blip(synth, 520, 0.05, 0.12, 'square');
  },
};

// ---------------------------------------------------------------------------
// 3D attenuation
// ---------------------------------------------------------------------------

/**
 * Linear distance attenuation: 1 at/below `refDistance`, 0 at/above
 * `maxDistance`. Kept linear (instead of inverse-square) because the world is
 * small and it is easier to balance and test.
 */
export function attenuationFor(distance: number, refDistance = 2, maxDistance = 32): number {
  if (!Number.isFinite(distance) || distance >= maxDistance) return 0;
  if (distance <= refDistance) return 1;
  return 1 - (distance - refDistance) / (maxDistance - refDistance);
}

// ---------------------------------------------------------------------------
// Audio engine
// ---------------------------------------------------------------------------

export interface AudioEngineOptions {
  /** Master volume 0..1 (default 0.8). */
  masterVolume?: number;
  /** Full-volume radius in blocks (default 2). */
  refDistance?: number;
  /** Cull radius in blocks (default 32). */
  maxDistance?: number;
}

export interface SoundPlayOptions {
  /** World position; omit for UI/global sounds. */
  position?: Vec3;
  /** Per-sound volume multiplier (default 1). */
  volume?: number;
  /** Pitch multiplier (default 1). */
  pitch?: number;
}

function getAudioContextCtor(): typeof AudioContext | null {
  const scope = globalThis as unknown as {
    AudioContext?: typeof AudioContext;
    webkitAudioContext?: typeof AudioContext;
  };
  return scope.AudioContext ?? scope.webkitAudioContext ?? null;
}

/**
 * Lazily-created WebAudio mixer with gesture unlock, master volume and simple
 * stereo panning + distance attenuation.
 */
export class AudioEngine {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private unlocked = false;
  private masterVolume: number;
  private readonly refDistance: number;
  private readonly maxDistance: number;
  private listener: Vec3 = { x: 0, y: 0, z: 0 };
  private listenerYaw = 0;

  constructor(options: AudioEngineOptions = {}) {
    this.masterVolume = Math.min(1, Math.max(0, options.masterVolume ?? 0.8));
    this.refDistance = Math.max(0.01, options.refDistance ?? 2);
    this.maxDistance = Math.max(this.refDistance + 0.01, options.maxDistance ?? 32);
  }

  get isUnlocked(): boolean {
    return this.unlocked;
  }

  get context(): AudioContext | null {
    return this.ctx;
  }

  get volume(): number {
    return this.masterVolume;
  }

  /**
   * Create/resume the AudioContext. Must be called from a user gesture the
   * first time; returns false when the browser refuses.
   */
  async unlock(): Promise<boolean> {
    if (!this.ctx) {
      const Ctor = getAudioContextCtor();
      if (!Ctor) return false;
      try {
        this.ctx = new Ctor();
      } catch {
        return false;
      }
      this.master = this.ctx.createGain();
      this.master.gain.value = this.masterVolume;
      this.master.connect(this.ctx.destination);
    }
    if (this.ctx.state === 'suspended') {
      try {
        await this.ctx.resume();
      } catch {
        return false;
      }
    }
    this.unlocked = this.ctx.state === 'running';
    return this.unlocked;
  }

  /** Attach one-shot gesture listeners that unlock audio on first interaction. */
  attachAutoUnlock(target: EventTarget = window): () => void {
    const events = ['pointerdown', 'keydown', 'touchstart', 'click'];
    let handler: () => void;
    const cleanup = (): void => {
      for (const event of events) target.removeEventListener(event, handler);
    };
    handler = (): void => {
      void this.unlock().then((ok) => {
        if (ok) cleanup();
      });
    };
    for (const event of events) target.addEventListener(event, handler, { passive: true });
    return cleanup;
  }

  setMasterVolume(volume: number): void {
    this.masterVolume = Math.min(1, Math.max(0, volume));
    if (this.master) this.master.gain.value = this.masterVolume;
  }

  setListenerPosition(x: number, y: number, z: number): void {
    this.listener = { x, y, z };
  }

  /** Yaw in radians using the same convention as the player/camera. */
  setListenerOrientation(yaw: number): void {
    this.listenerYaw = yaw;
  }

  /** Play a sound by id. Silently no-ops before the first unlock. */
  play(id: SoundId, options: SoundPlayOptions = {}): void {
    const ctx = this.ctx;
    const master = this.master;
    if (!ctx || !master || !this.unlocked || this.masterVolume <= 0) return;
    const builder = BUILDERS[id];
    if (!builder) return;

    let volume = options.volume ?? 1;
    let panner: StereoPannerNode | null = null;
    if (options.position) {
      const dx = options.position.x - this.listener.x;
      const dy = options.position.y - this.listener.y;
      const dz = options.position.z - this.listener.z;
      const distance = Math.hypot(dx, dy, dz);
      const attenuation = attenuationFor(distance, this.refDistance, this.maxDistance);
      if (attenuation <= 0) return;
      volume *= attenuation;
      if (typeof ctx.createStereoPanner === 'function') {
        panner = ctx.createStereoPanner();
        const rightX = Math.cos(this.listenerYaw);
        const rightZ = -Math.sin(this.listenerYaw);
        const horizontal = Math.hypot(dx, dz);
        const pan = horizontal > 1e-4 ? (dx * rightX + dz * rightZ) / horizontal : 0;
        panner.pan.value = Math.max(-1, Math.min(1, pan * 0.75));
      }
    }
    if (volume <= 0) return;

    const out = ctx.createGain();
    out.gain.value = Math.max(0.0001, volume);
    if (panner) {
      out.connect(panner);
      panner.connect(master);
    } else {
      out.connect(master);
    }

    const synth: SynthContext = {
      ctx,
      out,
      now: ctx.currentTime + 0.005,
      pitch: Math.max(0.25, Math.min(4, options.pitch ?? 1)),
    };
    try {
      builder(synth);
    } catch {
      // Audio must never break gameplay; ignore synthesis failures.
    }
  }

  dispose(): void {
    this.unlocked = false;
    const ctx = this.ctx;
    this.ctx = null;
    this.master = null;
    if (ctx) void ctx.close().catch(() => undefined);
  }
}
