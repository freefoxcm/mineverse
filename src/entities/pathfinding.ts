/**
 * Deterministic 3D grid A* used by hostile mobs to chase the player around
 * terrain. Nodes are block coordinates; an edge exists when a mob can walk,
 * jump up exactly one block or drop a few blocks to a standable cell.
 *
 * Budget (per task contract): at most 300 expanded nodes and 500 ms per call.
 * Water and lava are treated as impassable so land mobs do not walk into them.
 */

import type { WorldView } from '../core/contracts';
import type { Vec3 } from '../core/types';
import { FLUID_KIND, IS_COLLIDABLE } from '../world/blocks';

export interface PathOptions {
  /** Max A* node expansions (default 300). */
  maxNodes?: number;
  /** Wall-clock budget in milliseconds (default 500). */
  timeBudgetMs?: number;
  /** Max blocks a mob can jump up (default 1). */
  jumpHeight?: number;
  /** Max blocks a mob may drop in one edge (default 3). */
  maxDrop?: number;
  /** Treat water/lava as walls (default true). */
  avoidLiquids?: boolean;
  /** How many body blocks tall the mob is (default 2). */
  bodyHeight?: number;
  /** Accept reaching this XZ radius around the goal (default 1). */
  goalRadius?: number;
}

export interface PathNode {
  x: number;
  y: number;
  z: number;
  g: number;
  f: number;
  h: number;
  parent: PathNode | null;
  /** Tie-break for deterministic ordering. */
  order: number;
}

export interface PathResult {
  found: boolean;
  /** Expanded grid nodes including start and goal. */
  nodes: PathNode[];
  /** Feet-position waypoints (node centres), start excluded, goal included. */
  waypoints: Vec3[];
  expanded: number;
  cost: number;
  reason: 'ok' | 'no-path' | 'node-limit' | 'timeout' | 'invalid-start' | 'invalid-goal';
}

const DEFAULT_OPTS: Required<Omit<PathOptions, 'goalRadius'>> & { goalRadius: number } = {
  maxNodes: 300,
  timeBudgetMs: 500,
  jumpHeight: 1,
  maxDrop: 3,
  avoidLiquids: true,
  bodyHeight: 2,
  goalRadius: 0,
};

interface ResolvedOptions {
  maxNodes: number;
  timeBudgetMs: number;
  jumpHeight: number;
  maxDrop: number;
  avoidLiquids: boolean;
  bodyHeight: number;
  goalRadius: number;
}

function resolveOptions(options: PathOptions | undefined): ResolvedOptions {
  return {
    maxNodes: options?.maxNodes ?? DEFAULT_OPTS.maxNodes,
    timeBudgetMs: options?.timeBudgetMs ?? DEFAULT_OPTS.timeBudgetMs,
    jumpHeight: options?.jumpHeight ?? DEFAULT_OPTS.jumpHeight,
    maxDrop: options?.maxDrop ?? DEFAULT_OPTS.maxDrop,
    avoidLiquids: options?.avoidLiquids ?? DEFAULT_OPTS.avoidLiquids,
    bodyHeight: options?.bodyHeight ?? DEFAULT_OPTS.bodyHeight,
    goalRadius: options?.goalRadius ?? DEFAULT_OPTS.goalRadius,
  };
}

function isCollidable(world: WorldView, x: number, y: number, z: number): boolean {
  return IS_COLLIDABLE[world.getBlock(x, y, z)] === 1;
}

function isLiquid(world: WorldView, x: number, y: number, z: number): boolean {
  return FLUID_KIND[world.getBlock(x, y, z)] !== 0;
}

/**
 * True when a mob with the configured body height can stand with its feet at
 * (x, y, z): body cells clear (non-collidable, optionally non-liquid) and a
 * collidable block directly underneath.
 */
export function canStandAt(
  world: WorldView,
  x: number,
  y: number,
  z: number,
  options?: Pick<PathOptions, 'bodyHeight' | 'avoidLiquids'>,
): boolean {
  const bodyHeight = options?.bodyHeight ?? DEFAULT_OPTS.bodyHeight;
  const avoidLiquids = options?.avoidLiquids ?? DEFAULT_OPTS.avoidLiquids;
  for (let dy = 0; dy < bodyHeight; dy++) {
    if (isCollidable(world, x, y + dy, z)) return false;
    if (avoidLiquids && isLiquid(world, x, y + dy, z)) return false;
  }
  return isCollidable(world, x, y - 1, z);
}

