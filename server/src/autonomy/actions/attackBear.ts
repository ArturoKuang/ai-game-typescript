import {
  PLAYER_ATTACK_COOLDOWN,
  PLAYER_ATTACK_RANGE,
} from "../../bears/bearConfig.js";
/**
 * Attack a nearby bear until it drops meat.
 *
 * The action issues explicit `attack` commands through the normal combat path
 * so bear damage, death, and loot drops remain owned by BearManager.
 */
import { manhattanDistance } from "../../engine/spatial.js";
import type {
  ActionDefinition,
  ActionTickResult,
  ExecutionContext,
  WorldEntity,
} from "../types.js";

const ATTACK_BEAR_TIMEOUT = 240;

function isActiveBear(bear: WorldEntity | undefined): bear is WorldEntity {
  return Boolean(
    bear &&
      !bear.destroyed &&
      bear.type === "bear" &&
      bear.properties.state !== "dead" &&
      typeof bear.properties.hp === "number" &&
      (bear.properties.hp as number) > 0,
  );
}

function hasNearbyBearMeat(ctx: ExecutionContext): boolean {
  const player = ctx.game.getPlayer(ctx.npcId);
  if (!player) {
    return false;
  }
  const pos = { x: Math.round(player.x), y: Math.round(player.y) };
  return ctx.entityManager
    .getNearby(pos, 2, "bear_meat")
    .some((entity) => !entity.destroyed);
}

export const attackBearAction: ActionDefinition = {
  id: "attack_bear",
  displayName: "Attack bear",

  preconditions: new Map([["near_bear", true]]),
  effects: new Map([["near_bear_meat", true]]),
  cost: 2,
  estimatedDurationTicks: ATTACK_BEAR_TIMEOUT,

  proximityRequirement: {
    type: "entity",
    target: "bear",
    distance: PLAYER_ATTACK_RANGE + 1,
  },

  validate(ctx: ExecutionContext): string | null {
    const player = ctx.game.getPlayer(ctx.npcId);
    if (!player) return "Player not found";

    const pos = { x: Math.round(player.x), y: Math.round(player.y) };
    const targetBear = ctx.entityManager
      .getNearby(pos, 4, "bear")
      .find((bear) => isActiveBear(bear));

    if (!targetBear) return "No nearby bear to attack";
    ctx.actionState.set("targetBearId", targetBear.id);
    return null;
  },

  onStart(ctx: ExecutionContext): void {
    ctx.actionState.set("startedAtTick", ctx.currentTick);
    ctx.actionState.set(
      "lastAttackTick",
      ctx.currentTick - PLAYER_ATTACK_COOLDOWN,
    );
  },

  onTick(ctx: ExecutionContext): ActionTickResult {
    const player = ctx.game.getPlayer(ctx.npcId);
    if (!player) return { status: "failed", reason: "Player not found" };

    if (hasNearbyBearMeat(ctx)) {
      return { status: "completed" };
    }

    const startedAtTick =
      (ctx.actionState.get("startedAtTick") as number) ?? ctx.currentTick;
    if (ctx.currentTick - startedAtTick > ATTACK_BEAR_TIMEOUT) {
      return { status: "failed", reason: "Bear hunt timed out" };
    }

    const targetBearId = ctx.actionState.get("targetBearId") as
      | string
      | undefined;
    const targetBear = targetBearId
      ? ctx.entityManager.get(targetBearId)
      : undefined;
    if (!isActiveBear(targetBear)) {
      return hasNearbyBearMeat(ctx)
        ? { status: "completed" }
        : {
            status: "failed",
            reason: "Bear died before meat could be recovered",
          };
    }

    const distance = manhattanDistance(
      { x: Math.round(player.x), y: Math.round(player.y) },
      targetBear.position,
    );
    if (distance > PLAYER_ATTACK_RANGE + 1) {
      ctx.game.enqueue({
        type: "move_to",
        playerId: ctx.npcId,
        data: { x: targetBear.position.x, y: targetBear.position.y },
      });
      return { status: "running" };
    }

    const lastAttackTick =
      (ctx.actionState.get("lastAttackTick") as number) ??
      ctx.currentTick - PLAYER_ATTACK_COOLDOWN;
    if (ctx.currentTick - lastAttackTick >= PLAYER_ATTACK_COOLDOWN) {
      ctx.game.enqueue({
        type: "attack",
        playerId: ctx.npcId,
        data: { targetId: targetBear.id },
      });
      ctx.actionState.set("lastAttackTick", ctx.currentTick);
    }

    return { status: "running" };
  },

  onEnd(_ctx: ExecutionContext, _reason): void {},

  describeOutcomeForMemory(_ctx, outcome, reason) {
    const targetBearId = _ctx.actionState.get("targetBearId") as
      | string
      | undefined;
    const targetBear = targetBearId
      ? _ctx.entityManager.get(targetBearId)
      : undefined;
    if (outcome === "completed") {
      return {
        content: "I fought a bear and found meat afterward.",
        importance: 7,
        hint: {
          outcomeTag: "resource_found",
          targetType: "bear",
          targetId: targetBearId,
          targetPosition: targetBear?.position,
        },
      };
    }
    if (outcome === "failed") {
      return {
        content: `I tried to hunt a bear but failed: ${reason ?? "the hunt went badly"}.`,
        importance: 6,
        hint: {
          outcomeTag: "danger",
          targetType: "bear",
          targetId: targetBearId,
          targetPosition: targetBear?.position,
        },
      };
    }
    return null;
  },
};
