import type {
  NpcAutonomyDebugPlan,
  NpcAutonomyDebugState,
} from "../autonomy/types.js";
import type { Conversation } from "../engine/conversation.js";
import type { PublicPlayer } from "../network/publicPlayer.js";

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

export interface DebugFeedEventPayload {
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

export interface DebugFeedEvent extends DebugFeedEventPayload {
  id: number;
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
