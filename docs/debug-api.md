# Debug API Reference

All endpoints are mounted at `/api/debug/`. The debug API is the primary way to observe and control the game, both for human developers and AI agents.

Base URL: `http://localhost:3001/api/debug`

## Read Endpoints

### GET /state

High-level game state.

```bash
curl localhost:3001/api/debug/state
```

```json
{
  "tick": 42,
  "mode": "stepped",
  "tickRate": 2,
  "playerCount": 5,
  "world": { "width": 20, "height": 20 }
}
```

### GET /map

ASCII map of the world. Shows walls (`#`), floor (`.`), players (first letter), and activities (emoji).

```bash
curl localhost:3001/api/debug/map
```

```
+--------------------+
|####################|
|#....#........#....#|
|#.A..#........#.B..#|
|#....#........#....#|
|##.###........##.###|
|#..................#|
|#.........C........#|
|#..................#|
|####################|
+--------------------+

Legend:
  A = Alice Chen(3,3) idle
  B = Bob Martinez(16,3) idle
  C = Carol Washington(10,10) idle
```

Add `?format=json` for structured output:

```bash
curl 'localhost:3001/api/debug/map?format=json'
```

### GET /players

All players with full state.

```bash
curl localhost:3001/api/debug/players
```

```json
[
  {
    "id": "npc_alice",
    "name": "Alice Chen",
    "description": "A curious software engineer...",
    "isNpc": true,
    "x": 3,
    "y": 3,
    "orientation": "down",
    "speed": 1,
    "state": "idle"
  }
]
```

### GET /players/:id

Single player detail.

```bash
curl localhost:3001/api/debug/players/npc_alice
```

### GET /conversations

All conversations (active and ended).

```bash
curl localhost:3001/api/debug/conversations
```

```json
[
  {
    "id": 1,
    "player1Id": "npc_alice",
    "player2Id": "npc_bob",
    "state": "active",
    "messages": [
      { "id": 1, "convoId": 1, "playerId": "npc_alice", "content": "Hello!", "tick": 5 }
    ],
    "startedTick": 3
  }
]
```

### GET /conversations/:id

Single conversation with messages.

```bash
curl localhost:3001/api/debug/conversations/1
```

### GET /activities

All activity locations on the map.

```bash
curl localhost:3001/api/debug/activities
```

```json
[
  { "id": 1, "name": "cafe counter", "description": "A cozy cafe...", "x": 3, "y": 3, "capacity": 2, "emoji": "☕" }
]
```

### GET /log

Game event log (in-memory ring buffer).

```bash
# Last 10 events
curl 'localhost:3001/api/debug/log?limit=10'

# Events since tick 50
curl 'localhost:3001/api/debug/log?since=50'

# Events for a specific player
curl 'localhost:3001/api/debug/log?playerId=npc_alice&limit=20'
```

### GET /scenarios

List available predefined scenarios.

```bash
curl localhost:3001/api/debug/scenarios
```

```json
[
  { "name": "empty", "description": "Empty world, no players" },
  { "name": "two_npcs_near_cafe", "description": "Alice and Bob spawned near the cafe" },
  { "name": "crowded_town", "description": "All 5 NPCs spawned at various locations" }
]
```

### GET /memories/:playerId

All memories for a player (requires database).

```bash
curl localhost:3001/api/debug/memories/npc_alice

# Filter by type
curl 'localhost:3001/api/debug/memories/npc_alice?type=conversation&limit=5'
```

### GET /memories/:playerId/search

Vector similarity search on memories.

```bash
curl 'localhost:3001/api/debug/memories/npc_alice/search?q=coffee&k=3'
```

## Command Endpoints

### POST /tick

Advance the game by N ticks (default 1).

```bash
# Advance 1 tick
curl -X POST localhost:3001/api/debug/tick -H 'Content-Type: application/json' -d '{}'

# Advance 10 ticks
curl -X POST localhost:3001/api/debug/tick -H 'Content-Type: application/json' -d '{"count":10}'
```

```json
{ "tick": 10, "events": [{ "tick": 5, "type": "move_end", "playerId": "npc_alice" }] }
```

### POST /spawn

Spawn a player at a position.

```bash
curl -X POST localhost:3001/api/debug/spawn -H 'Content-Type: application/json' \
  -d '{"id":"npc_test","name":"Test NPC","x":5,"y":5,"isNpc":true,"description":"A test character"}'
```

### POST /move

Set a player's movement target. The server computes the A* path.

