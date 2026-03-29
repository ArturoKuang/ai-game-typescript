# Debug API Reference

The debug API is mounted at:

```text
http://localhost:3001/api/debug
```

It is the main inspection and control surface for the simulation.

Runtime notes:

- The server starts with the default world loaded.
- Five NPCs are spawned immediately at boot.
- The main server runs in `realtime` mode at 20 ticks/sec unless changed through `/mode`.

## Read Endpoints

### `GET /state`

High-level runtime summary.

```bash
curl localhost:3001/api/debug/state
```

### `GET /map`

Returns the ASCII map as plain text.

```bash
curl localhost:3001/api/debug/map
```

Use `format=json` to get both the rendered map and legend in JSON:

```bash
curl 'localhost:3001/api/debug/map?format=json'
```

### `GET /players`

Returns every player with full server-side state.

```bash
curl localhost:3001/api/debug/players
```

### `GET /players/:id`

Returns one player by id.

```bash
curl localhost:3001/api/debug/players/npc_alice
```

### `GET /activities`

Returns the activity markers embedded in `data/map.json`.

```bash
curl localhost:3001/api/debug/activities
```

### `GET /log`

Returns the in-memory ring-buffer event log.

Query params:

- `since`
- `limit`
- `playerId`
- `type` comma-separated event types

```bash
curl 'localhost:3001/api/debug/log?limit=20'
curl 'localhost:3001/api/debug/log?since=50'
curl 'localhost:3001/api/debug/log?playerId=npc_alice&limit=20'
curl 'localhost:3001/api/debug/log?playerId=human_1&type=input_state,input_move,player_collision&limit=20'
```

### `GET /scenarios`

Lists the built-in scenarios.

```bash
curl localhost:3001/api/debug/scenarios
```

### `GET /conversations`

Returns all conversations, including ended ones.

```bash
curl localhost:3001/api/debug/conversations
```

### `GET /conversations/:id`

Returns a single conversation.

```bash
curl localhost:3001/api/debug/conversations/1
```

### `GET /memories/:playerId`

Returns stored memories for a player.

Query params:

- `limit`
- `type`

```bash
curl localhost:3001/api/debug/memories/npc_alice
curl 'localhost:3001/api/debug/memories/npc_alice?type=conversation&limit=5'
```

### `GET /memories/:playerId/search`

Runs vector search over a player's memories.

Query params:

- `q` required
- `k` optional, default `5`

```bash
curl 'localhost:3001/api/debug/memories/npc_alice/search?q=coffee&k=3'
```

## Command Endpoints

### `POST /tick`

Advances the simulation manually. Most useful in `stepped` mode.

```bash
curl -X POST localhost:3001/api/debug/tick \
  -H 'Content-Type: application/json' \
  -d '{"count":10}'
```

### `POST /spawn`

Spawns a player immediately.

Required body fields:

- `id`
- `name`
- `x`
- `y`

Optional fields:

- `isNpc`
- `description`
- `personality`
- `speed`

```bash
curl -X POST localhost:3001/api/debug/spawn \
  -H 'Content-Type: application/json' \
  -d '{"id":"npc_test","name":"Test NPC","x":5,"y":5,"isNpc":true}'
```

### `POST /move`

Assigns an A* target to a player.

```bash
curl -X POST localhost:3001/api/debug/move \
  -H 'Content-Type: application/json' \
  -d '{"playerId":"npc_alice","x":10,"y":10}'
```

This fails when:

- The target is unreachable
- The player does not exist
- The player is currently conversing

### `POST /input`

Starts or stops continuous directional input for a player.

Required body fields:

- `playerId`
- `direction`: `up`, `down`, `left`, `right`
- `active`: `true` or `false`

```bash
curl -X POST localhost:3001/api/debug/input \
  -H 'Content-Type: application/json' \
  -d '{"playerId":"human_1","direction":"right","active":true}'

curl -X POST localhost:3001/api/debug/input \
  -H 'Content-Type: application/json' \
  -d '{"playerId":"human_1","direction":"right","active":false}'
```

Movement-specific log events to watch for in `GET /log`:

- `input_state`
- `player_collision`
- `input_move`
- `move_start`
- `move_cancelled`
- `move_end`

