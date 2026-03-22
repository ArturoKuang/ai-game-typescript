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

export interface GameEvent {
  tick: number;
  type: string;
  playerId?: string;
  data?: Record<string, unknown>;
}

export interface TickResult {
  tick: number;
  events: GameEvent[];
}

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
