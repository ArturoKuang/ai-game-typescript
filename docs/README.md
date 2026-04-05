# Documentation Index

This folder only tracks docs that describe the current codebase. Stale design
notes and speculative pages were removed so the remaining set can stay useful.

If a behavior is not covered here, the source of truth is the code in
`client/`, `server/src/`, and `data/`.

## Start Here

- [Getting started](getting-started.md): local setup, first runtime checks, and
  common commands.
- [Architecture](architecture.md): runtime ownership, boot flow, and major data
  paths.
- [Debug API reference](debug-api.md): route reference for `/api/debug`.

## Runtime Systems

- [Server engine](server-engine.md): authoritative simulation, movement,
  conversations, events, and invariants.
- [Networking](networking.md): WebSocket protocol, HTTP surfaces, and transport
  boundaries.
- [NPC system](npc-system.md): autonomy, dialogue orchestration, providers, and
  memory.
- [Client system](client-system.md): browser bootstrap, prediction, rendering,
  UI, and debug overlay behavior.
- [Persistence](persistence.md): database wiring, repositories, and fallback
  modes.
- [Shared data](shared-data.md): map content, NPC definitions, and runtime data
  ownership.
- [Infrastructure](infrastructure.md): scripts, ports, Docker, and environment
  variables.
- [Testing](testing.md): suite structure, harnesses, and verification workflow.

## Debugging And Workflow

- [Debug tooling](debug-tooling.md): router, harnesses, ASCII map, and capture
  surfaces.
- [Debugging workflow](debugging-workflow.md): recommended bug-repro loop for
  movement and simulation issues.

## Quick File Navigation

| File | What it does | Doc page |
| --- | --- | --- |
| `server/src/index.ts` | Runtime bootstrap and wiring | [Architecture](architecture.md) |
| `server/src/engine/gameLoop.ts` | Tick pipeline and command processing | [Server engine](server-engine.md) |
| `server/src/network/websocket.ts` | WebSocket server and event bridge | [Networking](networking.md) |
| `server/src/debug/router.ts` | Debug API routes | [Debug API](debug-api.md) |
| `server/src/autonomy/manager.ts` | NPC autonomy and survival state | [NPC system](npc-system.md) |
| `server/src/npc/orchestrator.ts` | NPC dialogue scheduling and memory hooks | [NPC system](npc-system.md) |
| `client/src/main.ts` | Browser coordinator and debug polling | [Client system](client-system.md) |
| `client/src/renderer.ts` | PixiJS renderer and overlays | [Client system](client-system.md) |

## Conventions

- Prefer stable behavior over exact counts when writing docs.
- Call out caveats when a route or workflow bypasses the normal runtime path.
- Keep docs scoped to shipped behavior, not planned systems.
