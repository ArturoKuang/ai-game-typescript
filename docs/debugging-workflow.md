# Debugging Workflow

Use this workflow for movement, collision, and other simulation bugs.

## Order Of Operations

1. Reproduce the bug with a deterministic script.
2. Save a repro bundle before changing code.
3. Add a failing runtime-contract test.
4. Add or inspect logs that expose the broken state transition.
5. Fix the engine or prediction code.
6. Re-run the saved bundle, focused tests, and the full suite.

## Repro First

Prefer the movement harness over ad hoc shell scripts:

```bash
cd server
npm run debug:movement -- --list
npm run debug:movement -- --scenario simultaneous_input_release
npm run debug:movement -- --scenario simultaneous_input_release --bundle /tmp/w-a.json
```

The bundle contains:

- the map
- the scripted actions with tick numbers
- filtered event trace
- snapshots and ASCII maps
- built-in verification against the expected trace

For runtime server debugging, use the debug API:

```bash
curl 'localhost:3001/api/debug/log?playerId=human_1&type=input_state,input_move,player_collision,move_cancelled&limit=50'
curl localhost:3001/api/debug/players/human_1
curl localhost:3001/api/debug/map
```

## Test Strategy

Write tests at three levels.

1. Runtime contracts
   These assert gameplay semantics such as held-key ordering, integer-centered coordinates, path cancellation, or collision ownership.
2. Client/server parity
   These run the same input script through the server `GameLoop` and the pure client prediction helpers and assert they stay aligned.
3. Debug invariants
   These intentionally corrupt state and verify the debug checks fail loudly instead of letting the simulation silently self-heal.

## What To Avoid

Do not stop at tests that are too granular.

Bad examples:

- a movement test that only checks speed magnitude
- a collision test that only checks one helper function in isolation
- a prediction test that reimplements the browser math instead of using the real client helper

Those tests can all pass while the game is still broken.

Prefer tests that assert the runtime contract:

- holding `W+A` moves diagonally
- releasing `A` while `W` is still held continues moving up
- pathfinding emits `move_cancelled` when input interrupts it
- client prediction stays within tolerance of server authority

## Debug Instrumentation

The engine now emits movement-focused events that should be your first inspection point:

- `input_state`
- `input_move`
- `player_collision`
- `move_start`
- `move_cancelled`
- `move_end`

For browser-side reconciliation, inspect:

```js
window.__AI_TOWN_CLIENT_DEBUG__?.getEvents()
```

That ring buffer records reconciliation corrections so you can tell whether a bug is in prediction or in the authoritative server state.
