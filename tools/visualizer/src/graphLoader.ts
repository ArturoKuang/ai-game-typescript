/**
 * Converts ArchitectureGraph into React Flow nodes/edges.
 *
 * Key behaviors:
 * - Colorblind-safe: blue/orange/purple + distinct dash patterns
 * - Edge labels read like sentences ("listens to 5 events")
 * - Bidirectional edges merged into one with dual arrows
 * - Hover dims everything except the hovered path
 * - No constant animation — only on hover/select
 * - Edge filtering by coupling type
 */
import type { Node, Edge, MarkerType } from "@xyflow/react";
import type { ArchitectureGraph, ZoomLevel, BoundaryEdge } from "./types";
import type { ComponentFocusDirection, CouplingFilter } from "./store";
import { computeLayout, computeSplitLayout, computeDependencyLayout, computeGroupedDependencyLayout, type GroupDef } from "./layout";
import { buildFlowLevel } from "./flowLayout";
import {
  compareStructureOrder,
  DATA_MODEL_CATEGORY_META,
  DATA_MODEL_CATEGORY_ORDER,
  getFamilyLeaderId,
  getVisibleDataStructures,
  type DataModelVisibilityOptions,
} from "./dataModel";

/** Deuteranopia/protanopia safe: blue (dashed), gold (solid), magenta (dotted) */
const COUPLING = {
  event:    { stroke: "#648FFF", dash: "8 4",      width: 2,   label: "Events" },
  call:     { stroke: "#FFB000", dash: undefined,   width: 1.5, label: "Calls" },
  mutation: { stroke: "#DC267F", dash: "3 3",       width: 2.5, label: "Commands" },
  mixed:    { stroke: "#FFB000", dash: "12 4 3 4",  width: 2,   label: "Mixed" },
};

const COMPONENT_EDGE_STYLE = {
  transport: { stroke: "#9ca3af", dash: "10 6", width: 2.5 },
  queued_command: { stroke: "#22D3EE", dash: "5 4", width: 2.4 },
  event_subscription: { stroke: "#648FFF", dash: "8 4", width: 2.2 },
  direct_call: { stroke: "#e5e7eb", dash: undefined, width: 2 },
  persistence_io: { stroke: "#FFB000", dash: "2 5", width: 2.4 },
  mixed: { stroke: "#cbd5e1", dash: "12 5 3 5", width: 2.4 },
} as const;

const CONTAINER_EDGE_STYLE = {
  stroke: "#cbd5e1",
  dash: undefined,
  width: 2.3,
};

const DATA_MODEL_RELATION_STYLE = {
  contains: { stroke: "#94a3b8", dash: undefined, width: 2 },
  mirrors: { stroke: "#f59e0b", dash: "7 4", width: 2.2 },
  serialized_as: { stroke: "#22c55e", dash: "8 4", width: 2.2 },
  persisted_as: { stroke: "#f59e0b", dash: "2 5", width: 2.4 },
  loaded_from: { stroke: "#38bdf8", dash: "10 5", width: 2.2 },
  stored_in: { stroke: "#a855f7", dash: "6 4", width: 2.2 },
  indexed_by: { stroke: "#ec4899", dash: "2 4", width: 2.4 },
} as const;

const DIM_OPACITY = 0.12;
const NORMAL_OPACITY = 0.85;
const HIGHLIGHT_OPACITY = 1;

/** Detailed component descriptions explaining what it does and how */
const DESCRIPTIONS: Record<string, string> = {
  Engine:
    "Authoritative tick-based simulation running at 20 ticks/sec. " +
    "Processes WASD input movement with AABB collision, A* pathfinding for click-to-move, " +
    "and a conversation state machine (invited → walking → active → ended). " +
    "Pure logic — no I/O, no database, no network. Fully testable in-memory.",
  Network:
    "WebSocket server accepting browser connections on port 3001. " +
    "Translates incoming client messages (join, move, say, input_start/stop) into engine commands. " +
    "Broadcasts engine events (player_update, convo_update, message) to connected clients. " +
    "Scrubs internal state (inputX/Y) before sending.",
  NPC:
    "AI-driven NPC behavior stack. The Orchestrator listens to conversation events " +
    "and generates replies via the Claude CLI subprocess (with scripted fallback). " +
    "Retrieves relevant memories using composite scoring (recency × importance × cosine similarity). " +
    "Autonomously initiates conversations with nearby idle players every 20 ticks. " +
    "Triggers reflection generation when cumulative memory importance exceeds threshold.",
  Persistence:
    "PostgreSQL 16 with pgvector extension for 1536-dimensional embedding storage. " +
    "Stores NPC memories with vector similarity search (IVFFlat index, cosine distance). " +
    "Also persists player snapshots, conversations, messages, and LLM generation metadata. " +
    "Falls back to in-memory storage (InMemoryRepository, InMemoryNpcStore) when DB is unavailable.",
  Debug:
    "REST API on /api/debug/ for inspecting and controlling the simulation. " +
    "Read endpoints: /state, /map (ASCII), /players, /log, /conversations, /memories. " +
    "Control endpoints: /tick, /spawn, /move, /scenario, /mode. " +
    "Direct mutation endpoints: /start-convo, /say, /end-convo (bypass command queue).",
  Client:
    "PixiJS browser client rendering a 20×20 tile map at 32px/tile. " +
    "Runs client-side prediction mirroring the server's collision physics for instant WASD response. " +
    "Reconciles with server state using distance-based modes: snap (>4 tiles), lerp (>0.35), settle (>0.3). " +
    "Manages chat UI, player list, conversation panel with invite/accept/decline/end actions.",
  Bootstrap:
    "Server entry point (index.ts) that wires all components together on startup: " +
    "1) Resolves PostgreSQL pool (or falls back to in-memory). " +
    "2) Creates GameLoop in realtime mode at 20 ticks/sec. " +
    "3) Initializes NPC stack: PlaceholderEmbedder → MemoryManager → ResilientNpcProvider (Claude + Scripted fallback) → NpcOrchestrator. " +
    "4) Loads map.json and spawns 5 NPCs from character definitions. " +
    "5) Starts WebSocket server and event bridge (game.on('*') → broadcast).",
};

const TECHNOLOGIES: Record<string, string> = {
  Engine: "Pure TypeScript, zero I/O dependencies",
  Network: "ws 8, Express 4",
  NPC: "Claude CLI subprocess, pgvector cosine search",
  Persistence: "PostgreSQL 16, pgvector (1536-dim), pg driver",
  Debug: "Express 4 REST router",
  Client: "PixiJS 8, Vite 6, TypeScript",
  Bootstrap: "Node.js 20, tsx, Express",
};

/** Key classes per component — shown in collapsed view */
const KEY_CLASSES: Record<string, string[]> = {
  Engine: ["GameLoop", "ConversationManager", "World"],
  Network: ["GameWebSocketServer"],
  NPC: ["NpcOrchestrator", "MemoryManager", "ClaudeCodeProvider"],
  Persistence: ["Repository", "InMemoryRepository", "PostgresNpcStore"],
  Debug: ["createDebugRouter", "renderAsciiMap"],
  Client: ["GameRenderer", "GameClient", "UI"],
  Bootstrap: [],
};

/** Which C4 boundary each component belongs to */
const SERVER_COMPONENTS = new Set(["Engine", "Network", "NPC", "Persistence", "Debug", "Bootstrap"]);
const CLIENT_COMPONENTS = new Set(["Client"]);

// ---------------------------------------------------------------------------
// Label helpers
// ---------------------------------------------------------------------------

function boundaryLabel(b: BoundaryEdge, direction?: string): string {
  const parts: string[] = [];
  if (b.eventCount > 0) parts.push(`${b.eventCount} event${b.eventCount > 1 ? "s" : ""}`);
  if (b.mutationCount > 0) parts.push(`${b.mutationCount} cmd${b.mutationCount > 1 ? "s" : ""}`);
  if (b.callCount > 0 && b.eventCount === 0 && b.mutationCount === 0) {
    parts.push(`${b.callCount} import${b.callCount > 1 ? "s" : ""}`);
  }
  const desc = parts.join(" + ");
  return direction ? `${direction}: ${desc}` : desc;
}

// ---------------------------------------------------------------------------
// Hover highlight helpers
// ---------------------------------------------------------------------------

interface HighlightContext {
  active: boolean;             // is anything hovered?
  highlightedNodeIds: Set<string>;
  highlightedEdgeIds: Set<string>;
}

