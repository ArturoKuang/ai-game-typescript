import type { DiagramPoint, DiagramSize } from "./types.js";

export interface DeclaredContainerComponentTarget {
  kind: "boundary" | "card";
  id: string;
  reason: string;
}

export interface DeclaredContainerOpenTarget {
  label: string;
  target:
    | { kind: "component_boundary"; boundaryId: string }
    | { kind: "component_card"; cardId: string }
    | { kind: "file"; fileId: string }
    | { kind: "flow"; flowId: string };
  reason: string;
}

export interface DeclaredContainerDef {
  id: string;
  kind: "application" | "datastore";
  name: string;
  technology: string;
  description: string;
  responsibilities: string[];
  summary: string;
  color: string;
  position: DiagramPoint;
  size: DiagramSize;
  codePaths: string[];
  requiredComponentIds?: string[];
  requiredPaths?: string[];
  componentTargets?: DeclaredContainerComponentTarget[];
  badges?: string[];
  openNext?: DeclaredContainerOpenTarget[];
}

export interface DeclaredRelationshipDef {
  id: string;
  source: string;
  target: string;
  description: string;
  technology: string;
  optional?: boolean;
  synchronous?: boolean;
}

export const CONTAINER_SYSTEM = {
  id: "container-system-ai-town",
  label: "AI Town",
  description: "Runtime applications and data stores that make up the AI Town software system.",
  position: { x: 60, y: 50 },
  size: { width: 1320, height: 760 },
};

