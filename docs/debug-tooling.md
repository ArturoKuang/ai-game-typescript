# Debug Tooling

This document covers the debug and inspection surfaces in `server/src/debug/` plus the client-side reconciliation debug handle.

## Purpose

The debug subsystem exists to make the authoritative simulation inspectable and reproducible without relying on the browser.

It provides:

- a REST debug API
- ASCII map rendering
- deterministic scenarios
- a movement harness with saved replay bundles
- a recommended debugging workflow

## Components

### `router.ts`

Mounts `/api/debug` and exposes three categories of routes:

- state inspection: `/state`, `/map`, `/players`, `/activities`, `/log`, `/conversations`, `/memories`
- simulation control: `/tick`, `/mode`, `/spawn`, `/move`, `/input`, `/scenario`, `/reset`
- conversation and memory mutation: `/start-convo`, `/say`, `/end-convo`, `/memories`, `/remember-convo`

The router reads live engine state directly and, when a PostgreSQL pool is present, persists spawned players to the `players` table.

### `asciiMap.ts`

Builds a terminal-friendly map from the current `World` and current player state.

Rendering rules:

- `#` for walls
- `~` for water
- `.` for floor
- activity emoji first character for activities
- player first-letter initials on top of tiles
- legend entries include rounded position and basic movement/conversation state

Current caveat:

- Activity symbols are derived with `emoji.charAt(0)`, so some multi-byte emoji render poorly in plain-text terminals and may appear as replacement characters in the legend.

### `scenarios.ts`

Provides named setups that clear players and respawn a known cast while keeping the currently loaded world.

Built-in scenarios:

- `empty`
- `two_npcs_near_cafe`
- `crowded_town`

### `movementHarness.ts`

Provides deterministic scripted movement scenarios on an in-memory `GameLoop`.

It supports:

- scripted spawn/input/move/tick/snapshot actions
- filtered event tracing
- ASCII snapshots with legends
- built-in expected-event verification
- bundle-friendly JSON output

Representative scenarios:

- `path_handoff`
- `runtime_spawn_input`
- `simultaneous_input_release`

### `runMovementHarness.ts`

CLI entry point for the harness.

Useful commands:

```bash
cd server
npm run debug:movement -- --list
npm run debug:movement -- --scenario simultaneous_input_release
npm run debug:movement -- --scenario path_handoff --format json
npm run debug:movement -- --scenario simultaneous_input_release --bundle /tmp/w-a.json
```

## Route Semantics

### Safe Inspection Routes

These only read state:

- `/state`
- `/map`
- `/players`
- `/activities`
- `/log`
- `/scenarios`
- `/conversations`
- `/memories/:playerId`
- `/memories/:playerId/search`

### Engine-Integrated Control Routes

These use `GameLoop` methods or queue-compatible behavior:

- `/tick`
- `/spawn`
- `/move`
- `/input`
- `/mode`
- `/scenario`

These are the best routes for reproducing live gameplay behavior from outside the browser.

### Direct Conversation Mutation Routes

These directly call `ConversationManager`:

- `/start-convo`
- `/say`
- `/end-convo`

Important caveat:

- They bypass the normal queued-command plus emitted-event path.
- They are useful for local inspection and manual testing.
- They are not the right surface when you need NPC orchestration, WebSocket broadcasts, or post-conversation memory side effects to behave exactly like live gameplay.

### Reset Route

`POST /reset` clears players, conversations, logs, commands, and the loaded world.

Important caveat:

- After reset, routes that require `game.world`, especially `/map` and `/activities`, are no longer safe until a world is loaded again.
- Prefer `/scenario` for normal debugging.

## Event Inspection

`GET /log` reads from `GameLogger`, not the database.

Useful filters:

- `since`
- `limit`
- `playerId`
- `type` as a comma-separated list

Common movement event types:

- `input_state`
- `input_move`
- `player_collision`
- `move_start`
- `move_cancelled`
- `move_end`

## Browser-Side Debug Surface

`client/src/debugLog.ts` exposes:

```js
window.__AI_TOWN_CLIENT_DEBUG__?.getEvents()
window.__AI_TOWN_CLIENT_DEBUG__?.clear()
```

The client currently records reconciliation corrections there so you can see when the browser snapped, lerped, or settled back toward server authority.

## Recommended Workflow

The short version:

1. Reproduce with the movement harness or debug API first.
2. Save a bundle if the issue is movement- or collision-related.
3. Add or adjust a runtime-oriented test.
4. Fix the engine or client prediction path.
5. Re-run the bundle and targeted tests.
6. Re-check live server state through `/api/debug`.

For the detailed playbook, see [Debugging workflow](debugging-workflow.md).