function buildHighlightContext(
  edges: Edge[],
  hoveredNodeId: string | null,
  hoveredEdgeId: string | null,
): HighlightContext {
  if (!hoveredNodeId && !hoveredEdgeId) {
    return { active: false, highlightedNodeIds: new Set(), highlightedEdgeIds: new Set() };
  }

  const nodeIds = new Set<string>();
  const edgeIds = new Set<string>();

  if (hoveredEdgeId) {
    const edge = edges.find((e) => e.id === hoveredEdgeId);
    if (edge) {
      edgeIds.add(edge.id);
      nodeIds.add(edge.source);
      nodeIds.add(edge.target);
    }
  }

  if (hoveredNodeId) {
    nodeIds.add(hoveredNodeId);
    for (const edge of edges) {
      if (edge.source === hoveredNodeId || edge.target === hoveredNodeId) {
        edgeIds.add(edge.id);
        nodeIds.add(edge.source);
        nodeIds.add(edge.target);
      }
    }
  }

  return { active: true, highlightedNodeIds: nodeIds, highlightedEdgeIds: edgeIds };
}

function applyHighlight(
  nodes: Node[],
  edges: Edge[],
  ctx: HighlightContext,
): { nodes: Node[]; edges: Edge[] } {
  if (!ctx.active) return { nodes, edges };

  const dimmedNodes = nodes.map((n) => ({
    ...n,
    style: {
      ...n.style,
      opacity: ctx.highlightedNodeIds.has(n.id) ? HIGHLIGHT_OPACITY : DIM_OPACITY,
      transition: "opacity 0.2s ease",
    },
  }));

  const dimmedEdges = edges.map((e) => {
    const highlighted = ctx.highlightedEdgeIds.has(e.id);
    return {
      ...e,
      style: {
        ...e.style,
        opacity: highlighted ? HIGHLIGHT_OPACITY : DIM_OPACITY,
        transition: "opacity 0.2s ease",
      },
      animated: highlighted && (e.data as { couplingType?: string })?.couplingType === "event",
      labelStyle: {
        ...(e.labelStyle as Record<string, unknown> ?? {}),
        opacity: highlighted ? 1 : DIM_OPACITY,
      },
    };
  });

  return { nodes: dimmedNodes, edges: dimmedEdges };
}

// ---------------------------------------------------------------------------
// Legend highlight — dims everything except nodes matching the legend key
// ---------------------------------------------------------------------------

/** Maps legend keys to the laneColor or producesKind they correspond to */
const LEGEND_LANE_COLORS: Record<string, string> = {
  Client: "#FE6100",
  Network: "#22D3EE",
  Engine: "#648FFF",
  NPC: "#DC267F",
  Persistence: "#FFB000",
};

const LEGEND_BADGE_KEYS: Record<string, string> = {
  CMD: "command",
  EVT: "event",
  MSG: "serverMessage",
  CALL: "directCall",
};

function applyLegendHighlight(
  nodes: Node[],
  edges: Edge[],
  legendKeys: Set<string>,
): { nodes: Node[]; edges: Edge[] } {
  // Collect all matching lane colors and badge kinds from the active keys
  const matchLaneColors = new Set<string>();
  const matchBadgeKinds = new Set<string>();
  for (const key of legendKeys) {
    if (LEGEND_LANE_COLORS[key]) matchLaneColors.add(LEGEND_LANE_COLORS[key]);
    if (LEGEND_BADGE_KEYS[key]) matchBadgeKinds.add(LEGEND_BADGE_KEYS[key]);
  }

  const highlightedNodeIds = new Set<string>();

  for (const n of nodes) {
    if (n.type !== "flowStep") continue;
    const d = n.data as Record<string, unknown>;
    if (matchLaneColors.size > 0 && matchLaneColors.has(d.laneColor as string)) {
      highlightedNodeIds.add(n.id);
    }
    if (matchBadgeKinds.size > 0 && matchBadgeKinds.has(d.producesKind as string)) {
      highlightedNodeIds.add(n.id);
    }
  }

  // Also highlight edges connecting highlighted nodes
  const highlightedEdgeIds = new Set<string>();
  for (const e of edges) {
    if (highlightedNodeIds.has(e.source) || highlightedNodeIds.has(e.target)) {
      highlightedEdgeIds.add(e.id);
    }
  }

  const dimmedNodes = nodes.map((n) => {
    // Never dim the legend itself or swim lanes
    if (n.type === "legend" || n.type === "swimLane") return n;
    return {
      ...n,
      style: {
        ...n.style,
        opacity: highlightedNodeIds.has(n.id) ? HIGHLIGHT_OPACITY : DIM_OPACITY,
        transition: "opacity 0.2s ease",
      },
    };
  });

  const dimmedEdges = edges.map((e) => ({
    ...e,
    style: {
      ...e.style,
      opacity: highlightedEdgeIds.has(e.id) ? HIGHLIGHT_OPACITY : DIM_OPACITY,
      transition: "opacity 0.2s ease",
    },
    labelStyle: {
      ...(e.labelStyle as Record<string, unknown> ?? {}),
      opacity: highlightedEdgeIds.has(e.id) ? 1 : DIM_OPACITY,
    },
  }));

  return { nodes: dimmedNodes, edges: dimmedEdges };
}

function applyComponentFocus(
  nodes: Node[],
  edges: Edge[],
  selectedNodeId: string | null,
  selectedEdgeId: string | null,
  enabled: boolean,
  direction: ComponentFocusDirection,
): { nodes: Node[]; edges: Edge[] } {
  if (!enabled) return { nodes, edges };

  const highlightedNodeIds = new Set<string>();
  const highlightedEdgeIds = new Set<string>();

  if (selectedEdgeId) {
    const edge = edges.find((candidate) => candidate.id === selectedEdgeId);
    if (edge) {
      highlightedEdgeIds.add(edge.id);
      highlightedNodeIds.add(edge.source);
      highlightedNodeIds.add(edge.target);
    }
  } else if (selectedNodeId) {
    highlightedNodeIds.add(selectedNodeId);
    for (const edge of edges) {
      const matchesOutbound = edge.source === selectedNodeId;
      const matchesInbound = edge.target === selectedNodeId;
      const include =
        direction === "both"
          ? matchesOutbound || matchesInbound
          : direction === "outbound"
            ? matchesOutbound
            : matchesInbound;

      if (!include) continue;
      highlightedEdgeIds.add(edge.id);
      highlightedNodeIds.add(edge.source);
      highlightedNodeIds.add(edge.target);
    }
  } else {
    return { nodes, edges };
  }

  const focusedNodes = nodes.map((node) => {
    if (node.type === "boundary") return node;
    return {
      ...node,
      style: {
        ...node.style,
        opacity: highlightedNodeIds.has(node.id) ? HIGHLIGHT_OPACITY : 0.08,
        transition: "opacity 0.2s ease",
      },
    };
  });

  const focusedEdges = edges.map((edge) => ({
    ...edge,
    style: {
      ...edge.style,
      opacity: highlightedEdgeIds.has(edge.id) ? HIGHLIGHT_OPACITY : 0.08,
      transition: "opacity 0.2s ease",
    },
    labelStyle: {
      ...(edge.labelStyle as Record<string, unknown> ?? {}),
      opacity: highlightedEdgeIds.has(edge.id) ? 1 : 0.08,
    },
  }));

  return { nodes: focusedNodes, edges: focusedEdges };
}

function applyContainerFocus(
  nodes: Node[],
  edges: Edge[],
  selectedNodeId: string | null,
  selectedEdgeId: string | null,
  enabled: boolean,
): { nodes: Node[]; edges: Edge[] } {
  if (!enabled) return { nodes, edges };

  const highlightedNodeIds = new Set<string>();
  const highlightedEdgeIds = new Set<string>();

  if (selectedEdgeId) {
    const edge = edges.find((candidate) => candidate.id === selectedEdgeId);
    if (!edge) return { nodes, edges };
    highlightedNodeIds.add(edge.source);
    highlightedNodeIds.add(edge.target);
    highlightedEdgeIds.add(edge.id);
  } else if (selectedNodeId) {
    highlightedNodeIds.add(selectedNodeId);
    for (const edge of edges) {
      if (edge.source !== selectedNodeId && edge.target !== selectedNodeId) continue;
      highlightedNodeIds.add(edge.source);
      highlightedNodeIds.add(edge.target);
      highlightedEdgeIds.add(edge.id);
    }
  } else {
    return { nodes, edges };
  }

  return {
    nodes: nodes.map((node) => {
      if (node.type === "boundary") return node;
      return {
        ...node,
        style: {
          ...node.style,
          opacity: highlightedNodeIds.has(node.id) ? HIGHLIGHT_OPACITY : 0.08,
          transition: "opacity 0.2s ease",
        },
      };
    }),
    edges: edges.map((edge) => ({
      ...edge,
      style: {
        ...edge.style,
        opacity: highlightedEdgeIds.has(edge.id) ? HIGHLIGHT_OPACITY : 0.08,
        transition: "opacity 0.2s ease",
      },
      labelStyle: {
        ...(edge.labelStyle as Record<string, unknown> ?? {}),
        opacity: highlightedEdgeIds.has(edge.id) ? 1 : 0.08,
      },
    })),
  };
}

// ---------------------------------------------------------------------------
// Bidirectional edge merging
// ---------------------------------------------------------------------------

interface MergedBoundary {
  id: string;
  source: string;
  target: string;
  forward: BoundaryEdge;
  reverse?: BoundaryEdge;
}

