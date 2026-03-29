# Persistence

This document covers `server/src/db/` plus the runtime persistence modes chosen in `server/src/index.ts`.

## Runtime Modes

The project supports two persistence modes.

### PostgreSQL Mode

Activated when:

- `DATABASE_URL` is set
- `checkConnection()` succeeds

Behavior:

- run `schema.sql` at startup
- use `Repository` for memory storage
- use `PostgresNpcStore` for player/conversation/message/generation storage
- `/health` reports `status: "ok"`

### In-Memory Fallback Mode

Activated when:

- `DATABASE_URL` is missing, or
- the configured PostgreSQL instance is unavailable

Behavior:

- use `InMemoryRepository`
- use `InMemoryNpcStore`
- simulation still runs normally
- persistence is process-local only
- `/health` reports `status: "degraded"`

## Components

### `client.ts`

Owns connection pool creation and connectivity checks.

Defaults:

- connection string: `postgres://aitown:aitown_dev@localhost:5432/aitown`
- pool max: `10`
- idle timeout: `30000 ms`
- connection timeout: `5000 ms`

### `migrate.ts`

Applies the entire `schema.sql` file at startup. There is no incremental migration framework yet; the project relies on idempotent DDL.

### `repository.ts`

Defines the `MemoryStore` abstraction and its concrete implementations.

#### `Repository`

PostgreSQL-backed memory store.

Supports:

- add memory
- list memories
- vector similarity search
- access timestamp updates
- recent memory windows
- memory count queries
- old-memory deletion

It also includes `logEvent()` and `getLog()` helpers for `game_log`, though the live runtime currently uses the in-memory `GameLogger` instead.

#### `InMemoryRepository`

Process-local memory store used by tests and fallback runtime.

It mirrors the `MemoryStore` interface and uses in-memory cosine similarity for vector search.

### `npcStore.ts`

Defines `NpcPersistenceStore` and two implementations.

Responsibilities:

- upsert players
- upsert conversations
- persist conversation messages
- persist LLM generation metadata

#### `PostgresNpcStore`

Writes to:

- `players`
- `conversations`
- `messages`
- `llm_generations`

#### `InMemoryNpcStore`

Stores the same entities in Maps and arrays for tests and fallback runtime.

### `schema.sql`

Defines the current database schema.

Tables:

- `world`
- `activities`
- `players`
- `conversations`
- `messages`
- `memories`
- `llm_generations`
- `game_log`

Important indexes:

- ivfflat vector index on `memories.embedding`
- `(player_id, tick desc)` index for memories
- conversation generation index on `llm_generations`
- tick and player/tick indexes on `game_log`

## Storage Coverage

### What Is Persisted Today

When PostgreSQL is enabled, the runtime persists:

- NPC and human player state snapshots through debug spawn and orchestrator upserts
- conversations observed by `NpcOrchestrator`
- conversation messages observed by `NpcOrchestrator`
- NPC memories
- NPC reply/reflection generation metadata

### What Is Not Persisted Authoritatively Today

- the live world is still loaded from `data/map.json`, not from `world` / `activities`
- the authoritative runtime event log stays in `GameLogger`, not `game_log`
- queued commands are not stored
- current map mutations do not exist because world state is static

## Vector Search Details

Current memory embeddings are stored as `vector(1536)` and searched with cosine distance:

- SQL search computes `1 - (embedding <=> query)` as similarity
- memory retrieval then re-ranks using recency and importance on top of similarity

Because the embedder is deterministic and local, the full memory stack works in tests with no external services.

## Schema Caveats

- The schema is broader than the active runtime usage.
- `players.current_convo_id` exists, but `PostgresNpcStore.upsertPlayer()` currently writes `null` there.
- `conversations.started_at` and `messages.created_at` are DB timestamps rather than engine ticks.
- `conversations.ended_at` is written as `new Date()` when a conversation is ended through `PostgresNpcStore`, not from engine tick time.

## Operational Notes

- A database outage at startup downgrades the server to in-memory mode instead of crashing.
- There is no background persistence replay if the database becomes available later.
- There is no migration history table yet; `schema.sql` is simply re-applied on each boot in DB mode.
