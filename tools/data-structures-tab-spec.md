# Data Structures Tab Spec

## Status

- Scope: `tools/extractor` + `tools/visualizer`
- Surface: new top-level `Data Model` tab
- Current baseline:
  - the visualizer has `Components`, `Files`, `Classes`, and `Data Flow`
  - the extractor can already read classes, interfaces, imports, message flows, state machines, and component-level summaries
  - the current `Classes` view is code-centric and does not explain shape, lifecycle, transport role, persistence role, or why a structure exists

## Problem

The current visualizer can answer:

- which components exist
- which files import each other
- which classes and interfaces exist
- how a few key message flows move through the runtime

It cannot answer the data questions that usually come next:

1. What is the actual shape of `Player`, `Conversation`, `Memory`, `ClientMessage`, or `FullGameState`?
2. Which structures are authoritative runtime state versus transport payloads versus persistence rows versus file-backed assets?
3. Where is a structure created, read, looked up, iterated, mutated, serialized, persisted, mirrored, or indexed?
4. Why does a structure exist in its current form?
5. Where are the duplication and drift risks, such as server/client mirrored types?

This gap is especially visible in this repo because many important concepts are not classes:

- `Player`, `Activity`, `MapData`, `Command`, and `GameEvent` are TypeScript interfaces or unions
- `ClientMessage` and `ServerMessage` are discriminated unions
- `MemoryRow` and SQL tables represent persistence shapes
- `data/map.json` is a repo-owned runtime data source
- critical runtime state lives inside collections such as `Map<number, Conversation>`, `Map<string, number>`, arrays, and ring buffers

The result is that the current UI explains code units better than it explains the system's data model.

## Goal

Make the new `Data Model` tab the fastest way to answer:

1. What are the important data structures in AI Town?
2. What does each one look like?
3. What category does it belong to?
4. Where does it move through the system?
5. Which code reads it, writes it, looks it up, iterates it, serializes it, stores it, or mirrors it?
6. What are its real access patterns?
7. Why is it shaped this way?

The accuracy goal matters as much as the UX goal:

- the extractor should become the source of truth for structure definitions and relationships
- the visualizer should render precomputed structure facts, not invent them
- claims such as "mirrored on client", "stored in a map for O(1) lookup", or "persisted to `memories`" should be backed by extractor evidence
- access-pattern claims such as "iterated every tick", "looked up by key", or "appended as a ring buffer" should also be extractor-backed, not guessed in the UI

## Non-Goals

- Replacing the existing `Classes` tab
- Building a general-purpose TypeScript AST browser
- Rendering every local helper object literal or test-only shape by default
- Explaining runtime values; this tab is about structure definitions and ownership, not inspecting live instances
- Modeling every SQL query in detail
- Solving full schema evolution or OpenAPI generation

## Naming

Recommended user-facing tab label: `Data Model`

Rationale:

- `Data Structures` is accurate but longer and more implementation-flavored
- `Data Model` reads better next to `Components`, `Files`, `Classes`, and `Data Flow`
- the inspector and docs can still use the phrase "data structures" explicitly

## Placement

Recommended top-level tab order:

- `Containers`
- `Components`
- `Data Model`
- `Files`
- `Classes`
- `Data Flow`

Rationale:

- this view sits above file/class inspection but below container/component orientation
- users usually need the conceptual data shapes before they need the exact class/file graph
- it separates "what data exists" from "how behavior executes"

If the `Containers` tab is not shipped yet, the near-term order can be:

- `Components`
- `Data Model`
- `Files`
- `Classes`
- `Data Flow`

## What Counts As A Data Structure

The tab needs a repo-specific definition, otherwise "all data structures" becomes noisy.

### Include By Default

These should be first-class nodes in the new tab:

1. Exported TypeScript interfaces
2. Exported TypeScript type aliases
3. Discriminated unions and enum-like unions
4. SQL tables and row shapes
5. JSON/file-backed runtime asset shapes
6. Important in-memory storage containers and indexes when they materially explain behavior

### Exclude By Default

