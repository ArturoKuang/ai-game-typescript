/**
 * Eat action — consume food to restore hunger.
 */
import { removeItem } from "../inventory.js";
import { boostNeed } from "../needs.js";
import type { ActionDefinition, ActionTickResult, ExecutionContext } from "../types.js";

const EAT_DURATION = 20; // 1 second at 20 ticks/sec
const HUNGER_RESTORE = 50;

export const eatAction: ActionDefinition = {
  id: "eat",
  displayName: "Eat food",

  preconditions: new Map([["has_raw_food", true]]),
  effects: new Map([["need_hunger_satisfied", true]]),
  cost: 1,
  estimatedDurationTicks: EAT_DURATION,

  // No proximity requirement — can eat anywhere

  validate(ctx: ExecutionContext): string | null {
    const hasRaw = ctx.inventory.has("raw_food") && (ctx.inventory.get("raw_food") ?? 0) > 0;
    const hasCooked = ctx.inventory.has("cooked_food") && (ctx.inventory.get("cooked_food") ?? 0) > 0;
    if (!hasRaw && !hasCooked) return "No food in inventory";
    return null;
  },

  onStart(ctx: ExecutionContext): void {
    ctx.actionState.set("ticksRemaining", EAT_DURATION);
  },

  onTick(ctx: ExecutionContext): ActionTickResult {
    const remaining = (ctx.actionState.get("ticksRemaining") as number) - 1;
    ctx.actionState.set("ticksRemaining", remaining);

    if (remaining > 0) {
      return { status: "running" };
    }

    // Prefer cooked food, fall back to raw
    const ate = removeItem(ctx.inventory, "cooked_food") || removeItem(ctx.inventory, "raw_food");
    if (!ate) {
      return { status: "failed", reason: "Food disappeared from inventory" };
    }

    boostNeed(ctx.needs, "hunger", HUNGER_RESTORE);
    return { status: "completed" };
  },

  onEnd(_ctx: ExecutionContext, _reason): void {
    // No cleanup
  },
};
