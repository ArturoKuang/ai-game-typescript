/**
 * Harvest action — gather raw_food from a berry bush.
 */
import { addItem } from "../inventory.js";
import type { ActionDefinition, ActionTickResult, ExecutionContext } from "../types.js";

const HARVEST_DURATION = 40; // 2 seconds at 20 ticks/sec

export const harvestAction: ActionDefinition = {
  id: "harvest",
  displayName: "Harvest berries",

  preconditions: new Map([["near_berry_bush", true]]),
  effects: new Map([["has_raw_food", true]]),
  cost: 2,
  estimatedDurationTicks: HARVEST_DURATION,

  proximityRequirement: {
    type: "entity",
    target: "berry_bush",
    distance: 1,
  },

  validate(ctx: ExecutionContext): string | null {
    const player = ctx.game.getPlayer(ctx.npcId);
    if (!player) return "Player not found";
    const pos = { x: Math.round(player.x), y: Math.round(player.y) };
    const bushes = ctx.entityManager.getNearby(pos, 2, "berry_bush");
    const bush = bushes.find(
      (b) => !b.destroyed && (b.properties.berries as number) > 0,
    );
    if (!bush) return "No berry bush with berries nearby";
    ctx.actionState.set("bushId", bush.id);
    return null;
  },

  onStart(ctx: ExecutionContext): void {
    ctx.actionState.set("ticksRemaining", HARVEST_DURATION);
  },

  onTick(ctx: ExecutionContext): ActionTickResult {
    const remaining = (ctx.actionState.get("ticksRemaining") as number) - 1;
    ctx.actionState.set("ticksRemaining", remaining);

    if (remaining > 0) {
      return { status: "running" };
    }

    // Harvest complete — take a berry
    const bushId = ctx.actionState.get("bushId") as string;
    const bush = ctx.entityManager.get(bushId);
    if (!bush || bush.destroyed) {
      return { status: "failed", reason: "Berry bush destroyed" };
    }
    const berries = (bush.properties.berries as number) ?? 0;
    if (berries <= 0) {
      return { status: "failed", reason: "No berries left" };
    }

    // Decrement berries (EntityManager.updateProperty notifies listeners)
    const mgr = ctx.entityManager as { updateProperty?: (id: string, key: string, value: number) => void };
    if (mgr.updateProperty) {
      mgr.updateProperty(bushId, "berries", berries - 1);
    } else {
      bush.properties.berries = berries - 1;
    }

    addItem(ctx.inventory, "raw_food");
    return { status: "completed" };
  },

  onEnd(_ctx: ExecutionContext, _reason): void {
    // No cleanup
  },
};
