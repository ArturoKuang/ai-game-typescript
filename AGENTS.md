# AI Town -- Codex Agent Instructions

> Tuned for OpenAI Codex running autonomously in a sandboxed environment.
> For interactive Claude Code sessions, see `CLAUDE.md`.

## Overview

AI Town is a multiplayer social simulation game where human players and AI-driven NPCs inhabit a tile-based town, move around, and have conversations. The server is a Node.js/TypeScript application with a WebSocket interface for real-time clients and a REST debug API. A browser client renders the world with PixiJS.

## Sandbox Constraints

Codex runs in an isolated sandbox. These constraints shape what you can and cannot verify:

- **No Docker.** You cannot run `docker compose` commands. All work must use the host-mode path.
- **External network is allowed.** You may use internet access, localhost endpoints, and remote documentation or QA resources when the task benefits from it.
- **Browser QA is allowed.** You may open a browser, run Playwright, and use browser-based QA flows against local host-mode servers.
- **Local long-running processes are allowed when needed for QA.** You may run `vite`, `vite preview`, or the game server locally to verify browser behavior. Prefer shutting them down once verification is complete.
- **npm install works.** Dependencies are already installed. If you need to reinstall: `cd server && npm install`.

**What this means for workflow:** Default to `edit -> test/build -> browser QA -> fix -> repeat`. Use host-mode servers plus browser or Playwright checks when UI behavior, layout, or end-to-end wiring need validation. When a task still cannot be exercised locally, state what remains unverified and what a human should check.

## Project Structure

```
server/              # Game server (Docker in prod, host-mode for dev/test)
  src/
    index.ts         # Thin entry point -> bootstrap/runtime.ts
    bootstrap/
      runtime.ts     # Composition root for Express, WS, NPC, autonomy, and debug routes
    engine/          # Core simulation (NO I/O -- fully testable in isolation)
      gameLoop.ts    # Tick-based game loop (stepped or realtime mode)
      world.ts       # Immutable tile grid, walkability, spawn points
      collision.ts   # AABB tile collision for continuous movement
      pathfinding.ts # A* pathfinding (4-directional, Manhattan heuristic)
      conversation.ts# Conversation lifecycle state machine
      types.ts       # ALL shared data models (Player, Activity, Position, etc.)
      logger.ts      # In-memory ring-buffer event log (1000 events)
      rng.ts         # Seeded xorshift128 PRNG -- deterministic sequences
    autonomy/        # NPC needs + GOAP planner/executor; state lives outside Player
    bears/           # Bear combat/spawn subsystem
    network/
      websocket.ts   # WebSocket server -- translates events <-> messages
      protocol.ts    # Client/server message discriminated unions
      publicPlayer.ts# Stable player DTO exposed to clients/debug dashboard
    db/
      client.ts      # PostgreSQL connection pool (pg)
      migrate.ts     # Schema migration runner
      repository.ts  # Persistence layer (memories + game log)
      schema.sql     # Full DDL (pgvector enabled)
    npc/
      embedding.ts   # Placeholder embedder + cosine similarity
      memory.ts      # Memory manager (scoring, retrieval, reflection)
    debug/
      router.ts      # Express debug API routes
      admin.ts       # Debug write facade; may process queued commands immediately
      asciiMap.ts    # Terminal map renderer
      movementHarness.ts     # In-process deterministic movement/collision harness
      conversationHarness.ts # Live HTTP/WS harness for end-to-end convo verification
      scenarios.ts   # Pre-built test scenarios
  test/              # Vitest test files
    helpers/
      testGame.ts    # Shared test fixtures (mini 5x5 map, default 20x20 map)
client/              # Browser client (runs on host, NOT in Docker)
  src/
    main.ts          # Entry point -- wires PixiJS, WebSocket, UI
    renderer.ts      # PixiJS tile map + player sprites
    network.ts       # WebSocket client (connects to :3001)
    prediction.ts    # Client movement predictor; keep parity with server tests
    debugDashboard.ts# Live debug stream UI
    ui.ts            # Chat panel, player list, status bar
    types.ts         # Mirrors protocol/PublicPlayer/debug stream types
data/
  map.json           # 20x20 town map (tiles, activities, spawn points)
  characters.ts      # NPC personality definitions
docs/
  architecture.md    # System diagrams, tick lifecycle, state machines
  debug-api.md       # Full API reference with curl examples
  getting-started.md # Setup and first-run guide
```

