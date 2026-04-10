# Server Engine

This document covers the authoritative simulation in `server/src/engine/`.

## Scope

The engine owns:

- world loading and spatial queries
- players and their movement state
- queued gameplay commands
- conversation lifecycle and message storage
- event emission and invariant checks

It deliberately does not own:

- WebSocket transport
- Express routes
- database access
- PixiJS rendering
- autonomy, combat, or entity-specific logic outside the core movement and
  conversation model

## Key Files

### `types.ts`

Defines the core contracts shared across the engine:

- world data like `TileType`, `Activity`, `MapData`, and `CharacterDef`
- player state, orientation, movement fields, and health
- engine events and commands

The command union includes core simulation commands plus externally handled
commands like `attack`, `pickup`, and `eat`. `GameLoop` dispatches those through
registered command handlers instead of implementing combat and inventory logic
itself.

### `world.ts`

`World` wraps loaded `MapData` and answers structural questions:

- `getTile()`
- `isWalkable()`
- `getNeighbors()`
- `getActivities()`
- `getSpawnPoints()`

Water tiles are part of the current map and are non-walkable, just like walls.

### `pathfinding.ts`

Implements 4-directional A* on top of `World.getNeighbors()`.

Important rules:

- goals must be walkable
- the returned path is cardinal only
- path costs are uniform and Manhattan-based

### `collision.ts`

Implements continuous movement collision against tiles and other players.

Important rules:

- runtime positions are centered on integer tile centers
- collision is solved on a translated unit grid
- movement is subdivided to avoid tunneling
- X resolves before Y

`client/src/prediction.ts` mirrors these rules closely for local prediction.

### `conversation.ts`

`ConversationManager` owns conversation state and message history.

State always flows through:

```text
invited -> walking -> active -> ended
```

It handles:

- NPC auto-accept in `invited`
- rendezvous movement in `walking`
- timeout and message-limit endings in `active`

Persistence is handled outside the engine by the NPC stack.

### `logger.ts`

`GameLogger` is an in-memory ring buffer used by the debug API. It supports
filtering by tick, player, event type, and limit.

### `gameLoop.ts`

`GameLoop` is the coordination point. It owns:

- the current tick and loop mode
- the loaded `World`
- players
- the command queue
- held input state
- event listeners
- the logger
- the conversation manager
- after-tick callbacks
- external command handlers registered with `onCommand()`

## Command Model

Most gameplay mutations happen by enqueuing commands for the next tick.

Core queued commands include:

- spawn and remove
- move-to and one-tile direction moves
- conversation start, accept, decline, end, and say

Held input is the main exception: `setPlayerInput()` mutates input state
immediately, but the resulting movement still happens during `tick()`.

External systems can hook command types with `GameLoop.onCommand()`. That is how
bear combat and inventory-backed actions stay out of `engine/`.

## Tick Order

At a high level, `tick()` does this:

1. increment the tick counter
2. process the command queue
3. run invariants when enabled
4. resolve held-input movement
5. resolve path movement
6. emit movement updates
7. advance conversations
8. sync player conversation state
9. emit `tick_complete`
10. run after-tick callbacks

That ordering is the reason input changes are visible before autonomy or bear
systems react to the same frame.

## Movement Modes

### Held Input

Used by browser `WASD` and arrow keys.

- diagonal input is normalized
- movement uses `moveSpeed / tickRate`
- starting held input cancels any active path

### Path Following

Used by click-to-move, rendezvous movement, and some debug routes.

- paths are computed from rounded player positions
- movement follows waypoints at `player.speed`
- completion snaps to the final tile and emits `move_end`

Path speed defaults live in `movementConfig.ts`. Human players use
`HUMAN_DEFAULT_PATH_SPEED` (1.0 tiles/tick, the historical click-to-move pace).
NPCs use `computeNpcPathSpeed(npcId)`, which hashes the NPC id into a stable
stride around `NPC_DEFAULT_PATH_SPEED` (≈0.08 tiles/tick, ~1.6 tiles/sec at
20 tps) with `NPC_SPEED_VARIANCE` jitter so two NPCs rarely walk in lockstep.
The hash is independent of the engine RNG, so stride stays consistent across
save/load and reconnects.

### One-Tile Direction Moves

Still used for compatibility and debug surfaces.

- clears held input
- cancels any active path
- attempts a single rounded-tile move

## Event Model

Important event families:

- lifecycle: `spawn`, `despawn`, `tick_complete`
- movement: `input_state`, `input_move`, `move_start`, `move_cancelled`,
  `move_end`, `move_direction`, `player_collision`, `player_update`
- conversation: `convo_started`, `convo_accepted`, `convo_active`,
  `convo_message`, `convo_ended`
- combat and inventory hooks: `player_damage`, `player_death`, `player_heal`,
  `item_consumed`, `item_drop`, `item_pickup`

Every emitted event is logged before wildcard listeners and transport bridges
see it.

## Invariants

When `validateInvariants` is enabled, the engine asserts:

- players are not inside blocked tiles
- players do not overlap each other
- velocity is consistent with active held input
- path steps remain cardinal and walkable
- pure horizontal or vertical input does not drift off-axis

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
