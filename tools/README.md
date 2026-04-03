# Tools

This folder contains the architecture tooling for AI Town. It has two runnable tools:

- `extractor/`: scans the TypeScript codebase and generates architecture data.
- `visualizer/`: renders that data in a local React app for exploration.

It also includes [`component-tab-redesign-spec.md`](/Users/arturokuang/ai-game-typescript/tools/component-tab-redesign-spec.md), which documents the current design direction for the visualizer's component view.

There is also a top-level [`package.json`](/Users/arturokuang/ai-game-typescript/tools/package.json) in this folder now, so you can run the common workflows from `tools/` without changing directories.

## Folder Layout

```text
tools/
├── extractor/                   # Static analysis + graph generation
│   ├── src/
│   ├── graph.json               # Main extracted graph output
│   ├── component-diagram.mmd    # Generated Mermaid source
│   └── component-diagram.md     # Generated Markdown wrapper for Mermaid
├── visualizer/                  # React Flow UI for graph.json
│   ├── public/graph.json        # Copy consumed by the app
│   └── src/
└── component-tab-redesign-spec.md
```

## What Each Tool Does

### `extractor`

The extractor uses `ts-morph` to read the repo's `server/src/**/*.ts` and `client/src/**/*.ts` files and produce a single architecture graph.

It extracts:

- component groupings
- files and imports
- classes and interfaces
- cross-component boundaries
- events and commands
- message flows
- state machines
- a higher-level component diagram

Primary outputs:

- [`extractor/graph.json`](/Users/arturokuang/ai-game-typescript/tools/extractor/graph.json)
- [`extractor/component-diagram.mmd`](/Users/arturokuang/ai-game-typescript/tools/extractor/component-diagram.mmd)
- [`extractor/component-diagram.md`](/Users/arturokuang/ai-game-typescript/tools/extractor/component-diagram.md)
- [`visualizer/public/graph.json`](/Users/arturokuang/ai-game-typescript/tools/visualizer/public/graph.json)

### `visualizer`

The visualizer is a Vite + React Flow app that loads `public/graph.json` and lets you inspect the architecture at several levels:

- `Components`
- `Files`
- `Classes`
- `Data Flow`

The sidebar also exposes relationship filters, flow selection, state-machine views, and component inspector tabs.

## Prerequisites

Install dependencies for both subprojects from `tools/`:

```bash
cd tools
npm run setup
```

These tools assume they are being run inside the AI Town repository, because the extractor resolves the repo root and reads from `server/` and `client/`.

## Quick Start

From the repo root:

```bash
cd tools
npm run dev
```

Then open the Vite URL shown in the terminal, usually `http://localhost:5173`.

If you want the built app instead of the dev server:

```bash
cd tools
npm run preview
```

## How To Use All The Tools

### Top-level commands from `tools/`

These are the easiest commands to use day to day:

```bash
cd tools
npm run setup      # install extractor + visualizer deps
npm run extract    # regenerate graph.json and Mermaid outputs
npm run build      # build the visualizer
npm run dev        # extract, then start Vite dev server
npm run preview    # extract, build, then serve the built visualizer
npm start          # same as npm run preview
```

### 1. Generate the architecture graph

Run the full extraction pipeline:

```bash
cd tools
npm run extract
```

This does three things:

1. runs `src/extract.ts` to generate `graph.json`
2. runs `src/renderComponentDiagram.ts` to generate Mermaid outputs
3. copies `graph.json` into `../visualizer/public/graph.json`

Use this whenever the app architecture changed and you want fresh data in the visualizer.

### 2. Generate only the Mermaid component diagram

If you already have a current `graph.json` and only want to regenerate the diagram files:

```bash
cd tools
npm run diagram:component
```

This updates:

- `tools/extractor/component-diagram.mmd`
- `tools/extractor/component-diagram.md`

### 3. Run the visualizer locally

Start the UI:

```bash
cd tools
npm run dev
```

What to do in the UI:

- use `Components` for the high-level system view
- use `Files` to inspect file-to-file relationships
- use `Classes` to inspect type-level structure
- use `Data Flow` to inspect message flows and state machines
- click nodes or edges to open details in the sidebar
- use the relationship filters to hide or isolate coupling types

### 4. Build the visualizer for production/static output

```bash
cd tools
npm run build
```

This writes the production bundle to `tools/visualizer/dist/`.

### 5. Preview the production build

```bash
cd tools
npm run preview
```

Use this when you want to validate the built app rather than the dev server.

## Typical Workflow

When changing extractor logic:

```bash
cd tools
npm run dev
```

When changing only visualizer UI code:

```bash
cd tools/visualizer
npm run dev
```

When you want documentation output from the extracted graph:

```bash
cd tools
npm run diagram:component
```

## Generated Files

### `extractor/graph.json`

The main data contract between the extractor and visualizer. It contains:

- `meta`
- `components`
- `files`
- `classes`
- `moduleFacts`
- `imports`
- `events`
- `commands`
- `boundaries`
- `internals`
- `messageFlows`
- `messageFlowGroups`
- `stateMachines`
- `componentDiagram`

### `extractor/component-diagram.mmd`

Raw Mermaid output for the extracted component diagram.

### `extractor/component-diagram.md`

Markdown wrapper around the Mermaid diagram, useful for viewing in Markdown tooling that supports Mermaid.

### `visualizer/public/graph.json`

The graph file actually loaded by the browser app.

## Notes

- The easiest entry point is `cd tools && npm run preview` if you want one command that extracts, builds, and serves the visualizer.
- If the visualizer looks stale, re-run `cd tools && npm run extract` so `public/graph.json` is refreshed.
- The extractor is opinionated and partly heuristic for higher-level views like message flows and state machines, so update both the extraction code and the visualization if you change the graph contract.
