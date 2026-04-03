/**
 * Client-side movement prediction — mirrors the server's collision logic.
 *
 * The client runs the same physics each frame so the local player moves
 * instantly without waiting for a server round-trip. The server is
 * authoritative; the client's main.ts reconciles any drift.
 *
 * ## Coordinate system
 * Same as the server: tile (2, 3) has its center at (2, 3). Internally
 * the collision helpers shift by +0.5 to work on unit-grid tiles, then
 * shift back (see {@link clientMoveWithCollision}).
 *
 * ## Collision resolution
 * 1. Tile collision: X resolved first (shallow-axis preference), then Y.
 * 2. Player collision: try full move, then each axis independently.
 *    If both axes are blocked, stay in place.
 */
import type { MoveDirection, Orientation, TileType } from "./types.js";

/** Must match server's `inputSpeed` default (tiles per second). */
export const MOVE_SPEED = 5.0;
/** Must match server's `PLAYER_RADIUS` (AABB half-extent). */
export const PLAYER_RADIUS = 0.4;

/** Small offset to avoid float rounding causing false overlaps with tile edges. */
const COLLISION_EPSILON = 1e-6;
/** Small tolerance when checking player-to-player circle overlap. */
const PLAYER_COLLISION_EPSILON = 1e-6;

export interface PredictionPlayer {
  id: string;
  x: number;
  y: number;
  orientation: Orientation;
  radius: number;
  inputSpeed: number;
}

export interface PredictionOccupant {
  id: string;
  x: number;
  y: number;
  radius: number;
}

export interface PredictedMovement {
  x: number;
  y: number;
  orientation: Orientation;
  vx: number;
  vy: number;
  inputX: number;
  inputY: number;
  moved: boolean;
}

/** Sum held direction keys into a raw input vector (values -1, 0, or 1). */
export function getHeldDirectionVector(
  heldDirections: Iterable<MoveDirection>,
): { ix: number; iy: number } {
  let ix = 0;
  let iy = 0;
  for (const direction of heldDirections) {
    if (direction === "left") ix -= 1;
    if (direction === "right") ix += 1;
    if (direction === "up") iy -= 1;
    if (direction === "down") iy += 1;
  }
  return { ix, iy };
}

/**
 * Predict one frame of local player movement.
 *
 * Mirrors the server's `processInputMovement` pipeline:
 * 1. Normalize diagonal input so speed is consistent.
 * 2. Apply tile collision via AABB resolution.
 * 3. Apply player-to-player collision.
 * 4. Derive orientation from the dominant input axis.
 */
export function predictLocalPlayerStep(options: {
  player: PredictionPlayer;
  otherPlayers: PredictionOccupant[];
  heldDirections: Iterable<MoveDirection>;
  mapTiles: TileType[][] | null;
  dt: number;
}): PredictedMovement {
  const { player, otherPlayers, heldDirections, mapTiles, dt } = options;
  const { ix, iy } = getHeldDirectionVector(heldDirections);

  if (ix === 0 && iy === 0) {
    return {
      x: player.x,
      y: player.y,
      orientation: player.orientation,
      vx: 0,
      vy: 0,
      inputX: 0,
      inputY: 0,
      moved: false,
    };
  }

  const mag = Math.sqrt(ix * ix + iy * iy);
  const nix = ix / mag;
  const niy = iy / mag;
  const dx = nix * player.inputSpeed * dt;
  const dy = niy * player.inputSpeed * dt;

  const moved = clientMoveWithCollision(
    player.x,
    player.y,
    dx,
    dy,
    player.radius,
    mapTiles,
  );
  const resolved = resolveClientPlayerCollision(
    player.id,
    player.x,
    player.y,
    moved.x,
    moved.y,
    player.radius,
    otherPlayers,
  );

  return {
    x: resolved.x,
    y: resolved.y,
    orientation: getOrientationForInput(ix, iy, player.orientation),
    vx: nix * player.inputSpeed,
    vy: niy * player.inputSpeed,
    inputX: ix,
    inputY: iy,
    moved: true,
  };
}

function getOrientationForInput(
  inputX: number,
  inputY: number,
  fallback: Orientation,
): Orientation {
  if (Math.abs(inputX) > Math.abs(inputY)) {
    return inputX > 0 ? "right" : "left";
  }
  if (inputY !== 0) {
    return inputY > 0 ? "down" : "up";
  }
  return fallback;
}

function isTileBlocked(
  tx: number,
  ty: number,
  mapTiles: TileType[][] | null,
): boolean {
  if (!mapTiles) return false;
  if (
    ty < 0 ||
    ty >= mapTiles.length ||
    tx < 0 ||
    tx >= (mapTiles[0]?.length ?? 0)
  ) {
    return true;
  }
  return mapTiles[ty][tx] !== "floor";
}

/**
 * Apply movement with tile collision on the client.
 *
 * Shifts into unit-grid space (+0.5), resolves X then Y, and shifts back.
 * This matches the server's `moveWithCollision` in collision.ts.
 */
function clientMoveWithCollision(
  x: number,
  y: number,
  dx: number,
  dy: number,
  radius: number,
  mapTiles: TileType[][] | null,
): { x: number; y: number } {
  const shiftedX = x + 0.5;
  const shiftedY = y + 0.5;
  let nx = shiftedX + dx;
  nx = clientResolveX(nx, shiftedY, dx, radius, mapTiles);
  let ny = shiftedY + dy;
  ny = clientResolveY(nx, ny, dy, radius, mapTiles);
  return { x: nx - 0.5, y: ny - 0.5 };
}

