# Container Tab Spec

## Status

- Scope: `tools/extractor` + `tools/visualizer`
- Surface: new `Containers` tab
- Current baseline:
  - the visualizer starts at a code-centric `Components` view
  - the detailed component diagram already has two top-level boundaries: `Browser Client` and `Game Server`
  - there is no C4-style container/system boundary view yet

## Problem

The current visualizer jumps directly into code-level components. That is useful once somebody already understands the runtime, but it skips the C4 container level that answers the first orientation questions:

- what the actual runtime applications and data stores are
- what is inside the AI Town system boundary versus outside it
- which parts are deployable/runtime containers versus implementation components
- which protocols connect those containers
- where a feature likely lives before opening files

This causes a few predictable problems:

- `ENGINE`, `NPC STACK`, and `Debug API` appear as first-class boxes before the user has seen the bigger runtime picture.
- Runtime data stores are implicit until the user reads deeper docs or code.
- Data stores such as PostgreSQL and repo-owned world data files are not modeled at the same level as the applications that use them.
- The current entry point is excellent for code structure, but weak for "what runs where?" and "what do I change first?" questions.

## Goal

Make the new `Containers` tab the fastest way to answer:

1. What are the main applications and data stores that make up AI Town?
2. Which containers are inside the AI Town boundary, and what role does each one play?
3. How do those containers communicate, and over what protocol or interface?
4. Which code directories/files primarily belong to each container?
5. Where should I drill next: `Components`, `Files`, or `Data Flow`?

The accuracy goal is just as important as the UX goal:

- the extractor should become the source of truth for container relationships and code ownership
- declared metadata should name and frame the model, not invent most of it
- higher-level diagrams should become more detailed because the extractor emits better architecture facts, not because the UI hardcodes more labels

## Non-Goals

- Replacing the existing `Components` tab
- Modeling deployment infrastructure such as Docker, ports, hosts, Kubernetes, load balancers, or local-vs-prod topology
- Turning every directory into a C4 container
- Building people/external-system modeling in V1
- Producing a generic, framework-agnostic C4 platform before AI Town has a solid repo-specific version

## Extractor-First Principle

The correct long-term shape is:

1. the extractor produces normalized architecture facts
2. `containerDiagram`, `componentDiagram`, and future high-level views are built from those facts
3. the visualizer stays mostly dumb and renders what the extractor already grouped and explained

For the `Containers` tab specifically:

- AI Town V1 should focus on internal containers only
- internal container ownership and most relationships should come from extracted evidence
- the declared model should be a thin layer for:
  - naming
  - layout hints
  - stable container identity
  - last-resort summaries when code cannot produce a readable label

The extractor should be designed so that future TypeScript systems can reuse the same fact model even if the first shipping implementation is AI Town-specific.

## C4 Interpretation For AI Town

For this repo, the C4 container level should represent the runtime shape of the AI Town software system, not the internal class/module structure.

### Software System In Scope

- `AI Town`

### Internal Containers

- `Browser Client`
- `Game Server`
- `PostgreSQL + pgvector`
- `World Data Files`

### Deferred For Later

These are valid C4 concepts, but not in AI Town V1:

- people
- external software systems

### Explicitly Not Containers

These are important, but they belong at other abstraction levels:

- `GameWebSocketServer`, `ENGINE`, `Debug API`, `NPC STACK`, `PERSISTENCE`
  - These are components inside the `Game Server` container.
- `main.ts`, `renderer.ts`, `prediction.ts`, `ui.ts`
  - These are components inside the `Browser Client` container.
- Docker Compose, Vite dev server, ports, hostnames, containers, and proxies
  - These belong in deployment/runtime topology docs, not in the C4 container view.
- In-memory persistence fallback
  - This is an implementation mode of `Game Server`, not a separate container.

## Why These Modeling Choices

### `PostgreSQL + pgvector` is a container

The database engine may be hosted elsewhere, but the schema, tables, vector index, and stored records are an integral part of AI Town. The system owns that data shape, so this should be modeled as an internal data-store container.

### `World Data Files` is a container

`data/map.json` and the NPC seed files are repo-owned data stores that materially shape runtime behavior. They are not separate processes, but they are still a meaningful C4 data-store container because the system owns their format and contents.

### `Components` remains the next zoom level down

The new tab should sit above the existing detailed component view:

- `Browser Client` drills into the current `Browser Client` boundary in `componentDiagram`
- `Game Server` drills into the current `Game Server` boundary in `componentDiagram`
- data-store containers drill into related component cards first, then files/evidence

This only works well if the extractor owns the mapping between:

