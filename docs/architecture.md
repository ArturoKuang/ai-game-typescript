# Architecture

## Overview

AI Town is a single-process authoritative simulation with a browser client attached over WebSocket and HTTP. The core rule is simple: runtime state lives in `GameLoop`, and everything else either feeds commands into it, reads state from it, or reacts to the events it emits.

```text
Browser client (:5173)
  |-- fetch /api/* and /data/* via Vite proxy ---> Express app (:3001)
  |-- open WebSocket directly to :3001 ----------> GameWebSocketServer
                                                    |
                                                    v
                                                GameLoop
                                                  |
                    +-----------------------------+-----------------------------+
                    |                             |                             |
                    v                             v                             v
                 World                   ConversationManager                GameLogger
                    |
                    +-------------------+
                                        |
                                        v
                               NpcOrchestrator
                                        |
                    +-------------------+-------------------+
                    |                                       |
                    v                                       v
                               MemoryManager          NpcModelProvider
                    |                                       |
                    v                                       v
           MemoryStore (Postgres or in-memory)   Claude CLI primary + scripted fallback
```

## Authoritative Ownership

The main runtime ownership boundaries are:

- `GameLoop`: players, movement state, queued commands, event emission, loop mode, tick counter.
- `World`: static map geometry, activities, and spawn points loaded from `data/map.json`.
- `ConversationManager`: conversation lifecycle and message history.
- `GameLogger`: in-memory event ring buffer used by the debug API.
- `GameWebSocketServer`: transport only; it does not own gameplay state.
- `NpcOrchestrator`: reacts to conversation events, drives NPC replies/reflections, and can initiate nearby conversations.
- `MemoryManager`: semantic memory creation, retrieval, scoring, and reflection thresholds.

## Boot Flow

`server/src/index.ts` boots in this order:

1. Create the Express app and HTTP server.
2. Construct `GameLoop` in `realtime` mode with `tickRate = 20`.
3. Resolve persistence:
   - If `DATABASE_URL` is unset or PostgreSQL is unavailable, use in-memory repository/store implementations.
   - If PostgreSQL is reachable, run `schema.sql` migrations and use the Postgres-backed implementations.
4. Create `MemoryManager`, NPC provider stack, and `NpcOrchestrator`.
5. Load `data/map.json` into `World`.
6. Spawn the five default NPCs from `server/src/data/characters.ts`.
7. Attach the WebSocket server.
8. Register the wildcard event bridge that turns game events into WebSocket broadcasts.
9. Start the realtime loop.
10. Mount `/health`, `/data/map.json`, and `/api/debug`.
11. Listen on `PORT` (default `3001`).

The current runtime no longer hard-requires PostgreSQL to start. Without a live database, the simulation still runs, but persistence falls back to memory and `/health` reports `status: "degraded"`.

## Runtime Modes

There are two meaningful runtime shapes:

- Full runtime: browser client, server, optional PostgreSQL, NPC orchestration, WebSocket broadcast loop.
- Test/runtime-harness mode: stepped `GameLoop` instances created directly in Vitest or the movement harness.

`GameLoop` itself supports:

- `realtime`: uses `setInterval()` and ticks automatically.
- `stepped`: only advances when `tick()` is called directly.

## Tick Pipeline

Each call to `GameLoop.tick()` runs these phases in order:

1. Drain the command queue.
2. Validate invariants when `validateInvariants` is enabled.
3. Process held-input movement for non-conversing players.
4. Process A* path-following movement for players with `path` state.
5. Emit `player_update` events for players still moving.
6. Advance conversations.
7. Sync `player.state` and `player.currentConvoId` from active conversations.
8. Re-run invariant checks when enabled.
9. Emit `tick_complete`.

That sequencing matters. Examples:

- `join`, `move`, `start_convo`, and `say` commands do not take effect until the next tick.
- `input_start` and `input_stop` update held input immediately, but the position change still happens during the tick.
- NPC reply generation is triggered by conversation events, but the actual `say` command is enqueued back into the next tick.

## Core Data Flow

### Join Flow

