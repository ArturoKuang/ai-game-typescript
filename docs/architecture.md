# Architecture

## System Overview

```
                  Browser (host:5173)
                        |
                   Vite dev server
                   (proxies /api, /data)
                        |
         +--------------+--------------+
         |              |              |
     WebSocket      HTTP API      Static assets
     (ws://:3001)   (/api/debug)  (/data/map.json)
         |              |              |
         +--------------+--------------+
                        |
              +---------+---------+
              |  Game Server      |   Docker :3001
              |  (Node.js + tsx)  |
              |                   |
              |  +-------------+  |
              |  | GameLoop    |  |   Central coordinator
              |  |  - World    |  |   Owns all game state
              |  |  - Players  |  |
              |  |  - Convos   |  |
              |  |  - Logger   |  |
              |  +------+------+  |
              |         |         |
              |  +------+------+  |
              |  | Debug API   |  |   GET/POST /api/debug/*
              |  +------+------+  |
              |         |         |
              |  +------+------+  |
              |  | WebSocket   |  |   Real-time state push
              |  | Server      |  |
              |  +------+------+  |
              |         |         |
              |  +------+------+  |
              |  | Memory      |  |   NPC memories + embeddings
              |  | Manager     |  |
              |  +-------------+  |
              +---------+---------+
                        |
              +---------+---------+
              |  PostgreSQL       |   Docker :5432
              |  + pgvector       |
              |                   |
              |  - players        |
              |  - conversations  |
              |  - messages       |
              |  - memories       |   vector(1536)
              |  - game_log       |
              |  - world          |
              |  - activities     |
              +---------+---------+
```

## Movement Systems

There are two movement systems:

### WASD / Arrow Key Movement (human players)

Processed **immediately** when the server receives a `move_direction` message — not on the tick loop. The server checks if the adjacent tile is walkable, moves the player one tile, and broadcasts a `player_update` to all clients. The client also applies **client-side prediction**, moving the local player sprite instantly before the server confirms.

```
Client                              Server
  |                                    |
  |-- keydown(W) ----------------->   |
  |   predict: self.y -= 1            |  movePlayerDirection("up")
  |   send move_direction("up")       |  check isWalkable(x, y-1)
  |                                    |  player.y -= 1
  |<-- player_update (y-1) ---------- |  broadcast player_update
  |   reconcile position              |
```

### Click-to-Move / API Move (NPCs, debug)

Uses A* pathfinding. The path is computed once, then the player walks along it at `speed` tiles per tick. Walking player positions are broadcast after every tick via `onAfterTick`.

### Tick Lifecycle (20 ticks/sec in realtime mode)

Every game tick executes these steps in order:

```
tick()
  |
  +-- 1. Process movement
  |     For each walking player:
  |       Move along A* path by `speed` tiles
  |       Update orientation (up/down/left/right)
  |       If destination reached: state = idle
  |
  +-- 2. Process conversations
  |     For each conversation:
  |       invited:  NPC auto-accepts -> walking
  |       walking:  Check proximity (<= 2 tiles) -> active
  |                 Otherwise pathfind toward midpoint
  |       active:   Check timeout (60 ticks no messages)
  |                 Check max messages (20)
  |                 Check max duration (300 ticks)
  |                 Auto-end if any limit hit
  |
  +-- 3. Sync player state
  |     For each player:
  |       If in active convo: state = conversing
  |       If convo ended: state = idle
  |
  +-- 4. Emit events + afterTick callbacks
        All events logged to GameLogger ring buffer
        Events returned in TickResult
        afterTick: broadcast walking player positions via WebSocket
```

## Conversation State Machine

```
                  startConversation()
                         |
                         v
                   +-----------+
                   |  invited  |
                   +-----+-----+
                         |
               NPC auto-accepts / human accepts
                         |
                         v
                   +-----------+
              +--->|  walking  |
              |    +-----+-----+
              |          |
              |   distance <= 2 tiles?
              |     no   |   yes
              |     |    |
              | pathfind |
              | to mid   |
              +----+     |
                         v
                   +-----------+
                   |  active   |<--- messages exchanged here
                   +-----+-----+
                         |
              timeout / max msgs / max duration / manual end
                         |
                         v
                   +-----------+
                   |   ended   |---> generate memories
                   +-----------+
```

## Player State Machine

```
              spawn
                |
                v
           +---------+
      +--->|  idle   |<---+---+
      |    +----+----+    |   |
      |         |         |   |
      |    setTarget() /  |   | WASD moveDirection()
      |    click-to-move  |   | (immediate, no walking state)
      |         |         |   |
      |         v         |   |
      |    +---------+    |   |
      |    | walking |    |   |
      |    +----+----+    |   |
      |         |         |   |
      |   reach dest  convo starts
      |         |     (accepted + close)
      |         v         |
      |    +---------+    |
      +----|  idle   |----+
           +---------+
                |
           convo activates
                |
                v
           +------------+
           | conversing |
           +------------+
```