function mergeBidirectional(boundaries: BoundaryEdge[]): MergedBoundary[] {
  const seen = new Set<string>();
  const merged: MergedBoundary[] = [];

  for (const b of boundaries) {
    const key = [b.source, b.target].sort().join("↔");
    if (seen.has(key)) continue;
    seen.add(key);

    const reverse = boundaries.find((r) => r.source === b.target && r.target === b.source);
    merged.push({
      id: `boundary-${b.source}-${b.target}`,
      source: b.source,
      target: b.target,
      forward: b,
      reverse: reverse && reverse !== b ? reverse : undefined,
    });
  }

  return merged;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export function buildFlowGraph(
  graph: ArchitectureGraph,
  zoomLevel: ZoomLevel,
  expandedComponents: Set<string>,
  visibleCouplingTypes: Set<CouplingFilter>,
  hoveredNodeId: string | null,
  hoveredEdgeId: string | null,
  selectedNodeId: string | null,
  selectedEdgeId: string | null,
  containerFocusEnabled: boolean,
  dataModelFocusEnabled: boolean,
  dataModelShowRuntimeStores: boolean,
  dataModelShowDebugStructures: boolean,
  dataModelExpandMirrors: boolean,
  activeComponentViewId: string | null,
  componentFocusEnabled: boolean,
  componentFocusDirection: ComponentFocusDirection,
  selectedFlow?: string | null,
  selectedStateMachine?: string | null,
  activeLegendKeys?: Set<string>,
  selectedFlowGroup?: string | null,
  dependencyGranularity?: string,
  dependencyFocusEnabled?: boolean,
  dependencyShowCircularOnly?: boolean,
  dependencyHideTypeOnly?: boolean,
): { nodes: Node[]; edges: Edge[] } {
  let result: { nodes: Node[]; edges: Edge[] };

  switch (zoomLevel) {
    case "container":
      result = graph.containerDiagram ? buildContainerLevel(graph) : buildComponentLevel(graph, expandedComponents, visibleCouplingTypes);
      break;
    case "dataModel":
      result = buildDataModelLevel(
        graph,
        {
          showRuntimeStores: dataModelShowRuntimeStores,
          showDebugStructures: dataModelShowDebugStructures,
          expandMirrors: dataModelExpandMirrors,
        },
        selectedNodeId,
        selectedEdgeId,
        hoveredEdgeId,
      );
      break;
    case "component":
      result = graph.componentDiagram
        ? buildDetailedComponentLevel(graph, activeComponentViewId)
        : buildComponentLevel(graph, expandedComponents, visibleCouplingTypes);
      break;
    case "dependency":
      result = graph.dependencyDiagram
        ? buildDependencyLevel(graph, dependencyGranularity ?? "file", dependencyShowCircularOnly ?? false, dependencyHideTypeOnly ?? true)
        : buildFileLevel(graph);
      break;
    case "file":
      result = buildFileLevel(graph);
      break;
    case "class":
      result = buildClassLevel(graph);
      break;
    case "flow":
      result = buildFlowLevel(graph, selectedFlow ?? null, selectedStateMachine ?? null, selectedFlowGroup);
      break;
  }

  // Legend filter overrides the normal node/edge hover
  if (activeLegendKeys && activeLegendKeys.size > 0 && zoomLevel === "flow") {
    return applyLegendHighlight(result.nodes, result.edges, activeLegendKeys);
  }

  if (zoomLevel === "container" && graph.containerDiagram) {
    result = applyContainerFocus(
      result.nodes,
      result.edges,
      selectedNodeId,
      selectedEdgeId,
      containerFocusEnabled,
    );
  }

  if (zoomLevel === "dataModel") {
    result = applyContainerFocus(
      result.nodes,
      result.edges,
      selectedNodeId,
      selectedEdgeId,
      dataModelFocusEnabled,
    );
  }

  if (zoomLevel === "dependency" && graph.dependencyDiagram) {
    result = applyContainerFocus(
      result.nodes,
      result.edges,
      selectedNodeId,
      selectedEdgeId,
      dependencyFocusEnabled ?? true,
    );
  }

  if (zoomLevel === "component" && graph.componentDiagram) {
    result = applyComponentFocus(
      result.nodes,
      result.edges,
      selectedNodeId,
      selectedEdgeId,
      componentFocusEnabled,
      componentFocusDirection,
    );
  }

  const ctx = buildHighlightContext(result.edges, hoveredNodeId, hoveredEdgeId);
  return applyHighlight(result.nodes, result.edges, ctx);
}

/**
 * Lightweight hover highlight — apply on top of an already-built graph.
 *
 * IMPORTANT: This always returns nodes/edges with explicit opacity + transition,
 * even when nothing is hovered. This prevents the flash caused by toggling between
 * "raw objects (no style)" and "wrapped objects (opacity 0.12)" — without explicit
 * opacity on the unhovered state, the browser jumps instantly instead of transitioning.
 */
export function applyHoverHighlight(
  nodes: Node[],
  edges: Edge[],
  hoveredNodeId: string | null,
  hoveredEdgeId: string | null,
): { nodes: Node[]; edges: Edge[] } {
  const ctx = buildHighlightContext(edges, hoveredNodeId, hoveredEdgeId);

  if (!ctx.active) {
    // Nothing hovered — ensure every node/edge has explicit opacity: 1 with
    // transition so that CLEARING a previous hover animates smoothly instead
    // of snapping. We reuse the same object shape as the dimmed state.
    return {
      nodes: nodes.map((n) => (
        n.type === "boundary" ? n : {
          ...n,
          style: { ...n.style, opacity: NORMAL_OPACITY, transition: "opacity 0.15s ease" },
        }
      )),
      edges: edges.map((e) => ({
        ...e,
        style: { ...e.style, opacity: NORMAL_OPACITY, transition: "opacity 0.15s ease" },
        labelStyle: { ...(e.labelStyle as Record<string, unknown> ?? {}), opacity: 1 },
      })),
    };
  }

  return {
    nodes: nodes.map((n) => (
      n.type === "boundary" ? n : {
        ...n,
        style: {
          ...n.style,
          opacity: ctx.highlightedNodeIds.has(n.id) ? HIGHLIGHT_OPACITY : DIM_OPACITY,
          transition: "opacity 0.15s ease",
        },
      }
    )),
    edges: edges.map((e) => {
      const highlighted = ctx.highlightedEdgeIds.has(e.id);
      return {
        ...e,
        style: {
          ...e.style,
          opacity: highlighted ? HIGHLIGHT_OPACITY : DIM_OPACITY,
          transition: "opacity 0.15s ease",
        },
        animated: highlighted && (e.data as { couplingType?: string })?.couplingType === "event",
        labelStyle: {
          ...(e.labelStyle as Record<string, unknown> ?? {}),
          opacity: highlighted ? 1 : DIM_OPACITY,
        },
      };
    }),
  };
}

function buildContainerLevel(
  graph: ArchitectureGraph,
): { nodes: Node[]; edges: Edge[] } {
  const diagram = graph.containerDiagram;
  if (!diagram) return { nodes: [], edges: [] };

  const nodes: Node[] = [
    {
      id: diagram.system.id,
      type: "boundary",
      position: diagram.system.position,
      data: {
        label: diagram.system.label,
        technology: "Software system boundary",
        description: diagram.system.description,
        borderColor: "#8b5cf6",
        componentCount: diagram.containers.length,
      },
      width: diagram.system.size.width,
      height: diagram.system.size.height,
      measured: diagram.system.size,
      style: {
        width: diagram.system.size.width,
        height: diagram.system.size.height,
        zIndex: -1,
      },
      selectable: false,
      draggable: false,
    },
  ];

  const edges: Edge[] = [];

  for (const container of diagram.containers) {
    nodes.push({
      id: container.id,
      type: "containerCard",
      parentId: diagram.system.id,
      extent: "parent",
      position: container.position,
      data: {
        containerId: container.id,
        name: container.name,
        technology: container.technology,
        description: container.description,
        responsibilities: container.responsibilities,
        summary: container.summary,
        kind: container.kind,
        color: container.color,
        codePaths: container.codePaths,
        badges: container.badges,
      },
      width: container.size.width,
      height: container.size.height,
      measured: container.size,
      style: {
        width: container.size.width,
        height: container.size.height,
      },
      draggable: false,
    });
  }

  for (const relationship of diagram.relationships) {
    edges.push({
      id: relationship.id,
      source: relationship.source,
      target: relationship.target,
      type: "containerRelationship",
      style: {
        stroke: CONTAINER_EDGE_STYLE.stroke,
        strokeWidth: CONTAINER_EDGE_STYLE.width,
        strokeDasharray: relationship.optional ? "6 5" : CONTAINER_EDGE_STYLE.dash,
        opacity: NORMAL_OPACITY,
      },
      data: {
        containerRelationship: true,
        description: relationship.description,
        technology: relationship.technology,
        optional: relationship.optional,
        synchronous: relationship.synchronous,
      },
      markerEnd: { type: "arrowclosed" as MarkerType, color: CONTAINER_EDGE_STYLE.stroke, width: 16, height: 12 },
    });
  }

  return { nodes, edges };
}

function buildDataModelLevel(
  graph: ArchitectureGraph,
  visibility: DataModelVisibilityOptions,
  selectedNodeId: string | null,
  selectedEdgeId: string | null,
  hoveredEdgeId: string | null,
): { nodes: Node[]; edges: Edge[] } {
  const nodes: Node[] = [];
  const edges: Edge[] = [];
  const structures = getVisibleDataStructures(graph, visibility);
  const visibleStructureIds = new Set(structures.map((structure) => structure.id));
  const familyLeaderIdByStructure = new Map(
    graph.dataStructures.map((structure) => [
      structure.id,
      visibility.expandMirrors ? structure.id : getFamilyLeaderId(graph, structure) ?? structure.id,
    ]),
  );
  const accessCountByStructure = new Map<string, number>();
  for (const access of graph.dataStructureAccesses ?? []) {
    const displayStructureId = familyLeaderIdByStructure.get(access.structureId) ?? access.structureId;
    if (!visibleStructureIds.has(displayStructureId)) continue;
    accessCountByStructure.set(displayStructureId, (accessCountByStructure.get(displayStructureId) ?? 0) + 1);
  }

  const grouped = DATA_MODEL_CATEGORY_ORDER.map((category) => ({
    category,
    items: structures
      .filter((structure) => structure.category === category)
      .sort(compareStructureOrder),
  }));

  let x = 0;
  for (const group of grouped) {
    if (group.items.length === 0) continue;

    const boundaryId = `data-boundary-${group.category}`;
    const columnCount = computeDataModelColumnCount(group.items.length);
    const cardWidth = 250;
    const horizontalGap = 24;
    const verticalGap = 22;
    const boundaryPaddingX = 28;
    const boundaryPaddingTop = 92;
    const boundaryPaddingBottom = 26;
    const boundaryWidth = boundaryPaddingX * 2 + columnCount * cardWidth + (columnCount - 1) * horizontalGap;
    const cardHeights = group.items.map((structure) => estimateDataModelNodeHeight(structure));
    const rowHeights: number[] = [];
    for (let index = 0; index < cardHeights.length; index++) {
      const row = Math.floor(index / columnCount);
      rowHeights[row] = Math.max(rowHeights[row] ?? 0, cardHeights[index]);
    }
    const rowTops: number[] = [];
    let yCursor = boundaryPaddingTop;
    for (const rowHeight of rowHeights) {
      rowTops.push(yCursor);
      yCursor += rowHeight + verticalGap;
    }
    const boundaryHeight = Math.max(
      236,
      yCursor - verticalGap + boundaryPaddingBottom,
    );

    nodes.push({
      id: boundaryId,
      type: "boundary",
      position: { x, y: 0 },
      data: {
        label: DATA_MODEL_CATEGORY_META[group.category].label,
        technology: "Data Category",
        description: DATA_MODEL_CATEGORY_META[group.category].description,
        borderColor: DATA_MODEL_CATEGORY_META[group.category].color,
        componentCount: group.items.length,
      },
      width: boundaryWidth,
      height: boundaryHeight,
      measured: { width: boundaryWidth, height: boundaryHeight },
      style: {
        width: boundaryWidth,
        height: boundaryHeight,
        zIndex: -1,
      },
      selectable: false,
      draggable: false,
    });

    for (let index = 0; index < group.items.length; index++) {
      const structure = group.items[index];
      const height = cardHeights[index];
      const row = Math.floor(index / columnCount);
      const column = index % columnCount;
      nodes.push({
        id: structure.id,
        type: "dataStructure",
        parentId: boundaryId,
        extent: "parent",
        position: {
          x: boundaryPaddingX + column * (cardWidth + horizontalGap),
          y: rowTops[row],
        },
        data: {
          label: structure.name,
          categoryLabel: DATA_MODEL_CATEGORY_META[group.category].label,
          conceptLabel: structure.conceptGroup,
          kindLabel: humanizeDataStructureKind(structure.kind),
          accentColor: DATA_MODEL_CATEGORY_META[group.category].color,
          summary: compactDataModelSummary(structure.summary ?? structure.purpose),
          previewLines: buildDataModelPreviewLines(structure),
          badges: structure.badges,
          sourceFile: structure.fileId,
          statItems: buildDataModelStatItems(structure, accessCountByStructure.get(structure.id) ?? 0),
        },
        width: cardWidth,
        height,
        measured: { width: cardWidth, height },
        style: {
          width: cardWidth,
          height,
        },
        draggable: false,
      });
    }

    x += boundaryWidth + 44;
  }

  const collapsedRelations = new Map<string, ArchitectureGraph["dataStructureRelations"][number]>();
  for (const relation of graph.dataStructureRelations ?? []) {
    if (relation.kind === "mirrors" && !visibility.expandMirrors) continue;
    const collapsedSourceId = familyLeaderIdByStructure.get(relation.sourceId) ?? relation.sourceId;
    const collapsedTargetId = familyLeaderIdByStructure.get(relation.targetId) ?? relation.targetId;
    if (collapsedSourceId === collapsedTargetId) continue;
    if (!visibleStructureIds.has(collapsedSourceId) || !visibleStructureIds.has(collapsedTargetId)) continue;
    const key = `${relation.kind}:${collapsedSourceId}:${collapsedTargetId}`;
    const current = collapsedRelations.get(key);
    if (!current || preferredDataModelRelation(relation) > preferredDataModelRelation(current)) {
      collapsedRelations.set(key, {
        ...relation,
        sourceId: collapsedSourceId,
        targetId: collapsedTargetId,
      });
    }
  }

  for (const relation of collapsedRelations.values()) {
    const style = DATA_MODEL_RELATION_STYLE[relation.kind];
    const touchesSelection = selectedNodeId === relation.sourceId || selectedNodeId === relation.targetId;
    const showLabel = relation.id === selectedEdgeId || relation.id === hoveredEdgeId || touchesSelection;
    edges.push({
      id: relation.id,
      source: relation.sourceId,
      target: relation.targetId,
      type: "dataModelRelation",
      style: {
        stroke: style.stroke,
        strokeWidth: style.width,
        strokeDasharray: style.dash,
        opacity: relation.kind === "contains" ? 0.28 : 0.7,
      },
      markerEnd: { type: "arrowclosed" as MarkerType, color: style.stroke, width: 16, height: 12 },
      data: {
        dataModelRelation: true,
        relationKind: relation.kind,
        relationLabel: relation.label,
        reason: relation.reason,
        showLabel,
        stroke: style.stroke,
      },
      interactionWidth: 16,
    });
  }

  return { nodes, edges };
}

function computeDataModelColumnCount(itemCount: number): number {
  if (itemCount >= 30) return 4;
  if (itemCount >= 12) return 3;
  if (itemCount >= 6) return 2;
  return 1;
}

function compactDataModelSummary(summary?: string): string | undefined {
  if (!summary) return undefined;
  return summary.length > 110 ? `${summary.slice(0, 107).trimEnd()}...` : summary;
}

function buildDataModelStatItems(
  structure: ArchitectureGraph["dataStructures"][number],
  accessCount: number,
): string[] {
  const items = [`${structure.fields.length} field${structure.fields.length === 1 ? "" : "s"}`];
  if (structure.variants.length > 0) {
    items.push(`${structure.variants.length} variant${structure.variants.length === 1 ? "" : "s"}`);
  }
  if (accessCount > 0) {
    items.push(`${accessCount} access${accessCount === 1 ? "" : "es"}`);
  }
  if (structure.mirrorIds.length > 0 && structure.canonical) {
    items.push(`${structure.mirrorIds.length + 1} defs`);
  }
  return items.slice(0, 3);
}

function humanizeDataStructureKind(kind: string): string {
  switch (kind) {
    case "type_alias":
      return "Type Alias";
    default:
      return kind.replaceAll("_", " ").replace(/\b\w/g, (value) => value.toUpperCase());
  }
}

function buildDataModelPreviewLines(
  structure: ArchitectureGraph["dataStructures"][number],
): string[] {
  if (structure.fields.length > 0) {
    return [...structure.fields]
      .sort((left, right) => scorePreviewField(right) - scorePreviewField(left))
      .slice(0, 3)
      .map((field) => `${field.name}${field.optional ? "?" : ""}: ${field.typeText}`);
  }
  if (structure.variants.length > 0) {
    return [...structure.variants]
      .sort((left, right) => scorePreviewVariant(right) - scorePreviewVariant(left))
      .slice(0, 3)
      .map((variant) => variant.discriminatorValue ?? variant.label);
  }
  return ["No shape preview available."];
}

function estimateDataModelNodeHeight(
  structure: ArchitectureGraph["dataStructures"][number],
): number {
  const previewCount = Math.min(3, structure.fields.length > 0 ? structure.fields.length : structure.variants.length);
  const summaryRows = structure.summary || structure.purpose ? 2 : 0;
  return 112 + previewCount * 18 + summaryRows * 13;
}

function scorePreviewField(
  field: ArchitectureGraph["dataStructures"][number]["fields"][number],
): number {
  let score = 0;
  const lowerName = field.name.toLowerCase();
  if (lowerName === "id") score += 25;
  if (lowerName === "type" || lowerName === "state") score += 22;
  if (lowerName === "content" || lowerName === "messages" || lowerName === "players") score += 18;
  if (lowerName === "x" || lowerName === "y" || lowerName === "path" || lowerName === "tick") score += 16;
  if (lowerName === "container") score += 18;
  if (field.referencedStructureId) score += 14;
  if (!field.optional) score += 6;
  if (field.description) score += 4;
  return score;
}

function scorePreviewVariant(
  variant: ArchitectureGraph["dataStructures"][number]["variants"][number],
): number {
  let score = 0;
  if (variant.discriminatorValue) score += 10;
  score += Math.max(0, 10 - variant.label.length / 4);
  return score;
}

function preferredDataModelRelation(
  relation: ArchitectureGraph["dataStructureRelations"][number],
): number {
  let score = 0;
  if (relation.confidence === "exact") score += 10;
  if (relation.kind === "loaded_from" || relation.kind === "persisted_as" || relation.kind === "serialized_as") score += 8;
  if (relation.kind === "indexed_by") score += 6;
  if (relation.kind === "stored_in") score += 4;
  if (relation.reason) score += Math.min(10, relation.reason.length / 12);
  return score;
}

function buildDetailedComponentLevel(
  graph: ArchitectureGraph,
  activeComponentViewId: string | null,
): { nodes: Node[]; edges: Edge[] } {
  const diagram = graph.componentDiagram;
  if (!diagram) {
    return { nodes: [], edges: [] };
  }

  const activeView =
    diagram.views.find((item) => item.id === activeComponentViewId) ??
    diagram.views.find((item) => item.id === diagram.defaultViewId) ??
    diagram.views[0];
  if (!activeView) {
    return { nodes: [], edges: [] };
  }

  const system = diagram.systems.find((item) => item.id === activeView.systemId);
  const boundary = diagram.boundaries.find((item) => item.id === activeView.boundaryId);
  if (!system || !boundary) {
    return { nodes: [], edges: [] };
  }

  const cards = diagram.cards.filter((item) => item.viewId === activeView.id);
  const containers = diagram.containers.filter((item) => item.viewId === activeView.id);
  const edgesForView = diagram.edges.filter((item) => item.viewId === activeView.id);

  const nodes: Node[] = [];
  const edges: Edge[] = [];

  nodes.push({
    id: system.id,
    type: "boundary",
    position: system.position,
    data: {
      label: system.label,
      technology: "Software system boundary",
      description: system.description,
      borderColor: system.color,
      componentCount: cards.length + containers.length,
    },
    width: system.size.width,
    height: system.size.height,
    measured: system.size,
    style: {
      width: system.size.width,
      height: system.size.height,
      zIndex: -2,
    },
    selectable: false,
    draggable: false,
  });

  nodes.push({
    id: boundary.id,
    type: "boundary",
    parentId: system.id,
    extent: "parent",
    position: boundary.position,
    data: {
      label: boundary.label,
      technology: boundary.technology,
      description: boundary.description,
      borderColor: boundary.color,
      componentCount: cards.length,
    },
    width: boundary.size.width,
    height: boundary.size.height,
    measured: boundary.size,
    style: {
      width: boundary.size.width,
      height: boundary.size.height,
      zIndex: -1,
    },
    selectable: false,
    draggable: false,
  });

  for (const container of containers) {
    nodes.push({
      id: container.id,
      type: "componentContextContainer",
      parentId: system.id,
      extent: "parent",
      position: container.position,
      data: {
        containerId: container.containerId,
        name: container.name,
        technology: container.technology,
        description: container.description,
        color: container.color,
        kind: container.kind,
      },
      width: container.size.width,
      height: container.size.height,
      measured: container.size,
      style: {
        width: container.size.width,
        height: container.size.height,
      },
      draggable: false,
    });
  }

  for (const card of cards) {
    nodes.push({
      id: card.id,
      type: "detailedComponentCard",
      parentId: card.boundaryId,
      extent: "parent",
      position: card.position,
      data: {
        cardId: card.id,
        title: card.title,
        subtitle: card.subtitle,
        fileId: card.fileId,
        accentColor: card.accentColor,
        summary: card.summary,
        sections: card.sections,
        childCards: card.childCards,
        childColumns: card.size.width >= 850 ? 3 : 2,
        badges: card.badges,
        metrics: card.metrics,
      },
      width: card.size.width,
      height: card.size.height,
      measured: card.size,
      style: {
        width: card.size.width,
        height: card.size.height,
      },
      draggable: false,
    });
  }

  for (const edge of edgesForView) {
    const edgeStyle = COMPONENT_EDGE_STYLE[edge.relationshipKind];
    const stroke = edge.color || edgeStyle.stroke;
    const displayLabel = edge.technology ? `${edge.label}\n${edge.technology}` : edge.label;
    const style = {
      stroke,
      strokeWidth: edgeStyle.width,
      strokeDasharray: edge.dash ?? edgeStyle.dash,
      opacity: NORMAL_OPACITY,
    };

    edges.push({
      id: edge.id,
      source: edge.source,
      target: edge.target,
      sourceHandle: edge.sourceHandle,
      targetHandle: edge.targetHandle,
      type: "smoothstep",
      style,
      data: {
        couplingType:
          edge.relationshipKind === "event_subscription"
            ? "event"
            : edge.relationshipKind === "queued_command"
              ? "mutation"
              : "call",
        diagramEdge: true,
        relationshipKind: edge.relationshipKind,
        technology: edge.technology,
      },
      label: displayLabel,
      labelStyle: {
        fill: "#e5e7eb",
        fontSize: edge.relationshipKind === "transport" ? 12 : 11,
        fontWeight: 700,
        lineHeight: 1.35,
      },
      labelBgStyle: {
        fill: "#0b1020",
        fillOpacity: 0.95,
        rx: 8,
        ry: 8,
      },
      labelBgPadding: [10, 6] as [number, number],
      markerEnd: { type: "arrowclosed" as MarkerType, color: stroke, width: 16, height: 12 },
      markerStart: edge.bidirectional
        ? { type: "arrowclosed" as MarkerType, color: stroke, width: 16, height: 12 }
        : undefined,
    });
  }

  return { nodes, edges };
}

// ---------------------------------------------------------------------------
// Component level
// ---------------------------------------------------------------------------

function buildComponentLevel(
  graph: ArchitectureGraph,
  expanded: Set<string>,
  visibleTypes: Set<CouplingFilter>,
): { nodes: Node[]; edges: Edge[] } {
  const compNodes: Node[] = [];
  const edges: Edge[] = [];

  // --- Step 1: Create component nodes ---
  // Files are rendered INSIDE the component card (not as separate nodes)
  // to keep the layout stable when expanded.
  for (const comp of graph.components) {
    const isExpanded = expanded.has(comp.id);
    const compFiles = graph.files
      .filter((f) => f.componentId === comp.id)
      .sort((a, b) => b.loc - a.loc);

    const internal = graph.internals?.find((i) => i.componentId === comp.id);

    compNodes.push({
      id: comp.id,
      type: "component",
      position: { x: 0, y: 0 },
      data: {
        label: comp.label,
        description: DESCRIPTIONS[comp.id] ?? "",
        technology: TECHNOLOGIES[comp.id] ?? "",
        keyClasses: KEY_CLASSES[comp.id] ?? [],
        fileCount: comp.fileIds.length,
        totalLoc: comp.totalLoc,
        color: comp.color,
        expanded: isExpanded,
        fileNames: comp.fileIds.map((f) => f.split("/").pop() ?? f),
        files: isExpanded
          ? compFiles.map((f) => ({
              name: f.id.split("/").pop() ?? f.id,
              loc: f.loc,
              classes: f.classes,
            }))
          : undefined,
        internal: isExpanded ? internal : undefined,
      },
    });
  }

  // --- Step 2: Cross-component boundary edges ---
  const filtered = graph.boundaries.filter((b) => {
    if (b.source === "Bootstrap" && b.eventCount === 0 && b.mutationCount === 0) return false;
    if (b.couplingType === "call" && b.callCount <= 2 && b.eventCount === 0 && b.mutationCount === 0) return false;
    const hasVisibleEvent = b.eventCount > 0 && visibleTypes.has("event");
    const hasVisibleCall = b.callCount > 0 && visibleTypes.has("call");
    const hasVisibleMutation = b.mutationCount > 0 && visibleTypes.has("mutation");
    return hasVisibleEvent || hasVisibleCall || hasVisibleMutation;
  });

  const mergedBoundaries = mergeBidirectional(filtered);
  for (const mb of mergedBoundaries) {
    if (!compNodes.some((n) => n.id === mb.source) || !compNodes.some((n) => n.id === mb.target)) continue;

    const b = mb.forward;
    const couplingType = b.couplingType;
    const style = COUPLING[couplingType] ?? COUPLING.call;

    let label: string;
    if (mb.reverse) {
      label = `→ ${boundaryLabel(mb.forward)}\n← ${boundaryLabel(mb.reverse)}`;
    } else {
      label = boundaryLabel(b);
    }

    const markers: Partial<Edge> = {
      markerEnd: { type: "arrowclosed" as MarkerType, color: style.stroke, width: 16, height: 12 },
    };
    if (mb.reverse) {
      markers.markerStart = { type: "arrowclosed" as MarkerType, color: style.stroke, width: 16, height: 12 };
    }

    edges.push({
      id: mb.id,
      source: mb.source,
      target: mb.target,
      type: "bezier",
      data: { couplingType, ...b },
      style: { stroke: style.stroke, strokeWidth: style.width, strokeDasharray: style.dash, opacity: NORMAL_OPACITY },
      animated: false,
      label,
      labelStyle: { fill: "#ddd", fontSize: 11, fontWeight: 600, fontFamily: "inherit", lineHeight: 1.3 },
      labelBgStyle: { fill: "#13132a", fillOpacity: 0.95, rx: 6, ry: 6 },
      labelBgPadding: [8, 5] as [number, number],
      ...markers,
    });
  }

  // --- Step 3: Split layout — server and client positioned separately ---
  const serverIds = new Set(compNodes.filter((n) => SERVER_COMPONENTS.has(n.id)).map((n) => n.id));
  const clientIds = new Set(compNodes.filter((n) => CLIENT_COMPONENTS.has(n.id)).map((n) => n.id));

  const laidComponents = computeSplitLayout(compNodes, edges, serverIds, clientIds);

  // --- Step 4: Compute boundary boxes ---
  const BOUNDARY_PADDING = 50;
  const BOUNDARY_HEADER = 70;

  function computeBoundingBox(nodeIds: Set<string>): { x: number; y: number; width: number; height: number } | null {
    const matching = laidComponents.filter((n) => nodeIds.has(n.id));
    if (matching.length === 0) return null;

    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (const n of matching) {
      const d = n.data as { expanded?: boolean; files?: unknown[]; internal?: { primaryState?: unknown[]; ownedClasses?: unknown[]; usedUtilities?: unknown[] } };
      let w = 300, h = 320;
      if (d.expanded && d.internal) {
        const stateRows = (d.internal.primaryState as unknown[])?.length ?? 0;
        const ownedCount = (d.internal.ownedClasses as unknown[])?.length ?? 0;
        const utilCount = (d.internal.usedUtilities as unknown[])?.length ?? 0;
        const ownedHeight = ownedCount > 0 ? 40 + Math.ceil(ownedCount / 2) * 80 : 0;
        w = 360;
        h = 250 + stateRows * 16 + ownedHeight + (utilCount > 0 ? 40 : 0);
      } else if (d.expanded && d.files) {
        w = 320;
        h = 160 + (d.files as unknown[]).length * 32;
      }
      minX = Math.min(minX, n.position.x);
      minY = Math.min(minY, n.position.y);
      maxX = Math.max(maxX, n.position.x + w);
      maxY = Math.max(maxY, n.position.y + h);
    }

    return {
      x: minX - BOUNDARY_PADDING,
      y: minY - BOUNDARY_PADDING - BOUNDARY_HEADER,
      width: maxX - minX + BOUNDARY_PADDING * 2,
      height: maxY - minY + BOUNDARY_PADDING * 2 + BOUNDARY_HEADER,
    };
  }

  const serverBox = computeBoundingBox(SERVER_COMPONENTS);
  const clientBox = computeBoundingBox(CLIENT_COMPONENTS);

  const allNodes: Node[] = [];

  // Add boundary group nodes FIRST (they render behind children)
  if (serverBox) {
    allNodes.push({
      id: "boundary-server",
      type: "boundary",
      position: { x: serverBox.x, y: serverBox.y },
      data: {
        label: "Game Server",
        technology: "Node.js 20, TypeScript, Docker",
        description: "Authoritative simulation + API. Runs on port 3001.",
        borderColor: "#648FFF",
        componentCount: SERVER_COMPONENTS.size,
      },
      width: serverBox.width,
      height: serverBox.height,
      measured: { width: serverBox.width, height: serverBox.height },
      style: { width: serverBox.width, height: serverBox.height, zIndex: -1 },
      selectable: false,
      draggable: false,
    });
  }

  if (clientBox) {
    allNodes.push({
      id: "boundary-client",
      type: "boundary",
      position: { x: clientBox.x, y: clientBox.y },
      data: {
        label: "Browser Client",
        technology: "PixiJS 8, Vite 6, TypeScript",
        description: "Connects to server via WebSocket on port 3001.",
        borderColor: "#FE6100",
        componentCount: CLIENT_COMPONENTS.size,
      },
      width: clientBox.width,
      height: clientBox.height,
      measured: { width: clientBox.width, height: clientBox.height },
      style: { width: clientBox.width, height: clientBox.height, zIndex: -1 },
      selectable: false,
      draggable: false,
    });
  }

  // Add component nodes on top
  allNodes.push(...laidComponents);

  // --- Step 5: Add a WebSocket edge between boundaries ---
  if (serverBox && clientBox) {
    edges.push({
      id: "transport-ws",
      source: "boundary-client",
      target: "boundary-server",
      type: "bezier",
      style: { stroke: "#9ca3af", strokeWidth: 2.5, strokeDasharray: "12 6", opacity: 0.8 },
      label: "WebSocket :3001\nJSON messages over ws://",
      labelStyle: { fill: "#ccc", fontSize: 12, fontWeight: 700 },
      labelBgStyle: { fill: "#0d0d1a", fillOpacity: 0.95, rx: 8, ry: 8 },
      labelBgPadding: [10, 6] as [number, number],
      markerEnd: { type: "arrowclosed" as MarkerType, color: "#9ca3af", width: 18, height: 12 },
      markerStart: { type: "arrowclosed" as MarkerType, color: "#9ca3af", width: 18, height: 12 },
    });
  }

  return { nodes: allNodes, edges };
}

// ---------------------------------------------------------------------------
// File level
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Dependency level
// ---------------------------------------------------------------------------

function buildDependencyLevel(
  graph: ArchitectureGraph,
  granularity: string,
  showCircularOnly: boolean,
  hideTypeOnly: boolean,
): { nodes: Node[]; edges: Edge[] } {
  const diagram = graph.dependencyDiagram;
  if (!diagram) return { nodes: [], edges: [] };

  if (granularity === "symbol") return buildDependencySymbolLevel(graph, diagram, showCircularOnly, hideTypeOnly);
  if (granularity === "module") return buildDependencyModuleLevel(graph, diagram, showCircularOnly);
  return buildDependencyFileLevel(graph, diagram, showCircularOnly);
}

function isClientNode(nodeId: string): boolean {
  return nodeId === "Client" || nodeId.startsWith("client/");
}

function buildDepGroups(nodeIds: string[]): GroupDef[] {
  const serverIds = new Set<string>();
  const clientIds = new Set<string>();
  for (const id of nodeIds) {
    if (isClientNode(id)) clientIds.add(id);
    else serverIds.add(id);
  }
  const groups: GroupDef[] = [];
  if (serverIds.size > 0) {
    groups.push({ id: "dep-group-server", label: "Server", color: "#648FFF", nodeIds: serverIds });
  }
  if (clientIds.size > 0) {
    groups.push({ id: "dep-group-client", label: "Client", color: "#FE6100", nodeIds: clientIds });
  }
  return groups;
}

function buildDepGroupsNested(
  nodeIds: string[],
  nodeComponentMap: Map<string, string>,
  compColor: Map<string, string>,
): GroupDef[] {
  // Partition into server/client
  const serverIds = new Set<string>();
  const clientIds = new Set<string>();
  for (const id of nodeIds) {
    if (isClientNode(id)) clientIds.add(id);
    else serverIds.add(id);
  }

  function buildSubGroups(ids: Set<string>): GroupDef[] {
    const byComp = new Map<string, Set<string>>();
    for (const id of ids) {
      const comp = nodeComponentMap.get(id) ?? "Other";
      if (!byComp.has(comp)) byComp.set(comp, new Set());
      byComp.get(comp)!.add(id);
    }
    const subs: GroupDef[] = [];
    for (const [compId, compNodeIds] of byComp) {
      if (compNodeIds.size === 0) continue;
      subs.push({
        id: `dep-sub-${compId}`,
        label: compId,
        color: compColor.get(compId) ?? "#888",
        nodeIds: compNodeIds,
      });
    }
    return subs;
  }

  const groups: GroupDef[] = [];
  if (serverIds.size > 0) {
    const subs = buildSubGroups(serverIds);
    groups.push({
      id: "dep-group-server",
      label: "Server",
      color: "#648FFF",
      nodeIds: serverIds,
      subGroups: subs.length > 1 ? subs : undefined, // don't nest if only one component
    });
  }
  if (clientIds.size > 0) {
    groups.push({
      id: "dep-group-client",
      label: "Client",
      color: "#FE6100",
      nodeIds: clientIds,
    });
  }
  return groups;
}

function buildDependencyModuleLevel(
  graph: ArchitectureGraph,
  diagram: NonNullable<ArchitectureGraph["dependencyDiagram"]>,
  showCircularOnly: boolean,
): { nodes: Node[]; edges: Edge[] } {
  const nodes: Node[] = [];
  const edges: Edge[] = [];

  const cycleModuleIds = new Set<string>();
  for (const cycle of diagram.cycles) {
    for (const modId of cycle.modules) cycleModuleIds.add(modId);
  }

  const compColor = new Map<string, string>();
  for (const comp of graph.components) compColor.set(comp.id, comp.color);

  const visibleModules = showCircularOnly
    ? diagram.modules.filter((m) => cycleModuleIds.has(m.id))
    : diagram.modules;
  const visibleModuleIds = new Set(visibleModules.map((m) => m.id));

  for (const mod of visibleModules) {
    nodes.push({
      id: mod.id,
      type: "dependencyModule",
      position: { x: 0, y: 0 },
      data: {
        label: mod.label,
        componentId: mod.componentId,
        color: compColor.get(mod.componentId) ?? "#888",
        fileCount: mod.fileCount,
        totalLoc: mod.totalLoc,
        fanIn: mod.fanIn,
        fanOut: mod.fanOut,
        instability: mod.instability,
        internalEdgeCount: mod.internalEdgeCount,
        orphanCount: mod.orphanFiles.length,
        hasCycles: cycleModuleIds.has(mod.id),
      },
    });
  }

  const visibleDeps = showCircularOnly
    ? diagram.moduleDeps.filter((d) => d.isCircular && visibleModuleIds.has(d.source) && visibleModuleIds.has(d.target))
    : diagram.moduleDeps.filter((d) => visibleModuleIds.has(d.source) && visibleModuleIds.has(d.target));

  // Merge bidirectional edges into one with arrows on both ends
  const seen = new Set<string>();
  for (const dep of visibleDeps) {
    const reverseKey = `${dep.target}->${dep.source}`;
    if (seen.has(reverseKey)) continue; // already merged as bidirectional
    seen.add(`${dep.source}->${dep.target}`);

    const reverse = visibleDeps.find((d) => d.source === dep.target && d.target === dep.source);
    const isBidirectional = Boolean(reverse);
    const totalFiles = dep.fileEdgeCount + (reverse?.fileEdgeCount ?? 0);
    const isCirc = dep.isCircular || (reverse?.isCircular ?? false);
    const edgeColor = isCirc ? "#ef4444" : "#94a3b8";

    edges.push({
      id: dep.id,
      source: dep.source,
      target: dep.target,
      type: "dependencyEdge",
      data: { strength: dep.strength, fileEdgeCount: totalFiles, isCircular: isCirc },
      markerEnd: { type: "arrowclosed" as MarkerType, width: 14, height: 14, color: edgeColor },
      ...(isBidirectional ? { markerStart: { type: "arrowclosed" as MarkerType, width: 14, height: 14, color: edgeColor } } : {}),
    });
  }

  const groups = buildDepGroups(nodes.map((n) => n.id));
  const laid = computeGroupedDependencyLayout(nodes, edges, groups, "module");
  return { nodes: laid, edges };
}

function buildDependencyFileLevel(
  graph: ArchitectureGraph,
  diagram: NonNullable<ArchitectureGraph["dependencyDiagram"]>,
  showCircularOnly: boolean,
): { nodes: Node[]; edges: Edge[] } {
  const nodes: Node[] = [];
  const edges: Edge[] = [];

  // Build circular file set
  const circularFiles = new Set<string>();
  for (const dep of diagram.fileDeps) {
    if (dep.isCircular) {
      circularFiles.add(dep.source);
      circularFiles.add(dep.target);
    }
  }

  // Compute per-file fan-in / fan-out
  const fanIn = new Map<string, number>();
  const fanOut = new Map<string, number>();
  for (const dep of diagram.fileDeps) {
    fanOut.set(dep.source, (fanOut.get(dep.source) ?? 0) + 1);
    fanIn.set(dep.target, (fanIn.get(dep.target) ?? 0) + 1);
  }

  const compColor = new Map<string, string>();
  const compLabel = new Map<string, string>();
  for (const comp of graph.components) {
    compColor.set(comp.id, comp.color);
    compLabel.set(comp.id, comp.label);
  }

  // Build file nodes
  const visibleFiles = showCircularOnly
    ? graph.files.filter((f) => circularFiles.has(f.id))
    : graph.files;
  const visibleFileIds = new Set(visibleFiles.map((f) => f.id));

  for (const file of visibleFiles) {
    const fi = fanIn.get(file.id) ?? 0;
    const fo = fanOut.get(file.id) ?? 0;
    const total = fi + fo;
    const instability = total === 0 ? 0 : fo / total;

    nodes.push({
      id: file.id,
      type: "dependencyModule",
      position: { x: 0, y: 0 },
      data: {
        label: file.id.split("/").pop() ?? file.id,
        componentLabel: compLabel.get(file.componentId),
        color: compColor.get(file.componentId) ?? "#888",
        totalLoc: file.loc,
        fanIn: fi,
        fanOut: fo,
        instability,
        hasCycles: circularFiles.has(file.id),
      },
    });
  }

  // Build file edges (deduplicated)
  const visibleDeps = showCircularOnly
    ? diagram.fileDeps.filter((d) => d.isCircular && visibleFileIds.has(d.source) && visibleFileIds.has(d.target))
    : diagram.fileDeps.filter((d) => visibleFileIds.has(d.source) && visibleFileIds.has(d.target));

  const seenFileEdges = new Set<string>();
  for (const dep of visibleDeps) {
    const edgeKey = `${dep.source}-${dep.target}`;
    if (seenFileEdges.has(edgeKey)) continue;
    seenFileEdges.add(edgeKey);
    edges.push({
      id: `fdep-${edgeKey}`,
      source: dep.source,
      target: dep.target,
      type: "dependencyEdge",
      data: { strength: "moderate" as const, fileEdgeCount: 1, isCircular: dep.isCircular },
      markerEnd: { type: "arrowclosed" as MarkerType, width: 12, height: 12, color: dep.isCircular ? "#ef4444" : "#64748b" },
    });
  }

  const groups = buildDepGroups(nodes.map((n) => n.id));
  const laid = computeGroupedDependencyLayout(nodes, edges, groups, "file");
  return { nodes: laid, edges };
}

function buildDependencySymbolLevel(
  graph: ArchitectureGraph,
  diagram: NonNullable<ArchitectureGraph["dependencyDiagram"]>,
  showCircularOnly: boolean,
  hideTypeOnly: boolean,
): { nodes: Node[]; edges: Edge[] } {
  const nodes: Node[] = [];
  const edges: Edge[] = [];

  const compColor = new Map<string, string>();
  for (const comp of graph.components) compColor.set(comp.id, comp.color);

  // Build circular file set for propagation to symbols
  const circularFiles = new Set<string>();
  for (const dep of diagram.fileDeps) {
    if (dep.isCircular) {
      circularFiles.add(dep.source);
      circularFiles.add(dep.target);
    }
  }

  // Build a map: fileId -> exported symbols (classes + functions)
  const fileSymbols = new Map<string, string[]>();
  // Also track which symbol is a class vs function
  const symbolKind = new Map<string, "class" | "interface" | "function">();
  const symbolFile = new Map<string, string>();
  const symbolComponent = new Map<string, string>();
  // Class detail for method/field display
  const classDetail = new Map<string, { methods: string[]; fields: string[] }>();

  for (const cls of graph.classes) {
    const symId = `${cls.fileId}::${cls.name}`;
    symbolKind.set(symId, cls.kind);
    symbolFile.set(symId, cls.fileId);
    symbolComponent.set(symId, cls.componentId);
    classDetail.set(symId, {
      methods: cls.methods.filter((m) => m.visibility === "public").map((m) => m.name),
      fields: cls.fields.map((f) => f.name),
    });
    if (!fileSymbols.has(cls.fileId)) fileSymbols.set(cls.fileId, []);
    fileSymbols.get(cls.fileId)!.push(symId);
  }

  // Add exported functions from module facts
  for (const fact of graph.moduleFacts) {
    for (const fnName of fact.exportedFunctions) {
      const symId = `${fact.fileId}::${fnName}`;
      if (symbolKind.has(symId)) continue; // already a class
      symbolKind.set(symId, "function");
      const file = graph.files.find((f) => f.id === fact.fileId);
      symbolFile.set(symId, fact.fileId);
      symbolComponent.set(symId, file?.componentId ?? "Other");
      if (!fileSymbols.has(fact.fileId)) fileSymbols.set(fact.fileId, []);
      fileSymbols.get(fact.fileId)!.push(symId);
    }
  }

  // Build symbol nodes
  const allSymIds = new Set<string>();
  for (const [, syms] of fileSymbols) {
    for (const s of syms) allSymIds.add(s);
  }

  // Build edges from import graph — for each import edge with symbols,
  // resolve to symbol-level edges
  const edgeSet = new Set<string>();
  const symbolEdges: { source: string; target: string; isCircular: boolean }[] = [];

  for (const imp of graph.imports) {
    const targetSyms = fileSymbols.get(imp.target) ?? [];
    const sourceSyms = fileSymbols.get(imp.source) ?? [];
    const isCircular = circularFiles.has(imp.source) && circularFiles.has(imp.target);

    const typeOnlySet = hideTypeOnly ? new Set(imp.typeOnlySymbols ?? []) : null;

    for (const importedName of imp.symbols) {
      if (typeOnlySet?.has(importedName)) continue; // skip type-only imports

      // Find the target symbol matching this imported name
      const targetSym = targetSyms.find((s) => s.endsWith(`::${importedName}`));
      if (!targetSym) continue;

      // Connect from each source symbol to the target (or from the file if no source symbols)
      if (sourceSyms.length > 0) {
        for (const srcSym of sourceSyms) {
          const key = `${srcSym}->${targetSym}`;
          if (edgeSet.has(key)) continue;
          edgeSet.add(key);
          symbolEdges.push({ source: srcSym, target: targetSym, isCircular });
        }
      }
    }
  }

  // Compute fan-in/fan-out per symbol
  const symFanIn = new Map<string, number>();
  const symFanOut = new Map<string, number>();
  for (const e of symbolEdges) {
    symFanOut.set(e.source, (symFanOut.get(e.source) ?? 0) + 1);
    symFanIn.set(e.target, (symFanIn.get(e.target) ?? 0) + 1);
  }

  // Only include connected symbols (or circular files)
  const connectedSyms = new Set<string>();
  for (const e of symbolEdges) {
    connectedSyms.add(e.source);
    connectedSyms.add(e.target);
  }

  // Circular filter
  const circularSyms = new Set<string>();
  for (const e of symbolEdges) {
    if (e.isCircular) {
      circularSyms.add(e.source);
      circularSyms.add(e.target);
    }
  }

  const visibleSyms = showCircularOnly
    ? [...connectedSyms].filter((s) => circularSyms.has(s))
    : [...connectedSyms];
  const visibleSymSet = new Set(visibleSyms);

  for (const symId of visibleSyms) {
    const kind = symbolKind.get(symId) ?? "function";
    const fileId = symbolFile.get(symId) ?? "";
    const compId = symbolComponent.get(symId) ?? "Other";
    const name = symId.split("::")[1] ?? symId;
    const fi = symFanIn.get(symId) ?? 0;
    const fo = symFanOut.get(symId) ?? 0;
    const total = fi + fo;
    const instability = total === 0 ? 0 : fo / total;
    const detail = classDetail.get(symId);
    const shortFile = fileId.split("/").pop() ?? fileId;

    nodes.push({
      id: symId,
      type: "pillNode",
      position: { x: 0, y: 0 },
      data: {
        label: name,
        componentColor: compColor.get(compId) ?? "#888",
        componentLabel: shortFile,
        componentId: compId,
        kind: kind === "function" ? "function" : kind,
        fanIn: fi,
        fanOut: fo,
        instability,
        hasCycles: circularSyms.has(symId),
        // Sidebar detail (not rendered by pill)
        methods: detail?.methods ?? [],
        fields: detail?.fields ?? [],
        fileId: fileId,
      },
    });
  }

  const visibleEdges = showCircularOnly
    ? symbolEdges.filter((e) => e.isCircular && visibleSymSet.has(e.source) && visibleSymSet.has(e.target))
    : symbolEdges.filter((e) => visibleSymSet.has(e.source) && visibleSymSet.has(e.target));

  // Bundle inter-component edges; keep intra-component edges individual
  const bundleMap = new Map<string, { count: number; hasCircular: boolean; repSource: string; repTarget: string }>();

  for (const e of visibleEdges) {
    const srcComp = symbolComponent.get(e.source) ?? "Other";
    const tgtComp = symbolComponent.get(e.target) ?? "Other";

    if (srcComp === tgtComp) {
      // Intra-component: individual edge
      edges.push({
        id: `sdep-${e.source}-${e.target}`,
        source: e.source,
        target: e.target,
        sourceHandle: "bottom",
        targetHandle: "top",
        type: "dependencyEdge",
        data: { strength: "weak" as const, fileEdgeCount: 1, isCircular: e.isCircular },
        markerEnd: { type: "arrowclosed" as MarkerType, width: 10, height: 10, color: e.isCircular ? "#ef4444" : "#64748b" },
      });
    } else {
      // Inter-component: aggregate into bundle
      const key = `${srcComp}->${tgtComp}`;
      const existing = bundleMap.get(key);
      if (existing) {
        existing.count++;
        if (e.isCircular) existing.hasCircular = true;
      } else {
        bundleMap.set(key, { count: 1, hasCircular: e.isCircular, repSource: e.source, repTarget: e.target });
      }
    }
  }

  // Emit bundled edges
  for (const [key, bundle] of bundleMap) {
    const strength: "weak" | "moderate" | "strong" =
      bundle.count <= 2 ? "weak" : bundle.count <= 6 ? "moderate" : "strong";
    const edgeColor = bundle.hasCircular ? "#ef4444" : "#64748b";
    edges.push({
      id: `bundle-${key}`,
      source: bundle.repSource,
      target: bundle.repTarget,
      sourceHandle: "bottom",
      targetHandle: "top",
      type: "dependencyEdge",
      data: { strength, fileEdgeCount: bundle.count, isCircular: bundle.hasCircular, isBundled: true },
      markerEnd: { type: "arrowclosed" as MarkerType, width: 12, height: 12, color: edgeColor },
    });
  }

  const groups = buildDepGroupsNested(nodes.map((n) => n.id), symbolComponent, compColor);
  const laid = computeGroupedDependencyLayout(nodes, edges, groups, "symbol");
  return { nodes: laid, edges };
}

function buildFileLevel(graph: ArchitectureGraph): { nodes: Node[]; edges: Edge[] } {
  const nodes: Node[] = [];
  const edges: Edge[] = [];

  for (const file of graph.files) {
    const comp = graph.components.find((c) => c.id === file.componentId);
    nodes.push({
      id: file.id,
      type: "file",
      position: { x: 0, y: 0 },
      data: {
        label: file.id.split("/").pop() ?? file.id,
        loc: file.loc,
        classes: file.classes,
        componentColor: comp?.color ?? "#888",
        componentLabel: comp?.label,
      },
    });
  }

  for (const imp of graph.imports) {
    edges.push({
      id: `imp-${imp.source}-${imp.target}`,
      source: imp.source,
      target: imp.target,
      type: "bezier",
      style: { stroke: "#444", strokeWidth: 1 },
    });
  }

  const laid = computeLayout(nodes, edges);
  return { nodes: laid, edges };
}

// ---------------------------------------------------------------------------
// Class level
// ---------------------------------------------------------------------------

function buildClassLevel(graph: ArchitectureGraph): { nodes: Node[]; edges: Edge[] } {
  const nodes: Node[] = [];
  const edges: Edge[] = [];

  const classesOnly = graph.classes.filter((c) => c.kind === "class");
  for (const cls of classesOnly) {
    const comp = graph.components.find((c) => c.id === cls.componentId);
    nodes.push({
      id: cls.id,
      type: "classNode",
      position: { x: 0, y: 0 },
      data: {
        label: cls.name,
        methods: cls.methods.filter((m) => m.visibility === "public").map((m) => m.name),
        fields: cls.fields.map((f) => f.name),
        componentColor: comp?.color ?? "#888",
        componentLabel: comp?.label,
        kind: cls.kind,
      },
    });
  }

  const fileClassMap = new Map<string, string[]>();
  for (const cls of classesOnly) {
    if (!fileClassMap.has(cls.fileId)) fileClassMap.set(cls.fileId, []);
    fileClassMap.get(cls.fileId)!.push(cls.id);
  }

  for (const imp of graph.imports) {
    const sourceClasses = fileClassMap.get(imp.source) ?? [];
    const targetClasses = fileClassMap.get(imp.target) ?? [];
    for (const sc of sourceClasses) {
      for (const tc of targetClasses) {
        if (imp.symbols.includes(tc)) {
          edges.push({
            id: `cls-${sc}-${tc}`,
            source: sc,
            target: tc,
            style: { stroke: "#666", strokeWidth: 1 },
          });
        }
      }
    }
  }

  const laid = computeLayout(nodes, edges);
  return { nodes: laid, edges };
}