## Commands

```bash
npm test                             # Root shortcut for server Vitest suite
npm run check                        # Biome static checks for the monorepo
cd server && npm test                # Run all tests (Vitest) -- this is your primary feedback loop
cd server && npx vitest run          # Same thing, explicit
cd server && npx vitest run test/conversation.test.ts   # Run a single test file
cd server && npm run debug:movement  # Run deterministic movement harness scenarios
cd server && npm run debug:conversation # Run live conversation harness scenarios
cd server && npm run dev             # Start host-mode server on :3001
cd server && npx tsc --noEmit        # Type-check without emitting (fast)
cd client && npm run build           # Client type-check + production build
cd client && npm run dev -- --host 127.0.0.1   # Start client for browser QA
```

You do NOT have access to these:
```bash
# docker compose up --build -d       # NOT AVAILABLE in sandbox
```

## Tech Stack

- **Runtime**: Node.js 20, ES modules (`"type": "module"`)
- **Language**: TypeScript 5.7 (strict mode, ES2022 target, NodeNext module resolution)
- **Server**: Express 4
- **WebSocket**: ws 8
- **Database**: PostgreSQL 16 + pgvector (1536-dim embeddings) -- NOT available in sandbox
- **Testing**: Vitest 3
- **Runner**: tsx (dev and production)
- **Client**: PixiJS 8, Vite 6
- **Infrastructure**: Docker Compose (db + game-server) -- NOT available in sandbox

## Hard Rules

These are architectural invariants. Violating any of them will introduce bugs that tests may not catch.

### 1. The engine/ directory has ZERO I/O dependencies

`engine/` must never import from `db/`, `network/`, `npc/`, `debug/`, or Node.js I/O modules (`fs`, `net`, `http`). This is what makes the engine fully testable without a database or network. If you need to add behavior that requires I/O, put it outside `engine/` and pass data in via function arguments or callbacks.

**How to check:** `grep -r "from.*db/" server/src/engine/` should return nothing. Same for `network/`, `npc/`, `debug/`, `node:fs`, `node:net`, `node:http`.

### 2. All game state mutations go through the command queue

WebSocket handlers and the debug API do NOT mutate game state directly. They call `game.enqueue(command)`. Commands are drained at the start of each tick in FIFO order. This ensures:
- Deterministic replay (same commands in same order = same result)
- Stepped mode works correctly (commands accumulate between manual ticks)
- No race conditions between WebSocket handlers and the tick loop

**The one exception:** `setPlayerInput()` for WASD held-key state is applied immediately (not queued) because it represents continuous input, not a discrete command.
**Debug-route nuance:** `debug/admin.ts` may enqueue commands and call `processPendingCommands()` immediately so admin writes become visible without waiting for the next tick, but the router still should not reach into `GameLoop` or `ConversationManager` directly.

**If you are adding a new player action:** Add a new variant to the `Command` union in `engine/types.ts`, handle it in the `processCommands` method of `gameLoop.ts`, and enqueue it from the WebSocket handler in `websocket.ts`. Do NOT call `game.spawnPlayer()`, `game.setPlayerTarget()`, etc. directly from network handlers.

### 3. Two movement systems -- mutually exclusive per player

Players move via exactly one of these systems at a time:

| System | Trigger | State written | Speed unit |
|--------|---------|---------------|------------|
| **Input (WASD)** | `input_start` / `input_stop` messages | `vx`, `vy`, `inputX`, `inputY` | tiles/second (`inputSpeed`) |
| **Path (A*)** | `move_to` command or conversation rendezvous | `path`, `pathIndex`, `targetX`, `targetY` | tiles/tick (`pathSpeed`) |

**Pressing a key cancels any active A* path. Setting a path clears held input.**

