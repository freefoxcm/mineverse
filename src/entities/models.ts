/**
 * Block-built mob models for the eight MineVerse creatures.
 *
 * Coordinates are in blocks, model space: origin = feet centre, +Y up,
 * +Z forward (the direction the mob faces at yaw 0). A part is a box whose
 * rotation pivot is a joint (hip/shoulder/neck...), the box itself is centred
 * at `pivot + offset`. The renderer turns `MODEL_DEFS` into THREE groups, so
 * everything here is pure data and safe to unit test in Node.
 *
 * Texture contract for Art-E (`src/art/mobSkins.ts`):
 * - one 32x32 RGBA texture per unique `ModelPart.texture` key (transparent bg);
 * - painters are exported as `MOB_SKINS: Record<string, MobPainter>` and passed
 *   to `EntityRenderer` via its options; missing keys fall back to a
 *   deterministic procedural placeholder so the game still renders;
 * - head parts with `frontUv` map only their front (+Z) face to that pixel
 *   rectangle of the texture (top-left pixel origin), the other five faces use
 *   the full tile. Paint the face in that rectangle and generic skin elsewhere.
 */

export type MobType =
  | 'zombie'
  | 'skeleton'
  | 'creeper'
  | 'spider'
  | 'pig'
  | 'cow'
  | 'sheep'
  | 'chicken';

/** Stable iteration order used by spawners, renderers and tests. */
export const MOB_TYPES: readonly MobType[] = [
  'zombie',
  'skeleton',
  'creeper',
  'spider',
  'pig',
  'cow',
  'sheep',
  'chicken',
];

export const HOSTILE_MOBS: readonly MobType[] = ['zombie', 'skeleton', 'creeper', 'spider'];
export const PASSIVE_MOBS: readonly MobType[] = ['pig', 'cow', 'sheep', 'chicken'];

export function isHostileMob(type: MobType): boolean {
  return HOSTILE_MOBS.includes(type);
}

export function isPassiveMob(type: MobType): boolean {
  return PASSIVE_MOBS.includes(type);
}

/** Rotation channel driven by the walk / idle animation. */
export type SwingAxis = 'x' | 'y' | 'z';

export interface ModelPart {
  /** Unique within a model; also used as the three.js object name. */
  name: string;
  /** Mob skin texture key (one 32x32 tile per key). */
  texture: string;
  /** Joint position in model space (or parent-local space when `parent` is set). */
  pivot: readonly [number, number, number];
  /** Box size. */
  size: readonly [number, number, number];
  /** Box centre relative to the pivot. */
  offset: readonly [number, number, number];
  /** Parent part name; child pivots are relative to the parent's pivot. */
  parent?: string;
  /** Walk-cycle channel. */
  swing?: 'leg' | 'arm' | 'none';
  /** Rotation axis for the swing channel. */
  axis?: SwingAxis;
  /** Phase offset (0 for one side, Math.PI for the opposite side). */
  phase?: number;
  /** Swing amplitude in radians (default 0.7 for legs, 0.55 for arms). */
  amplitude?: number;
  /** Extra resting rotation applied before the walk swing. */
  rest?: readonly [number, number, number];
  /** True for head parts: they aim at the look direction. */
  head?: boolean;
  /**
   * UV rectangle (u0, v0, u1, v1) in texture pixels (32x32, origin top-left)
   * used by the front (+Z) face. Other faces use the whole tile.
   */
  frontUv?: readonly [number, number, number, number];
}

export interface MobModelDef {
  type: MobType;
  /** Collision box width/depth; the model may be wider (spider legs). */
  width: number;
  height: number;
  /** Eye height above the feet, used for line of sight. */
  eyeHeight: number;
  /** All parts. Parent parts must appear before their children. */
  parts: readonly ModelPart[];
  /** Renderer walk-cycle speed multiplier (cycles per block travelled). */
  walkCycle: number;
}

const HEAD_FRONT_UV: readonly [number, number, number, number] = [0, 0, 16, 16];

function headPart(
  name: string,
  texture: string,
  pivot: readonly [number, number, number],
  offset: readonly [number, number, number],
  size: readonly [number, number, number],
  parent?: string,
): ModelPart {
  return {
    name,
    texture,
    pivot,
    offset,
    size,
    parent,
    head: true,
    frontUv: HEAD_FRONT_UV,
    swing: 'none',
  };
}

// ---------------------------------------------------------------------------
// Zombie / skeleton share the biped rig; skeleton is slimmer.
// ---------------------------------------------------------------------------

