# Getting Started

There are two practical workflows in this repo:

- local runtime: browser client plus game server, with PostgreSQL optional
- test workflow: in-memory Vitest and harness runs with no database required

## Prerequisites

- Node.js 20+
- Docker only if you want the bundled PostgreSQL container

Install once:

```bash
npm install
cd server && npm install
cd ../client && npm install
```

## Recommended Local Runtime

Run the server on the host and let it fall back to in-memory persistence:

```bash
cd server
unset DATABASE_URL
npm run dev
```

In a second terminal, start the client:

```bash
cd client
npm run dev -- --host 0.0.0.0
```

Open `http://localhost:5173`.

For the dedicated live debug dashboard, open
`http://localhost:5173/debug.html`.

Why this is the default path:

- no PostgreSQL is required
- the debug API and WebSocket are both available on `:3001`
- the server can use a host-installed `claude` CLI if you have one

## Optional PostgreSQL Runtime

If you want persisted memories and conversation metadata, start the DB and run
the server on the host:

```bash
docker compose up -d db
cd server
export DATABASE_URL=postgres://aitown:aitown_dev@localhost:5432/aitown
npm run dev
```

You can also use the repo shortcut:

```bash
npm run dev:host-server
```

`npm run dev` runs the game server in Docker. That is useful for a fully
containerized loop, but it usually cannot see your host `claude` CLI, so NPC
dialogue falls back to scripted responses.

## First Checks

After the server is up:

```bash
curl localhost:3001/health
curl localhost:3001/api/debug/state
curl localhost:3001/api/debug/map
curl localhost:3001/api/debug/players
```

What to expect:

- the world is loaded from `data/map.json`
- the default NPC cast is spawned on boot
- the loop starts in `realtime` mode at 20 ticks/sec
- `/health` returns `status: "degraded"` when running without PostgreSQL

## First Interaction Loop

Once the client is open:

1. Enter a name and click `Join`.
2. Use `WASD` or the arrow keys for held-input movement.
3. Click the map to use server-side pathfinding.
4. Press `E` to pick up the nearest item.
5. Press `I` to toggle the inventory panel.

Useful UI surfaces:

- the sidebar lists nearby players and conversation actions
- the inventory panel exposes `Eat` buttons for edible items
- the survival panel shows health, food, water, and social values
- the debug menu can poll conversation and autonomy state from the server

## Tests And Harnesses

The tests do not require PostgreSQL.

```bash
cd server
npm test
npx tsc --noEmit
```

Useful variants:

```bash
cd server && npm run test:watch
cd server && npm run test:perf
cd server && npm run debug:movement -- --list
cd server && npm run debug:conversation -- --list
```

## Common Debug Commands

```bash
curl localhost:3001/api/debug/state
curl localhost:3001/api/debug/map
curl localhost:3001/api/debug/conversations
curl localhost:3001/api/debug/autonomy/state
curl 'localhost:3001/api/debug/log?limit=20'
```

To switch to stepped mode:

```bash
curl -X POST localhost:3001/api/debug/mode \
  -H 'Content-Type: application/json' \
  -d '{"mode":"stepped"}'

curl -X POST localhost:3001/api/debug/tick \
  -H 'Content-Type: application/json' \
  -d '{"count":10}'
```

## Troubleshooting

### The browser loads but no live updates appear

The browser fetches `/api` and `/data` through Vite, but it connects its
WebSocket directly to `localhost:3001`. Make sure the game server is reachable
there.

### The server starts but `/health` says `degraded`

That means PostgreSQL is not available and the server is using in-memory
persistence. This is fine for most local development.

### NPC replies are scripted

The primary provider shells out to the `claude` CLI. If the command cannot be
resolved or a provider failure trips the fallback logic, the runtime downgrades
to scripted replies. Check:

```bash
curl localhost:3001/health
```

Look at `npcPrimaryAvailable`, `npcProviderCommand`, and
`npcProviderCommandResolved`.

### I need a clean runtime state

Prefer `POST /api/debug/scenario` over `POST /api/debug/reset`.

`/scenario` keeps the loaded world and respawns a known cast. `/reset` clears
the game state more aggressively.