1. Client opens WebSocket and receives a full `state` snapshot.
2. Client sends `join`.
3. Server allocates `human_N` and queues a `spawn` command.
4. Server immediately sends a preview `player_joined` message to that socket so the client learns its id before the next tick.
5. On the next tick, `GameLoop` processes the queued spawn and the broadcast bridge emits `player_joined` to every connected client.

### Continuous Movement Flow

1. Browser keydown sends `input_start`.
2. `GameWebSocketServer` calls `game.setPlayerInput()` immediately.
3. Next tick resolves velocity, wall collision, and player collision inside `processInputMovement()`.
4. `input_move` and `player_update` events are emitted.
5. `server/src/index.ts` maps those events to WebSocket `player_update` broadcasts.
6. The client reconciles its predicted self-position toward server authority.

### Path Movement Flow

1. Browser click or debug `POST /move` calls `setPlayerTarget()`.
2. The engine computes a 4-directional A* path from the rounded current position.
3. The player follows that path at `player.speed` tiles per tick until `move_end`.
4. Any new held input or discrete direction move cancels the path and emits `move_cancelled`.

### Conversation Flow

1. A queued `start_convo` command creates an `invited` conversation.
2. If either participant is an NPC, the next conversation tick auto-accepts and moves the conversation to `walking`.
3. Players rendezvous toward a midpoint until Manhattan distance is `<= 2`.
4. The conversation becomes `active`.
5. `NpcOrchestrator` can then generate NPC replies and enqueue `say` commands.
6. On end, memories are written for both participants and NPC reflections may be generated.

### NPC Memory Flow

1. `MemoryManager` embeds content with the configured `Embedder`.
2. Memory rows are stored through the abstract `MemoryStore`.
3. Retrieval overfetches vector matches, then re-ranks by recency, importance, and semantic similarity.
4. Reflection generation is gated by recent memory count plus a cumulative importance threshold.

## Current System Rules

### Map And World

- The shipped map is `20 x 20`.
- The tile set currently contains `304` floor tiles and `96` wall tiles.
- The code supports `water`, but the current map does not use it.
- Activities and spawn points come from `data/map.json`, not the database.

### Movement

There are three movement paths:

- Held input: floating-point, velocity-based, diagonal-normalized, uses `moveSpeed` in tiles per second.
- A* target movement: waypoint-based, uses `speed` in tiles per tick.
- Discrete `move_direction`: one-tile immediate move, retained mostly for compatibility and debug surfaces.

### Conversations

Conversation states are:

```text
invited -> walking -> active -> ended
```

Current constants from `server/src/engine/conversation.ts`:

- Activation distance: `2` Manhattan tiles.
- Timeout with no messages: `600` ticks.
- Max messages: `20`.
- Max duration: `1200` ticks.

### NPC Orchestration

Default orchestrator settings from `server/src/npc/orchestrator.ts`:

- Initiation scan interval: every `20` ticks.
- Initiation cooldown: `120` ticks per NPC.
- Initiation radius: `6` Manhattan tiles.
- Reflection generation: enabled by default.

## Architectural Caveats

- `server/src/debug/router.ts` mutates some conversation state directly for `/start-convo`, `/say`, and `/end-convo` instead of going through queued `GameLoop` commands. Those routes are useful for inspection, but they do not emit the full event stream that the WebSocket bridge and NPC orchestrator normally observe.
- The database schema contains `world`, `activities`, and `game_log` tables, but the current runtime still loads world data from `data/map.json` and keeps the live event log in memory.
- There are two NPC definition files: `data/characters.ts` and `server/src/data/characters.ts`. The server currently imports the copy inside `server/src/`.
- The client mirrors many server types manually in `client/src/types.ts` rather than importing them from a shared package.

## Directory Guide

```text
client/
  src/main.ts          Browser bootstrap and prediction loop
  src/network.ts       Browser WebSocket client
  src/renderer.ts      PixiJS renderer
  src/ui.ts            Sidebar and chat DOM bindings

server/src/
  index.ts             Runtime bootstrap and event bridge
  engine/              Deterministic simulation core
  network/             Protocol definitions and WebSocket server
  debug/               Debug router, scenarios, ASCII map, harness
  npc/                 Memory + orchestration + provider stack
  db/                  Repository, migrations, schema, persistence store

data/
  map.json             Canonical map, activities, and spawn points
  characters.ts        Shared NPC definition copy
```
