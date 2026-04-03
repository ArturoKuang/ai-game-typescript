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
import { computeLayout, computeSplitLayout } from "./layout";
import { buildFlowLevel } from "./flowLayout";

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
  componentFocusEnabled: boolean,
  componentFocusDirection: ComponentFocusDirection,
  selectedFlow?: string | null,
  selectedStateMachine?: string | null,
  activeLegendKeys?: Set<string>,
  selectedFlowGroup?: string | null,
): { nodes: Node[]; edges: Edge[] } {
  let result: { nodes: Node[]; edges: Edge[] };

  switch (zoomLevel) {
    case "component":
      result = graph.componentDiagram
        ? buildDetailedComponentLevel(graph)
        : buildComponentLevel(graph, expandedComponents, visibleCouplingTypes);
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

function buildDetailedComponentLevel(
  graph: ArchitectureGraph,
): { nodes: Node[]; edges: Edge[] } {
  const diagram = graph.componentDiagram;
  if (!diagram) {
    return { nodes: [], edges: [] };
  }

  const nodes: Node[] = [];
  const edges: Edge[] = [];

  for (const boundary of diagram.boundaries) {
    nodes.push({
      id: boundary.id,
      type: "boundary",
      position: boundary.position,
      data: {
        label: boundary.label,
        technology: boundary.technology,
        description: boundary.description,
        borderColor: boundary.color,
        componentCount: diagram.cards.filter((card) => card.boundaryId === boundary.id).length,
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
  }

  for (const card of diagram.cards) {
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

  for (const edge of diagram.edges) {
    const edgeStyle = COMPONENT_EDGE_STYLE[edge.relationshipKind];
    const style = {
      stroke: edge.color || edgeStyle.stroke,
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
        couplingType: edge.relationshipKind === "event_subscription" ? "event" : "call",
        diagramEdge: true,
        relationshipKind: edge.relationshipKind,
      },
      label: edge.label,
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
      markerEnd: { type: "arrowclosed" as MarkerType, color: edge.color, width: 16, height: 12 },
      markerStart: edge.bidirectional
        ? { type: "arrowclosed" as MarkerType, color: edge.color, width: 16, height: 12 }
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
