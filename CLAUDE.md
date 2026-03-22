# AI Town -- Project Instructions

## Overview

AI Town is a multiplayer social simulation game where human players and AI-driven NPCs inhabit a tile-based town, move around, and have conversations. The server is a Node.js/TypeScript application with a WebSocket interface for real-time clients and a REST debug API. A browser client renders the world with PixiJS.

## Project Structure

```
server/              # Game server (Docker)
  src/
    index.ts         # Entry point -- Express + WebSocket bootstrap
    engine/          # Core simulation (no I/O, fully testable)
      gameLoop.ts    # Tick-based game loop (stepped or realtime mode)
      world.ts       # Tile grid, collision, spawn points
      pathfinding.ts # A* pathfinding (4-directional)
      conversation.ts# Conversation lifecycle manager
      types.ts       # Shared data models (Player, Activity, Position, etc.)
      logger.ts      # In-memory ring-buffer event log
      rng.ts         # Seeded xorshift128 PRNG
    network/
      websocket.ts   # WebSocket server (ws)
      protocol.ts    # Client/server message type definitions
    db/
      client.ts      # PostgreSQL connection pool (pg)
      migrate.ts     # Schema migration runner
      repository.ts  # Persistence layer (memories, game log)
      schema.sql     # Full DDL (pgvector enabled)
    npc/
      embedding.ts   # Placeholder embedder + cosine similarity
      memory.ts      # Memory manager (scoring, retrieval, reflection)
    debug/
      router.ts      # Express debug API routes
      asciiMap.ts    # Terminal map renderer
      scenarios.ts   # Pre-built test scenarios
  test/              # Vitest test files
    helpers/
      testGame.ts    # Shared test fixtures (mini map, default map)
client/              # Browser client (runs on host)
  src/
    main.ts          # Entry point -- wires PixiJS, WebSocket, UI
    renderer.ts      # PixiJS tile map + player sprites
    network.ts       # WebSocket client (connects to :3001)
    ui.ts            # Chat panel, player list, status bar
    types.ts         # Mirrors server protocol types
data/
  map.json           # 20x20 town map (tiles, activities, spawn points)
  characters.ts      # NPC personality definitions
docs/
  architecture.md    # System diagrams, tick lifecycle, state machines
  debug-api.md       # Full API reference with curl examples
  getting-started.md # Setup and first-run guide
```

## Development Workflow

When implementing features or fixing bugs, follow this workflow:

1. **Read state** -- understand the current game state and relevant code before changing anything
2. **Implement** -- write the code changes
3. **Write tests** -- add vitest tests using `TestGame` from `test/helpers/testGame.ts`
4. **Run tests** -- `docker compose exec game-server npx vitest run` -- fix until green
5. **Verify** -- if the server is running, check via debug API (`GET /api/debug/map`, `GET /api/debug/state`)
6. **Report** -- show test results and ASCII map snapshot

Before committing, always run tests and verify via the debug API.

## Tech Stack

- **Runtime**: Node.js 20, ES modules (`"type": "module"`)
- **Language**: TypeScript 5.7 (strict mode, ES2022 target, NodeNext module resolution)
- **Server**: Express 4
- **WebSocket**: ws 8
- **Database**: PostgreSQL 16 + pgvector (1536-dim embeddings)
- **Testing**: Vitest 3
- **Runner**: tsx (dev and production)
- **Client**: PixiJS 8, Vite 6
- **Infrastructure**: Docker Compose (db + game-server)

## Commands

Server (run inside Docker or from `server/` directory):

```bash
docker compose exec game-server npx vitest run   # Run all tests
docker compose up --build -d                      # Start server + database
docker compose logs game-server                   # View server logs
```

Client (from `client/` directory, runs on host):

```bash
npm install    # First time only
npm run dev    # Vite dev server on :5173
```

## Code Conventions

- **ES modules only** -- use `.js` extensions in import paths (TypeScript NodeNext resolution requires this).
- **Strict TypeScript** -- no `any` unless unavoidable. All types live in `engine/types.ts` or `network/protocol.ts`.
- **Tick-based simulation** -- NPC and conversation logic advances via `tick()`. Human WASD movement is processed immediately outside the tick loop via `movePlayerDirection()`.
- **Seeded RNG** -- use the `rng.ts` PRNG for anything that should be reproducible. Never use `Math.random()` in game logic.
- **Tests are pure unit tests** -- no database or network required. Tests use in-memory game loops created via `test/helpers/testGame.ts`.
- **Engine is I/O-free** -- `engine/` has no database, network, or filesystem dependencies.

