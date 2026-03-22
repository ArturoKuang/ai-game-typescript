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

## Making Changes

### Before You Start

1. Read the relevant source files before editing.
2. Run `npm test` from `server/` to confirm a green baseline.

### After You Finish

1. Run `npm test` from `server/` and ensure all tests pass.
2. If you added new game logic, add a test in `server/test/`.
3. If you added a new module, use ES module syntax with `.js` import extensions.

## Code Rules

- **TypeScript strict mode** — do not use `any`. Define types in `engine/types.ts` or `network/protocol.ts`.
- **ES modules** — all imports must use `.js` extensions (e.g., `import { World } from './world.js'`). The project uses `"type": "module"` with NodeNext resolution.
- **No `Math.random()` in game logic** — use the seeded PRNG from `engine/rng.ts` for reproducibility.
- **Tick-based time** — game state advances via `GameLoop.tick()`. Do not use `setTimeout`/`setInterval` in game logic (only in the realtime loop wrapper).
- **Plain objects** — game state uses TypeScript interfaces, not classes. Do not introduce classes for game entities.
- **Tests are self-contained** — use `createTestGame()` or `createMiniGame()` from `test/helpers/testGame.ts`. Tests must not require a database or network.

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
```

Test files: `server/test/*.test.ts`

Test fixtures provide pre-configured game loops with mini (5x5) or default (20x20) maps. Example:

```typescript
import { createMiniGame } from './helpers/testGame.js';

test('player moves', () => {
  const game = createMiniGame();
  const player = game.addPlayer({ id: 'p1', name: 'Test', x: 0, y: 0 });
  game.movePlayer('p1', 3, 3);
  const result = game.tick();
  expect(player.state).toBe('walking');
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

## Environment Setup (Optional)

Only needed if working on database features:

```bash
cp .env.example .env
docker-compose up -d   # Starts PostgreSQL with pgvector on :5432
```
