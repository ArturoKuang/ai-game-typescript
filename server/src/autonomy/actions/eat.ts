/**
 * Eat actions — consume food to restore the food survival meter.
 *
 * Two variants:
 * - `eat` consumes raw_food, restores 40 food
 * - `eat_cooked` consumes cooked_food, restores 70 food (lower cost so planner prefers it)
 */
import { removeItem } from "../inventory.js";
import { boostNeed } from "../needs.js";
import type {
  ActionDefinition,
  ActionTickResult,
  ExecutionContext,
} from "../types.js";

const EAT_DURATION = 20; // 1 second at 20 ticks/sec
const RAW_FOOD_RESTORE = 40;
const COOKED_FOOD_RESTORE = 70;

/** Eat raw food — available whenever NPC has raw_food. */
export const eatAction: ActionDefinition = {
  id: "eat",
  displayName: "Eat raw food",

  preconditions: new Map([["has_raw_food", true]]),
  effects: new Map([["need_food_satisfied", true]]),
  cost: 2, // slightly higher than eat_cooked so planner prefers cooking
  estimatedDurationTicks: EAT_DURATION,

  validate(ctx: ExecutionContext): string | null {
    if ((ctx.inventory.get("raw_food") ?? 0) <= 0) return "No raw food";
    return null;
  },

  onStart(ctx: ExecutionContext): void {
    ctx.actionState.set("ticksRemaining", EAT_DURATION);
  },

  onTick(ctx: ExecutionContext): ActionTickResult {
    const remaining = (ctx.actionState.get("ticksRemaining") as number) - 1;
    ctx.actionState.set("ticksRemaining", remaining);
    if (remaining > 0) return { status: "running" };

    if (!removeItem(ctx.inventory, "raw_food")) {
      return { status: "failed", reason: "Raw food disappeared" };
    }
    boostNeed(ctx.needs, "food", RAW_FOOD_RESTORE);
    return { status: "completed" };
  },

  onEnd(_ctx: ExecutionContext, _reason): void {},

  describeOutcomeForMemory(_ctx, outcome, reason) {
    if (outcome === "completed") {
      return {
        content: "I ate raw food and felt less hungry.",
        importance: 4,
      };
    }
    if (outcome === "failed") {
      return {
        content: `I tried to eat raw food but failed: ${reason ?? "the food was gone"}.`,
        importance: 4,
      };
    }
    return null;
  },
};

/** Eat cooked food — preferred path, restores more hunger at lower cost. */
export const eatCookedAction: ActionDefinition = {
  id: "eat_cooked",
  displayName: "Eat cooked food",

  preconditions: new Map([["has_cooked_food", true]]),
  effects: new Map([["need_food_satisfied", true]]),
  cost: 1, // cheaper than raw — planner will prefer this path
  estimatedDurationTicks: EAT_DURATION,

  validate(ctx: ExecutionContext): string | null {
    if ((ctx.inventory.get("cooked_food") ?? 0) <= 0) return "No cooked food";
    return null;
  },

  onStart(ctx: ExecutionContext): void {
    ctx.actionState.set("ticksRemaining", EAT_DURATION);
  },

  onTick(ctx: ExecutionContext): ActionTickResult {
    const remaining = (ctx.actionState.get("ticksRemaining") as number) - 1;
    ctx.actionState.set("ticksRemaining", remaining);
    if (remaining > 0) return { status: "running" };

    if (!removeItem(ctx.inventory, "cooked_food")) {
      return { status: "failed", reason: "Cooked food disappeared" };
    }
    boostNeed(ctx.needs, "food", COOKED_FOOD_RESTORE);
    return { status: "completed" };
  },

  onEnd(_ctx: ExecutionContext, _reason): void {},

  describeOutcomeForMemory(_ctx, outcome, reason) {
    if (outcome === "completed") {
      return {
        content: "I ate cooked food and felt full.",
        importance: 4,
      };
    }
    if (outcome === "failed") {
      return {
        content: `I tried to eat cooked food but failed: ${reason ?? "the meal was gone"}.`,
        importance: 4,
      };
    }
    return null;
  },
};