These should stay out of the main canvas unless a future advanced mode is enabled:

- local one-off helper interfaces inside tests or harnesses
- anonymous inline object literals with no reusable semantic role
- purely presentational DOM helper shapes unless they cross a meaningful boundary
- tiny internal convenience types that are not shared and do not own meaningful state

## Structure Categories

Each structure should belong to exactly one primary category:

- `domain`
  - core gameplay models such as `Player`, `Conversation`, `Message`, `Activity`, `MapData`
- `transport`
  - WebSocket and debug payloads such as `ClientMessage`, `ServerMessage`, `FullGameState`
- `persistence`
  - SQL tables, row shapes, and persisted records such as `MemoryRow`, `GenerationRecord`, `memories`
- `asset`
  - repo-owned JSON or file-backed content such as `data/map.json`, `CharacterDef`
- `runtime_store`
  - important containers and indexes such as `ConversationManager.conversations`, `playerToConvo`, `clientDebugEvents`
- `ui_view`
  - UI-facing view-state structures such as `ConversationPanelView` when worth showing

## Why This Repo Needs A Separate Tab

The current `Classes` tab is not enough because it:

- does not include type aliases
- does not explain discriminated unions as variants
- does not distinguish runtime models from payload contracts
- does not show persistence mappings
- does not show file-backed assets
- does not show mirrored structures across server and client
- does not explain storage/index choices such as `Map<number, Conversation>` and `Map<string, number>`

The `Data Flow` tab is also not enough because it:

- starts from messages and behavior, not from structure definitions
- focuses on execution order, not stable data shape
- does not answer "what fields exist?" or "what stores this?"

## Extractor-First Principle

The correct long-term shape is:

1. extractor emits normalized structure facts
2. extractor derives a higher-level `dataModelDiagram`
3. visualizer renders those facts with minimal additional logic

For this tab specifically:

- TypeScript definitions should come from AST extraction
- SQL tables should come from `schema.sql`
- JSON asset shapes should come from explicit file parsing plus known interface links
- storage/index sites should come from extracted class fields and selected variable declarations
- summaries should prefer JSDoc and nearby comments before falling back to heuristics

## Data Model Scope For AI Town

The first version should focus on the structures that actually help a reader understand the repo:

### Domain Structures

- `Position`
- `TileType`
- `Tile`
- `Orientation`
- `PlayerState`
- `Player`
- `Activity`
- `GameEventType`
- `GameEvent`
- `TickResult`
- `Command`
- `MapData`
- `CharacterDef`
- `ConvoState`
- `ConversationEndReason`
- `Message`
- `Conversation`
- `Memory`
- `ScoredMemory`

### Transport Structures

- `ClientMessage`
- `ServerMessage`
- `FullGameState`
- `MoveDirection`

### Persistence Structures

- `MemoryRow`
- `GenerationRecord`
- `StoredGeneration`
- SQL tables from `server/src/db/schema.sql`

### Asset Structures

- `data/map.json`
- NPC character definitions loaded via `server/src/data/characters.ts`

### Runtime Store Structures

- `ConversationManager.conversations: Map<number, Conversation>`
- `ConversationManager.playerToConvo: Map<string, number>`
- `GameLogger.events` ring buffer
- `InMemoryNpcStore.players`
- `InMemoryNpcStore.conversations`
- `InMemoryNpcStore.messages`
- `clientDebugEvents[]`

## Core User Questions

The tab should answer these quickly:

- "What fields are on `Player`, and which ones are movement-only versus conversation-only?"
- "Why does `ConversationManager` keep both `conversations` and `playerToConvo`?"
- "Is this structure usually accessed by keyed lookup, linear scan, append-only writes, or full snapshot serialization?"
- "Which structures are mirrored manually between `server/src` and `client/src`?"
- "What is the shape of `ClientMessage` and `ServerMessage`?"
- "Which data is authoritative on the server and which is only for transport?"
- "What in-memory structures back NPC persistence fallback mode?"
- "Which SQL tables correspond to runtime concepts, and which do not drive live gameplay?"
- "Which file should I open if I want to change a field on `Memory` or `FullGameState`?"

