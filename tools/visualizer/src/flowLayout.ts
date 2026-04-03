/**
 * Layout engine for the flow view.
 *
 * Two layout modes:
 * 1. **All flows (no selection)** — compact row-per-flow overview.
 *    Each flow is a horizontal chain in its own row. No swim-lane bands.
 *    Nodes are colored by lane. Scannable and overlap-free.
 *
 * 2. **Single flow (selected)** — full swim-lane layout.
 *    Five horizontal lanes with generous height. Steps positioned in
 *    their respective lanes. Cross-lane arrows clearly visible.
 *
 * State machine FSM diagrams are laid out with dagre below the flows.
 */
import dagre from "@dagrejs/dagre";
import type { Node, Edge } from "@xyflow/react";
import type { ArchitectureGraph, MessageFlow, StateMachine } from "./types";

// ---------------------------------------------------------------------------
// Lane metadata
// ---------------------------------------------------------------------------

const LANES = ["Client", "Network", "Engine", "NPC", "Persistence"] as const;

const LANE_COLORS: Record<string, string> = {
  Client: "#FE6100",
  Network: "#22D3EE",
  Engine: "#648FFF",
  NPC: "#DC267F",
  Persistence: "#FFB000",
};

const LANE_DESCRIPTIONS: Record<string, string> = {
  Client: "Browser (PixiJS)",
  Network: "WebSocket server",
  Engine: "Tick simulation",
  NPC: "AI orchestrator",
  Persistence: "PostgreSQL + pgvector",
};

// ---------------------------------------------------------------------------
// All-flows mode constants
// ---------------------------------------------------------------------------

const FLOW_ROW_HEIGHT = 100;
const FLOW_LABEL_WIDTH = 140;
const FLOW_NODE_WIDTH = 200;
const FLOW_NODE_HEIGHT = 68;
const FLOW_NODE_GAP_X = 30;
const FLOW_ROW_GAP = 14;

// ---------------------------------------------------------------------------
// Single-flow swim-lane constants
// ---------------------------------------------------------------------------

const LANE_HEIGHT = 180;
const LANE_GAP = 14;
const LANE_LABEL_WIDTH = 145;
const SL_NODE_WIDTH = 240;
const SL_NODE_HEIGHT = 90;
const SL_NODE_GAP_X = 55;

// ---------------------------------------------------------------------------
// State machine constants
// ---------------------------------------------------------------------------

const SM_GAP_BETWEEN = 140;
const SM_NODE_WIDTH = 140;
const SM_NODE_HEIGHT = 60;

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export function buildFlowLevel(
  graph: ArchitectureGraph,
  selectedFlow: string | null,
  selectedStateMachine: string | null,
  selectedFlowGroup?: string | null,
): { nodes: Node[]; edges: Edge[] } {
  const allNodes: Node[] = [];
  const allEdges: Edge[] = [];

  let flows = graph.messageFlows ?? [];

  // Improvement 7: filter flows by group when a group is selected
  if (selectedFlowGroup && !selectedFlow) {
    const group = (graph.messageFlowGroups ?? []).find((g) => g.id === selectedFlowGroup);
    if (group) {
      const groupTypes = new Set(group.flowTypes);
      flows = flows.filter((f) => groupTypes.has(f.clientMessageType));
    }
  }

  let contentHeight: number;

  if (selectedFlow) {
    // --- Single-flow: swim-lane layout ---
    const flow = flows.find((f) => f.clientMessageType === selectedFlow);
    if (flow) {
      const { nodes, edges, height } = buildSingleFlowLayout(flow);
      allNodes.push(...nodes);
      allEdges.push(...edges);
      contentHeight = height;
    } else {
      contentHeight = 100;
    }
  } else {
    // --- All flows: row-per-flow layout ---
    const { nodes, edges, height } = buildAllFlowsLayout(flows);
    allNodes.push(...nodes);
    allEdges.push(...edges);
    contentHeight = height;
  }

  // --- Inline legend ---
  allNodes.push(buildLegendNode(selectedFlow !== null));

  // --- State machines (below flows) — only in all-flows mode ---
  if (selectedFlow) {
    // Single-flow mode: skip state machines to keep viewport focused
    return { nodes: allNodes, edges: allEdges };
  }

  const smStartY = contentHeight + 80;

  // Section label
  if ((graph.stateMachines ?? []).length > 0) {
    const smTotalWidth = (graph.stateMachines ?? []).reduce(
      (sum, sm) => sum + sm.states.length * (SM_NODE_WIDTH + 80) + SM_GAP_BETWEEN,
      0,
    );

    allNodes.push({
      id: "sm-section-label",
      type: "swimLane",
      position: { x: 0, y: smStartY - 50 },
      data: {
        label: "State Machines",
        color: "#777",
        description: "Lifecycle diagrams",
        laneWidth: Math.max(smTotalWidth, 600),
        laneHeight: 40,
      },
      selectable: false,
      draggable: false,
      style: { zIndex: -2 },
      width: Math.max(smTotalWidth, 600),
      height: 40,
      measured: { width: Math.max(smTotalWidth, 600), height: 40 },
    });
  }

  let smOffsetX = 40;
  for (const sm of graph.stateMachines ?? []) {
    const { nodes: smNodes, edges: smEdges, width: smWidth } = buildStateMachineGraph(
      sm,
      smOffsetX,
      smStartY,
      selectedStateMachine,
    );
    allNodes.push(...smNodes);
    allEdges.push(...smEdges);
    smOffsetX += smWidth + SM_GAP_BETWEEN;
  }

  return { nodes: allNodes, edges: allEdges };
}

