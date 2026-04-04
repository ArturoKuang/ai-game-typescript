/**
 * Tick-based action executor for NPC autonomy plans.
 *
 * Runs one step of a plan per tick. Handles the action lifecycle:
 * validate -> onStart -> onTick (repeating) -> onEnd.
 */
import type { ActionRegistry } from "./registry.js";
import type {
  ActionExecution,
  EntityManagerInterface,
  ExecutionContext,
  GameLoopInterface,
  NpcAutonomyState,
  Plan,
} from "./types.js";

/** Max plan age before forced invalidation. */
const PLAN_EXPIRY_TICKS = 2000;

export interface ExecutorTickResult {
  planCompleted: boolean;
  planFailed: boolean;
  failReason?: string;
}

/**
 * Execute one tick of an NPC's current plan.
 *
 * Returns status so the manager knows whether to re-plan.
 */
export function executeAutonomyTick(
  npcId: string,
  state: NpcAutonomyState,
  registry: ActionRegistry,
  game: GameLoopInterface,
  entityManager: EntityManagerInterface,
): ExecutorTickResult {
  if (!state.currentPlan) {
    return { planCompleted: false, planFailed: false };
  }

  const plan = state.currentPlan;

  // Check plan expiry
  if (game.currentTick - plan.createdAtTick > PLAN_EXPIRY_TICKS) {
    invalidatePlan(npcId, state, registry, game, entityManager, "Plan expired");
    return { planCompleted: false, planFailed: true, failReason: "Plan expired" };
  }

  // If we've executed all steps, plan is done
  if (state.currentStepIndex >= plan.steps.length) {
    state.currentPlan = null;
    state.currentStepIndex = 0;
    state.currentExecution = null;
    return { planCompleted: true, planFailed: false };
  }

  const step = plan.steps[state.currentStepIndex];
  const action = registry.get(step.actionId);
  if (!action) {
    invalidatePlan(npcId, state, registry, game, entityManager, `Unknown action: ${step.actionId}`);
    return { planCompleted: false, planFailed: true, failReason: `Unknown action: ${step.actionId}` };
  }

  const ctx = buildExecutionContext(
    npcId, state, game, entityManager, step.targetPosition,
  );

  // Start new action execution if needed
  if (!state.currentExecution || state.currentExecution.actionId !== step.actionId) {
    // Validate before starting
    const error = action.validate(ctx);
    if (error) {
      invalidatePlan(npcId, state, registry, game, entityManager, error);
      return { planCompleted: false, planFailed: true, failReason: error };
    }

    state.currentExecution = {
      actionId: step.actionId,
      startedAtTick: game.currentTick,
      actionState: new Map(),
      status: "running",
    };

    // Update ctx with the new action state
    ctx.actionState = state.currentExecution.actionState;
    action.onStart(ctx);
  }

  // Ensure ctx has the correct actionState reference
  ctx.actionState = state.currentExecution!.actionState;

  // Tick the action
  const result = action.onTick(ctx);

  switch (result.status) {
    case "running":
      return { planCompleted: false, planFailed: false };

    case "completed":
      action.onEnd(ctx, "completed");
      state.currentExecution = null;
      state.currentStepIndex++;

      // Check if plan is now complete
      if (state.currentStepIndex >= plan.steps.length) {
        state.currentPlan = null;
        state.currentStepIndex = 0;
        return { planCompleted: true, planFailed: false };
      }
      return { planCompleted: false, planFailed: false };

    case "failed":
      action.onEnd(ctx, "failed");
      state.currentPlan = null;
      state.currentStepIndex = 0;
      state.currentExecution = null;
      return { planCompleted: false, planFailed: true, failReason: result.reason };
  }
}

/** Cancel the current plan and clean up execution state. */
export function invalidatePlan(
  npcId: string,
  state: NpcAutonomyState,
  registry: ActionRegistry,
  game: GameLoopInterface,
  entityManager: EntityManagerInterface,
  _reason: string,
): void {
  if (state.currentExecution && state.currentPlan) {
    const step = state.currentPlan.steps[state.currentStepIndex];
    const action = step ? registry.get(step.actionId) : undefined;
    if (action) {
      const ctx = buildExecutionContext(npcId, state, game, entityManager);
      ctx.actionState = state.currentExecution.actionState;
      action.onEnd(ctx, "interrupted");
    }
  }
  state.currentPlan = null;
  state.currentStepIndex = 0;
  state.currentExecution = null;
}

function buildExecutionContext(
  npcId: string,
  state: NpcAutonomyState,
  game: GameLoopInterface,
  entityManager: EntityManagerInterface,
  targetPosition?: { x: number; y: number },
): ExecutionContext {
  return {
    npcId,
    game,
    entityManager,
    inventory: state.inventory,
    needs: state.needs,
    currentTick: game.currentTick,
    actionState: state.currentExecution?.actionState ?? new Map(),
    targetPosition,
  };
}
