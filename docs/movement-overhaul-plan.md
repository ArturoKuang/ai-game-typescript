# Movement System Overhaul: Continuous Velocity-Based Movement

## Context

The current WASD movement teleports players one tile per keypress (120ms repeat interval). This feels jerky and won't support the planned chemistry system where tile properties (ice friction, oil slipperiness) need to affect movement continuously. We're migrating to velocity-based movement with client-side prediction and server reconciliation.

**Decisions**: Client-predicted with server reconciliation, instant velocity (no acceleration), key state messages (`input_start`/`input_stop`).

See also: `docs/chemistry-system-design.md` for the broader chemistry system this enables.

---

## Plan

### Phase 1: Server Types + Collision Module

**1.1 — Update `server/src/engine/types.ts`**

Add fields to `Player`:
```typescript
vx: number;       // current velocity X (tiles/sec), default 0
vy: number;       // current velocity Y (tiles/sec), default 0
inputX: number;   // input direction X (-1, 0, 1), default 0
inputY: number;   // input direction Y (-1, 0, 1), default 0
radius: number;   // collision radius, default 0.4
moveSpeed: number; // tiles/sec for input-driven movement, default 5.0
```

Keep existing `speed` field unchanged (tiles/tick, used only by A* path-following). This avoids breaking any existing NPC movement or tests.

**1.2 — Create `server/src/engine/collision.ts`** (new file)

Exports:
- `PLAYER_RADIUS = 0.4`
- `moveWithCollision(x, y, dx, dy, radius, world): { x, y }` — move with wall sliding. Resolves X axis first, then Y axis independently. For each axis, checks circle-vs-AABB overlap against all non-walkable tiles in the 3x3 neighborhood and pushes the circle out along the penetration normal.

Algorithm: For each nearby non-walkable tile, find the closest point on the tile AABB to the circle center. If distance < radius, compute overlap and push out along the center-to-closest vector.

**1.3 — Create `server/test/collision.test.ts`** (new file)

Tests: circle inside floor (no correction), circle overlapping wall (pushed out), corner case (two walls), wall sliding (diagonal into wall slides on free axis), narrow corridor traversal.

### Phase 2: Server GameLoop Changes

**2.1 — Update `server/src/engine/gameLoop.ts`**

A. **`spawnPlayer()`** — initialize new fields: `vx: 0, vy: 0, inputX: 0, inputY: 0, radius: 0.4, moveSpeed: 5.0`

B. **New method `setPlayerInput(playerId, direction, active)`** — sets `inputX`/`inputY` based on direction. If `active`, cancels any existing A* path. If player is conversing, no-op.

C. **New private method `processInputMovement(player, dt)`** — resolves input to velocity (instant, normalized for diagonal), calls `moveWithCollision`, updates position/orientation/state. Returns events.

D. **Update `tick()`** — compute `dt = 1 / this.tickRate_`. Before the existing path-following loop, add a loop that processes input-driven movement for all non-conversing players with nonzero input. Zero velocity for players whose input just stopped.

E. **Keep `movePlayerDirection()`** as-is for backward compat (debug, old clients).

**2.2 — Create `server/test/input-movement.test.ts`** (new file)

Tests: input sets velocity and moves player, orientation updates, stopping zeroes velocity, input cancels pathfinding, collision prevents wall entry, diagonal speed equals cardinal speed, conversing players ignore input.

Use `TestGame` with `tickRate: 20` for these tests so dt=0.05 gives clean math.

**2.3 — Run existing tests** to confirm path-following is unbroken.

### Phase 3: Protocol + Server Networking

**3.1 — Update `server/src/network/protocol.ts`**

Add to `ClientMessage` union:
```typescript
| { type: "input_start"; data: { direction: MoveDirection } }
| { type: "input_stop"; data: { direction: MoveDirection } }
```

**3.2 — Update `server/src/network/websocket.ts`**

Add `input_start` and `input_stop` handlers that call `game.setPlayerInput()`. No immediate broadcast — the tick loop handles it.

**3.3 — Update `server/src/index.ts`**

Change afterTick broadcast condition from `player.state === "walking"` to:
```typescript
if (player.state === "walking" || player.vx !== 0 || player.vy !== 0)
```

Strip `inputX`/`inputY` from broadcast (these are server-internal). Add a small helper to omit those fields.

### Phase 4: Client Changes

**4.1 — Update `client/src/types.ts`**

Add `vx`, `vy`, `moveSpeed`, `radius` to Player. Add `input_start`/`input_stop` to ClientMessage.

**4.2 — Overhaul `client/src/main.ts`**

Replace the entire WASD section (heldKeys, setInterval at 120ms, tryMove, startMoveLoop, stopMoveLoop):

- Track `heldDirections: Set<MoveDirection>`
- On keydown: add to set, send `input_start`, recalculate local input vector
- On keyup: remove from set, send `input_stop`, recalculate
- On blur: send `input_stop` for all held, clear set

Replace the render loop with a timestamped version:
- Each frame: compute `dt`, apply client-side prediction (same physics as server — normalize input, multiply by MOVE_SPEED * dt, apply client-side collision using loaded map tiles)
- On `player_update` for self: blend toward server position (lerp 0.15 if diff < 2 tiles, snap if > 2 tiles)
- Store map tiles in module scope (already loaded in `start()`)

