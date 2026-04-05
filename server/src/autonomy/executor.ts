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

export interface ExecutorTransition {
  type: "action_started" | "action_completed" | "action_failed";
  actionId: string;
  stepIndex: number;
  reason?: string;
}

export interface ExecutorTickResult {
  planCompleted: boolean;
  planFailed: boolean;
  failReason?: string;
  transitions: ExecutorTransition[];
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
  const transitions: ExecutorTransition[] = [];
  if (!state.currentPlan) {
    return { planCompleted: false, planFailed: false, transitions };
  }

  const plan = state.currentPlan;

  // Check plan expiry
  if (game.currentTick - plan.createdAtTick > PLAN_EXPIRY_TICKS) {
    invalidatePlan(npcId, state, registry, game, entityManager, "Plan expired");
    return {
      planCompleted: false,
      planFailed: true,
      failReason: "Plan expired",
      transitions,
    };
  }

  // If we've executed all steps, plan is done
  if (state.currentStepIndex >= plan.steps.length) {
    clearCurrentPlanState(state);
    return { planCompleted: true, planFailed: false, transitions };
  }

  const step = plan.steps[state.currentStepIndex];
  const action = registry.get(step.actionId);
  if (!action) {
    invalidatePlan(
      npcId,
      state,
      registry,
      game,
      entityManager,
      `Unknown action: ${step.actionId}`,
    );
    return {
      planCompleted: false,
      planFailed: true,
      failReason: `Unknown action: ${step.actionId}`,
      transitions,
    };
  }

  // Start new action execution if needed
  if (
    !state.currentExecution ||
    state.currentExecution.actionId !== step.actionId
  ) {
    const actionState = new Map<string, unknown>();
    const startCtx = buildExecutionContext(
      npcId,
      state,
      game,
      entityManager,
      step.targetPosition,
      actionState,
    );

    // Validate before starting
    const error = action.validate(startCtx);
    if (error) {
      invalidatePlan(npcId, state, registry, game, entityManager, error);
      return { planCompleted: false, planFailed: true, failReason: error };
    }

    state.currentExecution = {
      actionId: step.actionId,
      startedAtTick: game.currentTick,
      actionState,
      status: "running",
    };
    transitions.push({
      type: "action_started",
      actionId: step.actionId,
      stepIndex: state.currentStepIndex,
    });

    action.onStart(startCtx);
  }

  const ctx = buildExecutionContext(
    npcId,
    state,
    game,
    entityManager,
    step.targetPosition,
    state.currentExecution?.actionState ?? new Map(),
  );

  // Tick the action
  const result = action.onTick(ctx);

  switch (result.status) {
    case "running":
      return { planCompleted: false, planFailed: false, transitions };

    case "completed":
      action.onEnd(ctx, "completed");
      transitions.push({
        type: "action_completed",
        actionId: step.actionId,
        stepIndex: state.currentStepIndex,
      });
      state.currentExecution = null;
      state.currentStepIndex++;

      // Check if plan is now complete
      if (state.currentStepIndex >= plan.steps.length) {
        state.currentPlan = null;
        state.currentPlanSource = null;
        state.currentPlanReasoning = null;
        state.currentStepIndex = 0;
        return { planCompleted: true, planFailed: false, transitions };
      }
      return { planCompleted: false, planFailed: false, transitions };

    case "failed":
      action.onEnd(ctx, "failed");
      transitions.push({
        type: "action_failed",
        actionId: step.actionId,
        stepIndex: state.currentStepIndex,
        reason: result.reason,
      });
      clearCurrentPlanState(state);
      return {
        planCompleted: false,
        planFailed: true,
        failReason: result.reason,
        transitions,
      };
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
  clearCurrentPlanState(state);
}

function clearCurrentPlanState(state: NpcAutonomyState): void {
  state.currentPlan = null;
  state.currentPlanSource = null;
  state.currentPlanReasoning = null;
  state.currentStepIndex = 0;
  state.currentExecution = null;
  state.goalSelectionStartedAtTick = null;
}

function buildExecutionContext(
  npcId: string,
  state: NpcAutonomyState,
  game: GameLoopInterface,
  entityManager: EntityManagerInterface,
  targetPosition?: { x: number; y: number },
  actionState: Map<string, unknown> = state.currentExecution?.actionState ?? new Map(),
): ExecutionContext {
  return {
    npcId,
    game,
    entityManager,
    inventory: state.inventory,
    needs: state.needs,
    currentTick: game.currentTick,
    actionState,
    targetPosition,
  };
}