export const DECLARED_CONTAINERS: DeclaredContainerDef[] = [
  {
    id: "container-browser-client",
    kind: "application",
    name: "Browser Client",
    technology: "TypeScript, PixiJS, Browser APIs",
    description:
      "Browser application that renders the town, captures player input, predicts local movement, and keeps the player UI synchronized with server state.",
    responsibilities: [
      "Renders the town, actors, and browser UI.",
      "Captures player input and performs local movement prediction.",
      "Sends commands to the server and applies server updates.",
    ],
    summary:
      "Thin browser shell around the authoritative server. Owns rendering, browser-side input, and prediction.",
    color: "#FE6100",
    position: { x: 70, y: 110 },
    size: { width: 330, height: 220 },
    codePaths: ["client/src/*"],
    requiredComponentIds: ["Client"],
    componentTargets: [
      {
        kind: "boundary",
        id: "component-view-browser-client-boundary",
        reason: "Open the Browser Client boundary in the Components view.",
      },
    ],
    openNext: [
      {
        label: "Browser Client boundary",
        target: { kind: "component_boundary", boundaryId: "component-view-browser-client-boundary" },
        reason: "Shows the browser-side component cards and their surrounding runtime context.",
      },
      {
        label: "App Shell",
        target: { kind: "component_card", cardId: "component-view-browser-client-app-shell" },
        reason: "Best next hop for browser bootstrap, network wiring, reconciliation, and player input handling.",
      },
    ],
  },
  {
    id: "container-game-server",
    kind: "application",
    name: "Game Server",
    technology: "Node.js, TypeScript, Express, ws",
    description:
      "Authoritative application that owns runtime state, transport surfaces, debug routes, NPC orchestration, and access to persistent and file-backed data.",
    responsibilities: [
      "Owns the authoritative simulation, movement rules, and conversations.",
      "Exposes WebSocket and HTTP/debug interfaces to the browser.",
      "Coordinates NPC behavior plus reads and writes backing data stores.",
    ],
    summary:
      "Single-process authoritative server. Owns gameplay state, WebSocket/HTTP surfaces, and NPC orchestration.",
    color: "#648FFF",
    position: { x: 475, y: 110 },
    size: { width: 370, height: 230 },
    codePaths: [
      "server/src/index.ts",
      "server/src/engine/*",
      "server/src/network/*",
      "server/src/debug/*",
      "server/src/npc/*",
    ],
    requiredComponentIds: ["Bootstrap", "Engine", "Network", "Debug", "NPC", "Persistence"],
    componentTargets: [
      {
        kind: "boundary",
        id: "component-view-game-server-boundary",
        reason: "Open the Game Server boundary in the Components view.",
      },
    ],
    openNext: [
      {
        label: "Game Server boundary",
        target: { kind: "component_boundary", boundaryId: "component-view-game-server-boundary" },
        reason: "Shows the server-side component cards and how they interact.",
      },
      {
        label: "Simulation Core",
        target: { kind: "component_card", cardId: "component-view-game-server-simulation-core" },
        reason: "Best next hop for authoritative state and simulation behavior.",
      },
      {
        label: "WebSocket Gateway",
        target: { kind: "component_card", cardId: "component-view-game-server-websocket-gateway" },
        reason: "Best next hop for client/server transport handling.",
      },
    ],
  },
  {
    id: "container-postgres",
    kind: "datastore",
    name: "PostgreSQL + pgvector",
    technology: "PostgreSQL, pgvector, SQL",
    description:
      "Relational datastore for memories, conversations, messages, players, and LLM generation metadata, including vector similarity search over embeddings.",
    responsibilities: [
      "Stores memories, conversations, messages, players, and generation records.",
      "Supports similarity lookup through pgvector indexes.",
      "Acts as an optional durable backing store at runtime.",
    ],
    summary:
      "Optional durable memory and conversation store with pgvector-backed similarity search.",
    color: "#FFB000",
    position: { x: 920, y: 140 },
    size: { width: 320, height: 220 },
    codePaths: [
      "server/src/db/schema.sql",
      "server/src/db/client.ts",
      "server/src/db/repository.ts",
      "server/src/db/npcStore.ts",
    ],
    requiredPaths: ["server/src/db/schema.sql"],
    componentTargets: [
      {
        kind: "card",
        id: "component-view-game-server-persistence-adapters",
        reason: "Persistence component owns the database-facing code paths and schema facts.",
      },
      {
        kind: "card",
        id: "component-view-game-server-npc-orchestration",
        reason: "NPC stack reads and writes memories and generations through persistence.",
      },
    ],
    badges: ["optional at startup"],
    openNext: [
      {
        label: "Persistence Adapters",
        target: { kind: "component_card", cardId: "component-view-game-server-persistence-adapters" },
        reason: "Best next hop for repository/store implementations and schema usage.",
      },
      {
        label: "NPC Orchestration",
        target: { kind: "component_card", cardId: "component-view-game-server-npc-orchestration" },
        reason: "Shows where memory retrieval and generation persistence are triggered.",
      },
      {
        label: "schema.sql",
        target: { kind: "file", fileId: "server/src/db/schema.sql" },
        reason: "See the concrete tables and pgvector index backing the datastore.",
      },
    ],
  },
  {
    id: "container-world-data",
    kind: "datastore",
    name: "World Data Files",
    technology: "JSON and TypeScript files",
    description:
      "Repo-owned files containing map geometry, activities, spawn points, and NPC seed data used during startup and map serving.",
    responsibilities: [
      "Stores map geometry, activities, and spawn points.",
      "Stores default NPC seed definitions owned by the repo.",
      "Provides file-backed startup data rather than a separate service.",
    ],
    summary:
      "Static world and NPC seed data stored in repo-owned files.",
    color: "#14b8a6",
    position: { x: 910, y: 430 },
    size: { width: 330, height: 220 },
    codePaths: [
      "data/map.json",
      "data/characters.ts",
      "server/src/data/characters.ts",
    ],
    requiredPaths: ["data/map.json", "data/characters.ts", "server/src/data/characters.ts"],
    componentTargets: [
      {
        kind: "card",
        id: "component-view-game-server-simulation-core",
        reason: "ENGINE loads world state from the map file at startup.",
      },
      {
        kind: "card",
        id: "component-view-browser-client-app-shell",
        reason: "Browser bootstrap fetches map content for rendering and prediction.",
      },
      {
        kind: "card",
        id: "component-view-game-server-debug-api",
        reason: "Debug routes expose and serve map-related state.",
      },
    ],
    openNext: [
      {
        label: "Simulation Core",
        target: { kind: "component_card", cardId: "component-view-game-server-simulation-core" },
        reason: "Best next hop for how map/world data becomes authoritative runtime state.",
      },
      {
        label: "App Shell",
        target: { kind: "component_card", cardId: "component-view-browser-client-app-shell" },
        reason: "Shows how the browser loads map content for rendering and prediction.",
      },
      {
        label: "map.json",
        target: { kind: "file", fileId: "data/map.json" },
        reason: "See the concrete world artifact that drives map geometry and activities.",
      },
    ],
  },
];

export const EXPECTED_RELATIONSHIPS: DeclaredRelationshipDef[] = [
  {
    id: "container-rel-browser-server",
    source: "container-browser-client",
    target: "container-game-server",
    description: "sends player input and receives runtime state",
    technology: "WebSocket + JSON/HTTP",
    synchronous: true,
  },
  {
    id: "container-rel-server-postgres",
    source: "container-game-server",
    target: "container-postgres",
    description: "reads and writes memories, conversations, players, and generations",
    technology: "SQL + pgvector",
    optional: true,
    synchronous: true,
  },
  {
    id: "container-rel-server-world-data",
    source: "container-game-server",
    target: "container-world-data",
    description: "loads map and seed data",
    technology: "file I/O",
    synchronous: true,
  },
];
