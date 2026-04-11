/**
 * Tiny geometry helpers shared across the engine and autonomy layers.
 *
 * Kept separate from `collision.ts` because these are pure distance/coord
 * utilities with no knowledge of the world grid, walls, or player radius.
 */
import type { Position } from "./types.js";

/** L1 (taxicab) distance — preferred for 4-directional tile movement. */
export function manhattanDistance(left: Position, right: Position): number {
  return Math.abs(left.x - right.x) + Math.abs(left.y - right.y);
}