- files -> components
- components -> containers
- code facts -> container relationships

## Target User Questions

The tab should answer these quickly:

- "Is this change mostly browser, server, database, or data-file work?"
- "Why is `PERSISTENCE` not a top-level runtime container?"
- "How does the browser talk to the server?"
- "Which code should I open if I need to change world boot data?"
- "Which containers are optional at runtime versus always present?"

## Proposed UX

## Placement

Add a new top-level tab before `Components`:

- `Containers`
- `Components`
- `Files`
- `Classes`
- `Data Flow`

Rationale:

- C4 container view is the natural entry point before code-level components.
- The current `Components` tab is better understood as a zoom-in from `Game Server` and `Browser Client`, not the first architecture view.

## Canvas

The canvas should follow C4 container-diagram semantics:

- show internal containers inside a dotted `AI Town` system boundary
- show unidirectional relationships with short labels and technology details
- distinguish applications from data stores visually

AI Town V1 intentionally omits people and external systems so the first version stays centered on code and runtime ownership.

### Node Types

- `Application Container`
  - standard container card
- `Data Store Container`
  - database/file-store styling
- `Software System Boundary`
  - dotted boundary labeled `AI Town`

### Container Card Content

Each internal container card should show, in this order:

1. `Name`
2. `Technology`
3. `Description`
4. `Code Ownership`

Rules:

- Keep cards sparse; this is an orientation view, not a component dump.
- Show one short description paragraph or 2-3 compact bullets.
- Show code ownership as path chips or short path lines, for example:
  - `client/src/*`
  - `server/src/index.ts`
  - `server/src/db/*`
  - `data/map.json`
- Do not render detailed routes, events, commands, or class names on the canvas.
- Do not show deployment details such as `:3001`, Docker services, or proxy rules.

### Relationships

Every relationship should show:

- `Description`
- `Technology / interface`

Examples:

- `sends input, receives state` / `WebSocket + JSON/HTTP`
- `reads and writes memories` / `SQL + pgvector`
- `loads map and seed data` / `file I/O`

Optional relationships should be visibly marked, but still readable at a glance.

Possible treatments:

- `(optional)` suffix in the label
- reduced opacity
- subtle badge on the target container

## Interaction Model

### Selection

Selecting a node should switch the sidebar into a container-specific inspector.

Selecting an edge should switch the sidebar into a relationship inspector.

### Focus Mode

Like the current component view, selecting a container should dim unrelated nodes and keep:

- the selected node
- directly connected nodes
- only the connecting edges

This should be enabled by default in the `Containers` tab.

### Search

Search in the `Containers` tab should match:

- container names
- technology names
- relationship labels
- code ownership paths
- mapped component ids

### Drill Down

The container tab must provide a clear next hop, with `Container -> Components` as the primary path:

- `Open Components`
  - for app containers that map to component boundaries
  - for data-store containers that map to the components that own, load, or depend on that data
- `Open Files`
  - secondary path when the user wants the concrete artifact
- `Open Flow`
  - when a relationship maps to a known message flow or transport surface

This is the key behavior that makes the C4 view useful for code navigation rather than just documentation.

## Inspector

Selecting an internal container should show these tabs:

1. `Overview`
2. `Relationships`
3. `Code Map`
4. `Evidence`
5. `Open Next`

### Overview

Purpose:

- short summary of what the container is
- why it exists at runtime
- notable runtime caveats
- whether it is always present or optional

### Relationships

Purpose:

- inbound relationships
- outbound relationships
- relationship intent
- protocol/interface used
- whether the relationship is exact, derived, or declared

### Code Map

Purpose:

- primary directories/files
- mapped component boundaries/cards
- major entry points
- major data artifacts

This is where the tab becomes "help visualize the code" rather than just "show runtime boxes".

### Evidence

Purpose:

- code facts and declared architecture facts backing every visible claim
- file path + line when available
- confidence/source badges:
  - `exact`
  - `derived`
  - `declared`

### Open Next

Purpose:

- recommend the next 3-5 components or files to inspect
- prefer leverage over exhaustiveness
- explain why that is the next best hop

## Relationship Inspector

Selecting an edge should show:

- source and target
- relationship description
- technology/interface
- optional/synchronous/asynchronous flags
- exact evidence rows
- suggested next code files on both ends

## AI Town V1 Container Model

This is the first repo-specific model the extractor should produce.

### Internal Containers

#### `Browser Client`

- Technology: TypeScript, PixiJS 8, Vite 6, browser WebSocket/HTTP
- Responsibilities:
  - loads the map and activities for rendering
  - opens the WebSocket
  - collects user input
  - predicts local movement
  - renders players, chat, and debug indicators
