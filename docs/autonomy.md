# NPC Autonomy

This document covers the NPC autonomy stack in `server/src/autonomy/`. It owns
NPC needs, goal selection, GOAP planning, action execution, and the entity
queries those actions depend on. Dialogue itself is still handled by
`NpcOrchestrator` in `server/src/npc/`; autonomy decides *when* and *why* to
talk, the orchestrator generates the words.

## Ownership

The autonomy stack owns:

- per-NPC needs (food, water, social) and their decay
- goal selection from the current need state
- GOAP planning and per-tick plan execution
- the `EntityManager` for world entities that actions interact with
- debug state snapshots published to `/api/debug/autonomy/*`

It deliberately does not own:

- dialogue generation, provider selection, or memory scoring
- bear AI, wilderness spawning, or combat math
- websocket transport
- player movement primitives (those live in the engine)

## Key Files

### `types.ts`

Core contracts for the GOAP system: `NpcNeeds`, `NeedType`, `NeedConfig`,
`WorldState`, `ActionDefinition`, `Plan`, `NpcAutonomyState`, `ActionExecution`,
`ExecutionContext`, and `PlanningContext`. Nothing in this file mutates state.

### `needs.ts`

Pure functions over `NpcNeeds` maps:

- `createDefaultNeeds()` — initial values
- `tickNeeds()` — decay one tick and detect threshold crossings
- `boostNeed()` — clamp-aware additive boost
- `getUrgentNeeds()`, `getMostUrgentNeed()`, `hasCriticalNeed()` — priority queries

Defaults at tick 0 (from `needs.ts`):

| Need   | Start | Decay / tick | Urgent | Critical |
| ------ | ----- | ------------ | ------ | -------- |
| food   | 80    | 0.008        | 40     | 15       |
| water  | 85    | 0.012        | 45     | 20       |
| social | 70    | 0.010        | 35     | 15       |

### `goalSelector.ts`

Maps needs to goals. `NEED_TO_GOAL` translates `food → satisfy_food`,
`water → satisfy_water`, `social → satisfy_social`. `buildGoalOptions()`
collects the candidates an LLM can pick from; `selectGoalScripted()` picks the
most urgent need deterministically so planning can start immediately even when
a model request is in flight.

### `worldState.ts`

`snapshotWorldState()` builds the GOAP predicate map the planner searches
against. Predicates include:

- `need_${key}_satisfied` — per need type
- `has_${item}` — per inventory item with count > 0
- `near_${type}` — per entity type within proximity radius
- `near_player` — any other player within Manhattan distance 2
- `near_hostile`, `hostile_distance` — nearest aggressive bear inside threat radius
- `near_pickupable` — bear meat or ground items within range
- `npc_state` — the player's current engine state string

This runs once per plan attempt, not per tick.

### `inventory.ts`

Tiny `Map<string, number>` wrapper with `createInventory`, `addItem`,
`removeItem`, `hasItem`, `getItemCount`. Inventory is per-NPC and lives in
`NpcAutonomyState`.

### `entityManager.ts`

`EntityManager` owns all non-player world entities: berry bushes, water
sources, campfires, ground items, bear meat, and bears. It loads from map data
at boot via `loadFromMapData()` and exposes:

- `spawn(entity)` / `destroy(id)`
- `get(id)` — single lookup
- `getByType(type)` — all entities of a type
- `getNearby(position, radius, type?)` — Manhattan-distance query, filters out destroyed entities

Actions and `snapshotWorldState` both query through this surface.

### `registry.ts`

`ActionRegistry` stores action definitions and answers
`getActionsForEffects(effects)` so the planner can walk backward from a goal.

### `planner.ts`

`plan(goal, worldState, registry, context)` is a bounded backward-A\* GOAP
planner. It starts from the unsatisfied goal predicates, searches for actions
whose effects match, recursively unrolls their preconditions, and auto-inserts
a `__goto` step whenever an action needs proximity to an entity. Step costs
accumulate action cost plus `goto_cost = distance * 0.5`. Search is bounded to
200 iterations to avoid runaway planning.

### `executor.ts`

`executeAutonomyTick()` drives the current plan one step per tick. It handles
the action lifecycle — `validate → onStart → onTick → onEnd` — and returns a
result the manager uses to decide whether to invalidate the plan, move to the
next step, or keep ticking. Plans expire after 2000 ticks as a safety rail.

### `manager.ts`

`NpcAutonomyManager` is the top-level coordinator. It owns per-NPC state,
registers an `onAfterTick` callback with `GameLoop`, and runs every tick. The
per-tick flow for each NPC is:

1. Decay needs.
2. Check for a critical need crossing — if so, invalidate the current plan.
3. Handle emergency flee if an aggressive bear is nearby.
4. Honor the idle cooldown.
5. If there is no active plan, try to plan.
6. If there is a plan, execute the current step.
7. Flush outputs: broadcast needs, publish the debug state snapshot.

The manager also listens for conversation end events and boosts both
participants' social need when a conversation closes.

## Actions

All actions are registered by `registerBuiltinActions()` in
`autonomy/actions/index.ts`.