## Proposed UX

## Canvas

The canvas should stay sparse and conceptual.

Default grouping:

- `Domain`
- `Transport`
- `Persistence`
- `Assets`
- `Runtime Stores`

The base view should show structure-to-structure relationships, not every field as a node.

### Node Types

- `Structure`
  - TypeScript interface, type alias, union, or view model
- `Persistence Table`
  - SQL-backed table card
- `Asset`
  - JSON or file-backed structure
- `Store / Index`
  - runtime container such as `Map<K, V>`, ring buffer, array-backed store
- `Category Boundary`
  - non-interactive grouping container

### Default Card Content

Each data-structure card should show, in this order:

1. `Name`
2. `Category`
3. `Kind`
4. `Role`
5. `Shape preview`

Rules:

- show at most 4 fields or variants on canvas
- if more exist, show `+N more`
- keep the role to one short sentence
- do not dump full nested types on canvas
- do not render all usages on the card

Example card sketch:

- `Player`
- `domain`
- `interface`
- `authoritative runtime player state`
- `id: string`
- `x: number`
- `y: number`
- `state: PlayerState`
- `+13 more`

### Edge Types

The canvas needs explicit relationship semantics.

- `contains`
  - one structure nests or references another
  - example: `Conversation -> Message`
- `variant_of`
  - structure or literal variant belongs to a union
  - example: `"join" payload -> ClientMessage`
- `mirrors`
  - same conceptual structure exists in multiple files
  - example: server `Player` <-> client `Player`
- `serialized_as`
  - one structure is carried inside another
  - example: `FullGameState -> ServerMessage[type=state]`
- `persisted_as`
  - runtime structure maps to a row or table
  - example: `Memory -> memories`
- `loaded_from`
  - structure is hydrated from a file or asset
  - example: `MapData <- data/map.json`
- `stored_in`
  - structure lives inside a runtime container
  - example: `Conversation -> ConversationManager.conversations`
- `indexed_by`
  - secondary lookup structure exists for access patterns
  - example: `Conversation -> playerToConvo`

Each edge should show:

- short label
- semantic type
- why the relationship exists

## Interaction Model

### Selection

Selecting a node should switch the sidebar into a data-structure inspector.

Selecting an edge should switch the sidebar into a relationship inspector.

### Focus Mode

Focus mode should be on by default in the `Data Model` tab.

Selecting a node should dim unrelated content and keep:

- the selected structure
- directly related structures
- connecting edges

### Filters

The tab should support multi-select filters for:

- category
- kind
- only mirrored structures
- only persisted structures
- include or exclude runtime stores
- include or exclude test/debug-only structures

### Search

Search should match:

- structure names
- field names
- field types
- access kinds
- discriminator values
- table names
- JSON keys
- owning files
- owning components
- storage site names

## Inspector Design

Recommended inspector tabs:

1. `Overview`
2. `Shape`
3. `Access Patterns`
4. `Evidence`
5. `Open Next`

## Overview

Purpose:

- one-paragraph summary
- category and kind
- why the structure exists
- canonical source file
- mirrored copies or duplication warnings

For example, `Player` should explain:

- it is the authoritative runtime player model on the server
- a reduced mirrored version exists on the client
- it carries both movement and conversation state
- many subsystems depend on it, so changes have broad impact

## Shape

Purpose:

- show fields, optionality, and types
- show nested structure references
- show union variants or discriminator branches
- show persistence columns for tables
- show asset keys for JSON structures

This tab is where the user should see the full shape.

Field rows should include:

- field name
- type text
- `required` or `optional`
- short note if available
- clickable link to nested structure if the field refers to one

For discriminated unions such as `ClientMessage` and `ServerMessage`, show:

- discriminator field
- variants grouped by `type`
- payload shape per variant

## Access Patterns

Purpose:

- where the structure is created
- who reads it
- who looks it up by key or index
- who iterates or scans it
- who mutates it
- who appends to it or removes from it
- who serializes it
- who deserializes it
- where it is persisted
- where it is mirrored
- what indexes or stores hold it

