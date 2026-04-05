# Getting Started

This project has two distinct workflows:

- Runtime workflow: browser client + game server, with PostgreSQL optional
- Test workflow: in-memory Vitest suite with no database required

## Prerequisites

- Node.js 20+
- Docker Desktop or another Docker runtime for the easiest full-stack setup

One-time dependency install:

```bash
npm install
cd server && npm install
cd ../client && npm install
```

Use the [documentation index](README.md) if you need subsystem-specific references after setup.

## Fastest Full-Stack Path

### 1. Start PostgreSQL and the game server

```bash
docker compose up --build -d
```

This starts:

- PostgreSQL + pgvector on `localhost:5432`
- The TypeScript game server on `localhost:3001`

Verify it is up:

```bash
curl localhost:3001/health
curl localhost:3001/api/debug/state
```

Expected behavior:

- The server loads `data/map.json` on boot
- The server immediately spawns all five NPCs from `server/src/data/characters.ts`
- The game loop runs in `realtime` mode at 20 ticks/sec
- The server reports `status: "ok"` at `/health` because PostgreSQL is available

### 2. Inspect the town from the terminal

```bash
curl localhost:3001/api/debug/map
curl localhost:3001/api/debug/players
curl localhost:3001/api/debug/activities
```

If you want a different test setup, replace the default population with a scenario:

```bash
curl -X POST localhost:3001/api/debug/scenario \
  -H 'Content-Type: application/json' \
  -d '{"name":"crowded_town"}'
```

Available scenario names:

- `empty`
- `two_npcs_near_cafe`
- `crowded_town`

### 3. Start the browser client

In a second terminal:

```bash
cd client
npm install
npm run dev
```

Open `http://localhost:5173`.

### 4. Join and move

Once the client is open:

1. Enter a name and click `Join`
2. Use `WASD` or the arrow keys for continuous movement
3. Click a destination tile to use server-side pathfinding

Behavior to know:

- Keyboard movement sends `input_start` / `input_stop` messages and is resolved on the server tick loop with collision.
- Click-to-move sends a target position and follows an A* path.
- Chat is disabled until you have joined.

## Repo Shortcuts

If you want the combined dev flows from the repo root:

- `npm run dev`: Docker PostgreSQL + Docker game server + local Vite client
- `npm run dev:host-server`: Docker PostgreSQL + host game server + local Vite client

**Important:** NPC conversations are powered by the `claude` CLI, which must be available on the machine running the game server. When using `npm run dev`, the server runs inside Docker where `claude` is not installed — NPC dialogue will fall back to scripted template responses. Use `npm run dev:host-server` to run the server on your host machine so it can access your local `claude` CLI for LLM-powered conversations.

## Local Server Workflow Without Docker

The server can run directly on the host in two ways:

### Option 1: Host server with PostgreSQL

The default connection string in code is:

```text
postgres://aitown:aitown_dev@localhost:5432/aitown
```

If your local database uses that default, you can run the server directly:

```bash
cd server
npm install
npm run dev
```

If you need different values, export them in your shell before starting the server:

```bash
export DATABASE_URL=postgres://USER:PASS@HOST:5432/aitown
export PORT=3001
export NPC_MODEL=your-model-name   # optional, passed to the Claude CLI provider
export CLAUDE_COMMAND=/absolute/path/to/claude   # optional, overrides PATH lookup
cd server
npm run dev
```

### Option 2: Host server with no PostgreSQL

If `DATABASE_URL` is unset, or if the database is unreachable, the server still starts and falls back to in-memory persistence for NPC conversations, memories, and generations:

```bash
cd server
unset DATABASE_URL
npm install
npm run dev
```

Expected behavior in this mode:

- `/health` returns `status: "degraded"`
- NPC memory and generation history is process-local only
- Tests and most debug workflows still work normally

Note: the repo includes a `dotenv` dependency, but the server does not currently auto-load `.env`.

## Running Tests

Tests are fully in-memory and do not need PostgreSQL.

```bash
cd server
npm install
npm test
```

Or from the repo root:

```bash
npm test
```

Useful variants:

```bash
cd server && npm run test:watch
cd server && npm run test:perf
cd server && npm run debug:movement -- --list
cd server && npm run debug:movement -- --scenario path_handoff
cd server && npm run debug:movement -- --scenario simultaneous_input_release --bundle /tmp/w-a.json
```

The movement harness is a headless repro tool for movement and collision bugs. It runs against the same in-memory game loop as the tests, prints snapshots and filtered debug events, verifies expected traces, and can save replay bundles for future debugging without PostgreSQL.

## Useful First Debug Commands

```bash
curl localhost:3001/api/debug/state
curl localhost:3001/api/debug/map
curl 'localhost:3001/api/debug/log?type=input_state,input_move,player_collision,move_cancelled&limit=20'
curl localhost:3001/api/debug/conversations
```

To switch the loop to manual stepping:

```bash
curl -X POST localhost:3001/api/debug/mode \
  -H 'Content-Type: application/json' \
  -d '{"mode":"stepped"}'

curl -X POST localhost:3001/api/debug/tick \
  -H 'Content-Type: application/json' \
  -d '{"count":10}'
```

## Troubleshooting

### `curl localhost:3001/health` fails

Check the containers:

```bash
docker compose ps
docker compose logs game-server
docker compose logs db
```

### The browser loads but no live updates appear

The browser client connects its WebSocket directly to port `3001`. Make sure the game server is reachable there.

### Local server start fails with a database error

If you want database-backed persistence, start PostgreSQL first and verify `DATABASE_URL`.

If you only need the runtime server for local simulation or documentation examples, unset `DATABASE_URL` and run with the in-memory fallback instead.

### I want a clean simulation state

Prefer `POST /api/debug/scenario` over `POST /api/debug/reset`.

`/reset` clears the game loop's world as well as its players, so the normal map is not reloaded automatically afterward.

### NPC conversations are scripted / not using the LLM

The NPC provider uses the `claude` CLI as a subprocess. If the CLI is not found, every call fails and the server falls back to `ScriptedNpcProvider`, which produces template responses like *"You mentioned X. Tell me a little more."*

This happens when:

- The server runs inside Docker (`npm run dev`) where `claude` is not installed
- The `claude` CLI is not on your PATH

Fix: use `npm run dev:host-server` instead, which runs the game server on the host where your local `claude` CLI is available. You can verify the provider status at any time:

```bash
curl localhost:3001/health
```

Look for `npcPrimaryAvailable: true` and `npcProviderCommandResolved` pointing to a valid path. If `npcPrimaryAvailable` is `false`, the server is using scripted fallback responses.

### I need to inspect browser-side reconciliation

Open the browser console and inspect:

```js
window.__AI_TOWN_CLIENT_DEBUG__?.getEvents()
```

This shows recent client-side reconciliation corrections so you can distinguish prediction drift from server-authoritative bugs.
