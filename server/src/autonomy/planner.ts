import { manhattanDistance } from "../engine/spatial.js";
/**
 * GOAP backward A* planner.
 *
 * Works backward from the goal: finds which actions produce the desired
 * predicates, adds their preconditions as new unsatisfied predicates,
 * and repeats until all predicates are satisfied by the current state.
 */
import type { Position } from "../engine/types.js";
import { GOTO_ACTION_ID } from "./actions/goto.js";
import type { ActionRegistry } from "./registry.js";
import type {
  ActionDefinition,
  Plan,
  PlannedStep,
  PlanningContext,
  PredicateValue,
  RememberedTarget,
  WorldState,
} from "./types.js";

const MAX_ITERATIONS = 200;
const ACTION_FAILURE_MEMORY_WINDOW = 250;
const ACTION_SUCCESS_MEMORY_WINDOW = 400;
const TARGET_FAILURE_MEMORY_WINDOW = 400;
const TARGET_SUCCESS_MEMORY_WINDOW = 500;
const REMEMBERED_TARGET_WINDOW = 1200;
const SAME_ACTION_FAILURE_PENALTY = 3;
const SAME_ACTION_SUCCESS_BONUS = 0.35;
const SAME_TARGET_FAILURE_PENALTY = 4;
const SAME_TARGET_SUCCESS_BONUS = 0.75;
const DANGER_MEMORY_BONUS = 0.5;
const REMEMBERED_AVAILABLE_BONUS = 0.8;
const REMEMBERED_UNAVAILABLE_PENALTY = 4.5;
const REMEMBERED_DANGER_PENALTY = 5;

interface PlannerNode {
  /** Predicates not yet satisfied by currentState. */
  unsatisfied: Map<string, PredicateValue>;
  /** Actions accumulated (in reverse order). */
  steps: PlannedStep[];
  /** Accumulated cost. */
  cost: number;
}

/**
 * Plan a sequence of actions to reach the goal from the current state.
 *
 * Returns null if no plan can be found within MAX_ITERATIONS.
 */
export function plan(
  currentState: WorldState,
  goal: WorldState,
  registry: ActionRegistry,
  ctx: PlanningContext,
): Plan | null {
  // Check which goal predicates are already satisfied
  const initialUnsatisfied = new Map<string, PredicateValue>();
  for (const [key, value] of goal) {
    if (currentState.get(key) !== value) {
      initialUnsatisfied.set(key, value);
    }
  }

  if (initialUnsatisfied.size === 0) return null; // Goal already met

  // Priority queue sorted by cost + heuristic (unsatisfied count)
  const open: PlannerNode[] = [
    { unsatisfied: initialUnsatisfied, steps: [], cost: 0 },
  ];

  let iterations = 0;
  while (open.length > 0 && iterations < MAX_ITERATIONS) {
    iterations++;

    // Pop lowest cost + heuristic
    open.sort(
      (a, b) => a.cost + a.unsatisfied.size - (b.cost + b.unsatisfied.size),
    );
    const node = open.shift();
    if (!node) {
      break;
    }

    // Check if all unsatisfied predicates are now met by currentState
    if (allSatisfied(node.unsatisfied, currentState)) {
      // Reverse the steps (they were accumulated backward)
      const steps = [...node.steps].reverse();
      return {
        goalId: goalIdFromPredicates(goal),
        steps,
        totalCost: node.cost,
        createdAtTick: 0, // Set by caller
      };
    }

    // Find actions whose effects overlap unsatisfied predicates
    const candidates = registry.getActionsForEffects(node.unsatisfied);

    for (const action of candidates) {
      if (action.id === GOTO_ACTION_ID) continue; // goto is auto-inserted

      // New unsatisfied = current unsatisfied - action effects + action preconditions
      const newUnsatisfied = new Map(node.unsatisfied);

      // Remove predicates satisfied by this action
      for (const [key, value] of action.effects) {
        if (newUnsatisfied.get(key) === value) {
          newUnsatisfied.delete(key);
        }
      }

      // Add action preconditions as new unsatisfied
      for (const [key, value] of action.preconditions) {
        if (currentState.get(key) !== value) {
          newUnsatisfied.set(key, value);
        }
      }

      const actionCost =
        typeof action.cost === "function" ? action.cost(ctx) : action.cost;
      const memoryAdjustment = memoryAdjustedActionCost(action, ctx);

      const step: PlannedStep = { actionId: action.id };

      // If action has proximity requirement and NPC isn't near, add goto cost
      let gotoStep: PlannedStep | null = null;
      let gotoCost = 0;
      if (action.proximityRequirement) {
        const proximityKey = `near_${action.proximityRequirement.target}`;
        if (currentState.get(proximityKey) !== true) {
          const targetPos = resolveProximityTarget(action, ctx);
          if (targetPos) {
            const dist = manhattanDistance(targetPos, ctx.npcPosition);
            gotoCost = dist * 0.5;
            gotoStep = { actionId: GOTO_ACTION_ID, targetPosition: targetPos };
            // Remove the proximity predicate from unsatisfied since goto handles it
            newUnsatisfied.delete(proximityKey);
          }
        }
      }

      const totalStepCost = actionCost + gotoCost + memoryAdjustment;
      const newSteps = [...node.steps, step];
      if (gotoStep) {
        newSteps.push(gotoStep);
      }

      open.push({
        unsatisfied: newUnsatisfied,
        steps: newSteps,
        cost: node.cost + totalStepCost,
      });
    }
  }

  return null; // No plan found
}