// =====================================================================
// ALL FLOWS — row-per-flow compact overview
// =====================================================================

function buildAllFlowsLayout(flows: MessageFlow[]): {
  nodes: Node[];
  edges: Edge[];
  height: number;
} {
  const nodes: Node[] = [];
  const edges: Edge[] = [];

  // Sort flows: conversation flows together, movement flows together, etc.
  const sortedFlows = [...flows].sort((a, b) => {
    const order = [
      "join", "input_start", "input_stop", "move", "move_direction",
      "start_convo", "accept_convo", "decline_convo", "say", "end_convo", "ping",
    ];
    return (order.indexOf(a.clientMessageType) ?? 99) - (order.indexOf(b.clientMessageType) ?? 99);
  });

  for (let fi = 0; fi < sortedFlows.length; fi++) {
    const flow = sortedFlows[fi];
    const rowY = fi * (FLOW_ROW_HEIGHT + FLOW_ROW_GAP);

    // --- Flow label node (left side) ---
    nodes.push({
      id: `flowrow-${flow.clientMessageType}-label`,
      type: "flowStep",
      position: { x: 0, y: rowY + (FLOW_ROW_HEIGHT - FLOW_NODE_HEIGHT) / 2 },
      data: {
        action: flow.description,
        method: "",
        laneColor: "#648FFF",
        isFirst: true,
        flowLabel: flow.clientMessageType,
      },
      width: FLOW_LABEL_WIDTH,
      height: FLOW_NODE_HEIGHT,
      measured: { width: FLOW_LABEL_WIDTH, height: FLOW_NODE_HEIGHT },
    });

    // --- Step nodes ---
    for (let si = 0; si < flow.steps.length; si++) {
      const step = flow.steps[si];
      const laneColor = LANE_COLORS[step.lane] ?? "#888";
      const x = FLOW_LABEL_WIDTH + 30 + si * (FLOW_NODE_WIDTH + FLOW_NODE_GAP_X);
      const y = rowY + (FLOW_ROW_HEIGHT - FLOW_NODE_HEIGHT) / 2;

      const nodeId = `flowrow-${flow.clientMessageType}-step-${si}`;
      nodes.push({
        id: nodeId,
        type: "flowStep",
        position: { x, y },
        data: {
          action: step.action,
          method: step.method,
          produces: step.produces,
          producesKind: step.producesKind,
          laneColor,
          fileId: step.fileId,
          line: step.line,
          stepIndex: si,
          flowType: flow.clientMessageType,
          errorPaths: step.errorPaths,
          stateTransition: step.stateTransition,
          dataShape: step.dataShape,
        },
        width: FLOW_NODE_WIDTH,
        height: FLOW_NODE_HEIGHT,
        measured: { width: FLOW_NODE_WIDTH, height: FLOW_NODE_HEIGHT },
      });

      // Edge from previous step (or from label)
      const sourceId = si === 0
        ? `flowrow-${flow.clientMessageType}-label`
        : `flowrow-${flow.clientMessageType}-step-${si - 1}`;

      const prevLane = si === 0 ? "Client" : flow.steps[si - 1].lane;
      const crossesLane = prevLane !== step.lane;
      const strokeColor = crossesLane ? laneColor : "#444";

      edges.push({
        id: `flowrowedge-${flow.clientMessageType}-${si}`,
        source: sourceId,
        target: nodeId,
        type: "bezier",
        style: {
          stroke: strokeColor,
          strokeWidth: crossesLane ? 2 : 1.2,
          strokeDasharray: crossesLane ? undefined : "6 3",
          opacity: 0.6,
        },
        markerEnd: {
          type: "arrowclosed" as const,
          color: strokeColor,
          width: 10,
          height: 8,
        },
      });
    }

    // --- Row background stripe (subtle) ---
    const totalRowWidth = FLOW_LABEL_WIDTH + 30 + flow.steps.length * (FLOW_NODE_WIDTH + FLOW_NODE_GAP_X);
    nodes.push({
      id: `flowrow-bg-${flow.clientMessageType}`,
      type: "swimLane",
      position: { x: -10, y: rowY },
      data: {
        label: "",
        color: fi % 2 === 0 ? "#ffffff" : "#000000",
        description: "",
        laneWidth: totalRowWidth + 40,
        laneHeight: FLOW_ROW_HEIGHT,
      },
      selectable: false,
      draggable: false,
      style: { zIndex: -3 },
      width: totalRowWidth + 40,
      height: FLOW_ROW_HEIGHT,
      measured: { width: totalRowWidth + 40, height: FLOW_ROW_HEIGHT },
    });
  }

  const height = sortedFlows.length * (FLOW_ROW_HEIGHT + FLOW_ROW_GAP);
  return { nodes, edges, height };
}

