import { useState } from "react";
import { useStore, type ComponentFocusDirection, type ComponentInspectorTab, type CouplingFilter } from "./store";
import type { ArchitectureGraph, EventInfo, ZoomLevel } from "./types";

const ZOOM_LABELS: Record<ZoomLevel, string> = {
  component: "Components",
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
  const componentInspectorTab = useStore((s) => s.componentInspectorTab);
  const setComponentInspectorTab = useStore((s) => s.setComponentInspectorTab);
  const componentFocusEnabled = useStore((s) => s.componentFocusEnabled);
  const toggleComponentFocus = useStore((s) => s.toggleComponentFocus);
  const componentFocusDirection = useStore((s) => s.componentFocusDirection);
  const setComponentFocusDirection = useStore((s) => s.setComponentFocusDirection);
  const componentSearchQuery = useStore((s) => s.componentSearchQuery);
  const setComponentSearchQuery = useStore((s) => s.setComponentSearchQuery);

  if (!graph) {
    return (
      <div style={sidebarStyle}>
        <div style={{ color: "#666", fontSize: 13 }}>Loading graph.json...</div>
      </div>
    );
  }

  const hasSelection = selectedNodeId || selectedEdgeId;
  const isFlowView = zoomLevel === "flow";
  const hasDetailedComponentDiagram = Boolean(graph.componentDiagram);
  const isDetailedComponentView = zoomLevel === "component" && hasDetailedComponentDiagram;

  return (
    <div style={sidebarStyle}>
      {/* Title */}
      <h1 style={{ fontSize: 18, fontWeight: 800, color: "#fff", margin: "0 0 2px", letterSpacing: -0.3 }}>
        AI Town Architecture
      </h1>
      <div style={{ fontSize: 11, color: "#666", marginBottom: 16 }}>
        {graph.meta.fileCount} files &middot; {graph.meta.classCount} types &middot;{" "}
        {graph.components.length} components
      </div>

      {/* Zoom level toggle */}
      <div style={{ display: "flex", gap: 4, marginBottom: 14, flexWrap: "wrap" }}>
        {(["component", "file", "class", "flow"] as ZoomLevel[]).map((level) => (
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
      {!isFlowView && !(zoomLevel === "component" && hasDetailedComponentDiagram) && (
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
      {isDetailedComponentView && (
        <ComponentTabControls
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
        isDetailedComponentView ? (
          <ComponentInspector />
        ) : (
          hasSelection ? (
            <>
              {selectedNodeId && <NodeDetail nodeId={selectedNodeId} />}
              {selectedEdgeId && <EdgeDetail edgeId={selectedEdgeId} />}
            </>
          ) : (
            <IntroPanel />
          )
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

function ComponentTabControls(
  {
    inspectorTab,
    onSelectTab,
    focusEnabled,
    onToggleFocus,
    focusDirection,
    onSelectFocusDirection,
    searchQuery,
    onSearchChange,
  }: {
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

  const evidenceLookup = new Map(graph.componentDiagram.evidence.map((item) => [item.id, item]));
  const results = searchComponentDiagram(graph, searchQuery, evidenceLookup);
  const selectedCard = selectedNodeId
    ? graph.componentDiagram.cards.find((card) => card.id === selectedNodeId) ?? null
    : null;
  const selectedBoundary = selectedNodeId
    ? graph.componentDiagram.boundaries.find((boundary) => boundary.id === selectedNodeId) ?? null
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

      <input
        value={searchQuery}
        onChange={(event) => onSearchChange(event.target.value)}
        placeholder="Search components, routes, events, files..."
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
          Boxes are major parts of the app. Arrows show how those parts talk to each other.
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
            <div style={{ fontSize: 10, color: "#64748b" }}>No component matches.</div>
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
  const inspectorTab = useStore((s) => s.componentInspectorTab);
  const highlightedEvidenceId = useStore((s) => s.highlightedEvidenceId);

  if (!graph?.componentDiagram) return null;
  if (!selectedNodeId && !selectedEdgeId) return <ComponentIntroPanel />;

  if (selectedEdgeId) {
    return <ComponentEdgeInspector edgeId={selectedEdgeId} highlightedEvidenceId={highlightedEvidenceId} />;
  }

  const boundary = graph.componentDiagram.boundaries.find((item) => item.id === selectedNodeId);
  if (boundary) {
    return <ComponentBoundaryInspector boundaryId={boundary.id} />;
  }

  const card = graph.componentDiagram.cards.find((item) => item.id === selectedNodeId);
  if (!card) return <ComponentIntroPanel />;

  switch (inspectorTab) {
    case "contract":
      return <ComponentContractInspector cardId={card.id} />;
    case "internals":
      return <ComponentInternalsInspector cardId={card.id} />;
    case "evidence":
      return <ComponentEvidenceInspector cardId={card.id} highlightedEvidenceId={highlightedEvidenceId} />;
    case "open_next":
      return <ComponentOpenNextInspector cardId={card.id} />;
    case "overview":
    default:
      return <ComponentOverviewInspector cardId={card.id} />;
  }
}

function ComponentIntroPanel() {
  const graph = useStore((s) => s.graph);
  if (!graph?.componentDiagram) return null;

  return (
    <div style={sectionStyle}>
      <div style={{ fontSize: 12, fontWeight: 700, color: "#ccc", marginBottom: 10 }}>
        Components Tab
      </div>
      <div style={tipStyle}>
        The canvas is intentionally sparse. Use the sidebar buttons above for a quick summary, inputs and outputs, what is inside, why the view shows this, and which files to read next.
      </div>
      <div style={tipStyle}>
        Click a component card to switch the sidebar into a component-specific inspector.
      </div>
      <div style={tipStyle}>
        Small badges on the chart tell you whether a line came straight from code, is a short summary of several code facts, or is a best-effort guess.
      </div>
      <div style={tipStyle}>
        Use the search box to find a route, message type, event, or file and jump directly to the owning component.
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

function ComponentBoundaryInspector({ boundaryId }: { boundaryId: string }) {
  const graph = useStore((s) => s.graph);
  if (!graph?.componentDiagram) return null;

  const boundary = graph.componentDiagram.boundaries.find((item) => item.id === boundaryId);
  if (!boundary) return null;
  const cards = graph.componentDiagram.cards.filter((card) => card.boundaryId === boundary.id);

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
    </div>
  );
}

function ComponentOverviewInspector({ cardId }: { cardId: string }) {
  const graph = useStore((s) => s.graph);
  if (!graph?.componentDiagram) return null;
  const card = graph.componentDiagram.cards.find((item) => item.id === cardId);
  if (!card) return null;

  const connectedEdges = graph.componentDiagram.edges.filter((edge) => edge.source === card.id || edge.target === card.id);
  const neighbors = connectedEdges.map((edge) => {
    const neighborId = edge.source === card.id ? edge.target : edge.source;
    const neighborCard = graph.componentDiagram?.cards.find((item) => item.id === neighborId);
    const neighborBoundary = graph.componentDiagram?.boundaries.find((item) => item.id === neighborId);
    return neighborCard?.title ?? neighborBoundary?.label ?? neighborId;
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

function ComponentContractInspector({ cardId }: { cardId: string }) {
  const graph = useStore((s) => s.graph);
  if (!graph?.componentDiagram) return null;
  const card = graph.componentDiagram.cards.find((item) => item.id === cardId);
  if (!card) return null;

  const inboundEdges = graph.componentDiagram.edges.filter((edge) => edge.target === card.id);
  const outboundEdges = graph.componentDiagram.edges.filter((edge) => edge.source === card.id);

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

      <EdgeList title="Who Feeds This Component" edges={inboundEdges} currentCardId={card.id} />
      <EdgeList title="What This Component Affects" edges={outboundEdges} currentCardId={card.id} />
    </div>
  );
}

function ComponentInternalsInspector({ cardId }: { cardId: string }) {
  const graph = useStore((s) => s.graph);
  if (!graph?.componentDiagram) return null;
  const card = graph.componentDiagram.cards.find((item) => item.id === cardId);
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
    cardId,
    highlightedEvidenceId,
  }: {
    cardId: string;
    highlightedEvidenceId: string | null;
  },
) {
  const graph = useStore((s) => s.graph);
  const setHighlightedEvidenceId = useStore((s) => s.setHighlightedEvidenceId);
  if (!graph?.componentDiagram) return null;

  const card = graph.componentDiagram.cards.find((item) => item.id === cardId);
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

function ComponentOpenNextInspector({ cardId }: { cardId: string }) {
  const graph = useStore((s) => s.graph);
  if (!graph?.componentDiagram) return null;
  const card = graph.componentDiagram.cards.find((item) => item.id === cardId);
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
    edgeId,
    highlightedEvidenceId,
  }: {
    edgeId: string;
    highlightedEvidenceId: string | null;
  },
) {
  const graph = useStore((s) => s.graph);
  if (!graph?.componentDiagram) return null;

  const edge = graph.componentDiagram.edges.find((item) => item.id === edgeId);
  if (!edge) return null;
  const evidenceLookup = new Map(graph.componentDiagram.evidence.map((item) => [item.id, item]));
  const sourceLabel = getDiagramEntityLabel(graph, edge.source);
  const targetLabel = getDiagramEntityLabel(graph, edge.target);

  return (
    <div style={sectionStyle}>
      <div style={{ fontSize: 14, fontWeight: 700, color: "#fff" }}>{sourceLabel} → {targetLabel}</div>
      <div style={{ fontSize: 10, color: "#64748b", marginTop: 4 }}>{humanizeRelationshipKind(edge.relationshipKind)}</div>
      <div style={{ fontSize: 11, color: "#cbd5e1", marginTop: 8, lineHeight: 1.5 }}>
        {edge.label.split("\n").map((line) => (
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
    title,
    edges,
    currentCardId,
  }: {
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
            <div style={{ fontSize: 10, color: "#e5e7eb" }}>{getDiagramEntityLabel(graph, otherId)}</div>
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
  id: string,
): string {
  const card = graph.componentDiagram?.cards.find((item) => item.id === id);
  if (card) return card.title;
  const boundary = graph.componentDiagram?.boundaries.find((item) => item.id === id);
  return boundary?.label ?? id;
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
  query: string,
  evidenceLookup: Map<string, { detail: string }>,
): { cardId: string; cardTitle: string; label: string; evidenceId?: string }[] {
  const needle = query.trim().toLowerCase();
  if (needle.length === 0) return [];

  const results: { cardId: string; cardTitle: string; label: string; evidenceId?: string }[] = [];
  for (const card of graph.componentDiagram?.cards ?? []) {
    const maybePush = (label: string, evidenceId?: string) => {
      if (!label.toLowerCase().includes(needle)) return;
      results.push({ cardId: card.id, cardTitle: card.title, label, evidenceId });
    };

    maybePush(card.title);
    if (card.subtitle) maybePush(card.subtitle);
    if (card.summary) maybePush(card.summary);
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
  width: 280,
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
