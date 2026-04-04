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

export interface Player {
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
}

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
  players: Player[];
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
  hunger: number;
  energy: number;
  social: number;
  safety: number;
  curiosity: number;
}

// Server -> Client
export type ServerMessage =
  | { type: "state"; data: FullGameState }
  | { type: "tick"; data: { tick: number } }
  | { type: "player_update"; data: Player }
  | { type: "player_joined"; data: Player }
  | { type: "player_left"; data: { id: string } }
  | { type: "convo_update"; data: Conversation }
  | { type: "message"; data: Message }
  | { type: "entity_update"; data: WorldEntity }
  | { type: "entity_removed"; data: { entityId: string } }
  | { type: "npc_needs"; data: NpcNeedsData }
  | { type: "combat_event"; data: { eventType: string; [key: string]: unknown } }
  | { type: "inventory_update"; data: { playerId: string; items: Record<string, number>; capacity: number } }
  | { type: "error"; data: { message: string } }
  | { type: "capture_screenshot" };

// Client -> Server
export type MoveDirection = "up" | "down" | "left" | "right";

export type ClientMessage =
  | { type: "join"; data: { name: string } }
  | { type: "move"; data: { x: number; y: number } }
  | { type: "move_direction"; data: { direction: MoveDirection } }
  | { type: "input_start"; data: { direction: MoveDirection } }
  | { type: "input_stop"; data: { direction: MoveDirection } }
  | { type: "say"; data: { content: string } }
  | { type: "start_convo"; data: { targetId: string } }
  | { type: "accept_convo"; data: { convoId: number } }
  | { type: "decline_convo"; data: { convoId: number } }
  | { type: "end_convo" }
  | { type: "pickup_nearby" }
  | { type: "ping" }
  | { type: "screenshot_data"; data: { png: string } };
