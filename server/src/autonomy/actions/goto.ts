/**
 * Built-in movement action — walks the NPC to a target position using A* pathfinding.
 */
import type { ActionDefinition, ActionTickResult, ExecutionContext } from "../types.js";

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
    const path = ctx.game.setPlayerTarget(
      ctx.npcId,
      ctx.targetPosition.x,
      ctx.targetPosition.y,
    );
    ctx.actionState.set("pathSet", path !== null);
    if (!path) {
      ctx.actionState.set("failed", true);
    }
  },

  onTick(ctx: ExecutionContext): ActionTickResult {
    if (ctx.actionState.get("failed")) {
      return { status: "failed", reason: "No path to target" };
    }

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

    // Check if player stopped moving (arrived or blocked)
    if (player.state === "idle") {
      // May have arrived close enough or path was completed
      if (dx + dy <= 2.0) {
        return { status: "completed" };
      }
      return { status: "failed", reason: "Path ended but not at target" };
    }

    // Timeout: 500 ticks max for any movement
    const elapsed = ctx.currentTick - (ctx.actionState.get("startTick") as number ?? ctx.currentTick);
    if (elapsed > 500) {
      return { status: "failed", reason: "Movement timed out" };
    }

    if (!ctx.actionState.has("startTick")) {
      ctx.actionState.set("startTick", ctx.currentTick);
    }

    return { status: "running" };
  },

  onEnd(_ctx: ExecutionContext, _reason): void {
    // No cleanup needed
  },
};
