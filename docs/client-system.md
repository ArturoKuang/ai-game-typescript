# Client System

This document covers the browser app in `client/`.

## Purpose

The client side now has two browser entry points:

- `client/index.html`: the playable town client
- `client/debug.html`: the dedicated live debug dashboard

Both stay thin relative to the authoritative server. Gameplay authority remains
on the server.

## Main Pieces

### `main.ts`

Browser coordinator and state hub for the playable client.

Startup flow:

1. initialize Pixi
2. fetch `/data/map.json`
3. fetch `/api/debug/activities`
4. connect the WebSocket
5. register UI and input handlers
6. start the render loop

State stored here includes:

- the current `gameState`
- `selfId`
- locally cached map tiles
- polled conversation debug snapshots
- polled autonomy debug snapshots
- player survival data keyed by player id

### `debugDashboard.ts`

Standalone live dashboard for inspecting the running simulation without loading
the playable world renderer.

It:

- opens the shared WebSocket client
- sends `subscribe_debug`
- consumes `debug_bootstrap` and `debug_event`
- tracks live conversations, autonomy state, alerts, and recent debug events
- reuses conversation snapshot merge helpers so transcripts stay coherent as
  incremental events arrive

### `network.ts`

Small shared WebSocket wrapper with reconnect behavior.

- no outgoing queue while disconnected
- two-second reconnect delay
- message fan-out to registered handlers
- open and close hooks for higher-level coordination

### `renderer.ts`

PixiJS renderer for the playable client:

- floor, wall, and water tiles
- activities
- players
- world entities
- conversation links
- NPC needs bars
- human HP bars when damaged

### `ui.ts`

Owns the sidebar and gameplay debug shell in `client/index.html`.

Current UI surfaces:

- join form
- player list with talk buttons
- chat log and chat input
- conversation action buttons
- inventory panel with `Eat` buttons for edible items
- survival panel for the local player
- toggleable debug menu and overlay for conversation and autonomy state

### `prediction.ts`

Pure client-side prediction for held-input movement only. Pathfinding remains
server-authoritative.

### `debugLog.ts`

Small browser-side ring buffer for reconciliation events.

Exposed as:

```js
window.__AI_TOWN_CLIENT_DEBUG__
```

### `conversationDebugState.ts`

Merges local and fetched conversation snapshots so both browser surfaces can
keep the best transcript when live updates and delayed snapshots disagree.

### `types.ts`

Manual mirror of the server protocol and shared game shapes. It is convenient
but drift-prone because there is no shared compile-time package.

## Playable Client Input Model

### Keyboard

`main.ts` handles:

- `WASD`
- arrow keys
- `E` to pick up the nearest item
- `I` to toggle inventory visibility

Rules:

- `keydown` sends `input_start` only on the first press for a direction
- `keyup` sends `input_stop`
- window blur releases every held direction
- input is ignored when a form field is focused

### Chat And Conversations

- chat submit sends `say`
- talk buttons send `start_convo`
- accept, decline, and end buttons map to the corresponding conversation
  messages

## Debug Surfaces

The two browser surfaces consume debug data differently:

- the gameplay client keeps a compact overlay and polls
  `/api/debug/conversations` plus `/api/debug/autonomy/state` every 750 ms
  while enabled
- the dedicated dashboard uses WebSocket debug streaming and does not depend on
  those polling loops for its main data

The gameplay overlay still merges fetched conversation snapshots with local
conversation state so transcripts do not regress when HTTP polling lags behind
live conversation updates.

## Reconciliation

The local player is predicted for responsiveness and corrected when
`player_update` arrives from the server.

Current correction modes:

- large divergence snaps immediately
- moderate divergence while moving lerps halfway
- smaller divergence while stopped settles more gently

These corrections are logged to `debugLog.ts`.

## Render Loop

Every animation frame in the playable client:

1. compute `dt`
2. run local held-input prediction for the self player when applicable
3. patch the predicted position into local client state
4. render the world

That is why local movement feels immediate even though the server remains
authoritative.
