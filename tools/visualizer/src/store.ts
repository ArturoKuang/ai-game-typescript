import { create } from "zustand";
import type { ArchitectureGraph, ZoomLevel, BoundaryEdge, Component, FileNode, ClassInfo } from "./types";

export type CouplingFilter = "event" | "call" | "mutation";
export type ComponentInspectorTab = "overview" | "contract" | "internals" | "evidence" | "open_next";
export type ComponentFocusDirection = "inbound" | "outbound" | "both";

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

  // Component tab state
  componentInspectorTab: ComponentInspectorTab;
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
  setComponentInspectorTab: (tab: ComponentInspectorTab) => void;
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
  zoomLevel: "component",
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
  componentInspectorTab: "overview",
  componentFocusEnabled: true,
  componentFocusDirection: "both",
  componentSearchQuery: "",
  highlightedEvidenceId: null,

  setGraph: (graph) => set({ graph }),
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
  selectNode: (id) => set({ selectedNodeId: id, selectedEdgeId: null, highlightedEvidenceId: null }),
  selectEdge: (id) => set({ selectedEdgeId: id, selectedNodeId: null, highlightedEvidenceId: null }),
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
  setComponentInspectorTab: (componentInspectorTab) => set({ componentInspectorTab }),
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
