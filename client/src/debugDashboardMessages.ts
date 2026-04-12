import {
  appendConversationMessage,
  upsertConversationSnapshot,
} from "./conversationDebugState.js";
import {
  appendRoomMessageSnapshot,
  upsertRoomFromConversationSnapshot,
  upsertRoomSnapshot,
} from "./conversationRooms.js";
import type { DashboardState } from "./debugDashboardTypes.js";
import type {
  DebugActionDefinition,
  DebugFeedEvent,
  NpcAutonomyDebugPlan,
  NpcAutonomyDebugState,
  Player,
  ServerMessage,
} from "./types.js";

export interface DashboardMessageContext {
  state: DashboardState;
  deadNpcIds: Set<string>;
  npcNameCache: Map<string, string>;
  lastKnownPlans: Map<string, NpcAutonomyDebugPlan>;
  expandedActions: Set<string>;
  actionDefs: Record<string, DebugActionDefinition>;
  nextSyntheticEventId: number;
  syncPlayers: (players: readonly Player[]) => void;
  pushEvent: (event: DebugFeedEvent) => void;
  refreshScreenshotUrl: (clientId?: string) => void;
}

export interface DashboardMessageResult {
  actionDefs: Record<string, DebugActionDefinition>;
  nextSyntheticEventId: number;
  isImmediate: boolean;
}

export function applyDashboardMessage(
  context: DashboardMessageContext,
  message: ServerMessage,
  receivedAt = Date.now(),
): DashboardMessageResult {
  context.state.lastMessageAt = receivedAt;
  let nextSyntheticEventId = context.nextSyntheticEventId;
  let actionDefs = context.actionDefs;

  switch (message.type) {
    case "state":
      context.state.tick = message.data.tick;
      context.syncPlayers(message.data.players);
      break;
    case "tick":
      context.state.tick = message.data.tick;
      break;
    case "player_joined":
    case "player_update":
      context.state.players.set(message.data.id, { ...message.data });
      if (message.data.isNpc) {
        context.npcNameCache.set(message.data.id, message.data.name);
      }
      break;
    case "player_left":
      if (
        message.data.reason === "death" &&
        context.state.autonomy.has(message.data.id)
      ) {
        context.deadNpcIds.add(message.data.id);
      } else {
        context.deadNpcIds.delete(message.data.id);
      }
      context.state.players.delete(message.data.id);
      break;
    case "debug_bootstrap":
      context.state.tick = message.data.tick;
      context.syncPlayers(message.data.players);
      context.state.conversations = [...message.data.conversations];
      context.state.conversationRooms = [...message.data.conversationRooms];
      context.state.autonomy = new Map(
        Object.entries(message.data.autonomyStates),
      );
      context.state.system = message.data.system;
      context.lastKnownPlans.clear();
      context.deadNpcIds.clear();
      for (const [npcId, autonomyState] of context.state.autonomy) {
        context.npcNameCache.set(npcId, autonomyState.name);
        if (autonomyState.currentPlan) {
          context.lastKnownPlans.set(npcId, autonomyState.currentPlan);
        }
        if (autonomyState.isDead) {
          context.deadNpcIds.add(npcId);
        }
      }
      actionDefs = message.data.actionDefinitions ?? {};
      context.state.events = [...message.data.recentEvents];
      context.refreshScreenshotUrl(
        message.data.system.lastScreenshot?.clientId,
      );
      context.expandedActions.clear();
      break;
    case "debug_conversation_upsert":
      context.state.conversations = upsertConversationSnapshot(
        context.state.conversations,
        message.data,
      ).conversations;
      context.state.conversationRooms = upsertRoomFromConversationSnapshot(
        context.state.conversationRooms,
        message.data,
      );
      break;
    case "debug_conversation_message":
      context.state.conversations = appendConversationMessage(
        context.state.conversations,
        message.data,
      );
      {
        const updatedConversation = context.state.conversations.find(
          (conversation) => conversation.id === message.data.convoId,
        );
        if (updatedConversation) {
          context.state.conversationRooms = upsertRoomFromConversationSnapshot(
            context.state.conversationRooms,
            updatedConversation,
          );
        }
      }
      break;
    case "debug_conversation_room_message":
      context.state.conversationRooms = appendRoomMessageSnapshot(
        context.state.conversationRooms,
        message.data,
      );
      break;
    case "debug_conversation_room_upsert":
      context.state.conversationRooms = upsertRoomSnapshot(
        context.state.conversationRooms,
        message.data,
      );
      break;
    case "debug_autonomy_upsert":
      context.npcNameCache.set(message.data.npcId, message.data.name);
      if (message.data.currentPlan) {
        context.lastKnownPlans.set(
          message.data.npcId,
          message.data.currentPlan,
        );
      }
      if (message.data.isDead) {
        context.deadNpcIds.add(message.data.npcId);
      } else {
        context.deadNpcIds.delete(message.data.npcId);
      }
      context.state.autonomy.set(message.data.npcId, message.data);
      break;
    case "debug_autonomy_remove":
      context.deadNpcIds.delete(message.data.npcId);
      context.state.autonomy.delete(message.data.npcId);
      context.lastKnownPlans.delete(message.data.npcId);
      break;
    case "debug_event":
      context.pushEvent(message.data);
      if (message.data.subjectType === "npc" && message.data.plan) {
        context.lastKnownPlans.set(message.data.subjectId, message.data.plan);
      }
      break;
    case "error":
      context.pushEvent({
        id: nextSyntheticEventId--,
        tick: context.state.tick,
        type: "error",
        severity: "error",
        subjectType: "system",
        subjectId: "dashboard",
        title: "Client error",
        message: message.data.message,
      });
      break;
    default:
      break;
  }

  const isImmediate =
    message.type === "debug_bootstrap" ||
    message.type === "error" ||
    (message.type === "debug_autonomy_remove" &&
      message.data.npcId === context.state.selectedNpcId) ||
    (message.type === "debug_conversation_upsert" &&
      message.data.id === context.state.selectedConversationId) ||
    (message.type === "debug_conversation_room_upsert" &&
      message.data.id === context.state.selectedConversationId) ||
    (message.type === "debug_conversation_message" &&
      message.data.convoId === context.state.selectedConversationId) ||
    (message.type === "debug_conversation_room_message" &&
      message.data.roomId === context.state.selectedConversationId);

  return {
    actionDefs,
    nextSyntheticEventId,
    isImmediate,
  };
}
