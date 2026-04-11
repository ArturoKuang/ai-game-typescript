/**
 * Pick up nearby bear meat after a successful hunt.
 */
import { getItemCount } from "../inventory.js";
import type {
  ActionDefinition,
  ActionTickResult,
  ExecutionContext,
} from "../types.js";

const PICKUP_BEAR_MEAT_TIMEOUT = 30;

export const pickupBearMeatAction: ActionDefinition = {
  id: "pickup_bear_meat",
  displayName: "Pick up bear meat",

  preconditions: new Map([["near_bear_meat", true]]),
  effects: new Map([["has_bear_meat", true]]),
  cost: 1,
  estimatedDurationTicks: PICKUP_BEAR_MEAT_TIMEOUT,

  proximityRequirement: {
    type: "entity",
    target: "bear_meat",
    distance: 1,
  },

  validate(ctx: ExecutionContext): string | null {
    const player = ctx.game.getPlayer(ctx.npcId);
    if (!player) return "Player not found";

    const pos = { x: Math.round(player.x), y: Math.round(player.y) };
    const meat = ctx.entityManager
      .getNearby(pos, 2, "bear_meat")
      .find((entity) => !entity.destroyed);

    if (!meat) return "No bear meat nearby";
    ctx.actionState.set("targetEntityId", meat.id);
    ctx.actionState.set(
      "startingCount",
      getItemCount(ctx.inventory, "bear_meat"),
    );
    return null;
  },

  onStart(ctx: ExecutionContext): void {
    ctx.actionState.set("startedAtTick", ctx.currentTick);
    const entityId = ctx.actionState.get("targetEntityId") as
      | string
      | undefined;
    if (!entityId) {
      return;
    }
    ctx.game.enqueue({
      type: "pickup",
      playerId: ctx.npcId,
      data: { entityId },
    });
  },

  onTick(ctx: ExecutionContext): ActionTickResult {
    const startingCount = (ctx.actionState.get("startingCount") as number) ?? 0;
    if (getItemCount(ctx.inventory, "bear_meat") > startingCount) {
      return { status: "completed" };
    }

    const startedAtTick =
      (ctx.actionState.get("startedAtTick") as number) ?? ctx.currentTick;
    if (ctx.currentTick - startedAtTick > PICKUP_BEAR_MEAT_TIMEOUT) {
      return { status: "failed", reason: "Timed out picking up bear meat" };
    }

    return { status: "running" };
  },

  onEnd(_ctx: ExecutionContext, _reason): void {},

  describeOutcomeForMemory(_ctx, outcome, reason) {
    const targetId = _ctx.actionState.get("targetEntityId") as
      | string
      | undefined;
    const targetEntity = targetId
      ? _ctx.entityManager.get(targetId)
      : undefined;
    if (outcome === "completed") {
      return {
        content: "I picked up bear meat from the ground.",
        importance: 5,
        hint: {
          outcomeTag: "resource_found",
          targetType: "bear_meat",
          targetId,
          targetPosition: targetEntity?.position,
        },
      };
    }
    if (outcome === "failed") {
      return {
        content: `I tried to pick up bear meat but failed: ${reason ?? "it was gone before I reached it"}.`,
        importance: 5,
        hint: {
          outcomeTag: "resource_depleted",
          targetType: "bear_meat",
          targetId,
          targetPosition: targetEntity?.position,
        },
      };
    }
    return null;
  },
};
