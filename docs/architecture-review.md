# AI Town -- Architecture Review & Recommendations

A prioritized list of architectural improvements organized by impact. Each recommendation explains what's wrong, why it matters, and what to do about it -- keeping things simple now while leaving doors open for scale later.

---

## Table of Contents

1. [The Monolith Problem: GameLoop](#1-the-monolith-problem-gameloop)
2. [Network: Stop Broadcasting Everything](#2-network-stop-broadcasting-everything)
3. [NPC Provider: Stop Spawning Processes](#3-npc-provider-stop-spawning-processes)
4. [Movement System: Unify the Two Worlds](#4-movement-system-unify-the-two-worlds)
5. [Pathfinding: Use a Heap](#5-pathfinding-use-a-heap)
6. [Conversation Manager: Add an Index](#6-conversation-manager-add-an-index)
7. [Event System: Type It and Batch It](#7-event-system-type-it-and-batch-it)
8. [Player Type: Break Up the God Object](#8-player-type-break-up-the-god-object)
9. [Memory System: Reduce Round-Trips](#9-memory-system-reduce-round-trips)
10. [Collision: Add Spatial Hashing](#10-collision-add-spatial-hashing)
11. [Logger: Fix the Ring Buffer](#11-logger-fix-the-ring-buffer)
12. [Schema Migrations: Add Versioning](#12-schema-migrations-add-versioning)
13. [Resilient Provider: Let It Recover](#13-resilient-provider-let-it-recover)
14. [Client-Server Protocol: Add Versioning and Deltas](#14-client-server-protocol-add-versioning-and-deltas)
15. [Test Gaps](#15-test-gaps)
16. [Dead Code and Unused Abstractions](#16-dead-code-and-unused-abstractions)
17. [Priority Matrix](#17-priority-matrix)

---

## 1. The Monolith Problem: GameLoop

### What's wrong

`gameLoop.ts` is 972 lines and owns everything: players, world, movement, collision, conversations, events, commands, assertions. It's the single coordination point for the entire simulation.

```
GameLoop (972 lines)
  ├─ Player management      (spawn, remove, state sync)
  ├─ Command queue           (enqueue, process 7 command types)
  ├─ Input movement          (held keys, velocity, dt scaling)
  ├─ Path movement           (A* following, waypoint stepping)
  ├─ Collision dispatch      (player-wall, player-player)
  ├─ Conversation wiring     (delegates to ConversationManager)
  ├─ Event system            (emit, subscribe, wildcard)
  ├─ Assertion framework     (5 validation methods, 90 lines)
  └─ Broadcast formatting    (strip internal fields before emit)
```

### Why it matters

- **Every feature change touches this file.** Adding a new movement mode, a new command type, or a new player state means modifying GameLoop.
- **Hard to test subsystems in isolation.** You can't test movement without standing up the full loop.
- **Parallelization impossible.** Movement processing, conversation ticking, and event emission are sequential because they're interleaved in one method.

### What to do

Extract focused systems that the GameLoop delegates to. The loop becomes a thin orchestrator:

```
BEFORE:                              AFTER:

GameLoop (972 lines)                 GameLoop (thin orchestrator, ~200 lines)
  does everything                      │
                                       ├─ CommandProcessor
                                       │    processes command queue
                                       │    validates, dispatches
                                       │
                                       ├─ MovementSystem
                                       │    owns input + path movement
                                       │    owns collision resolution
                                       │    tracks held inputs
                                       │
                                       ├─ PlayerRegistry
                                       │    Map<id, Player>
                                       │    spawn, remove, lookup
                                       │    strips internal fields for broadcast
                                       │
                                       ├─ ConversationManager (exists)
                                       │
                                       └─ EventBus
                                            emit, subscribe
                                            batches events per tick
```

**Keep it simple:** These are just classes in the same `engine/` directory. No dependency injection framework, no plugin system. GameLoop instantiates them in the constructor and calls them in order during `tick()`. The important thing is that each system can be tested independently and has a clear boundary.

**Start with MovementSystem** -- it's the largest chunk (~300 lines of movement + collision logic) and the most frequently modified code.

---

## 2. Network: Stop Broadcasting Everything

### What's wrong

Every `player_update` event is broadcast to every connected client, regardless of distance. The full `Player` object (18 fields) is cloned into the event data.

```
Tick loop:
  for each moving player:
    emit("player_update", { ...fullPlayerObject })
      → WebSocket broadcasts to ALL clients
```

At 20 ticks/sec with 50 players moving, that's 1000 broadcasts/sec, each containing the full player state.

### Why it matters

- **Bandwidth scales as O(players x clients).** 100 players x 100 clients = 10,000 messages per tick.
- **Latency increases** as serialization and send queues back up.
- **Cost increases** linearly with player count squared.
- **Most updates are irrelevant** -- a player on the opposite side of the map doesn't need to know about movement 20 tiles away.

### What to do

**Phase 1 (now): Send deltas, not full objects**

Only send changed fields. Most ticks, a moving player only changes `x`, `y`, and maybe `orientation`:

```
BEFORE:                              AFTER:
{                                    {
  type: "player_update",               type: "player_update",
  data: {                              data: {
    id, name, description,               id: "player_1",
    personality, isNpc,                   x: 5.2,
    x, y, vx, vy,                        y: 3.1,
    targetX, targetY,                     orientation: "right"
    path, pathIndex,                    }
    orientation, radius,              }
    moveSpeed, speed,
    state, currentActivityId,
    currentConvoId,
    isWaitingForResponse
  }
}
```

This alone cuts message size by ~80%.

**Phase 2 (when needed): Area-of-interest filtering**

Divide the map into regions. Only broadcast updates to clients whose player is in a nearby region:

```
+--------+--------+--------+
|  R(0,0) |  R(1,0) |  R(2,0) |
|         |         |         |
+--------+--------+--------+
|  R(0,1) |  R(1,1) |  R(2,1) |
|  PlayerA|         |  PlayerB|
+--------+--------+--------+

PlayerA only receives updates from R(0,0), R(1,0), R(0,1), R(1,1)
PlayerB only receives updates from R(1,0), R(2,0), R(1,1), R(2,1)
```

On a 20x20 map this isn't needed yet. On a 100x100 map it becomes essential.

---

## 3. NPC Provider: Stop Spawning Processes

### What's wrong

`ClaudeCodeProvider` spawns a new `claude` CLI process for every single NPC reply and reflection:

```
Every NPC reply:
  child_process.spawn("claude", ["-p", "--output-format", "json", ...prompt])
    → fork process
    → load Node.js runtime
    → parse args
    → make API call
    → serialize JSON
    → exit

Cost per reply: ~500ms-2s just in process overhead
```

### Why it matters

- **Latency:** Process spawn + teardown adds 200-500ms before any API call even starts.
- **Cost:** Each process loads the full Claude Code runtime. With 5 NPCs in active conversations, you're running 5+ concurrent Node.js processes.
- **Resource pressure:** Memory spikes on every spawn. OS process table fills up under load.
- **No batching:** If 3 NPCs need replies in the same tick, they spawn 3 separate processes sequentially.

### What to do

Replace process spawning with a direct HTTP client to the Anthropic API:

```
BEFORE:                              AFTER:

ClaudeCodeProvider                   AnthropicProvider
  spawn("claude", [...])               httpClient.post(
  parse stdout JSON                      "https://api.anthropic.com/v1/messages",
  extract result                         { model, system, messages }
                                       )

Per-reply overhead:                  Per-reply overhead:
  ~500ms process spawn                 ~5ms HTTP request setup
  + API latency                        + API latency
```

**Implementation is straightforward:**

```typescript
class AnthropicProvider implements NpcModelProvider {
  private client: Anthropic;  // @anthropic-ai/sdk

  async generateReply(req: NpcReplyRequest): Promise<NpcModelResponse> {
    const prompt = buildReplyPrompt(req);
    const start = Date.now();
    const response = await this.client.messages.create({
      model: "claude-sonnet-4-20250514",
      max_tokens: 300,
      system: prompt.system,
      messages: [{ role: "user", content: prompt.user }],
    });
    return {
      content: response.content[0].text,
      prompt: prompt.full,
      latencyMs: Date.now() - start,
    };
  }
}
```

**Bonus: enables batching.** When multiple NPCs need replies in the same tick, fire all requests concurrently with `Promise.all()` instead of sequentially spawning processes.

**Keep the scripted fallback.** The `ResilientNpcProvider` pattern is good -- just swap the primary from `ClaudeCodeProvider` to `AnthropicProvider`.

---

## 4. Movement System: Unify the Two Worlds

### What's wrong

There are two completely different movement systems with different physics models:

```
PATH MOVEMENT (NPCs, click-to-move):     INPUT MOVEMENT (WASD, humans):
  - Tile-aligned                            - Continuous (sub-pixel)
  - Speed in tiles/tick                     - Speed in units/tick (moveSpeed=5.0)
  - Discrete waypoint stepping              - Velocity-based with dt scaling
  - No collision sliding                    - Axis-aligned collision sliding
  - player.speed = 0.1                      - player.moveSpeed = 5.0
  - Stops at waypoint if blocked            - Slides along walls
```

Two speed fields (`speed` for paths, `moveSpeed` for input), two collision behaviors, two code paths (~300 lines each in GameLoop).

### Why it matters

- **Bugs hide at the boundary.** When a player switches from pathfinding to input (e.g., NPC gets WASD controls), physics change discontinuously.
- **Double maintenance.** Every collision fix needs to be applied in two places.
- **Client parity is fragile.** The client prediction mirrors the input movement physics, but path movement uses different physics entirely.

### What to do

Unify to a single movement pipeline that both systems feed into:

```
BEFORE:                              AFTER:

processInputMovement()               MovementSystem.update(player, dt)
  reads held keys                       │
  computes velocity                     ├─ resolve intent
  calls moveWithCollision()             │    path: next waypoint → desired velocity
                                        │    input: held keys → desired velocity
processPathMovement()                   │
  reads path[pathIndex]                 ├─ apply velocity with collision
  steps toward waypoint                 │    moveWithCollision(x, y, vx*dt, vy*dt)
  snaps to tile center                  │
                                        └─ update state
                                             path: advance pathIndex if arrived
                                             input: keep velocity
```

Both movement sources produce a desired velocity vector. One collision system resolves it. One speed value controls movement rate.

**Start simple:** Make path movement generate the same velocity vector that input movement uses, then feed both through `moveWithCollision()`. The path follower becomes a "virtual input" that points toward the next waypoint.

---

## 5. Pathfinding: Use a Heap

### What's wrong

The A* open list uses a plain array with linear min-search:

```typescript
// Find node with lowest f -- O(n) every iteration
let bestIdx = 0;
for (let i = 1; i < open.length; i++) {
  if (open[i].f < open[bestIdx].f) bestIdx = i;
}

// Remove duplicates with better paths -- O(n) every neighbor
const idx = open.findIndex(n => n.x === neighbor.x && n.y === neighbor.y);
if (idx !== -1) open.splice(idx, 1);  // O(n) shift
```

### Why it matters

On a 20x20 map it's fine. On a 100x100 map, open list can grow to thousands of entries, making each iteration O(n) instead of O(log n). Your own perf tests show cross-map pathfinding already takes 20-30ms per query.

### What to do

Replace with a binary min-heap. ~40 lines of code:

```typescript
class MinHeap<T> {
  private data: T[] = [];
  constructor(private compare: (a: T, b: T) => number) {}

  push(item: T) { this.data.push(item); this.bubbleUp(this.data.length - 1); }
  pop(): T | undefined { /* swap root with last, sift down */ }
  get size() { return this.data.length; }

  private bubbleUp(i: number) { /* compare with parent, swap if smaller */ }
  private siftDown(i: number) { /* compare with children, swap with smaller */ }
}
```

Also: use integer encoding (`x * height + y`) instead of string keys (`"x,y"`) for the closed set. Avoids string allocation on every neighbor check.

**Expected improvement:** 3-5x faster on large maps. Doesn't change behavior, only performance.

---

## 6. Conversation Manager: Add an Index

### What's wrong

Finding a player's conversation requires scanning all conversations:

```typescript
// O(N) scan -- called every tick for every conversing player
getPlayerConversation(playerId: string): Conversation | undefined {
  for (const c of this.conversations.values()) {
    if (c.state === "ended") continue;
    if (c.player1Id === playerId || c.player2Id === playerId) return c;
  }
}

// Also O(N) scan on start -- checks no duplicate active conversations
startConversation(player1Id, player2Id) {
  for (const c of this.conversations.values()) {
    if (c.state === "ended") continue;
    if (c.player1Id === player1Id || ...) throw new Error(...);
  }
}
```

### Why it matters

`getPlayerConversation()` is called from `syncPlayerConvoState()` every tick for every player in a conversation. At 20 ticks/sec with 10 active conversations, that's 400 linear scans per second through the conversation map. As conversations accumulate (they're never cleaned up), the scan gets slower.

### What to do

Add a reverse index:

```typescript
class ConversationManager {
  private conversations = new Map<number, Conversation>();
  private playerToConvo = new Map<string, number>();  // ADD THIS

  startConversation(p1: string, p2: string, tick: number) {
    if (this.playerToConvo.has(p1)) throw new Error(...);  // O(1)
    if (this.playerToConvo.has(p2)) throw new Error(...);  // O(1)
    const convo = { id: this.nextId++, ... };
    this.conversations.set(convo.id, convo);
    this.playerToConvo.set(p1, convo.id);  // O(1)
    this.playerToConvo.set(p2, convo.id);  // O(1)
  }

  endConversation(convoId: number) {
    const c = this.conversations.get(convoId);
    this.playerToConvo.delete(c.player1Id);  // O(1)
    this.playerToConvo.delete(c.player2Id);  // O(1)
    c.state = "ended";
  }

  getPlayerConversation(playerId: string) {  // O(1)
    const id = this.playerToConvo.get(playerId);
    return id !== undefined ? this.conversations.get(id) : undefined;
  }
}
```

Also: clean up ended conversations after a delay. The map currently grows forever.

---

## 7. Event System: Type It and Batch It

### What's wrong

Events use `Record<string, unknown>` for data, losing type safety:

```typescript
interface GameEvent {
  tick: number;
  type: string;          // just a string
  playerId?: string;
  data?: Record<string, unknown>;  // anything goes
}
```

And events are emitted individually, one at a time, causing per-event overhead in both the logger and WebSocket broadcast.

### Why it matters

- **No compile-time safety.** You can emit `{ type: "spawn", data: { wrong_field: true } }` with no error.
- **Per-event broadcast overhead.** Each event triggers a separate WebSocket send. At 20 ticks/sec with 50 players, that's JSON.stringify + ws.send called 1000+ times per second, one message at a time.

### What to do

**Type the events** with discriminated unions:

```typescript
type GameEvent =
  | { type: "spawn"; tick: number; playerId: string; data: { x: number; y: number; name: string } }
  | { type: "move_end"; tick: number; playerId: string; data: { x: number; y: number } }
  | { type: "player_update"; tick: number; playerId: string; data: { x: number; y: number; orientation: string } }
  | { type: "convo_started"; tick: number; data: { convoId: number; player1Id: string; player2Id: string } }
  // ...
```

**Batch events per tick:**

```
BEFORE:                              AFTER:

tick() {                             tick() {
  // ...movement...                    // ...movement...
  emit(event1)  // → serialize,        collect(event1)
                //   send immediately   collect(event2)
  emit(event2)  // → serialize,         collect(event3)
                //   send immediately   // end of tick:
  emit(event3)  // → serialize,         flush([event1, event2, event3])
                //   send immediately     // → one serialize, one send
}                                    }
```

One WebSocket message per tick instead of N. Clients already process updates once per frame anyway.

---

## 8. Player Type: Break Up the God Object

### What's wrong

`Player` has 18 fields mixing identity, physics, pathfinding, input, animation, and game state:

```typescript
interface Player {
  // Identity (static after spawn)
  id: string; name: string; description: string;
  personality: string; isNpc: boolean;

  // Position (changes every tick)
  x: number; y: number;

  // Pathfinding state (only used when path-following)
  targetX?: number; targetY?: number;
  path?: Position[]; pathIndex?: number;

  // Input state (only used when input-moving, stripped before broadcast)
  inputX: number; inputY: number;

  // Physics (only used when input-moving)
  vx: number; vy: number; radius: number; moveSpeed: number;

  // Animation
  orientation: "up" | "down" | "left" | "right";

  // Game state
  state: PlayerState; speed: number;
  currentActivityId?: number; currentConvoId?: number;
  isWaitingForResponse?: boolean;
}
```

### Why it matters

- **Confusion:** `speed` (path movement) and `moveSpeed` (input movement) are different things on the same object.
- **Waste:** Every broadcast sends pathfinding state (`path`, `pathIndex`, `targetX`, `targetY`) which is server-internal.
- **Coupling:** Every module that touches a player pulls in all 18 fields. Movement code sees conversation state. Conversation code sees physics.

### What to do

Separate into what gets broadcast vs what stays server-internal:

```typescript
// Broadcast to clients
interface PlayerPublic {
  id: string;
  name: string;
  isNpc: boolean;
  x: number;
  y: number;
  orientation: Direction;
  state: PlayerState;
  currentConvoId?: number;
  isWaitingForResponse?: boolean;
}

// Server-only state
interface PlayerInternal {
  public: PlayerPublic;
  description: string;
  personality: string;
  // Movement
  speed: number;
  radius: number;
  vx: number;
  vy: number;
  // Pathfinding
  path?: Position[];
  pathIndex?: number;
  targetX?: number;
  targetY?: number;
  // Input
  inputX: number;
  inputY: number;
}
```

Now broadcasting is just `JSON.stringify(player.public)` -- no stripping needed, no accidental internal state leakage.

---

## 9. Memory System: Reduce Round-Trips

### What's wrong

Every NPC reply triggers a memory retrieval pipeline:

```
generateReply()
  │
  ├─ embed(last 4 messages concatenated)     → 1 embedding call
  ├─ searchMemoriesByVector(embedding, 6*k)  → 1 DB query (pgvector)
  ├─ score and re-rank in application        → CPU
  └─ return top k

Per reply: 1 embedding + 1 DB round-trip + scoring
```

The 6x overfetch (fetch 6*k candidates, return k) is wasteful when pgvector can do most of the ranking in SQL.

### Why it matters

- **Latency:** Each DB round-trip adds 1-5ms in Docker, 5-20ms over network. Embedding adds more.
- **The overfetch is mostly wasted.** pgvector's approximate nearest neighbor already returns good candidates. Re-ranking by recency and importance can be done in SQL.

### What to do

Push the composite scoring into SQL:

```sql
-- Single query: vector similarity + recency + importance, all in one
SELECT *,
  (1.0 - (embedding <=> $1)) AS relevance,
  POWER(0.99, $2 - tick) AS recency,
  importance / 10.0 AS imp_score,
  (1.0 - (embedding <=> $1)) + POWER(0.99, $2 - tick) + importance / 10.0 AS score
FROM memories
WHERE player_id = $3
ORDER BY score DESC
LIMIT $4;
```

One query, no overfetch, no application-side re-ranking. The results are the same (or better, since pgvector sees the full candidate set).

**Also:** Cache the embedding for the current conversation context. If the last 4 messages haven't changed since the previous reply, reuse the embedding vector.

---

## 10. Collision: Add Spatial Hashing

### What's wrong

Player-player collision checks every player against every other player:

```typescript
// Called for every moving player, every tick
findBlockingPlayer(playerId, x, y, radius, players): Player | undefined {
  for (const [id, p] of players) {
    if (id === playerId) continue;
    const dx = p.x - x;
    const dy = p.y - y;
    const minDist = radius + p.radius;
    if (Math.abs(dx) < minDist && Math.abs(dy) < minDist) return p;
  }
}
```

### Why it matters

O(n) per moving player per tick. With 100 players, 50 moving: 50 * 100 = 5000 checks per tick, 100,000 checks per second. Each check involves Map iteration overhead.

On a 20x20 map with 5-10 players, this is fine. It becomes the bottleneck before you hit 100 players.

### What to do

When needed, add a spatial hash grid. Tile-based games make this trivial since tiles are already a grid:

```typescript
class SpatialGrid {
  private cells = new Map<number, Set<string>>();  // cellKey → playerIds

  private key(x: number, y: number): number {
    return Math.floor(x) * this.height + Math.floor(y);
  }

  update(player: Player) {
    // remove from old cell, add to new cell
  }

  getNearby(x: number, y: number, radius: number): string[] {
    // check only cells within radius (usually 1-4 cells)
  }
}
```

**Don't add this now.** The 20x20 map with 5-10 players doesn't need it. Add it when player count exceeds ~50 or map size exceeds ~50x50. The important thing is that the collision check is behind `findBlockingPlayer()` -- when you need spatial hashing, you swap the implementation inside that function without touching anything else.

---

## 11. Logger: Fix the Ring Buffer

### What's wrong

The "ring buffer" uses `Array.shift()` which is O(n):

```typescript
log(event: GameEvent) {
  this.buffer.push(event);
  if (this.buffer.length > this.maxSize) {
    this.buffer.shift();  // O(n) -- shifts all elements left
  }
}
```

And filtering creates intermediate arrays:

```typescript
getEvents(options?) {
  let events = this.buffer;
  if (options?.since) events = events.filter(...);     // new array
  if (options?.playerId) events = events.filter(...);  // new array
  if (options?.types) events = events.filter(...);     // new array
  if (options?.limit) events = events.slice(-limit);   // new array
  return events;
}
```

### Why it matters

`log()` is called on every event (20+ times per tick at 20 ticks/sec). With `maxSize=1000`, each `shift()` copies 999 elements. That's ~400,000 element copies per second for logging alone.

### What to do

Use a proper circular buffer:

```typescript
class CircularBuffer<T> {
  private buffer: (T | undefined)[];
  private head = 0;
  private count = 0;

  constructor(private capacity: number) {
    this.buffer = new Array(capacity);
  }

  push(item: T) {
    this.buffer[(this.head + this.count) % this.capacity] = item;
    if (this.count < this.capacity) this.count++;
    else this.head = (this.head + 1) % this.capacity;
  }  // O(1), always
}
```

For filtering, use a single-pass compound predicate instead of chained `.filter()` calls:

```typescript
getEvents(options?: FilterOptions): GameEvent[] {
  const result: GameEvent[] = [];
  for (let i = 0; i < this.count; i++) {
    const event = this.buffer[(this.head + i) % this.capacity]!;
    if (options?.since !== undefined && event.tick < options.since) continue;
    if (options?.playerId && event.playerId !== options.playerId) continue;
    if (options?.types && !options.types.includes(event.type)) continue;
    result.push(event);
  }
  if (options?.limit) return result.slice(-options.limit);
  return result;
}
```

---

## 12. Schema Migrations: Add Versioning

### What's wrong

`migrate.ts` reads `schema.sql` and executes it as one batch every startup:

```typescript
async function runMigrations(pool: Pool) {
  const schema = readFileSync(join(__dirname, "schema.sql"), "utf-8");
  await pool.query(schema);
}
```

This works because everything uses `CREATE TABLE IF NOT EXISTS`. But:
- You can't add a column to an existing table
- You can't rename a column
- You can't remove a table
- You have no record of what's been applied

### Why it matters

The moment you need to evolve the schema (add a field, change a type, add an index), you're stuck. You'll either nuke the database or hand-write ALTER statements and hope they haven't already been applied.

### What to do

Numbered migration files with a tracking table:

```
server/src/db/migrations/
  001_initial.sql        ← current schema.sql
  002_add_npc_goals.sql  ← future: ALTER TABLE players ADD COLUMN goal TEXT
  003_add_memory_ttl.sql ← future: ALTER TABLE memories ADD COLUMN expires_at TIMESTAMP
```

```typescript
async function runMigrations(pool: Pool) {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS migrations (
      id INTEGER PRIMARY KEY,
      name TEXT NOT NULL,
      applied_at TIMESTAMP DEFAULT NOW()
    )
  `);

  const applied = await pool.query("SELECT id FROM migrations ORDER BY id");
  const appliedIds = new Set(applied.rows.map(r => r.id));

  for (const file of migrationFiles) {
    if (appliedIds.has(file.id)) continue;
    await pool.query(file.sql);
    await pool.query("INSERT INTO migrations (id, name) VALUES ($1, $2)", [file.id, file.name]);
  }
}
```

~30 lines of code. No library needed. Saves hours of pain later.

---

## 13. Resilient Provider: Let It Recover

### What's wrong

Once the primary provider fails, it's marked unavailable forever:

```typescript
class ResilientNpcProvider {
  private primaryAvailable = true;

  async generateReply(req) {
    if (this.primaryAvailable) {
      try { return await this.primary.generateReply(req); }
      catch { this.primaryAvailable = false; }  // PERMANENT
    }
    return this.fallback.generateReply(req);
  }
}
```

### Why it matters

A single transient error (network hiccup, rate limit, timeout) permanently degrades all NPCs to scripted responses for the rest of the session. The user has to restart the server to recover.

### What to do

Add a recovery window -- retry primary after a cooldown:

```typescript
class ResilientNpcProvider {
  private primaryFailedAt: number | null = null;
  private recoverAfterMs = 30_000;  // retry after 30s

  async generateReply(req) {
    const now = Date.now();
    const primaryReady = this.primaryFailedAt === null
      || (now - this.primaryFailedAt) > this.recoverAfterMs;

    if (primaryReady) {
      try {
        const result = await this.primary.generateReply(req);
        this.primaryFailedAt = null;  // recovered
        return result;
      } catch {
        this.primaryFailedAt = now;
      }
    }
    return this.fallback.generateReply(req);
  }
}
```

---

## 14. Client-Server Protocol: Add Versioning and Deltas

### What's wrong

Three issues:

**No protocol version.** If you change a message format, old clients silently break:

```typescript
// Client expects:  { type: "player_update", data: { x, y, name } }
// Server sends:    { type: "player_update", data: { x, y, displayName } }
// Result: silent failure, no error, player name shows as undefined
```

**Full state on connect.** The `state` message includes every player, every conversation, every activity. At 100 players with conversation history, this is tens of KB:

```typescript
// Sent to every new connection
{
  type: "state",
  data: {
    players: Player[],           // ALL players, full objects
    conversations: Conversation[], // ALL conversations with ALL messages
    activities: Activity[]
  }
}
```

**No message compression or batching.** Each event is a separate WebSocket frame with its own JSON serialization.

### What to do

**Add a version field to the handshake:**

```typescript
// Client sends on connect:
{ type: "join", name: "Alice", protocolVersion: 2 }

// Server checks:
if (msg.protocolVersion !== CURRENT_PROTOCOL_VERSION) {
  ws.send({ type: "error", message: "Protocol version mismatch. Please refresh." });
  ws.close();
}
```

**Send only nearby state on connect.** The map, activities, and spawn points don't change -- send those once. Players and conversations can be sent incrementally.

**Batch tick updates** (covered in recommendation 7).

---

## 15. Test Gaps

### What's missing

| Gap | Risk | Effort to fix |
|-----|------|---------------|
| No E2E test against running server | Protocol changes break silently | Medium -- needs Docker test harness |
| No concurrent player stress test | Race conditions under load | Low -- spawn 100 TestGame players |
| No WebSocket reconnection test | Reconnect logic may drop state | Low -- test client with mock disconnect |
| No memory leak test | Long-running server degrades | Medium -- need heap snapshot tooling |
| No conversation cleanup test | Ended conversations accumulate forever | Low -- assert cleanup after N ticks |
| No NPC provider timeout test | Hung Claude process blocks orchestrator | Low -- mock provider with delay |

### Highest value additions

1. **Stress test:** Spawn 100 players moving randomly for 10,000 ticks. Assert tick duration stays under 50ms and memory doesn't grow.

2. **Conversation lifecycle test:** Start 20 conversations, end them all, tick 1000 more times. Assert conversation map doesn't grow.

3. **Provider timeout test:** Mock a provider that hangs for 30s. Assert orchestrator doesn't block the game loop and the NPC eventually gets a scripted fallback.

---

## 16. Dead Code and Unused Abstractions

| Item | Location | Issue |
|------|----------|-------|
| `Activity.capacity` | `types.ts:48` | Field exists but never checked anywhere |
| `PlayerState.doing_activity` | `types.ts:14` | State value never assigned in any code path |
| `Conversation.summary` | `conversation.ts:21` | Field defined, never populated |
| `Player.isWaitingForResponse` | `types.ts:38` | Set by orchestrator, never read by game logic |
| `RNG.shuffle()` | `rng.ts:53` | Defined but never called |
| `ManualInputs` duplication | `gameLoop.ts` | Duplicates `inputX`/`inputY` already on Player |

**Recommendation:** Remove unused fields and code. Each one is a source of confusion for future developers ("is this used somewhere I can't see?") and makes the type system less trustworthy.

---

## 17. Priority Matrix

Ordered by impact-to-effort ratio:

```
IMPACT
  ^
  |
  |  [3] NPC Provider     [2] Delta broadcasts
  |      (direct HTTP)         (send changes only)
  |
  |  [6] Convo index      [1] Extract MovementSystem
  |      (10 min fix)          (from GameLoop)
  |
  |  [11] Ring buffer     [7] Typed events + batching
  |       (20 min fix)
  |
  |  [5] Heap pathfinding [13] Provider recovery
  |      (40 line change)
  |
  |  [12] Migration       [9] SQL-side memory scoring
  |       versioning
  |                        [4] Unified movement
  |  [16] Dead code             pipeline
  |       cleanup
  |                        [8] Player type split
  |
  |                        [14] Protocol versioning
  |
  |                        [10] Spatial hashing
  |                             (defer until needed)
  |
  +----------------------------------------------> EFFORT
       quick fix         moderate           large refactor
```

### Suggested order of execution

**Do now (quick wins, high impact):**
1. Fix ring buffer (#11) -- 20 minutes, removes hot-path O(n)
2. Add conversation index (#6) -- 10 minutes, removes O(n) per tick
3. Replace `ClaudeCodeProvider` with direct HTTP (#3) -- 1 hour, halves NPC latency
4. Clean up dead code (#16) -- 30 minutes, reduces confusion

**Do next (moderate effort, high impact):**
5. Send delta updates instead of full player objects (#2)
6. Type the event system with discriminated unions (#7)
7. Use a heap in A* (#5)
8. Add provider recovery (#13)

**Do when ready for a refactor session:**
9. Extract MovementSystem from GameLoop (#1)
10. Split Player type (#8)
11. Push memory scoring to SQL (#9)
12. Add migration versioning (#12)

**Defer until scale requires it:**
13. Spatial hashing (#10)
14. Area-of-interest filtering (#2 phase 2)
15. Protocol versioning (#14)
16. Unified movement pipeline (#4)