/** True when the cells a falling mob would pass through are free of collisions/liquids. */
function canFallThrough(
  world: WorldView,
  x: number,
  z: number,
  yFrom: number,
  yTo: number,
  opts: ResolvedOptions,
): boolean {
  for (let y = yFrom; y > yTo; y--) {
    for (let dy = 0; dy < opts.bodyHeight; dy++) {
      if (isCollidable(world, x, y + dy, z)) return false;
      if (opts.avoidLiquids && isLiquid(world, x, y + dy, z)) return false;
    }
  }
  return true;
}

function nodeKey(x: number, y: number, z: number): string {
  return `${x},${y},${z}`;
}

class NodeHeap {
  private readonly items: PathNode[] = [];

  get size(): number {
    return this.items.length;
  }

  push(node: PathNode): void {
    const items = this.items;
    items.push(node);
    let i = items.length - 1;
    while (i > 0) {
      const parent = (i - 1) >> 1;
      if (heapLess(items[i], items[parent])) {
        const tmp = items[i];
        items[i] = items[parent];
        items[parent] = tmp;
        i = parent;
      } else break;
    }
  }

  pop(): PathNode | undefined {
    const items = this.items;
    if (items.length === 0) return undefined;
    const top = items[0];
    const last = items.pop() as PathNode;
    if (items.length > 0) {
      items[0] = last;
      let i = 0;
      for (;;) {
        const l = i * 2 + 1;
        const r = l + 1;
        let smallest = i;
        if (l < items.length && heapLess(items[l], items[smallest])) smallest = l;
        if (r < items.length && heapLess(items[r], items[smallest])) smallest = r;
        if (smallest === i) break;
        const tmp = items[i];
        items[i] = items[smallest];
        items[smallest] = tmp;
        i = smallest;
      }
    }
    return top;
  }
}

function heapLess(a: PathNode, b: PathNode): boolean {
  if (a.f !== b.f) return a.f < b.f;
  if (a.h !== b.h) return a.h < b.h;
  return a.order < b.order;
}

function heuristic(x: number, y: number, z: number, goal: { x: number; y: number; z: number }): number {
  // Slightly optimistic weighted Manhattan distance (diagonal friendly).
  const dx = Math.abs(x - goal.x);
  const dz = Math.abs(z - goal.z);
  const dy = Math.abs(y - goal.y);
  const horizontal = Math.max(dx, dz) + Math.min(dx, dz) * 0.4;
  return horizontal + dy * 1.2;
}

/** Resolve the grid cell an entity stands in, searching a few blocks down/up. */
function resolveStartNode(
  world: WorldView,
  feet: Vec3,
  opts: ResolvedOptions,
): { x: number; y: number; z: number } | null {
  const x = Math.floor(feet.x);
  const z = Math.floor(feet.z);
  const baseY = Math.floor(feet.y + 0.01);
  if (canStandAt(world, x, baseY, z, opts)) return { x, y: baseY, z };
  for (let dy = 1; dy <= 3; dy++) {
    if (canStandAt(world, x, baseY - dy, z, opts)) return { x, y: baseY - dy, z };
  }
  for (let dy = 1; dy <= 2; dy++) {
    if (canStandAt(world, x, baseY + dy, z, opts)) return { x, y: baseY + dy, z };
  }
  // Airborne/in water: use the current cell as a temporary start when it is
  // at least not inside a solid block.
  if (!isCollidable(world, x, baseY, z) && !isCollidable(world, x, baseY + 1, z)) {
    return { x, y: baseY, z };
  }
  return null;
}

