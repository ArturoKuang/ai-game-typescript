# AI Town

AI Town is a multiplayer social-simulation sandbox with an authoritative
TypeScript server, a PixiJS browser client, survival-driven NPC autonomy,
conversation memory, and a debug-heavy local workflow.

The current runtime includes:

- a single-process `GameLoop` running at 20 ticks/sec in realtime mode
- a `20 x 20` map loaded from [`data/map.json`](data/map.json)
- five default NPCs loaded from
  [`server/src/data/characters.ts`](server/src/data/characters.ts)
- continuous input movement, click-to-move pathfinding, conversations, combat,
  items, and world entities
- NPC autonomy built around food, water, and social pressure plus GOAP-style
  action planning
- PostgreSQL-backed persistence when available, with in-memory fallback when it
  is not
- a local Claude CLI provider with scripted fallback
- a Vitest suite and harnesses that cover most runtime behavior without needing
  a database

## Install

```bash
npm install
cd server && npm install
cd ../client && npm install
```

## Quick Start

### Recommended: host-mode server without PostgreSQL

This is the fastest path for gameplay checks, browser work, and debug API use.

Server:

```bash
cd server
unset DATABASE_URL
npm run dev
```

Client:

```bash
cd client
npm run dev -- --host 0.0.0.0
```

Then open `http://localhost:5173`.

For the dedicated live debug dashboard, open `http://localhost:5173/debug.html`.

Useful health checks:

```bash
curl localhost:3001/health
curl localhost:3001/api/debug/state
curl localhost:3001/api/debug/map
```

### Optional: run with PostgreSQL

If you want database-backed persistence, start the DB container and run the
server on the host:

```bash
docker compose up -d db
cd server
export DATABASE_URL=postgres://aitown:aitown_dev@localhost:5432/aitown
npm run dev
```

Or use the repo helper:

```bash
npm run dev:host-server
```

`npm run dev` still runs the game server inside Docker. That is fine for some
UI work, but host-mode is usually better if you want the local `claude` CLI to
be available to the NPC provider.

## Useful Commands

```bash
npm test
cd server && npm test
cd server && npx tsc --noEmit
cd client && npm run build
cd server && npm run debug:movement -- --list
cd server && npm run debug:conversation -- --list
```

## Runtime Notes

- The server can start without PostgreSQL. If `DATABASE_URL` is missing or the
  database is unreachable, it falls back to in-memory persistence and `/health`
  reports `status: "degraded"`.
- The browser fetches `/api/*` and `/data/*` through Vite, but opens its
  WebSocket directly to port `3001`.
- The server does not auto-load `.env`; environment variables must come from
  Docker Compose or the shell.

## Project Layout

```text
client/              Browser client, debug dashboard, and UI shell
data/                Shared map data and stable top-level data re-exports
docs/                Maintained project docs
server/src/autonomy/ NPC autonomy, entities, and survival state
server/src/bears/    Bear combat and item interactions
server/src/debug/    Debug API, ASCII rendering, and harnesses
server/src/db/       PostgreSQL and in-memory persistence
server/src/engine/   Authoritative simulation core
server/src/network/  WebSocket protocol and server
server/src/npc/      NPC memory, provider stack, and dialogue orchestration
server/test/         Vitest suites and stepped runtime helpers
```

## Documentation

- [Documentation index](docs/README.md)
- [Getting started](docs/getting-started.md)
- [Architecture](docs/architecture.md)
- [Debug API reference](docs/debug-api.md)
- [Testing guide](docs/testing.md)
