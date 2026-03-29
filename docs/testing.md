# Testing

This document covers the test suite in `server/test/` and the movement harness in `server/src/debug/`.

## Testing Model

The project’s tests are intentionally in-memory and deterministic.

Core principles:

- the engine is exercised without network or database dependencies
- gameplay behavior is tested at the runtime-contract level
- client prediction is checked against server behavior
- debug invariants are available to catch silent corruption

## Helpers

### `server/test/helpers/testGame.ts`

`TestGame` is the main fixture wrapper around a stepped `GameLoop`.

It provides convenience methods for:

- loading a mini map or the default map
- spawning players
- ticking
- assigning path targets
- fetching players
- spawning nearby pairs

### `server/test/helpers/mapGenerator.ts`

Utility for generating open bordered maps of arbitrary size for performance and scalability tests.

## Suite Coverage

Current suites:

| File | Focus |
| --- | --- |
| `engine.test.ts` | general game loop behavior |
| `pathfinding.test.ts` | A* pathfinding |
| `collision.test.ts` | wall and player collision |
| `input-movement.test.ts` | continuous input movement |
| `runtime-contracts.test.ts` | gameplay-level movement semantics |
| `client-server-parity.test.ts` | prediction vs authority alignment |
| `debug-invariants.test.ts` | invariant validation failures |
| `command-queue.test.ts` | queued command behavior |
| `conversation.test.ts` | conversation lifecycle and messaging |
| `websocket.test.ts` | protocol/server socket behavior |
| `debug-api.test.ts` | debug router behavior |
| `movement-harness.test.ts` | headless harness verification |
| `memory.test.ts` | memory storage and retrieval |
| `reflection.test.ts` | reflection generation thresholds |
| `npc-orchestrator.test.ts` | NPC reply/initiation/reflection orchestration |
| `performance.test.ts` | pathfinding and tick throughput benchmarks |

## Commands

Useful commands:

```bash
cd server
npm test
npm run test:watch
npm run test:perf
npm run debug:movement -- --list
npm run debug:movement -- --scenario simultaneous_input_release
```

## Test Strategy By Concern

### Movement And Collision

Preferred layers:

1. runtime contracts
2. client/server parity
3. invariant checks
4. movement harness replay

This is stronger than unit-testing helpers in isolation because it exercises the actual movement state machine.

### Conversations

Prefer tests that cover:

- conversation state transitions
- active/inactive messaging rules
- timeout and max-message endings
- interaction with NPC orchestration when relevant

### NPC And Memory

Use in-memory repository/store implementations plus the placeholder embedder so tests remain deterministic and do not require external services.

## Harnesses

### Movement Harness

The movement harness is the main non-browser repro tool.

It is useful for:

- reproducing input sequencing bugs
- saving bundles as repro artifacts
- getting an event trace plus ASCII snapshots
- verifying expected movement traces without a live server

### Live Debug API

For end-to-end validation against a running server, use `/api/debug` in addition to the unit suite.

Common checks:

- `/api/debug/state`
- `/api/debug/map`
- `/api/debug/players`
- `/api/debug/log`

## Current Baseline

At the time of this documentation update, the suite passes in the current worktree with:

- `16` test files
- `143` tests

Run the suite again after any gameplay or protocol change because many subsystems depend on shared player and conversation state.
