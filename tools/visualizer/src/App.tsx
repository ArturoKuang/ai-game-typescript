import { useCallback, useEffect, useMemo } from "react";
import {
  ReactFlow,
  Background,
  Controls,
  MiniMap,
  type NodeTypes,
  type OnNodeClick,
  type OnEdgeClick,
  type NodeMouseHandler,
  type EdgeMouseHandler,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";

import { useStore } from "./store";
import { buildFlowGraph } from "./graphLoader";
import { BoundaryNode } from "./nodes/BoundaryNode";
import { ComponentNode } from "./nodes/ComponentNode";
import { DetailedComponentCardNode } from "./nodes/DetailedComponentCardNode";
import { FileNode } from "./nodes/FileNode";
import { ClassNode } from "./nodes/ClassNode";
import { SwimLaneNode } from "./nodes/SwimLaneNode";
import { FlowStepNode } from "./nodes/FlowStepNode";
import { StateMachineStateNode } from "./nodes/StateMachineStateNode";
import { LegendNode } from "./nodes/LegendNode";
import { Sidebar } from "./Sidebar";
import type { ArchitectureGraph } from "./types";

const nodeTypes: NodeTypes = {
  boundary: BoundaryNode,
  component: ComponentNode,
  detailedComponentCard: DetailedComponentCardNode,
  file: FileNode,
  classNode: ClassNode,
  swimLane: SwimLaneNode,
  flowStep: FlowStepNode,
  stateMachineState: StateMachineStateNode,
  legend: LegendNode,
};

export function App() {
  const graph = useStore((s) => s.graph);
  const zoomLevel = useStore((s) => s.zoomLevel);
  const expandedComponents = useStore((s) => s.expandedComponents);
  const visibleCouplingTypes = useStore((s) => s.visibleCouplingTypes);
  const hoveredNodeId = useStore((s) => s.hoveredNodeId);
  const hoveredEdgeId = useStore((s) => s.hoveredEdgeId);
  const selectedNodeId = useStore((s) => s.selectedNodeId);
  const selectedEdgeId = useStore((s) => s.selectedEdgeId);
  const selectedFlow = useStore((s) => s.selectedFlow);
  const selectedStateMachine = useStore((s) => s.selectedStateMachine);
  const activeLegendKeys = useStore((s) => s.activeLegendKeys);
  const componentFocusEnabled = useStore((s) => s.componentFocusEnabled);
  const componentFocusDirection = useStore((s) => s.componentFocusDirection);
  const selectedFlowGroup = useStore((s) => s.selectedFlowGroup);
  const setGraph = useStore((s) => s.setGraph);
  const selectNode = useStore((s) => s.selectNode);
  const selectEdge = useStore((s) => s.selectEdge);
  const setHoveredNode = useStore((s) => s.setHoveredNode);
  const setHoveredEdge = useStore((s) => s.setHoveredEdge);
  const setComponentInspectorTab = useStore((s) => s.setComponentInspectorTab);

  useEffect(() => {
    fetch("/graph.json")
      .then((r) => r.json())
      .then((data: ArchitectureGraph) => setGraph(data))
      .catch((err) => console.error("Failed to load graph.json:", err));
  }, [setGraph]);

  const { nodes, edges } = useMemo(() => {
    if (!graph) return { nodes: [], edges: [] };
    return buildFlowGraph(
      graph,
      zoomLevel,
      expandedComponents,
      visibleCouplingTypes,
      hoveredNodeId,
      hoveredEdgeId,
      selectedNodeId,
      selectedEdgeId,
      componentFocusEnabled,
      componentFocusDirection,
      selectedFlow,
      selectedStateMachine,
      activeLegendKeys,
      selectedFlowGroup,
    );
  }, [
    graph,
    zoomLevel,
    expandedComponents,
    visibleCouplingTypes,
    hoveredNodeId,
    hoveredEdgeId,
    selectedNodeId,
    selectedEdgeId,
    componentFocusEnabled,
    componentFocusDirection,
    selectedFlow,
    selectedStateMachine,
    activeLegendKeys,
    selectedFlowGroup,
  ]);

  // Flow view needs a higher minZoom to keep node text readable
  const fitViewOpts = useMemo(() => {
    if (zoomLevel === "flow" && selectedFlow) {
      return { padding: 0.12, minZoom: 0.5 };
    }
    if (zoomLevel === "component" && graph?.componentDiagram) {
      return { padding: 0.1, minZoom: 0.3 };
    }
    return { padding: 0.15, minZoom: 0.35 };
  }, [graph, zoomLevel, selectedFlow]);

  const onNodeClick: OnNodeClick = useCallback(
    (_e, node) => {
      selectNode(node.id);
      if (node.type === "detailedComponentCard" || node.type === "boundary") {
        setComponentInspectorTab("overview");
      }
    },
    [selectNode, setComponentInspectorTab],
  );
  const onEdgeClick: OnEdgeClick = useCallback(
    (_e, edge) => {
      selectEdge(edge.id);
      setComponentInspectorTab("contract");
    },
    [selectEdge, setComponentInspectorTab],
  );
  const onPaneClick = useCallback(() => { selectNode(null); selectEdge(null); }, [selectNode, selectEdge]);

  const onNodeMouseEnter: NodeMouseHandler = useCallback(
    (_e, node) => {
      if (node.type === "boundary" || node.type === "legend" || node.type === "swimLane") return;
      setHoveredNode(node.id);
    },
    [setHoveredNode],
  );
  const onNodeMouseLeave: NodeMouseHandler = useCallback(
    (_e, node) => {
      if (node.type === "boundary" || node.type === "legend" || node.type === "swimLane") return;
      setHoveredNode(null);
    },
    [setHoveredNode],
  );
  const onEdgeMouseEnter: EdgeMouseHandler = useCallback((_e, edge) => setHoveredEdge(edge.id), [setHoveredEdge]);
  const onEdgeMouseLeave: EdgeMouseHandler = useCallback(() => setHoveredEdge(null), [setHoveredEdge]);

  const clearLegendKeys = useStore((s) => s.clearLegendKeys);

  // Escape clears all hover and selection state
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setHoveredNode(null);
        setHoveredEdge(null);
        selectNode(null);
        selectEdge(null);
        clearLegendKeys();
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [setHoveredNode, setHoveredEdge, selectNode, selectEdge, clearLegendKeys]);

  return (
    <div style={{ display: "flex", width: "100%", height: "100%", background: "#0a0a14" }}>
      <div style={{ flex: 1, position: "relative" }}>
        <ReactFlow
          key={`${graph?.meta.extractedAt ?? "loading"}-${zoomLevel}-${selectedFlow ?? "all"}`}
          nodes={nodes}
          edges={edges}
          nodeTypes={nodeTypes}
          onNodeClick={onNodeClick}
          onEdgeClick={onEdgeClick}
          onPaneClick={onPaneClick}
          onNodeMouseEnter={onNodeMouseEnter}
          onNodeMouseLeave={onNodeMouseLeave}
          onEdgeMouseEnter={onEdgeMouseEnter}
          onEdgeMouseLeave={onEdgeMouseLeave}
          fitView
          fitViewOptions={fitViewOpts}
          minZoom={0.08}
          maxZoom={2.5}
          defaultEdgeOptions={{ type: "bezier" }}
          proOptions={{ hideAttribution: true }}
        >
          <Background color="#1a1a2e" gap={20} size={1} />
          <Controls
            position="bottom-left"
            style={{ background: "#1a1a2e", border: "1px solid #333", borderRadius: 8 }}
          />
          <MiniMap
            position="bottom-right"
            style={{
              background: "#252545",
              border: "2px solid #666",
              borderRadius: 10,
              width: 240,
              height: 170,
            }}
            nodeColor={(node) => {
              const d = node.data as Record<string, unknown>;
              // Hide boundary containers — they're huge and cover everything
              if (node.type === "boundary") return "transparent";
              // Bright fills for component nodes
              if (d?.color) return d.color as string;
              if (d?.accentColor) return d.accentColor as string;
              if (d?.componentColor) return d.componentColor as string;
              return "#aaaacc";
            }}
            nodeStrokeColor={(node) => {
              if (node.type === "boundary") return "transparent";
              return "#ffffff";
            }}
            nodeStrokeWidth={2}
            maskColor="rgba(0,0,0,0.3)"
            zoomable
            pannable
          />
        </ReactFlow>
      </div>
      <Sidebar />
    </div>
  );
}