| Action       | Cost | Duration | Preconditions              | Effects                | Notes                                       |
| ------------ | ---- | -------- | -------------------------- | ---------------------- | ------------------------------------------- |
| `__goto`     | 1    | 40       | —                          | dynamic                | auto-inserted when proximity is required    |
| `harvest`    | 2    | 40       | `near_berry_bush`          | `has_raw_food`         | consumes one berry from the bush            |
| `cook`       | 2    | 60       | `has_raw_food, near_campfire` | `has_cooked_food`    | requires a lit campfire                     |
| `eat`        | 2    | 20       | `has_raw_food`             | `need_food_satisfied`  | restores 40 food                            |
| `eat_cooked` | 1    | 20       | `has_cooked_food`          | `need_food_satisfied`  | restores 70 food; cheaper so planner prefers it |
| `drink`      | 1    | 25       | `near_water_source`        | `need_water_satisfied` | restores 75 water                           |
| `pickup`     | 1    | 10       | `near_pickupable`          | `has_raw_food`         | forwards a `pickup` command to the engine   |
| `socialize`  | 4    | 200      | `near_player`              | `need_social_satisfied`| enqueues `start_convo`; see below           |
| `flee`       | 1    | 60       | `near_hostile`             | `escaped_hostile`      | runs ~6 tiles away from the nearest bear    |

Cost differences are the main lever steering the planner toward preferred
paths — for example `eat_cooked` costs less than `eat`, so if the NPC has
cooked food the planner picks it over raw food.

## Conversations

`NpcOrchestrator` is constructed with `enableInitiation: false` in
`bootstrap/runtime.ts`, so it will not autonomously scan for idle players.
Initiation is solely autonomy's job through the `socialize` action:

1. Planner picks `satisfy_social` when the social need crosses urgency.
2. `socialize` validates there is a non-conversing player nearby.
3. `onStart` enqueues a `start_convo` command.
4. `onTick` polls `player.state === "conversing"` and completes the action once
   the conversation has begun.
5. `SOCIALIZE_TIMEOUT` (200 ticks) gives up if the partner never accepts.

When an NPC receives an inbound invite, `manager.ts` decides to accept,
decline, or defer based on the NPC's current goal and social pressure. It
deliberately does not drop a critical food or water task to socialize unless
the social need is at least as urgent.

After any conversation closes, both participants get a social boost in the
`convo_ended` listener.

## Bears

Bears are regular `WorldEntity` rows in the `EntityManager`, so autonomy
queries them through the same `getNearby(..., "bear")` surface as any other
entity type. `worldState.ts` sets `near_hostile` when an active (non-dead)
bear is within the threat radius, and `manager.ts` triggers emergency flee
before normal planning runs for that tick. The flee action picks an escape
position a few tiles away from the nearest bear via direct pathing rather
than GOAP.

The bear system itself (state machine, combat math, spawning) lives in
`server/src/bears/`; see the [Bears](bears.md) page for details.

## Debug Surface

- `GET /api/debug/autonomy/state` — all NPC autonomy debug states, including
  persisted dead NPCs. Each entry includes current needs, inventory, plan,
  active execution, consecutive plan failures, and the `goalSelectionInFlight`
  flag.
- `GET /api/debug/autonomy/:npcId` — single-NPC version; 404 if unknown.
- `POST /api/debug/autonomy/:npcId/needs` — overwrite any subset of
  `{ health, food, water, social }` directly. Intended for reproducing edge
  cases like "bear meat is about to spoil" or "critical water need should
  override active plan".
- `GET /api/debug/entities` — the full `EntityManager` state via
  `serializeDebugWorldEntity`. Useful for seeing which entities autonomy is
  planning against.

## Wiring

`bootstrap/runtime.ts` builds the stack in this order:

1. `GameLoop`
2. `EntityManager` (loaded from `data/map.json`)
3. `NpcAutonomyManager(game, entityManager, { provider, memoryManager, npcStore, persistedDeadNpcs })`
4. `BearManager(game, entityManager)`
5. `NpcOrchestrator(..., { enableInitiation: false })`

All three of `NpcAutonomyManager`, `BearManager`, and `NpcOrchestrator` run via
`game.onAfterTick(...)` callbacks. Registration order matters: the manager
that registers first sees the tick result first. The canonical order is
autonomy → bears → orchestrator, which means autonomy decides goals, bears
update threats, and the orchestrator reacts to whatever conversations landed
this tick.

## Tests

Pure in-memory tests live in `server/test/autonomy/`:

- `needs.test.ts` — decay, clamp, urgency and critical detection
- `goalSelector.test.ts` — goal mapping and scripted selection
- `planner.test.ts` — goal already satisfied, goto auto-insertion, harvest → eat chain, drink at distance, cook preference over raw eat
- `executor.test.ts` — full action lifecycle (validate, onStart, onTick, onEnd) and failure paths
- `entityManager.test.ts` — spawn, destroy, nearby queries
- `inventory.test.ts`, `cook.test.ts`, `worldState.test.ts`, `phase3.test.ts` — focused module coverage
- `manager.test.ts` — integration: spawn → need decay → plan → execute → conversation

Scenario-level coverage that exercises autonomy alongside the rest of the
runtime lives in `server/test/scenarios/`. See [Testing](testing.md) for the
shared harness reference.