**4.3 — Add client-side collision**

Port the collision logic from `collision.ts` to the client, or add a simplified version that checks `isWalkable` for the 3x3 neighborhood around the player. Without this, the client prediction diverges at walls and causes rubber-banding.

**4.4 — Update `client/src/renderer.ts`**

Self-player rendering stays as-is (it already uses `player.x * TILE_SIZE`). The difference is that `player.x` is now updated smoothly every frame by the prediction loop in main.ts rather than jumping by 1 tile on keypress.

### Phase 5: Debug API + Polish

**5.1 — Update `server/src/debug/router.ts`**

Add `POST /input` endpoint: `{ playerId, direction, active }` calls `game.setPlayerInput()`. Useful for testing continuous movement via curl.

**5.2 — Update `server/src/debug/asciiMap.ts`**

Update legend to show velocity for moving players (currently only shows path target). Already handles float positions via `Math.round()`.

---

## Files Changed

| File | Action |
|------|--------|
| `server/src/engine/types.ts` | Modify — add vx, vy, inputX, inputY, radius, moveSpeed to Player |
| `server/src/engine/collision.ts` | **Create** — circle-vs-AABB collision with wall sliding |
| `server/src/engine/gameLoop.ts` | Modify — setPlayerInput(), processInputMovement(), update tick() and spawnPlayer() |
| `server/src/network/protocol.ts` | Modify — add input_start/input_stop to ClientMessage |
| `server/src/network/websocket.ts` | Modify — add input_start/input_stop handlers |
| `server/src/index.ts` | Modify — update afterTick broadcast condition, strip internal fields |
| `server/src/debug/router.ts` | Modify — add POST /input endpoint |
| `server/src/debug/asciiMap.ts` | Modify — update legend for velocity info |
| `client/src/types.ts` | Modify — mirror server Player changes, add new message types |
| `client/src/main.ts` | Modify — replace WASD system, add prediction loop, add reconciliation |
| `client/src/renderer.ts` | Modify — minor (self rendering uses predicted position) |
| `server/test/collision.test.ts` | **Create** — collision detection tests |
| `server/test/input-movement.test.ts` | **Create** — input-driven movement tests |

## Key Design Details

- **Speed fields**: `moveSpeed` (tiles/sec, new, for input-driven) vs `speed` (tiles/tick, existing, for path-following). Keeps path-following untouched.
- **Diagonal normalization**: Input vector normalized so diagonal speed = cardinal speed.
- **Wall sliding**: X and Y axes resolved independently — diagonal into a wall slides along it.
- **Reconciliation threshold**: < 2 tiles diff -> lerp at 0.15/frame. > 2 tiles -> snap. Prevents rubber-banding while correcting drift.
- **State reuse**: `"walking"` state used for both input-driven and path-following movement. Guard in tick loop: path-following only runs when `player.path` exists.
- **Collision algorithm**: Circle-vs-AABB. For each non-walkable tile in 3x3 neighborhood, clamp circle center to tile bounds to find closest point, compute distance. If distance < radius, push circle out along the penetration normal.

## Current Architecture Reference

Key files and their roles (for agents picking this up):

- `server/src/engine/types.ts` — All shared types (Player, Position, TileType, etc.)
- `server/src/engine/gameLoop.ts` — Central game coordinator. Owns players, world, tick loop. Two existing movement systems: `movePlayerDirection()` (WASD tile-snap) and `setPlayerTarget()` + `processMovement()` (A* path-following).
- `server/src/engine/world.ts` — Tile grid. `isWalkable(x, y)` checks tile type. `getNeighbors()` returns 4-directional walkable tiles.
- `server/src/engine/pathfinding.ts` — A* on tile grid.
- `server/src/network/protocol.ts` — Client/server message discriminated unions.
- `server/src/network/websocket.ts` — WebSocket message handlers, broadcasts.
- `server/src/index.ts` — Entry point. Creates GameLoop at tickRate=20, starts realtime mode. `onAfterTick` broadcasts walking players.
- `client/src/main.ts` — Client entry. WASD input, client-side prediction (currently tile-snap), render loop.
- `client/src/renderer.ts` — PixiJS rendering. TILE_SIZE=32. Self snaps, others lerp at 0.3.
- `client/src/types.ts` — Client-side type mirrors (Player without path/pathIndex).
- `server/test/helpers/testGame.ts` — Test fixture. `spawn()`, `tick()`, `move()`, `getPlayer()`. Uses MINI_MAP (5x5).

## Verification

1. `docker compose exec game-server npx vitest run` — all existing + new tests pass
2. Start server + client, join, WASD movement is smooth and continuous
3. Walk into walls — player slides along them, no getting stuck
4. Diagonal movement speed matches cardinal speed
5. Click-to-move still works (A* pathfinding for NPCs/debug)
6. Open two browser tabs — movement of other player appears smooth (lerp interpolation)
7. `curl -X POST localhost:3001/api/debug/input -H 'Content-Type: application/json' -d '{"playerId":"npc_1","direction":"right","active":true}'` then tick — NPC moves right
8. `GET /api/debug/map` — shows players at float positions rounded to nearest tile