// =====================================================================
// SINGLE FLOW — swim-lane layout
// =====================================================================

function buildSingleFlowLayout(flow: MessageFlow): {
  nodes: Node[];
  edges: Edge[];
  height: number;
} {
  const nodes: Node[] = [];
  const edges: Edge[] = [];

  // Only show lanes the flow actually uses
  const usedLanes = LANES.filter((lane) =>
    flow.steps.some((step) => step.lane === lane),
  );

  // Compute width from step count
  const totalWidth = LANE_LABEL_WIDTH + 40 + flow.steps.length * (SL_NODE_WIDTH + SL_NODE_GAP_X) + 80;

  // Lane Y positions — only used lanes
  const laneY: Record<string, number> = {};
  for (let i = 0; i < usedLanes.length; i++) {
    const lane = usedLanes[i];
    const y = i * (LANE_HEIGHT + LANE_GAP);
    laneY[lane] = y;

    // Swim lane background
    nodes.push({
      id: `lane-${lane}`,
      type: "swimLane",
      position: { x: 0, y },
      data: {
        label: lane,
        color: LANE_COLORS[lane],
        description: LANE_DESCRIPTIONS[lane],
        laneWidth: totalWidth,
        laneHeight: LANE_HEIGHT,
      },
      selectable: false,
      draggable: false,
      style: { zIndex: -2 },
      width: totalWidth,
      height: LANE_HEIGHT,
      measured: { width: totalWidth, height: LANE_HEIGHT },
    });
  }

  // --- Step nodes ---
  for (let i = 0; i < flow.steps.length; i++) {
    const step = flow.steps[i];
    const lane = step.lane;
    const laneColor = LANE_COLORS[lane] ?? "#888";

    const x = LANE_LABEL_WIDTH + 40 + i * (SL_NODE_WIDTH + SL_NODE_GAP_X);
    const y = (laneY[lane] ?? 0) + (LANE_HEIGHT - SL_NODE_HEIGHT) / 2;

    const nodeId = `flow-step-${i}`;
    nodes.push({
      id: nodeId,
      type: "flowStep",
      position: { x, y },
      data: {
        action: step.action,
        method: step.method,
        produces: step.produces,
        producesKind: step.producesKind,
        laneColor,
        isFirst: i === 0,
        isLast: i === flow.steps.length - 1,
        flowLabel: i === 0 ? flow.clientMessageType : undefined,
        fileId: step.fileId,
        line: step.line,
        stepIndex: i,
        flowType: flow.clientMessageType,
        errorPaths: step.errorPaths,
        stateTransition: step.stateTransition,
        dataShape: step.dataShape,
      },
      width: SL_NODE_WIDTH,
      height: SL_NODE_HEIGHT,
      measured: { width: SL_NODE_WIDTH, height: SL_NODE_HEIGHT },
    });

    // Edge from previous step
    if (i > 0) {
      const prevStep = flow.steps[i - 1];
      const crossesLane = prevStep.lane !== step.lane;
      const strokeColor = crossesLane ? laneColor : `${laneColor}60`;

      edges.push({
        id: `flowedge-${i}`,
        source: `flow-step-${i - 1}`,
        target: nodeId,
        type: "bezier",
        style: {
          stroke: strokeColor,
          strokeWidth: crossesLane ? 2.5 : 1.5,
          strokeDasharray: crossesLane ? undefined : "8 4",
          opacity: crossesLane ? 0.85 : 0.5,
        },
        markerEnd: {
          type: "arrowclosed" as const,
          color: strokeColor,
          width: 14,
          height: 10,
        },
        label: crossesLane && prevStep.produces ? prevStep.produces : undefined,
        labelStyle: crossesLane && prevStep.produces
          ? { fill: strokeColor, fontSize: 10, fontWeight: 600, fontFamily: "monospace" }
          : undefined,
        labelBgStyle: crossesLane && prevStep.produces
          ? { fill: "#0a0a14", fillOpacity: 0.92, rx: 5, ry: 5 }
          : undefined,
        labelBgPadding: [5, 3] as [number, number],
      });
    }
  }

  const height = usedLanes.length * (LANE_HEIGHT + LANE_GAP);
  return { nodes, edges, height };
}