- Code ownership:
  - `client/src/*`
- Primary drilldown:
  - `componentDiagram` boundary: `Browser Client`

#### `Game Server`

- Technology: Node.js 20, TypeScript, Express 4, ws 8
- Responsibilities:
  - owns authoritative runtime state
  - exposes WebSocket and debug/API surfaces
  - loads world data and spawns default NPCs
  - orchestrates NPC behavior
  - bridges runtime state to persistence
- Code ownership:
  - `server/src/index.ts`
  - `server/src/engine/*`
  - `server/src/network/*`
  - `server/src/debug/*`
  - `server/src/npc/*`
  - `server/src/db/*`
- Primary drilldown:
  - `componentDiagram` boundary: `Game Server`

#### `PostgreSQL + pgvector`

- Technology: PostgreSQL 16, pgvector, SQL schema
- Responsibilities:
  - stores memories, conversations, messages, players, and generation metadata
  - supports vector similarity search for NPC memory retrieval
- Code/data ownership:
  - `server/src/db/schema.sql`
  - `server/src/db/client.ts`
  - `server/src/db/repository.ts`
  - `server/src/db/npcStore.ts`
- Runtime note:
  - optional at startup; server falls back to in-memory implementations when unavailable
- Primary drilldown:
  - related component cards:
    - `diagram-server-persistence`
    - `diagram-server-npc`
- Secondary drilldown:
  - `Files` view

#### `World Data Files`

- Technology: JSON and TypeScript seed files
- Responsibilities:
  - provides map geometry, activities, spawn points, and default NPC definitions
- Code/data ownership:
  - `data/map.json`
  - `data/characters.ts`
  - `server/src/data/characters.ts`
- Primary drilldown:
  - related component cards:
    - `diagram-server-engine`
    - `diagram-client-main`
    - `diagram-server-debug`
- Secondary drilldown:
  - `Files` view

## AI Town V1 Relationships

These are the relationships the first version should show.

### Internal Relationships

- `Browser Client -> Game Server`
  - `sends input, receives snapshots and updates`
  - `WebSocket + JSON/HTTP`
- `Game Server -> PostgreSQL + pgvector`
  - `reads and writes memories, conversations, players, and generations`
  - `SQL + pgvector`
  - optional
- `Game Server -> World Data Files`
  - `loads map and seed data, serves map content`
  - `file I/O`

## Relationship Rules

### Do Model

- runtime communication between applications and data stores
- file I/O to owned data stores when it is architecturally significant
- component-to-container drilldown mappings

### Do Not Model

- function calls inside a single process container
- imports between internal server modules
- React/Pixi/UI function boundaries
- Docker networking details
- dev-only proxy URLs or port numbers

Those belong in `Components`, `Files`, `Classes`, `Data Flow`, or deployment docs.

## Data Contract Changes

Unlike the component redesign, this should use a distinct top-level model because the abstraction level and node types are different.

```ts
interface ArchitectureGraph {
  containerDiagram?: ContainerDiagram;
}

interface ContainerDiagram {
  system: ContainerDiagramSystem;
  people?: ContainerDiagramPerson[];
  externalSystems?: ContainerDiagramExternalSystem[];
  containers: ContainerDiagramContainer[];
  relationships: ContainerDiagramRelationship[];
  evidence: ContainerDiagramEvidence[];
}

interface ContainerDiagramSystem {
  id: string;
  label: string;
  description: string;
  position: DiagramPoint;
  size: DiagramSize;
}

interface ContainerDiagramPerson {
  id: string;
  name: string;
  description: string;
  position: DiagramPoint;
}

interface ContainerDiagramExternalSystem {
  id: string;
  name: string;
  technology?: string;
  description: string;
  position: DiagramPoint;
}

interface ContainerDiagramContainer {
  id: string;
  kind: "application" | "datastore";
  name: string;
  technology: string;
  description: string;
  position: DiagramPoint;
  size: DiagramSize;
  codePaths: string[];
  componentTargets?: ContainerDiagramComponentTarget[];
  fileIds?: string[];
  badges?: string[];
  summary?: string;
  openNext?: ContainerDiagramOpenTarget[];
}

interface ContainerDiagramComponentTarget {
  kind: "boundary" | "card";
  id: string;
  reason: string;
}

interface ContainerDiagramRelationship {
  id: string;
  source: string;
  target: string;
  description: string;
  technology: string;
  confidence: "exact" | "derived" | "declared";
  optional?: boolean;
  synchronous?: boolean;
  evidenceIds: string[];
}

interface ContainerDiagramEvidence {
  id: string;
  kind: string;
  confidence: "exact" | "derived" | "declared";
  fileId?: string;
  line?: number;
  symbol?: string;
  detail: string;
}

interface ContainerDiagramOpenTarget {
  label: string;
  target:
    | { kind: "component_boundary"; boundaryId: string }
    | { kind: "component_card"; cardId: string }
    | { kind: "file"; fileId: string }
    | { kind: "flow"; flowId: string };
  reason: string;
}
```

