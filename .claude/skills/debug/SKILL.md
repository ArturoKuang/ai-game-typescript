---
name: debug
description: Inspect and control the AI Town game server via the debug API. Use when checking game state, spawning NPCs, advancing ticks, or inspecting the map.
argument-hint: "[command]"
---

# Debug Game State

Inspect and control the AI Town game server via the debug API. Server runs on `localhost:3001`.

## Arguments

- `$ARGUMENTS` — what to inspect or do (e.g., "show map", "spawn npc", "check state")

## Instructions

Use the debug API endpoints below to fulfill the user's request. Default to human-readable output; use `jq` for formatting JSON responses.

### State Inspection

```bash
# Game state (tick, mode, player count, world size)
curl -s localhost:3001/api/debug/state | jq .

# ASCII map (human-readable)
curl -s localhost:3001/api/debug/map

# ASCII map (JSON with legend)
curl -s 'localhost:3001/api/debug/map?format=json' | jq .

# All players with full state
curl -s localhost:3001/api/debug/players | jq .

# Single player by ID
curl -s localhost:3001/api/debug/players/alice | jq .

# Activity locations
curl -s localhost:3001/api/debug/activities | jq .

# Event log (last 20 events)
curl -s 'localhost:3001/api/debug/log?limit=20' | jq .

# Event log filtered by player
curl -s 'localhost:3001/api/debug/log?playerId=alice&limit=10' | jq .

# Event log since tick N
curl -s 'localhost:3001/api/debug/log?since=50' | jq .

# All active conversations
curl -s localhost:3001/api/debug/conversations | jq .

# Single conversation
curl -s localhost:3001/api/debug/conversations/1 | jq .

# Available scenarios
curl -s localhost:3001/api/debug/scenarios | jq .
```

### Game Control

```bash
# Advance 1 tick
curl -s -X POST localhost:3001/api/debug/tick | jq .

# Advance N ticks
curl -s -X POST localhost:3001/api/debug/tick -H 'Content-Type: application/json' -d '{"count": 10}' | jq .

# Spawn a player
curl -s -X POST localhost:3001/api/debug/spawn -H 'Content-Type: application/json' -d '{
  "id": "alice", "name": "Alice Chen", "x": 3, "y": 3, "isNpc": true,
  "description": "A curious software engineer", "personality": "friendly and inquisitive"
}' | jq .

# Move a player
curl -s -X POST localhost:3001/api/debug/move -H 'Content-Type: application/json' -d '{
  "playerId": "alice", "x": 10, "y": 10
}' | jq .

# Reset all state
curl -s -X POST localhost:3001/api/debug/reset | jq .

# Load a preset scenario (empty | two_npcs_near_cafe | crowded_town)
curl -s -X POST localhost:3001/api/debug/scenario -H 'Content-Type: application/json' -d '{"name": "two_npcs_near_cafe"}' | jq .

# Switch to stepped mode
curl -s -X POST localhost:3001/api/debug/mode -H 'Content-Type: application/json' -d '{"mode": "stepped"}' | jq .

# Switch to realtime mode
curl -s -X POST localhost:3001/api/debug/mode -H 'Content-Type: application/json' -d '{"mode": "realtime", "tickRate": 500}' | jq .
```

### Conversations

```bash
# Start a conversation between two players
curl -s -X POST localhost:3001/api/debug/start-convo -H 'Content-Type: application/json' -d '{
  "player1Id": "alice", "player2Id": "bob"
}' | jq .

# Add a message to a conversation
curl -s -X POST localhost:3001/api/debug/say -H 'Content-Type: application/json' -d '{
  "playerId": "alice", "convoId": 1, "content": "Hello Bob!"
}' | jq .

# End a conversation
curl -s -X POST localhost:3001/api/debug/end-convo -H 'Content-Type: application/json' -d '{"convoId": 1}' | jq .
```

### Memory (requires database)

```bash
# Get player memories
curl -s 'localhost:3001/api/debug/memories/alice?limit=10' | jq .

# Search memories by similarity
curl -s 'localhost:3001/api/debug/memories/alice/search?q=cafe&k=5' | jq .

# Create a memory
curl -s -X POST localhost:3001/api/debug/memories -H 'Content-Type: application/json' -d '{
  "playerId": "alice", "type": "observation", "content": "The cafe was busy today", "importance": 7
}' | jq .

# Store conversation as memory for both participants
curl -s -X POST localhost:3001/api/debug/remember-convo -H 'Content-Type: application/json' -d '{"convoId": 1}' | jq .
```

### Common Workflows

**Quick state check:**
```bash
curl -s localhost:3001/api/debug/state | jq . && curl -s localhost:3001/api/debug/map
```

**Load scenario and inspect:**
```bash
curl -s -X POST localhost:3001/api/debug/scenario -H 'Content-Type: application/json' -d '{"name": "two_npcs_near_cafe"}' | jq .
curl -s localhost:3001/api/debug/map
curl -s localhost:3001/api/debug/players | jq .
```

**Tick and watch movement:**
```bash
curl -s -X POST localhost:3001/api/debug/move -H 'Content-Type: application/json' -d '{"playerId": "alice", "x": 10, "y": 10}' | jq .
curl -s -X POST localhost:3001/api/debug/tick -H 'Content-Type: application/json' -d '{"count": 5}' | jq .
curl -s localhost:3001/api/debug/map
```
