# Networking

This document covers transport and protocol boundaries across `server/src/network/`, `server/src/index.ts`, the client WebSocket wrapper, and the HTTP surfaces used by the browser.

## Transport Surfaces

The project exposes three runtime transport surfaces:

- WebSocket on `ws://localhost:3001`
- Express HTTP on `http://localhost:3001`
- Vite dev server on `http://localhost:5173`

The browser uses them like this:

- `fetch("/api/...")` and `fetch("/data/...")` go through the Vite proxy to `:3001`
- WebSocket connects directly to `:3001`, not through the Vite proxy path

## Protocol Definitions

`server/src/network/protocol.ts` defines the authoritative WebSocket protocol.

### Server To Client

- `state`: full snapshot used on connection
- `tick`: tick heartbeat carrying the current tick number
- `player_update`: incremental player update
- `player_joined`: new player preview or authoritative join broadcast
- `player_left`: disconnection/removal broadcast
- `convo_update`: conversation state update
- `message`: conversation message broadcast
- `error`: immediate validation or protocol error

`state` does not include map tiles. It only includes world dimensions, players, conversations, and activities. The browser fetches the actual map JSON separately.

### Client To Server

- `join`
- `move`
- `move_direction`
- `input_start`
- `input_stop`
- `say`
- `start_convo`
- `end_convo`
- `ping`

## Server-Side WebSocket Flow

`server/src/network/websocket.ts` manages connection state.

### On Connection

1. Store a `ClientInfo` record with `playerId = null`.
2. Build a full snapshot from `GameLoop`.
3. Send the initial `state` message.
4. Register message and close handlers.

### On `join`

1. Reject duplicate joins on the same socket.
2. Allocate a new `human_N` id.
3. Choose a spawn point from the loaded world.
4. Queue a `spawn` command.
5. Send an immediate preview `player_joined` message back to that client.

That preview is intentionally optimistic. The authoritative spawn still happens on the next tick.

### On Movement Messages

- `move`: enqueue `move_to`
- `move_direction`: enqueue `move_direction`
- `input_start`: call `game.setPlayerInput(..., true)` immediately
- `input_stop`: call `game.setPlayerInput(..., false)` immediately

Held input is the only movement surface that mutates engine input state outside the command queue.

### On Conversation Messages

- `say`: validates that the player is currently in an active conversation, then enqueues `say`
- `start_convo`: enqueues `start_convo`
- `end_convo`: resolves the player’s current conversation and enqueues `end_convo`

### On Close

If the client had joined:

- queue an `end_convo` for the player’s active conversation, if any
- queue a `remove` command for the player

## Broadcast Bridge

`server/src/index.ts` listens to `game.on("*")` and translates engine events to WebSocket messages.

Current mappings:

- `spawn` -> `player_joined`
- `despawn` -> `player_left`
- `move_direction`, `move_start`, `input_move`, `player_update`, `move_end` -> `player_update`
- `convo_started`, `convo_accepted`, `convo_active`, `convo_ended` -> `convo_update`
- `convo_message` -> `message`
- `tick_complete` -> `tick`

This keeps transport logic outside the engine and means transport consumers only see engine-approved events.

## HTTP Surfaces

### Health

`GET /health` returns:

- simulation tick
- database connectivity state
- current NPC provider stack name

Without a live database, health reports `status: "degraded"` even though the game loop still runs.

### Static Map Data

`GET /data/map.json` serves the loaded map file from disk. The browser uses it to render tiles and spawn the prediction collision map.

### Debug API

`/api/debug/*` is the main inspection/control API for local development. See:

- [Debug API reference](debug-api.md)
- [Debug tooling](debug-tooling.md)

## Browser Networking Layer

`client/src/network.ts` wraps the browser WebSocket.

Behavior:

- auto-selects `ws:` or `wss:` from `window.location.protocol`
- defaults to `hostname:3001`
- reconnects automatically after `2` seconds on close
- broadcasts parsed messages to registered handlers
- does not queue outgoing messages while disconnected

## Vite Proxy

`client/vite.config.ts` proxies:

- `/api` -> `http://localhost:3001`
- `/data` -> `http://localhost:3001`
- `/ws` -> `ws://localhost:3001`

The `/ws` proxy exists, but the current browser client does not use it because `client/src/network.ts` connects directly to `:3001`.

## Known Gaps

- There is no shared protocol package. `client/src/types.ts` mirrors the server protocol manually.
- The WebSocket layer does not authenticate users.
- Human ids are allocated from a process-local counter and reset on server restart.
- The browser has no first-class UI for conversation initiation; most conversation starts happen through NPC initiation or debug tooling.