## Why A Separate Contract

- The tab has different node types than `componentDiagram`.
- Container relationships need description + technology pairs, not component-section aggregation.
- The new model should support explicit drilldown into the already-existing component boundaries.
- The new model should support data-store containers that drill primarily into related components, not just files.

## Extractor Strategy

The container view should be generated from a hybrid model:

1. declared architecture nodes and mappings
2. extracted code evidence

Pure static analysis is not enough because naming, container identity, and layout stability still need a small declared layer.

The important constraint is this:

- declaration may define the shape of the diagram
- extraction must justify the details inside that shape

### Useful Over Strict

The fidelity policy should be:

- prefer a useful `derived` relationship over omitting an important relationship entirely
- never present a derived label without backing evidence
- clearly badge confidence so the user can tell exact vs derived
- fail on declaration drift, not on the mere existence of derived facts

## Extractor Requirements

The extractor should evolve from "component/file/class scanner" into a reusable architecture-fact engine for all diagram levels.

### Normalized Fact Categories To Add

The extractor should emit explicit facts for:

- entry points
  - browser bootstrap
  - server bootstrap
  - debug CLI/harness entry points
- HTTP routes
  - method
  - path
  - handler symbol
  - owning file
- WebSocket protocol bindings
  - client message type -> handler
  - server event/message -> broadcaster
  - transport file/symbol
- runtime ownership/wiring
  - constructor wiring
  - singleton creation
  - event-bridge registration
  - callback registration
- persistence operations
  - read
  - write
  - upsert
  - search
  - target tables/schema artifacts
- file and static-data access
  - file reads
  - JSON loads
  - static responses
  - seed-data imports
- environment-gated behavior
  - optional dependencies
  - fallback modes
  - startup capability checks
- container membership
  - file -> container
  - component -> container
- relationship traces
  - source container
  - target container
  - relationship kind
  - protocol/interface
  - evidence ids

### Container Accuracy Rules

The extractor should enforce these rules:

- every internal container must map to real files
- every file included in a container code scope must resolve to exactly one container
- every relationship on the diagram should have at least one `exact` or `derived` evidence record
- `declared` should be reserved for:
  - labels/layout summaries that code cannot prove directly
  - future people/external systems if/when they are added
- if a declared internal relationship has no supporting evidence, extraction should fail

### Preferred Relationship Sources

For AI Town, the extractor should prefer building relationships from:

- `client/src/network.ts`
- `client/src/main.ts`
- `server/src/index.ts`
- `server/src/network/websocket.ts`
- `server/src/network/protocol.ts`
- `server/src/debug/router.ts`
- `server/src/db/client.ts`
- `server/src/db/repository.ts`
- `server/src/db/npcStore.ts`
- `server/src/db/schema.sql`

### Detail Rules

The extractor should make relationships more detailed by aggregating real facts, not by expanding prose.

Examples:

- `Browser Client -> Game Server`
  - exact evidence should enumerate:
    - WebSocket message types sent
    - server message types received
    - HTTP endpoints fetched
- `Game Server -> PostgreSQL + pgvector`
  - exact evidence should enumerate:
    - repository/store methods used
    - tables/indexes touched
    - whether the path is read, write, or search
- `Game Server -> World Data Files`
  - exact evidence should enumerate:
    - map file load
    - NPC seed file load
    - static map serving path

## Proposed Extractor Additions

### New Files

- `extractor/src/buildContainerDiagram.ts`
- `extractor/src/containerModel.ts`

### `containerModel.ts`

This file should declare:

- the software system boundary metadata
- internal containers
- code path ownership per container
- layout hints
- drilldown mappings

This keeps the C4 semantics intentional rather than accidental, but it should stay intentionally thin.

It should not become a second hardcoded architecture source that duplicates extractor truth.

### `buildContainerDiagram.ts`

This builder should:

- validate declared code path ownership against real files
- attach extracted evidence to declared containers and relationships
- compute `Open Next` suggestions
- mark evidence as `exact`, `derived`, or `declared`
- fail loudly when a declared container no longer maps to the repo
- fail when a declared relationship has no supporting evidence
- aggregate detailed fact rows into concise relationship labels
- expose richer detail to the inspector than the canvas shows

