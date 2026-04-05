/**
 * Pickup action — NPC picks up a nearby ground item or bear meat.
 *
 * Enqueues a pickup command to the game loop (handled by BearManager).
 * This gives NPCs the ability to collect loot and food drops.
 */
import type {
  ActionDefinition,
  ActionTickResult,
  ExecutionContext,
} from "../types.js";

const PICKUP_DURATION = 10; // 0.5 seconds

export const pickupAction: ActionDefinition = {
  id: "pickup",
  displayName: "Pick up item",

  preconditions: new Map([["near_pickupable", true]]),
  effects: new Map([["has_raw_food", true]]), // most pickups are food
  cost: 1,
  estimatedDurationTicks: PICKUP_DURATION,

  proximityRequirement: {
    type: "entity",
    target: "pickupable",
    distance: 1,
  },

  validate(ctx: ExecutionContext): string | null {
    const player = ctx.game.getPlayer(ctx.npcId);
    if (!player) return "Player not found";
    const pos = { x: Math.round(player.x), y: Math.round(player.y) };

    // Find nearest pickupable entity
    const nearby = ctx.entityManager.getNearby(pos, 2);
    const pickupable = nearby.find(
      (e) =>
        !e.destroyed && (e.type === "bear_meat" || e.type === "ground_item"),
    );

    if (!pickupable) return "No items nearby to pick up";
    ctx.actionState.set("targetEntityId", pickupable.id);
    return null;
  },

  onStart(ctx: ExecutionContext): void {
    ctx.actionState.set("ticksRemaining", PICKUP_DURATION);
    ctx.actionState.set("pickedUp", false);

    const entityId = ctx.actionState.get("targetEntityId") as string;
    if (entityId) {
      // Enqueue pickup command
      ctx.game.enqueue({
        type: "pickup",
        playerId: ctx.npcId,
        data: { entityId },
      });
      ctx.actionState.set("pickedUp", true);
    }
  },

  onTick(ctx: ExecutionContext): ActionTickResult {
    const remaining = (ctx.actionState.get("ticksRemaining") as number) - 1;
    ctx.actionState.set("ticksRemaining", remaining);

    if (remaining > 0) {
      return { status: "running" };
    }

    if (!ctx.actionState.get("pickedUp")) {
      return { status: "failed", reason: "Nothing to pick up" };
    }

    return { status: "completed" };
  },

  onEnd(_ctx: ExecutionContext, _reason): void {
    // No cleanup
  },
};
