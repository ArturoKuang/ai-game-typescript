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
  | { type: "end_convo" }
  | { type: "ping" };
