/**
 * Core data models shared across the engine.
 *
 * All gameplay state—players, tiles, events, commands—is defined here so
 * that every engine module works against a single source of truth.
 */

export interface Position {
  x: number;
  y: number;
}

/** Determines walkability: floor is passable; wall and water are not. */
export type TileType = "floor" | "wall" | "water";

export interface Tile {
  type: TileType;
  /** If set, an activity occupies this tile (see {@link Activity}). */
  activityId?: number;
}

export type Orientation = "up" | "down" | "left" | "right";

/**
 * Player state machine:
 * - idle:           standing still, available for conversations
 * - walking:        following a path or moving via held input
 * - conversing:     locked in an active conversation (movement blocked)
 * - doing_activity: interacting with a map activity
 */
export type PlayerState = "idle" | "walking" | "conversing" | "doing_activity";

/**
 * The full mutable state of a player (human or NPC) within the simulation.
 *
 * Movement is driven by two mutually-exclusive systems:
 * 1. **Path following** — A* sets `path`/`pathIndex`/`targetX`/`targetY`.
 *    The player moves along waypoints at `pathSpeed` tiles per tick.
 * 2. **Held input** — WASD keys set `inputX`/`inputY`, producing velocity
 *    (`vx`/`vy`) at `inputSpeed` tiles per second, resolved with collision.
 */
export interface Player {
  id: string;
  name: string;
  description: string;
  personality?: string;
  isNpc: boolean;
  /** True while the NPC model is generating a reply (shows "..." bubble). */
  isWaitingForResponse?: boolean;

  // --- Position & movement ---
  x: number;
  y: number;
  /** A* destination tile X (set by click-to-move or conversation rendezvous). */
  targetX?: number;
  /** A* destination tile Y. */
  targetY?: number;
  /** Waypoints computed by A*; consumed one-by-one during path movement. */
  path?: Position[];
  /** Current index into `path`. */
  pathIndex?: number;
  orientation: Orientation;
  /** Tiles per tick when following an A* path. */
  pathSpeed: number;
  state: PlayerState;
  currentActivityId?: number;
  currentConvoId?: number;
  /** Current X velocity (tiles/sec) — set by input movement. */
  vx: number;
  /** Current Y velocity (tiles/sec) — set by input movement. */
  vy: number;
  /** Raw directional input: -1 (left/up), 0, or 1 (right/down). */
  inputX: number;
  /** Raw directional input: -1 (up), 0, or 1 (down). */
  inputY: number;
  /** AABB collision half-extent (default 0.4). */
  radius: number;
  /** Tiles per second when moving via keyboard input. */
  inputSpeed: number;

  // --- Health ---
  /** Current hit points. Undefined means full health (backwards-compatible). */
  hp?: number;
  /** Maximum hit points. Undefined defaults to PLAYER_DEFAULT_HP (100). */
  maxHp?: number;
}

/** A point-of-interest on the map that players can interact with. */
export interface Activity {
  id: number;
  name: string;
  description: string;
  x: number;
  y: number;
  /** How many players can use this activity simultaneously. */
  capacity: number;
  emoji: string;
}

// --- Game Events ---

/** Discriminated union of all event types emitted by the engine per tick. */
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
  | "convo_declined"
  | "convo_ended"
  | "convo_started"
  | "convo_message"
  | "input_move"
  | "tick_complete"
  | "bear_spawn"
  | "bear_death"
  | "bear_attack"
  | "player_attack"
  | "player_damage"
  | "player_death"
  | "player_heal"
  | "item_consumed"
  | "item_drop"
  | "item_pickup";

/** A single event produced during a tick, logged and optionally broadcast. */
export interface GameEvent {
  tick: number;
  type: GameEventType;
  playerId?: string;
  data?: Record<string, unknown>;
}

/** Return value of `GameLoop.tick()` — the tick number and all events emitted. */
export interface TickResult {
  tick: number;
  events: GameEvent[];
}

// --- Commands (inputs to the game loop) ---

/**
 * Discriminated union of commands that can be enqueued for the game loop.
 * Commands are processed at the start of each tick in FIFO order.
 */
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
      type: "accept_convo";
      playerId: string;
      data: { convoId: number };
    }
  | {
      type: "decline_convo";
      playerId: string;
      data: { convoId: number };
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
    }
  | {
      type: "attack";
      playerId: string;
      data: { targetId: string };
    }
  | {
      type: "pickup";
      playerId: string;
      data: { entityId: string };
    }
  | {
      type: "eat";
      playerId: string;
      data: { item: string };
    };

/** Entity definition in map data — spawned by EntityManager at boot. */
export interface MapEntityDef {
  type: string;
  x: number;
  y: number;
  properties?: Record<string, boolean | number | string>;
  emoji?: string;
}

/** Deserialized form of `data/map.json`. */
export interface MapData {
  width: number;
  height: number;
  /** Row-major 2D grid: `tiles[y][x]`. */
  tiles: TileType[][];
  activities: Activity[];
  spawnPoints: Position[];
  /** Dynamic world entities (berry bushes, benches, etc.) loaded by the autonomy system. */
  entities?: MapEntityDef[];
}

/** Per-need decay rate overrides for a character. */
export interface NeedOverrides {
  foodDecay?: number;
  waterDecay?: number;
  socialDecay?: number;
}

/** Static definition of an NPC loaded from `data/characters.ts`. */
export interface CharacterDef {
  id: string;
  name: string;
  description: string;
  personality: string;
  spawnPoint: Position;
  emoji: string;
  /** Per-character need decay overrides. */
  needOverrides?: NeedOverrides;
}