/**
 * Push player out of blocked tiles along X (shallow-axis-first strategy).
 * Only resolves tiles where X penetration < Y penetration; corners
 * where Y is shallower are left for the Y pass.
 */
function clientResolveX(
  cx: number,
  cy: number,
  dx: number,
  radius: number,
  mapTiles: TileType[][] | null,
): number {
  const minTY = Math.floor(cy - radius + COLLISION_EPSILON);
  const maxTY = Math.floor(cy + radius - COLLISION_EPSILON);
  const minTX = Math.floor(cx - radius + COLLISION_EPSILON);
  const maxTX = Math.floor(cx + radius - COLLISION_EPSILON);

  for (let ty = minTY; ty <= maxTY; ty++) {
    for (let tx = minTX; tx <= maxTX; tx++) {
      if (!isTileBlocked(tx, ty, mapTiles)) continue;

      const overlapX = Math.min(cx + radius - tx, tx + 1 - (cx - radius));
      const overlapY = Math.min(cy + radius - ty, ty + 1 - (cy - radius));

      if (overlapX <= 0 || overlapY <= 0) continue;
      if (overlapX >= overlapY) continue;

      if (dx > 0) {
        cx = Math.min(cx, tx - radius);
      } else if (dx < 0) {
        cx = Math.max(cx, tx + 1 + radius);
      } else {
        const penRight = cx + radius - tx;
        const penLeft = tx + 1 - (cx - radius);
        cx = penRight <= penLeft ? tx - radius : tx + 1 + radius;
      }
    }
  }

  return cx;
}

/** Push player out of blocked tiles along Y (catch-all after X pass). */
function clientResolveY(
  cx: number,
  cy: number,
  dy: number,
  radius: number,
  mapTiles: TileType[][] | null,
): number {
  const minTX = Math.floor(cx - radius + COLLISION_EPSILON);
  const maxTX = Math.floor(cx + radius - COLLISION_EPSILON);
  const minTY = Math.floor(cy - radius + COLLISION_EPSILON);
  const maxTY = Math.floor(cy + radius - COLLISION_EPSILON);

  for (let ty = minTY; ty <= maxTY; ty++) {
    for (let tx = minTX; tx <= maxTX; tx++) {
      if (!isTileBlocked(tx, ty, mapTiles)) continue;

      const overlapX = Math.min(cx + radius - tx, tx + 1 - (cx - radius));
      const overlapY = Math.min(cy + radius - ty, ty + 1 - (cy - radius));

      if (overlapX <= 0 || overlapY <= 0) continue;

      if (dy > 0) {
        cy = Math.min(cy, ty - radius);
      } else if (dy < 0) {
        cy = Math.max(cy, ty + 1 + radius);
      } else {
        const penDown = cy + radius - ty;
        const penUp = ty + 1 - (cy - radius);
        cy = penDown <= penUp ? ty - radius : ty + 1 + radius;
      }
    }
  }

  return cy;
}

/** Find the first other player whose circle overlaps (nextX, nextY). */
function findBlockingPlayer(
  selfPlayerId: string,
  nextX: number,
  nextY: number,
  radius: number,
  otherPlayers: PredictionOccupant[],
): PredictionOccupant | undefined {
  for (const other of otherPlayers) {
    if (other.id === selfPlayerId) continue;
    const minDistance = radius + other.radius - PLAYER_COLLISION_EPSILON;
    const dx = nextX - other.x;
    const dy = nextY - other.y;
    if (dx * dx + dy * dy < minDistance * minDistance) {
      return other;
    }
  }
  return undefined;
}

/**
 * Resolve player-to-player collision by trying axis-separated fallbacks.
 *
 * Strategy: if the combined move is blocked, try X-only and Y-only.
 * If both are clear, pick the axis with more progress (lets the player
 * "slide" along the blocker). If only one is clear, use it. If both
 * blocked, stay in place.
 */
function resolveClientPlayerCollision(
  selfPlayerId: string,
  x: number,
  y: number,
  nextX: number,
  nextY: number,
  radius: number,
  otherPlayers: PredictionOccupant[],
): { x: number; y: number } {
  const blocker = findBlockingPlayer(
    selfPlayerId,
    nextX,
    nextY,
    radius,
    otherPlayers,
  );
  if (!blocker) return { x: nextX, y: nextY };

  const xOnlyBlocker = findBlockingPlayer(
    selfPlayerId,
    nextX,
    y,
    radius,
    otherPlayers,
  );
  const yOnlyBlocker = findBlockingPlayer(
    selfPlayerId,
    x,
    nextY,
    radius,
    otherPlayers,
  );

  if (!xOnlyBlocker && !yOnlyBlocker) {
    const xProgress = Math.abs(nextX - x);
    const yProgress = Math.abs(nextY - y);
    return xProgress >= yProgress ? { x: nextX, y } : { x, y: nextY };
  }

  if (!xOnlyBlocker) return { x: nextX, y };
  if (!yOnlyBlocker) return { x, y: nextY };
  return { x, y };
}