function allSatisfied(
  unsatisfied: Map<string, PredicateValue>,
  currentState: WorldState,
): boolean {
  for (const [key, value] of unsatisfied) {
    if (currentState.get(key) !== value) return false;
  }
  return true;
}

function resolveProximityTarget(
  action: ActionDefinition,
  ctx: PlanningContext,
): Position | null {
  const req = action.proximityRequirement;
  if (!req) return null;

  if (req.type === "entity") {
    // Special case: "player" means find nearest other player
    if (req.target === "player") {
      return findClosestRememberedTargetPosition(
        action.id,
        getKnownTargets(ctx, ["player"]),
        ctx,
      );
    }

    if (req.target === "pickupable") {
      return findClosestRememberedTargetPosition(
        action.id,
        getKnownTargets(ctx, ["bear_meat", "ground_item"]),
        ctx,
      );
    }

    return findClosestRememberedTargetPosition(
      action.id,
      getKnownTargets(ctx, [req.target]),
      ctx,
    );
  }

  return null;
}

function getKnownTargets(
  ctx: PlanningContext,
  targetTypes: string[],
): RememberedTarget[] {
  const currentTick = ctx.currentTick ?? 0;
  return (ctx.rememberedTargets ?? []).filter((target) => {
    if (!targetTypes.includes(target.targetType)) {
      return false;
    }
    return currentTick - target.lastSeenTick <= REMEMBERED_TARGET_WINDOW;
  });
}

function findClosestRememberedTargetPosition(
  actionId: string,
  targets: RememberedTarget[],
  ctx: PlanningContext,
): Position | null {
  if (targets.length === 0) return null;

  let closest: Position | null = null;
  let bestScore = Number.POSITIVE_INFINITY;
  for (const target of targets) {
    const approachPosition = toApproachPosition(target.position, ctx);
    if (!approachPosition) continue;
    const dist = manhattanDistance(approachPosition, ctx.npcPosition);
    const score =
      dist +
      rememberedTargetAvailabilityAdjustment(target, ctx) +
      memoryTargetAdjustmentForRememberedTarget(actionId, target, ctx);
    if (score < bestScore) {
      bestScore = score;
      closest = approachPosition;
    }
  }
  return closest;
}

function memoryAdjustedActionCost(
  action: ActionDefinition,
  ctx: PlanningContext,
): number {
  let adjustment = 0;
  const currentTick = ctx.currentTick ?? 0;
  const recentActionHistory = ctx.recentActionHistory ?? [];

  for (const entry of recentActionHistory) {
    const age = Math.max(0, currentTick - entry.tick);
    if (entry.actionId === action.id) {
      if (entry.outcome === "failed" && age <= ACTION_FAILURE_MEMORY_WINDOW) {
        adjustment +=
          SAME_ACTION_FAILURE_PENALTY *
          recencyWeight(age, ACTION_FAILURE_MEMORY_WINDOW);
      }
      if (
        entry.outcome === "completed" &&
        age <= ACTION_SUCCESS_MEMORY_WINDOW
      ) {
        adjustment -=
          SAME_ACTION_SUCCESS_BONUS *
          recencyWeight(age, ACTION_SUCCESS_MEMORY_WINDOW);
      }
    }

    if (action.id === "flee" && entry.outcomeTag === "danger") {
      adjustment -= DANGER_MEMORY_BONUS * recencyWeight(age, 200);
    }
  }

  return adjustment;
}

