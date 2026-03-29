# Server Engine

This document covers the authoritative simulation in `server/src/engine/`.

## Scope

The engine subsystem is responsible for:

- Loading and querying the static world
- Spawning and removing players
- Continuous input movement and A* movement
- Player/player and player/wall collision
- Conversations and message history
- Command queue processing
- Event emission and invariant validation

It intentionally does not handle:

- WebSocket transport
- Express routing
- Database access
- PixiJS rendering

## Components

### `types.ts`

Defines the core data contracts:

- Spatial types: `Position`, `Tile`, `TileType`
- Player state: `Player`, `PlayerState`, `Orientation`
- World content: `Activity`, `MapData`, `CharacterDef`
- Event model: `GameEvent`, `GameEventType`, `TickResult`
- Command model: `spawn`, `remove`, `move_to`, `move_direction`, `start_convo`, `end_convo`, `say`

Important player fields:

- `speed`: path-following speed in tiles per tick
- `moveSpeed`: held-input speed in tiles per second
- `vx` / `vy`: current resolved velocity for input-driven movement
- `inputX` / `inputY`: held-direction vector
- `radius`: collision radius, currently `0.4`
- `targetX` / `targetY`, `path`, `pathIndex`: path-following state

### `world.ts`

`World` wraps the loaded `MapData` and answers structural questions:

- `getTile()`
- `isWalkable()`
- `getNeighbors()` for 4-directional pathfinding
- `getActivity()`
- `getActivities()`
- `getSpawnPoints()`

The world is immutable after load in the current codebase. Dynamic tile state is not implemented yet.

### `pathfinding.ts`

Implements 4-directional A* over `World.getNeighbors()`.

Behavior notes:

- Goals must be walkable.
- The returned path includes both start and goal.
- Costs are Manhattan and uniform.
- Diagonal movement is impossible by construction.

### `collision.ts`

Implements the server-side tile collision model used by continuous movement.

Key rules:

- Runtime player coordinates are centered on integer tile centers.
- Collision is resolved on a translated unit grid so tile bounds behave like `[tx, tx + 1] x [ty, ty + 1]`.
- Movement is subdivided into smaller steps to avoid tunneling.
- X is resolved first, then Y.
- `findBlockedTileOverlap()` is used by invariant checks to catch illegal placements.

The same overall rules are mirrored in `client/src/prediction.ts` for client-side prediction parity.

### `logger.ts`

`GameLogger` is a simple in-memory ring buffer with a default capacity of `1000` events. It supports filtering by:

- tick threshold
- player id
- event type
- trailing limit

This logger is the backing store for `GET /api/debug/log`.

### `conversation.ts`

`ConversationManager` owns conversation lifecycle and message storage.

States:

```text
invited -> walking -> active -> ended
```

Current constants:

- activation distance: `2`
- inactivity timeout: `600` ticks
- max messages: `20`
- max duration: `1200` ticks

`processTick()` handles:

- NPC auto-accept from `invited`
- midpoint rendezvous in `walking`
- timeout and limit-based termination in `active`

The conversation store is in-memory only. Persistence is handled elsewhere by `NpcOrchestrator`.

### `gameLoop.ts`

`GameLoop` is the coordinator and the engine entry point.

It owns:

- the current tick number
- mode and tick rate
- the loaded world
- all players
- held input state per player
- the event handler registry
- the in-memory logger
- the conversation manager
- the queued command list
- after-tick callbacks

## Command Model

Queued commands are processed at the start of the next tick:

- `spawn`
- `remove`
- `move_to`
- `move_direction`
- `start_convo`
- `end_convo`
- `say`

Notably, held input is not queued. `setPlayerInput()` mutates held-input state immediately, but position changes still wait for the next tick.

## Tick Order

`tick()` executes in this order:

1. Increment tick counter.
2. Drain the command queue.
3. Run invariant checks when enabled.
4. Process held-input movement.
5. Process path-following movement.
6. Emit `player_update` for players still in motion.
7. Advance conversations.
8. Sync `player.state` and `player.currentConvoId`.
9. Run invariant checks again when enabled.
10. Emit `tick_complete`.
11. Invoke after-tick callbacks.

## Movement Modes

### Held Input

Used by browser `WASD` and arrow keys.

Key properties:

- Vector is derived from held booleans, not single last-key state.
- Diagonal movement is normalized.
- Movement uses `moveSpeed / tickRate`.
- The player enters `walking` state while moving.
- If held input begins while a path exists, the path is cancelled and `move_cancelled` is emitted.

### Path Following

Used by click-to-move, debug `/move`, and conversation rendezvous.

Key properties:

- Path starts from `Math.round(player.x), Math.round(player.y)`.
- Movement advances waypoint-by-waypoint using `player.speed`.
- Player collisions are checked against every waypoint step and any partial move.
- Completion snaps the player to the final tile and emits `move_end`.

### Discrete One-Tile Movement

`movePlayerDirection()` still exists for compatibility and debug workflows.

Key properties:

- Clears held input
- Cancels any current path
- Moves one rounded tile if walkable and unoccupied

## Event Model

Important engine event types:

- lifecycle: `spawn`, `despawn`, `tick_complete`
- input/movement: `input_state`, `input_move`, `move_start`, `move_cancelled`, `move_end`, `move_direction`, `player_collision`, `player_update`
- conversation: `convo_started`, `convo_accepted`, `convo_active`, `convo_message`, `convo_ended`

Every emitted event goes through `GameLogger` first, then specific handlers, then wildcard handlers.

## Invariants

When `validateInvariants` is enabled, `GameLoop` asserts:

- no player overlaps a blocked tile
- no player has non-zero velocity without active input
- all path steps are cardinal and stay on walkable tiles
- no two players overlap
- pure horizontal input does not drift on Y
- pure vertical input does not drift on X

This mode is mainly used by tests and movement debugging.

## Reset Behavior

`reset()` clears:

- players
- held inputs
- world
- event log
- conversations
- command queue
- realtime interval

It does not automatically reload the map. Debug flows should prefer `POST /scenario` when they want a clean simulation with a world still attached.
