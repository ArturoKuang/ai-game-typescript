import { create } from "zustand";
import type { ArchitectureGraph, ZoomLevel, BoundaryEdge, Component, FileNode, ClassInfo } from "./types";

export type CouplingFilter = "event" | "call" | "mutation";
export type ComponentInspectorTab = "overview" | "contract" | "internals" | "evidence" | "open_next";
export type ComponentFocusDirection = "inbound" | "outbound" | "both";
export type ContainerInspectorTab = "overview" | "relationships" | "ownership" | "changes" | "evidence";
export type DataModelInspectorTab = "overview" | "shape" | "access" | "evidence" | "open_next";
export type DependencyInspectorTab = "overview" | "dependencies" | "metrics" | "cycles";
export type DependencyGranularity = "module" | "file" | "symbol";

interface StoreState {
  graph: ArchitectureGraph | null;
  zoomLevel: ZoomLevel;
  expandedComponents: Set<string>;
  selectedNodeId: string | null;
  selectedEdgeId: string | null;

  // Hover state — drives the dim/highlight effect
  hoveredNodeId: string | null;
  hoveredEdgeId: string | null;

  // Edge filtering
  visibleCouplingTypes: Set<CouplingFilter>;

  // Flow view state
  selectedFlow: string | null;
  selectedStateMachine: string | null;

  // Legend filter — click to toggle (multi-select), highlights matching nodes
  activeLegendKeys: Set<string>;

  // Flow step selection (cross-reference panel)
  selectedFlowStep: number | null;

  // Flow group selection
  selectedFlowGroup: string | null;

  // Container tab state
  containerInspectorTab: ContainerInspectorTab;
  containerFocusEnabled: boolean;
  containerSearchQuery: string;

  // Data Model tab state
  dataModelInspectorTab: DataModelInspectorTab;
  dataModelFocusEnabled: boolean;
  dataModelSearchQuery: string;
  dataModelShowRuntimeStores: boolean;
  dataModelShowDebugStructures: boolean;
  dataModelExpandMirrors: boolean;

  // Dependency tab state
  dependencyInspectorTab: DependencyInspectorTab;
  dependencyGranularity: DependencyGranularity;
  dependencyFocusEnabled: boolean;
  dependencySearchQuery: string;
  dependencyShowCircularOnly: boolean;
  dependencyHideTypeOnly: boolean;

  // Component tab state
  componentInspectorTab: ComponentInspectorTab;
  activeComponentViewId: string | null;
  componentFocusEnabled: boolean;
  componentFocusDirection: ComponentFocusDirection;
  componentSearchQuery: string;
  highlightedEvidenceId: string | null;

  setGraph: (g: ArchitectureGraph) => void;
  setZoomLevel: (level: ZoomLevel) => void;
  toggleExpanded: (componentId: string) => void;
  selectNode: (id: string | null) => void;
  selectEdge: (id: string | null) => void;
  setHoveredNode: (id: string | null) => void;
  setHoveredEdge: (id: string | null) => void;
  toggleCouplingFilter: (type: CouplingFilter) => void;
  setSelectedFlow: (id: string | null) => void;
  setSelectedStateMachine: (id: string | null) => void;
  toggleLegendKey: (key: string) => void;
  clearLegendKeys: () => void;
  setSelectedFlowStep: (step: number | null) => void;
  setSelectedFlowGroup: (id: string | null) => void;
  setContainerInspectorTab: (tab: ContainerInspectorTab) => void;
  toggleContainerFocus: () => void;
  setContainerSearchQuery: (query: string) => void;
  setDataModelInspectorTab: (tab: DataModelInspectorTab) => void;
  toggleDataModelFocus: () => void;
  setDataModelSearchQuery: (query: string) => void;
  toggleDataModelShowRuntimeStores: () => void;
  toggleDataModelShowDebugStructures: () => void;
  toggleDataModelExpandMirrors: () => void;
  setDependencyInspectorTab: (tab: DependencyInspectorTab) => void;
  setDependencyGranularity: (g: DependencyGranularity) => void;
  toggleDependencyFocus: () => void;
  setDependencySearchQuery: (query: string) => void;
  toggleDependencyShowCircularOnly: () => void;
  toggleDependencyHideTypeOnly: () => void;
  setComponentInspectorTab: (tab: ComponentInspectorTab) => void;
  setActiveComponentView: (viewId: string | null) => void;
  toggleComponentFocus: () => void;
  setComponentFocusDirection: (direction: ComponentFocusDirection) => void;
  setComponentSearchQuery: (query: string) => void;
  setHighlightedEvidenceId: (id: string | null) => void;

