// Mirrors server types

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
  x: number;
  y: number;
  targetX?: number;
  targetY?: number;
  orientation: Orientation;
  speed: number;
  state: PlayerState;
  currentConvoId?: number;
  vx: number;
  vy: number;
  moveSpeed: number;
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

export interface Conversation {
  id: number;
  player1Id: string;
  player2Id: string;
  state: string;
  messages: Message[];
}

export interface FullGameState {
  tick: number;
  world: { width: number; height: number };
  players: Player[];
  conversations: Conversation[];
  activities: Activity[];
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
  | { type: "error"; data: { message: string } };

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
  | { type: "end_convo" }
  | { type: "ping" };
