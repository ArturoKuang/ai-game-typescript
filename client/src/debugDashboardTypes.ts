import type {
  Conversation,
  ConversationRoom,
  DebugFeedEvent,
  DebugSystemSnapshot,
  NpcAutonomyDebugState,
  PublicPlayer,
} from "./types.js";

export type ActivitySeverityFilter = "all" | "danger" | "warning" | "info";
export type AlertSeverity = "warning" | "danger";
export type CommandStatusKind = "idle" | "running" | "success" | "error";

export interface DashboardAlert {
  id: string;
  severity: AlertSeverity;
  title: string;
  message: string;
  ageTicks: number;
  targetConversationId?: number;
  targetNpcId?: string;
}

export interface FrozenActivityState {
  alerts: DashboardAlert[];
  events: DebugFeedEvent[];
  capturedAt: number;
}

export interface CommandStatus {
  kind: CommandStatusKind;
  message: string;
  at: number | null;
}

export interface DashboardState {
  connected: boolean;
  tick: number;
  players: Map<string, PublicPlayer>;
  conversations: Conversation[];
  conversationRooms: ConversationRoom[];
  autonomy: Map<string, NpcAutonomyDebugState>;
  events: DebugFeedEvent[];
  system: DebugSystemSnapshot | null;
  selectedConversationId: number | null;
  selectedNpcId: string | null;
  activeTab: "conversations" | "npcs" | "activity" | "system";
  conversationFilter: "all" | "active" | "ended";
  activitySeverityFilter: ActivitySeverityFilter;
  activitySearch: string;
  activityPaused: boolean;
  frozenActivity: FrozenActivityState | null;
  pinnedItems: Set<string>;
  lastMessageAt: number | null;
  disconnectedAt: number | null;
  reconnectCount: number;
  debugToken: string | null;
  commandStatus: CommandStatus;
  screenshotUrl: string | null;
  scenarios: string[];
}
