---
name: qa
description: Run the full QA suite — unit tests, invariant checks, scenario play testing, live game screenshots, log analysis, and state inspection.
argument-hint: "[focus area or empty for full suite]"
---

# QA Test Suite

Run a comprehensive QA pass: unit tests, invariant checks, scenario play testing with screenshots, state inspection, and log analysis.

## Arguments

- `$ARGUMENTS` — optional focus area (e.g., "movement", "conversations", "npcs"). If empty, run the full suite.

## Instructions

Run all steps in order. Collect results as you go and produce a final QA report at the end.

### Step 1: Unit Tests

```bash
cd server && npm test
```

Record pass/fail counts. If any tests fail, record details but continue — we want the full picture.

### Step 2: TypeScript Type Check

```bash
cd server && npx tsc --noEmit
```

Record any type errors.

### Step 3: Lint Check

```bash
npx biome check .
```

Record any lint violations.

### Step 4: Movement Harness (Invariant + Regression)

Run all movement harness scenarios — these check collision, pathfinding, and input-order invariants:

```bash
cd server && npm run debug:movement -- --scenario path_handoff
cd server && npm run debug:movement -- --scenario runtime_spawn_input
cd server && npm run debug:movement -- --scenario simultaneous_input_release
cd server && npm run debug:movement -- --scenario input_blocked_by_player
cd server && npm run debug:movement -- --scenario path_blocked_by_player
cd server && npm run debug:movement -- --scenario direction_handoff
```

Record any scenario that fails or shows unexpected events.

### Step 5: Check Server Availability

```bash
curl -s -o /dev/null -w "%{http_code}" localhost:3001/api/debug/state
```

If the server responds (200), continue with Steps 6–9 (live testing). If not, skip to Step 10 — offline results are sufficient.

### Step 6: Scenario Play Testing (live server)

Load each scenario, advance ticks, and verify expected outcomes.

#### 6a: Empty World Sanity

```bash
curl -s -X POST localhost:3001/api/debug/reset | jq .
curl -s -X POST localhost:3001/api/debug/scenario -H 'Content-Type: application/json' -d '{"name": "empty"}' | jq .
curl -s -X POST localhost:3001/api/debug/tick -H 'Content-Type: application/json' -d '{"count": 5}' | jq .
curl -s localhost:3001/api/debug/state | jq .
```

Verify: tick advanced by 5, zero players, no errors.

#### 6b: Two NPCs — Movement + Conversation

```bash
curl -s -X POST localhost:3001/api/debug/reset | jq .
curl -s -X POST localhost:3001/api/debug/scenario -H 'Content-Type: application/json' -d '{"name": "two_npcs_near_cafe"}' | jq .
curl -s localhost:3001/api/debug/map
curl -s localhost:3001/api/debug/players | jq .
```

Test movement:

```bash
curl -s -X POST localhost:3001/api/debug/move -H 'Content-Type: application/json' -d '{"playerId": "npc_alice", "x": 3, "y": 3}' | jq .
curl -s -X POST localhost:3001/api/debug/tick -H 'Content-Type: application/json' -d '{"count": 20}' | jq .
curl -s localhost:3001/api/debug/players | jq '.[] | select(.id == "npc_alice") | {id, position: {x, y}, state}'
```

Verify: Alice moved toward (3,3). State is idle or at target.

Test conversation lifecycle:

```bash
curl -s -X POST localhost:3001/api/debug/start-convo -H 'Content-Type: application/json' -d '{"player1Id": "npc_alice", "player2Id": "npc_bob"}' | jq .
curl -s -X POST localhost:3001/api/debug/tick -H 'Content-Type: application/json' -d '{"count": 5}' | jq .
curl -s localhost:3001/api/debug/conversations | jq '.[0] | {id, state, participants: [.player1Id, .player2Id]}'
```

Verify: conversation exists with valid state. End it:

```bash
CONVO_ID=$(curl -s localhost:3001/api/debug/conversations | jq '.[0].id')
curl -s -X POST localhost:3001/api/debug/end-convo -H 'Content-Type: application/json' -d "{\"convoId\": $CONVO_ID}" | jq .
```

#### 6c: Crowded Town — Stress Test

