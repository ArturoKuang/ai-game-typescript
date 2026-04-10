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

`TestGame` wraps a stepped `GameLoop` and is the main runtime fixture for
unit-level tests. It runs purely in memory — no WebSocket, no database — so
it works everywhere, including sandboxed CI.

It supports:

- loading a small hardcoded map or the default `data/map.json`
- spawning players (`spawn(id, x, y, isNpc)`)
- ticking with optional invariant validation
- moving players via `move_to` commands
- fetching live player state
- a `spawnNearby` convenience for adjacent actors

### `server/test/helpers/mapGenerator.ts`

`generateOpenMap(width, height, spawnCount)` produces arbitrary-size open
maps for performance and scale tests. Pure data, no side effects.

### `server/test/helpers/testServer.ts`

`startTestServer(options)` boots a real `GameLoop` plus
`GameWebSocketServer` on an ephemeral loopback port. It returns a
`TestServer` handle with the url, game, ws server, optional bear manager,
and an async `close()`.

Use it when a test needs to exercise the full HTTP + WebSocket path. Always
guard with `await canBindLoopback()` and skip the test if the sandbox does
not allow socket binding:

```ts
if (!(await canBindLoopback())) return;
const server = await startTestServer({
  map: makeOpenRoomMap(10),
  mode: "stepped",
  combat: true,
});
// ... drive the scenario, then ...
await server.close();
```

`makeOpenRoomMap(size)` is exported alongside for quick open-floor maps, and
`canBindLoopback()` probes once and caches the result.

### `server/test/helpers/botClient.ts`

`BotClient` is a high-level WebSocket client that wraps a single `ws`
connection with intent-style methods and an observed-state mirror.

Intents: `join`, `walkTo`, `moveDirection`, `inputStart`/`inputStop`,
`attack`, `pickup`, `eat`, `startConvo`, `acceptConvo`, `say`, `close`.

Waiters: `waitFor`, `waitUntil`, `waitUntilAt`, `waitUntilState`,
`waitForCombatEvent`, `waitForTick`.

Maintained state: `self`, `players`, `conversations`, `chatMessages`,
`combatEvents`, `errors`, and `messages` (the raw `ServerMessage[]` log used
for golden traces).

`BotClient.connectMany(url, count)` opens several bots in parallel and
returns them all once their initial state frame has arrived. Bots require
loopback socket binding — skip when `canBindLoopback()` is false.

### `server/test/helpers/scenarioTimeline.ts`

A small DSL for describing multi-actor interaction tests declaratively. A
`Scenario` is:

- `actors`: ids, names, spawn positions, and `isNpc` flags
- `timeline`: an ordered list of `{ tick, actor, action }` steps where
  `action` is one of `walkTo`, `moveDir`, `attack`, `startConvo`,
  `acceptConvo`, `declineConvo`, `endConvo`, `say`, `pickup`, `eat`
- optional assertions per step via an `assert(ctx)` callback receiving
  `{ tick, player(id), conversation(id | "latest") }`

Two runners consume the same scenario definition:

- `runScenarioOnEngine(scenario)` — hermetic, pure `TestGame`, fast. Used as
  the default CI path.
- `runScenarioOnWs(scenario, { bots, game, url })` — real `BotClient`s
  against a real `startTestServer`. Slower, only runs when loopback binding
  is available, and catches regressions the engine-only runner cannot see
  (serialization, broadcast ordering, reconnection).

Both runners normalize `"latest"` conversation IDs so assertions stay
stable across runs.

### `server/test/helpers/traceSnapshot.ts`

Golden-trace comparison for event streams.

- `normalizeTrace(events, filter)` filters and rounds the event stream to a
  stable shape. Coordinates round to 2 decimals, nested `player` objects
  collapse to `{ id, x, y, state }`, and path-dependent fields (`path`,
  `pathIndex`) are stripped.
- `expectTraceMatchesGolden(name, trace)` compares the normalized trace
  against `server/test/fixtures/goldens/${name}.trace.json`.
