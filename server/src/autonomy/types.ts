/**
 * Core types for the NPC autonomy system (GOAP-based).
 *
 * All autonomy state lives here — NOT on the engine's Player type.
 * The autonomy system reads Player state and drives behavior by
 * enqueuing commands on the GameLoop.
 */
import type { Command, Position } from "../engine/types.js";

// ---------------------------------------------------------------------------
// Needs / Drives
// ---------------------------------------------------------------------------

export interface NpcNeeds {
  food: number; // 0 = starving, 100 = full
  water: number; // 0 = dehydrated, 100 = hydrated
  social: number; // 0 = isolated, 100 = fulfilled
}

export type NeedType = keyof NpcNeeds;

export interface SurvivalSnapshot extends NpcNeeds {
  health: number; // 0 = downed, 100 = full health
}

export interface NeedConfig {
  decayPerTick: number;
  urgencyThreshold: number;
  criticalThreshold: number;
  initialValue: number;
}

export const DEFAULT_NEED_CONFIGS: Record<NeedType, NeedConfig> = {
  food: {
    decayPerTick: 0.008,
    urgencyThreshold: 40,
    criticalThreshold: 15,
    initialValue: 80,
  },
  water: {
    decayPerTick: 0.012,
    urgencyThreshold: 45,
    criticalThreshold: 20,
    initialValue: 85,
  },
  social: {
    decayPerTick: 0.01,
    urgencyThreshold: 35,
    criticalThreshold: 15,
    initialValue: 70,
  },
};

// ---------------------------------------------------------------------------
// GOAP World State
// ---------------------------------------------------------------------------

export type PredicateValue = boolean | number | string;
export type WorldState = Map<string, PredicateValue>;

// ---------------------------------------------------------------------------
// Action System
// ---------------------------------------------------------------------------

export interface PlanningContext {
  npcId: string;
  currentState: WorldState;
  world: {
    isWalkable(x: number, y: number): boolean;
  };
  entityManager: EntityManagerInterface;
  npcPosition: Position;
  otherPlayers: Array<{
    id: string;
    x: number;
    y: number;
    state: string;
    isNpc: boolean;
  }>;
}

export interface ExecutionContext {
  npcId: string;
  game: GameLoopInterface;
  entityManager: EntityManagerInterface;
  inventory: NpcInventory;
  needs: NpcNeeds;
  currentTick: number;
  actionState: Map<string, unknown>;
  targetPosition?: Position;
}

export type ActionTickResult =
  | { status: "running" }
  | { status: "completed" }
  | { status: "failed"; reason: string };

export interface ActionDefinition {
  id: string;
  displayName: string;

  // GOAP planner fields
  preconditions: WorldState;
  effects: WorldState;
  cost: number | ((ctx: PlanningContext) => number);
  estimatedDurationTicks: number;

  // Auto-insert goto before this action if NPC isn't close enough
  proximityRequirement?: {
    type: "activity" | "entity" | "position";
    target: string; // entity type or activity name
    distance?: number; // default 1
  };

  // Executor lifecycle hooks
  validate(ctx: ExecutionContext): string | null; // null = valid
  onStart(ctx: ExecutionContext): void;
  onTick(ctx: ExecutionContext): ActionTickResult;
  onEnd(
    ctx: ExecutionContext,
    reason: "completed" | "failed" | "interrupted",
  ): void;
}

// ---------------------------------------------------------------------------
// Plan
// ---------------------------------------------------------------------------

export interface PlannedStep {
  actionId: string;
  targetPosition?: Position;
}

export interface Plan {
  goalId: string;
  steps: PlannedStep[];
  totalCost: number;
  createdAtTick: number;
}

export type PlanSource = "scripted" | "llm" | "emergency";

// ---------------------------------------------------------------------------
// Inventory
// ---------------------------------------------------------------------------

export type NpcInventory = Map<string, number>;

// ---------------------------------------------------------------------------
// Entity System
// ---------------------------------------------------------------------------

export interface WorldEntity {
  id: string;
  type: string;
  position: Position;
  properties: Record<string, PredicateValue>;
  destroyed: boolean;
}

// ---------------------------------------------------------------------------
// Per-NPC Autonomy State
// ---------------------------------------------------------------------------

export interface ActionExecution {
  actionId: string;
  startedAtTick: number;
  actionState: Map<string, unknown>;
  status: "running" | "completed" | "failed" | "interrupted";
}

export interface NpcAutonomyState {
  needs: NpcNeeds;
  inventory: NpcInventory;
  currentPlan: Plan | null;
  currentPlanSource: PlanSource | null;
  currentPlanReasoning: string | null;
  currentStepIndex: number;
  currentExecution: ActionExecution | null;
  lastPlanTick: number;
  lastGoalSelectionTick: number;
  consecutivePlanFailures: number;
  goalSelectionStartedAtTick: number | null;
}

export interface NpcAutonomyDebugPlanStep {
  index: number;
  actionId: string;
  actionLabel: string;
  targetPosition?: Position;
  isCurrent: boolean;
}

export interface NpcAutonomyDebugPlan {
  goalId: string;
  totalCost: number;
  createdAtTick: number;
  source: PlanSource;
  llmGenerated: boolean;
  reasoning?: string;
  steps: NpcAutonomyDebugPlanStep[];
}

export interface NpcAutonomyDebugExecution {
  actionId: string;
  actionLabel: string;
  startedAtTick: number;
  status: ActionExecution["status"];
  stepIndex: number;
}

export interface NpcAutonomyDebugState {
  npcId: string;
  needs: SurvivalSnapshot;
  inventory: Record<string, number>;
  currentPlan: NpcAutonomyDebugPlan | null;
  currentStepIndex: number;
  currentExecution: NpcAutonomyDebugExecution | null;
  consecutivePlanFailures: number;
  goalSelectionInFlight: boolean;
  goalSelectionStartedAtTick: number | null;
}

// ---------------------------------------------------------------------------
// Goal Selection
// ---------------------------------------------------------------------------

export interface GoalOption {
  id: string;
  description: string;
}

// ---------------------------------------------------------------------------
// Minimal interfaces to avoid circular imports
// ---------------------------------------------------------------------------

export interface GameLoopInterface {
  readonly currentTick: number;
  enqueue(command: Command): void;
  getPlayer(
    id: string,
  ):
    | { x: number; y: number; state: string; isNpc: boolean; id: string }
    | undefined;
  getPlayers(): {
    x: number;
    y: number;
    state: string;
    isNpc: boolean;
    id: string;
  }[];
  setPlayerTarget(playerId: string, x: number, y: number): Position[] | null;
}

export interface EntityManagerInterface {
  get(id: string): WorldEntity | undefined;
  getByType(type: string): WorldEntity[];
  getAt(position: Position): WorldEntity[];
  getNearby(position: Position, radius: number, type?: string): WorldEntity[];
}