```bash
curl -s -X POST localhost:3001/api/debug/reset | jq .
curl -s -X POST localhost:3001/api/debug/scenario -H 'Content-Type: application/json' -d '{"name": "crowded_town"}' | jq .
curl -s localhost:3001/api/debug/players | jq 'length'
```

Verify: 5 players spawned.

```bash
curl -s -X POST localhost:3001/api/debug/tick -H 'Content-Type: application/json' -d '{"count": 50}' | jq .
curl -s localhost:3001/api/debug/map
curl -s localhost:3001/api/debug/players | jq '.[] | {id, position: {x, y}, state}'
```

Verify: no player in invalid state, no overlapping on blocked tiles.

### Step 7: Game Screenshot Capture

Capture a screenshot of the live game client (requires a browser client connected at localhost:5173).

```bash
curl -s -X POST localhost:3001/api/debug/capture-screenshot | jq .
```

If the response is `{"ok": true, "savedTo": "..."}`, read the saved screenshot file with the Read tool to visually inspect the game state:

```bash
# The screenshot is saved to $TMPDIR/claude/qa-screenshot.png
```

Use the Read tool to view the screenshot image. Check for:
- Map tiles rendering correctly (colored grid with walls, floors, water)
- Player sprites visible and positioned correctly (colored circles with name labels)
- No visual glitches (sprites outside map bounds, overlapping tiles, missing elements)
- Activity labels showing at correct positions
- Conversation lines drawn between conversing players (if any)

If the capture-screenshot endpoint returns an error (no client connected), note it in the report as "Screenshot: SKIPPED (no browser client connected)".

Also fetch the ASCII map as a text-based fallback:

```bash
curl -s localhost:3001/api/debug/map
```

### Step 8: Log Analysis

Check the event log for errors, warnings, and suspicious patterns:

```bash
curl -s 'localhost:3001/api/debug/log?limit=100' | jq .
```

Check for:
- `player_collision` events (expected during movement, flag if excessive — more than 20)
- `move_cancelled` events with unexpected reasons
- Any error-level log events
- Players stuck in `walking` state with no path progress
- `input_state` events that lack a matching `input_move`

Also check the server health endpoint for degraded state:

```bash
curl -s localhost:3001/health | jq .
```

If `$ARGUMENTS` mentions a specific player or area, filter the log:

```bash
curl -s 'localhost:3001/api/debug/log?limit=50&type=player_collision,move_cancelled,input_state' | jq .
```

### Step 9: Client Debug Log Check

If a browser client is connected and you can access it, note the following command for the user:

```
Browser console: window.__AI_TOWN_CLIENT_DEBUG__?.getEvents()
```

Check client-side reconciliation events for excessive corrections (snap mode), which indicate prediction divergence.

### Step 10: QA Report

Produce a structured report:

```
## QA Report

### Unit Tests
- Result: PASS/FAIL (X passed, Y failed)
- Failures: [list if any]

### Type Check
- Result: PASS/FAIL
- Errors: [list if any]

### Lint
- Result: PASS/FAIL
- Violations: [count if any]

### Movement Harness
- Scenarios run: 6
- Result: ALL PASS / [list failures]

### Live Play Testing (if server was running)
- Empty world: PASS/FAIL
- Two NPCs (movement): PASS/FAIL
- Two NPCs (conversation): PASS/FAIL
- Crowded town (stress): PASS/FAIL

### Game Screenshot
- Captured: YES/NO/SKIPPED
- Visual issues: [list or "none"]
- ASCII map: [include]

### Log Analysis
- Server health: ok/degraded
- Collisions: [count]
- Cancelled moves: [count]
- Suspicious patterns: [list or "none"]

### Client Debug
- Reconciliation corrections: [count if available, or "not checked"]

### Overall Verdict
- **SHIP IT** / **NEEDS FIXES**
- [Summary of blockers if any]
```

Mark the overall verdict as **SHIP IT** only if:
- All unit tests pass
- Type check is clean
- All movement harness scenarios pass
- No players stuck in invalid states during play testing
- No suspicious log patterns
- Screenshot shows no visual glitches (if captured)

Otherwise mark **NEEDS FIXES** and list the specific blockers.
