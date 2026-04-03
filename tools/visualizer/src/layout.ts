/**
 * dagre layout engine — computes node positions for React Flow.
 *
 * Two layout modes:
 * - `computeLayout`: single dagre pass for all nodes (file/class views)
 * - `computeSplitLayout`: separate dagre for server vs client groups,
 *   positioned side by side with clear visual separation (component view)
 */
import dagre from "@dagrejs/dagre";
import type { Node, Edge } from "@xyflow/react";

const NODE_WIDTH_COMPONENT = 300;
const NODE_HEIGHT_COMPONENT = 320;
const NODE_WIDTH_FILE = 180;
const NODE_HEIGHT_FILE = 60;
const NODE_WIDTH_CLASS = 220;
const NODE_HEIGHT_CLASS_BASE = 50;
const NODE_HEIGHT_CLASS_PER_METHOD = 18;

const DAGRE_DEFAULTS = {
  rankdir: "LR" as const,
  ranksep: 220,
  nodesep: 50,
  edgesep: 40,
  marginx: 40,
  marginy: 40,
};

/** Single dagre pass — used for file and class level views. */
export function computeLayout(nodes: Node[], edges: Edge[]): Node[] {
  return runDagre(nodes, edges, DAGRE_DEFAULTS);
}

/**
 * Split layout — lays out server and client groups independently,
 * then positions client below server with clear separation.
 * Used for the component-level C4 view.
 */
export function computeSplitLayout(
  nodes: Node[],
  edges: Edge[],
  serverNodeIds: Set<string>,
  clientNodeIds: Set<string>,
): Node[] {
  // Partition nodes
  const serverNodes = nodes.filter((n) => serverNodeIds.has(n.id));
  const clientNodes = nodes.filter((n) => clientNodeIds.has(n.id));

  // Partition edges (only include edges where both endpoints are in the group)
  const serverEdges = edges.filter((e) => serverNodeIds.has(e.source) && serverNodeIds.has(e.target));
  const clientEdges = edges.filter((e) => clientNodeIds.has(e.source) && clientNodeIds.has(e.target));

  // Layout each group independently
  const laidServer = runDagre(serverNodes, serverEdges, {
    ...DAGRE_DEFAULTS,
    ranksep: 200,
    nodesep: 40,
  });

  const laidClient = runDagre(clientNodes, clientEdges, {
    ...DAGRE_DEFAULTS,
    ranksep: 200,
  });

  // Compute server bounding box
  const serverBounds = computeBounds(laidServer);

  // Position client group below server, aligned to left edge, with gap
  const GAP = 140;
  const clientOffsetX = serverBounds.minX;
  const clientOffsetY = serverBounds.maxY + GAP;

  const shiftedClient = laidClient.map((n) => ({
    ...n,
    position: {
      x: n.position.x + clientOffsetX,
      y: n.position.y + clientOffsetY,
    },
  }));

  return [...laidServer, ...shiftedClient];
}

function runDagre(
  nodes: Node[],
  edges: Edge[],
  graphOpts: Record<string, unknown>,
): Node[] {
  if (nodes.length === 0) return [];

  const g = new dagre.graphlib.Graph();
  g.setDefaultEdgeLabel(() => ({}));
  g.setGraph(graphOpts);

  for (const node of nodes) {
    const dims = getNodeDimensions(node);
    g.setNode(node.id, { width: dims.width, height: dims.height });
  }

  for (const edge of edges) {
    if (g.hasNode(edge.source) && g.hasNode(edge.target)) {
      g.setEdge(edge.source, edge.target);
    }
  }

  dagre.layout(g);

  return nodes.map((node) => {
    const pos = g.node(node.id);
    if (!pos) return node;
    const dims = getNodeDimensions(node);
    return {
      ...node,
      position: {
        x: pos.x - dims.width / 2,
        y: pos.y - dims.height / 2,
      },
      // Explicit dimensions so the MiniMap can render nodes immediately
      width: dims.width,
      height: dims.height,
      measured: { width: dims.width, height: dims.height },
    };
  });
}

function computeBounds(nodes: Node[]): { minX: number; minY: number; maxX: number; maxY: number } {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const n of nodes) {
    const dims = getNodeDimensions(n);
    minX = Math.min(minX, n.position.x);
    minY = Math.min(minY, n.position.y);
    maxX = Math.max(maxX, n.position.x + dims.width);
    maxY = Math.max(maxY, n.position.y + dims.height);
  }
  return { minX, minY, maxX, maxY };
}

function getNodeDimensions(node: Node): { width: number; height: number } {
  const type = node.type ?? "default";
  if (type === "component") {
    const d = node.data as { expanded?: boolean; files?: unknown[]; internal?: { primaryState?: unknown[]; ownedClasses?: unknown[]; usedUtilities?: unknown[] } };
    if (d.expanded) {
      const intern = d.internal;
      if (intern) {
        // Internal architecture view: primary box + owned classes + utilities
        const stateRows = (intern.primaryState as unknown[])?.length ?? 0;
        const ownedCount = (intern.ownedClasses as unknown[])?.length ?? 0;
        const utilCount = (intern.usedUtilities as unknown[])?.length ?? 0;
        const ownedHeight = ownedCount > 0 ? 40 + Math.ceil(ownedCount / 2) * 80 : 0;
        return { width: 360, height: 250 + stateRows * 16 + ownedHeight + (utilCount > 0 ? 40 : 0) };
      }
      // Fallback file list
      const fileCount = (d.files as unknown[])?.length ?? 0;
      return { width: 320, height: 160 + fileCount * 32 };
    }
    return { width: NODE_WIDTH_COMPONENT, height: NODE_HEIGHT_COMPONENT };
  }
  if (type === "file") {
    return { width: NODE_WIDTH_FILE, height: NODE_HEIGHT_FILE };
  }
  if (type === "classNode") {
    const methodCount = (node.data as { methods?: unknown[] })?.methods?.length ?? 0;
    return {
      width: NODE_WIDTH_CLASS,
      height: NODE_HEIGHT_CLASS_BASE + methodCount * NODE_HEIGHT_CLASS_PER_METHOD,
    };
  }
  if (type === "swimLane") {
    const d = node.data as { laneWidth?: number; laneHeight?: number };
    return { width: d.laneWidth ?? 800, height: d.laneHeight ?? 120 };
  }
  if (type === "flowStep") {
    return { width: 240, height: 90 };
  }
  if (type === "stateMachineState") {
    return { width: 140, height: 60 };
  }
  if (type === "legend") {
    return { width: 210, height: 280 };
  }
  return { width: 150, height: 50 };
}
