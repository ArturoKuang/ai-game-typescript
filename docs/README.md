# Documentation Index

This folder is the project reference set for the current AI Town codebase. It is organized by runtime system, subsystem, and component so you can move from the top-level architecture down to individual files without reverse-engineering the repository first.

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

## Design And Historical Notes

- [Movement overhaul plan](movement-overhaul-plan.md): historical design doc for the current continuous-movement model.
- [Chemistry system design](chemistry-system-design.md): forward-looking design notes for a future chemistry/physics layer.
- [OpenClaw overview](openclaw-overview.md): external architecture notes captured in this repo.
- [OpenClaw agentic loop](openclaw-agentic-loop.md): deeper notes on that external agent loop.

## Documentation Conventions

- System docs describe current behavior from source, not intended behavior.
- Component names generally match file names and import boundaries.
- Caveats are called out when a surface bypasses the normal event flow or persistence path.
- When docs and code disagree, the code in `client/`, `server/src/`, and `data/` is the source of truth.
