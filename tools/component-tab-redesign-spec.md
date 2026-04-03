# Component Tab Redesign Spec

## Status

- Scope: `tools/extractor` + `tools/visualizer`
- Surface: `Components` tab only
- Current baseline: the component tab already renders from extractor-produced `graph.json` via `componentDiagram`

## Problem

The current component tab is better than the old generic component view, but it still makes users work too hard to understand the codebase:

- Too much meaning lives inside dense card text on the canvas.
- Edge labels are readable now, but not explorable.
- The sidebar mostly acts as a generic detail panel instead of a component-specific inspector.
- Cards show useful facts, but users cannot easily tell which items are exact, derived, or heuristic.
- The canvas answers "what boxes exist?" better than it answers:
  - what this component owns
  - how data enters
  - how data exits
  - what code to open next
  - why a given label or edge exists

## Goal

Make the Components tab the fastest way to answer:

1. What does this component own?
2. What inputs can reach it?
3. What outputs can it produce?
4. What other components can mutate it or depend on it?
5. Which files, classes, or routes should I inspect next?

## Non-Goals

- Replacing the `Files`, `Classes`, or `Data Flow` tabs
- Building a general-purpose code browser
- Inferring behavior that cannot be tied back to extractor evidence
- Re-layout of the entire app outside the Components tab

## Design Principles

### 1. The canvas is for orientation

The diagram should stay visually sparse and stable. It should show structure, boundaries, and relationship semantics at a glance without requiring dense reading.

### 2. The inspector is for understanding

Detailed explanations, evidence, contracts, and code-navigation guidance should move into the sidebar inspector.

### 3. Every claim should be explainable

Users should be able to click any section line or edge and see the exact extracted fact that produced it.

### 4. Semantics should be visible

Different types of relationships should look different. The user should not have to infer whether an arrow means transport, command enqueue, event subscription, direct call, or persistence read/write.

### 5. Detail should be progressive

The default view should be readable in one glance. Additional detail should appear through selection, focus mode, and drilldown, not by overloading the base card.

## Target User Questions

The redesigned tab should answer these quickly:

- "Where does player input enter the system?"
- "What does `GameWebSocketServer` actually own versus delegate?"
- "How does `NPC STACK` interact with `ENGINE` and `PERSISTENCE`?"
- "What code is behind this edge label?"
- "If I want to change conversation behavior, which components and files matter first?"

## Proposed UX

## Canvas

Each component card should use a fixed, typed structure in this order:

1. `Owns`
2. `Ingress`
3. `Egress`
4. `Depends On`
5. `Internals`

Rules:

- Show at most 3 lines per section on canvas.
- If a section has more content, render `+N more`.
- Do not render explanatory prose on the canvas.
- Keep card widths stable per tier to avoid reflow noise between extract runs.
- Boundary boxes remain non-interactive for hover highlighting.

## Inspector

Selecting a component should turn the sidebar into a component inspector with these tabs:

1. `Overview`
2. `Contract`
3. `Internals`
4. `Evidence`
5. `Open Next`

### Overview

Purpose:

- one-paragraph summary
- role in runtime
- owned state/resources
- top neighboring components

### Contract

Purpose:

- ingress grouped by kind:
  - WebSocket messages
  - REST routes
  - commands
  - event subscriptions
- egress grouped by kind:
  - broadcasts
  - emitted events
  - queued commands
  - persistence writes
- explicit mutation surface:
  - direct mutations
  - queued mutations
  - read-only dependencies

### Internals

Purpose:

- important files
- important classes/functions
- grouped collaborators inside the component
- short "why it matters" text for each item

### Evidence

Purpose:

- raw extracted facts that back every visible claim
- file path + line when available
- confidence badges:
  - `exact`
  - `derived`
  - `heuristic`

### Open Next

Purpose:

- recommend 3-5 files to inspect next
- sort by leverage, not alphabetically
- explain why each file is the next best hop

## Edge Design

Edges should encode relationship semantics directly.

### Edge Kinds

- `transport`
- `queued_command`
- `event_subscription`
- `direct_call`
- `persistence_io`

### Edge Rules

- Each edge kind gets its own stroke, dash, and label style.
- Default edge labels stay short:
  - `6 client msgs`
  - `4 events`
  - `2 direct calls`
  - `memory reads + writes`