## Data Flow: Human Player Joins and Moves

```
Browser                    Vite Proxy              Game Server
  |                           |                         |
  |-- WS connect ----------->|--- WS connect --------->|
  |                           |                         |
  |<- { type: "state" } -----|<- full game state -------|
  |                           |                         |
  |-- { type: "join",        |                         |
  |    name: "Alice" } ----->|------------------------>|
  |                           |                   spawnPlayer()
  |<- { type:                |                         |
  |    "player_joined" } ----|<- player data ----------|
  |                           |                         |
  |-- press W key             |                         |
  |   (predict: y -= 1)      |                         |
  |-- { type:                 |                         |
  |    "move_direction",      |                         |
  |    direction: "up" } --->|------------------------>|
  |                           |                   movePlayerDirection()
  |                           |                   check isWalkable()
  |<- { type:                |                         |
  |    "player_update" } ----|<- updated player --------|
  |                           |                         |
  |   (walking players broadcast every tick via WS)     |
  |<- { type:                |                         |
  |    "player_update" } ----|<- NPC positions ---------|
```

## Directory Structure

```
ai-game-typescript/
+-- docker-compose.yml      # PostgreSQL + game server
+-- data/
|   +-- map.json            # 20x20 town map
|   +-- characters.ts       # NPC personality definitions
+-- server/
|   +-- Dockerfile
|   +-- package.json
|   +-- src/
|   |   +-- index.ts        # Express + WebSocket bootstrap
|   |   +-- engine/         # Core simulation (no I/O)
|   |   |   +-- types.ts    # All shared type definitions
|   |   |   +-- gameLoop.ts # Tick loop, player management
|   |   |   +-- world.ts    # Tile grid, walkability
|   |   |   +-- pathfinding.ts  # A* algorithm
|   |   |   +-- conversation.ts # Conversation lifecycle
|   |   |   +-- logger.ts   # In-memory event ring buffer
|   |   |   +-- rng.ts      # Seeded xorshift128 PRNG
|   |   +-- network/
|   |   |   +-- protocol.ts # WebSocket message types
|   |   |   +-- websocket.ts# WebSocket server
|   |   +-- db/
|   |   |   +-- schema.sql  # PostgreSQL + pgvector DDL
|   |   |   +-- client.ts   # Connection pool
|   |   |   +-- migrate.ts  # Schema runner
|   |   |   +-- repository.ts  # Memory CRUD + vector search
|   |   +-- npc/
|   |   |   +-- embedding.ts   # Embedder interface + placeholder
|   |   |   +-- memory.ts      # Memory manager (scoring, reflection)
|   |   +-- debug/
|   |       +-- router.ts   # All debug HTTP endpoints
|   |       +-- asciiMap.ts  # Terminal map renderer
|   |       +-- scenarios.ts # Predefined test setups
|   +-- test/
|       +-- helpers/testGame.ts  # TestGame fixture class
|       +-- engine.test.ts
|       +-- pathfinding.test.ts
|       +-- conversation.test.ts
|       +-- websocket.test.ts
|       +-- debug-api.test.ts
|       +-- memory.test.ts
|       +-- reflection.test.ts
+-- client/
    +-- package.json
    +-- vite.config.ts       # Proxies /api and /data to :3001
    +-- index.html           # HTML shell with sidebar
    +-- src/
        +-- main.ts          # Entry point, wires everything
        +-- renderer.ts      # PixiJS tile map + player sprites
        +-- network.ts       # WebSocket client
        +-- ui.ts            # Chat panel, player list, status
        +-- types.ts         # Mirrors server protocol types
```

## Key Design Decisions

- **Engine is pure** — `engine/` has zero I/O dependencies. It can be tested entirely in-memory without Docker or a database.
- **Realtime by default** — the server starts in `realtime` mode at 20 ticks/sec for responsive gameplay. Tests use `stepped` mode for determinism. The debug API can switch modes at any time via `POST /mode`.
- **Seeded RNG** — all randomness flows through `rng.ts` so tests are reproducible.
- **Debug API is the primary interface** — both AI agents and humans interact with the game primarily through HTTP endpoints. The browser client is a rendering layer on top.
- **Conversations are in-memory** — the ConversationManager lives inside the GameLoop. Messages are stored in-memory during the conversation and only persisted to DB when creating memories after the conversation ends.
- **Placeholder embeddings** — the memory system uses hash-based pseudo-embeddings that require no external API. This lets the full pipeline work end-to-end without an LLM. Real embeddings will be added when Claude Code sessions are integrated as NPC brains.
