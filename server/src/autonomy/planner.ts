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
  EntityManagerInterface,
  Plan,
  PlannedStep,
  PlanningContext,
  PredicateValue,
  WorldState,
} from "./types.js";

const MAX_ITERATIONS = 200;

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
    const node = open.shift()!;

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

      const step: PlannedStep = { actionId: action.id };

      // If action has proximity requirement and NPC isn't near, add goto cost
      let gotoStep: PlannedStep | null = null;
      let gotoCost = 0;
      if (action.proximityRequirement) {
        const proximityKey = `near_${action.proximityRequirement.target}`;
        if (currentState.get(proximityKey) !== true) {
          const targetPos = resolveProximityTarget(action, ctx);
          if (targetPos) {
            const dist =
              Math.abs(targetPos.x - ctx.npcPosition.x) +
              Math.abs(targetPos.y - ctx.npcPosition.y);
            gotoCost = dist * 0.5;
            gotoStep = { actionId: GOTO_ACTION_ID, targetPosition: targetPos };
            // Remove the proximity predicate from unsatisfied since goto handles it
            newUnsatisfied.delete(proximityKey);
          }
        }
      }

      const totalStepCost = actionCost + gotoCost;
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
      let closestPlayer: Position | null = null;
      let minDist = Number.POSITIVE_INFINITY;
      for (const player of ctx.otherPlayers) {
        if (player.state === "conversing") continue;
        const dist =
          Math.abs(player.x - ctx.npcPosition.x) +
          Math.abs(player.y - ctx.npcPosition.y);
        if (dist < minDist) {
          minDist = dist;
          closestPlayer = { x: Math.round(player.x), y: Math.round(player.y) };
        }
      }
      return closestPlayer;
    }

    if (req.target === "pickupable") {
      return findClosestEntityPosition(
        [
          ...ctx.entityManager.getByType("bear_meat"),
          ...ctx.entityManager.getByType("ground_item"),
        ],
        ctx,
      );
    }

    return findClosestEntityPosition(ctx.entityManager.getByType(req.target), ctx);
  }

  return null;
}

function findClosestEntityPosition(
  entities: EntityManagerInterface["getByType"] extends (...args: never[]) => infer T
    ? T
    : never,
  ctx: PlanningContext,
): Position | null {
  if (entities.length === 0) return null;

  let closest: Position | null = null;
  let minDist = Number.POSITIVE_INFINITY;
  for (const entity of entities) {
    if (entity.destroyed) continue;
    const dist =
      Math.abs(entity.position.x - ctx.npcPosition.x) +
      Math.abs(entity.position.y - ctx.npcPosition.y);
    if (dist < minDist) {
      minDist = dist;
      closest = entity.position;
    }
  }
  return closest;
}

function goalIdFromPredicates(goal: WorldState): string {
  const entries = Array.from(goal.entries());
  if (entries.length === 1) {
    return entries[0][0];
  }
  return entries.map(([k]) => k).join("+");
}
