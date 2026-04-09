/**
 * Client-side type definitions mirroring the server's protocol and engine types.
 *
 * These are manually kept in sync with `server/src/engine/types.ts` and
 * `server/src/network/protocol.ts`. When the server types change, update
 * this file to match.
 */

export interface Position {
  x: number;
  y: number;
}

export type TileType = "floor" | "wall" | "water";
export type Orientation = "up" | "down" | "left" | "right";
export type PlayerState = "idle" | "walking" | "conversing" | "doing_activity";

export interface PublicPlayer {
  id: string;
  name: string;
  description: string;
  isNpc: boolean;
  isWaitingForResponse?: boolean;
  x: number;
  y: number;
  targetX?: number;
  targetY?: number;
  orientation: Orientation;
  pathSpeed: number;
  state: PlayerState;
  currentConvoId?: number;
  vx: number;
  vy: number;
  inputSpeed: number;
  radius: number;
  hp?: number;
  maxHp?: number;
}

export type Player = PublicPlayer;

export interface Activity {
  id: number;
  name: string;
  description: string;
  x: number;
  y: number;
  emoji: string;
}

export interface Message {
  id: number;
  convoId: number;
  playerId: string;
  content: string;
  tick: number;
}

export type ConvoState = "invited" | "walking" | "active" | "ended";
export type ConversationEndReason =
  | "declined"
  | "manual"
  | "max_duration"
  | "max_messages"
  | "timeout"
  | "missing_player";

export interface Conversation {
  id: number;
  player1Id: string;
  player2Id: string;
  state: ConvoState;
  messages: Message[];
  startedTick: number;
  endedTick?: number;
  endedReason?: ConversationEndReason;
  summary?: string;
}

export type PlanSource = "scripted" | "llm" | "emergency";

export type DebugFeedSeverity = "info" | "warning" | "error";
export type DebugFeedEventType =
  | "conversation_started"
  | "conversation_active"
  | "conversation_ended"
  | "conversation_message"
  | "plan_started"
  | "plan_cleared"
  | "plan_failed"
  | "action_started"
  | "action_completed"
  | "action_failed"
  | "error";
export type DebugFeedSubjectType =
  | "conversation"
  | "npc"
  | "player"
  | "system";

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
  status: "running" | "completed" | "failed" | "interrupted";
  stepIndex: number;
}

export interface NpcAutonomyDebugDeath {
  tick: number;
  reason: "death";
  cause?: string;
  depletedNeed?: "health" | "food" | "water" | "social";
  message: string;
}

export interface SurvivalSnapshot {
  health: number;
  food: number;
  water: number;
  social: number;
}

export interface NpcAutonomyDebugState {
  npcId: string;
  name: string;
  lastPosition?: Position;
  lastState?: string;
  isDead: boolean;
  death?: NpcAutonomyDebugDeath;
  needs: SurvivalSnapshot;
  inventory: Record<string, number>;
  currentPlan: NpcAutonomyDebugPlan | null;
  currentStepIndex: number;
  currentExecution: NpcAutonomyDebugExecution | null;
  consecutivePlanFailures: number;
  goalSelectionInFlight: boolean;
  goalSelectionStartedAtTick: number | null;
}

export interface DebugFeedEvent {
  id: number;
  tick: number;
  type: DebugFeedEventType;
  severity: DebugFeedSeverity;
  subjectType: DebugFeedSubjectType;
  subjectId: string;
  title: string;
  message: string;
  plan?: NpcAutonomyDebugPlan;
  relatedConversationId?: number;
  relatedNpcId?: string;
}

export interface DebugActionDefinition {
  id: string;
  displayName: string;
  preconditions: Record<string, boolean | number | string>;
  effects: Record<string, boolean | number | string>;
  cost: number;
  estimatedDurationTicks: number;
  proximityRequirement?: {
    type: "activity" | "entity" | "position";
    target: string;
    distance?: number;
  };
}

