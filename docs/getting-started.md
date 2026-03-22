# Getting Started

## Prerequisites

- Docker and Docker Compose
- Node.js 20+ (for the browser client)

## Quick Start

### 1. Start the server and database

```bash
docker compose up --build -d
```

This starts:
- **PostgreSQL + pgvector** on port 5432
- **Game server** on port 3001

Verify it's running:

```bash
curl localhost:3001/health
# {"status":"ok","tick":0,"dbConnected":true}
```

### 2. Load a scenario

The game starts empty. Load one of the predefined scenarios:

```bash
# 5 NPCs at various locations around town
curl -X POST localhost:3001/api/debug/scenario -H 'Content-Type: application/json' \
  -d '{"name":"crowded_town"}'
```

See the map:

```bash
curl localhost:3001/api/debug/map
```

### 3. Start the browser client

In a separate terminal:

```bash
cd client
npm install
npm run dev
```

Open http://localhost:5173. You should see:
- A 20x20 tile map with brown walls and dark floors
- 5 teal NPC circles at their spawn points
- Player list in the sidebar

### 4. Join and move

1. Enter your name in the sidebar and click **Join**
2. You appear as a yellow circle at a spawn point
3. Use **WASD** or **arrow keys** to move around the map

Movement is immediate — the client predicts your position locally and the server confirms. WASD keys are disabled when the chat input is focused so you can type messages normally.

The server starts in **realtime mode** at 20 ticks/sec, so NPCs and pathfinding movement update automatically.

### 5. Have a conversation

Start a conversation between two NPCs via the debug API:

```bash
# Start conversation
curl -X POST localhost:3001/api/debug/start-convo -H 'Content-Type: application/json' \
  -d '{"player1Id":"npc_alice","player2Id":"npc_bob"}'

# Tick to activate
curl -X POST localhost:3001/api/debug/tick -H 'Content-Type: application/json' \
  -d '{"count":2}'

# Send messages
curl -X POST localhost:3001/api/debug/say -H 'Content-Type: application/json' \
  -d '{"playerId":"npc_alice","convoId":1,"content":"Hi Bob"}'

# View conversation
curl localhost:3001/api/debug/conversations/1
```

## Running Tests

Tests run inside the Docker container (no database needed — they use in-memory game loops):

```bash
docker compose exec game-server npx vitest run
```

Or if you have npm working locally:

```bash
cd server && npm test
```

## Stopping

```bash
docker compose down          # stop containers
docker compose down -v       # stop and delete database volume
```

## Troubleshooting

**Server not starting:** Check Docker logs:
```bash
docker compose logs game-server
```

**Database connection errors:** Make sure the `db` container is healthy:
```bash
docker compose ps
```

**Client can't connect:** The WebSocket connects directly to `:3001`, not through Vite. Make sure the game server is running.

**Player won't move:** Make sure the chat input is not focused (click on the canvas first). WASD/arrow keys only work when no text input has focus.

**"Conversation is not active":** The conversation needs to progress through `invited -> walking -> active`. Tick 2-3 times after starting a conversation.
