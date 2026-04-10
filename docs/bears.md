# Bears And Combat

This document covers `server/src/bears/`, which owns bear entities, the
combat commands that apply to both players and bears, item pickup, and the
Game-of-Life automaton that decides when bears are born and culled.

Bears are the first non-player threat in the world. They are also the
driving force behind the combat system, since all `attack`, `pickup`, and
`eat` commands flow through `BearManager`.

## Files

### `bearConfig.ts`

Central tunables for bear stats, player combat, loot, and the automaton.
Everything here is a named constant so tests and docs can reference values
by name instead of by literal.

Key values:

**Bears**

- `BEAR_HP = 20`
- `BEAR_DAMAGE = 5`
- `BEAR_ATTACK_COOLDOWN = 60` ticks
- `BEAR_ATTACK_RANGE = 1`
- `BEAR_AGGRO_RADIUS = 4` (Manhattan)
- `BEAR_WANDER_INTERVAL = 20` ticks

**Players**

- `PLAYER_DEFAULT_HP = 100`
- `PLAYER_ATTACK_DAMAGE = 10`
- `PLAYER_ATTACK_RANGE = 1`
- `PLAYER_ATTACK_COOLDOWN = 5` ticks

**Loot**

- `BEAR_MEAT_HEAL = 25`
- `PLAYER_INVENTORY_CAPACITY = 10`

**Game of Life**

- `GOL_EVAL_INTERVAL = 300` ticks (15s at 20 tps)
- `GOL_NEIGHBORHOOD_RADIUS = 3` (Chebyshev)
- `GOL_BIRTH_MIN = 2`, `GOL_BIRTH_MAX = 3`
- `GOL_SURVIVAL_MIN = 1`, `GOL_SURVIVAL_MAX = 3`
- `GOL_LONELINESS_TICKS = 200`
- `BEAR_POPULATION_CAP = 6`, `BEAR_POPULATION_MIN = 1`
- `BEAR_INITIAL_COUNT = 2`
- `BEAR_SPAWN_PLAYER_BUFFER = 5`
- `WILDERNESS_ACTIVITY_BUFFER = 2`

### `bearManager.ts`

`BearManager` is the orchestrator. It owns:

- wilderness zones (computed once at boot)
- the combat command queue
- per-player attack cooldowns
- per-player inventories
- a pending event buffer that drains into `GameLoop` at the end of each tick

Its per-tick `update(tick)` runs:

1. Drain the combat command queue and route `attack` / `pickup` / `eat`.
2. Advance each live bear's AI state machine.
3. Run automatic NPC retaliation against aggro bears.
4. On the GoL cadence, evaluate births and deaths.
5. Enforce the minimum population floor.
6. Flush queued events to the engine event bus.

## Bear Data

Bears are stored as regular `WorldEntity` rows in `EntityManager`, with
state packed into `properties`:

- `hp`, `maxHp` — health
- `state` — `"idle" | "aggro" | "attacking"` (dead bears are removed, not kept as "dead")
- `targetPlayerId` — target while aggro or attacking; empty string otherwise
- `lastMoveTick`, `lastAttackTick` — cooldown bookkeeping
- `lonelinessTimer` — ticks accumulated without GoL neighbors
- `damage` — attack damage, always 5 at spawn