// =====================================================================
// STATE MACHINE — dagre FSM sub-graph
// =====================================================================

function buildStateMachineGraph(
  sm: StateMachine,
  offsetX: number,
  offsetY: number,
  selectedStateMachine: string | null,
): { nodes: Node[]; edges: Edge[]; width: number; height: number } {
  const dimmed = selectedStateMachine !== null && selectedStateMachine !== sm.id;
  const nodes: Node[] = [];
  const edges: Edge[] = [];

  // Use dagre for FSM layout
  const g = new dagre.graphlib.Graph();
  g.setDefaultEdgeLabel(() => ({}));
  g.setGraph({ rankdir: "LR", ranksep: 100, nodesep: 50, marginx: 30, marginy: 30 });

  for (const state of sm.states) {
    g.setNode(state.id, { width: SM_NODE_WIDTH, height: SM_NODE_HEIGHT });
  }

  for (const t of sm.transitions) {
    if (g.hasNode(t.from) && g.hasNode(t.to)) {
      g.setEdge(t.from, t.to);
    }
  }

  dagre.layout(g);

  const gGraph = g.graph();
  const graphWidth = (gGraph.width ?? 300) + 60;
  const graphHeight = (gGraph.height ?? 200) + 60;

  // Title node
  nodes.push({
    id: `sm-title-${sm.id}`,
    type: "swimLane",
    position: { x: offsetX, y: offsetY },
    data: {
      label: sm.label,
      color: "#aaa",
      description: "",
      laneWidth: graphWidth,
      laneHeight: 34,
    },
    selectable: false,
    draggable: false,
    style: { zIndex: -2, opacity: dimmed ? 0.15 : 1 },
    width: graphWidth,
    height: 34,
    measured: { width: graphWidth, height: 34 },
  });

  // State nodes
  const stateYOffset = offsetY + 44;
  for (const state of sm.states) {
    const pos = g.node(state.id);
    if (!pos) continue;

    nodes.push({
      id: `sm-${sm.id}-${state.id}`,
      type: "stateMachineState",
      position: {
        x: offsetX + pos.x - SM_NODE_WIDTH / 2,
        y: stateYOffset + pos.y - SM_NODE_HEIGHT / 2,
      },
      data: {
        label: state.label,
        color: state.color ?? "#888",
        isInitial: state.isInitial,
        isTerminal: state.isTerminal,
        dimmed,
      },
      width: SM_NODE_WIDTH,
      height: SM_NODE_HEIGHT,
      measured: { width: SM_NODE_WIDTH, height: SM_NODE_HEIGHT },
    });
  }

  // Deduplicate transitions (multiple from->to get merged labels)
  const transitionMap = new Map<string, { from: string; to: string; triggers: string[] }>();
  for (const t of sm.transitions) {
    const key = `${t.from}->${t.to}`;
    if (!transitionMap.has(key)) {
      transitionMap.set(key, { from: t.from, to: t.to, triggers: [] });
    }
    transitionMap.get(key)!.triggers.push(t.trigger);
  }

  for (const [key, t] of transitionMap) {
    const fromState = sm.states.find((s) => s.id === t.from);
    const toState = sm.states.find((s) => s.id === t.to);
    const edgeColor = toState?.color ?? fromState?.color ?? "#888";

    const label = t.triggers.length <= 2
      ? t.triggers.join("\n")
      : `${t.triggers[0]}\n+${t.triggers.length - 1} more`;

    edges.push({
      id: `sm-edge-${sm.id}-${key}`,
      source: `sm-${sm.id}-${t.from}`,
      target: `sm-${sm.id}-${t.to}`,
      type: "bezier",
      style: {
        stroke: edgeColor,
        strokeWidth: 1.5,
        opacity: dimmed ? 0.12 : 0.7,
      },
      markerEnd: {
        type: "arrowclosed" as const,
        color: edgeColor,
        width: 12,
        height: 9,
      },
      label,
      labelStyle: {
        fill: "#bbb",
        fontSize: 9,
        fontWeight: 500,
        fontFamily: "inherit",
      },
      labelBgStyle: { fill: "#0d0d1a", fillOpacity: 0.92, rx: 5, ry: 5 },
      labelBgPadding: [6, 3] as [number, number],
    });
  }

  return { nodes, edges, width: graphWidth, height: graphHeight + 50 };
}