  // Derived lookups
  getComponent: (id: string) => Component | undefined;
  getFile: (id: string) => FileNode | undefined;
  getClass: (id: string) => ClassInfo | undefined;
  getBoundary: (source: string, target: string) => BoundaryEdge | undefined;
}

export const useStore = create<StoreState>((set, get) => ({
  graph: null,
  zoomLevel: "container",
  expandedComponents: new Set<string>(),
  selectedNodeId: null,
  selectedEdgeId: null,
  hoveredNodeId: null,
  hoveredEdgeId: null,
  visibleCouplingTypes: new Set<CouplingFilter>(["event", "call", "mutation"]),
  selectedFlow: null,
  selectedStateMachine: null,
  activeLegendKeys: new Set<string>(),
  selectedFlowStep: null,
  selectedFlowGroup: null,
  containerInspectorTab: "overview",
  containerFocusEnabled: true,
  containerSearchQuery: "",
  dataModelInspectorTab: "overview",
  dataModelFocusEnabled: true,
  dataModelSearchQuery: "",
  dataModelShowRuntimeStores: false,
  dataModelShowDebugStructures: false,
  dataModelExpandMirrors: false,
  dependencyInspectorTab: "overview",
  dependencyGranularity: "file",
  dependencyFocusEnabled: true,
  dependencySearchQuery: "",
  dependencyShowCircularOnly: false,
  dependencyHideTypeOnly: true,
  componentInspectorTab: "overview",
  activeComponentViewId: null,
  componentFocusEnabled: true,
  componentFocusDirection: "both",
  componentSearchQuery: "",
  highlightedEvidenceId: null,

  setGraph: (graph) => set((state) => ({
    graph,
    activeComponentViewId: state.activeComponentViewId ?? graph.componentDiagram?.defaultViewId ?? null,
  })),
  setZoomLevel: (zoomLevel) =>
    set({
      zoomLevel,
      selectedFlow: null,
      selectedStateMachine: null,
      activeLegendKeys: new Set(),
      highlightedEvidenceId: null,
    }),
  toggleExpanded: (componentId) =>
    set((state) => {
      const next = new Set(state.expandedComponents);
      if (next.has(componentId)) next.delete(componentId);
      else next.add(componentId);
      return { expandedComponents: next };
    }),
  selectNode: (id) => set((state) => ({
    selectedNodeId: id,
    selectedEdgeId: null,
    highlightedEvidenceId: null,
    activeComponentViewId: id ? resolveComponentViewId(state.graph, id) ?? state.activeComponentViewId : state.activeComponentViewId,
  })),
  selectEdge: (id) => set((state) => ({
    selectedEdgeId: id,
    selectedNodeId: null,
    highlightedEvidenceId: null,
    activeComponentViewId: id ? resolveComponentViewId(state.graph, id) ?? state.activeComponentViewId : state.activeComponentViewId,
  })),
  setHoveredNode: (id) => set({ hoveredNodeId: id }),
  setHoveredEdge: (id) => set({ hoveredEdgeId: id }),
  toggleCouplingFilter: (type) =>
    set((state) => {
      const next = new Set(state.visibleCouplingTypes);
      if (next.has(type)) next.delete(type);
      else next.add(type);
      return { visibleCouplingTypes: next };
    }),
  setSelectedFlow: (id) => set({ selectedFlow: id, activeLegendKeys: new Set(), selectedFlowStep: null }),
  setSelectedStateMachine: (id) => set({ selectedStateMachine: id }),
  toggleLegendKey: (key) =>
    set((state) => {
      const next = new Set(state.activeLegendKeys);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return { activeLegendKeys: next };
    }),
  clearLegendKeys: () => set({ activeLegendKeys: new Set() }),
  setSelectedFlowStep: (selectedFlowStep) => set({ selectedFlowStep }),
  setSelectedFlowGroup: (selectedFlowGroup) => set({ selectedFlowGroup }),
  setContainerInspectorTab: (containerInspectorTab) => set({ containerInspectorTab }),
  toggleContainerFocus: () =>
    set((state) => ({ containerFocusEnabled: !state.containerFocusEnabled })),
  setContainerSearchQuery: (containerSearchQuery) => set({ containerSearchQuery }),
  setDataModelInspectorTab: (dataModelInspectorTab) => set({ dataModelInspectorTab }),
  toggleDataModelFocus: () =>
    set((state) => ({ dataModelFocusEnabled: !state.dataModelFocusEnabled })),
  setDataModelSearchQuery: (dataModelSearchQuery) => set({ dataModelSearchQuery }),
  toggleDataModelShowRuntimeStores: () =>
    set((state) => ({ dataModelShowRuntimeStores: !state.dataModelShowRuntimeStores })),
  toggleDataModelShowDebugStructures: () =>
    set((state) => ({ dataModelShowDebugStructures: !state.dataModelShowDebugStructures })),
  toggleDataModelExpandMirrors: () =>
    set((state) => ({ dataModelExpandMirrors: !state.dataModelExpandMirrors })),
  setDependencyInspectorTab: (dependencyInspectorTab) => set({ dependencyInspectorTab }),
  setDependencyGranularity: (dependencyGranularity) => set({ dependencyGranularity, selectedNodeId: null, selectedEdgeId: null }),
  toggleDependencyFocus: () =>
    set((state) => ({ dependencyFocusEnabled: !state.dependencyFocusEnabled })),
  setDependencySearchQuery: (dependencySearchQuery) => set({ dependencySearchQuery }),
  toggleDependencyShowCircularOnly: () =>
    set((state) => ({ dependencyShowCircularOnly: !state.dependencyShowCircularOnly })),
  toggleDependencyHideTypeOnly: () =>
    set((state) => ({ dependencyHideTypeOnly: !state.dependencyHideTypeOnly })),
  setComponentInspectorTab: (componentInspectorTab) => set({ componentInspectorTab }),
  setActiveComponentView: (activeComponentViewId) =>
    set((state) => ({
      activeComponentViewId,
      selectedNodeId:
        state.selectedNodeId && activeComponentViewId && resolveComponentViewId(state.graph, state.selectedNodeId) === activeComponentViewId
          ? state.selectedNodeId
          : null,
      selectedEdgeId:
        state.selectedEdgeId && activeComponentViewId && resolveComponentViewId(state.graph, state.selectedEdgeId) === activeComponentViewId
          ? state.selectedEdgeId
          : null,
      highlightedEvidenceId: null,
    })),
  toggleComponentFocus: () =>
    set((state) => ({ componentFocusEnabled: !state.componentFocusEnabled })),
  setComponentFocusDirection: (componentFocusDirection) => set({ componentFocusDirection }),
  setComponentSearchQuery: (componentSearchQuery) => set({ componentSearchQuery }),
  setHighlightedEvidenceId: (highlightedEvidenceId) => set({ highlightedEvidenceId }),

  getComponent: (id) => get().graph?.components.find((c) => c.id === id),
  getFile: (id) => get().graph?.files.find((f) => f.id === id),
  getClass: (id) => get().graph?.classes.find((c) => c.id === id),
  getBoundary: (source, target) =>
    get().graph?.boundaries.find((b) => b.source === source && b.target === target),
}));

function resolveComponentViewId(graph: ArchitectureGraph | null, nodeOrEdgeId: string): string | null {
  if (!graph?.componentDiagram) return null;

  const system = graph.componentDiagram.systems.find((item) => item.id === nodeOrEdgeId);
  if (system) return system.viewId;

  const boundary = graph.componentDiagram.boundaries.find((item) => item.id === nodeOrEdgeId);
  if (boundary) return boundary.viewId;

  const container = graph.componentDiagram.containers.find((item) => item.id === nodeOrEdgeId);
  if (container) return container.viewId;

  const card = graph.componentDiagram.cards.find((item) => item.id === nodeOrEdgeId);
  if (card) return card.viewId;

  const edge = graph.componentDiagram.edges.find((item) => item.id === nodeOrEdgeId);
  if (edge) return edge.viewId;

  return null;
}