Because bears live in `EntityManager`, autonomy sees them through the same
`getNearby(..., "bear")` query surface as any other entity. See
[Autonomy](autonomy.md#bears) for the autonomy-side integration.

## State Machine

### Idle

- Wanders to a random walkable neighbor every `BEAR_WANDER_INTERVAL` ticks.
- Scans for any player within `BEAR_AGGRO_RADIUS` (Manhattan).
- When it finds one, transitions to aggro and sets `targetPlayerId`.

### Aggro

- Chases its target greedily one tile per wander interval.
- Transitions to attacking when within `BEAR_ATTACK_RANGE + 1` tiles.
- Deaggros if the target moves more than `2 × BEAR_AGGRO_RADIUS` away, or if
  the target dies.

### Attacking

- Hits on `BEAR_ATTACK_COOLDOWN` (60 ticks ≈ 3s). Each hit deals `BEAR_DAMAGE`.
- Drops back to aggro if the target steps out of range.
- Clears the target if the target dies; the player respawns elsewhere, so
  the bear restarts its idle scan.

## Combat Commands

`BearManager` registers three engine command handlers in its constructor:

```ts
game.onCommand("attack", forwardToQueue);
game.onCommand("pickup", forwardToQueue);
game.onCommand("eat",    forwardToQueue);
```

This keeps all combat and inventory logic out of `server/src/engine/`. The
engine just enqueues commands; the manager interprets them on the next
`update`. WebSocket intents like `{ type: "attack", data: { targetId } }`
reach the manager through this path.

### Attack resolution

- **Player attacks bear**: range + cooldown check → deduct `PLAYER_ATTACK_DAMAGE`.
  If the bear dies, drop `bear_meat` at its position and emit `bear_death`.
- **Player attacks player**: same range + cooldown → deduct damage. If the
  target dies, end any active conversation and respawn them.
- **NPC auto-retaliation**: any non-conversing NPC within range of an
  aggro/attacking bear automatically attacks it each tick. This is what keeps
  founders from being wiped out while autonomy is planning.

### Events emitted

All of these flow through the engine event bus and are broadcast by the
WebSocket layer as a single consolidated `combat_event` message:

- `bear_spawn`, `bear_death`
- `bear_attack` (bear-side perspective), `player_attack` (attacker-side)
- `player_damage`, `player_heal`, `player_death`
- `item_drop`, `item_pickup`, `item_consumed`

The WebSocket server keeps an optional reference to `BearManager` so it can
also push an inventory update alongside item events.

## Game-Of-Life Automaton

Bear population is regulated by a cellular automaton that runs every
`GOL_EVAL_INTERVAL` ticks (15s at 20 tps).

**Wilderness zones.** On construction, `BearManager` precomputes the set of
walkable tiles that are both outside activity buffers and outside player
spawn points. Births can only land here, which prevents bears from appearing
on top of the founders at boot.

**Neighborhood.** A Chebyshev (Moore) neighborhood of radius
`GOL_NEIGHBORHOOD_RADIUS = 3`. Bears count their neighbors, excluding
themselves.

**Rules.**

- **Overcrowding** — a bear with more than `GOL_SURVIVAL_MAX` (3) neighbors
  despawns with reason `"overcrowding"`.
- **Loneliness** — a bear with fewer than `GOL_SURVIVAL_MIN` (1) neighbors
  accumulates `GOL_EVAL_INTERVAL` ticks into its `lonelinessTimer`. Once it
  crosses `GOL_LONELINESS_TICKS`, the bear despawns with reason
  `"loneliness"`.
- **Birth** — an empty wilderness tile with between `GOL_BIRTH_MIN` and
  `GOL_BIRTH_MAX` neighbors, and no player or spawn point within
  `BEAR_SPAWN_PLAYER_BUFFER`, spawns a new bear.
- **Population cap** — hard cap of `BEAR_POPULATION_CAP = 6`. Births stop at
  the cap; the cap also halts further despawns to avoid a death spiral.
- **Minimum population** — if the live count falls below
  `BEAR_POPULATION_MIN = 1`, one new bear is seeded each tick until the
  floor is met.

The result is a breathing population that drifts between roughly one and
six bears without any hand-authored spawn timers.

## Debug Routes

- `GET /api/debug/bears` — returns every live bear with id, position, and
  properties.
- `POST /api/debug/spawn-bear` with `{ x, y }` — force-spawns a bear at
  exact coordinates via `debugSpawnBear`. Bypasses the wilderness zone check
  so you can place a bear directly next to a player for reproductions.
- `POST /api/debug/kill-bear` with `{ bearId }` — calls `debugKillBear`,
  which behaves as if the bear was killed by a player: drops meat and emits
  a `bear_death` event.
- `GET /api/debug/inventory/:playerId` — player inventory, useful when
  chasing pickup or consumption bugs.

See [Debug API](debug-api.md) for full request/response shapes.

## Wiring

`bootstrap/runtime.ts` builds bears after autonomy so the `EntityManager` is
already populated:

1. `GameLoop`, `EntityManager`, `NpcAutonomyManager`
2. `createBearRuntime(game, entityManager)` — constructs `BearManager` and
   calls `seedInitialBears()` to place `BEAR_INITIAL_COUNT` bears.
3. WebSocket server is given a reference via `setBearManager()` so inventory
   and combat command paths resolve.

At boot you will see:

```
Bear manager initialized with GoL spawning
```

If you do not see that line, bears are not wired into the current runtime
and every `attack` / `pickup` / `eat` command will silently no-op.

## Tests

`server/test/bears.test.ts` has 27 tests grouped by concern:

- **Spawning** — initial seed count, exact-position debug spawn, meat drop on
  debug kill.
- **Bear AI** — wander, aggro on nearby players, no aggro at distance, chase
  while aggro.
- **Combat** — two-hit kill math (10 × 2 = 20 HP), bear hits player on
  cooldown, NPCs retaliate on aggro bears, attack range and cooldown
  enforcement, player-vs-player fatal path ending active conversations.
- **Loot and food** — meat pickup removes the ground entity, eating meat
  restores `BEAR_MEAT_HEAL`, healing caps at `maxHp`, pickup out of range
  fails.
- **Game of Life** — births with 2–3 neighbors, overcrowding despawns,
  loneliness timer despawns, population cap enforcement, minimum population
  auto-seed.
- **Player HP** — new players spawn with `PLAYER_DEFAULT_HP`.

All bear tests are pure in-memory — no WebSocket, no database, no sockets —
so they run unconditionally regardless of whether the sandbox allows
loopback binding.
