# Debug Tooling

This document covers the inspectable runtime surfaces in `server/src/debug/`
plus the browser-side debug helpers.

## What Exists Today

The debug toolchain includes:

- the HTTP debug API under `/api/debug`
- the dedicated live dashboard in `client/debug.html`
- the gameplay client overlay in `client/index.html`
- ASCII map rendering
- named scenarios
- the movement harness
- the conversation harness
- browser screenshot capture through a connected client
- browser-side reconciliation logs

## Main Pieces

### `router.ts`

Mounts `/api/debug` and exposes read, control, and admin-write routes.

Write routes are centralized through `DebugGameAdmin` so the router no longer
reaches into engine internals directly for spawn, move, or conversation writes.

Useful route groups:

- runtime inspection
- stepping and input control
- scenario loading
- queue-backed spawn, move, and conversation helpers
- memory helpers
- autonomy, entities, bears, and inventory
- screenshot capture

### `asciiMap.ts`

Renders a terminal-friendly snapshot of:

- walls
- water
- floor
- activity markers
- player initials
- a legend with positions and states

### `scenarios.ts`

Provides named respawn setups while keeping the loaded world intact.

Built-in scenarios:

- `empty`
- `two_founders_meet`
- `founding_band`

### `movementHarness.ts`

Deterministic in-memory harness for movement and collision issues.

It supports:

- scripted actions
- filtered event traces
- ASCII snapshots
- JSON output
- replay bundles

### `conversationHarness.ts`

Live harness that starts a real server process and opens real WebSocket clients.

It is the better tool when you need to validate:

- queued conversation flows
- WebSocket broadcast isolation
- NPC reply behavior through the normal runtime path

### `debugDashboard.ts`

The dedicated dashboard subscribes to the server debug WebSocket feed and keeps
live panels for:

- conversations
- autonomy state
- derived alerts
- recent debug events

Use it when you want a long-running operator view instead of the smaller
gameplay overlay.

## Useful Commands

Movement harness:

```bash
cd server
npm run debug:movement -- --list
npm run debug:movement -- --scenario path_handoff
npm run debug:movement -- --scenario simultaneous_input_release --bundle /tmp/w-a.json
```

Conversation harness:

```bash
cd server
npm run debug:conversation -- --list
npm run debug:conversation -- --scenario human_to_npc_conversation
```

## Screenshot Flow

`POST /api/debug/capture-screenshot` asks a connected browser client to send a
PNG of the current canvas. The server can then return it from
`GET /api/debug/screenshot`.

This is useful for quick visual checks without introducing a separate browser
automation layer.

## Browser-Side Debug Helpers

`client/src/debugLog.ts` exposes:

```js
window.__AI_TOWN_CLIENT_DEBUG__?.getEvents()
window.__AI_TOWN_CLIENT_DEBUG__?.clear()
```

That log captures reconciliation corrections so you can tell whether a visual
problem came from prediction drift or from authoritative server state.

## Recommended Use

Use the tools in this order:

1. inspect state with `/api/debug`
2. watch the dedicated dashboard if the issue is live and multi-system
3. reproduce deterministically with a harness when possible
4. save a bundle if the issue is movement-related
5. add or update a runtime-facing test
6. re-check live state through the debug API