- Clicking an edge opens full detail in the inspector:
  - exact items
  - source/target code locations
  - whether the edge is exact or derived

## Interaction Model

### Focus Mode

Selecting a component should optionally isolate:

- the selected component
- 1-hop neighbors
- only connecting edges

This becomes the default "understand one area quickly" mode.

### Trace Direction

Inside focus mode, allow users to switch between:

- `Inbound`
- `Outbound`
- `Both`

This is lighter-weight than a full flow-tab trace and still useful inside Components.

### Search

Search within the Components tab should match:

- component names
- file paths
- classes/functions shown in internals
- ingress/egress labels
- routes
- message types
- event names

### Evidence Drilldown

Clicking a card line such as `join`, `input_start`, or `broadcastGameEvent()` should open the exact evidence row that produced it.

## Information Architecture Per Component

For this repo, each top-level card should bias toward these summaries.

### Browser Client

- Owns: local render/UI/prediction state
- Ingress: server messages
- Egress: client messages
- Internals: `main.ts`, `renderer.ts`, `prediction.ts`, `ui.ts`, `debugLog.ts`

### GameWebSocketServer

- Owns: socket registry, player/socket mapping
- Ingress: client message types
- Egress: server broadcasts and scoped conversation sends
- Depends On: `GameLoop`
- Internals: protocol routing, public-player projection

### Debug API

- Owns: debug routes
- Ingress: HTTP requests
- Egress: JSON snapshots or direct/queued engine effects
- Depends On: `GameLoop`, router helpers

### ENGINE

- Owns: authoritative game state
- Ingress: commands and direct debug mutations
- Egress: game events
- Internals: `GameLoop`, `World`, `ConversationManager`, `GameLogger`

### NPC STACK

- Owns: orchestration, reply scheduling, memory retrieval, reflection triggers
- Ingress: engine events and after-tick hooks
- Egress: queued dialogue behavior and persistence writes
- Internals: `NpcOrchestrator`, `MemoryManager`, provider stack

### PERSISTENCE

- Owns: durable storage contracts and implementations
- Ingress: memory/player/conversation/generation writes
- Egress: query results and restore data
- Internals: repositories, stores, schema facts, fallback mode

## Data Contract Changes

The redesign should extend `componentDiagram` rather than introducing a disconnected second model.

## Proposed Graph Additions

```ts
interface ComponentDiagramCard {
  id: string;
  boundaryId: string;
  title: string;
  subtitle?: string;
  fileId?: string;
  accentColor: string;
  position: DiagramPoint;
  size: DiagramSize;
  sections: ComponentDiagramSection[];
  childCards?: ComponentDiagramMiniCard[];
  badges?: string[];
  metrics?: ComponentDiagramMetric[];
  summary?: string;
}

interface ComponentDiagramSection {
  id: string;
  label: "Owns" | "Ingress" | "Egress" | "Depends On" | "Internals";
  lines: ComponentDiagramLine[];
  collapsedCount?: number;
}

interface ComponentDiagramLine {
  id: string;
  text: string;
  kind:
    | "state"
    | "route"
    | "message"
    | "event"
    | "command"
    | "dependency"
    | "internal";
  confidence: "exact" | "derived" | "heuristic";
  evidenceIds: string[];
  targetFileId?: string;
  targetSymbol?: string;
}

interface ComponentDiagramEdge {
  id: string;
  source: string;
  target: string;
  label: string;
  color: string;
  relationshipKind:
    | "transport"
    | "queued_command"
    | "event_subscription"
    | "direct_call"
    | "persistence_io";
  evidenceIds: string[];
  counts?: {
    exact: number;
    derived: number;
  };
}

interface ComponentDiagramEvidence {
  id: string;
  kind: string;
  confidence: "exact" | "derived" | "heuristic";
  fileId: string;
  line?: number;
  symbol?: string;
  detail: string;
}
```

## Why This Contract

- It keeps the current `componentDiagram` as the single source of truth for the tab.
- It makes the visualizer simpler: cards and edges arrive pre-grouped.
- It supports drilldown without requiring the visualizer to reverse-engineer extractor logic.

## Extractor Changes

