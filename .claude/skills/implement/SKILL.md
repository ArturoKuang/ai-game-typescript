---
name: implement
description: Implement a game feature following the full development workflow — read state, implement, write tests, run tests, verify, and report.
argument-hint: "[feature description]"
---

# Implement Feature

Implement a game feature following the full development workflow.

## Arguments

- `$ARGUMENTS` — what feature to implement

## Instructions

Follow these steps in order. Do not skip steps.

### Step 1: Understand Current State

Read the relevant source files to understand the area you'll be modifying. Check the current game state if the server is running:

```bash
curl -s localhost:3001/api/debug/state | jq .
curl -s localhost:3001/api/debug/map
```

If the server is not running, read the code directly. Focus on:
- `server/src/engine/types.ts` for data models
- The specific files related to the feature
- Existing tests for similar features in `server/test/`

### Step 2: Implement

Write the code changes for: **$ARGUMENTS**

Follow project conventions:
- ES modules with `.js` import extensions
- Strict TypeScript (no `any`)
- No classes for game state — use plain objects/interfaces
- Tick-based logic via `GameLoop.tick()`
- Seeded RNG from `engine/rng.ts` (never `Math.random()`)

### Step 3: Write Tests

Add tests in `server/test/`. Use the test helpers:

```typescript
import { createTestGame, createMiniGame } from './helpers/testGame.js';

// createMiniGame() — 5x5 map, fast, good for unit tests
// createTestGame() — full 20x20 map with activities

test('description', () => {
  const game = createMiniGame();
  game.spawn('p1', 1, 1);
  game.tick(5);
  const player = game.getPlayer('p1');
  expect(player.state).toBe('idle');
  game.destroy();
});
```

TestGame methods:
- `spawn(id, x, y)` — create a player
- `tick(count?)` — advance simulation
- `move(id, x, y)` — set movement target
- `getPlayer(id)` — get player state
- `spawnNearby(id1, id2, distance?)` — spawn two players near each other
- `destroy()` — cleanup

### Step 4: Run Tests

```bash
cd server && npm test
```

If tests fail, fix the issues and re-run until all tests pass. Do not proceed until green.

### Step 5: Manual Verification

If the server is running, verify the feature works via the debug API:

```bash
# Reset and load appropriate scenario
curl -s -X POST localhost:3001/api/debug/reset | jq .
curl -s -X POST localhost:3001/api/debug/scenario -H 'Content-Type: application/json' -d '{"name": "two_npcs_near_cafe"}' | jq .

# Set up the specific scenario for the feature
# (adapt these commands to the feature being tested)

# Tick and observe
curl -s -X POST localhost:3001/api/debug/tick -H 'Content-Type: application/json' -d '{"count": 10}' | jq .
curl -s localhost:3001/api/debug/map
curl -s localhost:3001/api/debug/players | jq .
```

If the server is not running, skip this step — test coverage from Step 4 is sufficient.

### Step 6: Report

Report to the user:
- What was implemented and where (file paths)
- Test results (pass/fail count)
- ASCII map snapshot if manual verification was done
- Any design decisions or trade-offs made
