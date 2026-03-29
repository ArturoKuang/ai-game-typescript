# AI Town — Agent Instructions

> Instructions for AI coding agents (Codex, Claude Code, Cursor, etc.)

## Quick Start

```bash
cd server
npm install
npm test          # Verify everything passes before making changes
```

No database or Docker required for development — tests run fully in-memory.

## Repository Layout

```
server/src/engine/    # Core game simulation (gameLoop, world, pathfinding, conversation)
server/src/network/   # WebSocket server and protocol types
server/src/db/        # PostgreSQL persistence layer (pgvector)
server/src/npc/       # NPC intelligence (embeddings)
server/src/debug/     # REST debug API and test scenarios
server/test/          # Vitest test suite
data/map.json         # 20x20 tile-based town map
```

## Development Workflow

When implementing features or fixing bugs, follow this workflow:

1. **Read state** — understand the current game state and relevant code before changing anything
2. **Reproduce** — prefer `npm run debug:movement -- --scenario ...` or the debug API before editing
3. **Write a failing runtime contract** — assert the gameplay behavior, not just helper math
4. **Implement** — write the code changes
5. **Add parity or invariant coverage when relevant** — use client/server parity tests and `validateInvariants` for movement bugs
6. **Run tests** — `cd server && npm test` — fix until green
7. **Verify live end-to-end** — always run at least one E2E check of the finished feature against a running server using the real surface area involved (WebSocket, debug API, movement harness, or browser flow)
8. **Inspect live state** — confirm the result via debug API (`GET /api/debug/map`, `GET /api/debug/state`, logs, or conversation endpoints)
9. **Report** — show test results, the harness or debug log used, and an ASCII map snapshot. If E2E verification was blocked, say exactly why instead of claiming completion.

Before committing, always run tests and verify via the debug API.

## Making Changes

### Before You Start

1. Read the relevant source files before editing.
2. Run `npm test` from `server/` to confirm a green baseline.

### After You Finish

1. Run `npm test` from `server/` and ensure all tests pass.
2. Run at least one end-to-end verification of the completed feature against a live server path before declaring the work done.
3. If the feature touches runtime gameplay, WebSocket flows, NPC behavior, or persistence, prefer a real server exercise over a unit-only check.
4. If the feature touches Docker, startup/bootstrap code, filesystem paths, environment wiring, or the normal `npm run dev` path, the E2E verification must include the Docker path (`docker compose ...` or `npm run dev`), not just host-mode startup.
5. If you added new game logic, add a test in `server/test/`.
6. If you added a new module, use ES module syntax with `.js` import extensions.

## Code Rules

- **TypeScript strict mode** — do not use `any`. Define types in `engine/types.ts` or `network/protocol.ts`.
- **ES modules** — all imports must use `.js` extensions (e.g., `import { World } from './world.js'`). The project uses `"type": "module"` with NodeNext resolution.
- **No `Math.random()` in game logic** — use the seeded PRNG from `engine/rng.ts` for reproducibility.
- **Tick-based time** — game state advances via `GameLoop.tick()`. Do not use `setTimeout`/`setInterval` in game logic (only in the realtime loop wrapper).
- **Plain objects** — game state uses TypeScript interfaces, not classes. Do not introduce classes for game entities.
- **Tests are self-contained** — use `TestGame` from `test/helpers/testGame.ts` or construct a stepped `GameLoop` directly. Tests must not require a database or network.

## Key Interfaces

```typescript
// engine/types.ts
interface Player {
  id: string; name: string; x: number; y: number;
  state: 'idle' | 'walking' | 'conversing' | 'doing_activity';
  path?: Position[]; isNpc: boolean; orientation: Orientation;
}

interface Position { x: number; y: number }
interface Activity { id: number; name: string; x: number; y: number; capacity: number }
interface GameEvent { tick: number; type: string; playerId?: string; data?: Record<string, unknown> }
interface TickResult { tick: number; events: GameEvent[] }
```

## Architecture Constraints

- **GameLoop is the single source of truth** for all runtime state (players, world, conversations, events).
- **Conversations** follow a strict state machine: `invited → walking → active → ended`. Transitions are managed by `ConversationManager`.
- **A* pathfinding** is 4-directional (no diagonals). Walls and water block movement.
- **WebSocket messages** are discriminated unions defined in `network/protocol.ts`. Add new message types there.
- **Event logger** is a ring buffer (1000 events). Events are emitted by the game loop, not by individual systems.

## Testing

```bash
cd server
npm test              # Run once
npm run test:watch    # Watch mode
npm run debug:movement -- --list
```

Test files: `server/test/*.test.ts`

For movement and collision work, write tests at three levels:

- Runtime contract tests: held-key ordering, integer-centered positions, path cancellation, collision ownership.
- Client/server parity tests: run the same input script through `GameLoop` and the pure client prediction helpers.
- Debug invariant tests: use `validateInvariants` to fail loudly on overlap, blocked-tile penetration, invalid paths, or stale state.

Avoid tests that are too granular. A test that only checks speed magnitude or a helper function in isolation can pass while the game is still broken.

Test fixtures provide pre-configured game loops with mini (5x5) or default (20x20) maps. Example:

```typescript
import { TestGame } from './helpers/testGame.js';

test('player moves', () => {
  const tg = new TestGame();
  tg.spawn('p1', 1, 1);
  tg.move('p1', 3, 1);
  tg.tick();
  expect(tg.getPlayer('p1').state).toBe('walking');
});
```

## Debug API

Available at `http://localhost:3001/api/debug/` when the server is running:

| Method | Endpoint        | Purpose                    |
|--------|----------------|----------------------------|
| GET    | /state         | Current tick, mode, counts |
| GET    | /map           | ASCII or JSON map          |
| GET    | /players       | All player state           |
| GET    | /conversations | Active conversations       |
| GET    | /log           | Filtered event log         |
| POST   | /tick          | Advance simulation         |
| POST   | /spawn         | Add a player               |
| POST   | /move          | Set movement target        |
| POST   | /reset         | Clear all state            |
| POST   | /scenario      | Load a test preset         |

Useful movement log filters:

```bash
curl 'localhost:3001/api/debug/log?playerId=human_1&type=input_state,input_move,player_collision,move_cancelled&limit=50'
```

Movement harness usage:

```bash
cd server
npm run debug:movement -- --scenario simultaneous_input_release
npm run debug:movement -- --scenario simultaneous_input_release --bundle /tmp/w-a.json
```

The `--bundle` output should be treated as the canonical repro artifact for future agents.

End-to-end verification examples:

```bash
# Live debug API verification
curl localhost:3001/api/debug/state
curl localhost:3001/api/debug/conversations

# Live websocket verification should be used for chat and NPC behavior changes
# when the feature depends on queued commands or event-driven orchestration.

# If startup, Docker wiring, files, or env config changed, verify the Docker path too.
docker compose up --build -d
docker compose logs game-server --tail=100
curl localhost:3001/api/debug/state
docker compose down
```

## Environment Setup (Optional)

Only needed if working on database features:

```bash
cp .env.example .env
docker-compose up -d   # Starts PostgreSQL with pgvector on :5432
```