## Architecture Notes

- **GameLoop** is the central coordinator. It owns players, the world, conversations, and the event logger.
- **Two modes**: `stepped` (call `tick()` or POST `/api/debug/tick`) and `realtime` (auto-ticks at configurable interval). The server defaults to **realtime mode at 20 ticks/sec**.
- **Two movement systems**:
  - **WASD / arrow keys** (human players): Sends `move_direction` messages. Server moves the player one tile immediately (no pathfinding) and broadcasts the update. Client uses client-side prediction for instant feedback.
  - **Click-to-move / API move** (NPCs and debug): Uses A* pathfinding. Player walks along the computed path at `speed` tiles per tick.
- **Conversations** follow a state machine: `invited -> walking -> active -> ended`. The ConversationManager auto-navigates participants toward each other.
- **WebSocket protocol** is defined in `network/protocol.ts` with discriminated unions (`ClientMessage`, `ServerMessage`). The server broadcasts `player_update` messages in real time — no client-side polling needed.
- **A* pathfinding** uses 4-directional movement on the tile grid. Walls and water are impassable.
- **Player states**: `idle`, `walking`, `conversing`, `doing_activity`.
- **Memory system**: Memories are stored in PostgreSQL with pgvector embeddings. Retrieval uses a composite score of recency (exponential decay), importance (1-10), and relevance (cosine similarity). Reflections are generated when cumulative importance exceeds a threshold.

See `docs/architecture.md` for diagrams and detailed data flow.

## Testing Patterns

- Test files live in `server/test/` and match `*.test.ts`.
- Use `TestGame` from `test/helpers/testGame.ts` to get a pre-configured `GameLoop` in stepped mode with seeded RNG.
- Assert on tick results (`TickResult.events`) and player state after ticking.

**TestGame methods:**
- `spawn(id, x, y, isNpc?)` -- create a player at position
- `tick(count?)` -- advance N ticks (default 1), returns `TickResult[]`
- `move(id, x, y)` -- set player movement target
- `getPlayer(id)` -- get player state (throws if not found)
- `spawnNearby(id1, id2, distance?)` -- spawn two players close together
- `destroy()` -- reset game state

## Debug API

The debug API is mounted at `/api/debug/` and is the primary interface for observing and controlling the game.

**Read endpoints:**
- `GET /state` -- tick, mode, player count, world dimensions
- `GET /map` -- ASCII map visualization (add `?format=json` for structured output)
- `GET /players` -- all players with full state
- `GET /players/:id` -- single player detail
- `GET /conversations` -- all conversations with messages
- `GET /conversations/:id` -- single conversation
- `GET /activities` -- activity locations on the map
- `GET /log` -- filtered event log (`?since=N&limit=N&playerId=X`)
- `GET /scenarios` -- list available scenarios
- `GET /memories/:playerId` -- NPC memories (`?type=X&limit=N`)
- `GET /memories/:playerId/search` -- vector search (`?q=text&k=N`)

**Command endpoints:**
- `POST /tick` -- advance N ticks (`{ "count": N }`)
- `POST /spawn` -- add a player (`{ "id", "name", "x", "y", "isNpc" }`)
- `POST /move` -- set movement target (`{ "playerId", "x", "y" }`)
- `POST /start-convo` -- start a conversation (`{ "player1Id", "player2Id" }`)
- `POST /say` -- send a message (`{ "playerId", "convoId", "content" }`)
- `POST /end-convo` -- end a conversation (`{ "convoId" }`)
- `POST /reset` -- clear all game state
- `POST /scenario` -- load a preset (`{ "name": "crowded_town" }`)
- `POST /mode` -- switch mode (`{ "mode": "realtime" }` or `"stepped"`)
- `POST /memories` -- create a memory directly
- `POST /remember-convo` -- generate memories for both conversation participants

See `docs/debug-api.md` for full request/response examples.

## Environment

The server runs in Docker with these defaults (configured in `docker-compose.yml`):

```
DATABASE_URL=postgres://aitown:aitown_dev@db:5432/aitown
PORT=3001
```

Tests run in-memory without a database.