function bipedDef(
  type: 'zombie' | 'skeleton',
  prefix: 'zombie' | 'skeleton',
  armWidth: number,
  legWidth: number,
  armRest: number,
): MobModelDef {
  const armX = 0.25 + armWidth / 2;
  const legX = legWidth / 2 + 0.005;
  return {
    type,
    width: 0.6,
    height: 1.95,
    eyeHeight: 1.74,
    walkCycle: 1,
    parts: [
      headPart('head', `${prefix}_head`, [0, 1.45, 0], [0, 0.25, 0], [0.5, 0.5, 0.5]),
      {
        name: 'body',
        texture: `${prefix}_body`,
        pivot: [0, 0.75, 0],
        size: [0.5, 0.75, 0.25],
        offset: [0, 0.375, 0],
        swing: 'none',
      },
      {
        name: 'arm_left',
        texture: `${prefix}_arm`,
        pivot: [armX, 1.375, 0],
        size: [armWidth, 0.75, armWidth],
        offset: [0, -0.375, 0],
        swing: 'arm',
        phase: 0,
        rest: [armRest, 0, 0],
      },
      {
        name: 'arm_right',
        texture: `${prefix}_arm`,
        pivot: [-armX, 1.375, 0],
        size: [armWidth, 0.75, armWidth],
        offset: [0, -0.375, 0],
        swing: 'arm',
        phase: Math.PI,
        rest: [armRest, 0, 0],
      },
      {
        name: 'leg_left',
        texture: `${prefix}_leg`,
        pivot: [legX, 0.75, 0],
        size: [legWidth, 0.75, legWidth],
        offset: [0, -0.375, 0],
        swing: 'leg',
        phase: 0,
      },
      {
        name: 'leg_right',
        texture: `${prefix}_leg`,
        pivot: [-legX, 0.75, 0],
        size: [legWidth, 0.75, legWidth],
        offset: [0, -0.375, 0],
        swing: 'leg',
        phase: Math.PI,
      },
    ],
  };
}

// ---------------------------------------------------------------------------
// Creeper
// ---------------------------------------------------------------------------

const CREEPER_MODEL: MobModelDef = {
  type: 'creeper',
  width: 0.6,
  height: 1.75,
  eyeHeight: 1.5,
  walkCycle: 1,
  parts: [
    headPart('head', 'creeper_head', [0, 1.25, 0], [0, 0.25, 0], [0.5, 0.5, 0.5]),
    {
      name: 'body',
      texture: 'creeper_body',
      pivot: [0, 0.4, 0],
      size: [0.5, 0.75, 0.25],
      offset: [0, 0.375, 0],
      swing: 'none',
    },
    {
      name: 'leg_front_left',
      texture: 'creeper_leg',
      pivot: [0.125, 0.4, 0.125],
      size: [0.25, 0.4, 0.25],
      offset: [0, -0.2, 0],
      swing: 'leg',
      phase: 0,
    },
    {
      name: 'leg_front_right',
      texture: 'creeper_leg',
      pivot: [-0.125, 0.4, 0.125],
      size: [0.25, 0.4, 0.25],
      offset: [0, -0.2, 0],
      swing: 'leg',
      phase: Math.PI,
    },
    {
      name: 'leg_back_left',
      texture: 'creeper_leg',
      pivot: [0.125, 0.4, -0.125],
      size: [0.25, 0.4, 0.25],
      offset: [0, -0.2, 0],
      swing: 'leg',
      phase: Math.PI,
    },
    {
      name: 'leg_back_right',
      texture: 'creeper_leg',
      pivot: [-0.125, 0.4, -0.125],
      size: [0.25, 0.4, 0.25],
      offset: [0, -0.2, 0],
      swing: 'leg',
      phase: 0,
    },
  ],
};

// ---------------------------------------------------------------------------
// Spider: head + thorax + abdomen + eight legs.
// ---------------------------------------------------------------------------

const SPIDER_MODEL: MobModelDef = {
  type: 'spider',
  width: 1.4,
  height: 0.9,
  eyeHeight: 0.7,
  walkCycle: 1.6,
  parts: [
    headPart('head', 'spider_head', [0, 0.55, 0.45], [0, 0, 0.12], [0.45, 0.45, 0.45]),
    {
      name: 'thorax',
      texture: 'spider_body',
      pivot: [0, 0.5, 0.05],
      size: [0.4, 0.4, 0.5],
      offset: [0, 0, 0],
      swing: 'none',
    },
    {
      name: 'abdomen',
      texture: 'spider_body',
      pivot: [0, 0.5, -0.4],
      size: [0.65, 0.5, 0.75],
      offset: [0, 0, -0.3],
      swing: 'none',
    },
    // Four legs per side, evenly spaced along Z.
    ...buildSpiderLegs(-1),
    ...buildSpiderLegs(1),
  ],
};

