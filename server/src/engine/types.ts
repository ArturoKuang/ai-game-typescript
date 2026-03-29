export interface Position {
  x: number;
  y: number;
}

export type TileType = "floor" | "wall" | "water";

export interface Tile {
  type: TileType;
  activityId?: number;
}

export type Orientation = "up" | "down" | "left" | "right";
export type PlayerState = "idle" | "walking" | "conversing" | "doing_activity";

export interface Player {
  id: string;
  name: string;
  description: string;
  personality?: string;
  isNpc: boolean;
  isWaitingForResponse?: boolean;
  x: number;
  y: number;
  targetX?: number;
  targetY?: number;
  path?: Position[];
  pathIndex?: number;
  orientation: Orientation;
  speed: number;
  state: PlayerState;
  currentActivityId?: number;
  currentConvoId?: number;
  vx: number;
  vy: number;
  inputX: number;
  inputY: number;
  radius: number;
  moveSpeed: number;
}

export interface Activity {
  id: number;
  name: string;
  description: string;
  x: number;
  y: number;
  capacity: number;
  emoji: string;
}

// --- Game Events ---

export type GameEventType =
  | "spawn"
  | "despawn"
  | "input_state"
  | "move_start"
  | "move_cancelled"
  | "move_end"
  | "move_direction"
  | "player_update"
  | "player_collision"
  | "convo_accepted"
  | "convo_active"
  | "convo_ended"
  | "convo_started"
  | "convo_message"
  | "input_move"
  | "tick_complete";

export interface GameEvent {
  tick: number;
  type: GameEventType;
  playerId?: string;
  data?: Record<string, unknown>;
}

export interface TickResult {
  tick: number;
  events: GameEvent[];
}

// --- Commands (inputs to the game loop) ---

export type Command =
  | {
      type: "spawn";
      playerId: string;
      data: {
        name: string;
        x: number;
        y: number;
        isNpc?: boolean;
        description?: string;
        personality?: string;
        speed?: number;
      };
    }
  | {
      type: "remove";
      playerId: string;
    }
  | {
      type: "move_to";
      playerId: string;
      data: { x: number; y: number };
    }
  | {
      type: "move_direction";
      playerId: string;
      data: { direction: Orientation };
    }
  | {
      type: "start_convo";
      playerId: string;
      data: { targetId: string };
    }
  | {
      type: "end_convo";
      playerId: string;
      data: { convoId: number };
    }
  | {
      type: "say";
      playerId: string;
      data: { convoId: number; content: string };
    };

export interface MapData {
  width: number;
  height: number;
  tiles: TileType[][];
  activities: Activity[];
  spawnPoints: Position[];
}

export interface CharacterDef {
  id: string;
  name: string;
  description: string;
  personality: string;
  spawnPoint: Position;
  emoji: string;
}