Both systems write to the shared fields `x`, `y`, `state`, and `orientation`. If you are editing movement code, you must understand which system is active for the player you are modifying. Check `player.path` (path system) and `player.inputX`/`player.inputY` (input system).

The tick pipeline processes input movement BEFORE path movement. This order matters.

### 4. Conversation state machine is strict

```
invited --> walking --> active --> ended
    |                              ^
    +-------- declined ------------+
```

- `invited`: initiator requested; target has not responded. NPCs auto-accept (no client UI).
- `walking`: both players navigating toward a rendezvous midpoint. Activates when within 2 tiles (Manhattan).
- `active`: messages can be exchanged. Auto-ends on timeout (600 ticks), max messages (20), or max duration (1200 ticks).
- `ended`: terminal. Players freed for new conversations.

`ConversationManager` maintains a `playerToConvo` reverse index (player ID -> conversation ID) for O(1) lookups. Entries are removed when a conversation ends.

**Players in the `conversing` state cannot move.** Movement methods check `player.state === "conversing"` and return early.

### 5. No Math.random() in game logic

Use the seeded PRNG from `engine/rng.ts`. This ensures deterministic test replay with a fixed seed (default: 42 in tests).

### 6. ES module imports require .js extensions

```typescript
// CORRECT
import { World } from './world.js';
import type { Player } from './types.js';

// WRONG -- will fail at runtime
import { World } from './world';
import type { Player } from './types';
```

This is required by TypeScript's NodeNext module resolution with `"type": "module"`.

### 7. Types go in specific files

- Game entity types (Player, Position, Activity, etc.): `engine/types.ts`
- Public player DTO exposed over the network: `network/publicPlayer.ts`
- Wire protocol types (ClientMessage, ServerMessage): `network/protocol.ts`
- Conversation types (Conversation, Message, ConvoState): `engine/conversation.ts`
- Autonomy state, needs, plans, and debug projections: `autonomy/types.ts`
- Debug dashboard stream payloads: `debug/streamTypes.ts`
- Memory types (Memory, ScoredMemory, MemoryStore): `db/repository.ts`

Do not scatter type definitions across implementation files.

### 8. Autonomy state does not belong on `Player`

NPC needs, inventory, GOAP plans, and debug-plan state live in `autonomy/` manager-owned maps and types. The autonomy system reads world/player state and drives behavior through commands and hooks; do not add autonomy-only fields to `engine/Player`, `network/PublicPlayer`, or `client/src/types.ts` unless they are truly part of the public runtime model.

### 9. No `any` in TypeScript

Strict mode is enabled. Use proper types. If you truly cannot avoid it, use `unknown` with a type guard.

## Tick Pipeline (execution order matters)

```
1. Drain command queue (spawn, move, say, start_convo, ...)
2. Assert world invariants (if validateInvariants is on)
3. Process input movement (WASD: velocity + AABB collision)
4. Process path movement (A*: follow waypoints)
5. Broadcast player_update events for moving players
6. Advance conversation state machine (ConversationManager.processTick)
7. Sync player.state / currentConvoId with conversation state
8. Assert world invariants again
9. Emit tick_complete event; invoke afterTick callbacks
```

If you are debugging a movement bug: the issue is likely in steps 3-4.
If you are debugging a conversation bug: the issue is likely in steps 1, 6-7.
If events arrive in the wrong order: check which step emits them.

## File Coupling Map

These files are tightly coupled. Changing one often requires understanding (and sometimes changing) the others:

```
gameLoop.ts  <-->  conversation.ts   (tick pipeline calls processTick; sync player state)
gameLoop.ts  <-->  collision.ts      (input movement calls moveWithCollision)
gameLoop.ts  <-->  pathfinding.ts    (setPlayerTarget calls findPath)
gameLoop.ts  <-->  world.ts          (all spatial queries go through World)
gameLoop.ts  <-->  types.ts          (Player, Command, GameEvent, TickResult)
websocket.ts <-->  protocol.ts       (message type definitions)
websocket.ts <-->  publicPlayer.ts   (server serializes player state through a stable DTO)
websocket.ts <-->  gameLoop.ts       (enqueues commands, reads state for snapshots)
publicPlayer.ts <--> client/types.ts (client mirrors the public player wire shape, not full engine Player)
autonomy/manager.ts <--> autonomy/types.ts <--> gameLoop.ts (NPC plans/needs live outside engine state and act via commands/hooks)
debug/router.ts <--> debug/admin.ts  (admin routes reuse command paths and may flush them immediately)
memory.ts    <-->  repository.ts     (MemoryStore interface)
memory.ts    <-->  embedding.ts      (Embedder interface)
client/types.ts <-> server protocol/public DTOs (manually synced -- update both sides)
```

