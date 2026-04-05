# Debug API Reference

The debug API is mounted at `http://localhost:3001/api/debug`.

It is the main local inspection and control surface for the runtime.

## Route Semantics

Not all debug routes exercise the runtime in the same way.

- Read routes inspect live state safely.
- Control routes call engine methods or stepped tick behavior.
- Command-backed admin routes go through `DebugGameAdmin`, which enqueues the
  same gameplay commands production uses and then drains pending commands
  immediately so the route can return updated state without waiting for a full
  realtime tick.

Command-backed admin routes:

- `POST /spawn`
- `POST /move`
- `POST /start-convo`
- `POST /say`
- `POST /end-convo`

Use browser or WebSocket flows when you need the exact paced runtime behavior
across whole ticks. Use the admin routes when you need immediate inspection or
setup while still reusing the queue-driven command path.

## Read Routes

| Method | Route | Purpose |
| --- | --- | --- |
| `GET` | `/state` | tick, mode, tick rate, player count, world size |
| `GET` | `/map` | ASCII map; `?format=json` also returns a legend |
| `GET` | `/players` | all players |
| `GET` | `/players/:id` | one player |
| `GET` | `/activities` | map activities |
| `GET` | `/log` | filtered in-memory event log |
| `GET` | `/scenarios` | built-in scenario names |
| `GET` | `/conversations` | all conversations, including ended ones |
| `GET` | `/conversations/:id` | one conversation |
| `GET` | `/npc-provider` | NPC provider diagnostics |
| `GET` | `/memories/:playerId` | stored memories for one player |
| `GET` | `/memories/:playerId/search` | memory search by query text |
| `GET` | `/autonomy/state` | all autonomy debug states |
| `GET` | `/autonomy/:npcId` | one NPC autonomy debug state |
| `GET` | `/entities` | current runtime entities |
| `GET` | `/bears` | current bear entities |
| `GET` | `/inventory/:playerId` | inventory for one player |
| `GET` | `/screenshot` | latest captured browser screenshot |

Useful log query params:

- `since`
- `limit`
- `playerId`
- `type` as a comma-separated list

Example:

```bash
curl 'localhost:3001/api/debug/log?playerId=human_1&type=input_state,input_move,move_cancelled&limit=20'
```

## Write Routes

| Method | Route | Purpose |
| --- | --- | --- |
| `POST` | `/tick` | advance the simulation manually |
| `POST` | `/spawn` | enqueue and apply a spawn immediately |
| `POST` | `/move` | enqueue and apply a pathfinding target immediately |
| `POST` | `/input` | start or stop held input |
| `POST` | `/reset` | clear the runtime |
| `POST` | `/scenario` | load a named scenario |
| `POST` | `/start-convo` | enqueue and apply conversation start immediately |
| `POST` | `/say` | enqueue and apply a conversation message immediately |
| `POST` | `/end-convo` | enqueue and apply conversation end immediately |
| `POST` | `/mode` | switch between realtime and stepped mode |
| `POST` | `/memories` | create a memory directly |
| `POST` | `/remember-convo` | turn a conversation into memories |
| `POST` | `/autonomy/:npcId/needs` | override health, food, water, or social |
| `POST` | `/spawn-bear` | spawn a bear |
| `POST` | `/kill-bear` | kill a bear |
| `POST` | `/capture-screenshot` | ask a connected client to send a screenshot |

## Common Examples

### Inspect runtime state

```bash
curl localhost:3001/api/debug/state
curl localhost:3001/api/debug/map
curl localhost:3001/api/debug/players
curl localhost:3001/api/debug/autonomy/state
```

### Step the simulation

```bash
curl -X POST localhost:3001/api/debug/mode \
  -H 'Content-Type: application/json' \
  -d '{"mode":"stepped"}'

curl -X POST localhost:3001/api/debug/tick \
  -H 'Content-Type: application/json' \
  -d '{"count":10}'
```

### Move a player

```bash
curl -X POST localhost:3001/api/debug/move \
  -H 'Content-Type: application/json' \
  -d '{"playerId":"npc_alice","x":10,"y":10}'
```

### Toggle held input

```bash
curl -X POST localhost:3001/api/debug/input \
  -H 'Content-Type: application/json' \
  -d '{"playerId":"human_1","direction":"right","active":true}'
```

### Inspect entities and bears

```bash
curl localhost:3001/api/debug/entities
curl localhost:3001/api/debug/bears
curl localhost:3001/api/debug/inventory/human_1
```

### Capture a browser screenshot

```bash
curl -X POST localhost:3001/api/debug/capture-screenshot
curl localhost:3001/api/debug/screenshot > /tmp/ai-town.png
```

## Practical Guidance

- Prefer `/scenario` over `/reset` for normal debugging.
- Prefer queue-driven gameplay plus WebSocket flows when you need to reproduce
  real runtime behavior.
- Use admin routes when you want queue-backed writes without waiting for the
  next realtime tick.
- Memory creation, bear spawning, and screenshot capture remain explicit debug
  helpers rather than production gameplay paths.
