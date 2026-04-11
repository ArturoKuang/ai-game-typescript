/**
 * Consume bear meat via the combat/inventory command path.
 *
 * BearManager handles the actual item removal, heal, and emitted events; the
 * autonomy manager mirrors those events back into NPC inventory + food state.
 */
import { getItemCount } from "../inventory.js";
import type {
  ActionDefinition,
  ActionTickResult,
  ExecutionContext,
} from "../types.js";

const EAT_BEAR_MEAT_TIMEOUT = 30;

export const eatBearMeatAction: ActionDefinition = {
  id: "eat_bear_meat",
  displayName: "Eat bear meat",

  preconditions: new Map([["has_bear_meat", true]]),
  effects: new Map([["need_food_satisfied", true]]),
  cost: 1,
  estimatedDurationTicks: EAT_BEAR_MEAT_TIMEOUT,

  validate(ctx: ExecutionContext): string | null {
    if (getItemCount(ctx.inventory, "bear_meat") <= 0) {
      return "No bear meat";
    }
    ctx.actionState.set(
      "startingCount",
      getItemCount(ctx.inventory, "bear_meat"),
    );
    ctx.actionState.set("startingFood", ctx.needs.food);
    return null;
  },

  onStart(ctx: ExecutionContext): void {
    ctx.actionState.set("startedAtTick", ctx.currentTick);
    ctx.game.enqueue({
      type: "eat",
      playerId: ctx.npcId,
      data: { item: "bear_meat" },
    });
  },

  onTick(ctx: ExecutionContext): ActionTickResult {
    const startingCount = (ctx.actionState.get("startingCount") as number) ?? 0;
    const startingFood =
      (ctx.actionState.get("startingFood") as number) ?? ctx.needs.food;

    if (
      getItemCount(ctx.inventory, "bear_meat") < startingCount ||
      ctx.needs.food > startingFood
    ) {
      return { status: "completed" };
    }

    const startedAtTick =
      (ctx.actionState.get("startedAtTick") as number) ?? ctx.currentTick;
    if (ctx.currentTick - startedAtTick > EAT_BEAR_MEAT_TIMEOUT) {
      return { status: "failed", reason: "Timed out eating bear meat" };
    }

    return { status: "running" };
  },

  onEnd(_ctx: ExecutionContext, _reason): void {},

  describeOutcomeForMemory(_ctx, outcome, reason) {
    if (outcome === "completed") {
      return {
        content: "I ate bear meat and felt less hungry.",
        importance: 5,
      };
    }
    if (outcome === "failed") {
      return {
        content: `I tried to eat bear meat but failed: ${reason ?? "something interrupted me"}.`,
        importance: 5,
      };
    }
    return null;
  },
};
