import type { Position } from "./types.js";
import type { World } from "./world.js";

interface Node {
  x: number;
  y: number;
  g: number; // cost from start
  h: number; // heuristic to goal
  f: number; // g + h
  parent: Node | null;
}

function manhattan(a: Position, b: Position): number {
  return Math.abs(a.x - b.x) + Math.abs(a.y - b.y);
}

function posKey(x: number, y: number): string {
  return `${x},${y}`;
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

  const open: Node[] = [];
  const closed = new Set<string>();

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
  const bestG = new Map<string, number>();
  bestG.set(posKey(start.x, start.y), 0);

  while (open.length > 0) {
    // Find node with lowest f
    let bestIdx = 0;
    for (let i = 1; i < open.length; i++) {
      if (open[i].f < open[bestIdx].f) bestIdx = i;
    }
    const current = open[bestIdx];
    open.splice(bestIdx, 1);

    // Reached goal
    if (current.x === goal.x && current.y === goal.y) {
      return reconstructPath(current);
    }

    const key = posKey(current.x, current.y);
    closed.add(key);

    for (const neighbor of world.getNeighbors({ x: current.x, y: current.y })) {
      const nKey = posKey(neighbor.x, neighbor.y);
      if (closed.has(nKey)) continue;

      const g = current.g + 1;
      const existing = bestG.get(nKey);

      if (existing !== undefined && g >= existing) continue;

      bestG.set(nKey, g);
      const h = manhattan(neighbor, goal);
      const node: Node = {
        x: neighbor.x,
        y: neighbor.y,
        g,
        h,
        f: g + h,
        parent: current,
      };

      // Remove worse duplicate from open list
      if (existing !== undefined) {
        const idx = open.findIndex(
          (n) => n.x === neighbor.x && n.y === neighbor.y,
        );
        if (idx !== -1) open.splice(idx, 1);
      }

      open.push(node);
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
