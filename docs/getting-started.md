# Getting Started

This project has two distinct workflows:

- Runtime workflow: browser client + game server + PostgreSQL
- Test workflow: in-memory Vitest suite with no database required

## Prerequisites

- Node.js 20+
- Docker Desktop or another Docker runtime for the easiest full-stack setup

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
- The server immediately spawns all five NPCs from `data/characters.ts`
- The game loop runs in `realtime` mode at 20 ticks/sec

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

## Local Server Workflow Without Docker

The server can run outside Docker, but it still needs PostgreSQL because startup applies the schema before listening.

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
cd server
npm run dev
```

Note: the repo includes `.env.example`, but the server does not currently auto-load `.env`.

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

The runtime server requires PostgreSQL at boot. Use Docker Compose or start a local Postgres instance with pgvector enabled.

### I want a clean simulation state

Prefer `POST /api/debug/scenario` over `POST /api/debug/reset`.

`/reset` clears the game loop's world as well as its players, so the normal map is not reloaded automatically afterward.

### I need to inspect browser-side reconciliation

Open the browser console and inspect:

```js
window.__AI_TOWN_CLIENT_DEBUG__?.getEvents()
```

This shows recent client-side reconciliation corrections so you can distinguish prediction drift from server-authoritative bugs.
