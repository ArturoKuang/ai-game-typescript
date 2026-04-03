# Component Catalog

This is the file-level map of the repository’s main systems, subsystems, and components.

## Root

| Path | Role |
| --- | --- |
| `AGENTS.md` | Repository-specific instructions for coding agents. |
| `README.md` | High-level project overview outside the docs set. |
| `package.json` | Root scripts for tests, linting, and combined dev flows. |
| `docker-compose.yml` | Development topology for PostgreSQL and the game server. |
| `biome.json` | Formatting and linting configuration. |

## Client

| Path | Role |
| --- | --- |
| `client/package.json` | Client scripts and dependency list. |
| `client/vite.config.ts` | Dev-server config and proxy rules. |
| `client/index.html` | Browser shell and inline CSS layout. |
| `client/src/main.ts` | Client bootstrap, state coordination, input handling, prediction loop. |
| `client/src/network.ts` | Browser WebSocket client wrapper. |
| `client/src/renderer.ts` | PixiJS tile, player, line, and bubble rendering. |
| `client/src/ui.ts` | Sidebar DOM bindings for join, chat, player list, and status. |
| `client/src/prediction.ts` | Pure client-side movement and collision prediction helpers. |
| `client/src/debugLog.ts` | Browser-side reconciliation debug ring buffer. |
| `client/src/types.ts` | Client mirror of core runtime and protocol types. |

## Server Bootstrap

| Path | Role |
| --- | --- |
| `server/package.json` | Server scripts and dependencies. |
| `server/tsconfig.json` | TypeScript compile configuration. |
| `server/vitest.config.ts` | Vitest configuration. |
| `server/Dockerfile` | Server development image. |
| `server/src/index.ts` | Express/HTTP/WebSocket boot sequence and event bridge. |

## Engine

| Path | Role |
| --- | --- |
| `server/src/engine/types.ts` | Core runtime types, events, and queued commands. |
| `server/src/engine/gameLoop.ts` | Authoritative simulation coordinator and tick pipeline. |
| `server/src/engine/world.ts` | Static world representation and walkability queries. |
| `server/src/engine/pathfinding.ts` | 4-directional A* implementation. |
| `server/src/engine/collision.ts` | Continuous movement collision resolution for blocked tiles. |
| `server/src/engine/conversation.ts` | Conversation state machine and message storage. |
| `server/src/engine/logger.ts` | In-memory event ring buffer. |
| `server/src/engine/rng.ts` | Seeded PRNG for deterministic tests and future runtime randomness. |

## Networking

| Path | Role |
| --- | --- |
| `server/src/network/protocol.ts` | Server/client WebSocket protocol definitions. |
| `server/src/network/websocket.ts` | WebSocket server, connection lifecycle, message handlers. |

## Debug

| Path | Role |
| --- | --- |
| `server/src/debug/router.ts` | `/api/debug` router and operational controls. |
| `server/src/debug/asciiMap.ts` | ASCII renderer for current map/player state. |
| `server/src/debug/scenarios.ts` | Named scenario setups used by the debug API. |
| `server/src/debug/conversationHarness.ts` | Live conversation harness that drives a managed server over WebSocket and the debug API. |
| `server/src/debug/movementHarness.ts` | Headless scripted movement harness. |
| `server/src/debug/runConversationHarness.ts` | CLI wrapper for the live conversation harness. |
| `server/src/debug/runMovementHarness.ts` | CLI wrapper for the movement harness. |

## NPC System

| Path | Role |
| --- | --- |
| `server/src/npc/embedding.ts` | Embedder interface, placeholder embedder, cosine similarity. |
| `server/src/npc/memory.ts` | Memory manager and reflection heuristics. |
| `server/src/npc/provider.ts` | NPC provider interface and prompt construction helpers. |
| `server/src/npc/scriptedProvider.ts` | Deterministic fallback dialogue/reflection provider. |
| `server/src/npc/claudeCodeProvider.ts` | CLI bridge to the Claude tool for NPC outputs. |
| `server/src/npc/resilientProvider.ts` | Primary/fallback provider wrapper. |
| `server/src/npc/orchestrator.ts` | Conversation-driven NPC reply, reflection, and initiation coordinator. |

