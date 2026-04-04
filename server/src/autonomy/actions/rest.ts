/**
 * Rest action — sit at a bench or reading nook to restore energy.
 */
import { boostNeed } from "../needs.js";
import type { ActionDefinition, ActionTickResult, ExecutionContext } from "../types.js";

const REST_DURATION = 100; // 5 seconds at 20 ticks/sec
const ENERGY_RESTORE = 60;

export const restAction: ActionDefinition = {
  id: "rest",
  displayName: "Rest",

  preconditions: new Map([["near_bench", true]]),
  effects: new Map([["need_energy_satisfied", true]]),
  cost: 2,
  estimatedDurationTicks: REST_DURATION,

  proximityRequirement: {
    type: "entity",
    target: "bench",
    distance: 1,
  },

  validate(ctx: ExecutionContext): string | null {
    const player = ctx.game.getPlayer(ctx.npcId);
    if (!player) return "Player not found";
    const pos = { x: Math.round(player.x), y: Math.round(player.y) };
    const benches = ctx.entityManager.getNearby(pos, 2, "bench");
    if (benches.length === 0) return "No bench nearby";
    return null;
  },

  onStart(ctx: ExecutionContext): void {
    ctx.actionState.set("ticksRemaining", REST_DURATION);
  },

  onTick(ctx: ExecutionContext): ActionTickResult {
    const remaining = (ctx.actionState.get("ticksRemaining") as number) - 1;
    ctx.actionState.set("ticksRemaining", remaining);

    if (remaining > 0) {
      return { status: "running" };
    }

    boostNeed(ctx.needs, "energy", ENERGY_RESTORE);
    return { status: "completed" };
  },

  onEnd(_ctx: ExecutionContext, _reason): void {
    // No cleanup
  },
};