### Evidence Sources

The first implementation should look for evidence in:

- `client/src/main.ts`
- `client/src/network.ts`
- `server/src/index.ts`
- `server/src/network/protocol.ts`
- `server/src/network/websocket.ts`
- `server/src/debug/router.ts`
- `server/src/db/client.ts`
- `server/src/db/repository.ts`
- `server/src/db/npcStore.ts`
- `server/src/db/schema.sql`

## Shared Extractor Foundation

The same normalized fact layer should also improve the existing diagrams:

- `Components`
  - better ownership, ingress, egress, and dependency lines
- `Data Flow`
  - stronger step-to-step evidence and transport fidelity
- future system-context or deployment views
  - can reuse actor/system/container declarations instead of starting over

This prevents the repo from growing one-off diagram builders with overlapping heuristics.

## Visualizer Changes

### Types

- add `containerDiagram` types to `visualizer/src/types.ts`
- extend `ZoomLevel` with `container`

### Store

Add container-tab state for:

- selected inspector tab
- container search query
- container focus enabled/disabled
- highlighted evidence id

Container state can stay separate from the existing component-tab state to keep the two views independent.

### Graph Loader

Add `buildContainerLevel(graph)` that maps:

- internal containers
- relationships
- system boundary

It should also support the same dim/highlight behavior used in the detailed component view.

### Sidebar

Add a `Containers`-tab-specific inspector with:

- Overview
- Relationships
- Code Map
- Evidence
- Open Next

### App

Wire:

- the new zoom/tab option
- container node clicks
- relationship clicks
- drilldown actions into `Components`, `Files`, and `Data Flow`

## Integration With Existing Component View

This is the most important interaction rule:

- `Containers` answers "what are the main runtime applications and stores?"
- `Components` answers "what is inside the selected application container?"

Expected drilldown:

- `Browser Client` -> current `Browser Client` component boundary
- `Game Server` -> current `Game Server` component boundary
- `PostgreSQL + pgvector` -> related server component cards first, then files/evidence
- `World Data Files` -> related components first, then files/evidence

## Rollout Plan

### Phase 0: Extractor Fact Expansion

- add normalized runtime architecture facts
- add container membership and relationship trace generation
- add declared-model validation against extracted facts

### Phase 1: AI Town V1 Container View

- add `Containers` tab
- add declared AI Town container identities and layout hints
- render the four internal containers and labeled relationships
- no drilldown yet beyond basic selection

### Phase 2: Code Map And Evidence

- attach code paths and evidence
- add inspector tabs
- add `Open Next`

### Phase 3: Drilldown Integration

- wire app containers into `Components`
- wire data stores into `Files`
- preserve selection context while switching tabs

### Phase 4: Better Evidence Fidelity

- reduce `declared` relationships where code can prove them
- improve optional/synchronous flags
- add flow links for transport relationships

## Acceptance Criteria

The `Containers` tab is successful when:

1. A new engineer can explain AI Town's main runtime applications and data stores without opening code first.
2. The difference between a C4 container and a code-level component is clear from the UI.
3. The tab shows the AI Town system boundary and the four internal containers cleanly.
4. Every visible relationship has both a human-readable intent label and a technology/interface label.
5. Clicking any container provides a clear drilldown path into the existing `Components` view.
6. Data-store containers still expose the right files and evidence as a secondary path.
7. The view remains deployment-agnostic: no Docker, port, host, or environment-specific clutter on the canvas.
8. Most internal-container relationships are backed by extractor evidence rather than hardcoded declarations.
9. When a declared container or relationship drifts from the repo, extraction fails.

## Suggested First Implementation Slice

The highest-leverage first slice is:

1. Expand the extractor with:
   - container membership facts
   - HTTP/WebSocket/persistence/file-I/O relationship facts
   - declared-model validation
2. Add `Containers` as a new top-level tab.
3. Render this fixed AI Town v1 node set:
   - `Browser Client`
   - `Game Server`
   - `PostgreSQL + pgvector`
   - `World Data Files`
4. Add the three core relationships:
   - `Browser Client -> Game Server`
   - `Game Server -> PostgreSQL + pgvector`
   - `Game Server -> World Data Files`
5. Add container inspector tabs with `Overview`, `Relationships`, and `Code Map`.
6. Add primary drilldown from every container into the existing component view:
   - app containers via boundary focus
   - data-store containers via related component-card focus

That gives immediate value while still putting the extractor, not the UI, in charge of diagram truth.
