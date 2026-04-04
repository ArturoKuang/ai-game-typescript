# NPC Autonomy System Specification

## Overview

The NPC autonomy system gives NPCs needs that decay over time, the ability to reason about goals, and an extensible action system. It uses GOAP (Goal-Oriented Action Planning) to produce multi-step plans that NPCs execute tick-by-tick.

All autonomy state lives in `server/src/autonomy/` -- NOT on the engine's `Player` type. The autonomy system reads `Player` state and drives behavior by enqueuing commands on the `GameLoop`.

## Architecture

```
                    NpcAutonomyManager
                    (hooks into afterTick)
                           |
          +----------------+----------------+
          |                |                |
     NeedsSystem      GoalSelector      Executor
     (tick decay       (LLM thinker     (tick-based
      + urgency         or scripted)     action runner)
      detection)            |                |
                       GOAP Planner     ActionRegistry
                       (backward A*)         |
                                       Built-in Actions
                                       (goto, harvest,
                                        eat, rest, etc.)
```

## Needs / Drives

Each NPC has five numeric drives (0-100) that decay every tick:

| Need      | Decay/tick | Urgency | Critical | Initial |
|-----------|-----------|---------|----------|---------|
| hunger    | 0.008     | 40      | 15       | 80      |
| energy    | 0.005     | 30      | 10       | 90      |
| social    | 0.010     | 35      | 15       | 70      |
| safety    | 0.000     | 50      | 20       | 100     |
| curiosity | 0.006     | 25      | 10       | 60      |

- **Urgency threshold**: triggers goal selection when crossed
- **Critical threshold**: interrupts current plan when crossed
- Safety has zero decay -- only drops from hostile events

## GOAP Planning

The planner uses backward A* search:

1. Start with the goal predicates (e.g., `need_hunger_satisfied = true`)
2. Find actions whose effects satisfy unmet predicates
3. Add each action's preconditions as new unsatisfied predicates
4. Auto-insert `goto` steps when proximity requirements aren't met
5. Return the lowest-cost plan, or null if no plan found within 200 iterations

### World State Predicates

| Pattern | Example | Meaning |
|---------|---------|---------|
| `has_<item>` | `has_raw_food` | NPC has this item |
| `near_<type>` | `near_berry_bush` | NPC is within 2 tiles of entity type |
| `need_<type>_satisfied` | `need_hunger_satisfied` | Need is above urgency threshold |
| `npc_state` | `"idle"` | Current PlayerState |

## Actions (Phase 1)

| Action | Preconditions | Effects | Cost | Duration |
|--------|--------------|---------|------|----------|
| `goto` | (none) | `near_<target>` | distance * 0.5 | varies |
| `harvest` | `near_berry_bush` | `has_raw_food` | 2 | 40 ticks |
| `eat` | `has_raw_food` | `need_hunger_satisfied` | 1 | 20 ticks |
| `rest` | `near_bench` | `need_energy_satisfied` | 2 | 100 ticks |
| `socialize` | `near_player` | `need_social_satisfied` | 4 | varies |
| `explore` | (none) | `need_curiosity_satisfied` | 3 | 80 ticks |

### Example: Hunger Chain

NPC with `hunger: 30` and no food, planner works backward:

```
Goal: need_hunger_satisfied = true
  -> eat (needs has_raw_food)
    -> harvest (needs near_berry_bush)
      -> goto(berry_bush_position)

Result: goto -> harvest -> eat
```

## Entities

Dynamic world objects managed by `EntityManager`:

| Type | Properties | Emoji |
|------|-----------|-------|
| `berry_bush` | `berries: 5` | (blueberry emoji) |
| `bench` | `{}` | (chair emoji) |

Entities are defined in `data/map.json` and rendered client-side. State changes broadcast via `entity_update` / `entity_removed` WebSocket messages.

## Goal Selection

### Scripted (Deterministic)
Picks the most urgent need and maps it to the corresponding goal.

### LLM-Backed (Personality-Driven)
Sends a ~250 token prompt to Claude with NPC personality, needs, inventory, and nearby entities. The NPC's personality influences choices. Reasoning is stored as an observation memory.

Goal selection is throttled to once per 200 ticks (~10s) per NPC.

## Integration with Existing Systems

### Conversation System
- When `player.state === "conversing"`, the autonomy executor **pauses**
- `NpcOrchestrator` handles all conversation behavior unchanged
- Orchestrator's auto-initiation is **disabled** (`enableInitiation: false`)
- The socialize action enqueues `start_convo` commands instead
- Social need is boosted by 40 when conversations end

### Execution Flow (per tick, per NPC)
1. Skip if conversing
2. Decay needs
3. Check critical crossings -> interrupt plan
4. If no plan: goal selection -> GOAP planner -> produce plan
5. Execute current plan step (validate -> onStart -> onTick -> onEnd)
6. If no plan found: idle wander fallback

### Plan Invalidation
- Action's `validate()` fails
- Action's `onTick()` returns `failed`
- Critical need threshold crossed
- Plan older than 2000 ticks

### Idle Wander
When no plan can be found: pick random walkable tile within 5 tiles, walk there, wait 2-5 seconds, try planning again.

## Debug API

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/api/debug/autonomy/state` | GET | All NPC autonomy states |
| `/api/debug/autonomy/:npcId` | GET | Single NPC autonomy state |
| `/api/debug/autonomy/:npcId/needs` | POST | Override NPC needs |
| `/api/debug/entities` | GET | All world entities |

## File Structure

```
server/src/autonomy/
  types.ts           # Core types
  needs.ts           # Decay logic, urgency detection
  planner.ts         # GOAP backward A* search
  registry.ts        # ActionRegistry
  executor.ts        # Tick-based action runner
  manager.ts         # NpcAutonomyManager coordinator
  entityManager.ts   # WorldEntity storage and queries
  inventory.ts       # NpcInventory helpers
  worldState.ts      # snapshotWorldState()
  goalSelector.ts    # Goal options + scripted selection
  actions/
    index.ts         # Registers all built-in actions
    goto.ts          # A* movement
    harvest.ts       # Harvest berries
    eat.ts           # Eat food
    rest.ts          # Rest at bench
    socialize.ts     # Initiate conversation
    explore.ts       # Satisfy curiosity
```

## Testing

Tests live in `server/test/autonomy/` and cover:
- Needs decay, urgency detection, boost logic
- Inventory add/remove/has
- Entity manager CRUD and spatial queries
- World state snapshot correctness
- GOAP planner: single-action, multi-step chains, cost optimization
- Executor: plan lifecycle, expiry, action completion
- Goal selector: option building, scripted selection