/** Resolve the goal cell: the target cell or the closest standable neighbour. */
function resolveGoalNode(
  world: WorldView,
  target: Vec3,
  opts: ResolvedOptions,
): { x: number; y: number; z: number } | null {
  const x = Math.floor(target.x);
  const z = Math.floor(target.z);
  const baseY = Math.floor(target.y + 0.01);
  if (!canStandAt(world, x, baseY, z, opts)) {
    // Search a small neighbourhood for the closest standable goal cell.
    const searchRadius = Math.max(1, opts.goalRadius);
    const candidates: Array<{ x: number; y: number; z: number; d: number }> = [];
    for (let dy = -2; dy <= 2; dy++) {
      for (let dz = -searchRadius; dz <= searchRadius; dz++) {
        for (let dx = -searchRadius; dx <= searchRadius; dx++) {
          const cx = x + dx;
          const cy = baseY + dy;
          const cz = z + dz;
          if (!canStandAt(world, cx, cy, cz, opts)) continue;
          candidates.push({
            x: cx,
            y: cy,
            z: cz,
            d: Math.abs(dx) + Math.abs(dz) + Math.abs(dy) * 0.5,
          });
        }
      }
    }
    if (candidates.length === 0) return null;
    candidates.sort((a, b) => a.d - b.d || a.y - b.y || a.x - b.x || a.z - b.z);
    const best = candidates[0];
    return { x: best.x, y: best.y, z: best.z };
  }
  return { x, y: baseY, z };
}

function waypointsFromPath(path: PathNode[], goalX: number, goalZ: number): Vec3[] {
  const points: PathNode[] = [];
  for (const node of path) {
    // Merge collinear runs so mob movement is smooth.
    const n = points.length;
    if (n >= 2) {
      const a = points[n - 2];
      const b = points[n - 1];
      const abx = b.x - a.x;
      const aby = b.y - a.y;
      const abz = b.z - a.z;
      const bcx = node.x - b.x;
      const bcy = node.y - b.y;
      const bcz = node.z - b.z;
      const cross = abx * bcz - abz * bcx;
      const sameDirection = cross === 0 && Math.abs(abx - bcx) <= 1 && Math.abs(abz - bcz) <= 1;
      const sameHeight = aby === 0 && bcy === 0 && abx === bcx && abz === bcz;
      if ((sameDirection || sameHeight) && cross === 0 && sameHeight) points.pop();
    }
    points.push(node);
  }
  const waypoints: Vec3[] = [];
  for (let i = 1; i < points.length; i++) {
    const node = points[i];
    const last = i === points.length - 1;
    waypoints.push({
      x: last ? node.x + 0.5 + (goalX - node.x) * 0.001 : node.x + 0.5,
      y: node.y,
      z: last ? node.z + 0.5 + (goalZ - node.z) * 0.001 : node.z + 0.5,
    });
  }
  return waypoints;
}

/**
 * Find a path from `start` (feet position) to `target` (feet position).
 * Deterministic: fixed neighbour order, insertion-order tie breaking.
 */
export function findPath(
  world: WorldView,
  start: Vec3,
  target: Vec3,
  options?: PathOptions,
): PathResult {
  const opts = resolveOptions(options);
  const startNode = resolveStartNode(world, start, opts);
  if (!startNode) {
    return { found: false, nodes: [], waypoints: [], expanded: 0, cost: 0, reason: 'invalid-start' };
  }
  const goalNode = resolveGoalNode(world, target, opts);
  if (!goalNode) {
    return { found: false, nodes: [], waypoints: [], expanded: 0, cost: 0, reason: 'invalid-goal' };
  }

  const startTime = now();
  const open = new NodeHeap();
  const openBest = new Map<string, PathNode>();
  const closed = new Set<string>();
  let order = 0;
  const startH = heuristic(startNode.x, startNode.y, startNode.z, goalNode);
  const startPathNode: PathNode = {
    x: startNode.x,
    y: startNode.y,
    z: startNode.z,
    g: 0,
    h: startH,
    f: startH,
    parent: null,
    order: order++,
  };
  open.push(startPathNode);
  openBest.set(nodeKey(startNode.x, startNode.y, startNode.z), startPathNode);

  const isGoal = (x: number, y: number, z: number): boolean => {
    const dx = Math.abs(x - goalNode.x);
    const dz = Math.abs(z - goalNode.z);
    const dy = Math.abs(y - goalNode.y);
    return dx === 0 && dz === 0 && dy === 0;
  };

  const reachedGoal = (x: number, y: number, z: number): boolean => {
    if (isGoal(x, y, z)) return true;
    const dx = Math.abs(x - goalNode.x);
    const dz = Math.abs(z - goalNode.z);
    return dx <= opts.goalRadius && dz <= opts.goalRadius && Math.abs(y - goalNode.y) <= 1;
  };

  let expanded = 0;
  let reason: PathResult['reason'] = 'no-path';
  let goalReached: PathNode | null = null;

  while (open.size > 0) {
    if (expanded >= opts.maxNodes) {
      reason = 'node-limit';
      break;
    }
    if (expanded > 0 && expanded % 16 === 0 && now() - startTime > opts.timeBudgetMs) {
      reason = 'timeout';
      break;
    }
    const current = open.pop();
    if (!current) break;
    const currentKey = nodeKey(current.x, current.y, current.z);
    if (closed.has(currentKey)) continue;
    closed.add(currentKey);
    expanded++;
    if (reachedGoal(current.x, current.y, current.z)) {
      goalReached = current;
      reason = 'ok';
      break;
    }

    const neighbours = generateNeighbours(world, current, opts);
    for (const n of neighbours) {
      const key = nodeKey(n.x, n.y, n.z);
      if (closed.has(key)) continue;
      const g = current.g + n.cost;
      const h = heuristic(n.x, n.y, n.z, goalNode);
      const f = g + h;
      const existing = openBest.get(key);
      if (existing && existing.f <= f) continue;
      const pathNode: PathNode = {
        x: n.x,
        y: n.y,
        z: n.z,
        g,
        h,
        f,
        parent: current,
        order: order++,
      };
      openBest.set(key, pathNode);
      open.push(pathNode);
    }
  }

  if (!goalReached) {
    return { found: false, nodes: [], waypoints: [], expanded, cost: 0, reason };
  }

  const path: PathNode[] = [];
  let node: PathNode | null = goalReached;
  while (node) {
    path.push(node);
    node = node.parent;
  }
  path.reverse();
  return {
    found: true,
    nodes: path,
    waypoints: waypointsFromPath(path, goalNode.x, goalNode.z),
    expanded,
    cost: goalReached.g,
    reason: 'ok',
  };
}

