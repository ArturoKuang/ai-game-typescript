# Documentation Index

This folder is the project reference set for the current AI Town codebase. It is organized by runtime system, subsystem, and component so you can move from the top-level architecture down to individual files without reverse-engineering the repository first.

The pages under `Runtime Systems` and `API And Workflow References` describe the code that exists today. The `Design Notes` section is intentionally separate because those files are exploratory and should not be treated as the runtime source of truth.

## Start Here

- [Getting started](getting-started.md): local setup, runtime modes, and first commands.
- [Architecture](architecture.md): system boundaries, boot flow, runtime ownership, and end-to-end data flow.
- [Component catalog](component-catalog.md): file-by-file map of the major project components.

## Runtime Systems

- [Server engine](server-engine.md): authoritative simulation, movement, conversations, events, and invariants.
- [Networking](networking.md): WebSocket protocol, HTTP surfaces, message flow, and client/server transport boundaries.
- [Debug tooling](debug-tooling.md): debug router, scenarios, ASCII rendering, harnesses, and operational caveats.
- [NPC system](npc-system.md): orchestration, memory retrieval, provider stack, reflections, and persistence hooks.
- [Persistence](persistence.md): database wiring, schema, repositories, in-memory fallbacks, and current storage gaps.
- [Client system](client-system.md): browser bootstrap, prediction, rendering, UI, and client debug hooks.
- [Shared data](shared-data.md): map content, NPC definitions, spawn/activity layout, and shared assets.
- [Infrastructure](infrastructure.md): scripts, Docker, ports, environment variables, and runtime topologies.
- [Testing](testing.md): test helpers, suite coverage, harnesses, and verification strategy.

## API And Workflow References

- [Debug API reference](debug-api.md): route-by-route reference for `/api/debug`.
- [Debugging workflow](debugging-workflow.md): recommended repro and verification loop for runtime bugs.

## Design Notes

- [Chemistry system design](chemistry-system-design.md): forward-looking design notes for a future chemistry/physics layer.
- [Architecture review](architecture-review.md): prioritized list of architectural improvements and tech debt.

## Quick File Navigation

If you're looking at a specific file and want context, here's a cheat sheet:

| File | What it does | Doc page |
|------|-------------|----------|
| `server/src/engine/gameLoop.ts` | Tick pipeline, movement, commands | [Server engine](server-engine.md) |
| `server/src/engine/collision.ts` | AABB tile collision resolution | [Server engine](server-engine.md) |
| `server/src/engine/pathfinding.ts` | A* with binary min-heap | [Server engine](server-engine.md) |
| `server/src/engine/conversation.ts` | Conversation state machine | [Server engine](server-engine.md) |
| `server/src/engine/types.ts` | All shared data models | [Server engine](server-engine.md) |
| `server/src/network/websocket.ts` | WebSocket server + event bridge | [Networking](networking.md) |
| `server/src/network/protocol.ts` | Message type definitions | [Networking](networking.md) |
| `server/src/npc/orchestrator.ts` | NPC reply scheduling + initiation | [NPC system](npc-system.md) |
| `server/src/npc/memory.ts` | Memory scoring + reflection trigger | [NPC system](npc-system.md) |
| `server/src/npc/provider.ts` | LLM interface + prompt builders | [NPC system](npc-system.md) |
| `server/src/db/repository.ts` | Memory persistence (pgvector) | [Persistence](persistence.md) |
| `server/src/debug/router.ts` | Debug API routes | [Debug API](debug-api.md) |
| `client/src/main.ts` | Client entry, reconciliation, input | [Client system](client-system.md) |
| `client/src/prediction.ts` | Client-side collision prediction | [Client system](client-system.md) |
| `client/src/renderer.ts` | PixiJS tile + player rendering | [Client system](client-system.md) |

## Documentation Conventions

- System docs describe current behavior from source, not intended behavior.
- Component names generally match file names and import boundaries.
- Caveats are called out when a surface bypasses the normal event flow or persistence path.
- When docs and code disagree, the code in `client/`, `server/src/`, and `data/` is the source of truth.