This tab should answer the user request directly:

- how it interacts with the codebase
- and why

Each access row should include:

- access kind
- file or component
- actor function or method when known
- short "why" explanation
- access path or API when known
- lifecycle or frequency hint
- evidence link

Examples:

- `Conversation` is stored in `ConversationManager.conversations` because the manager owns lifecycle and message history.
- `Conversation` is indexed by `playerToConvo` for O(1) player-to-conversation lookup.
- `ConversationManager.processTick()` iterates conversations each tick to advance lifecycle transitions and timeout checks.
- `playerToConvo.get(playerId)` is a keyed lookup path used to avoid repeated linear scans.
- `clientDebugEvents.push()` appends runtime inspection events into a fixed-size in-memory buffer.
- `Memory` is persisted through `MemoryStore` and can be backed by Postgres or in-memory fallback.
- `FullGameState` is serialized into `ServerMessage.type="state"` as the initial socket snapshot.

Access kinds should be normalized so the UI can group them cleanly:

- `create`
- `read`
- `lookup`
- `index_lookup`
- `iterate`
- `write`
- `append`
- `remove`
- `serialize`
- `deserialize`
- `persist_read`
- `persist_write`
- `clone`
- `mirror`

Optional lifecycle hints:

- `startup`
- `tick_path`
- `event_driven`
- `request_path`
- `debug_only`
- `test_only`
- `unknown`

## Evidence

Purpose:

- show the exact extracted facts behind every claim
- make confidence visible
- let users verify inferred relationships

Evidence rows should include:

- source file
- line number when available
- evidence kind
- exact snippet summary
- confidence badge

Confidence levels:

- `exact`
- `derived`
- `heuristic`

Examples:

- field list on `Player` from AST is `exact`
- `Player mirrors client Player` is `derived`
- `playerToConvo exists for O(1) lookup` can be `exact` if backed by JSDoc or inline comment, otherwise `derived`

## Open Next

Purpose:

- recommend 3-5 files to inspect next
- prioritize leverage, not alphabetic order

Examples:

- `server/src/engine/types.ts`
- `server/src/network/protocol.ts`
- `server/src/engine/conversation.ts`
- `server/src/db/repository.ts`
- `client/src/types.ts`

Each recommendation should explain why it is the next best hop.

## Relationship Inspector

Selecting an edge should explain:

- the relationship type
- source and target structure
- why the relationship exists
- evidence rows backing it

Example:

- `Memory` `persisted_as` `memories`
- Why: `Repository.addMemory()` inserts the application-level memory into the `memories` table and converts row shape back via `rowToMemory()`

## Visual Design Rules

- keep boundaries and cards calmer than the component view
- reserve stronger color differences for category and relationship semantics
- do not encode too much meaning in card color alone
- distinguish `store/index` nodes from shape nodes clearly
- do not render full field lists on the canvas
- do not render raw snippets directly on nodes

## Extractor Changes

The extractor needs a new normalized data-model layer.

## New Graph Sections

Recommended additions to `ArchitectureGraph`:

- `dataStructures`
- `dataStructureRelations`
- `dataStructureAccesses`
- `dataModelDiagram`

### `dataStructures`

Each structure should capture:

- stable id
- name
- category
- kind
- source file
- source language
- summary
- purpose
- fields
- variants
- mirrors
- storage sites
- related components
- evidence ids

Suggested shape:

```ts
interface DataStructure {
  id: string;
  name: string;
  category: "domain" | "transport" | "persistence" | "asset" | "runtime_store" | "ui_view";
  kind: "interface" | "type_alias" | "union" | "table" | "json_asset" | "store";
  sourceKind: "ts" | "sql" | "json";
  fileId: string;
  exported: boolean;
  summary?: string;
  purpose?: string;
  canonical: boolean;
  fieldCount: number;
  fields: DataStructureField[];
  variants: DataStructureVariant[];
  mirrorIds: string[];
  storageSites: DataStructureStorageSite[];
  componentIds: string[];
  evidenceIds: string[];
}
```

