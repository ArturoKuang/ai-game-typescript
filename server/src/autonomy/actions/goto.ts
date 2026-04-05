/**
 * Built-in movement action — walks the NPC to a target position using A* pathfinding.
 */
import type {
  ActionDefinition,
  ActionTickResult,
  ExecutionContext,
} from "../types.js";

export const GOTO_ACTION_ID = "__goto";

export const gotoAction: ActionDefinition = {
  id: GOTO_ACTION_ID,
  displayName: "Walk to",

  preconditions: new Map(),
  effects: new Map(), // Effects set dynamically by planner
  cost: 1,
  estimatedDurationTicks: 40,

  validate(ctx: ExecutionContext): string | null {
    if (!ctx.targetPosition) return "No target position";
    return null;
  },

  onStart(ctx: ExecutionContext): void {
    if (!ctx.targetPosition) return;
    ctx.game.enqueue({
      type: "move_to",
      playerId: ctx.npcId,
      data: { x: ctx.targetPosition.x, y: ctx.targetPosition.y },
    });
    ctx.actionState.set("moveQueued", true);
    ctx.actionState.set("moveStarted", false);
    ctx.actionState.set("startTick", ctx.currentTick);
  },

  onTick(ctx: ExecutionContext): ActionTickResult {
    const player = ctx.game.getPlayer(ctx.npcId);
    if (!player || !ctx.targetPosition) {
      return { status: "failed", reason: "Player or target missing" };
    }

    const dx = Math.abs(player.x - ctx.targetPosition.x);
    const dy = Math.abs(player.y - ctx.targetPosition.y);

    // Close enough — within 1.5 tiles Manhattan
    if (dx + dy <= 1.5) {
      return { status: "completed" };
    }

    if (player.state === "walking") {
      ctx.actionState.set("moveStarted", true);
      return { status: "running" };
    }

    const startTick = (ctx.actionState.get("startTick") as number) ?? ctx.currentTick;
    const elapsed = ctx.currentTick - startTick;
    if (!ctx.actionState.get("moveStarted")) {
      if (elapsed >= 1) {
        return { status: "failed", reason: "Move command did not start" };
      }
      return { status: "running" };
    }

    // Check if player stopped moving (arrived or blocked)
    if (player.state === "idle") {
      // May have arrived close enough or path was completed
      if (dx + dy <= 2.0) {
        return { status: "completed" };
      }
      return { status: "failed", reason: "Path ended but not at target" };
    }

    // Timeout: 500 ticks max for any movement
    if (elapsed > 500) {
      return { status: "failed", reason: "Movement timed out" };
    }

    return { status: "running" };
  },

  onEnd(_ctx: ExecutionContext, _reason): void {
    // No cleanup needed
  },
};
