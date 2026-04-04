/**
 * Core types for the NPC autonomy system (GOAP-based).
 *
 * All autonomy state lives here — NOT on the engine's Player type.
 * The autonomy system reads Player state and drives behavior by
 * enqueuing commands on the GameLoop.
 */
import type { Position } from "../engine/types.js";

// ---------------------------------------------------------------------------
// Needs / Drives
// ---------------------------------------------------------------------------

export interface NpcNeeds {
  hunger: number; // 0 = starving, 100 = full
  energy: number; // 0 = exhausted, 100 = rested
  social: number; // 0 = lonely, 100 = fulfilled
  safety: number; // 0 = terrified, 100 = secure
  curiosity: number; // 0 = bored, 100 = stimulated
}

export type NeedType = keyof NpcNeeds;

export interface NeedConfig {
  decayPerTick: number;
  urgencyThreshold: number;
  criticalThreshold: number;
  initialValue: number;
}

export const DEFAULT_NEED_CONFIGS: Record<NeedType, NeedConfig> = {
  hunger: {
    decayPerTick: 0.008,
    urgencyThreshold: 40,
    criticalThreshold: 15,
    initialValue: 80,
  },
  energy: {
    decayPerTick: 0.005,
    urgencyThreshold: 30,
    criticalThreshold: 10,
    initialValue: 90,
  },
  social: {
    decayPerTick: 0.01,
    urgencyThreshold: 35,
    criticalThreshold: 15,
    initialValue: 70,
  },
  safety: {
    decayPerTick: 0.0,
    urgencyThreshold: 50,
    criticalThreshold: 20,
    initialValue: 100,
  },
  curiosity: {
    decayPerTick: 0.006,
    urgencyThreshold: 25,
    criticalThreshold: 10,
    initialValue: 60,
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
  entityManager: EntityManagerInterface;
  npcPosition: Position;
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
  onEnd(ctx: ExecutionContext, reason: "completed" | "failed" | "interrupted"): void;
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
  currentStepIndex: number;
  currentExecution: ActionExecution | null;
  lastPlanTick: number;
  lastGoalSelectionTick: number;
  consecutivePlanFailures: number;
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
  enqueue(command: unknown): void;
  getPlayer(id: string): { x: number; y: number; state: string; isNpc: boolean; id: string } | undefined;
  getPlayers(): { x: number; y: number; state: string; isNpc: boolean; id: string }[];
  setPlayerTarget(playerId: string, x: number, y: number): Position[] | null;
}

export interface EntityManagerInterface {
  get(id: string): WorldEntity | undefined;
  getByType(type: string): WorldEntity[];
  getAt(position: Position): WorldEntity[];
  getNearby(position: Position, radius: number, type?: string): WorldEntity[];
}
