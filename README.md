# AI Town

A multiplayer social simulation game where AI-driven NPCs and human players inhabit a tile-based town, move around, and have conversations. NPCs form memories, reflect on experiences, and develop relationships over time.

Inspired by the Stanford [Generative Agents](https://arxiv.org/abs/2304.03442) paper and [a16z-infra/ai-town](https://github.com/a16z-infra/ai-town), rebuilt from scratch with a custom game engine, PostgreSQL + pgvector for memory, and (coming soon) Claude Code sessions as NPC brains.

## Quick Start

```bash
# Start the server and database
docker compose up --build -d

# Load NPCs into the town
curl -X POST localhost:3001/api/debug/scenario \
  -H 'Content-Type: application/json' \
  -d '{"name":"crowded_town"}'

# See the map
curl localhost:3001/api/debug/map

# Start the browser client (separate terminal)
cd client && npm install && npm run dev
# Open http://localhost:5173
```

See [docs/getting-started.md](docs/getting-started.md) for the full setup guide.

## What You Can Do

**Watch the map via terminal:**
```bash
curl localhost:3001/api/debug/map
```
```
┌────────────────────┐
│####################│
│#....#........#....#│
│#..A.#........#.B..#│
│#..☕.#........#.📚..#│
│#....#........#....#│
│##.###........##.###│
│#..................#│
│#.........C........#│
│#........⛲.........#│
│#..................#│
│#....🪑...##...🪑....#│
│#....D...##...E....#│
│####################│
└────────────────────┘
```

**Move NPCs around:**
```bash
curl -X POST localhost:3001/api/debug/move \
  -H 'Content-Type: application/json' \
  -d '{"playerId":"npc_alice","x":10,"y":10}'

curl -X POST localhost:3001/api/debug/tick \
  -H 'Content-Type: application/json' -d '{"count":15}'
```

**Run conversations:**
```bash
curl -X POST localhost:3001/api/debug/start-convo \
  -H 'Content-Type: application/json' \
  -d '{"player1Id":"npc_alice","player2Id":"npc_bob"}'

curl -X POST localhost:3001/api/debug/tick \
  -H 'Content-Type: application/json' -d '{"count":2}'

curl -X POST localhost:3001/api/debug/say \
  -H 'Content-Type: application/json' \
  -d '{"playerId":"npc_alice","convoId":1,"content":"The cafe smells great today"}'
```

**Play in the browser:** Open http://localhost:5173, enter your name, click Join, and use **WASD** or **arrow keys** to move around the map.

## Architecture

```
Browser (PixiJS, :5173) ---ws---> Game Server (Node.js, :3001)
                                    |-- Game Loop (tick-based)
                                    |-- Debug HTTP API
                                    |-- WebSocket Server
                                    |-- Memory Manager
                                    |
                                  PostgreSQL + pgvector (:5432)
```

- **Game engine** is tick-based and fully deterministic (seeded RNG). Server defaults to `realtime` mode (20 ticks/sec). Tests use `stepped` mode (manual ticks).
- **Two movement systems**: WASD/arrow keys for instant tile-by-tile movement (client-side prediction, no pathfinding), and A* pathfinding for NPC/API-driven movement on a 20x20 tile grid.
- **Conversations** follow a state machine: `invited -> walking -> active -> ended`.
- **Memory system** stores NPC memories as vector embeddings in PostgreSQL with pgvector. Retrieval ranks by recency, importance, and semantic relevance.
- **Debug API** lets you observe and control everything via curl. See [docs/debug-api.md](docs/debug-api.md).

See [docs/architecture.md](docs/architecture.md) for diagrams and detailed data flow.

## Project Structure

```
server/src/
  engine/        # Core simulation (GameLoop, World, A*, Conversations, RNG)
  network/       # WebSocket server and protocol types
  db/            # PostgreSQL schema, migrations, repository
  npc/           # Memory manager, embeddings
  debug/         # HTTP debug API, ASCII map, scenarios
client/src/
  renderer.ts    # PixiJS tile map and player sprites
  network.ts     # WebSocket client
  ui.ts          # Chat panel, player list
data/
  map.json       # 20x20 town map
  characters.ts  # NPC personality definitions
```

## Running Tests

```bash
docker compose exec game-server npx vitest run
```

79 tests covering: game loop, pathfinding, conversations, WebSocket protocol, ASCII map rendering, scenarios, event logging, embeddings, memory scoring, and performance benchmarks.

## Tech Stack

| Component | Technology |
|-----------|-----------|
| Server | Node.js 20, TypeScript 5.7, Express 4 |
| WebSocket | ws 8 |
| Database | PostgreSQL 16 + pgvector |
| Client | PixiJS 8, Vite 6 |
| Testing | Vitest 3 |
| Infrastructure | Docker Compose |

## NPCs

Five NPCs with distinct personalities:

| Name | Role | Hangout |
|------|------|---------|
| Alice Chen | Software engineer, sci-fi lover | Cafe |
| Bob Martinez | Retired teacher, history buff | Library |
| Carol Washington | Artist, nature observer | Town square |
| Dave Kim | Environmental science student | Park |
| Eve Okafor | Bakery owner, town gossip | Park bench |

## Roadmap

- [x] Phase 1: Docker + PostgreSQL + bare server
- [x] Phase 2: Game engine (world, ticks, pathfinding, RNG)
- [x] Phase 3: Debug HTTP API + ASCII map
- [x] Phase 4: Conversations + WebSocket
- [x] Phase 5: Memory system + DB persistence
- [x] Phase 6: Browser client (PixiJS)
- [ ] Phase 7: NPC brains (Claude Code sessions)
- [ ] Phase 8: Full social simulation (schedules, relationships, reflection)

## License

MIT