function buildSpiderLegs(side: -1 | 1): ModelPart[] {
  const legs: ModelPart[] = [];
  const zPositions = [0.25, 0.08, -0.09, -0.26];
  for (let i = 0; i < 4; i++) {
    const z = zPositions[i];
    legs.push({
      name: `leg_${side < 0 ? 'left' : 'right'}_${i}`,
      texture: 'spider_leg',
      pivot: [side * 0.18, 0.55, z],
      size: [0.6, 0.1, 0.1],
      offset: [side * 0.45, 0, 0],
      swing: 'leg',
      axis: 'y',
      phase: (i % 2 === 0 ? 0 : Math.PI) + (side < 0 ? 0.5 : 0),
      amplitude: 0.45,
    });
  }
  return legs;
}

// ---------------------------------------------------------------------------
// Pig
// ---------------------------------------------------------------------------

const PIG_MODEL: MobModelDef = {
  type: 'pig',
  width: 0.9,
  height: 0.9,
  eyeHeight: 0.75,
  walkCycle: 1.2,
  parts: [
    headPart('head', 'pig_head', [0, 0.55, 0.52], [0, 0.06, 0.12], [0.5, 0.5, 0.5]),
    {
      name: 'body',
      texture: 'pig_body',
      pivot: [0, 0.25, 0],
      size: [0.625, 0.5, 0.9],
      offset: [0, 0.3, 0],
      swing: 'none',
    },
    ...buildQuadrupedLegs('pig_leg', 0.2, 0.3, 0.625, 0.9),
  ],
};

// ---------------------------------------------------------------------------
// Cow: wider body, horns, walks slower.
// ---------------------------------------------------------------------------

const COW_MODEL: MobModelDef = {
  type: 'cow',
  width: 0.9,
  height: 1.4,
  eyeHeight: 1.2,
  walkCycle: 0.9,
  parts: [
    headPart('head', 'cow_head', [0, 0.95, 0.65], [0, 0.02, 0.16], [0.5, 0.5, 0.38]),
    {
      name: 'horn_left',
      texture: 'cow_horn',
      pivot: [0.27, 1.18, 0.78],
      size: [0.14, 0.14, 0.14],
      offset: [0, 0, 0],
      swing: 'none',
    },
    {
      name: 'horn_right',
      texture: 'cow_horn',
      pivot: [-0.27, 1.18, 0.78],
      size: [0.14, 0.14, 0.14],
      offset: [0, 0, 0],
      swing: 'none',
    },
    {
      name: 'body',
      texture: 'cow_body',
      pivot: [0, 0.45, 0],
      size: [0.7, 0.7, 1.15],
      offset: [0, 0.45, 0],
      swing: 'none',
    },
    ...buildQuadrupedLegs('cow_leg', 0.25, 0.55, 0.7, 1.15),
  ],
};

// ---------------------------------------------------------------------------
// Sheep
// ---------------------------------------------------------------------------

const SHEEP_MODEL: MobModelDef = {
  type: 'sheep',
  width: 0.9,
  height: 1.3,
  eyeHeight: 1.05,
  walkCycle: 1.1,
  parts: [
    headPart('head', 'sheep_head', [0, 0.83, 0.62], [0, 0.04, 0.13], [0.45, 0.45, 0.45]),
    {
      name: 'body',
      texture: 'sheep_wool',
      pivot: [0, 0.4, 0],
      size: [0.75, 0.7, 1],
      offset: [0, 0.35, 0],
      swing: 'none',
    },
    ...buildQuadrupedLegs('sheep_leg', 0.25, 0.4, 0.75, 1),
  ],
};

// ---------------------------------------------------------------------------
// Chicken: small body, beak + flapping wings parented to the body.
// ---------------------------------------------------------------------------

const CHICKEN_MODEL: MobModelDef = {
  type: 'chicken',
  width: 0.4,
  height: 0.7,
  eyeHeight: 0.55,
  walkCycle: 2,
  parts: [
    {
      name: 'body',
      texture: 'chicken_body',
      pivot: [0, 0.15, 0],
      size: [0.35, 0.3, 0.45],
      offset: [0, 0.15, 0],
      swing: 'none',
    },
    headPart('head', 'chicken_head', [0, 0.3, 0.15], [0, 0.125, 0], [0.25, 0.25, 0.25], 'body'),
    {
      name: 'beak',
      texture: 'chicken_beak',
      parent: 'head',
      pivot: [0, 0.06, 0.14],
      size: [0.1, 0.06, 0.12],
      offset: [0, 0, 0.05],
      swing: 'none',
    },
    {
      name: 'wing_left',
      texture: 'chicken_wing',
      parent: 'body',
      pivot: [0.18, 0.2, 0],
      size: [0.05, 0.3, 0.4],
      offset: [0.03, 0, 0],
      swing: 'arm',
      axis: 'z',
      phase: 0,
      amplitude: 0.35,
    },
    {
      name: 'wing_right',
      texture: 'chicken_wing',
      parent: 'body',
      pivot: [-0.18, 0.2, 0],
      size: [0.05, 0.3, 0.4],
      offset: [-0.03, 0, 0],
      swing: 'arm',
      axis: 'z',
      phase: Math.PI,
      amplitude: 0.35,
    },
    {
      name: 'leg_left',
      texture: 'chicken_leg',
      pivot: [0.1, 0.15, 0],
      size: [0.1, 0.15, 0.1],
      offset: [0, -0.075, 0],
      swing: 'leg',
      phase: 0,
      amplitude: 0.9,
    },
    {
      name: 'leg_right',
      texture: 'chicken_leg',
      pivot: [-0.1, 0.15, 0],
      size: [0.1, 0.15, 0.1],
      offset: [0, -0.075, 0],
      swing: 'leg',
      phase: Math.PI,
      amplitude: 0.9,
    },
  ],
};

