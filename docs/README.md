# Documentation Index

This folder tracks docs that describe the current codebase, plus a small set
of design notes that still guide in-progress work.

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

## Design Notes

These pages are partly aspirational. They mix shipped behavior with direction
for in-progress systems, so read them as context rather than API reference.

- [Civilization design](civilization-design.md): long-form NPC redesign toward
  a primordial civilization-building simulation. Includes a Current State
  section describing what already ships.
- [Art and UI redesign spec](art-redesign-spec.md): art direction pass for a
  cohesive primordial aesthetic, with implementation notes tracking which
  phases have landed.

## Quick File Navigation

| File | What it does | Doc page |
| --- | --- | --- |
| `server/src/bootstrap/runtime.ts` | Runtime composition and wiring | [Architecture](architecture.md) |
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
- Keep reference pages scoped to shipped behavior. Direction for unshipped
  work belongs under Design Notes and must mark what is already landed.
