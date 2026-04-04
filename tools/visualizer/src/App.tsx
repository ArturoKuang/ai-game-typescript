import { useCallback, useEffect, useMemo } from "react";
import {
  ReactFlow,
  Background,
  Controls,
  MiniMap,
  type EdgeTypes,
  type NodeTypes,
  type OnNodeClick,
  type OnEdgeClick,
  type NodeMouseHandler,
  type EdgeMouseHandler,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";

import { useStore } from "./store";
import { buildFlowGraph, applyHoverHighlight } from "./graphLoader";
import { BoundaryNode } from "./nodes/BoundaryNode";
import { ContainerCardNode } from "./nodes/ContainerCardNode";
import { ContainerRelationshipEdge } from "./edges/ContainerRelationshipEdge";
import { DataModelRelationEdge } from "./edges/DataModelRelationEdge";
import { ComponentNode } from "./nodes/ComponentNode";
import { ComponentContextContainerNode } from "./nodes/ComponentContextContainerNode";
import { DetailedComponentCardNode } from "./nodes/DetailedComponentCardNode";
import { FileNode } from "./nodes/FileNode";
import { ClassNode } from "./nodes/ClassNode";
import { SwimLaneNode } from "./nodes/SwimLaneNode";
import { FlowStepNode } from "./nodes/FlowStepNode";
import { StateMachineStateNode } from "./nodes/StateMachineStateNode";
import { LegendNode } from "./nodes/LegendNode";
import { DataStructureNode } from "./nodes/DataStructureNode";
import { DependencyModuleNode } from "./nodes/DependencyModuleNode";
import { PillNode } from "./nodes/PillNode";
import { DependencyEdge } from "./edges/DependencyEdge";
import { Sidebar } from "./Sidebar";
import type { ArchitectureGraph } from "./types";
import { useHoverSuppression } from "./useHoverSuppression";

const nodeTypes: NodeTypes = {
  boundary: BoundaryNode,
  containerCard: ContainerCardNode,
  component: ComponentNode,
  componentContextContainer: ComponentContextContainerNode,
  detailedComponentCard: DetailedComponentCardNode,
  file: FileNode,
  classNode: ClassNode,
  swimLane: SwimLaneNode,
  flowStep: FlowStepNode,
  stateMachineState: StateMachineStateNode,
  legend: LegendNode,
  dataStructure: DataStructureNode,
  dependencyModule: DependencyModuleNode,
  pillNode: PillNode,
};

const edgeTypes: EdgeTypes = {
  containerRelationship: ContainerRelationshipEdge,
  dataModelRelation: DataModelRelationEdge,
  dependencyEdge: DependencyEdge,
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
  const containerFocusEnabled = useStore((s) => s.containerFocusEnabled);
  const dataModelFocusEnabled = useStore((s) => s.dataModelFocusEnabled);
  const dataModelShowRuntimeStores = useStore((s) => s.dataModelShowRuntimeStores);
  const dataModelShowDebugStructures = useStore((s) => s.dataModelShowDebugStructures);
  const dataModelExpandMirrors = useStore((s) => s.dataModelExpandMirrors);
  const activeComponentViewId = useStore((s) => s.activeComponentViewId);
  const componentFocusEnabled = useStore((s) => s.componentFocusEnabled);
  const componentFocusDirection = useStore((s) => s.componentFocusDirection);
  const selectedFlowGroup = useStore((s) => s.selectedFlowGroup);
  const dependencyGranularity = useStore((s) => s.dependencyGranularity);
  const dependencyFocusEnabled = useStore((s) => s.dependencyFocusEnabled);
  const dependencyShowCircularOnly = useStore((s) => s.dependencyShowCircularOnly);
  const dependencyHideTypeOnly = useStore((s) => s.dependencyHideTypeOnly);
  const setGraph = useStore((s) => s.setGraph);
  const selectNode = useStore((s) => s.selectNode);
  const selectEdge = useStore((s) => s.selectEdge);
  const setHoveredNode = useStore((s) => s.setHoveredNode);
  const setHoveredEdge = useStore((s) => s.setHoveredEdge);
  const setContainerInspectorTab = useStore((s) => s.setContainerInspectorTab);
  const setDataModelInspectorTab = useStore((s) => s.setDataModelInspectorTab);
  const setComponentInspectorTab = useStore((s) => s.setComponentInspectorTab);
  const setDependencyInspectorTab = useStore((s) => s.setDependencyInspectorTab);

  useEffect(() => {
    fetch("/graph.json")
      .then((r) => r.json())
      .then((data: ArchitectureGraph) => setGraph(data))
      .catch((err) => console.error("Failed to load graph.json:", err));
  }, [setGraph]);

  // Stage 1: structural graph build (expensive — layout, grouping, filtering).
  // Does NOT depend on hover state so zooming while hovering won't rebuild.
  const baseGraph = useMemo(() => {
    if (!graph) return { nodes: [], edges: [] };
    return buildFlowGraph(
      graph,
      zoomLevel,
      expandedComponents,
      visibleCouplingTypes,
      null, // hoveredNodeId — applied in stage 2
      null, // hoveredEdgeId — applied in stage 2
      selectedNodeId,
      selectedEdgeId,
      containerFocusEnabled,
      dataModelFocusEnabled,
      dataModelShowRuntimeStores,
      dataModelShowDebugStructures,
      dataModelExpandMirrors,
      activeComponentViewId,
      componentFocusEnabled,
      componentFocusDirection,
      selectedFlow,
      selectedStateMachine,
      activeLegendKeys,
      selectedFlowGroup,
      dependencyGranularity,
      dependencyFocusEnabled,
      dependencyShowCircularOnly,
      dependencyHideTypeOnly,
    );
  }, [
    graph,
    zoomLevel,
    expandedComponents,
    visibleCouplingTypes,
    selectedNodeId,
    selectedEdgeId,
    containerFocusEnabled,
    dataModelFocusEnabled,
    dataModelShowRuntimeStores,
    dataModelShowDebugStructures,
    dataModelExpandMirrors,
    activeComponentViewId,
    componentFocusEnabled,
    componentFocusDirection,
    selectedFlow,
    selectedStateMachine,
    activeLegendKeys,
    selectedFlowGroup,
    dependencyGranularity,
    dependencyFocusEnabled,
    dependencyShowCircularOnly,
    dependencyHideTypeOnly,
  ]);

  // Stage 2: hover highlight (cheap — only touches node/edge styles).
  const { nodes, edges } = useMemo(() => {
    return applyHoverHighlight(baseGraph.nodes, baseGraph.edges, hoveredNodeId, hoveredEdgeId);
  }, [baseGraph, hoveredNodeId, hoveredEdgeId]);

  // Flow view needs a higher minZoom to keep node text readable
  const fitViewOpts = useMemo(() => {
    if (zoomLevel === "flow" && selectedFlow) {
      return { padding: 0.12, minZoom: 0.5 };
    }
    if (zoomLevel === "container" && graph?.containerDiagram) {
      return { padding: 0.08, minZoom: 0.25 };
    }
    if (zoomLevel === "dataModel") {
      return { padding: 0.08, minZoom: 0.22 };
    }
    if (zoomLevel === "dependency") {
      return { padding: 0.12, minZoom: 0.3 };
    }
    if (zoomLevel === "component" && graph?.componentDiagram) {
      return { padding: 0.1, minZoom: 0.3 };
    }
    return { padding: 0.15, minZoom: 0.35 };
  }, [graph, zoomLevel, selectedFlow]);

  const onNodeClick: OnNodeClick = useCallback(
    (_e, node) => {
      selectNode(node.id);
      if (node.type === "containerCard") {
        setContainerInspectorTab("overview");
      }
      if (node.type === "dataStructure") {
        setDataModelInspectorTab("overview");
      }
      if (node.type === "detailedComponentCard" || node.type === "boundary" || node.type === "componentContextContainer") {
        setComponentInspectorTab("overview");
      }
      if (node.type === "dependencyModule" || node.type === "pillNode") {
        setDependencyInspectorTab("overview");
      }
    },
    [selectNode, setComponentInspectorTab, setContainerInspectorTab, setDataModelInspectorTab, setDependencyInspectorTab],
  );
  const onEdgeClick: OnEdgeClick = useCallback(
    (_e, edge) => {
      selectEdge(edge.id);
      if (zoomLevel === "container") {
        setContainerInspectorTab("relationships");
        return;
      }
      if (zoomLevel === "dataModel") {
        setDataModelInspectorTab("access");
        return;
      }
      if (zoomLevel === "dependency") {
        setDependencyInspectorTab("dependencies");
        return;
      }
      setComponentInspectorTab("contract");
    },
    [selectEdge, setComponentInspectorTab, setContainerInspectorTab, setDataModelInspectorTab, setDependencyInspectorTab, zoomLevel],
  );
  const onPaneClick = useCallback(() => { selectNode(null); selectEdge(null); }, [selectNode, selectEdge]);

  // Hover suppression — prevents flashing during zoom/pan.
  const nodeHover = useHoverSuppression(setHoveredNode);
  const edgeHover = useHoverSuppression(setHoveredEdge);

  const onMoveStart = useCallback(() => { nodeHover.onMoveStart(); edgeHover.onMoveStart(); }, [nodeHover, edgeHover]);
  const onMoveEnd = useCallback(() => { nodeHover.onMoveEnd(); edgeHover.onMoveEnd(); }, [nodeHover, edgeHover]);

  const onNodeMouseEnter: NodeMouseHandler = useCallback(
    (_e, node) => {
      if (node.type === "boundary" || node.type === "legend" || node.type === "swimLane") return;
      nodeHover.enter(node.id);
    },
    [nodeHover],
  );
  const onNodeMouseLeave: NodeMouseHandler = useCallback(
    (_e, node) => {
      if (node.type === "boundary" || node.type === "legend" || node.type === "swimLane") return;
      nodeHover.leave();
    },
    [nodeHover],
  );
  const onEdgeMouseEnter: EdgeMouseHandler = useCallback(
    (_e, edge) => { edgeHover.enter(edge.id); },
    [edgeHover],
  );
  const onEdgeMouseLeave: EdgeMouseHandler = useCallback(
    () => { edgeHover.leave(); },
    [edgeHover],
  );

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
          edgeTypes={edgeTypes}
          onNodeClick={onNodeClick}
          onEdgeClick={onEdgeClick}
          onPaneClick={onPaneClick}
          onNodeMouseEnter={onNodeMouseEnter}
          onNodeMouseLeave={onNodeMouseLeave}
          onEdgeMouseEnter={onEdgeMouseEnter}
          onEdgeMouseLeave={onEdgeMouseLeave}
          onMoveStart={onMoveStart}
          onMoveEnd={onMoveEnd}
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
