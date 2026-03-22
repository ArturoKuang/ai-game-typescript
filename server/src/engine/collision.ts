import type { World } from "./world.js";

export const PLAYER_RADIUS = 0.4;

/**
 * Move a circle (player) by (dx, dy) with wall sliding.
 * Resolves X axis first, then Y axis independently.
 * For each axis, checks circle-vs-AABB overlap against all non-walkable tiles
 * in the 3x3 neighborhood and pushes the circle out along the penetration normal.
 */
export function moveWithCollision(
  x: number,
  y: number,
  dx: number,
  dy: number,
  radius: number,
  world: World,
): { x: number; y: number } {
  // Resolve X axis
  let nx = x + dx;
  let ny = y;
  nx = resolveAxis(nx, ny, radius, world);

  // Resolve Y axis
  ny = y + dy;
  ny = resolveAxisY(nx, ny, radius, world);

  return { x: nx, y: ny };
}

/** Push circle out of walls on X axis */
function resolveAxis(
  cx: number,
  cy: number,
  radius: number,
  world: World,
): number {
  const minTX = Math.floor(cx - radius) - 1;
  const maxTX = Math.floor(cx + radius) + 1;
  const minTY = Math.floor(cy - radius) - 1;
  const maxTY = Math.floor(cy + radius) + 1;

  for (let ty = minTY; ty <= maxTY; ty++) {
    for (let tx = minTX; tx <= maxTX; tx++) {
      if (world.isWalkable(tx, ty)) continue;
      // Tile AABB: [tx, tx+1] x [ty, ty+1]
      // Only resolve X penetration
      const closestX = Math.max(tx, Math.min(cx, tx + 1));
      const closestY = Math.max(ty, Math.min(cy, ty + 1));
      const distX = cx - closestX;
      const distY = cy - closestY;
      const distSq = distX * distX + distY * distY;

      if (distSq < radius * radius && distSq > 0) {
        const dist = Math.sqrt(distSq);
        const overlap = radius - dist;
        // Push out along X component only
        cx += (distX / dist) * overlap;
      } else if (distSq === 0) {
        // Center is inside the tile — push out to nearest X edge
        const toLeft = cx - tx;
        const toRight = tx + 1 - cx;
        if (toLeft < toRight) {
          cx = tx - radius;
        } else {
          cx = tx + 1 + radius;
        }
      }
    }
  }
  return cx;
}

/** Push circle out of walls on Y axis */
function resolveAxisY(
  cx: number,
  cy: number,
  radius: number,
  world: World,
): number {
  const minTX = Math.floor(cx - radius) - 1;
  const maxTX = Math.floor(cx + radius) + 1;
  const minTY = Math.floor(cy - radius) - 1;
  const maxTY = Math.floor(cy + radius) + 1;

  for (let ty = minTY; ty <= maxTY; ty++) {
    for (let tx = minTX; tx <= maxTX; tx++) {
      if (world.isWalkable(tx, ty)) continue;
      const closestX = Math.max(tx, Math.min(cx, tx + 1));
      const closestY = Math.max(ty, Math.min(cy, ty + 1));
      const distX = cx - closestX;
      const distY = cy - closestY;
      const distSq = distX * distX + distY * distY;

      if (distSq < radius * radius && distSq > 0) {
        const dist = Math.sqrt(distSq);
        const overlap = radius - dist;
        // Push out along Y component only
        cy += (distY / dist) * overlap;
      } else if (distSq === 0) {
        const toTop = cy - ty;
        const toBottom = ty + 1 - cy;
        if (toTop < toBottom) {
          cy = ty - radius;
        } else {
          cy = ty + 1 + radius;
        }
      }
    }
  }
  return cy;
}
