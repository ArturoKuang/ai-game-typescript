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
const NODE_WIDTH_DEP_MODULE = 230;
const NODE_HEIGHT_DEP_MODULE = 180;

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

/** Dependency-specific layout with tuned spacing per granularity. */
export function computeDependencyLayout(
  nodes: Node[],
  edges: Edge[],
  granularity: "module" | "file" | "symbol",
): Node[] {
  const opts = {
    ...DAGRE_DEFAULTS,
    ...(granularity === "module" ? {
      rankdir: "LR" as const,
      ranksep: 300,
      nodesep: 80,
      edgesep: 50,
    } : granularity === "file" ? {
      rankdir: "LR" as const,
      ranksep: 260,
      nodesep: 60,
      edgesep: 40,
    } : {
      rankdir: "TB" as const,
      ranksep: 120,
      nodesep: 60,
      edgesep: 40,
    }),
  };
  return runDagre(nodes, edges, opts);
}

export interface GroupDef {
  id: string;
  label: string;
  color: string;
  nodeIds: Set<string>;
  subGroups?: GroupDef[];
}

/**
 * Grouped dependency layout — lays out each group independently with dagre,
 * wraps each in a boundary node, then positions groups vertically.
 * Returns the full node list (boundaries + repositioned children).
 */
export function computeGroupedDependencyLayout(
  nodes: Node[],
  edges: Edge[],
  groups: GroupDef[],
  granularity: "module" | "file" | "symbol",
): Node[] {
  const PADDING = 60;
  const HEADER = 70; // space for boundary label
  const GROUP_GAP = 80;

  const dagreOpts = {
    ...DAGRE_DEFAULTS,
    ...(granularity === "module" ? {
      rankdir: "LR" as const,
      ranksep: 300,
      nodesep: 80,
      edgesep: 50,
    } : granularity === "file" ? {
      rankdir: "LR" as const,
      ranksep: 260,
      nodesep: 60,
      edgesep: 40,
    } : {
      rankdir: "TB" as const,
      ranksep: 120,
      nodesep: 60,
      edgesep: 40,
    }),
  };

  const SUB_PADDING = 24;
  const SUB_HEADER = 40;
  const SUB_GAP = 30;

  const result: Node[] = [];
  let offsetY = 0;

  for (const group of groups) {
    const groupNodes = nodes.filter((n) => group.nodeIds.has(n.id));
    if (groupNodes.length === 0) continue;

    const groupEdges = edges.filter(
      (e) => group.nodeIds.has(e.source) && group.nodeIds.has(e.target),
    );

    // If this group has sub-groups, lay out sub-groups first
    if (group.subGroups && group.subGroups.length > 0) {
      const subBoundaryNodes: Node[] = [];
      const innerNodes: Node[] = []; // all sub-boundary + children

      let subOffsetX = 0;
      for (const sub of group.subGroups) {
        const subNodes = groupNodes.filter((n) => sub.nodeIds.has(n.id));
        if (subNodes.length === 0) continue;

        const subEdges = groupEdges.filter(
          (e) => sub.nodeIds.has(e.source) && sub.nodeIds.has(e.target),
        );

        // Sub-group internal layout: tight vertical columns
        const laid = runDagre(subNodes, subEdges, {
          rankdir: "TB",
          ranksep: 50,
          nodesep: 20,
          edgesep: 15,
          marginx: 10,
          marginy: 10,
        });
        const bounds = computeBounds(laid);
        const subWidth = bounds.maxX - bounds.minX + SUB_PADDING * 2;
        const subHeight = bounds.maxY - bounds.minY + SUB_PADDING + SUB_HEADER;

        // Create sub-boundary node (position relative to parent group, set later)
        const subBoundaryId = sub.id;
        const subBoundary: Node = {
          id: subBoundaryId,
          type: "boundary",
          position: { x: subOffsetX, y: 0 },
          data: {
            label: sub.label,
            technology: "",
            description: "",
            borderColor: sub.color,
            componentCount: subNodes.length,
          },
          width: subWidth,
          height: subHeight,
          measured: { width: subWidth, height: subHeight },
          style: { width: subWidth, height: subHeight },
          zIndex: -1,
          draggable: false,
          selectable: false,
        };
        subBoundaryNodes.push(subBoundary);

        // Position children relative to sub-boundary
        for (const child of laid) {
          innerNodes.push({
            ...child,
            parentId: subBoundaryId,
            extent: "parent" as const,
            position: {
              x: child.position.x - bounds.minX + SUB_PADDING,
              y: child.position.y - bounds.minY + SUB_HEADER,
            },
          });
        }

        subOffsetX += subWidth + SUB_GAP;
      }

      // Layout sub-boundaries with dagre to arrange them within the parent group
      const subBoundaryEdges: Edge[] = [];
      // Create edges between sub-boundaries based on cross-sub-group edges
      const subGroupMap = new Map<string, string>();
      for (const sub of group.subGroups) {
        for (const nid of sub.nodeIds) subGroupMap.set(nid, sub.id);
      }
      const subEdgeSeen = new Set<string>();
      for (const e of groupEdges) {
        const srcSub = subGroupMap.get(e.source);
        const tgtSub = subGroupMap.get(e.target);
        if (srcSub && tgtSub && srcSub !== tgtSub) {
          const key = `${srcSub}->${tgtSub}`;
          if (!subEdgeSeen.has(key)) {
            subEdgeSeen.add(key);
            subBoundaryEdges.push({ id: key, source: srcSub, target: tgtSub });
          }
        }
      }

      const laidSubBoundaries = runDagre(subBoundaryNodes, subBoundaryEdges, {
        rankdir: "TB",
        ranksep: 60,
        nodesep: 40,
        edgesep: 30,
        marginx: 20,
        marginy: 20,
      });

      // Compute parent group bounds from laid sub-boundaries
      const parentBounds = computeBounds(laidSubBoundaries);
      const groupWidth = parentBounds.maxX - parentBounds.minX + PADDING * 2;
      const groupHeight = parentBounds.maxY - parentBounds.minY + PADDING + HEADER;

      // Create parent boundary
      result.push({
        id: group.id,
        type: "boundary",
        position: { x: 0, y: offsetY },
        data: {
          label: group.label,
          technology: "",
          description: "",
          borderColor: group.color,
          componentCount: groupNodes.length,
        },
        width: groupWidth,
        height: groupHeight,
        measured: { width: groupWidth, height: groupHeight },
        style: { width: groupWidth, height: groupHeight },
        zIndex: -2,
        draggable: false,
        selectable: false,
      });

      // Position sub-boundaries relative to parent
      for (const subBound of laidSubBoundaries) {
        result.push({
          ...subBound,
          parentId: group.id,
          extent: "parent" as const,
          zIndex: -1,
          position: {
            x: subBound.position.x - parentBounds.minX + PADDING,
            y: subBound.position.y - parentBounds.minY + HEADER,
          },
        });
      }

      // Add inner nodes (children of sub-boundaries)
      for (const n of innerNodes) {
        result.push(n);
      }

      offsetY += groupHeight + GROUP_GAP;
    } else {
      // No sub-groups — flat layout (original behavior)
      const laid = runDagre(groupNodes, groupEdges, dagreOpts);
      const bounds = computeBounds(laid);
      const groupWidth = bounds.maxX - bounds.minX + PADDING * 2;
      const groupHeight = bounds.maxY - bounds.minY + PADDING + HEADER;

      result.push({
        id: group.id,
        type: "boundary",
        position: { x: 0, y: offsetY },
        data: {
          label: group.label,
          technology: "",
          description: "",
          borderColor: group.color,
          componentCount: groupNodes.length,
        },
        width: groupWidth,
        height: groupHeight,
        measured: { width: groupWidth, height: groupHeight },
        style: { width: groupWidth, height: groupHeight },
        zIndex: -1,
        draggable: false,
        selectable: false,
      });

      for (const child of laid) {
        result.push({
          ...child,
          parentId: group.id,
          extent: "parent" as const,
          position: {
            x: child.position.x - bounds.minX + PADDING,
            y: child.position.y - bounds.minY + HEADER,
          },
        });
      }

      offsetY += groupHeight + GROUP_GAP;
    }
  }

  // Any nodes not in a group get placed below
  const allGrouped = new Set(groups.flatMap((g) => [...g.nodeIds]));
  const ungrouped = nodes.filter((n) => !allGrouped.has(n.id));
  if (ungrouped.length > 0) {
    const ungroupedEdges = edges.filter(
      (e) => !allGrouped.has(e.source) || !allGrouped.has(e.target),
    ).filter(
      (e) => ungrouped.some((n) => n.id === e.source) && ungrouped.some((n) => n.id === e.target),
    );
    const laid = runDagre(ungrouped, ungroupedEdges, dagreOpts);
    for (const n of laid) {
      result.push({
        ...n,
        position: { x: n.position.x, y: n.position.y + offsetY },
      });
    }
  }

  return result;
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
  // Nodes with explicit dimensions (boundary containers, etc.) — use them directly
  if (node.width && node.height) {
    return { width: node.width, height: node.height };
  }
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
  if (type === "pillNode") {
    const nameLen = ((node.data as { label?: string })?.label ?? "").length;
    return { width: Math.max(130, 60 + nameLen * 7), height: 36 };
  }
  if (type === "dependencyModule") {
    const d = node.data as { fileCount?: number; internalEdgeCount?: number };
    const isModule = (d.fileCount ?? 0) > 0 && (d.internalEdgeCount ?? -1) >= 0;
    return { width: NODE_WIDTH_DEP_MODULE, height: isModule ? NODE_HEIGHT_DEP_MODULE : 155 };
  }
  if (type === "dataStructure") {
    const d = node.data as { previewLines?: unknown[] };
    const previewCount = Math.min((d.previewLines as unknown[])?.length ?? 0, 3);
    return { width: 256, height: 120 + previewCount * 16 };
  }
  if (type === "classNode") {
    const d = node.data as { methods?: unknown[]; fields?: unknown[]; fanIn?: number };
    const methodCount = d.methods?.length ?? 0;
    const fieldCount = d.fields?.length ?? 0;
    const hasMetrics = d.fanIn != null;
    const methodRows = Math.min(methodCount, 8);
    const fieldRows = Math.min(fieldCount, 5);
    return {
      width: NODE_WIDTH_CLASS,
      height: NODE_HEIGHT_CLASS_BASE
        + methodRows * NODE_HEIGHT_CLASS_PER_METHOD
        + (fieldRows > 0 ? 8 + fieldRows * 16 : 0)
        + (hasMetrics ? 30 : 0),
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
