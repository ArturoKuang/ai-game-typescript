import { useState } from "react";
import { useStore, type ComponentFocusDirection, type ComponentInspectorTab, type ContainerInspectorTab, type CouplingFilter, type DataModelInspectorTab, type DependencyInspectorTab } from "./store";
import type { ArchitectureGraph, EventInfo, ZoomLevel } from "./types";
import {
  DATA_MODEL_CATEGORY_META,
  DATA_MODEL_CATEGORY_ORDER,
  getConceptGroupLabel,
  getFamilyLeader,
  getStructureById,
  getStructureFamily,
  getVisibleDataStructures,
  type DataModelVisibilityOptions,
} from "./dataModel";

const ZOOM_LABELS: Record<ZoomLevel, string> = {
  container: "Containers",
  component: "Components",
  dataModel: "Data Model",
  dependency: "Dependencies",
  file: "Files",
  class: "Classes",
  flow: "Data Flow",
};

const COUPLING_TYPES: { key: CouplingFilter; label: string; description: string; color: string }[] = [
  {
    key: "event",
    label: "Events",
    description: "A listens to B's broadcasts (game.on). Neither side knows the other directly.",
    color: "#648FFF",
  },
  {
    key: "call",
    label: "Code imports",
    description: "A imports and calls code from B. A depends on B's API.",
    color: "#FFB000",
  },
  {
    key: "mutation",
    label: "Queued actions",
    description: "A sends B a request to do something later through the command queue.",
    color: "#DC267F",
  },
];

const FLOW_LANE_COLORS: Record<string, string> = {
  Client: "#FE6100",
  Network: "#22D3EE",
  Engine: "#648FFF",
  NPC: "#DC267F",
  Persistence: "#FFB000",
};

const COMPONENT_FOCUS_DIRECTIONS: {
  value: ComponentFocusDirection;
  label: string;
  description: string;
}[] = [
  {
    value: "both",
    label: "All touching it",
    description: "Show direct inputs and outputs around the selected component.",
  },
  {
    value: "inbound",
    label: "Who feeds it",
    description: "Show only components and edges flowing into the selected component.",
  },
  {
    value: "outbound",
    label: "What it affects",
    description: "Show only components and edges flowing out of the selected component.",
  },
];

const COMPONENT_INSPECTOR_TABS: {
  value: ComponentInspectorTab;
  label: string;
  description: string;
}[] = [
  {
    value: "overview",
    label: "What it is",
    description: "Quick summary of this component and why it exists.",
  },
  {
    value: "contract",
    label: "Inputs & outputs",
    description: "What reaches this component, what it sends out, and who it talks to.",
  },
  {
    value: "internals",
    label: "What's inside",
    description: "Main sub-parts, files, and responsibilities inside this component.",
  },
  {
    value: "evidence",
    label: "Show me the code",
    description: "Where this component view came from in code.",
  },
  {
    value: "open_next",
    label: "Read next",
    description: "The next files worth opening if you want to understand this area.",
  },
];

const CONTAINER_INSPECTOR_TABS: {
  value: ContainerInspectorTab;
  label: string;
  description: string;
}[] = [
  {
    value: "overview",
    label: "Overview",
    description: "What this container is, why it exists, and what it owns.",
  },
  {
    value: "relationships",
    label: "Connections",
    description: "How this container talks to the others and over which interface.",
  },
  {
    value: "ownership",
    label: "Code ownership",
    description: "Repo paths and component drilldowns that define this container.",
  },
  {
    value: "evidence",
    label: "Evidence",
    description: "Source evidence backing the container summary and relationships.",
  },
  {
    value: "changes",
    label: "Where to change",
    description: "Best next components or files to open when implementing a change.",
  },
];

const DATA_MODEL_INSPECTOR_TABS: {
  value: DataModelInspectorTab;
  label: string;
  description: string;
}[] = [
  {
    value: "overview",
    label: "What it is",
    description: "Quick summary of the structure, source, category, and why it exists.",
  },
  {
    value: "shape",
    label: "Shape",
    description: "Fields, variants, optionality, and nested structures.",
  },
  {
    value: "access",
    label: "Access",
    description: "How code reads, writes, looks up, iterates, serializes, or stores it.",
  },
  {
    value: "evidence",
    label: "Evidence",
    description: "Source evidence backing the structure summary, access patterns, and relationships.",
  },
  {
    value: "open_next",
    label: "Read next",
    description: "Best files to open next if you want to change or understand this structure.",
  },
];

