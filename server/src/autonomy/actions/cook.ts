/**
 * Cook action — cook raw_food at a campfire to produce cooked_food.
 *
 * Cooked food restores more hunger than raw food when eaten.
 */
import { addItem, removeItem } from "../inventory.js";
import type {
  ActionDefinition,
  ActionTickResult,
  ExecutionContext,
} from "../types.js";

const COOK_DURATION = 60; // 3 seconds at 20 ticks/sec

export const cookAction: ActionDefinition = {
  id: "cook",
  displayName: "Cook food",

  preconditions: new Map([
    ["has_raw_food", true],
    ["near_campfire", true],
  ]),
  effects: new Map([["has_cooked_food", true]]),
  cost: 2,
  estimatedDurationTicks: COOK_DURATION,

  proximityRequirement: {
    type: "entity",
    target: "campfire",
    distance: 1,
  },

  validate(ctx: ExecutionContext): string | null {
    const hasRaw = (ctx.inventory.get("raw_food") ?? 0) > 0;
    if (!hasRaw) return "No raw food to cook";

    const player = ctx.game.getPlayer(ctx.npcId);
    if (!player) return "Player not found";
    const pos = { x: Math.round(player.x), y: Math.round(player.y) };
    const fires = ctx.entityManager.getNearby(pos, 2, "campfire");
    const lit = fires.find((f) => !f.destroyed && f.properties.lit === true);
    if (!lit) return "No lit campfire nearby";
    return null;
  },

  onStart(ctx: ExecutionContext): void {
    ctx.actionState.set("ticksRemaining", COOK_DURATION);
  },

  onTick(ctx: ExecutionContext): ActionTickResult {
    const remaining = (ctx.actionState.get("ticksRemaining") as number) - 1;
    ctx.actionState.set("ticksRemaining", remaining);

    if (remaining > 0) {
      return { status: "running" };
    }

    // Cook complete — convert raw_food to cooked_food
    const removed = removeItem(ctx.inventory, "raw_food");
    if (!removed) {
      return {
        status: "failed",
        reason: "Raw food disappeared from inventory",
      };
    }

    addItem(ctx.inventory, "cooked_food");
    return { status: "completed" };
  },

  onEnd(_ctx: ExecutionContext, _reason): void {
    // No cleanup
  },

  describeOutcomeForMemory(_ctx, outcome, reason) {
    if (outcome === "completed") {
      return {
        content: "I cooked raw food at a campfire and made cooked food.",
        importance: 4,
      };
    }
    if (outcome === "failed") {
      return {
        content: `I tried to cook food at a campfire but failed: ${reason ?? "something went wrong"}.`,
        importance: 4,
      };
    }
    return null;
  },
};
