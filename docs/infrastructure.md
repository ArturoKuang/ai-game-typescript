# Infrastructure

This document covers runtime topology, scripts, Docker, ports, and environment variables.

## Topologies

### Test Topology

- no Docker required
- no PostgreSQL required
- stepped in-memory `GameLoop`
- Vitest runs entirely in process

### Host Runtime Topology

- browser dev server on `:5173`
- game server on `:3001`
- optional PostgreSQL on `:5432`

### Docker Runtime Topology

`docker-compose.yml` starts:

- `db`: `pgvector/pgvector:pg16`
- `game-server`: Node 20 container running `tsx watch src/index.ts`

Mounted volumes:

- `./server/src -> /app/src`
- `./server/test -> /app/test`
- `./server/vitest.config.ts -> /app/vitest.config.ts`
- `./data -> /app/data`

This is set up for live-edit development inside the container.

## Ports

- `3001`: Express + WebSocket server
- `5173`: Vite dev server
- `5432`: PostgreSQL with pgvector

## Scripts

### Repo Root

From `package.json`:

- `npm test`: run `server` tests
- `npm run test:perf`: run performance-only tests
- `npm run check`: Biome check
- `npm run check:fix`: Biome fix
- `npm run dev`: Docker server plus local client via `concurrently`
- `npm run dev:host-server`: Docker DB, host server, local client

### Server

From `server/package.json`:

- `npm run dev`: `tsx watch src/index.ts`
- `npm run start`: one-shot server start
- `npm run debug:movement`: movement harness CLI
- `npm test`: full Vitest suite
- `npm run test:perf`: performance tests only
- `npm run test:watch`: Vitest watch mode

### Client

From `client/package.json`:

- `npm run dev`
- `npm run build`
- `npm run preview`

## Environment Variables

Recognized runtime environment variables:

- `DATABASE_URL`: enables PostgreSQL-backed persistence when reachable
- `PORT`: server listen port, default `3001`
- `NPC_MODEL`: optional model name forwarded to the Claude CLI provider
- `CLAUDE_COMMAND`: optional absolute path or command name for the Claude CLI binary

Important note:

- The repo includes a `dotenv` dependency, but `server/src/index.ts` does not load `.env` automatically. Environment variables must currently come from Docker Compose or the shell.

## Docker Files

### `docker-compose.yml`

Current Compose behavior:

- starts PostgreSQL and waits for health before starting the server
- passes `DATABASE_URL` pointing at the Compose DB service
- binds source directories for live reload

### `server/Dockerfile`

Current image behavior:

- based on `node:20-slim`
- installs dependencies
- copies `tsconfig.json` and `src/`
- exposes `3001`
- runs `npx tsx watch src/index.ts`

Notable limitation:

- the Dockerfile does not copy `data/`; Compose relies on a volume mount instead

## Operational Notes

- The runtime server can start without PostgreSQL if `DATABASE_URL` is omitted or the database is unavailable.
- The browser client always expects the game server on port `3001`.
- In Docker mode, the game server uses database-backed persistence by default.
