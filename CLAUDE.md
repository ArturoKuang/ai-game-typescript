# AI Town — Project Instructions

## Overview

AI Town is a multiplayer social simulation game server where human players and AI-driven NPCs inhabit a tile-based town, move around, and have conversations. The server is a Node.js/TypeScript application with a WebSocket interface for real-time clients and a REST debug API.

## Project Structure

```
server/              # All application code lives here
  src/
    index.ts         # Entry point — Express + WebSocket bootstrap
    engine/          # Core simulation
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
      repository.ts  # Persistence layer
      schema.sql     # Full DDL (pgvector enabled)
    npc/
      embedding.ts   # Placeholder embedder + cosine similarity
    debug/
      router.ts      # Express debug API routes
      asciiMap.ts    # Terminal map renderer
      scenarios.ts   # Pre-built test scenarios
  test/              # Vitest test files
    helpers/
      testGame.ts    # Shared test fixtures (mini map, default map)
data/
  map.json           # 20x20 town map (tiles, activities, spawn points)
```

## Tech Stack

- **Runtime**: Node.js 20, ES modules (`"type": "module"`)
- **Language**: TypeScript 5.7 (strict mode, ES2022 target, NodeNext module resolution)
- **Framework**: Express 4
- **WebSocket**: ws 8
- **Database**: PostgreSQL 16 + pgvector (1536-dim embeddings)
- **Testing**: Vitest 3
- **Runner**: tsx (dev and production)

## Commands

All commands run from the `server/` directory:

```bash
npm test              # Run all tests once (vitest run)
npm run test:watch    # Watch mode
npm run dev           # Start dev server with hot reload (tsx watch)
npm start             # Start server (tsx src/index.ts)
```

Docker (from repo root):

```bash
docker-compose up     # PostgreSQL on :5432, server on :3001
```

## Code Conventions

- **ES modules only** — use `.js` extensions in import paths (TypeScript NodeNext resolution requires this).
- **Strict TypeScript** — no `any` unless unavoidable. All types live in `engine/types.ts` or `network/protocol.ts`.
- **No classes for game state** — the game loop, world, and conversation manager use functional patterns with plain objects and interfaces.
- **Tick-based simulation** — all game logic advances via `tick()`. Time is measured in ticks, not wall-clock time.
- **Seeded RNG** — use the `rng.ts` PRNG for anything that should be reproducible. Never use `Math.random()` in game logic.
- **Tests are pure unit tests** — no database or network required. Tests use in-memory game loops created via `test/helpers/testGame.ts`.

## Architecture Notes

- **GameLoop** is the central coordinator. It owns players, the world, conversations, and the event logger.
- **Two modes**: `stepped` (call `tick()` or POST `/api/debug/tick`) and `realtime` (auto-ticks at configurable interval, default 500ms).
- **Conversations** follow a state machine: `invited → walking → active → ended`. The ConversationManager auto-navigates participants to a midpoint.
- **WebSocket protocol** is defined in `network/protocol.ts` with discriminated unions (`ClientMessage`, `ServerMessage`).
- **A* pathfinding** uses 4-directional movement on the tile grid. Walls and water are impassable.
- **Player states**: `idle`, `walking`, `conversing`, `doing_activity`.

## Testing Patterns

- Test files live in `server/test/` and match `*.test.ts`.
- Use `createTestGame()` or `createMiniGame()` from `test/helpers/testGame.ts` to get a pre-configured `GameLoop`.
- Assert on tick results (`TickResult.events`) and player state after ticking.
- WebSocket tests create real server instances on ephemeral ports.

## Debug API

The debug API is mounted at `/api/debug/` and is useful for inspecting game state:

- `GET /state` — tick, mode, player count
- `GET /map?format=ascii|json` — map visualization
- `GET /players` — all players with full state
- `GET /conversations` — active conversations
- `GET /log?limit=N&type=T&player=P` — filtered event log
- `POST /tick` — advance N ticks (`{ "count": N }`)
- `POST /spawn` — add a player
- `POST /move` — set movement target (`{ "playerId", "x", "y" }`)
- `POST /reset` — clear all state
- `POST /scenario` — load a preset (`empty`, `two_npcs_near_cafe`, `crowded_town`)

## Environment

Copy `.env.example` to `.env`:

```
DATABASE_URL=postgres://aitown:aitown_dev@localhost:5432/aitown
PORT=3001
```

The server runs without a database for in-memory-only mode (tests always use this).