```bash
curl -X POST localhost:3001/api/debug/move -H 'Content-Type: application/json' \
  -d '{"playerId":"npc_alice","x":10,"y":10}'
```

```json
{ "path": [{"x":3,"y":3}, {"x":3,"y":4}, {"x":4,"y":4}, ...] }
```

**Note:** Movement only happens when ticks advance. After calling `/move`, call `/tick` to see the player actually walk.

### POST /start-convo

Start a conversation between two players.

```bash
curl -X POST localhost:3001/api/debug/start-convo -H 'Content-Type: application/json' \
  -d '{"player1Id":"npc_alice","player2Id":"npc_bob"}'
```

After starting, tick the game to progress the conversation through `invited -> walking -> active`.

### POST /say

Send a message in an active conversation.

```bash
curl -X POST localhost:3001/api/debug/say -H 'Content-Type: application/json' \
  -d '{"playerId":"npc_alice","convoId":1,"content":"Hello Bob"}'
```

**Important:** The conversation must be in `active` state. If you get `"Conversation is not active"`, tick a few times first to let the conversation progress through `invited -> walking -> active`.

### POST /end-convo

End a conversation.

```bash
curl -X POST localhost:3001/api/debug/end-convo -H 'Content-Type: application/json' \
  -d '{"convoId":1}'
```

### POST /reset

Clear all game state (players, conversations, logs). Keeps the world map loaded.

```bash
curl -X POST localhost:3001/api/debug/reset -H 'Content-Type: application/json' -d '{}'
```

### POST /scenario

Load a predefined scenario. Removes existing players first.

```bash
curl -X POST localhost:3001/api/debug/scenario -H 'Content-Type: application/json' \
  -d '{"name":"crowded_town"}'
```

### POST /mode

Switch between stepped and realtime mode.

```bash
# Enable realtime (auto-ticks)
curl -X POST localhost:3001/api/debug/mode -H 'Content-Type: application/json' \
  -d '{"mode":"realtime"}'

# Back to stepped (manual ticks)
curl -X POST localhost:3001/api/debug/mode -H 'Content-Type: application/json' \
  -d '{"mode":"stepped"}'
```

### POST /memories

Create a memory directly.

```bash
curl -X POST localhost:3001/api/debug/memories -H 'Content-Type: application/json' \
  -d '{"playerId":"npc_alice","type":"observation","content":"The town square is quiet today","importance":3}'
```

### POST /remember-convo

Generate memories for both participants of a conversation.

```bash
curl -X POST localhost:3001/api/debug/remember-convo -H 'Content-Type: application/json' \
  -d '{"convoId":1}'
```

## Common Workflows

### Run a full conversation

```bash
# 1. Load scenario
curl -X POST localhost:3001/api/debug/scenario -H 'Content-Type: application/json' \
  -d '{"name":"two_npcs_near_cafe"}'

# 2. Start conversation
curl -X POST localhost:3001/api/debug/start-convo -H 'Content-Type: application/json' \
  -d '{"player1Id":"npc_alice","player2Id":"npc_bob"}'

# 3. Tick to activate (NPC auto-accepts + proximity check)
curl -X POST localhost:3001/api/debug/tick -H 'Content-Type: application/json' \
  -d '{"count":2}'

# 4. Exchange messages
curl -X POST localhost:3001/api/debug/say -H 'Content-Type: application/json' \
  -d '{"playerId":"npc_alice","convoId":1,"content":"The cafe smells great"}'
curl -X POST localhost:3001/api/debug/say -H 'Content-Type: application/json' \
  -d '{"playerId":"npc_bob","convoId":1,"content":"I love the new blend"}'

# 5. End and create memories
curl -X POST localhost:3001/api/debug/end-convo -H 'Content-Type: application/json' \
  -d '{"convoId":1}'
curl -X POST localhost:3001/api/debug/remember-convo -H 'Content-Type: application/json' \
  -d '{"convoId":1}'

# 6. Query memories
curl localhost:3001/api/debug/memories/npc_alice
```

### Watch a player move

```bash
curl -X POST localhost:3001/api/debug/scenario -H 'Content-Type: application/json' \
  -d '{"name":"crowded_town"}'
curl -X POST localhost:3001/api/debug/move -H 'Content-Type: application/json' \
  -d '{"playerId":"npc_alice","x":10,"y":10}'

# Tick and watch
for i in $(seq 1 5); do
  curl -X POST localhost:3001/api/debug/tick -H 'Content-Type: application/json' -d '{}'
  curl -s localhost:3001/api/debug/map
  echo "---"
done
```
