/**
 * AABB tile collision for continuous player movement.
 *
 * ## Coordinate system
 * Runtime player coordinates are **centered on integer tiles**: tile (2, 3) has
 * its center at world-space (2, 3) and its bounds span [1.5, 2.5] x [2.5, 3.5].
 *
 * Internally, the collision helpers work on a **unit grid** where tile (tx, ty)
 * spans [tx, tx+1] x [ty, ty+1]. The public functions translate by +0.5 before
 * resolving and -0.5 afterward so callers always use centered coordinates.
 *
 * ## Resolution strategy
 * 1. Movement is subdivided into steps no larger than `radius` to prevent
 *    tunneling through thin walls at high speed.
 * 2. Each step resolves X first, then Y (axis-separated).
 * 3. The X pass only resolves tiles where X penetration is strictly shallower
 *    than Y penetration. This prevents the player from getting "stuck" at
 *    diagonal corners—corner-touching overlaps are left for the Y (catch-all) pass.
 *
 * @see docs/server-engine.md – "Collision" section
 */
import type { Position } from "./types.js";
import type { World } from "./world.js";

/** Default collision half-extent for all players. */
export const PLAYER_RADIUS = 0.4;

/** Tiny offset to avoid false boundary overlaps from float rounding. */
const EPSILON = 1e-6;

/**
 * Move a player by (dx, dy) with AABB tile collision.
 *
 * Runtime player coordinates are centered on integer tile coordinates:
 * tile (2, 3) has its center at (2, 3) and its bounds span
 * [1.5, 2.5] x [2.5, 3.5].
 *
 * The internal collision helper operates on unit tiles with bounds
 * [tx, tx + 1] x [ty, ty + 1], so we translate coordinates by +0.5
 * before resolving and then translate back.
 */
export function moveWithCollision(
  x: number,
  y: number,
  dx: number,
  dy: number,
  radius: number,
  world: World,
): { x: number; y: number } {
  const shifted = moveWithCollisionOnUnitGrid(
    x + 0.5,
    y + 0.5,
    dx,
    dy,
    radius,
    world,
  );
  return { x: shifted.x - 0.5, y: shifted.y - 0.5 };
}

/** Returns the first blocked tile that overlaps the player's AABB, or null. */
export function findBlockedTileOverlap(
  x: number,
  y: number,
  radius: number,
  world: World,
): Position | null {
  return findBlockedTileOverlapOnUnitGrid(x + 0.5, y + 0.5, radius, world);
}

/** Core collision loop operating on unit-grid coordinates (tile [tx, tx+1]). */
function moveWithCollisionOnUnitGrid(
  x: number,
  y: number,
  dx: number,
  dy: number,
  radius: number,
  world: World,
): { x: number; y: number } {
  // Subdivide into steps no larger than radius to prevent tunneling
  const dist = Math.sqrt(dx * dx + dy * dy);
  const maxStep = radius;
  const steps = dist > maxStep ? Math.ceil(dist / maxStep) : 1;
  const sdx = dx / steps;
  const sdy = dy / steps;

  let cx = x;
  let cy = y;
  for (let i = 0; i < steps; i++) {
    // Resolve X axis (using current Y, before Y movement)
    let nx = cx + sdx;
    nx = resolveX(nx, cy, sdx, radius, world);

    // Resolve Y axis (using resolved X)
    let ny = cy + sdy;
    ny = resolveY(nx, ny, sdy, radius, world);

    cx = nx;
    cy = ny;
  }

  return { x: cx, y: cy };
}

function findBlockedTileOverlapOnUnitGrid(
  cx: number,
  cy: number,
  radius: number,
  world: World,
): Position | null {
  const minTY = Math.floor(cy - radius + EPSILON);
  const maxTY = Math.floor(cy + radius - EPSILON);
  const minTX = Math.floor(cx - radius + EPSILON);
  const maxTX = Math.floor(cx + radius - EPSILON);

  for (let ty = minTY; ty <= maxTY; ty++) {
    for (let tx = minTX; tx <= maxTX; tx++) {
      if (world.isWalkable(tx, ty)) continue;

      const overlapX = Math.min(cx + radius - tx, tx + 1 - (cx - radius));
      const overlapY = Math.min(cy + radius - ty, ty + 1 - (cy - radius));

      if (overlapX > 0 && overlapY > 0) {
        return { x: tx, y: ty };
      }
    }
  }

  return null;
}

/**
 * Push player out of wall tiles along X axis.
 * Player hitbox is an AABB: [cx-r, cx+r] x [cy-r, cy+r].
 * Only resolves tiles where X penetration is strictly less than Y penetration
 * (i.e., X is the shallow axis). Tiles at diagonal corners where Y is shallower
 * are left for the Y pass.
 */
function resolveX(
  cx: number,
  cy: number,
  dx: number,
  radius: number,
  world: World,
): number {
  const minTY = Math.floor(cy - radius + EPSILON);
  const maxTY = Math.floor(cy + radius - EPSILON);
  const minTX = Math.floor(cx - radius + EPSILON);
  const maxTX = Math.floor(cx + radius - EPSILON);

  for (let ty = minTY; ty <= maxTY; ty++) {
    for (let tx = minTX; tx <= maxTX; tx++) {
      if (world.isWalkable(tx, ty)) continue;

      // Compute overlap depth on each axis
      const overlapX = Math.min(cx + radius - tx, tx + 1 - (cx - radius));
      const overlapY = Math.min(cy + radius - ty, ty + 1 - (cy - radius));

      if (overlapX <= 0 || overlapY <= 0) continue;

      // Only resolve in X if X is strictly the shallow axis.
      // Ties (corner-touching) go to the Y pass.
      if (overlapX >= overlapY) continue;

      // Push direction based on movement, fallback to minimum penetration
      if (dx > 0) {
        cx = Math.min(cx, tx - radius);
      } else if (dx < 0) {
        cx = Math.max(cx, tx + 1 + radius);
      } else {
        const penRight = cx + radius - tx;
        const penLeft = tx + 1 - (cx - radius);
        if (penRight <= penLeft) {
          cx = tx - radius;
        } else {
          cx = tx + 1 + radius;
        }
      }
    }
  }
  return cx;
}

/**
 * Push player out of wall tiles along Y axis.
 * Resolves all remaining overlaps (catch-all after X pass).
 */
function resolveY(
  cx: number,
  cy: number,
  dy: number,
  radius: number,
  world: World,
): number {
  const minTX = Math.floor(cx - radius + EPSILON);
  const maxTX = Math.floor(cx + radius - EPSILON);
  const minTY = Math.floor(cy - radius + EPSILON);
  const maxTY = Math.floor(cy + radius - EPSILON);

  for (let ty = minTY; ty <= maxTY; ty++) {
    for (let tx = minTX; tx <= maxTX; tx++) {
      if (world.isWalkable(tx, ty)) continue;

      const overlapX = Math.min(cx + radius - tx, tx + 1 - (cx - radius));
      const overlapY = Math.min(cy + radius - ty, ty + 1 - (cy - radius));

      if (overlapX <= 0 || overlapY <= 0) continue;

      // Push direction based on movement, fallback to minimum penetration
      if (dy > 0) {
        cy = Math.min(cy, ty - radius);
      } else if (dy < 0) {
        cy = Math.max(cy, ty + 1 + radius);
      } else {
        const penDown = cy + radius - ty;
        const penUp = ty + 1 - (cy - radius);
        if (penDown <= penUp) {
          cy = ty - radius;
        } else {
          cy = ty + 1 + radius;
        }
      }
    }
  }
  return cy;
}
