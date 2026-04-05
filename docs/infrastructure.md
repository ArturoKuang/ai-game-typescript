# Infrastructure

This document covers runtime topologies, scripts, ports, Docker, and environment
variables.

## Runtime Shapes

### Test Mode

- no Docker required
- no PostgreSQL required
- stepped in-memory `GameLoop`
- Vitest runs entirely in process

### Host Runtime

- browser dev server on `:5173`
- game server on `:3001`
- optional PostgreSQL on `:5432`

This is the most practical local workflow because the server can use a host
`claude` CLI.

### Docker-Assisted Runtime

The repo still supports Docker-backed development:

- `db`: PostgreSQL with pgvector
- `game-server`: Node 20 container

Useful paths:

- `npm run dev`: Docker server plus local client
- `npm run dev:host-server`: Docker DB, host server, local client

## Ports

- `3001`: Express plus WebSocket server
- `5173`: Vite dev server
- `5432`: PostgreSQL with pgvector

## Scripts

### Repo Root

- `npm test`
- `npm run test:perf`
- `npm run check`
- `npm run check:fix`
- `npm run dev`
- `npm run dev:host-server`

### Server

- `npm run dev`
- `npm run start`
- `npm run debug:movement`
- `npm run debug:conversation`
- `npm test`
- `npm run test:perf`
- `npm run test:watch`

### Client

- `npm run dev`
- `npm run build`
- `npm run preview`

## Environment Variables

Recognized runtime variables:

- `DATABASE_URL`
- `PORT`
- `NPC_MODEL`
- `CLAUDE_COMMAND`

Important caveat:

- the repo includes a `dotenv` dependency, but `server/src/index.ts` does not
  auto-load `.env`

## Operational Notes

- The server starts without PostgreSQL and falls back to in-memory persistence
  when the DB is unavailable.
- The browser expects the authoritative server on port `3001`.
- Running the game server inside Docker is convenient, but it usually cannot
  access a host-installed `claude` CLI, so NPC dialogue may fall back to the
  scripted provider.