### `POST /scenario`

Clears the current players, keeps the loaded world, and applies a named scenario.

```bash
curl -X POST localhost:3001/api/debug/scenario \
  -H 'Content-Type: application/json' \
  -d '{"name":"two_npcs_near_cafe"}'
```

Built-in scenarios:

- `empty`
- `two_npcs_near_cafe`
- `crowded_town`

## Headless Movement Harness

For movement and collision debugging without the runtime server, use the in-memory harness:

```bash
cd server
npm run debug:movement -- --list
npm run debug:movement -- --scenario path_handoff
npm run debug:movement -- --scenario input_blocked_by_player --format json
npm run debug:movement -- --scenario simultaneous_input_release --bundle /tmp/w-a.json
```

This runs deterministic scripted scenarios and prints snapshots, ASCII maps, filtered movement events, and expected-trace verification. Use `--bundle` to save a replayable JSON artifact with the map, script timeline, snapshots, and flattened event trace.

For browser-side reconciliation debugging, inspect:

```js
window.__AI_TOWN_CLIENT_DEBUG__?.getEvents()
```

### `POST /start-convo`

Starts a conversation between two players.

```bash
curl -X POST localhost:3001/api/debug/start-convo \
  -H 'Content-Type: application/json' \
  -d '{"player1Id":"npc_alice","player2Id":"npc_bob"}'
```

New conversations begin in `invited`, then advance through `walking` to `active`.

### `POST /say`

Adds a message to an active conversation.

```bash
curl -X POST localhost:3001/api/debug/say \
  -H 'Content-Type: application/json' \
  -d '{"playerId":"npc_alice","convoId":1,"content":"Hello Bob"}'
```

The conversation must already be in `active`.

### `POST /end-convo`

Ends a conversation immediately.

```bash
curl -X POST localhost:3001/api/debug/end-convo \
  -H 'Content-Type: application/json' \
  -d '{"convoId":1}'
```

### `POST /mode`

Switches between `realtime` and `stepped`.

```bash
curl -X POST localhost:3001/api/debug/mode \
  -H 'Content-Type: application/json' \
  -d '{"mode":"stepped"}'
```

Current implementation note:

- The response includes `tickRate`
- The endpoint does not currently change `tickRate`, even if you send one

### `POST /memories`

Creates a memory explicitly.

Required body fields:

- `playerId`
- `type`
- `content`

Optional fields:

- `importance`
- `tick`

```bash
curl -X POST localhost:3001/api/debug/memories \
  -H 'Content-Type: application/json' \
  -d '{"playerId":"npc_alice","type":"observation","content":"The cafe was busy today","importance":6}'
```

### `POST /remember-convo`

Creates conversation memories for both participants in a stored conversation.

```bash
curl -X POST localhost:3001/api/debug/remember-convo \
  -H 'Content-Type: application/json' \
  -d '{"convoId":1}'
```

### `POST /reset`

Resets the entire game loop.

```bash
curl -X POST localhost:3001/api/debug/reset
```

Important:

- This clears players, conversations, logs, commands, and the loaded world
- The default map is not reloaded automatically after this endpoint
- For normal debugging, prefer `POST /scenario`

## Common Sequences

### Switch to manual stepping

```bash
curl -X POST localhost:3001/api/debug/mode \
  -H 'Content-Type: application/json' \
  -d '{"mode":"stepped"}'

curl -X POST localhost:3001/api/debug/tick \
  -H 'Content-Type: application/json' \
  -d '{"count":5}'
```

### Start and advance a conversation

```bash
curl -X POST localhost:3001/api/debug/start-convo \
  -H 'Content-Type: application/json' \
  -d '{"player1Id":"npc_alice","player2Id":"npc_bob"}'

curl -X POST localhost:3001/api/debug/tick \
  -H 'Content-Type: application/json' \
  -d '{"count":5}'

curl localhost:3001/api/debug/conversations
```

### Store and search memories

```bash
curl -X POST localhost:3001/api/debug/memories \
  -H 'Content-Type: application/json' \
  -d '{"playerId":"npc_alice","type":"observation","content":"Coffee smelled especially strong this morning"}'

curl 'localhost:3001/api/debug/memories/npc_alice/search?q=coffee'
```