Suggested field and variant shape:

```ts
interface DataStructureField {
  id: string;
  name: string;
  typeText: string;
  optional: boolean;
  readonly: boolean;
  description?: string;
  referencedStructureId?: string;
  evidenceIds: string[];
}

interface DataStructureVariant {
  id: string;
  label: string;
  discriminatorField?: string;
  discriminatorValue?: string;
  summary?: string;
  fields: DataStructureField[];
  evidenceIds: string[];
}
```

Suggested storage site shape:

```ts
interface DataStructureStorageSite {
  id: string;
  ownerName: string;
  ownerFileId: string;
  memberName: string;
  containerType: string;
  purpose?: string;
  line?: number;
  evidenceIds: string[];
}
```

### `dataStructureRelations`

This is the normalized edge layer.

```ts
interface DataStructureRelation {
  id: string;
  sourceId: string;
  targetId: string;
  kind:
    | "contains"
    | "variant_of"
    | "mirrors"
    | "serialized_as"
    | "persisted_as"
    | "loaded_from"
    | "stored_in"
    | "indexed_by";
  label: string;
  reason?: string;
  confidence: "exact" | "derived" | "heuristic";
  evidenceIds: string[];
}
```

### `dataStructureAccesses`

This is the normalized access-pattern layer for node inspectors and global filtering.

```ts
interface DataStructureAccess {
  id: string;
  structureId: string;
  accessKind:
    | "create"
    | "read"
    | "lookup"
    | "index_lookup"
    | "iterate"
    | "write"
    | "append"
    | "remove"
    | "serialize"
    | "deserialize"
    | "persist_read"
    | "persist_write"
    | "clone"
    | "mirror";
  actorName?: string;
  actorKind?: "function" | "method" | "class" | "module" | "sql_query" | "runtime_store";
  actorFileId: string;
  componentId?: string;
  accessPath?: string;
  lifecycle?: "startup" | "tick_path" | "event_driven" | "request_path" | "debug_only" | "test_only" | "unknown";
  reason?: string;
  line?: number;
  confidence: "exact" | "derived" | "heuristic";
  evidenceIds: string[];
}
```

### `dataModelDiagram`

Like `componentDiagram`, this should be a visualizer-ready layout and content model synthesized from normalized facts.

That keeps layout, summary truncation, and edge labeling stable across runs.

## Extraction Rules

### TypeScript Structures

The extractor should support:

- exported interfaces
- exported type aliases
- discriminated unions
- enum-like string literal unions
- interface and type-alias JSDoc
- property-level optionality
- property-level readonly
- nested referenced types

### SQL Structures

The extractor should read `schema.sql` and emit:

- table names
- column names
- column types
- nullable versus required
- primary keys
- foreign keys when obvious
- notable indexes and flags such as `vector(1536)` and `ivfflat`

### JSON/File Structures

The extractor should parse known repo-owned assets:

- `data/map.json`

It should emit:

- top-level keys
- nested array/object shape summary
- canonical linked TypeScript structure when known

For AI Town, `data/map.json` should link to `MapData`.

### Runtime Stores And Indexes

The extractor should detect selected high-value containers:

- class fields typed as `Map<K, V>`, `Set<T>`, `Record<K, V>`, `T[]`
- top-level arrays acting as ring buffers or in-memory stores
- field names and nearby comments that explain the purpose

This matters because several important repo behaviors are explained by indexes rather than interfaces:

- `playerToConvo` exists for O(1) lookup
- in-memory fallback stores preserve durability semantics when Postgres is absent
- client debug events use a fixed-size buffer

### Access Pattern Extraction

The extractor should emit access facts for the structures it knows about.

Initial extraction targets:

- constructor or object-literal creation of known structures
- property reads of known structure fields
- property writes and assignments
- `Map#get`, `Map#set`, `Map#has`, `Map#delete`
- array `push`, `pop`, `shift`, `unshift`, `splice`
- loops over known containers
- serialization and deserialization boundaries such as `JSON.parse`, `JSON.stringify`, socket send payloads, debug JSON responses, and DB row conversion helpers
- persistence conversions such as `rowToMemory()` and SQL insert/select mappings

