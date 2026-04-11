/**
 * Socialize action — initiate a conversation with a nearby player.
 *
 * The action enqueues a start_convo command and waits for the
 * conversation to begin (handled by NpcOrchestrator). The action
 * completes once the NPC enters a conversation, which also boosts
 * social need via the autonomy manager.
 */
import { manhattanDistance } from "../../engine/spatial.js";
import type {
  ActionDefinition,
  ActionTickResult,
  ExecutionContext,
} from "../types.js";

const SOCIALIZE_TIMEOUT = 200; // 10 seconds

export const socializeAction: ActionDefinition = {
  id: "socialize",
  displayName: "Socialize",

  preconditions: new Map([["near_player", true]]),
  effects: new Map([["need_social_satisfied", true]]),
  cost: 4,
  estimatedDurationTicks: 200,

  proximityRequirement: {
    type: "entity",
    target: "player", // resolved specially by planner
    distance: 3,
  },

  validate(ctx: ExecutionContext): string | null {
    const player = ctx.game.getPlayer(ctx.npcId);
    if (!player) return "Player not found";

    // Find a nearby non-conversing player
    const pos = { x: Math.round(player.x), y: Math.round(player.y) };
    const players = ctx.game.getPlayers();
    const target = players.find((p) => {
      if (p.id === ctx.npcId) return false;
      if (p.state === "conversing") return false;
      return manhattanDistance(p, pos) <= 6;
    });

    if (!target) return "No nearby available player";
    ctx.actionState.set("targetId", target.id);
    return null;
  },

  onStart(ctx: ExecutionContext): void {
    const targetId = ctx.actionState.get("targetId") as string;
    ctx.game.enqueue({
      type: "start_convo",
      playerId: ctx.npcId,
      data: { targetId },
    });
    ctx.actionState.set("startTick", ctx.currentTick);
  },

  onTick(ctx: ExecutionContext): ActionTickResult {
    const player = ctx.game.getPlayer(ctx.npcId);
    if (!player) return { status: "failed", reason: "Player not found" };

    // If we entered a conversation, socialize is working
    if (player.state === "conversing") {
      return { status: "completed" };
    }

    // Timeout
    const startTick = ctx.actionState.get("startTick") as number;
    if (ctx.currentTick - startTick > SOCIALIZE_TIMEOUT) {
      return { status: "failed", reason: "Conversation never started" };
    }

    return { status: "running" };
  },

  onEnd(_ctx: ExecutionContext, _reason): void {
    // Conversation lifecycle handled by orchestrator
  },

  describeOutcomeForMemory(ctx, outcome, reason) {
    const targetId = ctx.actionState.get("targetId") as string | undefined;
    const targetName = targetId ?? "someone";
    if (outcome === "completed") {
      return {
        content: `I started a conversation with ${targetName}.`,
        importance: 6,
        hint: {
          outcomeTag: "social_success",
          targetType: "player",
          targetId,
        },
      };
    }
    if (outcome === "failed") {
      return {
        content: `I tried to start a conversation with ${targetName} but failed: ${reason ?? "they were not available"}.`,
        importance: 5,
        hint: {
          outcomeTag: "social_unavailable",
          targetType: "player",
          targetId,
        },
      };
    }
    return null;
  },
};
