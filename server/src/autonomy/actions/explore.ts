/**
 * Explore action — wander to a random walkable tile to satisfy curiosity.
 */
import { boostNeed } from "../needs.js";
import type { ActionDefinition, ActionTickResult, ExecutionContext } from "../types.js";

const EXPLORE_DURATION = 80; // 4 seconds at 20 ticks/sec
const CURIOSITY_RESTORE = 50;

export const exploreAction: ActionDefinition = {
  id: "explore",
  displayName: "Explore",

  preconditions: new Map(), // No preconditions
  effects: new Map([["need_curiosity_satisfied", true]]),
  cost: 3,
  estimatedDurationTicks: EXPLORE_DURATION,

  // No proximity requirement — target is chosen randomly

  validate(ctx: ExecutionContext): string | null {
    const player = ctx.game.getPlayer(ctx.npcId);
    if (!player) return "Player not found";
    return null;
  },

  onStart(ctx: ExecutionContext): void {
    ctx.actionState.set("ticksRemaining", EXPLORE_DURATION);
    ctx.actionState.set("moving", false);

    // Pick a random walkable target nearby
    // The executor already handles goto steps, so if there's a targetPosition
    // it was set by the planner. Otherwise just stand and observe.
    if (ctx.targetPosition) {
      ctx.game.setPlayerTarget(
        ctx.npcId,
        ctx.targetPosition.x,
        ctx.targetPosition.y,
      );
      ctx.actionState.set("moving", true);
    }
  },

  onTick(ctx: ExecutionContext): ActionTickResult {
    const remaining = (ctx.actionState.get("ticksRemaining") as number) - 1;
    ctx.actionState.set("ticksRemaining", remaining);

    if (remaining > 0) {
      return { status: "running" };
    }

    boostNeed(ctx.needs, "curiosity", CURIOSITY_RESTORE);
    return { status: "completed" };
  },

  onEnd(_ctx: ExecutionContext, _reason): void {
    // No cleanup
  },
};
