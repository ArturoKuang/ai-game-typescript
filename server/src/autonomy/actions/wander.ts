/**
 * Wander action — pick a nearby random walkable tile and stroll there.
 *
 * This replaces the manager's old direct idle `move_to` fallback so even
 * low-priority roaming goes through the GOAP executor and shows up in debug.
 */
import type {
  ActionDefinition,
  ActionTickResult,
  ExecutionContext,
} from "../types.js";

const WANDER_RANGE = 5;
const WANDER_TARGET_ATTEMPTS = 5;
const WANDER_TIMEOUT = 500;

function pickWanderTarget(
  ctx: ExecutionContext,
): { x: number; y: number } | null {
  const player = ctx.game.getPlayer(ctx.npcId);
  if (!player) {
    return null;
  }

  const cx = Math.round(player.x);
  const cy = Math.round(player.y);
  for (let attempt = 0; attempt < WANDER_TARGET_ATTEMPTS; attempt++) {
    const dx = ctx.game.rng.nextInt(WANDER_RANGE * 2 + 1) - WANDER_RANGE;
    const dy = ctx.game.rng.nextInt(WANDER_RANGE * 2 + 1) - WANDER_RANGE;
    const tx = cx + dx;
    const ty = cy + dy;
    if ((tx !== cx || ty !== cy) && ctx.game.world.isWalkable(tx, ty)) {
      return { x: tx, y: ty };
    }
  }

  return null;
}

export const wanderAction: ActionDefinition = {
  id: "wander",
  displayName: "Wander",

  preconditions: new Map(),
  effects: new Map([["has_wandered_recently", true]]),
  cost: 1,
  estimatedDurationTicks: 80,

  validate(ctx: ExecutionContext): string | null {
    const player = ctx.game.getPlayer(ctx.npcId);
    if (!player) return "Player not found";

    const target = pickWanderTarget(ctx);
    if (!target) return "No walkable wander target";
    ctx.actionState.set("targetPosition", target);
    return null;
  },

  onStart(ctx: ExecutionContext): void {
    const target = ctx.actionState.get("targetPosition") as
      | { x: number; y: number }
      | undefined;
    if (!target) return;

    ctx.game.enqueue({
      type: "move_to",
      playerId: ctx.npcId,
      data: target,
    });
    ctx.actionState.set("moveStarted", false);
    ctx.actionState.set("startTick", ctx.currentTick);
  },

  onTick(ctx: ExecutionContext): ActionTickResult {
    const player = ctx.game.getPlayer(ctx.npcId);
    const target = ctx.actionState.get("targetPosition") as
      | { x: number; y: number }
      | undefined;
    if (!player || !target) {
      return { status: "failed", reason: "Player or wander target missing" };
    }

    const dx = Math.abs(player.x - target.x);
    const dy = Math.abs(player.y - target.y);
    if (dx + dy <= 1.5) {
      return { status: "completed" };
    }

    if (player.state === "walking") {
      ctx.actionState.set("moveStarted", true);
      return { status: "running" };
    }

    const startTick =
      (ctx.actionState.get("startTick") as number) ?? ctx.currentTick;
    const elapsed = ctx.currentTick - startTick;
    if (!ctx.actionState.get("moveStarted")) {
      if (elapsed >= 1) {
        return { status: "failed", reason: "Wander move did not start" };
      }
      return { status: "running" };
    }

    if (player.state === "idle") {
      if (dx + dy <= 2.0) {
        return { status: "completed" };
      }
      return { status: "failed", reason: "Wander path ended early" };
    }

    if (elapsed > WANDER_TIMEOUT) {
      return { status: "failed", reason: "Wander timed out" };
    }

    return { status: "running" };
  },

  onEnd(_ctx: ExecutionContext, _reason): void {},
};
