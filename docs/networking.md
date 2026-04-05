# Networking

This document covers `server/src/network/`, the runtime HTTP surfaces, and the
browser-side transport wrappers.

## Transport Surfaces

The runtime exposes three main network surfaces:

- Express HTTP on `http://localhost:3001`
- WebSocket on `ws://localhost:3001`
- Vite dev server on `http://localhost:5173`

The browser uses them like this:

- `fetch("/api/...")` and `fetch("/data/...")` go through the Vite proxy
- the gameplay client in `client/index.html` opens the main game WebSocket
- the dashboard in `client/debug.html` also opens the WebSocket and subscribes
  to the debug feed

## Authoritative Protocol

`server/src/network/protocol.ts` is the source of truth for transport messages.

### Server To Client

Main message families:

- bootstrap and lifecycle: `state`, `tick`, `player_joined`, `player_left`
- gameplay deltas: `player_update`, `convo_update`, `message`
- world state: `entity_update`, `entity_removed`
- status overlays: `npc_needs`, `player_survival`, `inventory_update`
- combat and misc: `combat_event`, `capture_screenshot`, `error`
- debug stream: `debug_bootstrap`, `debug_event`, and the conversation and
  autonomy snapshot payloads those messages carry

`state` intentionally omits map tiles. The browser fetches `/data/map.json`
separately.

### Client To Server

Main client messages:

- session and debug: `join`, `subscribe_debug`, `ping`
- movement: `move`, `move_direction`, `input_start`, `input_stop`
- conversation: `say`, `start_convo`, `accept_convo`, `decline_convo`,
  `end_convo`
- combat and inventory: `attack`, `pickup`, `pickup_nearby`, `eat`
- screenshot response: `screenshot_data`

## `GameWebSocketServer`

`server/src/network/websocket.ts` owns socket state and transport translation.

### On Connection

1. Store `ClientInfo` with `playerId = null`.
2. Send a full `state` snapshot immediately.
3. Register message and close handlers.

### On `join`

1. Reject duplicate joins on the same socket.
2. Allocate a `human_N` id.
3. Choose a spawn point from the loaded world.
4. Queue a `spawn` command.
5. Send an immediate `player_joined` preview to the joining socket.

The preview is optimistic. The queued spawn is still authoritative on the next
tick.

### On Gameplay Messages

- held input updates call `setPlayerInput()` immediately
- move, conversation, combat, and inventory actions are turned into engine
  commands
- `attack`, `pickup`, and `eat` are routed through `GameLoop` and then consumed
  by external command handlers in `BearManager`

### On Debug Subscription

Sockets can send `subscribe_debug` without joining as a player.

That path is used by the dedicated dashboard. The server responds with an
initial `debug_bootstrap` snapshot and then streams incremental `debug_event`
messages as conversations, autonomy state, and other debug surfaces change.

### On Close

If the socket owned a player, the server queues:

- `end_convo` for the player’s active conversation, if any
- `remove` for the player

## Event Bridge

`server/src/index.ts` subscribes to `game.on("*")` and turns engine events into
transport messages.

Important mappings:

- player lifecycle and movement events become `player_update`,
  `player_joined`, or `player_left`
- conversation events become `convo_update` and `message`
- bear, heal, damage, and item events become `combat_event`,
  `inventory_update`, and related player refreshes
- autonomy and survival updates are broadcast separately through
  `npc_needs` and `player_survival`

This keeps transport logic outside the engine.

## HTTP Surfaces

### `GET /health`

Returns:

- simulation tick
- database health
- NPC provider diagnostics

### `GET /data/map.json`

Serves the checked-in map file used by the browser for rendering and collision
prediction.

### `/api/debug/*`

The main local inspection and control surface. See [Debug API](debug-api.md).

## Browser Networking Layer

`client/src/network.ts` is intentionally thin and is shared by the gameplay
client plus the dedicated dashboard:

- chooses `ws:` or `wss:` from the current page
- defaults to `hostname:3001`
- reconnects automatically after two seconds
- fans out parsed messages to registered handlers
- exposes `onOpen()` and `onClose()` hooks
- drops outgoing messages while disconnected

## Debug Streaming

There are now two debug consumption patterns in the browser:

- `client/index.html` keeps a compact overlay and still polls
  `/api/debug/conversations` plus `/api/debug/autonomy/state`
- `client/debug.html` uses the WebSocket debug subscription path and consumes
  `debug_bootstrap` plus `debug_event`

Both are valid, but they serve different use cases.

## Known Constraints

- There is no shared protocol package. `client/src/types.ts` mirrors the server
  protocol manually.
- WebSocket connections are unauthenticated.
- Human ids are process-local and reset on server restart.
