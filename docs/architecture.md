# Architecture

## Overview

AI Town is a single-process authoritative simulation. The browser is a thin
client over HTTP and WebSocket; the server owns gameplay state, autonomous NPC
behavior, combat, and debug surfaces.

```text
Browser client (:5173)
  |-- fetch /api/* and /data/* via Vite proxy ---> Express app (:3001)
  |-- open WebSocket directly to :3001 ----------> GameWebSocketServer
                                                    |
                                                    v
                                                GameLoop
                                                  |
         +--------------------------+-------------+--------------+
         |                          |                            |
         v                          v                            v
      World                ConversationManager               GameLogger
         |
         +--------------------+
                              |
                              v
                        EntityManager
                              |
              +---------------+----------------+
              |                                |
              v                                v
      NpcAutonomyManager                 BearManager
              |
      +-------+--------+
      |                |
      v                v
NpcOrchestrator   MemoryManager + provider stack
```

## Runtime Ownership

The main ownership boundaries are:

- `GameLoop`: players, command queue, movement, conversations, event emission,
  tick counter, and logger.
- `World`: static map geometry, activities, and spawn points from
  `data/map.json`.
- `EntityManager`: mutable world entities loaded from the map and updated at
  runtime.
- `NpcAutonomyManager`: NPC needs, plans, action execution, and human survival
  snapshots.
- `BearManager`: bear AI, combat, item drops, and inventory-backed pickup/eat
  handling.
- `NpcOrchestrator`: NPC dialogue scheduling, memory writes, and reflection
  generation.
- `GameWebSocketServer`: transport bridge only. It does not own gameplay state.
- `createDebugRouter()`: local inspection and control API layered on top of the
  runtime.

## Boot Flow

`server/src/index.ts` is now a thin entry point. The main composition lives in
`server/src/bootstrap/runtime.ts`, which boots in this order:

1. Create Express and the HTTP server.
2. Create `GameLoop` in `realtime` mode at 20 ticks/sec.
3. Resolve persistence:
   - PostgreSQL-backed stores when `DATABASE_URL` is reachable.
   - in-memory fallback otherwise.
4. Build the NPC provider stack, memory manager, and `NpcOrchestrator`.
5. Load `data/map.json` into `World`.
6. Load map entities into `EntityManager`.
7. Create `NpcAutonomyManager`.
8. Spawn the default NPC cast from `server/src/data/characters.ts`.
9. Create `BearManager` and seed the initial bear population.
10. Attach `GameWebSocketServer` and wire the game-event broadcast bridge.
11. Register entity, needs, survival, and debug feed broadcasters.
12. Start the realtime loop and mount `/health`, `/data/map.json`, and
    `/api/debug`.

The runtime does not require PostgreSQL to start. Without a database, the game
still runs and `/health` reports `status: "degraded"`.

## Tick Model

`GameLoop.tick()` is the authoritative frame boundary. At a high level it:

1. increments the tick counter
2. drains the queued command list
3. runs invariant checks when enabled
4. resolves held-input movement
5. resolves path-following movement
6. advances conversations
7. syncs player conversation state
8. emits `tick_complete`
9. runs after-tick callbacks

That last step matters: autonomy, bears, and NPC orchestration mostly react to
events or after-tick hooks, so the commands they enqueue take effect on the
next engine tick.

## Major Runtime Flows

### Player Join

1. The client connects and receives a `state` snapshot.
2. The client sends `join`.
3. The server allocates a `human_N` id and queues a spawn.
4. The socket gets an optimistic `player_joined` preview immediately.
5. The queued spawn becomes authoritative on the next tick.

### Movement

There are two main movement paths and one compatibility path:

- held input via `input_start` and `input_stop`
- A* path movement via `move`
- one-tile `move_direction` for compatibility and debug flows

Held input updates input state immediately, but the actual position change still
happens inside the next engine tick.

### Conversations

Conversation state always moves through:

```text
invited -> walking -> active -> ended
```

`NpcAutonomyManager` owns initiation pressure. `NpcOrchestrator` owns NPC
replying once a conversation is active.

### NPC Autonomy And Combat

- `NpcAutonomyManager` decays NPC food, water, and social needs.
- It also tracks human survival snapshots: health, food, water, and social.
- Plans are built from actions like `goto`, `harvest`, `cook`, `drink`, `eat`,
  `socialize`, `flee`, and `pickup`.
- `BearManager` consumes queued `attack`, `pickup`, and `eat` commands through
  `GameLoop.onCommand()` hooks and turns them into combat and inventory effects.

## Debug Surfaces

The runtime exposes three practical debug entry points:

- `/api/debug` for inspection, stepping, scenarios, command-backed admin
  writes, and screenshot capture
- the gameplay client in `client/index.html`, which shows a compact debug
  overlay and currently polls `/api/debug/conversations` plus
  `/api/debug/autonomy/state`
- the dedicated dashboard in `client/debug.html`, which subscribes to the
  WebSocket debug feed with `subscribe_debug` and renders live conversation,
  autonomy, alert, and event panels

## Important Caveats

- Debug write routes now centralize through `DebugGameAdmin`. Spawn, move, and
  conversation writes reuse the normal command queue, but they drain pending
  commands synchronously so the HTTP caller gets the updated state immediately.
- World tiles and activities are still file-backed even though the schema has
  broader world tables.
- `client/src/types.ts` mirrors server types manually; there is no shared
  protocol package.
- `server/src/data/characters.ts` is the canonical character list. The repo-root
  `data/characters.ts` file is only a stable re-export for non-server
  consumers.
