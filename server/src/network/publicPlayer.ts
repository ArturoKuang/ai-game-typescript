import type { Orientation, Player, PlayerState } from "../engine/types.js";

/**
 * Stable player snapshot exposed to clients and debug consumers.
 *
 * This deliberately excludes engine-only fields such as pathfinding internals,
 * input vectors, activity bookkeeping, and NPC prompt context.
 */
export interface PublicPlayer {
  id: string;
  name: string;
  description: string;
  isNpc: boolean;
  isWaitingForResponse?: boolean;
  x: number;
  y: number;
  targetX?: number;
  targetY?: number;
  orientation: Orientation;
  pathSpeed: number;
  state: PlayerState;
  currentConvoId?: number;
  vx: number;
  vy: number;
  inputSpeed: number;
  radius: number;
  hp?: number;
  maxHp?: number;
}

export function toPublicPlayer(player: Player): PublicPlayer {
  return {
    id: player.id,
    name: player.name,
    description: player.description,
    isNpc: player.isNpc,
    isWaitingForResponse: player.isWaitingForResponse,
    x: player.x,
    y: player.y,
    targetX: player.targetX,
    targetY: player.targetY,
    orientation: player.orientation,
    pathSpeed: player.pathSpeed,
    state: player.state,
    currentConvoId: player.currentConvoId,
    vx: player.vx,
    vy: player.vy,
    inputSpeed: player.inputSpeed,
    radius: player.radius,
    hp: player.hp,
    maxHp: player.maxHp,
  };
}

export function createJoinPreviewPlayer(input: {
  id: string;
  name: string;
  description: string;
  x: number;
  y: number;
}): PublicPlayer {
  return {
    id: input.id,
    name: input.name,
    description: input.description,
    isNpc: false,
    isWaitingForResponse: false,
    x: input.x,
    y: input.y,
    orientation: "down",
    pathSpeed: 1.0,
    state: "idle",
    vx: 0,
    vy: 0,
    radius: 0.4,
    inputSpeed: 5.0,
  };
}
