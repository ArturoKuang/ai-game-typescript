# NPC System

This document covers both NPC-related runtime layers:

- `server/src/autonomy/` for survival-driven behavior and action planning
- `server/src/npc/` for dialogue, memory, and provider orchestration

## Two Separate Responsibilities

### `server/src/autonomy/`

Owns NPC behavior selection in the world:

- decay NPC food, water, and social needs
- maintain player survival snapshots for the local HUD
- pick goals from current pressure plus nearby state
- plan and execute actions
- initiate conversations when social pressure wins
- publish debug state and debug events

### `server/src/npc/`

Owns NPC dialogue behavior once a conversation is active:

- retrieve memories
- generate replies and reflections
- persist conversation and generation metadata
- mark NPCs as waiting while model output is in flight

`NpcOrchestrator` is created with `enableInitiation: false`, so conversation
initiation is now primarily an autonomy responsibility.

## Autonomy Layer

### Needs Model

NPC autonomy currently uses three decaying needs:

- food
- water
- social

Human players also get a lightweight survival snapshot:

- health
- food
- water
- social

### Goal Selection

The autonomy manager asks for a goal only when a need becomes urgent.

Selection can come from:

- a provider-backed goal chooser
- deterministic scripted fallback
- emergency logic such as fleeing nearby hostile bears

If no urgent goal is available, the NPC falls back to idle wandering.

### Action Set

Built-in actions currently include:

- `goto`
- `harvest`
- `cook`
- `drink`
- `eat`
- `eat_cooked`
- `socialize`
- `flee`
- `pickup`

These are planned backward from target predicates and executed tick-by-tick.

### Autonomy Debugging

`NpcAutonomyManager` can publish:

- per-NPC debug state snapshots
- plan provenance and reasoning
- action transition events

These power:

- `/api/debug/autonomy/state`
- `/api/debug/autonomy/:npcId`
- the browser autonomy debug overlay
- the optional WebSocket debug feed

## Dialogue And Memory Layer

### `embedding.ts`

Defines the `Embedder` interface and ships a deterministic placeholder embedder.
That keeps the memory stack reproducible in tests.

### `memory.ts`

`MemoryManager` handles:

- adding memories with embeddings
- conversation summary memories
- vector search with recency and importance re-ranking
- reflection thresholds and reflection memory creation

### Provider Stack

The runtime provider stack is:

1. `ClaudeCodeProvider`
2. `ResilientNpcProvider`
3. `ScriptedNpcProvider`

Important behavior:

- the primary provider shells out to the `claude` CLI
- `CLAUDE_COMMAND` and `NPC_MODEL` can override command behavior
- the resilient wrapper falls back to scripted replies when the primary path is
  unavailable

### `orchestrator.ts`

`NpcOrchestrator` listens to conversation events and:

- decides when an NPC should speak
- retrieves memories
- requests a reply
- enqueues `say` back into the engine
- persists messages and generation metadata
- writes conversation memories on conversation end
- generates reflections when thresholds are met

## Waiting State

When an NPC is waiting on model output, the orchestrator uses
`GameLoop.setPlayerWaitingForResponse()`.

Effects:

- the server emits `player_update`
- the client shows `...` over the NPC
- the player list and renderer can reflect the pending state

## Main Caveats

- The embedder is deterministic and local, not production-grade semantic search.
- The primary provider is a CLI bridge, not a long-lived SDK integration.
- A provider failure can push the process onto scripted fallback behavior.
- Direct conversation mutation through some debug API routes bypasses the normal
  live conversation flow and does not fully exercise orchestration hooks.