function memoryTargetAdjustment(
  actionId: string,
  targetType: string,
  targetId: string,
  ctx: PlanningContext,
): number {
  let adjustment = 0;
  const currentTick = ctx.currentTick ?? 0;
  const recentActionHistory = ctx.recentActionHistory ?? [];

  for (const entry of recentActionHistory) {
    if (entry.targetType !== targetType || entry.targetId !== targetId) {
      continue;
    }

    const age = Math.max(0, currentTick - entry.tick);
    if (
      entry.actionId === actionId &&
      entry.outcome === "failed" &&
      age <= TARGET_FAILURE_MEMORY_WINDOW
    ) {
      adjustment +=
        SAME_TARGET_FAILURE_PENALTY *
        recencyWeight(age, TARGET_FAILURE_MEMORY_WINDOW);
    }

    if (
      entry.actionId === actionId &&
      entry.outcome === "completed" &&
      age <= TARGET_SUCCESS_MEMORY_WINDOW
    ) {
      adjustment -=
        SAME_TARGET_SUCCESS_BONUS *
        recencyWeight(age, TARGET_SUCCESS_MEMORY_WINDOW);
    }

    if (
      (entry.outcomeTag === "resource_depleted" ||
        entry.outcomeTag === "social_unavailable") &&
      age <= TARGET_FAILURE_MEMORY_WINDOW
    ) {
      adjustment +=
        SAME_TARGET_FAILURE_PENALTY *
        recencyWeight(age, TARGET_FAILURE_MEMORY_WINDOW);
    }

    if (
      (entry.outcomeTag === "resource_found" ||
        entry.outcomeTag === "social_success") &&
      age <= TARGET_SUCCESS_MEMORY_WINDOW
    ) {
      adjustment -=
        SAME_TARGET_SUCCESS_BONUS *
        recencyWeight(age, TARGET_SUCCESS_MEMORY_WINDOW);
    }
  }

  return adjustment;
}

function recencyWeight(age: number, window: number): number {
  if (age >= window) {
    return 0;
  }
  return 1 - age / window;
}

function rememberedTargetAdjustment(
  target: RememberedTarget,
  ctx: PlanningContext,
): number {
  const currentTick = ctx.currentTick ?? 0;
  const age = Math.max(0, currentTick - target.lastSeenTick);
  const weight = recencyWeight(age, REMEMBERED_TARGET_WINDOW);
  if (weight <= 0) {
    return 0;
  }

  let adjustment = 0;
  if (target.availability === "available") {
    adjustment -= REMEMBERED_AVAILABLE_BONUS * weight;
  }
  if (
    target.availability === "depleted" ||
    target.availability === "unavailable"
  ) {
    adjustment += REMEMBERED_UNAVAILABLE_PENALTY * weight;
  }
  if (target.availability === "danger") {
    adjustment += REMEMBERED_DANGER_PENALTY * weight;
  }
  return adjustment;
}

function rememberedTargetAvailabilityAdjustment(
  target: RememberedTarget,
  ctx: PlanningContext,
): number {
  return rememberedTargetAdjustment(target, ctx);
}

function memoryTargetAdjustmentForRememberedTarget(
  actionId: string,
  target: RememberedTarget,
  ctx: PlanningContext,
): number {
  if (!target.targetId) {
    return 0;
  }
  return memoryTargetAdjustment(
    actionId,
    target.targetType,
    target.targetId,
    ctx,
  );
}

function toApproachPosition(
  target: Position,
  ctx: PlanningContext,
): Position | null {
  if (ctx.world.isWalkable(target.x, target.y)) {
    return target;
  }

  const candidates: Position[] = [
    { x: target.x, y: target.y - 1 },
    { x: target.x + 1, y: target.y },
    { x: target.x, y: target.y + 1 },
    { x: target.x - 1, y: target.y },
  ].filter((pos) => ctx.world.isWalkable(pos.x, pos.y));

  if (candidates.length === 0) {
    return null;
  }

  candidates.sort((a, b) => {
    const da = manhattanDistance(a, ctx.npcPosition);
    const db = manhattanDistance(b, ctx.npcPosition);
    return da - db;
  });

  return candidates[0];
}

function goalIdFromPredicates(goal: WorldState): string {
  const entries = Array.from(goal.entries());
  if (entries.length === 1) {
    return entries[0][0];
  }
  return entries.map(([k]) => k).join("+");
}
