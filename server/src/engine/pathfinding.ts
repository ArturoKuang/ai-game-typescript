/**
 * A* pathfinding on a 4-directional tile grid.
 *
 * Uses a binary min-heap for O(log n) open-set extraction and integer
 * position keys to avoid string allocation. The heuristic is Manhattan
 * distance (admissible for 4-directional movement with unit cost).
 */
import type { Position } from "./types.js";
import type { World } from "./world.js";

/** Internal A* search node. Forms a linked list via `parent` for path reconstruction. */
interface Node {
  x: number;
  y: number;
  /** Cost from start node to this node (number of tiles traversed). */
  g: number;
  /** Heuristic estimate from this node to the goal (Manhattan distance). */
  h: number;
  /** Total estimated cost: g + h. The min-heap is ordered by this value. */
  f: number;
  /** Previous node in the shortest path; null for the start node. Followed to reconstruct the path. */
  parent: Node | null;
}

function manhattan(a: Position, b: Position): number {
  return Math.abs(a.x - b.x) + Math.abs(a.y - b.y);
}

/** Encode (x, y) as a single integer key to avoid string allocation. */
function posKey(x: number, y: number, height: number): number {
  return x * height + y;
}

/** Binary min-heap ordered by f-score. Used as the A* open set for O(log n) extraction of the lowest-cost node. */
class MinHeap {
  /** Backing array storing heap nodes in level-order (index 0 is the root/minimum). */
  private data: Node[] = [];

  get size(): number {
    return this.data.length;
  }

  push(node: Node): void {
    this.data.push(node);
    this.bubbleUp(this.data.length - 1);
  }

  pop(): Node | undefined {
    const { data } = this;
    if (data.length === 0) return undefined;
    const top = data[0];
    const last = data.pop()!;
    if (data.length > 0) {
      data[0] = last;
      this.siftDown(0);
    }
    return top;
  }

  private bubbleUp(i: number): void {
    const { data } = this;
    while (i > 0) {
      const parent = (i - 1) >> 1;
      if (data[i].f >= data[parent].f) break;
      [data[i], data[parent]] = [data[parent], data[i]];
      i = parent;
    }
  }

  private siftDown(i: number): void {
    const { data } = this;
    const n = data.length;
    while (true) {
      let smallest = i;
      const left = 2 * i + 1;
      const right = 2 * i + 2;
      if (left < n && data[left].f < data[smallest].f) smallest = left;
      if (right < n && data[right].f < data[smallest].f) smallest = right;
      if (smallest === i) break;
      [data[i], data[smallest]] = [data[smallest], data[i]];
      i = smallest;
    }
  }
}

/**
 * A* pathfinding on a tile grid. 4-directional movement only.
 * Returns array of positions from start to goal (inclusive), or null if unreachable.
 */
export function findPath(
  world: World,
  start: Position,
  goal: Position,
): Position[] | null {
  // Goal must be walkable
  if (!world.isWalkable(goal.x, goal.y)) return null;

  // Already there
  if (start.x === goal.x && start.y === goal.y) return [start];

  const height = world.height;
  // open  — min-heap ordered by f-score for O(log n) extraction.
  // closed — positions already expanded (skip if re-encountered).
  // bestG — lowest g-score seen per position; nodes re-added with a worse
  //         g are skipped, avoiding redundant expansion.
  const open = new MinHeap();
  const closed = new Set<number>();

  const startNode: Node = {
    x: start.x,
    y: start.y,
    g: 0,
    h: manhattan(start, goal),
    f: manhattan(start, goal),
    parent: null,
  };
  open.push(startNode);

  // Track best g-score per position for faster lookups
  const bestG = new Map<number, number>();
  bestG.set(posKey(start.x, start.y, height), 0);

  while (open.size > 0) {
    const current = open.pop()!;

    // Reached goal
    if (current.x === goal.x && current.y === goal.y) {
      return reconstructPath(current);
    }

    const key = posKey(current.x, current.y, height);
    if (closed.has(key)) continue;
    closed.add(key);

    for (const neighbor of world.getNeighbors({ x: current.x, y: current.y })) {
      const nKey = posKey(neighbor.x, neighbor.y, height);
      if (closed.has(nKey)) continue;

      const g = current.g + 1;
      const existing = bestG.get(nKey);

      if (existing !== undefined && g >= existing) continue;

      bestG.set(nKey, g);
      const h = manhattan(neighbor, goal);
      open.push({
        x: neighbor.x,
        y: neighbor.y,
        g,
        h,
        f: g + h,
        parent: current,
      });
    }
  }

  return null; // No path found
}

function reconstructPath(node: Node): Position[] {
  const path: Position[] = [];
  let current: Node | null = node;
  while (current) {
    path.push({ x: current.x, y: current.y });
    current = current.parent;
  }
  return path.reverse();
}