## Persistence

| Path | Role |
| --- | --- |
| `server/src/db/client.ts` | PostgreSQL pool creation and connectivity checks. |
| `server/src/db/migrate.ts` | Schema application runner. |
| `server/src/db/repository.ts` | MemoryStore interface plus Postgres/in-memory memory implementations. |
| `server/src/db/npcStore.ts` | NPC persistence abstraction plus Postgres/in-memory implementations. |
| `server/src/db/schema.sql` | PostgreSQL schema and indexes. |

## Shared Data

| Path | Role |
| --- | --- |
| `data/map.json` | Canonical map layout, activities, and spawn points. |
| `data/characters.ts` | Shared NPC definition copy. |
| `server/src/data/characters.ts` | Server-local NPC definition copy used at runtime. |

## Tests And Helpers

| Path | Role |
| --- | --- |
| `server/test/helpers/testGame.ts` | Main stepped-game fixture wrapper. |
| `server/test/helpers/mapGenerator.ts` | Open-map generation helper for scale/perf tests. |
| `server/test/engine.test.ts` | General engine tests. |
| `server/test/pathfinding.test.ts` | A* tests. |
| `server/test/collision.test.ts` | Collision tests. |
| `server/test/input-movement.test.ts` | Continuous input movement tests. |
| `server/test/runtime-contracts.test.ts` | Runtime movement contract tests. |
| `server/test/client-server-parity.test.ts` | Client/server prediction parity tests. |
| `server/test/debug-invariants.test.ts` | Invariant enforcement tests. |
| `server/test/command-queue.test.ts` | Command queue tests. |
| `server/test/event-contracts.test.ts` | Event shape and ordering contract tests. |
| `server/test/logger-contracts.test.ts` | Logger retention and filter contract tests. |
| `server/test/conversation.test.ts` | Conversation lifecycle tests. |
| `server/test/conversation-index.test.ts` | Conversation player-index correctness tests. |
| `server/test/websocket.test.ts` | WebSocket behavior tests. |
| `server/test/debug-api.test.ts` | Debug API tests. |
| `server/test/movement-harness.test.ts` | Movement harness tests. |
| `server/test/memory.test.ts` | Memory manager tests. |
| `server/test/reflection.test.ts` | Reflection tests. |
| `server/test/npc-orchestrator.test.ts` | NPC orchestrator tests. |
| `server/test/provider-failure.test.ts` | Provider failure and fallback tests. |
| `server/test/gameloop-smoke.test.ts` | Full-loop smoke tests. |
| `server/test/readability-contracts.test.ts` | Pre-refactor contract tests. |
| `server/test/performance.test.ts` | Throughput and scalability benchmarks. |
| `server/test/perf-regression.test.ts` | Hot-path regression benchmarks. |

## Docs

| Path | Role |
| --- | --- |
| `docs/README.md` | Documentation entry point. |
| `docs/getting-started.md` | Local setup and first-run workflow. |
| `docs/architecture.md` | High-level architecture and system flows. |
| `docs/server-engine.md` | Engine subsystem reference. |
| `docs/networking.md` | Networking subsystem reference. |
| `docs/debug-tooling.md` | Debug subsystem reference. |
| `docs/npc-system.md` | NPC subsystem reference. |
| `docs/persistence.md` | Persistence subsystem reference. |
| `docs/client-system.md` | Browser client subsystem reference. |
| `docs/shared-data.md` | Shared data reference. |
| `docs/infrastructure.md` | Infrastructure and runtime topology reference. |
| `docs/testing.md` | Test-system reference. |
| `docs/debug-api.md` | Route-level debug API reference. |
| `docs/debugging-workflow.md` | Bug reproduction and verification workflow. |
| `docs/architecture-review.md` | Current architecture risks and refactor candidates. |
| `docs/chemistry-system-design.md` | Future design note for chemistry/physics. |
