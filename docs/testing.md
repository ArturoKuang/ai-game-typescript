# Testing

This document covers the automated test suite in `server/test/` plus the
movement and conversation harnesses in `server/src/debug/`.

## Testing Model

The project favors deterministic, in-memory verification.

Core principles:

- exercise the engine without network or database dependencies when possible
- test runtime behavior, not isolated helper math
- keep client prediction aligned with server movement
- use invariant checks to catch silent corruption

## Main Helpers

### `server/test/helpers/testGame.ts`

`TestGame` wraps a stepped `GameLoop` and is the main runtime fixture for tests.

It supports:

- loading a small map or the default map
- spawning players
- ticking
- moving players
- fetching live player state

### `server/test/helpers/mapGenerator.ts`

Utility for generating larger open maps for performance and scale tests.

## Important Test Areas

The current suite covers:

- engine lifecycle and command queue behavior
- movement, collision, and pathfinding
- conversation lifecycle and indexing
- debug API behavior
- WebSocket behavior
- bear combat and item flows
- autonomy planning, execution, and survival state
- NPC provider fallback behavior
- memory and reflection logic
- performance and regression gates
- client/server movement parity

## Commands

```bash
cd server
npm test
npx tsc --noEmit
npm run test:watch
npm run test:perf
npm run debug:movement -- --list
npm run debug:conversation -- --list
```

## Strategy By Concern

### Movement And Collision

Preferred layers:

1. runtime contracts
2. client/server parity tests
3. invariant tests
4. harness replay when a bug needs a saved repro

### Conversations

Prefer tests that cover:

- state transitions
- active versus inactive message rules
- timeout and max-message endings
- interaction with NPC orchestration when relevant

### Autonomy, Combat, And Memory

Use the in-memory stores plus the placeholder embedder so tests stay
deterministic and do not require external services.

## Harnesses

### Movement Harness

Best for:

- reproducing input ordering bugs
- capturing event traces
- saving replay bundles

### Conversation Harness

Best for:

- running a real server process for conversation-level checks
- validating WebSocket broadcast behavior
- testing flows that need live routing instead of direct debug mutations

## Verification Guidance

For code changes, the minimum useful loop is usually:

1. add or update a runtime-facing test
2. run `npm test`
3. run `npx tsc --noEmit`
4. run a harness or `/api/debug` check if the bug is behavior-heavy

Avoid baking suite counts or file counts into docs; they change too often to be
useful.