**When you edit fields that cross the network boundary:** update `network/publicPlayer.ts`, `network/protocol.ts`, and `client/src/types.ts` together. The client mirrors `PublicPlayer` and protocol/debug payloads, not the full engine `Player`.

## Testing

### Your edit-run-test loop

You can run host-mode servers and browser QA in this sandbox. Default to a layered workflow:

1. Read the relevant source files.
2. For engine-only bugs, start with a targeted Vitest file or `TestGame`, then use `server/src/debug/movementHarness.ts` if the issue is movement/collision ordering.
3. For protocol, WebSocket, debug-dashboard, or conversation lifecycle bugs, use `server/src/debug/conversationHarness.ts` or a real host-mode server plus browser/Playwright QA.
4. Write a failing test (or extend an existing harness scenario) that captures the behavior.
5. Implement the change.
6. Run `cd server && npm test` and `cd server && npx tsc --noEmit`.
7. If you changed client/protocol/debug-stream code, also run `cd client && npm run build`.
8. If behavior still needs live verification, state explicitly: "E2E verification required: [describe what to check against a live server]."

### Test fixtures

Use `TestGame` from `test/helpers/testGame.ts`:

```typescript
import { TestGame } from './helpers/testGame.js';

test('player follows A* path', () => {
  const tg = new TestGame();           // 5x5 mini map, stepped mode, seed=42
  tg.spawn('p1', 1, 1);
  tg.move('p1', 3, 1);                // Set A* target
  const results = tg.tick(3);          // Advance 3 ticks
  const p = tg.getPlayer('p1');
  expect(p.x).toBe(3);                // Arrived
  expect(p.state).toBe('idle');
});
```

**TestGame methods:**
- `spawn(id, x, y, isNpc?)` -- create a player at position
- `tick(count?)` -- advance N ticks (default 1), returns `TickResult[]`
- `move(id, x, y)` -- set A* movement target
- `getPlayer(id)` -- get player state (throws if not found)
- `spawnNearby(id1, id2, distance?)` -- spawn two players close together
- `destroy()` -- reset game state

**TestGame options:**
- `new TestGame({ seed: 123 })` -- custom RNG seed
- `new TestGame({ map: 'default' })` -- use the full 20x20 map from `data/map.json`
- `new TestGame({ validateInvariants: true })` -- fail loudly on state violations

### What to assert

**Good:** Runtime behavior contracts.
```typescript
// Player in conversation cannot move
test('conversing player rejects move', () => {
  const tg = new TestGame();
  const [p1, p2] = tg.spawnNearby('p1', 'p2');
  // ... start and activate conversation ...
  const path = tg.move('p1', 3, 3);
  expect(path).toBeNull();              // Movement rejected
  expect(tg.getPlayer('p1').state).toBe('conversing');
});
```

**Bad:** Isolated helper math that doesn't catch runtime bugs.
```typescript
// This can pass while the game is broken
test('manhattan distance', () => {
  expect(manhattan({x:0,y:0}, {x:3,y:4})).toBe(7);
});
```

### Test levels for movement/collision

1. **Runtime contract tests** -- held-key ordering, integer positions after path, collision ownership.
2. **Client/server parity tests** -- run the same input through `GameLoop` and the client prediction helpers.
3. **Movement harness scenarios** -- use `movementHarness.ts` when you need replayable snapshots, ASCII maps, and event traces for handoff/collision regressions.
4. **Debug invariant tests** -- use `validateInvariants: true` to catch overlap, wall penetration, invalid paths.