interface Neighbour {
  x: number;
  y: number;
  z: number;
  cost: number;
}

function generateNeighbours(
  world: WorldView,
  node: PathNode,
  opts: ResolvedOptions,
): Neighbour[] {
  const out: Neighbour[] = [];
  const dirs: ReadonlyArray<readonly [number, number]> = [
    [1, 0],
    [-1, 0],
    [0, 1],
    [0, -1],
  ];

  const headroomClear = (x: number, y: number, z: number): boolean => {
    // Space needed above the current feet while the mob rises one block.
    for (let dy = 0; dy < opts.bodyHeight + 1; dy++) {
      if (isCollidable(world, x, y + dy, z)) return false;
      if (opts.avoidLiquids && isLiquid(world, x, y + dy, z)) return false;
    }
    return true;
  };

  for (const [dx, dz] of dirs) {
    const nx = node.x + dx;
    const nz = node.z + dz;
    // Walk on the same level.
    if (canStandAt(world, nx, node.y, nz, opts)) {
      out.push({ x: nx, y: node.y, z: nz, cost: 1 });
    }
    // Jump one block up onto a ledge.
    if (opts.jumpHeight >= 1 && canStandAt(world, nx, node.y + 1, nz, opts)) {
      if (headroomClear(node.x, node.y, node.z)) {
        out.push({ x: nx, y: node.y + 1, z: nz, cost: 1.6 });
      }
    }
    // Drop down up to maxDrop blocks.
    for (let drop = 1; drop <= opts.maxDrop; drop++) {
      const dropY = node.y - drop;
      if (!canStandAt(world, nx, dropY, nz, opts)) continue;
      if (!canFallThrough(world, nx, nz, node.y, dropY, opts)) continue;
      out.push({ x: nx, y: dropY, z: nz, cost: 1 + drop * 0.2 });
      break;
    }
  }
  return out;
}

/** Monotonic-ish clock; falls back to Date.now when performance is missing. */
function now(): number {
  return typeof performance !== 'undefined' && typeof performance.now === 'function'
    ? performance.now()
    : Date.now();
}

/** Total length of a waypoint path (useful for tests and AI heuristics). */
export function pathLength(start: Vec3, waypoints: readonly Vec3[]): number {
  let total = 0;
  let px = start.x;
  let py = start.y;
  let pz = start.z;
  for (const point of waypoints) {
    total += Math.hypot(point.x - px, point.y - py, point.z - pz);
    px = point.x;
    py = point.y;
    pz = point.z;
  }
  return total;
}
