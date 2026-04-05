/**
 * Drink action — refill water at the pond shore.
 */
import { boostNeed } from "../needs.js";
import type {
  ActionDefinition,
  ActionTickResult,
  ExecutionContext,
} from "../types.js";

const DRINK_DURATION = 25;
const WATER_RESTORE = 75;

export const drinkAction: ActionDefinition = {
  id: "drink",
  displayName: "Drink water",

  preconditions: new Map([["near_water_source", true]]),
  effects: new Map([["need_water_satisfied", true]]),
  cost: 1,
  estimatedDurationTicks: DRINK_DURATION,

  proximityRequirement: {
    type: "entity",
    target: "water_source",
    distance: 1,
  },

  validate(ctx: ExecutionContext): string | null {
    const player = ctx.game.getPlayer(ctx.npcId);
    if (!player) return "Player not found";
    const pos = { x: Math.round(player.x), y: Math.round(player.y) };
    const waterSources = ctx.entityManager.getNearby(pos, 1, "water_source");
    if (waterSources.length === 0) return "No pond nearby";
    return null;
  },

  onStart(ctx: ExecutionContext): void {
    ctx.actionState.set("ticksRemaining", DRINK_DURATION);
  },

  onTick(ctx: ExecutionContext): ActionTickResult {
    const remaining = (ctx.actionState.get("ticksRemaining") as number) - 1;
    ctx.actionState.set("ticksRemaining", remaining);

    if (remaining > 0) {
      return { status: "running" };
    }

    boostNeed(ctx.needs, "water", WATER_RESTORE);
    return { status: "completed" };
  },

  onEnd(_ctx: ExecutionContext, _reason): void {},
};
