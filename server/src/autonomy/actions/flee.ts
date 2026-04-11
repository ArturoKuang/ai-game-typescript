/**
 * Flee action — NPC runs away from the nearest hostile entity (bear).
 *
 * Picks the direction opposite to the nearest threat and moves to a
 * tile at least FLEE_DISTANCE away.
 */
import type {
  ActionDefinition,
  ActionTickResult,
  ExecutionContext,
} from "../types.js";

const FLEE_DISTANCE = 6;
const FLEE_TIMEOUT = 200; // 10 seconds max

function queueMove(ctx: ExecutionContext, x: number, y: number): void {
  ctx.game.enqueue({
    type: "move_to",
    playerId: ctx.npcId,
    data: { x, y },
  });
}

export const fleeAction: ActionDefinition = {
  id: "flee",
  displayName: "Flee from danger",

  preconditions: new Map([["near_hostile", true]]),
  effects: new Map([["escaped_hostile", true]]),
  cost: 1, // low cost — survival is priority
  estimatedDurationTicks: 60,

  validate(ctx: ExecutionContext): string | null {
    const player = ctx.game.getPlayer(ctx.npcId);
    if (!player) return "Player not found";
    return null;
  },

  onStart(ctx: ExecutionContext): void {
    ctx.actionState.set("startTick", ctx.currentTick);

    const player = ctx.game.getPlayer(ctx.npcId);
    if (!player) return;

    const pos = { x: Math.round(player.x), y: Math.round(player.y) };

    // Find nearest hostile
    const hostiles = ctx.entityManager.getNearby(pos, 8, "bear");
    const threat = hostiles.find(
      (e) => !e.destroyed && e.properties.state !== "dead",
    );

    if (!threat) {
      // No visible threat — just move somewhere safe
      ctx.actionState.set("noThreat", true);
      return;
    }

    // Calculate direction away from threat
    const dx = pos.x - threat.position.x;
    const dy = pos.y - threat.position.y;

    // Normalize and scale to flee distance
    const mag = Math.sqrt(dx * dx + dy * dy) || 1;
    const targetX = Math.round(pos.x + (dx / mag) * FLEE_DISTANCE);
    const targetY = Math.round(pos.y + (dy / mag) * FLEE_DISTANCE);

    // Clamp to world bounds (assume 20x20 with walls on edges)
    const clampedX = Math.max(1, Math.min(18, targetX));
    const clampedY = Math.max(1, Math.min(18, targetY));

    queueMove(ctx, clampedX, clampedY);
    ctx.actionState.set("pathSet", true);
    ctx.actionState.set("moveStarted", false);
  },

  onTick(ctx: ExecutionContext): ActionTickResult {
    if (ctx.actionState.get("noThreat")) {
      return { status: "completed" };
    }

    const player = ctx.game.getPlayer(ctx.npcId);
    if (!player) return { status: "failed", reason: "Player missing" };
    if (player.state === "walking") {
      ctx.actionState.set("moveStarted", true);
    }

    // Check timeout
    const startTick = ctx.actionState.get("startTick") as number;
    if (ctx.currentTick - startTick > FLEE_TIMEOUT) {
      return { status: "completed" };
    }

    // Check if we're far enough from all hostiles
    const pos = { x: Math.round(player.x), y: Math.round(player.y) };
    const hostiles = ctx.entityManager.getNearby(pos, FLEE_DISTANCE, "bear");
    const activeThreat = hostiles.find(
      (e) => !e.destroyed && e.properties.state !== "dead",
    );

    if (!activeThreat) {
      return { status: "completed" };
    }

    // Still fleeing — check if stopped moving (arrived at destination or blocked)
    if (player.state === "idle") {
      // Arrived but still too close — try again in a different direction
      const dx = pos.x - activeThreat.position.x;
      const dy = pos.y - activeThreat.position.y;
      const dist = Math.abs(dx) + Math.abs(dy);

      if (dist >= FLEE_DISTANCE) {
        return { status: "completed" };
      }

      // Pick a new flee direction
      const mag = Math.sqrt(dx * dx + dy * dy) || 1;
      const newX = Math.max(
        1,
        Math.min(18, Math.round(pos.x + (dx / mag) * FLEE_DISTANCE)),
      );
      const newY = Math.max(
        1,
        Math.min(18, Math.round(pos.y + (dy / mag) * FLEE_DISTANCE)),
      );
      queueMove(ctx, newX, newY);
    }

    return { status: "running" };
  },

  onEnd(_ctx: ExecutionContext, _reason): void {
    // No cleanup
  },

  describeOutcomeForMemory(_ctx, outcome, reason) {
    if (outcome === "completed") {
      return {
        content: "A bear was nearby, so I fled to safer ground.",
        importance: 6,
        hint: {
          outcomeTag: "danger",
          targetType: "bear",
        },
      };
    }
    if (outcome === "failed") {
      return {
        content: `I tried to flee from danger but failed: ${reason ?? "I could not get clear"}.`,
        importance: 6,
        hint: {
          outcomeTag: "danger",
          targetType: "bear",
        },
      };
    }
    return null;
  },
};
