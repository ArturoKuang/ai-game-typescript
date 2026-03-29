# AI Town

AI Town is a multiplayer social-simulation prototype with a deterministic TypeScript game loop, a browser client, a debug HTTP API, and a PostgreSQL-backed NPC memory layer.

The current codebase already supports:

- A 20x20 tile town map with walls, activities, and spawn points
- Five NPCs loaded at server startup
- Real-time ticking at 20 ticks/sec in the main server
- Continuous keyboard movement with server-side collision
- A* click-to-move and API-driven movement
- Conversations with a small state machine
- Memory persistence and vector search backed by PostgreSQL + pgvector
- A Vitest suite that runs fully in memory without Docker or a database

## Quick Start

### Run the test suite

```bash
cd server
npm install
npm test
```

### Run the full stack

Start PostgreSQL and the game server:

```bash
docker compose up --build -d
```

Check the server:

```bash
curl localhost:3001/health
curl localhost:3001/api/debug/state
curl localhost:3001/api/debug/map
```

The server loads the default map and spawns all five NPCs on boot.

Start the browser client in a second terminal:

```bash
cd client
npm install
npm run dev
```

Open `http://localhost:5173`.

## How The Project Is Organized

```text
client/              PixiJS browser client
data/                Shared town map and NPC definitions
docs/                Setup, API, and architecture notes
server/src/engine/   Core simulation: game loop, world, pathfinding, collision
server/src/network/  WebSocket protocol and server
server/src/debug/    Debug HTTP API, scenarios, ASCII map renderer
server/src/npc/      Memory manager and placeholder embeddings
server/src/db/       PostgreSQL client, schema, repository, migrations
server/test/         Vitest suite and in-memory helpers
```

## Development Notes

- Runtime server startup requires PostgreSQL because it runs migrations on boot.
- Tests do not require PostgreSQL or Docker.
- The browser client fetches `/api` and `/data` through Vite's proxy, but connects to WebSocket port `3001` directly.
- The server does not currently auto-load `.env`; Docker Compose is the simplest runtime path.

## Common Commands

```bash
# repo-level test shortcut
npm test

# server-only dev loop
cd server && npm run dev

# client-only dev server
cd client && npm run dev

# performance tests
cd server && npm run test:perf
```

## Documentation

- [Getting started](docs/getting-started.md)
- [Debug API reference](docs/debug-api.md)
- [Architecture overview](docs/architecture.md)

## Current Status

The simulation, debug tooling, browser client, and memory storage are implemented. NPC reasoning is still placeholder-driven rather than LLM-driven.