function buildQuadrupedLegs(
  texture: string,
  legWidth: number,
  legHeight: number,
  bodyWidth: number,
  bodyDepth: number,
): ModelPart[] {
  // Vanilla quadrupeds stand on four corner legs. Previously the legs were all
  // placed at ±legWidth/2, which bunched them under the torso and made cows /
  // sheep look like they had two stubby legs.
  const x = Math.max(legWidth / 2, bodyWidth / 2 - legWidth / 2 - 0.02);
  // Front legs sit slightly more forward than the back pair, matching the
  // vanilla quadruped rig (cow: z +7px / -5px).
  const zFront = bodyDepth * 0.38;
  const zBack = -bodyDepth * 0.28;
  const bodies: Array<[string, number, number, number]> = [
    ['leg_front_left', x, zFront, 0],
    ['leg_front_right', -x, zFront, Math.PI],
    ['leg_back_left', x, zBack, Math.PI],
    ['leg_back_right', -x, zBack, 0],
  ];
  return bodies.map(([name, px, pz, phase]) => ({
    name,
    texture,
    pivot: [px, legHeight, pz] as const,
    size: [legWidth, legHeight, legWidth] as const,
    offset: [0, -legHeight / 2, 0] as const,
    swing: 'leg' as const,
    phase,
  }));
}

// ---------------------------------------------------------------------------
// Registry
// ---------------------------------------------------------------------------

export const MOB_MODELS: Readonly<Record<MobType, MobModelDef>> = {
  zombie: bipedDef('zombie', 'zombie', 0.25, 0.25, -1.35),
  skeleton: bipedDef('skeleton', 'skeleton', 0.2, 0.2, -0.35),
  creeper: CREEPER_MODEL,
  spider: SPIDER_MODEL,
  pig: PIG_MODEL,
  cow: COW_MODEL,
  sheep: SHEEP_MODEL,
  chicken: CHICKEN_MODEL,
};

export function mobModelOf(type: MobType): MobModelDef {
  return MOB_MODELS[type];
}

/** Unique texture keys, sorted, for the mob skin texture array. */
export const MOB_TEXTURE_NAMES: readonly string[] = (() => {
  const names = new Set<string>();
  for (const type of MOB_TYPES) {
    for (const part of MOB_MODELS[type].parts) names.add(part.texture);
  }
  return [...names].sort();
})();

export function mobTextures(type: MobType): readonly string[] {
  const names = new Set<string>();
  for (const part of MOB_MODELS[type].parts) names.add(part.texture);
  return [...names];
}

/**
 * Placeholder tint per texture, used by the renderer when Art-E has not painted
 * a skin yet (and by unit tests). Values are approximate vanilla colours.
 */
export const MOB_TEXTURE_FALLBACK_COLORS: Readonly<Record<string, number>> = {
  zombie_head: 0x4f7a49,
  zombie_body: 0x2f5b5b,
  zombie_arm: 0x4f7a49,
  zombie_leg: 0x3a3a6e,
  skeleton_head: 0xcfcfc6,
  skeleton_body: 0xbcbcb2,
  skeleton_arm: 0xc6c6bc,
  skeleton_leg: 0xb4b4aa,
  creeper_head: 0x58b558,
  creeper_body: 0x4aa84a,
  creeper_leg: 0x3f9a3f,
  spider_head: 0x3a2f28,
  spider_body: 0x2d241f,
  spider_leg: 0x231c18,
  pig_head: 0xeba3a3,
  pig_body: 0xe09595,
  pig_leg: 0xd88a8a,
  cow_head: 0x5f4632,
  cow_body: 0x8a6a4a,
  cow_leg: 0x4a3626,
  cow_horn: 0xd9d2c2,
  sheep_head: 0xd8b9a3,
  sheep_wool: 0xece8dd,
  sheep_leg: 0xcbb49f,
  chicken_head: 0xf2f2ee,
  chicken_body: 0xe9e9e4,
  chicken_leg: 0xe0a41e,
  chicken_wing: 0xdedede,
  chicken_beak: 0xe8b02a,
};