## Common Pitfalls (things Codex agents get wrong)

### 1. Bypassing the command queue
**Wrong:** Calling `game.spawnPlayer()` from a WebSocket handler.
**Right:** Calling `game.enqueue({ type: 'spawn', playerId: id, data: { ... } })`.

### 2. Importing I/O into engine/
**Wrong:** `import { Pool } from 'pg'` inside `engine/gameLoop.ts`.
**Right:** Keep `engine/` pure. Pass database results in via function arguments.

### 3. Forgetting .js extensions
**Wrong:** `import { World } from './world'`
**Right:** `import { World } from './world.js'`

### 4. Using Math.random()
**Wrong:** `const target = activities[Math.floor(Math.random() * activities.length)]`
**Right:** `const target = rng.pick(activities)`

### 5. Mutating player state outside the tick
**Wrong:** `player.x = newX` in a WebSocket handler.
**Right:** Enqueue a command; let the tick pipeline apply it.

### 6. Adding types in the wrong file
**Wrong:** Defining a new interface in `gameLoop.ts`.
**Right:** Add it to `engine/types.ts` (for game entities) or `network/protocol.ts` (for wire types).

### 7. Writing tests that need a database
**Wrong:** `const pool = new Pool(...)` in a test file.
**Right:** Use `TestGame` or `InMemoryRepository` from `db/repository.ts`.

### 8. Editing collision without understanding the coordinate system
Runtime coordinates are **centered on integer tiles**: tile (2, 3) has center at world-space (2, 3). The internal collision helpers use a **unit grid** where tile (tx, ty) spans [tx, tx+1]. Public functions in `collision.ts` translate by +0.5 before resolving and -0.5 afterward. If you get confused about why positions are off by 0.5, this is why.

### 9. Mixing up the two movement systems
If a player has `path` set, they are using A* movement. If they have `inputX`/`inputY` non-zero, they are using WASD movement. These are mutually exclusive. Do not set both.

### 10. Forgetting the public DTO boundary
The browser mirrors `network/publicPlayer.ts` and `network/protocol.ts`, not the full engine `Player`. If a field changes on the wire, update `toPublicPlayer()`, protocol types, and `client/src/types.ts` together.

## Architecture Notes

- **GameLoop** is the central coordinator. It owns all mutable state: players (`Map<string, Player>`), the world, conversations (`ConversationManager`), and the event logger.
- **World** is immutable after construction. All spatial queries (walkability, neighbors, activities) go through it.
- **ConversationManager** owns the conversation state machine and a `playerToConvo` reverse index for O(1) "is this player in a conversation?" checks.
- **GameLogger** is a fixed-size ring buffer (1000 events). Events older than the buffer size are silently dropped.
- **Two modes**: `stepped` (tests, debug API) and `realtime` (production, 20 ticks/sec). Tests always use stepped mode.
- **Bootstrap/runtime**: `server/src/index.ts` is intentionally thin. Runtime wiring for Express, WebSocket, NPC services, autonomy, bears, and debug routes lives in `bootstrap/runtime.ts`.
- **WebSocket protocol** uses discriminated unions (`ClientMessage`, `ServerMessage`) defined in `network/protocol.ts`. The server sends a full `FullGameState` snapshot on connect, then streams incremental updates, and player payloads are serialized through `network/publicPlayer.ts`.
- **Autonomy split**: `NpcAutonomyManager` owns needs/inventory/plans and runs after each tick; `NpcOrchestrator` handles LLM replies, memory persistence, and reflections. Both live outside `engine/` and should influence gameplay through commands/events instead of mutating engine internals directly.
- **Debug writes**: `debug/admin.ts` is the sanctioned debug write surface. It exists so routes can reuse the production command path and occasionally flush queued commands immediately.
- **Memory system**: NPC memories stored in PostgreSQL with pgvector embeddings. Retrieval uses a composite score: `0.99^ticksAgo + importance/10 + cosineSimilarity`. `InMemoryRepository` provides a test-friendly fallback.

## Debug API Reference

