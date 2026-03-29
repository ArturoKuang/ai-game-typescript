# Client System

This document covers the browser app in `client/`.

## Purpose

The client is a thin interactive shell around the authoritative server. It is responsible for:

- loading the map for rendering and prediction
- opening the WebSocket
- joining as a human player
- collecting keyboard and click input
- predicting local movement between server updates
- rendering players, activities, and chat
- exposing a small browser-side debug log

It is not authoritative for gameplay state.

## Components

### `main.ts`

Browser entry point and coordinator.

Startup flow:

1. Initialize the Pixi renderer.
2. Fetch `/data/map.json`.
3. Fetch `/api/debug/activities` and render activities on top of the map.
4. Fall back to a blank bordered map if map fetch fails but `/api/debug/state` succeeds.
5. Connect the WebSocket.
6. Register message handlers, DOM listeners, click-to-move, and the render loop.

State owned in this file:

- `gameState`
- `selfId`
- `mapLoaded`
- `mapTiles`

### `network.ts`

Minimal WebSocket client with reconnect behavior.

Key properties:

- no outgoing queue while disconnected
- reconnect delay of `2` seconds
- message handlers fan out to all subscribers
- default URL is `ws(s)://<hostname>:3001`

### `renderer.ts`

PixiJS renderer for tiles, activities, players, conversation lines, and chat bubbles.

Rendering rules:

- tile size is `32 px`
- map resize is driven by map dimensions
- self player snaps to its predicted/current position
- remote players are smoothed with a `0.3` lerp factor
- NPCs, humans, and self each have distinct colors
- active conversations draw a line between participants
- waiting NPCs show a `...` bubble

### `ui.ts`

DOM-side sidebar bindings for:

- join form
- player list
- chat log
- chat input
- status bar

The UI does not currently expose:

- conversation initiation controls
- debug controls
- NPC memory inspection

### `prediction.ts`

Pure client-side movement prediction.

It mirrors the server’s continuous movement and collision rules closely enough for parity tests:

- same `MOVE_SPEED = 5.0`
- same `PLAYER_RADIUS = 0.4`
- same diagonal normalization
- same tile collision approach
- same player/player collision resolution strategy

This module only predicts held-input movement. Pathfinding remains server-authoritative.

### `debugLog.ts`

Small ring buffer for client-side debug events, mainly reconciliation corrections.

Exposed globally as:

```js
window.__AI_TOWN_CLIENT_DEBUG__
```

### `types.ts`

Manual mirror of the server-side protocol and key state types. This is convenient but not shared at compile time, so drift is a maintenance risk.

## Input Model

### Keyboard Movement

`main.ts` maps:

- `WASD`
- arrow keys

Behavior:

- `keydown` sends `input_start` only on first press per direction
- `keyup` sends `input_stop`
- window blur sends `input_stop` for every held direction
- input is ignored while focus is inside a form control

### Click To Move

Canvas click uses `renderer.screenToTile()` and sends `move` with a tile coordinate. The client does not compute the path.

### Chat

Chat submit sends `say`.

Important limitation:

- the client has no UI for starting conversations
- a human can only send a live chat message if a conversation is already active, usually because an NPC initiated it or the debug API was used

## Reconciliation Model

When a `player_update` arrives for the local player:

- if the delta is greater than `4`, snap immediately
- if movement is currently held and the delta is greater than `1.0`, snap
- if movement is currently held and the delta is greater than `0.35`, lerp halfway
- if movement is not held and the delta is greater than `0.3`, settle by `30%`

Reconciliation events are logged to `debugLog.ts`.

## Render Loop

The render loop runs via `requestAnimationFrame`.

Per frame:

1. Compute `dt`.
2. If the local player exists and is not conversing, run `predictLocalPlayerStep()`.
3. Apply predicted position/orientation to the local player inside `gameState`.
4. Render all players.

This means the local player feels responsive even though the server remains authoritative.

## Styling And UI Shell

`client/index.html` contains the current UI shell and CSS:

- monospace styling
- canvas-centered game area
- fixed-width sidebar
- join, player list, chat, and status sections

The UI is intentionally minimal and development-focused rather than production-polished.
