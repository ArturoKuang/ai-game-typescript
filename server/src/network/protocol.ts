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

export type ServerMessage =
  | { type: "state"; data: FullGameState }
  | { type: "tick"; data: { tick: number } }
  | { type: "player_update"; data: Player }
  | { type: "player_joined"; data: Player }
  | { type: "player_left"; data: { id: string } }
  | { type: "convo_update"; data: Conversation }
  | { type: "message"; data: Message }
  | { type: "error"; data: { message: string } };

/** Snapshot sent to a newly connected client. */
export interface FullGameState {
  tick: number;
  world: { width: number; height: number };
  players: Player[];
  conversations: Conversation[];
  activities: Activity[];
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
  | { type: "ping" };
