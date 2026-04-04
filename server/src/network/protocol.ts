/**
 * WebSocket message types exchanged between server and browser client.
 *
 * Both ServerMessage and ClientMessage are discriminated unions keyed on `type`.
 * The server sends a full `state` snapshot on connect, then streams incremental
 * updates (`player_update`, `convo_update`, `message`, etc.) in real time.
 */
import type { Conversation, Message } from "../engine/conversation.js";
import type { Activity, Player } from "../engine/types.js";

// --- Server -> Client ---

/** Serialized world entity for client rendering. */
export interface WorldEntityData {
  id: string;
  type: string;
  x: number;
  y: number;
  properties: Record<string, boolean | number | string>;
  destroyed: boolean;
}

export type ServerMessage =
  | { type: "state"; data: FullGameState }
  | { type: "tick"; data: { tick: number } }
  | { type: "player_update"; data: Player }
  | { type: "player_joined"; data: Player }
  | { type: "player_left"; data: { id: string } }
  | { type: "convo_update"; data: Conversation }
  | { type: "message"; data: Message }
  | { type: "entity_update"; data: WorldEntityData }
  | { type: "entity_removed"; data: { entityId: string } }
  | { type: "combat_event"; data: { eventType: string; [key: string]: unknown } }
  | { type: "inventory_update"; data: { playerId: string; items: Record<string, number>; capacity: number } }
  | { type: "error"; data: { message: string } }
  | { type: "capture_screenshot" };

/**
 * Snapshot sent to a newly connected client.
 *
 * The browser caches this as its local source of truth, then applies the
 * incremental `player_update`, `convo_update`, and `message` stream on top.
 */
export interface FullGameState {
  tick: number;
  world: { width: number; height: number };
  players: Player[];
  conversations: Conversation[];
  activities: Activity[];
  entities?: WorldEntityData[];
}

// --- Client -> Server ---

export type MoveDirection = "up" | "down" | "left" | "right";

export type ClientMessage =
  | { type: "join"; data: { name: string; description?: string } }
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
  | { type: "pickup_nearby" }
  | { type: "eat"; data: { item: string } }
  | { type: "ping" }
  | { type: "screenshot_data"; data: { png: string } };