// =====================================================================
// INLINE LEGEND — placed on the canvas
// =====================================================================

function buildLegendNode(isSingleFlow: boolean): Node {
  // Position in the top-right area, offset so it doesn't overlap swim lanes
  const x = isSingleFlow ? -220 : -230;
  const y = 0;

  return {
    id: "flow-legend",
    type: "legend",
    position: { x, y },
    data: {
      title: "Legend",
      sections: [
        {
          title: "Components (node border color)",
          entries: [
            { color: LANE_COLORS.Client, label: "Client", legendKey: "Client" },
            { color: LANE_COLORS.Network, label: "Network", legendKey: "Network" },
            { color: LANE_COLORS.Engine, label: "Engine", legendKey: "Engine" },
            { color: LANE_COLORS.NPC, label: "NPC", legendKey: "NPC" },
            { color: LANE_COLORS.Persistence, label: "Persistence", legendKey: "Persistence" },
          ],
        },
        {
          title: "Badges (production type)",
          entries: [
            { color: "#DC267F", label: "CMD  Command enqueued", legendKey: "CMD", dash: "3 3" },
            { color: "#648FFF", label: "EVT  Engine event emitted", legendKey: "EVT", dash: "8 4" },
            { color: "#22D3EE", label: "MSG  Server message sent", legendKey: "MSG" },
            { color: "#94a3b8", label: "CALL  Direct function call", legendKey: "CALL" },
          ],
        },
      ],
    },
    selectable: false,
    draggable: true,
    width: 210,
    height: 280,
    measured: { width: 210, height: 280 },
  };
}