These endpoints are available when you have the server running locally. Use them for host-mode debugging and verification when appropriate.

| Method | Endpoint | Purpose |
|--------|----------|---------|
| GET | /api/debug/state | Current tick, mode, player count, world dimensions |
| GET | /api/debug/map | ASCII map visualization (?format=json for structured) |
| GET | /api/debug/players | All players with full state |
| GET | /api/debug/players/:id | Single player detail |
| GET | /api/debug/conversations | All conversations with messages |
| GET | /api/debug/conversations/:id | Single conversation |
| GET | /api/debug/activities | Activity locations |
| GET | /api/debug/log | Filtered event log (?since=N&limit=N&playerId=X&type=X) |
| GET | /api/debug/scenarios | List available scenarios |
| GET | /api/debug/npc-provider | NPC provider diagnostics / retry status |
| GET | /api/debug/memories/:playerId | NPC memories (?type=X&limit=N) |
| GET | /api/debug/memories/:playerId/search | Vector search (?q=text&k=N) |
| POST | /api/debug/tick | Advance N ticks ({ "count": N }) |
| POST | /api/debug/spawn | Add a player ({ "id", "name", "x", "y", "isNpc" }) |
| POST | /api/debug/move | Set movement target ({ "playerId", "x", "y" }) |
| POST | /api/debug/input | Toggle held input ({ "playerId", "direction", "active" }) |
| POST | /api/debug/start-convo | Start conversation ({ "player1Id", "player2Id" }) |
| POST | /api/debug/say | Send message ({ "playerId", "convoId", "content" }) |
| POST | /api/debug/end-convo | End conversation ({ "convoId" }) |
| POST | /api/debug/reset | Clear all game state |
| POST | /api/debug/scenario | Load preset ({ "name": "crowded_town" }) |
| POST | /api/debug/mode | Switch mode ({ "mode": "realtime" or "stepped" }) |
| POST | /api/debug/memories | Create a memory directly |
| POST | /api/debug/remember-convo | Generate memories for conversation participants |

## Task Sizing Guidance

Tasks that are a good fit for Codex (autonomous, formulaic, testable):
- Add a new debug API endpoint following the existing pattern in `debug/router.ts`
- Add a new Command variant and handle it in the tick pipeline
- Write tests for an existing but uncovered behavior
- Rename a field or type across the codebase
- Add a new message type to the WebSocket protocol
- Fix a failing test by reading the error and adjusting the implementation

Tasks that are risky for Codex (deep coupling, subtle invariants):
- Changing collision resolution logic (coordinate system gotchas)
- Modifying the tick pipeline order (execution order matters)
- Changing how the two movement systems interact (mutual exclusion invariant)
- Conversation state machine transitions (affects movement, NPC AI, WebSocket)
- Anything that depends on external services or environment-specific behavior you still cannot reproduce locally

For risky tasks: make the change, write thorough tests, but explicitly flag what needs human review and live verification.

## Environment

Tests run in-memory without a database. No environment variables needed.

The server runs in Docker with these defaults (for reference, not usable in sandbox):
```
DATABASE_URL=postgres://aitown:aitown_dev@db:5432/aitown
PORT=3001
```

When `DATABASE_URL` is unset, the server falls back to `InMemoryRepository` for NPC memory persistence.

## Checklist Before Submitting

- [ ] `cd server && npm test` passes
- [ ] `cd server && npx tsc --noEmit` passes
- [ ] If client/protocol/debug-stream code changed, `cd client && npm run build` passes
- [ ] No `any` types introduced
- [ ] All imports use `.js` extensions
- [ ] No I/O imports in `engine/`
- [ ] No `Math.random()` in game logic
- [ ] New types added to the correct file (`types.ts`, `publicPlayer.ts`, `protocol.ts`, `streamTypes.ts`, `conversation.ts`, `repository.ts`, or `autonomy/types.ts`)
- [ ] If the wire shape changed, `network/publicPlayer.ts`, `network/protocol.ts`, and `client/src/types.ts` stay aligned
- [ ] If behavior needs live verification, stated explicitly what to check
- [ ] New game actions use the command queue, not direct mutation