export interface DebugDashboardBootstrap {
  tick: number;
  players: PublicPlayer[];
  conversations: Conversation[];
  autonomyStates: Record<string, NpcAutonomyDebugState>;
  recentEvents: DebugFeedEvent[];
  actionDefinitions: Record<string, DebugActionDefinition>;
}

/** A dynamic world entity (berry bush, bench, etc.) rendered on the map. */
export interface WorldEntity {
  id: string;
  type: string;
  x: number;
  y: number;
  properties: Record<string, boolean | number | string>;
  destroyed: boolean;
}

export interface FullGameState {
  tick: number;
  /** Static world bounds; the client fetches tiles separately from `/data/map.json`. */
  world: { width: number; height: number };
  /** Denormalized player cache used by `main.ts`, `renderer.ts`, and `ui.ts`. */
  players: PublicPlayer[];
  /** Active and historical conversations streamed from the server. */
  conversations: Conversation[];
  /** Map activities mirrored from the server snapshot for sidebar/rendering use. */
  activities: Activity[];
  /** Dynamic world entities from the autonomy system. */
  entities?: WorldEntity[];
}

/** NPC needs data for client-side visualization. */
export interface NpcNeedsData {
  npcId: string;
  health: number;
  food: number;
  water: number;
  social: number;
}

/** Player survival data for the local sidebar display. */
export interface PlayerSurvivalData {
  playerId: string;
  health: number;
  food: number;
  water: number;
  social: number;
}

export interface PlayerLeftData {
  id: string;
  reason?: "death";
  cause?: string;
  depletedNeed?: "health" | "food" | "water" | "social";
}

// Server -> Client
export type ServerMessage =
  | { type: "state"; data: FullGameState }
  | { type: "tick"; data: { tick: number } }
  | { type: "player_update"; data: PublicPlayer }
  | { type: "player_joined"; data: PublicPlayer }
  | { type: "player_left"; data: PlayerLeftData }
  | { type: "convo_update"; data: Conversation }
  | { type: "message"; data: Message }
  | { type: "entity_update"; data: WorldEntity }
  | { type: "entity_removed"; data: { entityId: string } }
  | { type: "npc_needs"; data: NpcNeedsData }
  | { type: "player_survival"; data: PlayerSurvivalData }
  | { type: "combat_event"; data: { eventType: string; [key: string]: unknown } }
  | { type: "inventory_update"; data: { playerId: string; items: Record<string, number>; capacity: number } }
  | { type: "debug_bootstrap"; data: DebugDashboardBootstrap }
  | { type: "debug_conversation_upsert"; data: Conversation }
  | { type: "debug_conversation_message"; data: Message }
  | { type: "debug_autonomy_upsert"; data: NpcAutonomyDebugState }
  | { type: "debug_event"; data: DebugFeedEvent }
  | { type: "error"; data: { message: string } }
  | { type: "capture_screenshot" };

// Client -> Server
export type MoveDirection = "up" | "down" | "left" | "right";

export type ClientMessage =
  | { type: "join"; data: { name: string; description?: string } }
  | { type: "subscribe_debug" }
  | { type: "move"; data: { x: number; y: number } }
  | { type: "move_direction"; data: { direction: MoveDirection } }
  | { type: "input_start"; data: { direction: MoveDirection } }
  | { type: "input_stop"; data: { direction: MoveDirection } }
  | { type: "say"; data: { content: string } }
  | { type: "start_convo"; data: { targetId: string } }
  | { type: "accept_convo"; data: { convoId: number } }
  | { type: "decline_convo"; data: { convoId: number } }
  | { type: "end_convo" }
  | { type: "attack"; data: { targetBearId: string } }
  | { type: "pickup"; data: { entityId: string } }
  | { type: "eat"; data: { item: string } }
  | { type: "pickup_nearby" }
  | { type: "ping" }
  | { type: "screenshot_data"; data: { png: string } };