The extractor should keep producing the component diagram from extracted facts, not direct AST reads inside the diagram builder.

### New Fact Categories To Add

- call sites:
  - `caller -> callee`
- constructions:
  - `new X()` ownership and orchestration facts
- state access:
  - reads
  - writes
- route handlers:
  - handler symbol + method + path
- WebSocket protocol mappings:
  - client message type -> handler
  - event -> server message mapper
- persistence operations:
  - read/write/upsert/search

### Evidence Strategy

Each high-level line or edge in `componentDiagram` should be assembled from one or more normalized evidence records.

Example:

- line: `input_start`
- confidence: `exact`
- evidence:
  - `network/websocket.ts:onMessage switch case "input_start"`

Example:

- line: `local physics mirror`
- confidence: `heuristic`
- evidence:
  - exported functions in `client/src/prediction.ts`
  - collision-related imported symbols

## Visualizer Changes

## Sidebar

Replace the current generic node detail for the Components tab with a component-specific inspector.

Implementation direction:

- keep existing sidebar shell
- add a Components-tab-only inspector component
- preserve current generic detail panels for other tabs

## Canvas Rendering

Needed updates:

- support section line ids
- support clickable line rows
- support edge kind styling
- support component metrics row
- support focus mode dimming separate from hover dimming

## Store

Add component-tab state for:

- selected inspector tab
- focus mode enabled/disabled
- focus direction (`inbound`, `outbound`, `both`)
- component search query
- highlighted evidence id

## Implementation Map

These are the primary files that should change for the redesign.

### Extractor

- `extractor/src/types.ts`
  - extend `ComponentDiagram*` types
  - add evidence record types
- `extractor/src/extract.ts`
  - emit richer normalized facts
  - attach evidence ids to facts before diagram synthesis
- `extractor/src/buildComponentDiagram.ts`
  - group card content into the fixed 5 sections
  - build edge relationship kinds
  - assemble evidence-backed lines and edges
- `extractor/src/renderComponentDiagram.ts`
  - optional: surface richer semantics in markdown export

### Visualizer

- `visualizer/src/types.ts`
  - mirror extractor schema additions
- `visualizer/src/store.ts`
  - add inspector tab, focus mode, focus direction, search, and evidence selection state
- `visualizer/src/graphLoader.ts`
  - map new section-line and edge-kind data into React Flow nodes/edges
  - support focus-mode filtering
- `visualizer/src/App.tsx`
  - wire new interactions and component-tab-specific behavior
- `visualizer/src/Sidebar.tsx`
  - replace generic component detail with component inspector tabs
- `visualizer/src/nodes/DetailedComponentCardNode.tsx`
  - render the fixed section structure
  - support clickable lines, confidence badges, and metrics

## Rollout Plan

### Phase 1: Information Restructure

- reduce on-canvas sections to the fixed 5-section structure
- add section-line ids and confidence badges
- move dense explanations into sidebar overview

### Phase 2: Evidence and Inspector

- add evidence records to `graph.json`
- add inspector tabs:
  - Overview
  - Contract
  - Internals
  - Evidence
  - Open Next
- make card lines and edges drill into evidence

### Phase 3: Focus and Search

- add focus mode
- add inbound/outbound filtering
- add Components-tab local search

### Phase 4: Better Extraction Fidelity

- add call/read/write/construct facts
- improve exactness of ingress/egress grouping
- reduce heuristic labels where evidence can be exact

## Acceptance Criteria

The redesign is successful when:

1. A user can identify a component's owned state, inputs, and outputs without opening code.
2. Clicking any canvas label or edge reveals its backing evidence.
3. The sidebar gives a better explanation than the canvas without duplicating the same text.
4. The default view remains readable at fit-to-screen zoom with no clipped text or overlapping labels.
5. The tab remains fully generated from extractor output in `graph.json`.

## Suggested First Implementation Slice

The highest-leverage first slice is:

1. Restructure cards into `Owns / Ingress / Egress / Depends On / Internals`
2. Add component-specific inspector tabs in the sidebar
3. Add edge relationship kinds
4. Add line-level evidence ids, even if the first version uses a small evidence model

This gives a large usability gain without requiring the full extractor-fact expansion up front.