The extractor does not need to solve perfect alias analysis in V1.

It does need to capture the obvious, high-signal sites that explain how the structure is actually used.

### Mirror Detection

The extractor should detect mirrored structures, especially server/client duplicates.

Initial heuristic:

- same exported name
- similar field names and types
- similar category

Examples:

- `server/src/engine/types.ts::Player` <-> `client/src/types.ts::Player`
- `server/src/network/protocol.ts::FullGameState` <-> `client/src/types.ts::FullGameState`
- `server/src/network/protocol.ts::ClientMessage` <-> `client/src/types.ts::ClientMessage`

The inspector should show drift risk when:

- fields differ
- optionality differs
- server/client comments clearly say manual sync is required

## Evidence Sources

Evidence should come from:

- AST declarations
- JSDoc blocks
- inline comments near definitions
- class field declarations
- SQL schema lines
- known asset file paths
- imports linking definitions across files

## Why Explanations

The user explicitly wants "how it interacts with the codebase and why".

The `why` should come from:

1. nearby JSDoc or comments when present
2. method and field naming when the intent is obvious
3. relationship heuristics only as fallback

This is important because the tab should not just say:

- "`Conversation` is stored in a map"

It should say:

- "`Conversation` is stored in `ConversationManager.conversations` because the manager owns lifecycle and message history"

and:

- "`Conversation` is indexed by `playerToConvo` because the manager needs O(1) player-to-conversation lookup"

## V1 Recommendation

The first implementation should intentionally be scoped.

### V1 Must Have

- top-level `Data Model` tab
- extractor support for exported interfaces and type aliases
- union/discriminator extraction for `ClientMessage`, `ServerMessage`, `Command`, `GameEventType`, conversation states
- SQL table extraction from `schema.sql`
- asset extraction for `data/map.json`
- runtime store extraction for selected high-value fields
- mirrored structure detection for server/client duplicates
- inspector tabs: `Overview`, `Shape`, `Interactions`, `Evidence`, `Open Next`

### V1 Nice To Have

- drift warnings for mirror mismatches
- deeper nested inline object rendering
- include debug route payloads when extracted reliably
- quick links from component cards into related structures

### V1 Explicitly Skip

- every test-only harness structure
- every anonymous inline payload
- full REST request/response inference for all debug routes
- generalized SQL query lineage

## Open Questions

These are the main design decisions worth resolving before implementation:

1. Should the user-facing label be `Data Model` or `Data Structures`?
2. Should runtime store nodes be visible by default, or only when a related shape is selected?
3. Should mirrored server/client types appear as one merged conceptual card with two source files, or as separate cards with a `mirrors` edge?
4. Should debug API payloads be first-class transport structures in V1, or deferred until route extraction is more robust?
5. Should the tab include test and harness structures behind a toggle, or leave them out entirely at first?

## Recommendation On The Open Questions

Recommended answers:

1. Use `Data Model` as the tab label.
2. Hide most runtime store nodes by default and reveal them in focus mode or via a filter.
3. Keep mirrored structures as separate source-backed cards connected by a `mirrors` edge.
4. Defer full debug-route payload modeling to a later phase unless it falls out cheaply from the AST.
5. Exclude test and harness structures in V1.
6. Make `Access Patterns` a first-class inspector tab rather than folding it into a generic relationship summary.

## Success Criteria

The tab is successful if a new reader can answer these with two clicks or less:

- what `Player` looks like
- what `ClientMessage` variants exist
- how `Conversation` is stored and indexed
- how `Conversation` is accessed in practice
- where `Memory` is persisted
- why `MapData` matters and where it comes from
- which types are manually mirrored across server and client

It is also successful if the implementation materially reduces the need to jump between:

- `server/src/engine/types.ts`
- `server/src/network/protocol.ts`
- `server/src/engine/conversation.ts`
- `server/src/db/repository.ts`
- `client/src/types.ts`

just to reconstruct the repo's data model by hand.
