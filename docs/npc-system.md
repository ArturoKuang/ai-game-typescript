# NPC System

This document covers the NPC intelligence stack in `server/src/npc/` and the persistence hooks it relies on.

## Purpose

The NPC subsystem is responsible for:

- retrieving relevant memories for NPC dialogue
- generating replies and reflections through a provider abstraction
- persisting conversations, messages, and generation metadata
- initiating nearby conversations
- marking NPCs as waiting while model output is in flight

## Components

### `embedding.ts`

Defines the `Embedder` interface and ships `PlaceholderEmbedder`.

Current behavior:

- deterministic hash-based pseudo-embeddings
- default dimension `1536`
- unit-normalized vectors
- no external API dependency

This makes the memory stack testable and reproducible without a hosted embedding service.

### `memory.ts`

`MemoryManager` is the semantic memory orchestrator.

Responsibilities:

- add memories with embeddings
- summarize finished conversations into `conversation` memories
- retrieve candidate memories with re-ranking
- update access timestamps
- decide when an NPC should produce a reflection
- add reflection memories

Current scoring formula in practice:

- recency contribution: `0.99 ** ticksAgo`
- importance contribution: `importance / 10`
- relevance contribution: cosine similarity clipped at `>= 0`

Reflection thresholds:

- at least `3` recent memories
- cumulative importance of recent memories must reach `50`

Access updates are throttled to once per memory every `30` ticks.

### `provider.ts`

Defines:

- `NpcModelProvider`
- request/response types for replies and reflections
- prompt builders for reply and reflection tasks

Prompt composition currently includes:

- NPC name, description, and personality
- partner name
- recent transcript
- top memories
- explicit constraints on response style and length

### `scriptedProvider.ts`

Fallback provider with deterministic text templates.

Behavior:

- produces a greeting when a conversation has no prior messages
- otherwise replies based on simple personality keyword matching
- returns immediately with `latencyMs = 0`

This is the reliability backstop for the NPC system.

### `claudeCodeProvider.ts`

Primary provider that shells out to the `claude` CLI.

Current execution shape:

- command defaults to `claude`
- passes `--permission-mode dontAsk`
- disables tool usage with `--tools ""`
- requests JSON output
- supports session resume via `--resume`
- supports model override via `NPC_MODEL`

The provider returns:

- normalized reply text
- prompt text
- session id
- raw CLI output
- measured or reported latency

### `resilientProvider.ts`

Wraps a primary and fallback provider.

Current failure policy:

- try primary first
- on first primary error, mark the primary unavailable for the rest of the process
- permanently fall back to the backup provider until restart

That means one Claude CLI failure currently downgrades the process to scripted replies for the remainder of the server lifetime.

### `orchestrator.ts`

`NpcOrchestrator` is the bridge between gameplay events and NPC behavior.

It listens to:

- `convo_started`
- `convo_accepted`
- `convo_active`
- `convo_ended`
- `convo_message`
- after-tick callbacks for autonomous conversation initiation

Responsibilities:

- persist players, conversations, messages, and generation metadata
- decide which NPC speaks next in an active conversation
- retrieve memories and generate NPC replies
- enqueue `say` commands back into the engine
- create conversation memories when a conversation ends
- generate reflection memories for NPCs
- autonomously initiate nearby conversations

## Runtime Model

### Reply Scheduling

When a conversation becomes active or gains a new message:

1. Resolve which participant should speak next.
2. If the next speaker is an NPC, load or create a per-conversation runtime record.
3. Prevent duplicate in-flight requests and duplicate generation for the same message count.
4. Mark `player.isWaitingForResponse = true`.
5. Generate a reply.
6. Persist the generation metadata.
7. Enqueue a `say` command.
8. Clear the waiting flag.

### Reflection Scheduling

When a conversation ends:

1. Create summary memories for both participants.
2. If a participant is an NPC and reflections are enabled, gather recent memories since the last reflection.
3. If recent memory count and importance threshold are high enough, generate a reflection.
4. Persist the generation metadata and add the reflection as a memory.

### Autonomous Initiation

After every tick, when initiation is enabled:

- only run on ticks divisible by the scan interval
- only consider idle NPCs not already reserved or in conversation
- enforce initiation cooldown per NPC
- choose the closest eligible target within radius
- prefer humans over NPCs when distance ties
- enqueue `start_convo`

Default settings:

- scan every `20` ticks
- cooldown `120` ticks
- radius `6`

## Persistence Hooks

The NPC subsystem depends on two abstractions:

- `MemoryStore` from `db/repository.ts` for memories
- `NpcPersistenceStore` from `db/npcStore.ts` for players, conversations, messages, and generation metadata

At runtime these are backed by either:

- PostgreSQL implementations
- in-memory implementations for tests and DB-less startup

## Waiting State

The orchestrator uses `GameLoop.setPlayerWaitingForResponse()` to expose model latency to the rest of the system.

Effects:

- server emits a `player_update`
- browser UI shows `...`
- renderer shows a floating waiting indicator above the NPC

## Known Limitations

- The embedder is still a placeholder; semantic quality is good enough for deterministic testing, not for production NPC reasoning.
- The primary provider is a local CLI bridge, not an in-process SDK.
- The fallback policy is coarse and process-wide.
- Debug API direct conversation routes bypass orchestrator event listeners, so they do not fully exercise this subsystem.
