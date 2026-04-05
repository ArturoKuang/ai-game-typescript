import type { NpcAutonomyDebugState } from "../autonomy/types.js";
import type { Conversation } from "../engine/conversation.js";
import type { Player } from "../engine/types.js";

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
  relatedConversationId?: number;
  relatedNpcId?: string;
}

export interface DebugFeedEvent extends DebugFeedEventPayload {
  id: number;
}

export interface DebugDashboardBootstrap {
  tick: number;
  players: Player[];
  conversations: Conversation[];
  autonomyStates: Record<string, NpcAutonomyDebugState>;
  recentEvents: DebugFeedEvent[];
}