- Set `UPDATE_GOLDENS=1` to write the current trace as the new baseline on
  first run or after intentional changes.

Use this when you want to lock in an exact interaction sequence (combat
resolution, conversation flow) and get a clear diff when it drifts.

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
- multi-actor scenarios with golden traces
- property-style fuzzing across random action sequences
- LLM dialogue evals (heuristic judge by default, optional real-model judge)

## Scenarios, Fixtures, And Evals

### `server/test/scenarios/`

Uses `scenarioTimeline.ts` to describe interactions once and run them both
hermetically and end-to-end:

- `talk.scenario.test.ts` — two humans meet, converse, and end; asserted
  via engine runner, WebSocket runner, and a golden trace.
- `combat.scenario.test.ts` — two humans attack each other with bears
  wired; verifies HP math, event ordering, and combat event broadcasts.
- `interactionMatrix.test.ts` — generates 2×2×2 combinations of
  `initiator × responder × kind` so every permutation of
  `(human|npc) × (human|npc) × (talk|combat)` gets exercised.

### `server/test/fixtures/goldens/`

Normalized golden trace JSON files referenced by `expectTraceMatchesGolden`.
Commit these files when the underlying interaction intentionally changes;
rerun tests with `UPDATE_GOLDENS=1` to rewrite them.

### `server/test/evals/npcDialogue.eval.test.ts`

LLM-quality gate for NPC dialogue, built on the `ScriptedNpcProvider` for
determinism. Each scenario runs a short back-and-forth and is scored by a
judge that returns `{ goalCompletion, inCharacter, safety }` values in
`[0, 1]`.

Two judges ship:

- A heuristic judge (default) that checks for out-of-world vocabulary
  (phone, car, internet, …), empty replies, personality vocabulary, and
  whether the NPC asks questions or makes concrete suggestions.
- An LLM judge using Claude Haiku, enabled when `RUN_LLM_EVALS=1` and
  `ANTHROPIC_API_KEY` are set.

Safety must be 1.0; in-character and goal-completion must each be at least
0.4. The evals run in memory without sockets, so they always execute.

### `interaction-property.test.ts`

A lightweight property-style fuzz test. Eight fixed seeds drive random
command sequences against `TestGame` — each sequence spawns four players,
issues 30 randomized actions, and ticks 1–3 times between them. Every tick
must satisfy engine invariants plus: HP in `[0, maxHp]`, no player is both
walking and conversing, no two conversations share a participant, and all
positions are inside the world. Failures print the seed for deterministic
reproduction.

### `npc-movement-natural.test.ts`

Guards the NPC walking-speed feature documented in
[Server engine](server-engine.md#path-following). Verifies that
`computeNpcPathSpeed(npcId)` is deterministic and gives different NPCs
different strides, that NPCs produce sub-tile intermediate positions during
path following, that human click-to-move stays at the old fast rate, and
that orientation updates while moving.

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

## Sandboxed Environments

Some tests open a real loopback socket (`startTestServer`, `BotClient`, the
WS runner inside `scenarioTimeline`, and anything under
`server/test/*harness.test.ts`). They call `canBindLoopback()` at the top
of the test and skip themselves when the sandbox blocks binding, so a
clean `npm test` run is still expected to pass.

The pure in-memory tests — `TestGame`-based suites, the engine runner of
scenarios, golden-trace comparison, the dialogue evals, and the property
fuzzer — run unconditionally.

If you see `listen EPERM: operation not permitted 127.0.0.1` from one of
those tests, that is the sandbox rejecting the socket, not a real
regression. Rerun with sandbox permissions relaxed for the socket-binding
tests.

## Verification Guidance

For code changes, the minimum useful loop is usually:

1. add or update a runtime-facing test
2. run `npm test`
3. run `npx tsc --noEmit`
4. run a harness or `/api/debug` check if the bug is behavior-heavy

Avoid baking suite counts or file counts into docs; they change too often to be
useful.
