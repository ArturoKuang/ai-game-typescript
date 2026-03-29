# AI Town

AI Town is a multiplayer social-simulation sandbox built around an authoritative TypeScript game loop, a PixiJS browser client, a WebSocket transport layer, and a debug-first local workflow.

The current codebase includes:

- a deterministic `GameLoop` running at 20 ticks/sec in realtime mode
- a `20 x 20` town loaded from [`data/map.json`](data/map.json)
- five default NPCs spawned on boot from [`server/src/data/characters.ts`](server/src/data/characters.ts)
- continuous keyboard movement, A* click-to-move, and player collision
- conversations that move through `invited -> walking -> active -> ended`
- NPC memory and generation persistence backed by PostgreSQL when available, with in-memory fallback when it is not
- a Claude CLI NPC provider with a deterministic scripted fallback
- a Vitest suite and headless movement harness that run fully in memory

## One-Time Setup

Install dependencies in the repo root plus the two app packages:

```bash
npm install
cd server && npm install
cd ../client && npm install
```

## Quick Start

### Run the tests

```bash
cd server
npm test
```

Or from the repo root:

```bash
npm test
```

### Run the host-only stack without PostgreSQL

This is enough for local gameplay, browser checks, WebSocket probes, and debug API inspection:

```bash
cd server
unset DATABASE_URL
npm run dev
```

In a second terminal:

```bash
cd client
npm run dev -- --host 0.0.0.0
```

### Run the Docker-backed stack with PostgreSQL

```bash
docker compose up --build -d
cd client && npm run dev
```

Verify the runtime:

```bash
curl localhost:3001/health
curl localhost:3001/api/debug/state
curl localhost:3001/api/debug/map
```

Useful repo-level shortcuts:

- `npm run dev`: Docker DB + Docker game server + local Vite client
- `npm run dev:host-server`: Docker DB + host game server + local Vite client

## Runtime Notes

- The server can start without PostgreSQL. If `DATABASE_URL` is unset or the DB is unreachable, it falls back to in-memory NPC persistence and `/health` reports `status: "degraded"`.
- The browser fetches `/api/*` and `/data/*` through the Vite proxy, but opens its WebSocket directly to port `3001`.
- The server does not auto-load `.env`; environment variables must come from Docker Compose or the shell.

## Project Layout

```text
client/              PixiJS browser client
data/                Shared map and NPC definitions
docs/                Architecture, API, testing, and workflow docs
server/src/engine/   Authoritative simulation core
server/src/network/  WebSocket protocol and server
server/src/debug/    Debug API, ASCII map, scenarios, movement harness
server/src/npc/      NPC memory, provider stack, and orchestration
server/src/db/       PostgreSQL + in-memory persistence implementations
server/test/         Vitest suite and stepped runtime helpers
```

## Documentation

- [Documentation index](docs/README.md)
- [Getting started](docs/getting-started.md)
- [Architecture](docs/architecture.md)
- [Debug API reference](docs/debug-api.md)
- [Testing guide](docs/testing.md)