export function Sidebar() {
  const graph = useStore((s) => s.graph);
  const zoomLevel = useStore((s) => s.zoomLevel);
  const setZoomLevel = useStore((s) => s.setZoomLevel);
  const selectedNodeId = useStore((s) => s.selectedNodeId);
  const selectedEdgeId = useStore((s) => s.selectedEdgeId);
  const visibleCouplingTypes = useStore((s) => s.visibleCouplingTypes);
  const toggleCouplingFilter = useStore((s) => s.toggleCouplingFilter);
  const selectedFlow = useStore((s) => s.selectedFlow);
  const setSelectedFlow = useStore((s) => s.setSelectedFlow);
  const selectedStateMachine = useStore((s) => s.selectedStateMachine);
  const setSelectedStateMachine = useStore((s) => s.setSelectedStateMachine);
  const containerInspectorTab = useStore((s) => s.containerInspectorTab);
  const setContainerInspectorTab = useStore((s) => s.setContainerInspectorTab);
  const containerFocusEnabled = useStore((s) => s.containerFocusEnabled);
  const toggleContainerFocus = useStore((s) => s.toggleContainerFocus);
  const containerSearchQuery = useStore((s) => s.containerSearchQuery);
  const setContainerSearchQuery = useStore((s) => s.setContainerSearchQuery);
  const dataModelInspectorTab = useStore((s) => s.dataModelInspectorTab);
  const setDataModelInspectorTab = useStore((s) => s.setDataModelInspectorTab);
  const dataModelFocusEnabled = useStore((s) => s.dataModelFocusEnabled);
  const toggleDataModelFocus = useStore((s) => s.toggleDataModelFocus);
  const dataModelSearchQuery = useStore((s) => s.dataModelSearchQuery);
  const setDataModelSearchQuery = useStore((s) => s.setDataModelSearchQuery);
  const dataModelShowRuntimeStores = useStore((s) => s.dataModelShowRuntimeStores);
  const toggleDataModelShowRuntimeStores = useStore((s) => s.toggleDataModelShowRuntimeStores);
  const dataModelShowDebugStructures = useStore((s) => s.dataModelShowDebugStructures);
  const toggleDataModelShowDebugStructures = useStore((s) => s.toggleDataModelShowDebugStructures);
  const dataModelExpandMirrors = useStore((s) => s.dataModelExpandMirrors);
  const toggleDataModelExpandMirrors = useStore((s) => s.toggleDataModelExpandMirrors);
  const componentInspectorTab = useStore((s) => s.componentInspectorTab);
  const activeComponentViewId = useStore((s) => s.activeComponentViewId);
  const setComponentInspectorTab = useStore((s) => s.setComponentInspectorTab);
  const setActiveComponentView = useStore((s) => s.setActiveComponentView);
  const componentFocusEnabled = useStore((s) => s.componentFocusEnabled);
  const toggleComponentFocus = useStore((s) => s.toggleComponentFocus);
  const componentFocusDirection = useStore((s) => s.componentFocusDirection);
  const setComponentFocusDirection = useStore((s) => s.setComponentFocusDirection);
  const componentSearchQuery = useStore((s) => s.componentSearchQuery);
  const setComponentSearchQuery = useStore((s) => s.setComponentSearchQuery);
  const dependencyInspectorTab = useStore((s) => s.dependencyInspectorTab);
  const setDependencyInspectorTab = useStore((s) => s.setDependencyInspectorTab);
  const dependencyGranularity = useStore((s) => s.dependencyGranularity);
  const setDependencyGranularity = useStore((s) => s.setDependencyGranularity);
  const dependencyFocusEnabled = useStore((s) => s.dependencyFocusEnabled);
  const toggleDependencyFocus = useStore((s) => s.toggleDependencyFocus);
  const dependencyShowCircularOnly = useStore((s) => s.dependencyShowCircularOnly);
  const toggleDependencyShowCircularOnly = useStore((s) => s.toggleDependencyShowCircularOnly);
  const dependencyHideTypeOnly = useStore((s) => s.dependencyHideTypeOnly);
  const toggleDependencyHideTypeOnly = useStore((s) => s.toggleDependencyHideTypeOnly);

  if (!graph) {
    return (
      <div style={sidebarStyle}>
        <div style={{ color: "#666", fontSize: 13 }}>Loading graph.json...</div>
      </div>
    );
  }

  const hasSelection = selectedNodeId || selectedEdgeId;
  const isFlowView = zoomLevel === "flow";
  const hasContainerDiagram = Boolean(graph.containerDiagram);
  const isContainerView = zoomLevel === "container" && hasContainerDiagram;
  const isDataModelView = zoomLevel === "dataModel";
  const hasDependencyDiagram = Boolean(graph.dependencyDiagram);
  const isDependencyView = zoomLevel === "dependency" && hasDependencyDiagram;
  const hasDetailedComponentDiagram = Boolean(graph.componentDiagram);
  const isDetailedComponentView = zoomLevel === "component" && hasDetailedComponentDiagram;
  const dataModelVisibility = {
    showRuntimeStores: dataModelShowRuntimeStores,
    showDebugStructures: dataModelShowDebugStructures,
    expandMirrors: dataModelExpandMirrors,
  } satisfies DataModelVisibilityOptions;
  const containerCount = graph.containerDiagram?.containers.length ?? 0;
  const applicationCount = graph.containerDiagram?.containers.filter((item) => item.kind === "application").length ?? 0;
  const datastoreCount = graph.containerDiagram?.containers.filter((item) => item.kind === "datastore").length ?? 0;
  const relationshipCount = graph.containerDiagram?.relationships.length ?? 0;
  const depDiag = graph.dependencyDiagram;
  const headerMeta = isContainerView
    ? `${containerCount} containers · ${relationshipCount} relationships · ${applicationCount} applications · ${datastoreCount} data stores`
    : isDependencyView && depDiag
      ? `${depDiag.summary.totalModules} modules · ${depDiag.summary.totalFileDeps} file deps · ${depDiag.summary.circularCycleCount} cycles`
      : isDataModelView
        ? `${visibleDataModelStructureCount(graph, dataModelVisibility)} visible structures · ${visibleDataModelRelationCount(graph, dataModelVisibility)} visible relations · ${graph.dataStructureAccesses.length} access paths`
        : `${graph.meta.fileCount} files · ${graph.meta.classCount} types · ${graph.components.length} components`;

  return (
    <div style={sidebarStyle} data-testid="architecture-sidebar">
      {/* Title */}
      <h1 style={{ fontSize: 18, fontWeight: 800, color: "#fff", margin: "0 0 2px", letterSpacing: -0.3 }}>
        AI Town Architecture
      </h1>
      <div style={{ fontSize: 11, color: "#666", marginBottom: 16 }}>
        {headerMeta}
      </div>

      {/* Zoom level toggle */}
      <div style={{ display: "flex", gap: 4, marginBottom: 14, flexWrap: "wrap" }}>
        {(["container", "component", "dataModel", "dependency", "file", "class", "flow"] as ZoomLevel[]).map((level) => (
          <button
            key={level}
            onClick={() => setZoomLevel(level)}
            style={{
              flex: level === "flow" ? "1 1 100%" : 1,
              padding: "7px 8px",
              fontSize: 11,
              fontWeight: zoomLevel === level ? 700 : 400,
              background: zoomLevel === level ? (level === "flow" ? "#1a2a3a" : "#252545") : "transparent",
              color: zoomLevel === level ? "#fff" : "#666",
              border: `1px solid ${zoomLevel === level ? (level === "flow" ? "#2a4a6a" : "#444") : "#252545"}`,
              borderRadius: 6,
              cursor: "pointer",
              transition: "all 0.15s",
            }}
          >
            {ZOOM_LABELS[level]}
          </button>
        ))}
      </div>

      {/* Edge filters — only for non-flow views */}
      {!isFlowView && !isContainerView && !isDataModelView && !isDependencyView && !(zoomLevel === "component" && hasDetailedComponentDiagram) && (
        <div style={{ ...sectionStyle, padding: "10px 12px" }}>
          <div style={{ fontSize: 11, fontWeight: 700, color: "#aaa", marginBottom: 10 }}>
            Relationship types
          </div>
          {COUPLING_TYPES.map((ct) => {
            const active = visibleCouplingTypes.has(ct.key);
            return (
              <div
                key={ct.key}
                style={{
                  marginBottom: 10,
                  opacity: active ? 1 : 0.35,
                  transition: "opacity 0.15s",
                }}
              >
                <label style={{ display: "flex", alignItems: "center", gap: 8, cursor: "pointer" }}>
                  <input
                    type="checkbox"
                    checked={active}
                    onChange={() => toggleCouplingFilter(ct.key)}
                    style={{ accentColor: ct.color, width: 14, height: 14, cursor: "pointer", flexShrink: 0 }}
                  />
                  <svg width="28" height="8" style={{ flexShrink: 0 }}>
                    <line
                      x1="0" y1="4" x2="28" y2="4"
                      stroke={ct.color}
                      strokeWidth={ct.key === "mutation" ? 2.5 : 2}
                      strokeDasharray={ct.key === "event" ? "6 3" : ct.key === "mutation" ? "3 3" : undefined}
                    />
                  </svg>
                  <span style={{ fontSize: 11, fontWeight: 600, color: active ? "#ddd" : "#666" }}>{ct.label}</span>
                </label>
                <div style={{ fontSize: 10, color: "#666", marginTop: 3, marginLeft: 22, lineHeight: 1.4 }}>
                  {ct.description}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Flow view controls */}
      {isFlowView && <FlowControls />}
      {isContainerView && (
        <ContainerTabControls
          inspectorTab={containerInspectorTab}
          onSelectTab={setContainerInspectorTab}
          focusEnabled={containerFocusEnabled}
          onToggleFocus={toggleContainerFocus}
          searchQuery={containerSearchQuery}
          onSearchChange={setContainerSearchQuery}
        />
      )}
      {isDataModelView && (
        <DataModelTabControls
          inspectorTab={dataModelInspectorTab}
          onSelectTab={setDataModelInspectorTab}
          focusEnabled={dataModelFocusEnabled}
          onToggleFocus={toggleDataModelFocus}
          searchQuery={dataModelSearchQuery}
          onSearchChange={setDataModelSearchQuery}
          showRuntimeStores={dataModelShowRuntimeStores}
          onToggleRuntimeStores={toggleDataModelShowRuntimeStores}
          showDebugStructures={dataModelShowDebugStructures}
          onToggleDebugStructures={toggleDataModelShowDebugStructures}
          expandMirrors={dataModelExpandMirrors}
          onToggleExpandMirrors={toggleDataModelExpandMirrors}
        />
      )}
      {isDependencyView && (
        <DependencyTabControls
          inspectorTab={dependencyInspectorTab}
          onSelectTab={setDependencyInspectorTab}
          granularity={dependencyGranularity}
          onSelectGranularity={setDependencyGranularity}
          focusEnabled={dependencyFocusEnabled}
          onToggleFocus={toggleDependencyFocus}
          showCircularOnly={dependencyShowCircularOnly}
          onToggleCircularOnly={toggleDependencyShowCircularOnly}
          hideTypeOnly={dependencyHideTypeOnly}
          onToggleHideTypeOnly={toggleDependencyHideTypeOnly}
        />
      )}
      {isDetailedComponentView && (
        <ComponentTabControls
          activeViewId={activeComponentViewId}
          onSelectView={setActiveComponentView}
          inspectorTab={componentInspectorTab}
          onSelectTab={setComponentInspectorTab}
          focusEnabled={componentFocusEnabled}
          onToggleFocus={toggleComponentFocus}
          focusDirection={componentFocusDirection}
          onSelectFocusDirection={setComponentFocusDirection}
          searchQuery={componentSearchQuery}
          onSearchChange={setComponentSearchQuery}
        />
      )}

      {/* Selection detail OR intro */}
      {!isFlowView && (
        isContainerView ? (
          <ContainerInspector />
        ) : isDependencyView ? (
          <DependencyInspector />
        ) : isDataModelView ? (
          <DataModelInspector />
        ) : isDetailedComponentView ? (
          <ComponentInspector />
        ) : hasSelection ? (
          <>
            {selectedNodeId && <NodeDetail nodeId={selectedNodeId} />}
            {selectedEdgeId && <EdgeDetail edgeId={selectedEdgeId} />}
          </>
        ) : (
          <IntroPanel />
        )
      )}

      {/* Footer */}
      <div style={{ marginTop: "auto", paddingTop: 12 }}>
        <div style={{ fontSize: 9, color: "#444" }}>
          Extracted {new Date(graph.meta.extractedAt).toLocaleString()}
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Flow view controls — message flow selector + state machine selector
// ---------------------------------------------------------------------------

function FlowControls() {
  const graph = useStore((s) => s.graph);
  const selectedFlow = useStore((s) => s.selectedFlow);
  const setSelectedFlow = useStore((s) => s.setSelectedFlow);
  const selectedStateMachine = useStore((s) => s.selectedStateMachine);
  const setSelectedStateMachine = useStore((s) => s.setSelectedStateMachine);
  const selectedFlowGroup = useStore((s) => s.selectedFlowGroup);
  const setSelectedFlowGroup = useStore((s) => s.setSelectedFlowGroup);

  if (!graph) return null;

  const flows = graph.messageFlows ?? [];
  const flowGroups = graph.messageFlowGroups ?? [];
  const stateMachines = graph.stateMachines ?? [];

  // Improvement 6: compute uncovered events
  const allProducedValues = new Set<string>();
  for (const flow of flows) {
    for (const step of flow.steps) {
      if (step.produces) allProducedValues.add(step.produces);
    }
  }
  const uncoveredEvents = (graph.events ?? []).filter(
    (e) => !allProducedValues.has(e.eventType),
  );

  return (
    <>
      {/* Improvement 7: Flow groups */}
      {flowGroups.length > 0 && (
        <div style={sectionStyle}>
          <div style={{ fontSize: 11, fontWeight: 700, color: "#aaa", marginBottom: 8 }}>
            Flow Groups
          </div>
          <div style={{ display: "flex", gap: 4, flexWrap: "wrap", marginBottom: 4 }}>
            {flowGroups.map((group) => {
              const active = selectedFlowGroup === group.id;
              return (
                <button
                  key={group.id}
                  onClick={() => setSelectedFlowGroup(active ? null : group.id)}
                  style={{
                    padding: "4px 8px",
                    fontSize: 10,
                    fontWeight: active ? 700 : 500,
                    color: active ? "#fff" : "#aaa",
                    background: active ? "#1a2a3a" : "transparent",
                    border: `1px solid ${active ? "#2a4a6a" : "#252545"}`,
                    borderRadius: 4,
                    cursor: "pointer",
                    transition: "all 0.15s",
                  }}
                >
                  {group.label}
                  <span style={{ fontSize: 9, color: "#666", marginLeft: 4 }}>
                    ({group.flowTypes.length})
                  </span>
                </button>
              );
            })}
          </div>
          {selectedFlowGroup && (() => {
            const group = flowGroups.find((g) => g.id === selectedFlowGroup);
            return group ? (
              <div style={{ fontSize: 9, color: "#666", lineHeight: 1.4, marginTop: 4 }}>
                {group.description}
              </div>
            ) : null;
          })()}
        </div>
      )}

      {/* Message flows */}
      <div style={sectionStyle}>
        <div style={{ fontSize: 11, fontWeight: 700, color: "#aaa", marginBottom: 8 }}>
          Message Flows
        </div>
        <div style={{ fontSize: 10, color: "#666", marginBottom: 10, lineHeight: 1.4 }}>
          Click a flow to isolate its path through the system. Click again to show all.
        </div>
        {flows.map((flow) => {
          const active = selectedFlow === flow.clientMessageType;
          const inGroup = !selectedFlowGroup || (() => {
            const group = flowGroups.find((g) => g.id === selectedFlowGroup);
            return group ? group.flowTypes.includes(flow.clientMessageType) : true;
          })();
          return (
            <button
              key={flow.clientMessageType}
              onClick={() => setSelectedFlow(active ? null : flow.clientMessageType)}
              style={{
                display: "block",
                width: "100%",
                textAlign: "left",
                padding: "6px 8px",
                marginBottom: 3,
                fontSize: 11,
                fontWeight: active ? 700 : 400,
                color: active ? "#fff" : inGroup ? "#aaa" : "#555",
                background: active ? "#1a2a3a" : "transparent",
                border: `1px solid ${active ? "#2a4a6a" : "transparent"}`,
                borderRadius: 5,
                cursor: "pointer",
                transition: "all 0.15s",
                opacity: inGroup ? 1 : 0.5,
              }}
            >
              <span style={{ fontFamily: "monospace", fontWeight: 600, color: active ? "#648FFF" : inGroup ? "#888" : "#555" }}>
                {flow.clientMessageType}
              </span>
              <div style={{ fontSize: 9, color: "#666", marginTop: 2, lineHeight: 1.3 }}>
                {flow.description}
              </div>
            </button>
          );
        })}
      </div>

      {/* Selected flow detail */}
      {selectedFlow && <FlowDetail flowType={selectedFlow} />}

      {/* Improvement 6: Coverage section (all-flows mode only) */}
      {!selectedFlow && uncoveredEvents.length > 0 && (
        <FlowCoverage uncoveredEvents={uncoveredEvents} />
      )}

      {/* State machines */}
      {stateMachines.length > 0 && (
        <div style={sectionStyle}>
          <div style={{ fontSize: 11, fontWeight: 700, color: "#aaa", marginBottom: 8 }}>
            State Machines
          </div>
          {stateMachines.map((sm) => {
            const active = selectedStateMachine === sm.id;
            return (
              <button
                key={sm.id}
                onClick={() => setSelectedStateMachine(active ? null : sm.id)}
                style={{
                  display: "block",
                  width: "100%",
                  textAlign: "left",
                  padding: "6px 8px",
                  marginBottom: 3,
                  fontSize: 11,
                  fontWeight: active ? 700 : 400,
                  color: active ? "#fff" : "#aaa",
                  background: active ? "#1a2a3a" : "transparent",
                  border: `1px solid ${active ? "#2a4a6a" : "transparent"}`,
                  borderRadius: 5,
                  cursor: "pointer",
                  transition: "all 0.15s",
                }}
              >
                {sm.label}
                <div style={{ fontSize: 9, color: "#666", marginTop: 2 }}>
                  {sm.states.length} states &middot; {sm.transitions.length} transitions
                </div>
              </button>
            );
          })}
        </div>
      )}

      {/* Selected state machine detail */}
      {selectedStateMachine && <StateMachineDetail smId={selectedStateMachine} />}

      {/* Flow view legend */}
      {!selectedFlow && !selectedStateMachine && (
        <div style={sectionStyle}>
          <div style={{ fontSize: 11, fontWeight: 700, color: "#aaa", marginBottom: 8 }}>
            Swim Lanes
          </div>
          {Object.entries(FLOW_LANE_COLORS).map(([lane, color]) => (
            <div key={lane} style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 5 }}>
              <div style={{ width: 12, height: 12, borderRadius: 3, background: color, flexShrink: 0 }} />
              <span style={{ fontSize: 11, color: "#ccc" }}>{lane}</span>
            </div>
          ))}
          <div style={{ borderTop: "1px solid #252545", marginTop: 8, paddingTop: 8 }}>
            <div style={{ fontSize: 10, color: "#666", lineHeight: 1.5 }}>
              Each row shows a system component. Arrows trace how a client message
              flows through the server to produce a response.
            </div>
          </div>
          <div style={{ marginTop: 8 }}>
            <div style={{ fontSize: 10, fontWeight: 600, color: "#999", marginBottom: 4 }}>
              Badge legend
            </div>
            <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
              {[
                { label: "CMD", color: "#DC267F", desc: "Command" },
                { label: "EVT", color: "#648FFF", desc: "Event" },
                { label: "MSG", color: "#22D3EE", desc: "Server Message" },
                { label: "CALL", color: "#94a3b8", desc: "Direct Call" },
              ].map((b) => (
                <div key={b.label} style={{ display: "flex", alignItems: "center", gap: 4 }}>
                  <span
                    style={{
                      fontSize: 8,
                      fontWeight: 700,
                      color: b.color,
                      background: `${b.color}18`,
                      border: `1px solid ${b.color}35`,
                      borderRadius: 3,
                      padding: "0px 4px",
                    }}
                  >
                    {b.label}
                  </span>
                  <span style={{ fontSize: 9, color: "#777" }}>{b.desc}</span>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}
    </>
  );
}

// ---------------------------------------------------------------------------
// Flow coverage — shows uncovered events (Improvement 6)
// ---------------------------------------------------------------------------

function FlowCoverage({ uncoveredEvents }: { uncoveredEvents: EventInfo[] }) {
  const [expanded, setExpanded] = useState(false);

  return (
    <div style={sectionStyle}>
      <div
        onClick={() => setExpanded(!expanded)}
        style={{ cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "space-between" }}
      >
        <div style={{ fontSize: 11, fontWeight: 700, color: "#aaa" }}>
          Coverage
        </div>
        <span style={{ fontSize: 10, color: "#f59e0b" }}>
          {uncoveredEvents.length} uncovered
        </span>
      </div>
      {expanded && (
        <div style={{ marginTop: 6 }}>
          <div style={{ fontSize: 9, color: "#666", marginBottom: 4 }}>
            Event types not produced by any flow:
          </div>
          {uncoveredEvents.map((e) => (
            <div
              key={e.eventType}
              style={{
                fontSize: 10,
                color: "#888",
                fontFamily: "monospace",
                lineHeight: 1.6,
              }}
            >
              {e.eventType}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Flow detail panel
// ---------------------------------------------------------------------------

function FlowDetail({ flowType }: { flowType: string }) {
  const graph = useStore((s) => s.graph);
  const selectedFlowStep = useStore((s) => s.selectedFlowStep);
  const setSelectedFlowStep = useStore((s) => s.setSelectedFlowStep);
  if (!graph) return null;

  const flow = (graph.messageFlows ?? []).find((f) => f.clientMessageType === flowType);
  if (!flow) return null;

  const selectedStep = selectedFlowStep != null ? flow.steps[selectedFlowStep] : null;

  // Improvement 4: Collect state transitions triggered by this flow
  const stateEffects = flow.steps
    .filter((s) => s.stateTransition)
    .map((s) => s.stateTransition!);

  return (
    <>
      <div style={sectionStyle}>
        <div style={{ fontSize: 13, fontWeight: 700, color: "#648FFF" }}>
          {flow.clientMessageType}
        </div>
        <div style={{ fontSize: 11, color: "#888", marginTop: 4, lineHeight: 1.4 }}>
          {flow.description}
        </div>
        <div style={{ marginTop: 10 }}>
          <div style={{ fontSize: 10, fontWeight: 600, color: "#999", marginBottom: 4 }}>
            {flow.steps.length} steps
            {selectedFlowStep != null && (
              <span
                onClick={() => setSelectedFlowStep(null)}
                style={{ color: "#648FFF", cursor: "pointer", marginLeft: 8 }}
              >
                clear
              </span>
            )}
          </div>
          {flow.steps.map((step, i) => {
            const laneColor = FLOW_LANE_COLORS[step.lane] ?? "#888";
            const isSelected = selectedFlowStep === i;
            return (
              <div
                key={i}
                onClick={() => setSelectedFlowStep(isSelected ? null : i)}
                style={{
                  padding: "4px 6px",
                  marginBottom: 3,
                  borderLeft: `3px solid ${isSelected ? "#fff" : laneColor}`,
                  background: isSelected ? `${laneColor}20` : `${laneColor}08`,
                  borderRadius: "0 4px 4px 0",
                  cursor: "pointer",
                  transition: "background 0.15s",
                }}
              >
                <div style={{ display: "flex", alignItems: "center", gap: 4, marginBottom: 2 }}>
                  <span style={{ fontSize: 9, fontWeight: 700, color: laneColor }}>
                    {step.lane}
                  </span>
                  <span style={{ fontSize: 9, color: "#555" }}>&middot;</span>
                  <span style={{ fontSize: 9, color: "#888", fontFamily: "monospace" }}>
                    {step.method}
                  </span>
                </div>
                <div style={{ fontSize: 10, color: "#bbb", lineHeight: 1.3 }}>
                  {step.action}
                </div>
                {step.produces && (
                  <div style={{ fontSize: 9, color: "#666", marginTop: 2, fontFamily: "monospace" }}>
                    -&gt; {step.produces}
                  </div>
                )}
              </div>
            );
          })}
        </div>

        {/* Improvement 4: State effects */}
        {stateEffects.length > 0 && (
          <div style={{ marginTop: 10, borderTop: "1px solid #252545", paddingTop: 8 }}>
            <div style={{ fontSize: 10, fontWeight: 600, color: "#a78bfa", marginBottom: 4 }}>
              State effects
            </div>
            {stateEffects.map((t, i) => (
              <div key={i} style={{ fontSize: 9, color: "#888", lineHeight: 1.6, fontFamily: "monospace" }}>
                <span style={{ color: "#a78bfa" }}>{t.machineId}</span>: {t.from} &rarr; {t.to}
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Improvement 2: Cross-reference panel for selected step */}
      {selectedStep && selectedStep.produces && (
        <FlowStepCrossReference
          graph={graph}
          producesValue={selectedStep.produces}
        />
      )}

      {/* Improvement 3: Error paths for selected step */}
      {selectedStep && selectedStep.errorPaths && selectedStep.errorPaths.length > 0 && (
        <div style={sectionStyle}>
          <div style={{ fontSize: 10, fontWeight: 600, color: "#f59e0b", marginBottom: 6 }}>
            Validation checks
          </div>
          {selectedStep.errorPaths.map((ep, i) => (
            <div
              key={i}
              style={{
                fontSize: 10,
                color: "#aaa",
                lineHeight: 1.5,
                padding: "2px 0",
                borderBottom: "1px solid #1e1e35",
              }}
            >
              <span style={{ color: "#f59e0b" }}>{ep.condition}</span>
              <span style={{ color: "#555", fontSize: 9 }}> &rarr; {ep.produces}</span>
            </div>
          ))}
        </div>
      )}
    </>
  );
}

// ---------------------------------------------------------------------------
// Cross-reference panel — shows event/command subscribers/producers
// ---------------------------------------------------------------------------

function FlowStepCrossReference({
  graph,
  producesValue,
}: {
  graph: ArchitectureGraph;
  producesValue: string;
}) {
  // Look up in events and commands
  const matchingEvent = (graph.events ?? []).find((e) => e.eventType === producesValue);
  const matchingCommand = (graph.commands ?? []).find((c) => c.commandType === producesValue);

  if (!matchingEvent && !matchingCommand) return null;

  return (
    <div style={sectionStyle}>
      <div style={{ fontSize: 10, fontWeight: 600, color: "#999", marginBottom: 6 }}>
        Cross-reference: <span style={{ fontFamily: "monospace", color: "#648FFF" }}>{producesValue}</span>
      </div>

      {matchingEvent && (
        <>
          {matchingEvent.emitters.length > 0 && (
            <div style={{ marginBottom: 6 }}>
              <div style={{ fontSize: 9, fontWeight: 600, color: "#888", marginBottom: 3 }}>
                Emitters ({matchingEvent.emitters.length})
              </div>
              {matchingEvent.emitters.slice(0, 6).map((em, i) => (
                <div key={i} style={{ fontSize: 9, color: "#777", fontFamily: "monospace", lineHeight: 1.5 }}>
                  {em.fileId.split("/").pop()}
                  {em.classId && <span style={{ color: "#555" }}> ({em.classId})</span>}
                  {em.line && <span style={{ color: "#555" }}>:{em.line}</span>}
                </div>
              ))}
            </div>
          )}
          {matchingEvent.subscribers.length > 0 && (
            <div>
              <div style={{ fontSize: 9, fontWeight: 600, color: "#888", marginBottom: 3 }}>
                Subscribers ({matchingEvent.subscribers.length})
              </div>
              {matchingEvent.subscribers.slice(0, 6).map((sub, i) => (
                <div key={i} style={{ fontSize: 9, color: "#777", fontFamily: "monospace", lineHeight: 1.5 }}>
                  {sub.fileId.split("/").pop()}
                  {sub.classId && <span style={{ color: "#555" }}> ({sub.classId})</span>}
                  {sub.line && <span style={{ color: "#555" }}>:{sub.line}</span>}
                </div>
              ))}
            </div>
          )}
        </>
      )}

      {matchingCommand && (
        <div>
          <div style={{ fontSize: 9, fontWeight: 600, color: "#888", marginBottom: 3 }}>
            Producers ({matchingCommand.producers.length})
          </div>
          {matchingCommand.producers.slice(0, 6).map((p, i) => (
            <div key={i} style={{ fontSize: 9, color: "#777", fontFamily: "monospace", lineHeight: 1.5 }}>
              {p.fileId.split("/").pop()}
              {p.classId && <span style={{ color: "#555" }}> ({p.classId})</span>}
              {p.line && <span style={{ color: "#555" }}>:{p.line}</span>}
            </div>
          ))}
          <div style={{ fontSize: 9, color: "#555", marginTop: 3 }}>
            Consumer: <span style={{ fontFamily: "monospace" }}>{matchingCommand.consumer.split("/").pop()}</span>
          </div>
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// State machine detail panel
// ---------------------------------------------------------------------------

function StateMachineDetail({ smId }: { smId: string }) {
  const graph = useStore((s) => s.graph);
  const setSelectedFlow = useStore((s) => s.setSelectedFlow);
  if (!graph) return null;

  const sm = (graph.stateMachines ?? []).find((s) => s.id === smId);
  if (!sm) return null;

  return (
    <div style={sectionStyle}>
      <div style={{ fontSize: 13, fontWeight: 700, color: "#ccc" }}>
        {sm.label}
      </div>
      <div style={{ fontSize: 10, color: "#888", marginTop: 4, lineHeight: 1.4 }}>
        {sm.description}
      </div>

      <div style={{ marginTop: 10 }}>
        <div style={{ fontSize: 10, fontWeight: 600, color: "#999", marginBottom: 4 }}>
          States
        </div>
        {sm.states.map((state) => (
          <div key={state.id} style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 3 }}>
            <div style={{ width: 10, height: 10, borderRadius: state.isTerminal ? 3 : 10, background: state.color ?? "#888", flexShrink: 0 }} />
            <span style={{ fontSize: 11, color: "#ccc" }}>
              {state.label}
              {state.isInitial && <span style={{ fontSize: 9, color: "#666" }}> (initial)</span>}
              {state.isTerminal && <span style={{ fontSize: 9, color: "#666" }}> (terminal)</span>}
            </span>
          </div>
        ))}
      </div>

      <div style={{ marginTop: 10 }}>
        <div style={{ fontSize: 10, fontWeight: 600, color: "#999", marginBottom: 4 }}>
          Transitions
        </div>
        {sm.transitions.map((t, i) => (
          <div
            key={i}
            style={{
              fontSize: 10,
              color: "#aaa",
              lineHeight: 1.6,
              marginBottom: 4,
            }}
          >
            <span style={{ color: sm.states.find((s) => s.id === t.from)?.color ?? "#888" }}>{t.from}</span>
            {" -> "}
            <span style={{ color: sm.states.find((s) => s.id === t.to)?.color ?? "#888" }}>{t.to}</span>
            <span style={{ color: "#666" }}> : {t.trigger}</span>
            {t.condition && (
              <div style={{ fontSize: 9, color: "#555", marginLeft: 12 }}>
                {t.condition}
              </div>
            )}
            {/* Improvement 4: Show triggering flows */}
            {t.triggeringFlows && t.triggeringFlows.length > 0 && (
              <div style={{ marginLeft: 12, marginTop: 2, display: "flex", flexWrap: "wrap", gap: 3 }}>
                {t.triggeringFlows.map((ft) => (
                  <span
                    key={ft}
                    onClick={() => setSelectedFlow(ft)}
                    style={{
                      fontSize: 8,
                      fontWeight: 600,
                      color: "#648FFF",
                      background: "#648FFF18",
                      border: "1px solid #648FFF30",
                      borderRadius: 3,
                      padding: "0 4px",
                      cursor: "pointer",
                      fontFamily: "monospace",
                    }}
                  >
                    {ft}
                  </span>
                ))}
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Detailed component tab controls + inspector
// ---------------------------------------------------------------------------

function ContainerTabControls(
  {
    inspectorTab,
    onSelectTab,
    focusEnabled,
    onToggleFocus,
    searchQuery,
    onSearchChange,
  }: {
    inspectorTab: ContainerInspectorTab;
    onSelectTab: (tab: ContainerInspectorTab) => void;
    focusEnabled: boolean;
    onToggleFocus: () => void;
    searchQuery: string;
    onSearchChange: (query: string) => void;
  },
) {
  const graph = useStore((s) => s.graph);
  const selectNode = useStore((s) => s.selectNode);
  const selectEdge = useStore((s) => s.selectEdge);
  if (!graph?.containerDiagram) return null;

  const results = searchContainerDiagram(graph, searchQuery);
  const activeInspectorTab =
    CONTAINER_INSPECTOR_TABS.find((tab) => tab.value === inspectorTab) ?? CONTAINER_INSPECTOR_TABS[0];
  const containers = graph.containerDiagram.containers;
  const stats = [
    `${containers.length} containers`,
    `${graph.containerDiagram.relationships.length} relationships`,
    `${containers.filter((item) => item.kind === "application").length} applications`,
    `${containers.filter((item) => item.kind === "datastore").length} data stores`,
  ];

  return (
    <div style={sectionStyle}>
      <div style={{ fontSize: 11, fontWeight: 700, color: "#aaa", marginBottom: 8 }}>
        Container View
      </div>
      <div style={{ fontSize: 10, color: "#64748b", lineHeight: 1.45, marginBottom: 10 }}>
        Use this view to orient around the runtime applications and data stores inside the AI Town boundary before drilling into components or files.
      </div>

      <input
        value={searchQuery}
        onChange={(event) => onSearchChange(event.target.value)}
        placeholder="Search containers, interfaces, paths, components..."
        data-testid="container-search"
        style={{
          width: "100%",
          boxSizing: "border-box",
          padding: "8px 10px",
          fontSize: 11,
          color: "#e5e7eb",
          background: "#0f172a",
          border: "1px solid #273449",
          borderRadius: 8,
          outline: "none",
          marginBottom: 10,
        }}
      />

      <div
        style={{
          marginBottom: 10,
          padding: "10px 10px 12px",
          border: "1px solid #273449",
          borderRadius: 10,
          background: "#0f172a",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10 }}>
          <div>
            <div style={{ fontSize: 10, fontWeight: 700, color: "#cbd5e1" }}>Focus mode</div>
            <div style={{ fontSize: 10, color: "#64748b", marginTop: 2, lineHeight: 1.35 }}>
              Select a container or connection to dim unrelated parts of the runtime diagram.
            </div>
          </div>
          <button
            type="button"
            onClick={onToggleFocus}
            style={{
              padding: "6px 9px",
              fontSize: 10,
              fontWeight: 700,
              color: focusEnabled ? "#fff" : "#94a3b8",
              background: focusEnabled ? "#1d4ed8" : "transparent",
              border: `1px solid ${focusEnabled ? "#2563eb" : "#334155"}`,
              borderRadius: 7,
              cursor: "pointer",
              flexShrink: 0,
            }}
          >
            {focusEnabled ? "Focus on" : "Focus off"}
          </button>
        </div>
        <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginTop: 10 }}>
          {stats.map((item) => (
            <span
              key={item}
              style={{
                fontSize: 9,
                fontWeight: 700,
                color: "#dbeafe",
                background: "#111827",
                border: "1px solid #273449",
                borderRadius: 999,
                padding: "3px 8px",
              }}
            >
              {item}
            </span>
          ))}
        </div>
      </div>

      <div
        style={{
          marginBottom: 10,
          padding: "10px 10px 12px",
          border: "1px solid #273449",
          borderRadius: 10,
          background: "#0f172a",
        }}
      >
        <div style={{ fontSize: 10, fontWeight: 700, color: "#cbd5e1", marginBottom: 6 }}>
          Jump to container
        </div>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(2, minmax(0, 1fr))", gap: 6 }}>
          {containers.map((container) => (
            <button
              key={container.id}
              type="button"
              onClick={() => {
                selectNode(container.id);
                onSelectTab("overview");
              }}
              style={{
                display: "flex",
                flexDirection: "column",
                alignItems: "flex-start",
                gap: 4,
                padding: "8px 10px",
                textAlign: "left",
                color: "#e5e7eb",
                background: "#111827",
                border: `1px solid ${container.color}35`,
                borderRadius: 8,
                cursor: "pointer",
              }}
            >
              <span style={{ fontSize: 10, fontWeight: 700 }}>{container.name}</span>
              <span style={{ fontSize: 9, color: "#94a3b8" }}>
                {container.kind === "datastore" ? "Data store" : "Application"}
              </span>
            </button>
          ))}
        </div>
      </div>

      <div
        style={{
          marginBottom: 10,
          padding: "10px 10px 12px",
          border: "1px solid #273449",
          borderRadius: 10,
          background: "#0f172a",
        }}
      >
        <div style={{ fontSize: 10, fontWeight: 700, color: "#cbd5e1", marginBottom: 6 }}>
          Inspector lens
        </div>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(2, minmax(0, 1fr))", gap: 6 }}>
          {CONTAINER_INSPECTOR_TABS.map((tab, index) => (
            <button
              key={tab.value}
              type="button"
              onClick={() => onSelectTab(tab.value)}
              style={{
                gridColumn: index === CONTAINER_INSPECTOR_TABS.length - 1 ? "1 / -1" : undefined,
                display: "flex",
                flexDirection: "column",
                alignItems: "flex-start",
                gap: 3,
                padding: "8px 10px",
                textAlign: "left",
                color: inspectorTab === tab.value ? "#fff" : "#cbd5e1",
                background: inspectorTab === tab.value ? "#172033" : "#111827",
                border: `1px solid ${inspectorTab === tab.value ? "#3b82f6" : "#273449"}`,
                borderRadius: 8,
                cursor: "pointer",
              }}
            >
              <span style={{ fontSize: 10, fontWeight: 700 }}>{tab.label}</span>
              <span style={{ fontSize: 9, color: "#64748b", lineHeight: 1.35 }}>{tab.description}</span>
            </button>
          ))}
        </div>
        <div
          style={{
            marginTop: 8,
            paddingTop: 8,
            borderTop: "1px solid #1f2937",
            fontSize: 10,
            color: "#94a3b8",
            lineHeight: 1.45,
          }}
        >
          <strong style={{ color: "#e5e7eb" }}>{activeInspectorTab.label}:</strong> {activeInspectorTab.description}
        </div>
      </div>

      {searchQuery.trim().length > 0 && (
        <div style={{ borderTop: "1px solid #252545", paddingTop: 10 }}>
          <div style={{ fontSize: 10, fontWeight: 600, color: "#94a3b8", marginBottom: 6 }}>
            Search Results
          </div>
          {results.length === 0 && (
            <div style={{ fontSize: 10, color: "#64748b" }}>No container or connection matches.</div>
          )}
          {results.slice(0, 8).map((result) => (
            <button
              key={result.key}
              type="button"
              onClick={() => {
                if (result.kind === "relationship") {
                  selectEdge(result.edgeId);
                  onSelectTab("relationships");
                  return;
                }

                selectNode(result.containerId);
                onSelectTab(result.tab);
              }}
              style={{
                display: "block",
                width: "100%",
                textAlign: "left",
                padding: "7px 8px",
                marginBottom: 4,
                fontSize: 10,
                color: "#cbd5e1",
                background: "#0f172a",
                border: "1px solid #273449",
                borderRadius: 6,
                cursor: "pointer",
              }}
            >
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8 }}>
                <div style={{ fontWeight: 700, color: "#fff" }}>{result.title}</div>
                <span style={{ fontSize: 8, fontWeight: 700, color: "#93c5fd", textTransform: "uppercase" }}>
                  {result.kind === "relationship" ? "connection" : result.tab}
                </span>
              </div>
              <div style={{ color: "#94a3b8", marginTop: 2 }}>{result.label}</div>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

function ContainerInspector() {
  const graph = useStore((s) => s.graph);
  const selectedNodeId = useStore((s) => s.selectedNodeId);
  const selectedEdgeId = useStore((s) => s.selectedEdgeId);
  const inspectorTab = useStore((s) => s.containerInspectorTab);

  if (!graph?.containerDiagram) return null;
  if (!selectedNodeId && !selectedEdgeId) return <ContainerIntroPanel />;

  if (selectedEdgeId) {
    return <ContainerRelationshipInspector edgeId={selectedEdgeId} />;
  }

  const container = graph.containerDiagram.containers.find((item) => item.id === selectedNodeId);
  if (!container) return <ContainerIntroPanel />;

  switch (inspectorTab) {
    case "relationships":
      return <ContainerRelationshipsInspector containerId={container.id} />;
    case "ownership":
      return <ContainerOwnershipInspector containerId={container.id} />;
    case "evidence":
      return <ContainerEvidenceInspector containerId={container.id} />;
    case "changes":
      return <ContainerWhereToChangeInspector containerId={container.id} />;
    case "overview":
    default:
      return <ContainerOverviewInspector containerId={container.id} />;
  }
}

function ContainerIntroPanel() {
  const graph = useStore((s) => s.graph);
  if (!graph?.containerDiagram) return null;

  return (
    <div style={sectionStyle}>
      <div style={{ fontSize: 13, fontWeight: 700, color: "#fff", marginBottom: 6 }}>
        Container Diagram
      </div>
      <div style={{ fontSize: 11, color: "#94a3b8", lineHeight: 1.5, marginBottom: 10 }}>
        This tab shows AI Town at the C4 container level: the main applications and data stores inside the software system boundary.
      </div>
      <div style={{ fontSize: 11, color: "#cbd5e1", lineHeight: 1.5 }}>
        Select a container to inspect its responsibilities, connections, code ownership, and the best next place to make a change.
      </div>
    </div>
  );
}

function ContainerOverviewInspector({ containerId }: { containerId: string }) {
  const graph = useStore((s) => s.graph);
  if (!graph?.containerDiagram) return null;
  const container = graph.containerDiagram.containers.find((item) => item.id === containerId);
  if (!container) return null;

  return (
    <div style={sectionStyle}>
      <InspectorHeader title={container.name} subtitle={container.technology} color={container.color} />
      <div style={{ fontSize: 11, color: "#cbd5e1", lineHeight: 1.55, marginBottom: 10 }}>
        {container.summary ?? container.description}
      </div>
      <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginBottom: 10 }}>
        <span
          style={{
            fontSize: 10,
            fontWeight: 700,
            color: container.color,
            border: `1px solid ${container.color}35`,
            background: `${container.color}12`,
            borderRadius: 999,
            padding: "3px 8px",
          }}
        >
          {container.kind === "datastore" ? "Data store" : "Application"}
        </span>
        {container.badges?.map((badge) => (
          <span
            key={badge}
            style={{
              fontSize: 10,
              fontWeight: 700,
              color: "#e5e7eb",
              border: `1px solid ${container.color}35`,
              background: `${container.color}12`,
              borderRadius: 999,
              padding: "3px 8px",
            }}
          >
            {badge}
          </span>
        ))}
      </div>

      <div style={{ fontSize: 10, fontWeight: 700, color: "#94a3b8", textTransform: "uppercase", letterSpacing: 0.6, marginBottom: 5 }}>
        Purpose
      </div>
      <div style={{ fontSize: 11, color: "#d1d5db", lineHeight: 1.55, marginBottom: 12 }}>
        {container.description}
      </div>

      <div style={{ fontSize: 10, fontWeight: 700, color: "#94a3b8", textTransform: "uppercase", letterSpacing: 0.6, marginBottom: 6 }}>
        {container.kind === "datastore" ? "Stores" : "Responsibilities"}
      </div>
      <div style={{ display: "flex", flexDirection: "column", gap: 6, marginBottom: 12 }}>
        {container.responsibilities.map((item) => (
          <div
            key={item}
            style={{
              fontSize: 11,
              color: "#d1d5db",
              lineHeight: 1.5,
              padding: "7px 9px",
              border: "1px solid #273449",
              borderRadius: 8,
              background: "#0f172a",
            }}
          >
            {item}
          </div>
        ))}
      </div>

      <div style={{ fontSize: 10, fontWeight: 700, color: "#94a3b8", textTransform: "uppercase", letterSpacing: 0.6, marginBottom: 6 }}>
        Primary code ownership
      </div>
      <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
        {container.codePaths.slice(0, 3).map((path) => (
          <div key={path} style={{ fontSize: 11, color: "#d1d5db", fontFamily: "monospace", lineHeight: 1.45 }}>
            {path}
          </div>
        ))}
        {container.codePaths.length > 3 && (
          <div style={{ fontSize: 10, color: "#64748b" }}>
            +{container.codePaths.length - 3} more path{container.codePaths.length - 3 === 1 ? "" : "s"} in Code ownership
          </div>
        )}
      </div>
    </div>
  );
}

function ContainerRelationshipsInspector({ containerId }: { containerId: string }) {
  const graph = useStore((s) => s.graph);
  const selectEdge = useStore((s) => s.selectEdge);
  if (!graph?.containerDiagram) return null;
  const container = graph.containerDiagram.containers.find((item) => item.id === containerId);
  if (!container) return null;

  const inbound = graph.containerDiagram.relationships.filter((relationship) => relationship.target === containerId);
  const outbound = graph.containerDiagram.relationships.filter((relationship) => relationship.source === containerId);

  return (
    <div style={sectionStyle}>
      <InspectorHeader title={`${container.name} connections`} subtitle={container.technology} color={container.color} />
      <div style={{ fontSize: 11, color: "#94a3b8", lineHeight: 1.5, marginBottom: 10 }}>
        Arrow direction shows runtime dependency: <span style={{ color: "#e5e7eb" }}>source -&gt; target</span> means the source container uses the target through the labeled interface.
      </div>
      <RelationshipList title="Uses" mode="outbound" relationships={outbound} onSelectEdge={selectEdge} graph={graph} />
      <RelationshipList title="Used by" mode="inbound" relationships={inbound} onSelectEdge={selectEdge} graph={graph} />
    </div>
  );
}

function ContainerOwnershipInspector({ containerId }: { containerId: string }) {
  const graph = useStore((s) => s.graph);
  const setZoomLevel = useStore((s) => s.setZoomLevel);
  const selectNode = useStore((s) => s.selectNode);
  const setComponentInspectorTab = useStore((s) => s.setComponentInspectorTab);
  if (!graph?.containerDiagram) return null;
  const container = graph.containerDiagram.containers.find((item) => item.id === containerId);
  if (!container) return null;

  return (
    <div style={sectionStyle}>
      <InspectorHeader title={`${container.name} code ownership`} subtitle={container.technology} color={container.color} />

      <div style={{ marginBottom: 12 }}>
        <div style={{ fontSize: 10, fontWeight: 700, color: "#94a3b8", textTransform: "uppercase", letterSpacing: 0.6, marginBottom: 6 }}>
          Repo paths
        </div>
        <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
          {container.codePaths.map((path) => (
            <div
              key={path}
              style={{
                fontSize: 11,
                color: "#d1d5db",
                fontFamily: "monospace",
                lineHeight: 1.5,
                padding: "7px 9px",
                border: "1px solid #273449",
                borderRadius: 8,
                background: "#0f172a",
              }}
            >
              {path}
            </div>
          ))}
        </div>
      </div>

      {container.componentTargets && container.componentTargets.length > 0 && (
        <div>
          <div style={{ fontSize: 10, fontWeight: 700, color: "#94a3b8", textTransform: "uppercase", letterSpacing: 0.6, marginBottom: 6 }}>
            Mapped components
          </div>
          {container.componentTargets.map((target) => (
            <button
              key={`${target.kind}-${target.id}`}
              type="button"
              onClick={() => {
                setZoomLevel("component");
                selectNode(target.id);
                setComponentInspectorTab("overview");
              }}
              style={actionButtonStyle}
            >
              <div style={{ fontSize: 11, fontWeight: 700, color: "#fff" }}>
                {target.kind === "boundary" ? "Open component boundary" : "Open related component"}
              </div>
              <div style={{ fontSize: 10, color: "#94a3b8", marginTop: 2 }}>{target.reason}</div>
              <div style={{ fontSize: 9, color: "#64748b", marginTop: 2, fontFamily: "monospace" }}>{target.id}</div>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

function ContainerEvidenceInspector({ containerId }: { containerId: string }) {
  const graph = useStore((s) => s.graph);
  if (!graph?.containerDiagram) return null;
  const container = graph.containerDiagram.containers.find((item) => item.id === containerId);
  if (!container) return null;

  const relatedRelationships = graph.containerDiagram.relationships.filter(
    (relationship) => relationship.source === containerId || relationship.target === containerId,
  );
  const evidenceLookup = new Map(graph.containerDiagram.evidence.map((item) => [item.id, item]));
  const evidenceIds = new Set<string>(container.evidenceIds);
  for (const relationship of relatedRelationships) {
    for (const evidenceId of relationship.evidenceIds) {
      evidenceIds.add(evidenceId);
    }
  }

  const evidence = Array.from(evidenceIds)
    .map((evidenceId) => evidenceLookup.get(evidenceId))
    .filter((item): item is NonNullable<typeof item> => Boolean(item));

  return (
    <div style={sectionStyle}>
      <InspectorHeader title={`${container.name} evidence`} subtitle={container.technology} color={container.color} />
      <div style={{ fontSize: 10, color: "#64748b", lineHeight: 1.45, marginBottom: 10 }}>
        Evidence is secondary in this view. Use it when you need to confirm why a container or connection appears the way it does.
      </div>
      {evidence.map((item) => (
        <EvidenceRow key={item.id} item={item} />
      ))}
    </div>
  );
}

function ContainerWhereToChangeInspector({ containerId }: { containerId: string }) {
  const graph = useStore((s) => s.graph);
  const setZoomLevel = useStore((s) => s.setZoomLevel);
  const selectNode = useStore((s) => s.selectNode);
  const setComponentInspectorTab = useStore((s) => s.setComponentInspectorTab);
  const setSelectedFlow = useStore((s) => s.setSelectedFlow);
  if (!graph?.containerDiagram) return null;
  const container = graph.containerDiagram.containers.find((item) => item.id === containerId);
  if (!container) return null;

  return (
    <div style={sectionStyle}>
      <InspectorHeader title={`Where to change: ${container.name}`} subtitle={container.technology} color={container.color} />
      <div style={{ fontSize: 10, color: "#64748b", lineHeight: 1.45, marginBottom: 10 }}>
        Use these curated drilldowns to move from the container view into the components, files, or flows most likely to change for this area.
      </div>
      {(container.openNext ?? []).map((target) => (
        <button
          key={`${target.label}-${target.reason}`}
          type="button"
          onClick={() => {
            if (target.target.kind === "component_boundary") {
              setZoomLevel("component");
              selectNode(target.target.boundaryId);
              setComponentInspectorTab("overview");
            } else if (target.target.kind === "component_card") {
              setZoomLevel("component");
              selectNode(target.target.cardId);
              setComponentInspectorTab("overview");
            } else if (target.target.kind === "flow") {
              setZoomLevel("flow");
              setSelectedFlow(target.target.flowId);
            } else {
              setZoomLevel("file");
              selectNode(target.target.fileId);
            }
          }}
          style={actionButtonStyle}
        >
          <div style={{ fontSize: 11, fontWeight: 700, color: "#fff" }}>{target.label}</div>
          <div style={{ fontSize: 10, color: "#94a3b8", marginTop: 2 }}>{target.reason}</div>
        </button>
      ))}
      {(container.openNext ?? []).length === 0 && (
        <div style={{ fontSize: 10, color: "#64748b" }}>No curated drilldowns for this container yet.</div>
      )}
    </div>
  );
}

function ContainerRelationshipInspector({ edgeId }: { edgeId: string }) {
  const graph = useStore((s) => s.graph);
  if (!graph?.containerDiagram) return null;
  const relationship = graph.containerDiagram.relationships.find((item) => item.id === edgeId);
  if (!relationship) return <ContainerIntroPanel />;

  const source = graph.containerDiagram.containers.find((item) => item.id === relationship.source);
  const target = graph.containerDiagram.containers.find((item) => item.id === relationship.target);
  const evidenceLookup = new Map(graph.containerDiagram.evidence.map((item) => [item.id, item]));
  const evidence = relationship.evidenceIds
    .map((evidenceId) => evidenceLookup.get(evidenceId))
    .filter((item): item is NonNullable<typeof item> => Boolean(item));

  return (
    <div style={sectionStyle}>
      <InspectorHeader
        title={`${source?.name ?? relationship.source} -> ${target?.name ?? relationship.target}`}
        subtitle={relationship.technology}
        color="#cbd5e1"
      />
      <div style={{ fontSize: 10, color: "#94a3b8", lineHeight: 1.45, marginBottom: 8 }}>
        The source container depends on the target container through this interface.
      </div>
      <div style={{ fontSize: 11, color: "#d1d5db", lineHeight: 1.55, marginBottom: 8 }}>
        {relationship.description}
      </div>
      <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginBottom: 10 }}>
        <span style={relationshipMetaBadgeStyle}>
          Interface: {relationship.technology}
        </span>
        {relationship.optional && (
          <span style={relationshipMetaBadgeStyle}>Optional</span>
        )}
        {relationship.synchronous === false && (
          <span style={relationshipMetaBadgeStyle}>Async</span>
        )}
      </div>
      {evidence.map((item) => (
        <EvidenceRow key={item.id} item={item} />
      ))}
      <div style={{ fontSize: 9, color: "#475569", marginTop: 8 }}>
        Evidence confidence: {relationship.confidence}
      </div>
    </div>
  );
}

function searchContainerDiagram(
  graph: ArchitectureGraph,
  query: string,
): Array<
  | {
    key: string;
    kind: "container";
    containerId: string;
    tab: ContainerInspectorTab;
    title: string;
    label: string;
  }
  | {
    key: string;
    kind: "relationship";
    edgeId: string;
    title: string;
    label: string;
  }
> {
  const needle = query.trim().toLowerCase();
  if (!needle || !graph.containerDiagram) return [];

  const results: Array<
    | {
      key: string;
      kind: "container";
      containerId: string;
      tab: ContainerInspectorTab;
      title: string;
      label: string;
    }
    | {
      key: string;
      kind: "relationship";
      edgeId: string;
      title: string;
      label: string;
    }
  > = [];
  const seen = new Set<string>();

  const pushResult = (result: (typeof results)[number]) => {
    if (seen.has(result.key)) return;
    seen.add(result.key);
    results.push(result);
  };

  for (const container of graph.containerDiagram.containers) {
    const containerCandidates: Array<{ candidate: string; tab: ContainerInspectorTab; label?: string }> = [
      { candidate: container.name, tab: "overview", label: `Container name: ${container.name}` },
      { candidate: container.technology, tab: "overview", label: `Technology: ${container.technology}` },
      { candidate: container.description, tab: "overview", label: container.description },
      { candidate: container.summary ?? "", tab: "overview", label: container.summary ?? "" },
      ...container.responsibilities.map((item) => ({ candidate: item, tab: "overview" as const, label: item })),
      ...container.codePaths.map((path) => ({ candidate: path, tab: "ownership" as const, label: path })),
      ...(container.componentTargets?.flatMap((target) => ([
        { candidate: target.reason, tab: "ownership" as const, label: `Mapped component: ${target.reason}` },
        { candidate: target.id, tab: "ownership" as const, label: `Mapped component id: ${target.id}` },
      ])) ?? []),
      ...(container.openNext?.flatMap((target) => ([
        { candidate: target.label, tab: "changes" as const, label: `Change entry point: ${target.label}` },
        { candidate: target.reason, tab: "changes" as const, label: target.reason },
      ])) ?? []),
    ];

    for (const entry of containerCandidates) {
      if (!entry.candidate || !entry.candidate.toLowerCase().includes(needle)) continue;
      pushResult({
        key: `container:${container.id}:${entry.tab}:${entry.label ?? entry.candidate}`,
        kind: "container",
        containerId: container.id,
        tab: entry.tab,
        title: container.name,
        label: entry.label ?? entry.candidate,
      });
    }
  }

  for (const relationship of graph.containerDiagram.relationships) {
    const source = graph.containerDiagram.containers.find((item) => item.id === relationship.source);
    const target = graph.containerDiagram.containers.find((item) => item.id === relationship.target);
    const title = `${source?.name ?? relationship.source} -> ${target?.name ?? relationship.target}`;
    const candidates = [
      relationship.description,
      relationship.technology,
      title,
      `${relationship.description} · ${relationship.technology}`,
    ];

    for (const candidate of candidates) {
      if (!candidate.toLowerCase().includes(needle)) continue;
      pushResult({
        key: `relationship:${relationship.id}:${candidate}`,
        kind: "relationship",
        edgeId: relationship.id,
        title,
        label: `${relationship.description} · ${relationship.technology}${relationship.optional ? " · optional" : ""}`,
      });
    }
  }

  return results;
}

function RelationshipList(
  {
    title,
    mode,
    relationships,
    onSelectEdge,
    graph,
  }: {
    title: string;
    mode: "inbound" | "outbound";
    relationships: ArchitectureGraph["containerDiagram"]["relationships"];
    onSelectEdge: (id: string | null) => void;
    graph: ArchitectureGraph;
  },
) {
  return (
    <div style={{ marginBottom: 12 }}>
      <div style={{ fontSize: 10, fontWeight: 700, color: "#94a3b8", textTransform: "uppercase", letterSpacing: 0.6, marginBottom: 6 }}>
        {title}
      </div>
      {relationships.length === 0 && (
        <div style={{ fontSize: 10, color: "#64748b" }}>None</div>
      )}
      {relationships.map((relationship) => {
        const otherId = mode === "inbound" ? relationship.source : relationship.target;
        const other = graph.containerDiagram?.containers.find((item) => item.id === otherId);
        return (
          <button key={relationship.id} type="button" onClick={() => onSelectEdge(relationship.id)} style={actionButtonStyle}>
            <div style={{ fontSize: 11, fontWeight: 700, color: "#fff" }}>
              {other?.name ?? otherId}
            </div>
            <div style={{ fontSize: 10, color: "#cbd5e1", marginTop: 2 }}>{relationship.description}</div>
            <div style={{ fontSize: 10, color: "#64748b", marginTop: 2 }}>
              {relationship.technology}
              {relationship.optional ? " · optional" : ""}
            </div>
          </button>
        );
      })}
    </div>
  );
}

function InspectorHeader({ title, subtitle, color }: { title: string; subtitle?: string; color: string }) {
  return (
    <div style={{ marginBottom: 10 }}>
      <div style={{ fontSize: 13, fontWeight: 800, color: "#fff" }}>{title}</div>
      {subtitle && (
        <div style={{ fontSize: 10, color: color, marginTop: 2, fontFamily: "monospace" }}>
          [{subtitle}]
        </div>
      )}
    </div>
  );
}

function EvidenceRow({ item }: { item: { kind: string; confidence: string; fileId?: string; line?: number; symbol?: string; detail: string } }) {
  return (
    <div
      style={{
        padding: "8px 10px",
        marginBottom: 6,
        border: "1px solid #273449",
        borderRadius: 8,
        background: "#0f172a",
      }}
    >
      <div style={{ fontSize: 10, color: "#94a3b8", marginBottom: 4 }}>
        {item.kind}
        {item.fileId ? ` · ${item.fileId}` : ""}
        {item.line ? `:${item.line}` : ""}
        {item.symbol ? ` · ${item.symbol}` : ""}
        {` · ${item.confidence}`}
      </div>
      <div style={{ fontSize: 11, color: "#d1d5db", lineHeight: 1.5 }}>{item.detail}</div>
    </div>
  );
}

const actionButtonStyle = {
  display: "block",
  width: "100%",
  appearance: "none" as const,
  textAlign: "left" as const,
  padding: "8px 10px",
  marginBottom: 6,
  background: "#0f172a",
  border: "1px solid #273449",
  borderRadius: 8,
  cursor: "pointer",
};

const relationshipMetaBadgeStyle = {
  fontSize: 9,
  fontWeight: 700,
  color: "#dbeafe",
  background: "#111827",
  border: "1px solid #273449",
  borderRadius: 999,
  padding: "3px 8px",
};

function DataModelTabControls(
  {
    inspectorTab,
    onSelectTab,
    focusEnabled,
    onToggleFocus,
    searchQuery,
    onSearchChange,
    showRuntimeStores,
    onToggleRuntimeStores,
    showDebugStructures,
    onToggleDebugStructures,
    expandMirrors,
    onToggleExpandMirrors,
  }: {
    inspectorTab: DataModelInspectorTab;
    onSelectTab: (tab: DataModelInspectorTab) => void;
    focusEnabled: boolean;
    onToggleFocus: () => void;
    searchQuery: string;
    onSearchChange: (query: string) => void;
    showRuntimeStores: boolean;
    onToggleRuntimeStores: () => void;
    showDebugStructures: boolean;
    onToggleDebugStructures: () => void;
    expandMirrors: boolean;
    onToggleExpandMirrors: () => void;
  },
) {
  const graph = useStore((s) => s.graph);
  const selectNode = useStore((s) => s.selectNode);
  if (!graph) return null;

  const visibility = {
    showRuntimeStores,
    showDebugStructures,
    expandMirrors,
  } satisfies DataModelVisibilityOptions;
  const searchState = searchDataModel(graph, searchQuery, visibility);
  const activeInspectorTab =
    DATA_MODEL_INSPECTOR_TABS.find((tab) => tab.value === inspectorTab) ?? DATA_MODEL_INSPECTOR_TABS[0];
  const categoryCounts = getDataModelCategoryCounts(graph, visibility, { includeHiddenCategories: true });
  const summaryStats = [
    `${visibleDataModelStructureCount(graph, visibility)} visible structures`,
    `${visibleDataModelRelationCount(graph, visibility)} visible relations`,
    `${graph.dataStructureAccesses.length} access paths`,
  ];

  return (
    <div style={sectionStyle}>
      <div style={{ fontSize: 11, fontWeight: 700, color: "#aaa", marginBottom: 8 }}>
        Data Model Explorer
      </div>

      <input
        value={searchQuery}
        onChange={(event) => onSearchChange(event.target.value)}
        placeholder="Search structures, fields, variants, access paths..."
        style={{
          width: "100%",
          boxSizing: "border-box",
          padding: "8px 10px",
          fontSize: 11,
          color: "#e5e7eb",
          background: "#0f172a",
          border: "1px solid #273449",
          borderRadius: 8,
          outline: "none",
          marginBottom: 10,
        }}
      />

      <div
        style={{
          marginBottom: 10,
          padding: "8px 10px 10px",
          border: "1px solid #273449",
          borderRadius: 10,
          background: "#0f172a",
        }}
      >
        <div style={{ display: "flex", flexWrap: "wrap", gap: 5, marginBottom: 8 }}>
          <button
            type="button"
            onClick={onToggleRuntimeStores}
            style={{
              padding: "4px 8px",
              fontSize: 9,
              fontWeight: 700,
              color: showRuntimeStores ? "#fff" : "#94a3b8",
              background: showRuntimeStores ? "#7c3aed" : "transparent",
              border: `1px solid ${showRuntimeStores ? "#8b5cf6" : "#334155"}`,
              borderRadius: 6,
              cursor: "pointer",
            }}
          >
            In-memory
          </button>
          <button
            type="button"
            onClick={onToggleDebugStructures}
            style={{
              padding: "4px 8px",
              fontSize: 9,
              fontWeight: 700,
              color: showDebugStructures ? "#fff" : "#94a3b8",
              background: showDebugStructures ? "#475569" : "transparent",
              border: `1px solid ${showDebugStructures ? "#64748b" : "#334155"}`,
              borderRadius: 6,
              cursor: "pointer",
            }}
          >
            Harnesses
          </button>
          <button
            type="button"
            onClick={onToggleExpandMirrors}
            style={{
              padding: "4px 8px",
              fontSize: 9,
              fontWeight: 700,
              color: expandMirrors ? "#fff" : "#94a3b8",
              background: expandMirrors ? "#0f766e" : "transparent",
              border: `1px solid ${expandMirrors ? "#14b8a6" : "#334155"}`,
              borderRadius: 6,
              cursor: "pointer",
            }}
          >
            Mirrors
          </button>
          <button
            type="button"
            onClick={onToggleFocus}
            style={{
              padding: "4px 8px",
              fontSize: 9,
              fontWeight: 700,
              color: focusEnabled ? "#fff" : "#94a3b8",
              background: focusEnabled ? "#1d4ed8" : "transparent",
              border: `1px solid ${focusEnabled ? "#2563eb" : "#334155"}`,
              borderRadius: 6,
              cursor: "pointer",
            }}
          >
            Focus
          </button>
        </div>

        <div style={{ fontSize: 9, color: "#64748b" }}>
          {summaryStats.join(" · ")}
        </div>
      </div>

      <div
        style={{
          marginBottom: 10,
          padding: "8px 10px 10px",
          border: "1px solid #273449",
          borderRadius: 10,
          background: "#0f172a",
        }}
      >
        <div style={{ display: "flex", flexWrap: "wrap", gap: 4 }}>
          {categoryCounts.map((item) => (
            <button
              key={item.category}
              type="button"
              onClick={() => {
                if (item.category === "in_memory" && !showRuntimeStores) {
                  onToggleRuntimeStores();
                }
                if (item.category === "debug_test" && !showDebugStructures) {
                  onToggleDebugStructures();
                }
                selectNode(`data-boundary-${item.category}`);
                onSelectTab("overview");
              }}
              style={{
                padding: "4px 8px",
                fontSize: 9,
                fontWeight: 700,
                color: item.hidden ? "#64748b" : "#e2e8f0",
                background: item.hidden ? "#0b1120" : "#111827",
                border: `1px solid ${dataModelCategoryColor(item.category)}${item.hidden ? "22" : "35"}`,
                borderRadius: 6,
                cursor: "pointer",
                opacity: item.hidden ? 0.7 : 1,
              }}
            >
              {dataModelCategoryLabel(item.category)} ({item.count})
            </button>
          ))}
        </div>
      </div>

      <div style={{ display: "flex", flexWrap: "wrap", gap: 4, marginBottom: 10 }}>
        {DATA_MODEL_INSPECTOR_TABS.map((tab) => (
          <button
            key={tab.value}
            type="button"
            onClick={() => onSelectTab(tab.value)}
            style={{
              padding: "4px 8px",
              fontSize: 9,
              fontWeight: 700,
              color: inspectorTab === tab.value ? "#fff" : "#94a3b8",
              background: inspectorTab === tab.value ? "#172033" : "transparent",
              border: `1px solid ${inspectorTab === tab.value ? "#3b82f6" : "#334155"}`,
              borderRadius: 6,
              cursor: "pointer",
            }}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {searchQuery.trim().length > 0 && (
        <div style={{ borderTop: "1px solid #252545", paddingTop: 10 }}>
          <div style={{ fontSize: 10, fontWeight: 600, color: "#94a3b8", marginBottom: 6 }}>
            Search Results
          </div>
          {searchState.results.length === 0 && (
            <div style={{ fontSize: 10, color: "#64748b" }}>
              No visible structure matches.
            </div>
          )}
          {searchState.hiddenRuntimeStoreMatches > 0 && !showRuntimeStores && (
            <button
              type="button"
              onClick={onToggleRuntimeStores}
              style={{ ...actionButtonStyle, marginBottom: 6 }}
            >
              <div style={{ fontSize: 10, color: "#fff", fontWeight: 700 }}>
                Reveal {searchState.hiddenRuntimeStoreMatches} hidden in-memory match{searchState.hiddenRuntimeStoreMatches === 1 ? "" : "es"}
              </div>
              <div style={{ fontSize: 10, color: "#94a3b8", marginTop: 3 }}>
                Search found matching RAM-backed structures, but they are hidden behind the current scope.
              </div>
            </button>
          )}
          {searchState.hiddenDebugMatches > 0 && !showDebugStructures && (
            <button
              type="button"
              onClick={onToggleDebugStructures}
              style={{ ...actionButtonStyle, marginBottom: 6 }}
            >
              <div style={{ fontSize: 10, color: "#fff", fontWeight: 700 }}>
                Reveal {searchState.hiddenDebugMatches} hidden harness/test match{searchState.hiddenDebugMatches === 1 ? "" : "es"}
              </div>
              <div style={{ fontSize: 10, color: "#94a3b8", marginTop: 3 }}>
                These are harness or diagnostic structures that stay hidden by default.
              </div>
            </button>
          )}
          {searchState.results.slice(0, 8).map((result) => (
            <button
              key={`${result.structureId}-${result.label}-${result.tab}`}
              type="button"
              onClick={() => {
                selectNode(result.structureId);
                onSelectTab(result.tab);
              }}
              style={{
                display: "block",
                width: "100%",
                textAlign: "left",
                padding: "7px 8px",
                marginBottom: 4,
                fontSize: 10,
                color: "#cbd5e1",
                background: "#0f172a",
                border: "1px solid #273449",
                borderRadius: 6,
                cursor: "pointer",
              }}
            >
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8 }}>
                <div style={{ fontWeight: 700, color: "#fff" }}>{result.structureName}</div>
                <span style={{ fontSize: 8, fontWeight: 700, color: "#93c5fd", textTransform: "uppercase" }}>{result.tab}</span>
              </div>
              <div style={{ color: "#94a3b8", marginTop: 2 }}>{result.label}</div>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

function DataModelInspector() {
  const graph = useStore((s) => s.graph);
  const selectedNodeId = useStore((s) => s.selectedNodeId);
  const selectedEdgeId = useStore((s) => s.selectedEdgeId);
  const inspectorTab = useStore((s) => s.dataModelInspectorTab);

  if (!graph) return null;
  if (!selectedNodeId && !selectedEdgeId) return <DataModelIntroPanel />;

  if (selectedEdgeId) {
    return <DataModelRelationInspector relationId={selectedEdgeId} />;
  }

  const boundaryCategory = selectedNodeId?.startsWith("data-boundary-")
    ? selectedNodeId.replace("data-boundary-", "")
    : null;
  if (boundaryCategory) {
    return <DataModelBoundaryInspector category={boundaryCategory} />;
  }

  const structure = graph.dataStructures.find((item) => item.id === selectedNodeId);
  if (!structure) return <DataModelIntroPanel />;

  switch (inspectorTab) {
    case "shape":
      return <DataModelShapeInspector structureId={structure.id} />;
    case "access":
      return <DataModelAccessInspector structureId={structure.id} />;
    case "evidence":
      return <DataModelEvidenceInspector structureId={structure.id} />;
    case "open_next":
      return <DataModelOpenNextInspector structureId={structure.id} />;
    case "overview":
    default:
      return <DataModelOverviewInspector structureId={structure.id} />;
  }
}

function DataModelIntroPanel() {
  const graph = useStore((s) => s.graph);
  const showRuntimeStores = useStore((s) => s.dataModelShowRuntimeStores);
  const showDebugStructures = useStore((s) => s.dataModelShowDebugStructures);
  const expandMirrors = useStore((s) => s.dataModelExpandMirrors);
  if (!graph) return null;
  const visibility = {
    showRuntimeStores,
    showDebugStructures,
    expandMirrors,
  } satisfies DataModelVisibilityOptions;
  const categoryCounts = getDataModelCategoryCounts(graph, visibility, { includeHiddenCategories: true });

  return (
    <div style={sectionStyle}>
      <div style={{ fontSize: 13, fontWeight: 700, color: "#fff", marginBottom: 6 }}>
        Data Model
      </div>
      <div style={{ fontSize: 11, color: "#94a3b8", lineHeight: 1.5, marginBottom: 10 }}>
        This tab shows the repo’s important data structures: gameplay models, wire contracts, database-backed shapes,
        disk-backed files, and the in-memory state or indexes that explain how those structures are accessed.
      </div>
      <div style={{ fontSize: 11, color: "#cbd5e1", lineHeight: 1.5, marginBottom: 8 }}>
        Select a structure to inspect its shape, access patterns, evidence, mirror definitions, and the next files worth opening.
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(2, minmax(0, 1fr))", gap: 6, marginBottom: 10 }}>
        {categoryCounts.map((item) => (
          <div
            key={item.category}
            style={{
              padding: "8px 9px",
              border: `1px solid ${dataModelCategoryColor(item.category)}35`,
              borderRadius: 8,
              background: "#0f172a",
            }}
          >
            <div style={{ fontSize: 10, fontWeight: 700, color: "#fff" }}>{dataModelCategoryLabel(item.category)}</div>
            <div style={{ fontSize: 9, color: "#94a3b8", marginTop: 2 }}>
              {item.count} structures{item.hidden ? " · hidden" : ""}
            </div>
          </div>
        ))}
      </div>
      <div style={{ fontSize: 10, color: "#64748b", lineHeight: 1.5 }}>
        Edges show containment, wire serialization, database mapping, disk loading, in-memory storage, and indexing. Mirror duplicates are collapsed by default.
      </div>
    </div>
  );
}

function DataModelBoundaryInspector({ category }: { category: string }) {
  const graph = useStore((s) => s.graph);
  const selectNode = useStore((s) => s.selectNode);
  const setDataModelInspectorTab = useStore((s) => s.setDataModelInspectorTab);
  const showRuntimeStores = useStore((s) => s.dataModelShowRuntimeStores);
  const showDebugStructures = useStore((s) => s.dataModelShowDebugStructures);
  const expandMirrors = useStore((s) => s.dataModelExpandMirrors);
  if (!graph) return null;
  const visibility = {
    showRuntimeStores,
    showDebugStructures,
    expandMirrors,
  } satisfies DataModelVisibilityOptions;
  const items = getVisibleDataStructures(graph, visibility)
    .filter((structure) => structure.category === category)
    .sort(compareStructureOrder);
  const grouped = groupStructuresByConcept(items);

  return (
    <div style={sectionStyle}>
      <InspectorHeader
        title={`${dataModelCategoryLabel(category)} category`}
        subtitle={`${items.length} structures`}
        color={dataModelCategoryColor(category)}
      />
      <div style={{ fontSize: 11, color: "#cbd5e1", lineHeight: 1.5, marginBottom: 10 }}>
        {describeDataModelCategory(category)}
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(2, minmax(0, 1fr))", gap: 6, marginBottom: 10 }}>
        {grouped.map((group) => (
          <div
            key={group.conceptGroup}
            style={{
              padding: "8px 9px",
              border: "1px solid #273449",
              borderRadius: 8,
              background: "#0f172a",
            }}
          >
            <div style={{ fontSize: 10, fontWeight: 700, color: "#fff" }}>{getConceptGroupLabel(group.conceptGroup)}</div>
            <div style={{ fontSize: 9, color: "#94a3b8", marginTop: 2 }}>{group.items.length} structures</div>
          </div>
        ))}
      </div>
      {grouped.map((group) => (
        <div key={group.conceptGroup} style={{ marginBottom: 12 }}>
          <div style={{ fontSize: 10, fontWeight: 700, color: "#94a3b8", marginBottom: 6 }}>
            {getConceptGroupLabel(group.conceptGroup)}
          </div>
          {group.items.map((item) => (
            <button
              key={item.id}
              type="button"
              onClick={() => {
                selectNode(item.id);
                setDataModelInspectorTab("overview");
              }}
              style={actionButtonStyle}
            >
              <div style={{ fontSize: 10, color: "#fff", fontWeight: 700 }}>{item.name}</div>
              <div style={{ fontSize: 10, color: "#94a3b8", marginTop: 2 }}>
                {humanizeDataStructureKindLabel(item.kind)} · {item.fields.length} fields · {item.variants.length} variants
              </div>
            </button>
          ))}
        </div>
      ))}
    </div>
  );
}

function DataModelOverviewInspector({ structureId }: { structureId: string }) {
  const graph = useStore((s) => s.graph);
  if (!graph) return null;
  const structure = getStructureById(graph, structureId);
  if (!structure) return null;
  const family = getStructureFamily(graph, structure);
  const familyIds = new Set(family.map((item) => item.id));

  const mirrorNames = family
    .filter((item) => item.id !== structure.id)
    .map((item) => `${item.name} · ${item.fileId}`);
  const accessCount = graph.dataStructureAccesses.filter((item) => familyIds.has(item.structureId)).length;
  const relationCount = graph.dataStructureRelations.filter((item) => familyIds.has(item.sourceId) || familyIds.has(item.targetId)).length;
  const evidenceCount = collectStructureEvidence(graph, family).length;
  const badges = buildStructureOverviewBadges(structure, family.length);

  return (
    <div style={sectionStyle}>
      <InspectorHeader
        title={structure.name}
        subtitle={`${dataModelCategoryLabel(structure.category)} · ${humanizeDataStructureKindLabel(structure.kind)}`}
        color={dataModelCategoryColor(structure.category)}
      />

      <div style={{ fontSize: 11, color: "#cbd5e1", lineHeight: 1.55, marginBottom: 10 }}>
        {structure.summary ?? structure.purpose ?? "No summary extracted for this structure."}
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "repeat(2, minmax(0, 1fr))", gap: 6, marginBottom: 10 }}>
        {[
          `${structure.fields.length} fields`,
          `${structure.variants.length} variants`,
          `${accessCount} accesses`,
          `${relationCount} relationships`,
          `${evidenceCount} evidence rows`,
          `${mirrorNames.length} mirrors`,
        ].map((item) => (
          <div
            key={item}
            style={{
              padding: "7px 8px",
              border: "1px solid #273449",
              borderRadius: 8,
              background: "#0f172a",
              fontSize: 10,
              fontWeight: 700,
              color: "#e2e8f0",
            }}
          >
            {item}
          </div>
        ))}
      </div>

      {badges.length > 0 && (
        <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginBottom: 10 }}>
          {badges.map((badge) => (
            <span
              key={badge}
              style={{
                fontSize: 10,
                fontWeight: 700,
                color: "#e5e7eb",
                border: `1px solid ${dataModelCategoryColor(structure.category)}35`,
                background: `${dataModelCategoryColor(structure.category)}12`,
                borderRadius: 999,
                padding: "3px 8px",
              }}
            >
              {badge}
            </span>
          ))}
        </div>
      )}

      <div style={{ fontSize: 10, color: "#94a3b8", marginBottom: 3 }}>Storage medium</div>
      <div style={{ fontSize: 10, color: "#e2e8f0", marginBottom: 10 }}>
        {dataModelStorageLabel(structure.category)}
      </div>

      <div style={{ fontSize: 10, color: "#94a3b8", marginBottom: 3 }}>Source</div>
      <div style={{ fontSize: 10, color: "#e2e8f0", fontFamily: "monospace", marginBottom: 10 }}>{structure.fileId}</div>

      <div style={{ fontSize: 10, color: "#94a3b8", marginBottom: 3 }}>Why it exists</div>
      <div style={{ fontSize: 10, color: "#e2e8f0", marginBottom: 10 }}>
        {structure.purpose ?? structure.summary ?? "No purpose summary extracted."}
      </div>

      {structure.conceptGroup && (
        <>
          <div style={{ fontSize: 10, color: "#94a3b8", marginBottom: 3 }}>Concept group</div>
          <div style={{ fontSize: 10, color: "#e2e8f0", marginBottom: 10 }}>
            {getConceptGroupLabel(structure.conceptGroup)}
          </div>
        </>
      )}

      <div style={{ fontSize: 10, color: "#94a3b8", marginBottom: 3 }}>Shape</div>
      <div style={{ fontSize: 10, color: "#e2e8f0", marginBottom: 10 }}>
        {structure.fields.length} top-level fields · {structure.variants.length} variants
      </div>

      {mirrorNames.length > 0 && (
        <>
          <div style={{ fontSize: 10, color: "#94a3b8", marginBottom: 3 }}>Mirrors</div>
          {mirrorNames.map((label) => (
            <div key={label} style={{ fontSize: 10, color: "#e2e8f0", marginBottom: 2 }}>
              {label}
            </div>
          ))}
        </>
      )}
    </div>
  );
}

function DataModelShapeInspector({ structureId }: { structureId: string }) {
  const graph = useStore((s) => s.graph);
  const selectNode = useStore((s) => s.selectNode);
  const setDataModelInspectorTab = useStore((s) => s.setDataModelInspectorTab);
  if (!graph) return null;
  const structure = graph.dataStructures.find((item) => item.id === structureId);
  if (!structure) return null;

  return (
    <div style={sectionStyle}>
      <InspectorHeader
        title={`${structure.name} shape`}
        subtitle={humanizeDataStructureKindLabel(structure.kind)}
        color={dataModelCategoryColor(structure.category)}
      />

      {structure.fields.length > 0 && (
        <div style={{ marginBottom: 12 }}>
          <div style={{ fontSize: 10, fontWeight: 700, color: "#94a3b8", marginBottom: 6 }}>Fields</div>
          {structure.fields.map((field) => (
            <div
              key={field.id}
              style={{
                padding: "7px 8px",
                marginBottom: 6,
                border: "1px solid #273449",
                borderRadius: 8,
                background: "#0f172a",
              }}
            >
              <div style={{ fontSize: 10, color: "#fff", fontWeight: 700, fontFamily: "monospace" }}>
                {field.name}
                {field.optional ? "?" : ""}: {field.typeText}
              </div>
              {field.description && (
                <div style={{ fontSize: 10, color: "#94a3b8", marginTop: 3, lineHeight: 1.45 }}>{field.description}</div>
              )}
              {field.referencedStructureId && (
                <button
                  type="button"
                  onClick={() => {
                    selectNode(field.referencedStructureId ?? null);
                    setDataModelInspectorTab("shape");
                  }}
                  style={{
                    marginTop: 5,
                    padding: "4px 6px",
                    fontSize: 9,
                    color: "#bfdbfe",
                    background: "#172033",
                    border: "1px solid #334155",
                    borderRadius: 6,
                    cursor: "pointer",
                  }}
                >
                  Open nested structure
                </button>
              )}
            </div>
          ))}
        </div>
      )}

      {structure.variants.length > 0 && (
        <div>
          <div style={{ fontSize: 10, fontWeight: 700, color: "#94a3b8", marginBottom: 6 }}>Variants</div>
          {structure.variants.map((variant) => (
            <div
              key={variant.id}
              style={{
                padding: "8px 10px",
                marginBottom: 8,
                border: "1px solid #273449",
                borderRadius: 8,
                background: "#0f172a",
              }}
            >
              <div style={{ fontSize: 10, color: "#fff", fontWeight: 700, fontFamily: "monospace" }}>
                {variant.discriminatorField && variant.discriminatorValue
                  ? `${variant.discriminatorField}="${variant.discriminatorValue}"`
                  : variant.label}
              </div>
              {variant.fields.length === 0 ? (
                <div style={{ fontSize: 10, color: "#94a3b8", marginTop: 4 }}>No additional payload fields.</div>
              ) : (
                variant.fields.map((field) => (
                  <div key={field.id} style={{ fontSize: 10, color: "#e2e8f0", marginTop: 4, fontFamily: "monospace" }}>
                    {field.name}
                    {field.optional ? "?" : ""}: {field.typeText}
                  </div>
                ))
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function DataModelAccessInspector({ structureId }: { structureId: string }) {
  const graph = useStore((s) => s.graph);
  if (!graph) return null;
  const structure = getStructureById(graph, structureId);
  if (!structure) return null;
  const family = getStructureFamily(graph, structure);
  const familyIds = new Set(family.map((item) => item.id));

  const accesses = graph.dataStructureAccesses
    .filter((access) => familyIds.has(access.structureId))
    .sort((left, right) => {
      const leftKey = `${left.accessKind}:${left.actorFileId}:${left.actorName ?? ""}`;
      const rightKey = `${right.accessKind}:${right.actorFileId}:${right.actorName ?? ""}`;
      return leftKey.localeCompare(rightKey);
    });

  const relationSummaries = dedupeStructureRelations(
    graph.dataStructureRelations.filter(
      (relation) => familyIds.has(relation.sourceId) || familyIds.has(relation.targetId),
    ),
  );
  const highSignalAccesses = accesses.filter((access) => !isLowSignalDataAccess(access));
  const lowSignalCount = accesses.length - highSignalAccesses.length;
  const groupedAccesses = groupAccessesForInspector(highSignalAccesses);

  return (
    <div style={sectionStyle}>
      <InspectorHeader
        title={`${structure.name} access patterns`}
        subtitle={dataModelCategoryLabel(structure.category)}
        color={dataModelCategoryColor(structure.category)}
      />

      {relationSummaries.length > 0 && (
        <div style={{ marginBottom: 12 }}>
          <div style={{ fontSize: 10, fontWeight: 700, color: "#94a3b8", marginBottom: 6 }}>Structural relationships</div>
          {relationSummaries.map((relation) => {
            const otherId = familyIds.has(relation.sourceId) ? relation.targetId : relation.sourceId;
            const other = getStructureById(graph, otherId);
            return (
              <div
                key={relation.id}
                style={{
                  padding: "7px 8px",
                  marginBottom: 6,
                  border: "1px solid #273449",
                  borderRadius: 8,
                  background: "#0f172a",
                }}
              >
                <div style={{ fontSize: 10, color: "#fff", fontWeight: 700 }}>
                  {humanizeDataRelationKind(relation.kind)} · {other?.name ?? otherId}
                </div>
                <div style={{ fontSize: 10, color: "#94a3b8", marginTop: 3, lineHeight: 1.45 }}>
                  {relation.reason ?? relation.label}
                </div>
              </div>
            );
          })}
        </div>
      )}

      <div>
        <div style={{ fontSize: 10, fontWeight: 700, color: "#94a3b8", marginBottom: 6 }}>Direct accesses</div>
        {groupedAccesses.length === 0 && (
          <div style={{ fontSize: 10, color: "#64748b" }}>No direct access rows extracted for this structure.</div>
        )}
        {groupedAccesses.map((group) => (
          <div key={group.label} style={{ marginBottom: 12 }}>
            <div style={{ fontSize: 10, fontWeight: 700, color: "#cbd5e1", marginBottom: 6 }}>{group.label}</div>
            {group.items.map((access) => (
              <div
                key={access.id}
                style={{
                  padding: "8px 10px",
                  marginBottom: 8,
                  border: "1px solid #273449",
                  borderRadius: 8,
                  background: "#0f172a",
                }}
              >
                <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8 }}>
                  <div style={{ fontSize: 10, color: "#fff", fontWeight: 700 }}>
                    {humanizeDataAccessKind(access.accessKind)}
                    {access.actorName ? ` · ${access.actorName}` : ""}
                  </div>
                  <span
                    style={{
                      fontSize: 8,
                      fontWeight: 800,
                      color: "#bfdbfe",
                      background: "#172033",
                      border: "1px solid #334155",
                      borderRadius: 999,
                      padding: "2px 6px",
                    }}
                  >
                    {humanizeDataLifecycle(access.lifecycle)}
                  </span>
                </div>
                <div style={{ fontSize: 10, color: "#94a3b8", marginTop: 3, lineHeight: 1.45 }}>
                  {access.reason ?? "No explanation extracted."}
                </div>
                <div style={{ fontSize: 9, color: "#64748b", marginTop: 4, fontFamily: "monospace" }}>
                  {access.actorFileId}
                  {access.line ? `:${access.line}` : ""}
                  {access.accessPath ? ` · ${access.accessPath}` : ""}
                </div>
              </div>
            ))}
          </div>
        ))}
        {lowSignalCount > 0 && (
          <div style={{ fontSize: 10, color: "#64748b", lineHeight: 1.45 }}>
            {lowSignalCount} low-signal typed reference{lowSignalCount === 1 ? "" : "s"} hidden to keep the access view focused on reads, writes, indexes, wire serialization, and database access.
          </div>
        )}
      </div>
    </div>
  );
}

function DataModelEvidenceInspector({ structureId }: { structureId: string }) {
  const graph = useStore((s) => s.graph);
  if (!graph) return null;
  const structure = getStructureById(graph, structureId);
  if (!structure) return null;
  const family = getStructureFamily(graph, structure);
  const items = collectStructureEvidence(graph, family);

  return (
    <div style={sectionStyle}>
      <InspectorHeader
        title={`${structure.name} evidence`}
        subtitle={structure.fileId}
        color={dataModelCategoryColor(structure.category)}
      />
      {items.map((item) => (
        <EvidenceRow key={item.id} item={item} />
      ))}
    </div>
  );
}

function DataModelOpenNextInspector({ structureId }: { structureId: string }) {
  const graph = useStore((s) => s.graph);
  const setZoomLevel = useStore((s) => s.setZoomLevel);
  const selectNode = useStore((s) => s.selectNode);
  if (!graph) return null;
  const structure = getStructureById(graph, structureId);
  if (!structure) return null;
  const family = getStructureFamily(graph, structure);
  const familyIds = new Set(family.map((item) => item.id));

  const recommendations: Array<{ fileId: string; reason: string }> = [];
  recommendations.push({ fileId: structure.fileId, reason: "Canonical definition of the structure." });

  for (const access of graph.dataStructureAccesses.filter((item) => familyIds.has(item.structureId))) {
    recommendations.push({
      fileId: access.actorFileId,
      reason: `${humanizeDataAccessKind(access.accessKind)} path${access.actorName ? ` in ${access.actorName}` : ""}.`,
    });
  }

  for (const relation of graph.dataStructureRelations.filter((item) => familyIds.has(item.sourceId) || familyIds.has(item.targetId))) {
    const otherId = familyIds.has(relation.sourceId) ? relation.targetId : relation.sourceId;
    const other = getStructureById(graph, otherId);
    if (!other) continue;
    recommendations.push({
      fileId: other.fileId,
      reason: `${humanizeDataRelationKind(relation.kind)} relationship with ${other.name}.`,
    });
  }

  const unique = recommendations
    .filter((item, index, items) => items.findIndex((other) => other.fileId === item.fileId) === index)
    .sort((left, right) => scoreReadNextFile(left.fileId, structure) - scoreReadNextFile(right.fileId, structure));

  return (
    <div style={sectionStyle}>
      <InspectorHeader
        title={`Open next: ${structure.name}`}
        subtitle={structure.fileId}
        color={dataModelCategoryColor(structure.category)}
      />
      {unique.slice(0, 6).map((item) => (
        <button
          key={`${item.fileId}-${item.reason}`}
          type="button"
          onClick={() => {
            setZoomLevel("file");
            selectNode(item.fileId);
          }}
          style={actionButtonStyle}
        >
          <div style={{ fontSize: 10, color: "#fff", fontWeight: 700, fontFamily: "monospace" }}>{item.fileId}</div>
          <div style={{ fontSize: 10, color: "#94a3b8", marginTop: 3 }}>{item.reason}</div>
        </button>
      ))}
    </div>
  );
}

function DataModelRelationInspector({ relationId }: { relationId: string }) {
  const graph = useStore((s) => s.graph);
  if (!graph) return null;
  const relation = graph.dataStructureRelations.find((item) => item.id === relationId);
  if (!relation) return <DataModelIntroPanel />;

  const source = graph.dataStructures.find((item) => item.id === relation.sourceId);
  const target = graph.dataStructures.find((item) => item.id === relation.targetId);
  const evidenceLookup = new Map(graph.dataModelEvidence.map((item) => [item.id, item]));
  const evidence = relation.evidenceIds
    .map((evidenceId) => evidenceLookup.get(evidenceId))
    .filter((item): item is NonNullable<typeof item> => Boolean(item));

  return (
    <div style={sectionStyle}>
      <InspectorHeader
        title={`${source?.name ?? relation.sourceId} -> ${target?.name ?? relation.targetId}`}
        subtitle={humanizeDataRelationKind(relation.kind)}
        color="#cbd5e1"
      />
      <div style={{ fontSize: 11, color: "#d1d5db", lineHeight: 1.55, marginBottom: 10 }}>
        {relation.reason ?? relation.label}
      </div>
      {evidence.map((item) => (
        <EvidenceRow key={item.id} item={item} />
      ))}
    </div>
  );
}

function searchDataModel(
  graph: ArchitectureGraph,
  query: string,
  visibility: DataModelVisibilityOptions,
): {
  results: Array<{
    structureId: string;
    structureName: string;
    label: string;
    tab: DataModelInspectorTab;
  }>;
  hiddenRuntimeStoreMatches: number;
  hiddenDebugMatches: number;
} {
  const needle = query.trim().toLowerCase();
  if (!needle) {
    return { results: [], hiddenRuntimeStoreMatches: 0, hiddenDebugMatches: 0 };
  }

  const visibleStructures = getVisibleDataStructures(graph, visibility);
  const results: Array<{ structureId: string; structureName: string; label: string; tab: DataModelInspectorTab }> = [];
  const seen = new Set<string>();
  let hiddenRuntimeStoreMatches = 0;
  let hiddenDebugMatches = 0;

  for (const structure of visibleStructures) {
    const family = getStructureFamily(graph, structure);
    const familyIds = new Set(family.map((item) => item.id));
    const maybePush = (label: string, tab: DataModelInspectorTab) => {
      if (!label.toLowerCase().includes(needle)) return;
      const key = `${structure.id}:${tab}:${label}`;
      if (seen.has(key)) return;
      seen.add(key);
      results.push({
        structureId: structure.id,
        structureName: structure.name,
        label,
        tab,
      });
    };

    maybePush(structure.name, "overview");
    if (structure.summary) maybePush(structure.summary, "overview");
    maybePush(structure.fileId, "overview");
    for (const mirror of family.filter((item) => item.id !== structure.id)) {
      maybePush(`Mirrored in ${mirror.fileId}`, "overview");
    }
    for (const field of structure.fields) {
      maybePush(`${field.name}: ${field.typeText}`, "shape");
    }
    for (const variant of structure.variants) {
      maybePush(variant.discriminatorValue ?? variant.label, "shape");
      for (const field of variant.fields) maybePush(`${field.name}: ${field.typeText}`, "shape");
    }
    for (const access of graph.dataStructureAccesses.filter((item) => familyIds.has(item.structureId))) {
      if (access.actorName) maybePush(access.actorName, "access");
      if (access.accessPath) maybePush(access.accessPath, "access");
      if (access.reason) maybePush(access.reason, "access");
    }
  }

  for (const structure of graph.dataStructures) {
    const familyLeader = getFamilyLeader(graph, structure);
    const hiddenByMirror = !visibility.expandMirrors && Boolean(familyLeader && familyLeader.id !== structure.id && structure.mirrorIds.length > 0);
    const hiddenByStore = !visibility.showRuntimeStores && structure.category === "in_memory";
    const hiddenByDebug = !visibility.showDebugStructures && structure.category === "debug_test";
    if (!hiddenByStore && !hiddenByDebug && !hiddenByMirror) continue;
    const haystack = [
      structure.name,
      structure.summary ?? "",
      structure.purpose ?? "",
      structure.fileId,
      ...structure.fields.map((field) => `${field.name}: ${field.typeText}`),
      ...structure.variants.map((variant) => variant.discriminatorValue ?? variant.label),
    ].join(" ").toLowerCase();
    if (!haystack.includes(needle)) continue;
    if (hiddenByStore) hiddenRuntimeStoreMatches += 1;
    if (hiddenByDebug) hiddenDebugMatches += 1;
  }

  return {
    results: results.sort((left, right) => {
      const leftNameScore = left.structureName.toLowerCase() === needle ? 0 : left.structureName.toLowerCase().startsWith(needle) ? 1 : 2;
      const rightNameScore = right.structureName.toLowerCase() === needle ? 0 : right.structureName.toLowerCase().startsWith(needle) ? 1 : 2;
      return leftNameScore - rightNameScore || left.structureName.localeCompare(right.structureName) || left.label.localeCompare(right.label);
    }),
    hiddenRuntimeStoreMatches,
    hiddenDebugMatches,
  };
}

function visibleDataModelStructureCount(graph: ArchitectureGraph, visibility: DataModelVisibilityOptions): number {
  return getVisibleDataStructures(graph, visibility).length;
}

function visibleDataModelRelationCount(graph: ArchitectureGraph, visibility: DataModelVisibilityOptions): number {
  const visibleIds = new Set(getVisibleDataStructures(graph, visibility).map((structure) => structure.id));
  const collapsedRelationKeys = new Set<string>();
  for (const relation of graph.dataStructureRelations) {
    if (relation.kind === "mirrors" && !visibility.expandMirrors) continue;
    const sourceId = visibility.expandMirrors ? relation.sourceId : getFamilyLeader(graph, relation.sourceId)?.id ?? relation.sourceId;
    const targetId = visibility.expandMirrors ? relation.targetId : getFamilyLeader(graph, relation.targetId)?.id ?? relation.targetId;
    if (sourceId === targetId) continue;
    if (!visibleIds.has(sourceId) || !visibleIds.has(targetId)) continue;
    collapsedRelationKeys.add(`${relation.kind}:${sourceId}:${targetId}`);
  }
  return collapsedRelationKeys.size;
}

function getDataModelCategoryCounts(
  graph: ArchitectureGraph,
  visibility: DataModelVisibilityOptions,
  options?: { includeHiddenCategories?: boolean },
): Array<{ category: string; count: number; hidden: boolean }> {
  const visibleCounts = new Map<string, number>();
  for (const structure of getVisibleDataStructures(graph, visibility)) {
    visibleCounts.set(structure.category, (visibleCounts.get(structure.category) ?? 0) + 1);
  }

  const totalCounts = new Map<string, number>();
  const expandedVisibility = {
    showRuntimeStores: true,
    showDebugStructures: true,
    expandMirrors: visibility.expandMirrors,
  } satisfies DataModelVisibilityOptions;
  for (const structure of getVisibleDataStructures(graph, expandedVisibility)) {
    totalCounts.set(structure.category, (totalCounts.get(structure.category) ?? 0) + 1);
  }

  return DATA_MODEL_CATEGORY_ORDER
    .map((category) => {
      const visibleCount = visibleCounts.get(category) ?? 0;
      const totalCount = totalCounts.get(category) ?? 0;
      return {
        category,
        count: options?.includeHiddenCategories ? totalCount : visibleCount,
        hidden: totalCount > 0 && visibleCount === 0,
      };
    })
    .filter((item) => item.count > 0);
}

function dataModelCategoryLabel(category: string): string {
  return DATA_MODEL_CATEGORY_META[category as keyof typeof DATA_MODEL_CATEGORY_META]?.label
    ?? category.replaceAll("_", " ").replace(/\b\w/g, (value) => value.toUpperCase());
}

function dataModelCategoryColor(category: string): string {
  return DATA_MODEL_CATEGORY_META[category as keyof typeof DATA_MODEL_CATEGORY_META]?.color ?? "#cbd5e1";
}

function describeDataModelCategory(category: string): string {
  return DATA_MODEL_CATEGORY_META[category as keyof typeof DATA_MODEL_CATEGORY_META]?.description ?? "Data structures in this category.";
}

function dataModelStorageLabel(category: string): string {
  switch (category) {
    case "in_memory":
      return "Process memory (RAM)";
    case "database":
      return "Database-backed storage";
    case "disk_file":
      return "Disk-backed file";
    case "transport":
      return "Wire payload / network contract";
    case "ui_view":
      return "UI-facing view model";
    case "debug_test":
      return "Harness / test-only model";
    default:
      return "Authoritative gameplay state";
  }
}

function humanizeDataStructureKindLabel(kind: string): string {
  switch (kind) {
    case "type_alias":
      return "Type alias";
    default:
      return kind.replaceAll("_", " ").replace(/^\w/, (c) => c.toUpperCase());
  }
}

function humanizeDataAccessKind(kind: string): string {
  switch (kind) {
    case "index_lookup":
      return "Index lookup";
    case "persist_read":
      return "Persistence read";
    case "persist_write":
      return "Persistence write";
    default:
      return kind.replaceAll("_", " ").replace(/\b\w/g, (value) => value.toUpperCase());
  }
}

function humanizeDataLifecycle(lifecycle: string): string {
  switch (lifecycle) {
    case "tick_path":
      return "tick path";
    case "event_driven":
      return "event driven";
    case "request_path":
      return "request path";
    case "debug_only":
      return "debug only";
    case "test_only":
      return "test only";
    default:
      return lifecycle.replaceAll("_", " ");
  }
}

function humanizeDataRelationKind(kind: string): string {
  switch (kind) {
    case "persisted_as":
      return "Persisted as";
    case "serialized_as":
      return "Serialized as";
    case "loaded_from":
      return "Loaded from";
    case "stored_in":
      return "Stored in";
    case "indexed_by":
      return "Indexed by";
    default:
      return kind.replaceAll("_", " ").replace(/\b\w/g, (value) => value.toUpperCase());
  }
}

function buildStructureOverviewBadges(
  structure: ArchitectureGraph["dataStructures"][number],
  familySize: number,
): string[] {
  const badges = [...structure.badges];
  if (structure.canonical) badges.unshift("Canonical");
  if (familySize > 1 && !badges.includes("Mirrored")) badges.push("Mirrored");
  return badges;
}

function collectStructureEvidence(
  graph: ArchitectureGraph,
  family: ArchitectureGraph["dataStructures"],
): ArchitectureGraph["dataModelEvidence"] {
  const evidenceLookup = new Map(graph.dataModelEvidence.map((item) => [item.id, item]));
  const familyIds = new Set(family.map((item) => item.id));
  const evidenceIds = new Set<string>();
  for (const structure of family) {
    for (const evidenceId of structure.evidenceIds) evidenceIds.add(evidenceId);
    for (const field of structure.fields) {
      for (const evidenceId of field.evidenceIds) evidenceIds.add(evidenceId);
    }
    for (const variant of structure.variants) {
      for (const evidenceId of variant.evidenceIds) evidenceIds.add(evidenceId);
      for (const field of variant.fields) {
        for (const evidenceId of field.evidenceIds) evidenceIds.add(evidenceId);
      }
    }
  }
  for (const access of graph.dataStructureAccesses.filter((item) => familyIds.has(item.structureId))) {
    for (const evidenceId of access.evidenceIds) evidenceIds.add(evidenceId);
  }
  for (const relation of graph.dataStructureRelations.filter((item) => familyIds.has(item.sourceId) || familyIds.has(item.targetId))) {
    for (const evidenceId of relation.evidenceIds) evidenceIds.add(evidenceId);
  }
  return Array.from(evidenceIds)
    .map((id) => evidenceLookup.get(id))
    .filter((item): item is NonNullable<typeof item> => Boolean(item))
    .sort((left, right) => `${left.fileId}:${left.line ?? 0}`.localeCompare(`${right.fileId}:${right.line ?? 0}`));
}

function groupStructuresByConcept(
  items: ArchitectureGraph["dataStructures"],
): Array<{ conceptGroup?: string; items: ArchitectureGraph["dataStructures"] }> {
  const groups = new Map<string | undefined, ArchitectureGraph["dataStructures"]>();
  for (const item of items) {
    const existing = groups.get(item.conceptGroup) ?? [];
    existing.push(item);
    groups.set(item.conceptGroup, existing);
  }
  return Array.from(groups.entries())
    .map(([conceptGroup, groupItems]) => ({ conceptGroup, items: groupItems }))
    .sort((left, right) => getConceptGroupLabel(left.conceptGroup).localeCompare(getConceptGroupLabel(right.conceptGroup)));
}

function dedupeStructureRelations(
  relations: ArchitectureGraph["dataStructureRelations"],
): ArchitectureGraph["dataStructureRelations"] {
  const seen = new Set<string>();
  return relations.filter((relation) => {
    const key = `${relation.kind}:${relation.sourceId}:${relation.targetId}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function isLowSignalDataAccess(
  access: ArchitectureGraph["dataStructureAccesses"][number],
): boolean {
  if (access.accessKind === "write" || access.accessKind === "lookup" || access.accessKind === "index_lookup") return false;
  if (access.accessKind === "iterate" || access.accessKind === "serialize" || access.accessKind === "deserialize") return false;
  if (access.accessKind === "persist_read" || access.accessKind === "persist_write" || access.accessKind === "append" || access.accessKind === "remove") return false;
  const reason = access.reason ?? "";
  return reason === "Return type." || reason.startsWith("Parameter ") || reason === "Local typed value.";
}

function groupAccessesForInspector(
  accesses: ArchitectureGraph["dataStructureAccesses"],
): Array<{ label: string; items: ArchitectureGraph["dataStructureAccesses"] }> {
  const sections = new Map<string, ArchitectureGraph["dataStructureAccesses"]>();
  for (const access of accesses) {
    const label = accessGroupLabel(access.accessKind);
    const items = sections.get(label) ?? [];
    items.push(access);
    sections.set(label, items);
  }
  return Array.from(sections.entries()).map(([label, items]) => ({
    label,
    items: items.sort((left, right) => {
      const lifecycleDelta = humanizeDataLifecycle(left.lifecycle).localeCompare(humanizeDataLifecycle(right.lifecycle));
      if (lifecycleDelta !== 0) return lifecycleDelta;
      return `${left.actorFileId}:${left.actorName ?? ""}`.localeCompare(`${right.actorFileId}:${right.actorName ?? ""}`);
    }),
  }));
}

function accessGroupLabel(kind: string): string {
  if (kind === "lookup" || kind === "index_lookup" || kind === "iterate") return "Lookup & iteration";
  if (kind === "write" || kind === "append" || kind === "remove" || kind === "create") return "Writes & mutation";
  if (kind === "serialize" || kind === "deserialize" || kind === "persist_read" || kind === "persist_write" || kind === "mirror") {
    return "Wire & storage";
  }
  return "Other references";
}

function scoreReadNextFile(
  fileId: string,
  structure: ArchitectureGraph["dataStructures"][number],
): number {
  let score = 0;
  if (fileId === structure.fileId) score -= 100;
  if (fileId.startsWith("server/src/engine/")) score -= 30;
  if (fileId.startsWith("server/src/network/")) score -= 20;
  if (fileId.startsWith("server/src/db/")) score -= 18;
  if (fileId.startsWith("client/src/types.ts")) score -= 16;
  if (fileId.startsWith("client/src/")) score -= 8;
  if (fileId.includes("/debug/")) score += 40;
  return score;
}

// ---------------------------------------------------------------------------
// Dependency view controls + inspector
// ---------------------------------------------------------------------------

const DEPENDENCY_INSPECTOR_TABS: {
  value: DependencyInspectorTab;
  label: string;
  description: string;
}[] = [
  { value: "overview", label: "Overview", description: "Module summary, files, metrics." },
  { value: "dependencies", label: "Deps", description: "Inbound and outbound dependencies." },
  { value: "metrics", label: "Metrics", description: "All modules ranked by instability." },
  { value: "cycles", label: "Cycles", description: "Detected circular dependency chains." },
];

function DependencyTabControls({
  inspectorTab,
  onSelectTab,
  granularity,
  onSelectGranularity,
  focusEnabled,
  onToggleFocus,
  showCircularOnly,
  onToggleCircularOnly,
  hideTypeOnly,
  onToggleHideTypeOnly,
}: {
  inspectorTab: DependencyInspectorTab;
  onSelectTab: (tab: DependencyInspectorTab) => void;
  granularity: string;
  onSelectGranularity: (g: "module" | "file" | "symbol") => void;
  focusEnabled: boolean;
  onToggleFocus: () => void;
  showCircularOnly: boolean;
  onToggleCircularOnly: () => void;
  hideTypeOnly: boolean;
  onToggleHideTypeOnly: () => void;
}) {
  return (
    <>
      {/* Granularity toggle */}
      <div style={{ ...sectionStyle, padding: "8px 10px" }}>
        <div style={{ fontSize: 9, fontWeight: 700, color: "#64748b", marginBottom: 6 }}>GRANULARITY</div>
        <div style={{ display: "flex", gap: 4, marginBottom: 10 }}>
          {(["module", "file", "symbol"] as const).map((g) => (
            <button
              key={g}
              onClick={() => onSelectGranularity(g)}
              style={{
                flex: 1,
                padding: "5px 6px",
                fontSize: 10,
                fontWeight: granularity === g ? 700 : 400,
                background: granularity === g ? "#1a2a3a" : "transparent",
                color: granularity === g ? "#fff" : "#666",
                border: `1px solid ${granularity === g ? "#2a4a6a" : "#252545"}`,
                borderRadius: 5,
                cursor: "pointer",
              }}
            >
              {g === "symbol" ? "Class / Fn" : g === "file" ? "File" : "Module"}
            </button>
          ))}
        </div>
        <div style={{ fontSize: 9, fontWeight: 700, color: "#64748b", marginBottom: 6 }}>INSPECTOR</div>
        <div style={{ display: "flex", gap: 4, marginBottom: 8 }}>
          {DEPENDENCY_INSPECTOR_TABS.map((tab) => (
            <button
              key={tab.value}
              onClick={() => onSelectTab(tab.value)}
              title={tab.description}
              style={{
                flex: 1,
                padding: "5px 6px",
                fontSize: 10,
                fontWeight: inspectorTab === tab.value ? 700 : 400,
                background: inspectorTab === tab.value ? "#252545" : "transparent",
                color: inspectorTab === tab.value ? "#fff" : "#666",
                border: `1px solid ${inspectorTab === tab.value ? "#444" : "#252545"}`,
                borderRadius: 5,
                cursor: "pointer",
              }}
            >
              {tab.label}
            </button>
          ))}
        </div>
        <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
          <label style={{ display: "flex", alignItems: "center", gap: 6, cursor: "pointer", fontSize: 10, color: "#aaa" }}>
            <input type="checkbox" checked={focusEnabled} onChange={onToggleFocus} style={{ accentColor: "#648FFF" }} />
            Focus mode
          </label>
          <label style={{ display: "flex", alignItems: "center", gap: 6, cursor: "pointer", fontSize: 10, color: "#aaa" }}>
            <input type="checkbox" checked={showCircularOnly} onChange={onToggleCircularOnly} style={{ accentColor: "#ef4444" }} />
            Circular only
          </label>
          <label style={{ display: "flex", alignItems: "center", gap: 6, cursor: "pointer", fontSize: 10, color: "#aaa" }}>
            <input type="checkbox" checked={hideTypeOnly} onChange={onToggleHideTypeOnly} style={{ accentColor: "#a855f7" }} />
            Hide type imports
          </label>
        </div>
      </div>
    </>
  );
}

function DependencyInspector() {
  const graph = useStore((s) => s.graph);
  const selectedNodeId = useStore((s) => s.selectedNodeId);
  const selectedEdgeId = useStore((s) => s.selectedEdgeId);
  const inspectorTab = useStore((s) => s.dependencyInspectorTab);

  if (!graph?.dependencyDiagram) return null;
  const diagram = graph.dependencyDiagram;

  // No selection — show intro or metrics/cycles tabs
  if (!selectedNodeId && !selectedEdgeId) {
    if (inspectorTab === "metrics") return <DependencyMetricsPanel />;
    if (inspectorTab === "cycles") return <DependencyCyclesPanel />;
    return <DependencyIntroPanel />;
  }

  // Edge selected
  if (selectedEdgeId) {
    const dep = diagram.moduleDeps.find((d) => d.id === selectedEdgeId);
    if (dep) return <DependencyEdgeInspector dep={dep} />;
  }

  // Symbol selected (pill node — id contains "::")
  if (selectedNodeId && selectedNodeId.includes("::")) {
    if (inspectorTab === "metrics") return <DependencyMetricsPanel />;
    if (inspectorTab === "cycles") return <DependencyCyclesPanel />;
    return <SymbolDetailPanel symbolId={selectedNodeId} />;
  }

  // Module selected
  if (selectedNodeId) {
    const mod = diagram.modules.find((m) => m.id === selectedNodeId);
    if (!mod) return null;

    if (inspectorTab === "metrics") return <DependencyMetricsPanel />;
    if (inspectorTab === "cycles") return <DependencyCyclesPanel />;
    if (inspectorTab === "dependencies") return <DependencyDepsPanel moduleId={mod.id} />;
    return <DependencyOverviewPanel moduleId={mod.id} />;
  }

  return null;
}

const ARROW_LEGEND: Record<string, { boxLabel: string; arrowMeaning: string; example: string }> = {
  module: {
    boxLabel: "Each box is a component module (Engine, NPC, etc.)",
    arrowMeaning: "A → B means at least one file in A imports from a file in B",
    example: "Bootstrap → Engine = bootstrap code imports engine modules",
  },
  file: {
    boxLabel: "Each box is a source file (.ts)",
    arrowMeaning: "A → B means file A has an import statement that resolves to file B",
    example: "orchestrator.ts → memory.ts = orchestrator imports from memory",
  },
  symbol: {
    boxLabel: "Each box is an exported class, interface, or function",
    arrowMeaning: "A → B means a file that defines A imports the symbol B",
    example: "NpcOrchestrator → MemoryManager = orchestrator file imports MemoryManager",
  },
};

function DependencyIntroPanel() {
  const graph = useStore((s) => s.graph);
  const granularity = useStore((s) => s.dependencyGranularity);
  if (!graph?.dependencyDiagram) return null;
  const { summary } = graph.dependencyDiagram;
  const legend = ARROW_LEGEND[granularity] ?? ARROW_LEGEND.file;

  return (
    <div style={sectionStyle}>
      <div style={{ fontSize: 13, fontWeight: 700, color: "#e2e8f0", marginBottom: 8 }}>
        Dependency Graph
      </div>

      {/* Arrow legend */}
      <div
        style={{
          padding: "8px 10px",
          marginBottom: 10,
          background: "#111827",
          border: "1px solid #1e293b",
          borderRadius: 8,
          lineHeight: 1.55,
        }}
      >
        <div style={{ fontSize: 10, color: "#cbd5e1" }}>{legend.boxLabel}</div>
        <div style={{ fontSize: 10, color: "#94a3b8", marginTop: 4 }}>
          <span style={{ fontWeight: 700, color: "#e2e8f0" }}>→</span>{" "}
          {legend.arrowMeaning}
        </div>
        <div style={{ fontSize: 9, color: "#64748b", marginTop: 4, fontStyle: "italic" }}>
          e.g. {legend.example}
        </div>
        <div style={{ display: "flex", gap: 14, marginTop: 8, alignItems: "center" }}>
          <span style={{ display: "inline-flex", alignItems: "center", gap: 4 }}>
            <svg width="24" height="6"><line x1="0" y1="3" x2="24" y2="3" stroke="#94a3b8" strokeWidth="2" /></svg>
            <span style={{ fontSize: 9, color: "#cbd5e1" }}>normal</span>
          </span>
          <span style={{ display: "inline-flex", alignItems: "center", gap: 4 }}>
            <svg width="24" height="6"><line x1="0" y1="3" x2="24" y2="3" stroke="#ef4444" strokeWidth="2" strokeDasharray="4 3" /></svg>
            <span style={{ fontSize: 9, color: "#cbd5e1" }}>circular</span>
          </span>
          <span style={{ fontSize: 9, color: "#94a3b8" }}>width = strength</span>
        </div>
      </div>

      <div style={{ fontSize: 10, color: "#94a3b8", lineHeight: 1.5, marginBottom: 10 }}>
        {summary.totalFileDeps} file imports across {summary.totalModules} modules.
        Click a node to inspect its dependencies and metrics.
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 6 }}>
        <MetricCard label="Modules" value={String(summary.totalModules)} color="#648FFF" />
        <MetricCard label="File imports" value={String(summary.totalFileDeps)} color="#22D3EE" />
        <MetricCard label="Module deps" value={String(summary.totalModuleDeps)} color="#f59e0b" />
        <MetricCard label="Circular cycles" value={String(summary.circularCycleCount)} color={summary.circularCycleCount > 0 ? "#ef4444" : "#22c55e"} />
        <MetricCard label="Avg instability" value={summary.averageInstability.toFixed(2)} color="#a855f7" />
        <MetricCard label="Most stable" value={summary.mostStableModule} color="#22c55e" />
      </div>
    </div>
  );
}

function DependencyOverviewPanel({ moduleId }: { moduleId: string }) {
  const graph = useStore((s) => s.graph);
  if (!graph?.dependencyDiagram) return null;
  const mod = graph.dependencyDiagram.modules.find((m) => m.id === moduleId);
  if (!mod) return null;
  const comp = graph.components.find((c) => c.id === mod.componentId);
  const color = comp?.color ?? "#888";

  return (
    <div style={sectionStyle}>
      <InspectorHeader title={mod.label} subtitle={`${mod.fileCount} files · ${mod.totalLoc} LOC`} color={color} />
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 6, marginTop: 10 }}>
        <MetricCard label="Fan-in" value={String(mod.fanIn)} color="#22D3EE" />
        <MetricCard label="Fan-out" value={String(mod.fanOut)} color="#f59e0b" />
        <MetricCard label="Instability" value={mod.instability.toFixed(2)} color={mod.instability <= 0.3 ? "#22c55e" : mod.instability <= 0.6 ? "#f59e0b" : "#ef4444"} />
      </div>
      <div style={{ marginTop: 10, fontSize: 10, color: "#94a3b8", lineHeight: 1.5 }}>
        {mod.internalEdgeCount} internal imports between files in this module.
        {mod.orphanFiles.length > 0 && ` ${mod.orphanFiles.length} orphan files with no imports.`}
      </div>
      {mod.orphanFiles.length > 0 && (
        <div style={{ marginTop: 8 }}>
          <div style={{ fontSize: 9, fontWeight: 700, color: "#64748b", marginBottom: 4 }}>ORPHAN FILES</div>
          {mod.orphanFiles.map((f) => (
            <div key={f} style={{ fontSize: 9, color: "#94a3b8", fontFamily: "monospace", lineHeight: 1.6 }}>
              {f.split("/").pop()}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function SymbolDetailPanel({ symbolId }: { symbolId: string }) {
  const graph = useStore((s) => s.graph);
  if (!graph) return null;

  const [fileId, symbolName] = symbolId.split("::");
  const cls = graph.classes.find((c) => c.fileId === fileId && c.name === symbolName);
  const comp = graph.components.find((c) => c.fileIds?.includes(fileId));
  const color = comp?.color ?? "#888";
  const kind = cls ? cls.kind : "function";

  // Find edges involving this symbol from the dependency diagram
  const diagram = graph.dependencyDiagram;
  const inbound = diagram?.fileDeps.filter((d) => d.target === fileId) ?? [];
  const outbound = diagram?.fileDeps.filter((d) => d.source === fileId) ?? [];

  return (
    <div style={sectionStyle}>
      <InspectorHeader
        title={symbolName ?? symbolId}
        subtitle={`${kind} in ${fileId?.split("/").pop() ?? fileId}`}
        color={color}
      />

      {cls && cls.fields.length > 0 && (
        <div style={{ marginTop: 10 }}>
          <div style={{ fontSize: 9, fontWeight: 700, color: "#64748b", marginBottom: 4 }}>FIELDS</div>
          {cls.fields.map((f) => (
            <div key={f.name} style={{ fontSize: 10, color: "#cbd5e1", fontFamily: "monospace", lineHeight: 1.5 }}>
              {f.name}: <span style={{ color: "#64748b" }}>{f.type}</span>
            </div>
          ))}
        </div>
      )}

      {cls && cls.methods.length > 0 && (
        <div style={{ marginTop: 10 }}>
          <div style={{ fontSize: 9, fontWeight: 700, color: "#64748b", marginBottom: 4 }}>METHODS</div>
          {cls.methods.filter((m) => m.visibility === "public").map((m) => (
            <div key={m.name} style={{ fontSize: 10, color: "#e2e8f0", fontFamily: "monospace", lineHeight: 1.5 }}>
              {m.name}()
              {m.isAsync && <span style={{ color: "#648FFF", marginLeft: 4, fontSize: 8 }}>async</span>}
            </div>
          ))}
        </div>
      )}

      {(inbound.length > 0 || outbound.length > 0) && (
        <div style={{ marginTop: 10 }}>
          <div style={{ fontSize: 9, fontWeight: 700, color: "#64748b", marginBottom: 4 }}>
            FILE IMPORTS ({inbound.length} in, {outbound.length} out)
          </div>
        </div>
      )}
    </div>
  );
}

function DependencyDepsPanel({ moduleId }: { moduleId: string }) {
  const graph = useStore((s) => s.graph);
  if (!graph?.dependencyDiagram) return null;
  const diagram = graph.dependencyDiagram;
  const inbound = diagram.moduleDeps.filter((d) => d.target === moduleId);
  const outbound = diagram.moduleDeps.filter((d) => d.source === moduleId);

  return (
    <div style={sectionStyle}>
      <div style={{ fontSize: 11, fontWeight: 700, color: "#e2e8f0", marginBottom: 10 }}>Dependencies</div>
      {outbound.length > 0 && (
        <>
          <div style={{ fontSize: 9, fontWeight: 700, color: "#f59e0b", marginBottom: 4 }}>
            DEPENDS ON ({outbound.length})
          </div>
          {outbound.map((d) => (
            <DepRow key={d.id} dep={d} side="target" />
          ))}
        </>
      )}
      {inbound.length > 0 && (
        <>
          <div style={{ fontSize: 9, fontWeight: 700, color: "#22D3EE", marginTop: 10, marginBottom: 4 }}>
            DEPENDED ON BY ({inbound.length})
          </div>
          {inbound.map((d) => (
            <DepRow key={d.id} dep={d} side="source" />
          ))}
        </>
      )}
      {inbound.length === 0 && outbound.length === 0 && (
        <div style={{ fontSize: 10, color: "#64748b" }}>No cross-module dependencies.</div>
      )}
    </div>
  );
}

function DepRow({ dep, side }: { dep: { id: string; source: string; target: string; fileEdgeCount: number; strength: string; isCircular: boolean }; side: "source" | "target" }) {
  const label = side === "target" ? dep.target : dep.source;
  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        gap: 6,
        padding: "4px 0",
        fontSize: 10,
        color: dep.isCircular ? "#fbbf24" : "#cbd5e1",
      }}
    >
      <span style={{ fontWeight: 600, flex: 1 }}>{label}</span>
      <span style={{ fontSize: 9, color: "#64748b" }}>{dep.fileEdgeCount} imports</span>
      <span
        style={{
          fontSize: 8,
          fontWeight: 700,
          padding: "1px 5px",
          borderRadius: 999,
          background: dep.strength === "strong" ? "#7f1d1d33" : dep.strength === "moderate" ? "#78350f33" : "#1e293b",
          color: dep.strength === "strong" ? "#fca5a5" : dep.strength === "moderate" ? "#fcd34d" : "#94a3b8",
        }}
      >
        {dep.strength}
      </span>
      {dep.isCircular && (
        <span style={{ fontSize: 8, fontWeight: 800, color: "#ef4444" }}>CIRC</span>
      )}
    </div>
  );
}

function DependencyMetricsPanel() {
  const graph = useStore((s) => s.graph);
  const selectNode = useStore((s) => s.selectNode);
  if (!graph?.dependencyDiagram) return null;
  const sorted = [...graph.dependencyDiagram.modules].sort((a, b) => b.instability - a.instability);

  return (
    <div style={sectionStyle}>
      <div style={{ fontSize: 11, fontWeight: 700, color: "#e2e8f0", marginBottom: 8 }}>
        Module Metrics
      </div>
      <div style={{ fontSize: 9, color: "#64748b", marginBottom: 8 }}>Sorted by instability (most unstable first)</div>
      {sorted.map((mod) => {
        const instColor = mod.instability <= 0.3 ? "#22c55e" : mod.instability <= 0.6 ? "#f59e0b" : "#ef4444";
        return (
          <button
            key={mod.id}
            onClick={() => selectNode(mod.id)}
            style={{
              display: "flex",
              alignItems: "center",
              gap: 8,
              width: "100%",
              padding: "5px 6px",
              marginBottom: 2,
              background: "transparent",
              border: "1px solid transparent",
              borderRadius: 4,
              cursor: "pointer",
              textAlign: "left",
            }}
          >
            <span style={{ fontSize: 10, fontWeight: 600, color: "#cbd5e1", flex: 1 }}>{mod.label}</span>
            <span style={{ fontSize: 9, color: "#22D3EE", minWidth: 20, textAlign: "right" }}>{mod.fanIn}</span>
            <span style={{ fontSize: 9, color: "#f59e0b", minWidth: 20, textAlign: "right" }}>{mod.fanOut}</span>
            <span style={{ fontSize: 9, fontWeight: 700, color: instColor, minWidth: 32, textAlign: "right" }}>
              {mod.instability.toFixed(2)}
            </span>
          </button>
        );
      })}
      <div style={{ display: "flex", gap: 12, marginTop: 8, fontSize: 8, color: "#64748b" }}>
        <span><span style={{ color: "#22D3EE" }}>IN</span></span>
        <span><span style={{ color: "#f59e0b" }}>OUT</span></span>
        <span>INSTAB</span>
      </div>
    </div>
  );
}

function DependencyCyclesPanel() {
  const graph = useStore((s) => s.graph);
  if (!graph?.dependencyDiagram) return null;
  const { cycles } = graph.dependencyDiagram;

  if (cycles.length === 0) {
    return (
      <div style={sectionStyle}>
        <div style={{ fontSize: 11, fontWeight: 700, color: "#22c55e", marginBottom: 6 }}>No Circular Dependencies</div>
        <div style={{ fontSize: 10, color: "#94a3b8" }}>All module dependencies are acyclic.</div>
      </div>
    );
  }

  return (
    <div style={sectionStyle}>
      <div style={{ fontSize: 11, fontWeight: 700, color: "#fbbf24", marginBottom: 8 }}>
        Circular Dependencies ({cycles.length})
      </div>
      {cycles.map((cycle) => (
        <div
          key={cycle.id}
          style={{
            padding: "6px 8px",
            marginBottom: 6,
            background: cycle.severity === "error" ? "#7f1d1d18" : "#78350f18",
            border: `1px solid ${cycle.severity === "error" ? "#7f1d1d44" : "#78350f44"}`,
            borderRadius: 6,
          }}
        >
          <div style={{ fontSize: 10, fontWeight: 600, color: "#fcd34d", marginBottom: 4 }}>
            {cycle.modules.join(" → ")} → {cycle.modules[0]}
          </div>
          <div style={{ fontSize: 9, color: "#94a3b8" }}>
            {cycle.fileEdges.length} file-level edges · severity: {cycle.severity}
          </div>
        </div>
      ))}
    </div>
  );
}

function DependencyEdgeInspector({ dep }: { dep: { id: string; source: string; target: string; fileEdgeCount: number; symbolCount: number; strength: string; isCircular: boolean } }) {
  const graph = useStore((s) => s.graph);
  if (!graph?.dependencyDiagram) return null;

  // Find the file-level edges for this module dep
  const fileDeps = graph.dependencyDiagram.fileDeps.filter((fd) => {
    const srcComp = graph.components.find((c) => c.fileIds.includes(fd.source));
    const tgtComp = graph.components.find((c) => c.fileIds.includes(fd.target));
    return srcComp?.id === dep.source && tgtComp?.id === dep.target;
  });

  return (
    <div style={sectionStyle}>
      <div style={{ fontSize: 12, fontWeight: 700, color: "#e2e8f0", marginBottom: 6 }}>
        {dep.source} → {dep.target}
      </div>
      <div style={{ display: "flex", gap: 8, marginBottom: 8 }}>
        <span style={{ fontSize: 9, color: "#94a3b8" }}>{dep.fileEdgeCount} file imports</span>
        <span style={{ fontSize: 9, fontWeight: 700, color: dep.isCircular ? "#ef4444" : "#94a3b8" }}>
          {dep.isCircular ? "CIRCULAR" : dep.strength}
        </span>
      </div>
      {fileDeps.length > 0 && (
        <>
          <div style={{ fontSize: 9, fontWeight: 700, color: "#64748b", marginBottom: 4 }}>FILE EDGES</div>
          {fileDeps.slice(0, 20).map((fd, i) => (
            <div key={i} style={{ fontSize: 9, color: fd.isCircular ? "#fbbf24" : "#cbd5e1", fontFamily: "monospace", lineHeight: 1.6 }}>
              {fd.source.split("/").pop()} → {fd.target.split("/").pop()}
              {fd.isCircular && <span style={{ color: "#ef4444", marginLeft: 4 }}>circ</span>}
            </div>
          ))}
          {fileDeps.length > 20 && (
            <div style={{ fontSize: 9, color: "#64748b", marginTop: 4 }}>
              ...and {fileDeps.length - 20} more
            </div>
          )}
        </>
      )}
    </div>
  );
}

function MetricCard({ label, value, color }: { label: string; value: string; color: string }) {
  return (
    <div
      style={{
        padding: "6px 8px",
        background: "#0f172a",
        border: "1px solid #1e293b",
        borderRadius: 6,
        textAlign: "center",
      }}
    >
      <div style={{ fontSize: 14, fontWeight: 800, color }}>{value}</div>
      <div style={{ fontSize: 8, color: "#64748b", fontWeight: 600, marginTop: 2 }}>{label}</div>
    </div>
  );
}

function ComponentTabControls(
  {
    activeViewId,
    onSelectView,
    inspectorTab,
    onSelectTab,
    focusEnabled,
    onToggleFocus,
    focusDirection,
    onSelectFocusDirection,
    searchQuery,
    onSearchChange,
  }: {
    activeViewId: string | null;
    onSelectView: (viewId: string | null) => void;
    inspectorTab: ComponentInspectorTab;
    onSelectTab: (tab: ComponentInspectorTab) => void;
    focusEnabled: boolean;
    onToggleFocus: () => void;
    focusDirection: ComponentFocusDirection;
    onSelectFocusDirection: (direction: ComponentFocusDirection) => void;
    searchQuery: string;
    onSearchChange: (query: string) => void;
  },
) {
  const graph = useStore((s) => s.graph);
  const selectedNodeId = useStore((s) => s.selectedNodeId);
  const selectedEdgeId = useStore((s) => s.selectedEdgeId);
  const selectNode = useStore((s) => s.selectNode);
  const setHighlightedEvidenceId = useStore((s) => s.setHighlightedEvidenceId);
  if (!graph?.componentDiagram) return null;

  const activeView = getActiveComponentView(graph.componentDiagram, activeViewId);
  if (!activeView) return null;

  const activeCards = graph.componentDiagram.cards.filter((card) => card.viewId === activeView.id);
  const activeBoundaries = graph.componentDiagram.boundaries.filter((boundary) => boundary.viewId === activeView.id);
  const activeContainers = graph.componentDiagram.containers.filter((container) => container.viewId === activeView.id);
  const evidenceLookup = new Map(graph.componentDiagram.evidence.map((item) => [item.id, item]));
  const results = searchComponentDiagram(graph, activeView.id, searchQuery, evidenceLookup);
  const selectedCard = selectedNodeId
    ? activeCards.find((card) => card.id === selectedNodeId) ?? null
    : null;
  const selectedBoundary = selectedNodeId
    ? activeBoundaries.find((boundary) => boundary.id === selectedNodeId) ?? null
    : null;
  const selectedContainer = selectedNodeId
    ? activeContainers.find((container) => container.id === selectedNodeId) ?? null
    : null;
  const canUseDirectionFilter = Boolean(selectedCard);
  const isEdgeSelected = Boolean(selectedEdgeId);
  const activeInspectorTab =
    COMPONENT_INSPECTOR_TABS.find((tab) => tab.value === inspectorTab) ?? COMPONENT_INSPECTOR_TABS[0];

  return (
    <div style={sectionStyle}>
      <div style={{ fontSize: 11, fontWeight: 700, color: "#aaa", marginBottom: 8 }}>
        Component Explorer
      </div>

      <div
        style={{
          marginBottom: 10,
          padding: "10px 10px 12px",
          border: "1px solid #273449",
          borderRadius: 10,
          background: "#0f172a",
        }}
      >
        <div style={{ fontSize: 10, fontWeight: 700, color: "#cbd5e1", marginBottom: 6 }}>
          Container Scope
        </div>
        <div style={{ fontSize: 10, color: "#64748b", lineHeight: 1.4, marginBottom: 8 }}>
          C4 component diagrams are scoped to one application container at a time. Switch the active container here.
        </div>
        <div style={{ display: "grid", gap: 6 }}>
          {graph.componentDiagram.views.map((view) => {
            const active = activeView.id === view.id;
            return (
              <button
                key={view.id}
                type="button"
                onClick={() => {
                  onSelectView(view.id);
                  selectNode(view.boundaryId);
                  onSelectTab("overview");
                }}
                style={{
                  display: "flex",
                  flexDirection: "column",
                  alignItems: "flex-start",
                  gap: 3,
                  width: "100%",
                  padding: "8px 10px",
                  textAlign: "left",
                  background: active ? "#172033" : "#111827",
                  border: `1px solid ${active ? "#3b82f6" : "#273449"}`,
                  borderRadius: 8,
                  cursor: "pointer",
                }}
              >
                <span style={{ fontSize: 10, fontWeight: 700, color: active ? "#fff" : "#cbd5e1" }}>{view.name}</span>
                <span style={{ fontSize: 9, color: "#64748b", lineHeight: 1.35 }}>{view.description}</span>
              </button>
            );
          })}
        </div>
      </div>

      <input
        value={searchQuery}
        onChange={(event) => onSearchChange(event.target.value)}
        placeholder={`Search ${activeView.name} components, routes, events, files...`}
        style={{
          width: "100%",
          boxSizing: "border-box",
          padding: "8px 10px",
          fontSize: 11,
          color: "#e5e7eb",
          background: "#0f172a",
          border: "1px solid #273449",
          borderRadius: 8,
          outline: "none",
          marginBottom: 10,
        }}
      />

      <div
        style={{
          marginBottom: 10,
          padding: "10px 10px 12px",
          border: "1px solid #273449",
          borderRadius: 10,
          background: "#0f172a",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10, marginBottom: 6 }}>
          <div>
            <div style={{ fontSize: 10, fontWeight: 700, color: "#cbd5e1" }}>Diagram filter</div>
            <div style={{ fontSize: 10, color: "#64748b", marginTop: 2, lineHeight: 1.35 }}>
              {selectedCard
                ? `Filtering around ${selectedCard.title}.`
                : selectedBoundary
                  ? `Select a component card inside ${selectedBoundary.label} to use the directional filter.`
                  : selectedContainer
                    ? `Select a component card inside ${activeView.name} to use the directional filter.`
                  : isEdgeSelected
                    ? "Edge selection already isolates that connection. Select a component card to use the directional filter."
                    : "Select a component card to dim unrelated nodes and focus the diagram."}
            </div>
          </div>
          <button
            type="button"
            onClick={onToggleFocus}
            style={{
              padding: "6px 9px",
              fontSize: 10,
              fontWeight: 700,
              color: focusEnabled ? "#fff" : "#94a3b8",
              background: focusEnabled ? "#1d4ed8" : "transparent",
              border: `1px solid ${focusEnabled ? "#2563eb" : "#334155"}`,
              borderRadius: 7,
              cursor: "pointer",
              flexShrink: 0,
            }}
          >
            {focusEnabled ? "Dim unrelated: On" : "Dim unrelated: Off"}
          </button>
        </div>

        <div style={{ display: "grid", gap: 6 }}>
          {COMPONENT_FOCUS_DIRECTIONS.map((option) => {
            const active = focusDirection === option.value;
            const disabled = !canUseDirectionFilter;
            return (
              <button
                key={option.value}
                type="button"
                onClick={() => onSelectFocusDirection(option.value)}
                disabled={disabled}
                style={{
                  display: "flex",
                  flexDirection: "column",
                  alignItems: "flex-start",
                  gap: 3,
                  width: "100%",
                  padding: "8px 10px",
                  textAlign: "left",
                  background: active && !disabled ? "#172033" : "#111827",
                  border: `1px solid ${active && !disabled ? "#3b82f6" : "#273449"}`,
                  borderRadius: 8,
                  cursor: disabled ? "not-allowed" : "pointer",
                  opacity: disabled ? 0.55 : 1,
                }}
              >
                <span style={{ fontSize: 10, fontWeight: 700, color: active && !disabled ? "#fff" : "#cbd5e1" }}>
                  {option.label}
                </span>
                <span style={{ fontSize: 9, color: "#64748b", lineHeight: 1.35 }}>
                  {option.description}
                </span>
              </button>
            );
          })}
        </div>
      </div>

      <div
        style={{
          marginBottom: 10,
          padding: "10px 10px 12px",
          border: "1px solid #273449",
          borderRadius: 10,
          background: "#0f172a",
        }}
      >
        <div style={{ fontSize: 10, fontWeight: 700, color: "#cbd5e1", marginBottom: 6 }}>
          Sidebar view
        </div>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(2, minmax(0, 1fr))", gap: 6 }}>
          {COMPONENT_INSPECTOR_TABS.map((tab, index) => (
          <button
            key={tab.value}
            type="button"
            onClick={() => onSelectTab(tab.value)}
            style={{
              gridColumn: index === COMPONENT_INSPECTOR_TABS.length - 1 ? "1 / -1" : undefined,
              display: "flex",
              flexDirection: "column",
              alignItems: "flex-start",
              gap: 3,
              padding: "8px 10px",
              textAlign: "left",
              color: inspectorTab === tab.value ? "#fff" : "#cbd5e1",
              background: inspectorTab === tab.value ? "#172033" : "#111827",
              border: `1px solid ${inspectorTab === tab.value ? "#3b82f6" : "#273449"}`,
              borderRadius: 8,
              cursor: "pointer",
            }}
          >
            <span style={{ fontSize: 10, fontWeight: 700 }}>{tab.label}</span>
            <span style={{ fontSize: 9, color: "#64748b", lineHeight: 1.35 }}>{tab.description}</span>
          </button>
          ))}
        </div>
      <div
        style={{
          marginTop: 8,
          paddingTop: 8,
            borderTop: "1px solid #1f2937",
            fontSize: 10,
            color: "#94a3b8",
            lineHeight: 1.45,
          }}
        >
          <strong style={{ color: "#e5e7eb" }}>{activeInspectorTab.label}:</strong> {activeInspectorTab.description}
        </div>
      </div>

      <div
        style={{
          marginBottom: 10,
          padding: "10px 10px 12px",
          border: "1px solid #273449",
          borderRadius: 10,
          background: "#0f172a",
        }}
      >
        <div style={{ fontSize: 10, fontWeight: 700, color: "#cbd5e1", marginBottom: 6 }}>
          How to read this chart
        </div>
        <div style={{ fontSize: 10, color: "#cbd5e1", lineHeight: 1.45, marginBottom: 6 }}>
          This is the C4 component diagram for <strong>{activeView.name}</strong>. Large surrounding boxes are repeated runtime containers; the inner boundary is the selected application container; the inner cards are its components.
        </div>
        <ConfidenceLegendRow
          label="Code"
          color="#22D3EE"
          description="Read straight from code."
        />
        <ConfidenceLegendRow
          label="Summary"
          color="#cbd5e1"
          description="Short summary built from several code facts."
        />
        <ConfidenceLegendRow
          label="Guess"
          color="#f59e0b"
          description="Best-effort inference when the code does not say it directly."
        />
      </div>

      {searchQuery.trim().length > 0 && (
        <div style={{ borderTop: "1px solid #252545", paddingTop: 10 }}>
          <div style={{ fontSize: 10, fontWeight: 600, color: "#94a3b8", marginBottom: 6 }}>
            Search Results
          </div>
          {results.length === 0 && (
            <div style={{ fontSize: 10, color: "#64748b" }}>No matches in the active component diagram.</div>
          )}
          {results.slice(0, 8).map((result) => (
            <button
              key={`${result.cardId}-${result.label}`}
              type="button"
              onClick={() => {
                selectNode(result.cardId);
                onSelectTab(result.evidenceId ? "evidence" : "overview");
                setHighlightedEvidenceId(result.evidenceId ?? null);
              }}
              style={{
                display: "block",
                width: "100%",
                textAlign: "left",
                padding: "7px 8px",
                marginBottom: 4,
                fontSize: 10,
                color: "#cbd5e1",
                background: "#0f172a",
                border: "1px solid #273449",
                borderRadius: 6,
                cursor: "pointer",
              }}
            >
              <div style={{ fontWeight: 700, color: "#fff" }}>{result.cardTitle}</div>
              <div style={{ color: "#94a3b8", marginTop: 2 }}>{result.label}</div>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

function ComponentInspector() {
  const graph = useStore((s) => s.graph);
  const selectedNodeId = useStore((s) => s.selectedNodeId);
  const selectedEdgeId = useStore((s) => s.selectedEdgeId);
  const activeComponentViewId = useStore((s) => s.activeComponentViewId);
  const inspectorTab = useStore((s) => s.componentInspectorTab);
  const highlightedEvidenceId = useStore((s) => s.highlightedEvidenceId);

  if (!graph?.componentDiagram) return null;
  const activeView = getActiveComponentView(graph.componentDiagram, activeComponentViewId);
  if (!activeView) return null;
  if (!selectedNodeId && !selectedEdgeId) return <ComponentIntroPanel viewName={activeView.name} />;

  if (selectedEdgeId) {
    return <ComponentEdgeInspector viewId={activeView.id} edgeId={selectedEdgeId} highlightedEvidenceId={highlightedEvidenceId} />;
  }

  const boundary = graph.componentDiagram.boundaries.find((item) => item.id === selectedNodeId && item.viewId === activeView.id);
  if (boundary) {
    return <ComponentBoundaryInspector viewId={activeView.id} boundaryId={boundary.id} />;
  }

  const container = graph.componentDiagram.containers.find((item) => item.id === selectedNodeId && item.viewId === activeView.id);
  if (container) {
    return <ComponentContextContainerInspector viewId={activeView.id} containerId={container.id} />;
  }

  const card = graph.componentDiagram.cards.find((item) => item.id === selectedNodeId && item.viewId === activeView.id);
  if (!card) return <ComponentIntroPanel viewName={activeView.name} />;

  switch (inspectorTab) {
    case "contract":
      return <ComponentContractInspector viewId={activeView.id} cardId={card.id} />;
    case "internals":
      return <ComponentInternalsInspector viewId={activeView.id} cardId={card.id} />;
    case "evidence":
      return <ComponentEvidenceInspector viewId={activeView.id} cardId={card.id} highlightedEvidenceId={highlightedEvidenceId} />;
    case "open_next":
      return <ComponentOpenNextInspector viewId={activeView.id} cardId={card.id} />;
    case "overview":
    default:
      return <ComponentOverviewInspector viewId={activeView.id} cardId={card.id} />;
  }
}

function ComponentIntroPanel({ viewName }: { viewName: string }) {
  return (
    <div style={sectionStyle}>
      <div style={{ fontSize: 12, fontWeight: 700, color: "#ccc", marginBottom: 10 }}>
        {viewName} Components
      </div>
      <div style={tipStyle}>
        This tab shows one C4 component diagram at a time. Use the container scope switch above to move between application containers.
      </div>
      <div style={tipStyle}>
        The inner boundary is the selected application container. The surrounding boxes are repeated runtime containers from the container view.
      </div>
      <div style={tipStyle}>
        Click a component card to switch the sidebar into a component-specific inspector.
      </div>
      <div style={tipStyle}>
        Small badges on the chart tell you whether a line came straight from code, is a short summary of several code facts, or is a best-effort guess.
      </div>
      <div style={tipStyle}>
        Use the search box to find a route, message type, event, or file inside the active component diagram.
      </div>
      <div style={tipStyle}>
        Use Diagram filter to show everything touching a selected component, only who feeds it, or only what it affects.
      </div>
    </div>
  );
}

function ConfidenceLegendRow(
  {
    label,
    color,
    description,
  }: {
    label: string;
    color: string;
    description: string;
  },
) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 6 }}>
      <span
        style={{
          fontSize: 8,
          fontWeight: 800,
          letterSpacing: 0.5,
          color,
          border: `1px solid ${color}40`,
          background: `${color}12`,
          borderRadius: 4,
          padding: "2px 5px",
          flexShrink: 0,
        }}
      >
        {label.toUpperCase()}
      </span>
      <span style={{ fontSize: 9, color: "#94a3b8", lineHeight: 1.35 }}>{description}</span>
    </div>
  );
}

function ComponentBoundaryInspector(
  {
    viewId,
    boundaryId,
  }: {
    viewId: string;
    boundaryId: string;
  },
) {
  const graph = useStore((s) => s.graph);
  if (!graph?.componentDiagram) return null;

  const boundary = graph.componentDiagram.boundaries.find((item) => item.id === boundaryId && item.viewId === viewId);
  if (!boundary) return null;
  const cards = graph.componentDiagram.cards.filter((card) => card.boundaryId === boundary.id && card.viewId === viewId);
  const containers = graph.componentDiagram.containers.filter((container) => container.viewId === viewId);

  return (
    <div style={sectionStyle}>
      <div style={{ fontSize: 14, fontWeight: 700, color: boundary.color }}>{boundary.label}</div>
      <div style={{ fontSize: 11, color: "#888", marginTop: 4 }}>{boundary.technology}</div>
      <div style={{ fontSize: 11, color: "#cbd5e1", marginTop: 8, lineHeight: 1.5 }}>
        {boundary.description}
      </div>
      <div style={{ marginTop: 12 }}>
        <div style={{ fontSize: 10, fontWeight: 700, color: "#94a3b8", marginBottom: 6 }}>
          Components
        </div>
        {cards.map((card) => (
          <div key={card.id} style={{ fontSize: 11, color: "#e5e7eb", marginBottom: 4 }}>
            {card.title}
          </div>
        ))}
      </div>
      {containers.length > 0 && (
        <div style={{ marginTop: 12 }}>
          <div style={{ fontSize: 10, fontWeight: 700, color: "#94a3b8", marginBottom: 6 }}>
            Surrounding Containers
          </div>
          {containers.map((container) => (
            <div key={container.id} style={{ fontSize: 11, color: "#e5e7eb", marginBottom: 4 }}>
              {container.name}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function ComponentContextContainerInspector(
  {
    viewId,
    containerId,
  }: {
    viewId: string;
    containerId: string;
  },
) {
  const graph = useStore((s) => s.graph);
  if (!graph?.componentDiagram) return null;
  const container = graph.componentDiagram.containers.find((item) => item.id === containerId && item.viewId === viewId);
  if (!container) return null;

  const connectedEdges = graph.componentDiagram.edges.filter(
    (edge) => edge.viewId === viewId && (edge.source === container.id || edge.target === container.id),
  );

  return (
    <div style={sectionStyle}>
      <div style={{ fontSize: 14, fontWeight: 700, color: container.color }}>{container.name}</div>
      <div style={{ fontSize: 10, color: "#64748b", marginTop: 2 }}>{container.technology}</div>
      <div style={{ fontSize: 11, color: "#cbd5e1", marginTop: 8, lineHeight: 1.55 }}>
        {container.description}
      </div>
      <div style={{ marginTop: 12 }}>
        <div style={{ fontSize: 10, fontWeight: 700, color: "#94a3b8", marginBottom: 4 }}>
          Connections
        </div>
        {connectedEdges.map((edge) => {
          const otherId = edge.source === container.id ? edge.target : edge.source;
          return (
            <div key={edge.id} style={{ marginBottom: 6 }}>
              <div style={{ fontSize: 10, color: "#e5e7eb" }}>{getDiagramEntityLabel(graph, viewId, otherId)}</div>
              <div style={{ fontSize: 9, color: "#64748b", marginTop: 1 }}>
                {humanizeRelationshipKind(edge.relationshipKind)}
                {edge.technology ? ` · ${edge.technology}` : ""}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function ComponentOverviewInspector(
  {
    viewId,
    cardId,
  }: {
    viewId: string;
    cardId: string;
  },
) {
  const graph = useStore((s) => s.graph);
  if (!graph?.componentDiagram) return null;
  const card = graph.componentDiagram.cards.find((item) => item.id === cardId && item.viewId === viewId);
  if (!card) return null;

  const connectedEdges = graph.componentDiagram.edges.filter((edge) => edge.viewId === viewId && (edge.source === card.id || edge.target === card.id));
  const neighbors = connectedEdges.map((edge) => {
    const neighborId = edge.source === card.id ? edge.target : edge.source;
    return getDiagramEntityLabel(graph, viewId, neighborId);
  });

  return (
    <div style={sectionStyle}>
      <div style={{ fontSize: 14, fontWeight: 700, color: card.accentColor }}>{card.title}</div>
      {card.subtitle && (
        <div style={{ fontSize: 10, color: "#64748b", marginTop: 2, fontFamily: "monospace" }}>
          {card.subtitle}
        </div>
      )}
      {card.summary && (
        <div style={{ fontSize: 11, color: "#cbd5e1", marginTop: 8, lineHeight: 1.55 }}>
          {card.summary}
        </div>
      )}

      {card.metrics && card.metrics.length > 0 && (
        <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginTop: 10 }}>
          {card.metrics.map((metric) => (
            <span
              key={`${metric.label}-${metric.value}`}
              style={{
                fontSize: 10,
                fontWeight: 700,
                color: card.accentColor,
                background: `${card.accentColor}14`,
                border: `1px solid ${card.accentColor}35`,
                borderRadius: 999,
                padding: "3px 8px",
              }}
            >
              {metric.label} {metric.value}
            </span>
          ))}
        </div>
      )}

      <div style={{ marginTop: 12 }}>
        <div style={{ fontSize: 10, fontWeight: 700, color: "#94a3b8", marginBottom: 4 }}>
          Top Neighbors
        </div>
        {neighbors.length === 0 && (
          <div style={{ fontSize: 10, color: "#64748b" }}>No direct neighbors.</div>
        )}
        {neighbors.map((neighbor) => (
          <div key={neighbor} style={{ fontSize: 10, color: "#cbd5e1", marginBottom: 2 }}>
            {neighbor}
          </div>
        ))}
      </div>

      {card.fileId && (
        <div style={{ marginTop: 12 }}>
          <div style={{ fontSize: 10, fontWeight: 700, color: "#94a3b8", marginBottom: 4 }}>
            Primary File
          </div>
          <div style={{ fontSize: 10, color: "#e5e7eb", fontFamily: "monospace" }}>{card.fileId}</div>
        </div>
      )}
    </div>
  );
}

function ComponentContractInspector(
  {
    viewId,
    cardId,
  }: {
    viewId: string;
    cardId: string;
  },
) {
  const graph = useStore((s) => s.graph);
  if (!graph?.componentDiagram) return null;
  const card = graph.componentDiagram.cards.find((item) => item.id === cardId && item.viewId === viewId);
  if (!card) return null;

  const inboundEdges = graph.componentDiagram.edges.filter((edge) => edge.viewId === viewId && edge.target === card.id);
  const outboundEdges = graph.componentDiagram.edges.filter((edge) => edge.viewId === viewId && edge.source === card.id);

  return (
    <div style={sectionStyle}>
      <div style={{ fontSize: 14, fontWeight: 700, color: card.accentColor }}>{card.title}</div>
      {card.sections.map((section) => (
        <div key={section.id} style={{ marginTop: 10 }}>
          <div style={{ fontSize: 10, fontWeight: 700, color: "#94a3b8", textTransform: "uppercase" }}>
            {section.label}
          </div>
          {section.lines.map((line) => (
            <div key={line.id} style={{ fontSize: 10, color: "#e5e7eb", marginTop: 3, fontFamily: "monospace" }}>
              {line.text}
              <span style={{ color: "#64748b" }}> [{confidenceBadgeLabel(line.confidence)}]</span>
            </div>
          ))}
        </div>
      ))}

      <EdgeList viewId={viewId} title="Who Feeds This Component" edges={inboundEdges} currentCardId={card.id} />
      <EdgeList viewId={viewId} title="What This Component Affects" edges={outboundEdges} currentCardId={card.id} />
    </div>
  );
}

function ComponentInternalsInspector(
  {
    viewId,
    cardId,
  }: {
    viewId: string;
    cardId: string;
  },
) {
  const graph = useStore((s) => s.graph);
  if (!graph?.componentDiagram) return null;
  const card = graph.componentDiagram.cards.find((item) => item.id === cardId && item.viewId === viewId);
  if (!card) return null;

  return (
    <div style={sectionStyle}>
      <div style={{ fontSize: 14, fontWeight: 700, color: card.accentColor }}>{card.title}</div>
      {card.childCards && card.childCards.length > 0 ? (
        <div style={{ marginTop: 10 }}>
          {card.childCards.map((child) => (
            <div
              key={`${child.title}-${child.subtitle ?? ""}`}
              style={{
                padding: "8px 10px",
                marginBottom: 8,
                border: `1px solid ${card.accentColor}25`,
                background: `${card.accentColor}0d`,
                borderRadius: 8,
              }}
            >
              <div style={{ fontSize: 11, fontWeight: 700, color: "#fff" }}>{child.title}</div>
              {child.subtitle && (
                <div style={{ fontSize: 9, color: "#64748b", marginTop: 2, fontFamily: "monospace" }}>
                  {child.fileId ?? child.subtitle}
                </div>
              )}
              {child.summary && (
                <div style={{ fontSize: 10, color: "#cbd5e1", marginTop: 5, lineHeight: 1.45 }}>
                  {child.summary}
                </div>
              )}
              {child.lines.map((line) => (
                <div key={line} style={{ fontSize: 10, color: "#e5e7eb", marginTop: 3, fontFamily: "monospace" }}>
                  {line}
                </div>
              ))}
            </div>
          ))}
        </div>
      ) : (
        <div style={{ fontSize: 10, color: "#64748b", marginTop: 8 }}>No nested internals listed for this card.</div>
      )}
    </div>
  );
}

function ComponentEvidenceInspector(
  {
    viewId,
    cardId,
    highlightedEvidenceId,
  }: {
    viewId: string;
    cardId: string;
    highlightedEvidenceId: string | null;
  },
) {
  const graph = useStore((s) => s.graph);
  const setHighlightedEvidenceId = useStore((s) => s.setHighlightedEvidenceId);
  if (!graph?.componentDiagram) return null;

  const card = graph.componentDiagram.cards.find((item) => item.id === cardId && item.viewId === viewId);
  if (!card) return null;
  const evidenceLookup = new Map(graph.componentDiagram.evidence.map((item) => [item.id, item]));

  const cardEvidenceIds = new Set<string>();
  for (const section of card.sections) {
    for (const line of section.lines) {
      for (const evidenceId of line.evidenceIds) {
        cardEvidenceIds.add(evidenceId);
      }
    }
  }
  for (const edge of graph.componentDiagram.edges) {
    if (edge.viewId !== viewId) continue;
    if (edge.source === card.id || edge.target === card.id) {
      for (const evidenceId of edge.evidenceIds) {
        cardEvidenceIds.add(evidenceId);
      }
    }
  }

  const evidences = Array.from(cardEvidenceIds)
    .map((id) => evidenceLookup.get(id))
    .filter(Boolean);

  evidences.sort((a, b) => {
    if (a!.id === highlightedEvidenceId) return -1;
    if (b!.id === highlightedEvidenceId) return 1;
    return a!.fileId.localeCompare(b!.fileId);
  });

  return (
    <div style={sectionStyle}>
      <div style={{ fontSize: 14, fontWeight: 700, color: card.accentColor }}>{card.title}</div>
      <div style={{ fontSize: 10, color: "#64748b", marginTop: 4 }}>
        {evidences.length} code source{evidences.length === 1 ? "" : "s"} behind this view
      </div>
      <div style={{ marginTop: 10 }}>
        {evidences.map((evidence) => (
          <button
            key={evidence!.id}
            type="button"
            onClick={() => setHighlightedEvidenceId(evidence!.id)}
            style={{
              display: "block",
              width: "100%",
              textAlign: "left",
              padding: "8px 10px",
              marginBottom: 8,
              background: evidence!.id === highlightedEvidenceId ? "#172033" : "#0f172a",
              border: `1px solid ${evidence!.id === highlightedEvidenceId ? card.accentColor : "#273449"}`,
              borderRadius: 8,
              cursor: "pointer",
            }}
            >
              <div style={{ display: "flex", justifyContent: "space-between", gap: 8 }}>
              <span style={{ fontSize: 10, fontWeight: 700, color: "#fff" }}>{humanizeEvidenceKind(evidence!.kind)}</span>
              <span style={{ fontSize: 9, color: confidenceTextColor(evidence!.confidence) }}>
                {confidenceBadgeLabel(evidence!.confidence)}
              </span>
            </div>
            <div style={{ fontSize: 10, color: "#cbd5e1", marginTop: 4, lineHeight: 1.45 }}>
              {evidence!.detail}
            </div>
            <div style={{ fontSize: 9, color: "#64748b", marginTop: 5, fontFamily: "monospace" }}>
              {evidence!.fileId}
              {evidence!.line ? `:${evidence!.line}` : ""}
              {evidence!.symbol ? ` · ${evidence!.symbol}` : ""}
            </div>
          </button>
        ))}
      </div>
    </div>
  );
}

function ComponentOpenNextInspector(
  {
    viewId,
    cardId,
  }: {
    viewId: string;
    cardId: string;
  },
) {
  const graph = useStore((s) => s.graph);
  if (!graph?.componentDiagram) return null;
  const card = graph.componentDiagram.cards.find((item) => item.id === cardId && item.viewId === viewId);
  if (!card) return null;

  return (
    <div style={sectionStyle}>
      <div style={{ fontSize: 14, fontWeight: 700, color: card.accentColor }}>{card.title}</div>
      <div style={{ fontSize: 10, color: "#64748b", marginTop: 4 }}>
        Best next files to read for this area
      </div>
      <div style={{ marginTop: 10 }}>
        {(card.openNext ?? []).map((item) => (
          <div
            key={`${item.fileId}-${item.label}`}
            style={{
              padding: "8px 10px",
              marginBottom: 8,
              background: "#0f172a",
              border: "1px solid #273449",
              borderRadius: 8,
            }}
          >
            <div style={{ fontSize: 11, fontWeight: 700, color: "#fff" }}>{item.label}</div>
            <div style={{ fontSize: 9, color: "#64748b", marginTop: 2, fontFamily: "monospace" }}>{item.fileId}</div>
            <div style={{ fontSize: 10, color: "#cbd5e1", marginTop: 5, lineHeight: 1.45 }}>{item.reason}</div>
          </div>
        ))}
      </div>
    </div>
  );
}

function ComponentEdgeInspector(
  {
    viewId,
    edgeId,
    highlightedEvidenceId,
  }: {
    viewId: string;
    edgeId: string;
    highlightedEvidenceId: string | null;
  },
) {
  const graph = useStore((s) => s.graph);
  if (!graph?.componentDiagram) return null;

  const edge = graph.componentDiagram.edges.find((item) => item.id === edgeId && item.viewId === viewId);
  if (!edge) return null;
  const evidenceLookup = new Map(graph.componentDiagram.evidence.map((item) => [item.id, item]));
  const sourceLabel = getDiagramEntityLabel(graph, viewId, edge.source);
  const targetLabel = getDiagramEntityLabel(graph, viewId, edge.target);

  return (
    <div style={sectionStyle}>
      <div style={{ fontSize: 14, fontWeight: 700, color: "#fff" }}>{sourceLabel} → {targetLabel}</div>
      <div style={{ fontSize: 10, color: "#64748b", marginTop: 4 }}>
        {humanizeRelationshipKind(edge.relationshipKind)}
        {edge.technology ? ` · ${edge.technology}` : ""}
      </div>
      <div style={{ fontSize: 11, color: "#cbd5e1", marginTop: 8, lineHeight: 1.5 }}>
        {`${edge.label}${edge.technology ? `\n${edge.technology}` : ""}`.split("\n").map((line) => (
          <div key={line}>{line}</div>
        ))}
      </div>
      <div style={{ marginTop: 10 }}>
        {edge.evidenceIds.map((id) => {
          const evidence = evidenceLookup.get(id);
          if (!evidence) return null;
          return (
            <div
              key={id}
              style={{
                padding: "8px 10px",
                marginBottom: 8,
                background: id === highlightedEvidenceId ? "#172033" : "#0f172a",
                border: `1px solid ${id === highlightedEvidenceId ? "#94a3b8" : "#273449"}`,
                borderRadius: 8,
              }}
            >
              <div style={{ display: "flex", justifyContent: "space-between", gap: 8 }}>
                <div style={{ fontSize: 10, color: "#fff", fontWeight: 700 }}>{humanizeEvidenceKind(evidence.kind)}</div>
                <div style={{ fontSize: 9, color: confidenceTextColor(evidence.confidence) }}>
                  {confidenceBadgeLabel(evidence.confidence)}
                </div>
              </div>
              <div style={{ fontSize: 10, color: "#cbd5e1", marginTop: 4 }}>{evidence.detail}</div>
              <div style={{ fontSize: 9, color: "#64748b", marginTop: 4, fontFamily: "monospace" }}>
                {evidence.fileId}
                {evidence.line ? `:${evidence.line}` : ""}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function EdgeList(
  {
    viewId,
    title,
    edges,
    currentCardId,
  }: {
    viewId: string;
    title: string;
    edges: { id: string; source: string; target: string; label: string; relationshipKind: string }[];
    currentCardId: string;
  },
) {
  const graph = useStore((s) => s.graph);
  if (!graph?.componentDiagram || edges.length === 0) return null;

  return (
    <div style={{ marginTop: 12 }}>
      <div style={{ fontSize: 10, fontWeight: 700, color: "#94a3b8", marginBottom: 4 }}>
        {title}
      </div>
      {edges.map((edge) => {
        const otherId = edge.source === currentCardId ? edge.target : edge.source;
        return (
          <div key={edge.id} style={{ marginBottom: 6 }}>
            <div style={{ fontSize: 10, color: "#e5e7eb" }}>{getDiagramEntityLabel(graph, viewId, otherId)}</div>
            <div style={{ fontSize: 9, color: "#64748b", marginTop: 1 }}>
              {humanizeRelationshipKind(edge.relationshipKind)} · {edge.label.replaceAll("\n", " / ")}
            </div>
          </div>
        );
      })}
    </div>
  );
}

function getDiagramEntityLabel(
  graph: ArchitectureGraph,
  viewId: string,
  id: string,
): string {
  const card = graph.componentDiagram?.cards.find((item) => item.id === id && item.viewId === viewId);
  if (card) return card.title;
  const boundary = graph.componentDiagram?.boundaries.find((item) => item.id === id && item.viewId === viewId);
  if (boundary) return boundary.label;
  const container = graph.componentDiagram?.containers.find((item) => item.id === id && item.viewId === viewId);
  return container?.name ?? id;
}

function confidenceTextColor(confidence: "exact" | "derived" | "heuristic"): string {
  if (confidence === "exact") return "#22d3ee";
  if (confidence === "derived") return "#cbd5e1";
  return "#f59e0b";
}

function confidenceBadgeLabel(confidence: "exact" | "derived" | "heuristic"): string {
  if (confidence === "exact") return "Code";
  if (confidence === "derived") return "Summary";
  return "Guess";
}

function humanizeEvidenceKind(kind: string): string {
  switch (kind) {
    case "message_flow":
      return "Flow step";
    case "module_wiring":
      return "Wiring";
    case "route_group":
      return "Route group";
    case "memory_pipeline":
      return "Memory flow";
    default:
      return kind.replaceAll("_", " ").replace(/\b\w/g, (char) => char.toUpperCase());
  }
}

function humanizeRelationshipKind(kind: string): string {
  switch (kind) {
    case "transport":
      return "Transport";
    case "queued_command":
      return "Queued action";
    case "event_subscription":
      return "Event listener";
    case "direct_call":
      return "Direct call";
    case "persistence_io":
      return "Persistence read/write";
    case "mixed":
      return "Mixed connection";
    default:
      return kind.replaceAll("_", " ");
  }
}

function searchComponentDiagram(
  graph: ArchitectureGraph,
  viewId: string,
  query: string,
  evidenceLookup: Map<string, { detail: string }>,
): { cardId: string; cardTitle: string; label: string; evidenceId?: string }[] {
  const needle = query.trim().toLowerCase();
  if (needle.length === 0) return [];

  const results: { cardId: string; cardTitle: string; label: string; evidenceId?: string }[] = [];
  for (const card of graph.componentDiagram?.cards.filter((item) => item.viewId === viewId) ?? []) {
    const maybePush = (label: string, evidenceId?: string) => {
      if (!label.toLowerCase().includes(needle)) return;
      results.push({ cardId: card.id, cardTitle: card.title, label, evidenceId });
    };

    maybePush(card.title);
    if (card.subtitle) maybePush(card.subtitle);
    if (card.summary) maybePush(card.summary);
    if (card.fileId) maybePush(card.fileId);
    for (const section of card.sections) {
      maybePush(section.label);
      for (const line of section.lines) {
        maybePush(line.text, line.evidenceIds[0]);
        for (const evidenceId of line.evidenceIds) {
          const evidence = evidenceLookup.get(evidenceId);
          if (evidence) maybePush(evidence.detail, evidenceId);
        }
      }
    }
    for (const child of card.childCards ?? []) {
      maybePush(child.title);
      if (child.subtitle) maybePush(child.subtitle);
      if (child.summary) maybePush(child.summary);
      for (const line of child.lines) maybePush(line);
    }
  }

  return results;
}

function getActiveComponentView(
  diagram: NonNullable<ArchitectureGraph["componentDiagram"]>,
  activeViewId: string | null,
) {
  return (
    diagram.views.find((item) => item.id === activeViewId) ??
    diagram.views.find((item) => item.id === diagram.defaultViewId) ??
    diagram.views[0] ??
    null
  );
}

// ---------------------------------------------------------------------------
// Intro panel — shown when nothing is selected (non-flow views)
// ---------------------------------------------------------------------------

function IntroPanel() {
  const graph = useStore((s) => s.graph);
  const zoomLevel = useStore((s) => s.zoomLevel);
  if (!graph) return null;
  const hasDetailedComponentDiagram = Boolean(graph.componentDiagram);

  return (
    <div style={sectionStyle}>
      <div style={{ fontSize: 12, fontWeight: 700, color: "#ccc", marginBottom: 10 }}>
        How to explore
      </div>
      <div style={tipStyle}>
        <Kbd>Hover</Kbd> a node or edge to highlight its connections
      </div>
      <div style={tipStyle}>
        <Kbd>Click</Kbd> any node to see its details here
      </div>
      {!(zoomLevel === "component" && hasDetailedComponentDiagram) && (
        <div style={tipStyle}>
          <Kbd>Double-click</Kbd> a component to expand its files
        </div>
      )}
      {!(zoomLevel === "component" && hasDetailedComponentDiagram) && (
        <div style={tipStyle}>
          Use the toggles above to filter edge types
        </div>
      )}
      {zoomLevel === "component" && hasDetailedComponentDiagram && (
        <div style={tipStyle}>
          The component view is a curated, code-derived diagram with fixed positions for readability.
        </div>
      )}
      <div style={tipStyle}>
        Switch between <strong>Components</strong>, <strong>Files</strong>, <strong>Classes</strong>, and <strong>Data Flow</strong> views
      </div>
      <div style={tipStyle}>
        <Kbd>Esc</Kbd> to clear selection and highlighting
      </div>

      <div style={{ borderTop: "1px solid #252545", marginTop: 12, paddingTop: 12 }}>
        <div style={{ fontSize: 11, fontWeight: 600, color: "#999", marginBottom: 6 }}>
          Quick stats
        </div>
        <div style={statRow}>
          <span style={{ color: "#777" }}>Event types</span>
          <span style={{ color: "#648FFF" }}>{graph.meta.eventTypeCount}</span>
        </div>
        <div style={statRow}>
          <span style={{ color: "#777" }}>Command types</span>
          <span style={{ color: "#DC267F" }}>{graph.meta.commandTypeCount}</span>
        </div>
        <div style={statRow}>
          <span style={{ color: "#777" }}>Cross-component edges</span>
          <span style={{ color: "#FFB000" }}>{graph.boundaries.length}</span>
        </div>
        <div style={statRow}>
          <span style={{ color: "#777" }}>Message flows</span>
          <span style={{ color: "#22D3EE" }}>{(graph.messageFlows ?? []).length}</span>
        </div>
      </div>
    </div>
  );
}

function Kbd({ children }: { children: React.ReactNode }) {
  return (
    <span
      style={{
        display: "inline-block",
        padding: "1px 6px",
        fontSize: 10,
        fontWeight: 700,
        color: "#ccc",
        background: "#252545",
        border: "1px solid #333",
        borderRadius: 4,
        marginRight: 4,
        fontFamily: "inherit",
      }}
    >
      {children}
    </span>
  );
}

// ---------------------------------------------------------------------------
// Node detail
// ---------------------------------------------------------------------------

function NodeDetail({ nodeId }: { nodeId: string }) {
  const graph = useStore((s) => s.graph);
  if (!graph) return null;

  const diagramBoundary = graph.componentDiagram?.boundaries.find((boundary) => boundary.id === nodeId);
  if (diagramBoundary) {
    const cardCount = graph.componentDiagram?.cards.filter((card) => card.boundaryId === diagramBoundary.id).length ?? 0;
    return (
      <div style={sectionStyle}>
        <div style={{ fontSize: 14, fontWeight: 700, color: diagramBoundary.color }}>{diagramBoundary.label}</div>
        <div style={{ fontSize: 11, color: "#888", marginTop: 4 }}>{diagramBoundary.technology}</div>
        <div style={{ fontSize: 11, color: "#aaa", marginTop: 8, lineHeight: 1.5 }}>
          {diagramBoundary.description}
        </div>
        <div style={{ fontSize: 10, color: "#666", marginTop: 8 }}>{cardCount} cards</div>
      </div>
    );
  }

  const diagramCard = graph.componentDiagram?.cards.find((card) => card.id === nodeId);
  if (diagramCard) {
    return (
      <div style={sectionStyle}>
        <div style={{ fontSize: 14, fontWeight: 700, color: diagramCard.accentColor }}>
          {diagramCard.title}
        </div>
        {diagramCard.subtitle && (
          <div style={{ fontSize: 10, color: "#666", marginTop: 2, fontFamily: "monospace" }}>
            {diagramCard.subtitle}
          </div>
        )}

        {diagramCard.sections.map((section) => (
          <div key={section.id} style={{ marginTop: 8 }}>
            <div style={{ fontSize: 10, fontWeight: 600, color: "#999", textTransform: "uppercase" }}>
              {section.label}
            </div>
            {section.lines.map((line) => (
              <div key={line.id} style={{ fontSize: 10, color: "#ccc", marginTop: 2, fontFamily: "monospace" }}>
                {line.text}
              </div>
            ))}
          </div>
        ))}

        {diagramCard.childCards && diagramCard.childCards.length > 0 && (
          <div style={{ marginTop: 10 }}>
            <div style={{ fontSize: 10, fontWeight: 600, color: "#999", marginBottom: 4 }}>
              Internals
            </div>
            {diagramCard.childCards.map((child) => (
              <div key={`${child.title}-${child.subtitle ?? ""}`} style={{ marginBottom: 8 }}>
                <div style={{ fontSize: 11, fontWeight: 600, color: "#ddd" }}>
                  {child.title}
                </div>
                {child.subtitle && (
                  <div style={{ fontSize: 9, color: "#666", fontFamily: "monospace" }}>
                    {child.fileId ?? child.subtitle}
                  </div>
                )}
                {child.lines.map((line) => (
                  <div key={line} style={{ fontSize: 10, color: "#aaa", marginTop: 1, fontFamily: "monospace" }}>
                    {line}
                  </div>
                ))}
              </div>
            ))}
          </div>
        )}
      </div>
    );
  }

  const comp = graph.components.find((c) => c.id === nodeId);
  if (comp) {
    return (
      <div style={sectionStyle}>
        <div style={{ fontSize: 14, fontWeight: 700, color: comp.color }}>{comp.label}</div>
        <div style={{ fontSize: 11, color: "#888", marginTop: 4 }}>
          {comp.fileIds.length} files &middot; {comp.totalLoc.toLocaleString()} lines
        </div>
        <div style={{ marginTop: 8 }}>
          {comp.fileIds.map((fid) => (
            <div key={fid} style={{ fontSize: 10, color: "#aaa", lineHeight: 1.6, fontFamily: "monospace" }}>
              {fid.split("/").pop()}
            </div>
          ))}
        </div>
      </div>
    );
  }

  const file = graph.files.find((f) => f.id === nodeId);
  if (file) {
    const fileComp = graph.components.find((c) => c.id === file.componentId);
    return (
      <div style={sectionStyle}>
        <div style={{ fontSize: 13, fontWeight: 700, color: fileComp?.color ?? "#fff" }}>
          {nodeId.split("/").pop()}
        </div>
        <div style={{ fontSize: 10, color: "#555", marginTop: 2, fontFamily: "monospace" }}>{nodeId}</div>
        <div style={{ fontSize: 11, color: "#888", marginTop: 6 }}>{file.loc} lines</div>
        {file.classes.length > 0 && (
          <div style={{ marginTop: 8 }}>
            <div style={{ fontSize: 10, fontWeight: 600, color: "#999", marginBottom: 2 }}>Classes</div>
            {file.classes.map((c) => (
              <div key={c} style={{ fontSize: 11, color: "#ccc", marginTop: 2 }}>{c}</div>
            ))}
          </div>
        )}
      </div>
    );
  }

  const cls = graph.classes.find((c) => c.id === nodeId);
  if (cls) {
    const clsComp = graph.components.find((c) => c.id === cls.componentId);
    return (
      <div style={sectionStyle}>
        <div style={{ fontSize: 14, fontWeight: 700, color: clsComp?.color ?? "#fff" }}>{cls.name}</div>
        <div style={{ fontSize: 10, color: "#555" }}>{cls.kind} &middot; {cls.fileId.split("/").pop()}</div>
        {cls.fields.length > 0 && (
          <div style={{ marginTop: 8 }}>
            <div style={{ fontSize: 10, fontWeight: 600, color: "#999" }}>Fields</div>
            {cls.fields.map((f) => (
              <div key={f.name} style={{ fontSize: 10, color: "#888", marginTop: 2, fontFamily: "monospace" }}>
                {f.visibility === "private" ? "- " : "+ "}{f.name}
              </div>
            ))}
          </div>
        )}
        {cls.methods.length > 0 && (
          <div style={{ marginTop: 8 }}>
            <div style={{ fontSize: 10, fontWeight: 600, color: "#999" }}>Methods</div>
            {cls.methods.map((m) => (
              <div key={m.name} style={{ fontSize: 10, color: "#aaa", marginTop: 2, fontFamily: "monospace" }}>
                {m.visibility === "private" ? "- " : "+ "}{m.isAsync ? "async " : ""}{m.name}()
              </div>
            ))}
          </div>
        )}
      </div>
    );
  }

  return null;
}

// ---------------------------------------------------------------------------
// Edge detail
// ---------------------------------------------------------------------------

function EdgeDetail({ edgeId }: { edgeId: string }) {
  const graph = useStore((s) => s.graph);
  if (!graph) return null;

  const diagramEdge = graph.componentDiagram?.edges.find((edge) => edge.id === edgeId);
  if (diagramEdge) {
    const sourceCard =
      graph.componentDiagram?.cards.find((card) => card.id === diagramEdge.source) ??
      graph.componentDiagram?.boundaries.find((boundary) => boundary.id === diagramEdge.source);
    const targetCard =
      graph.componentDiagram?.cards.find((card) => card.id === diagramEdge.target) ??
      graph.componentDiagram?.boundaries.find((boundary) => boundary.id === diagramEdge.target);
    const sourceLabel = sourceCard
      ? "title" in sourceCard
        ? sourceCard.title
        : sourceCard.label
      : diagramEdge.source;
    const targetLabel = targetCard
      ? "title" in targetCard
        ? targetCard.title
        : targetCard.label
      : diagramEdge.target;

    return (
      <div style={sectionStyle}>
        <div style={{ fontSize: 14, fontWeight: 700, color: "#fff" }}>
          {sourceLabel} ↔ {targetLabel}
        </div>
        <div style={{ fontSize: 10, color: "#666", marginTop: 4 }}>{diagramEdge.relationshipKind}</div>
        <div style={{ fontSize: 11, color: "#888", marginTop: 6, lineHeight: 1.5 }}>
          {diagramEdge.label.split("\n").map((line) => (
            <div key={line}>{line}</div>
          ))}
        </div>
      </div>
    );
  }

  if (!edgeId.startsWith("boundary-")) return null;

  const parts = edgeId.replace("boundary-", "").split("-");
  const boundary = graph.boundaries.find((b) => b.source === parts[0] && b.target === parts[1]);
  const reverse = graph.boundaries.find((b) => b.source === parts[1] && b.target === parts[0]);

  if (!boundary) return null;

  return (
    <div style={sectionStyle}>
      <div style={{ fontSize: 14, fontWeight: 700, color: "#fff" }}>
        {boundary.source} ↔ {boundary.target}
      </div>
      <div style={{ fontSize: 11, color: "#888", marginTop: 6 }}>
        {boundary.eventCount > 0 && <span style={{ color: "#648FFF" }}>{boundary.eventCount} events </span>}
        {boundary.callCount > 0 && <span style={{ color: "#FFB000" }}>{boundary.callCount} imports </span>}
        {boundary.mutationCount > 0 && <span style={{ color: "#DC267F" }}>{boundary.mutationCount} commands</span>}
      </div>

      <div style={{ marginTop: 10 }}>
        <div style={{ fontSize: 10, fontWeight: 600, color: "#999", marginBottom: 4 }}>Details</div>
        {boundary.details.slice(0, 12).map((d, i) => (
          <div
            key={i}
            style={{
              fontSize: 10,
              color: d.kind === "event" ? "#648FFF" : d.kind === "mutation" ? "#DC267F" : "#FFB000",
              lineHeight: 1.6,
              fontFamily: "monospace",
            }}
          >
            {d.description}
          </div>
        ))}
        {boundary.details.length > 12 && (
          <div style={{ fontSize: 9, color: "#555", marginTop: 2 }}>
            +{boundary.details.length - 12} more
          </div>
        )}
      </div>

      {reverse && (
        <div style={{ marginTop: 10, borderTop: "1px solid #252545", paddingTop: 8 }}>
          <div style={{ fontSize: 10, fontWeight: 600, color: "#999", marginBottom: 4 }}>
            Reverse ({reverse.source} → {reverse.target})
          </div>
          {reverse.details.slice(0, 8).map((d, i) => (
            <div
              key={`r-${i}`}
              style={{
                fontSize: 10,
                color: d.kind === "event" ? "#648FFF" : d.kind === "mutation" ? "#DC267F" : "#FFB000",
                lineHeight: 1.6,
                fontFamily: "monospace",
              }}
            >
              {d.description}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Styles
// ---------------------------------------------------------------------------

const sidebarStyle: React.CSSProperties = {
  width: 320,
  background: "#0d0d1a",
  borderLeft: "1px solid #1e1e35",
  padding: "16px 14px",
  overflowY: "auto",
  display: "flex",
  flexDirection: "column",
};

const sectionStyle: React.CSSProperties = {
  background: "#141428",
  borderRadius: 8,
  padding: 12,
  marginBottom: 10,
  border: "1px solid #1e1e35",
};

const tipStyle: React.CSSProperties = {
  fontSize: 11,
  color: "#888",
  lineHeight: 1.7,
  marginBottom: 2,
};

const statRow: React.CSSProperties = {
  display: "flex",
  justifyContent: "space-between",
  fontSize: 11,
  lineHeight: 1.8,
};
