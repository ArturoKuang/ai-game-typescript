import { useState, type CSSProperties } from "react";
import { useStore } from "../store";
import type { ArchitectureGraph, EventInfo } from "../types";

const FLOW_LANE_COLORS: Record<string, string> = {
  Client: "#FE6100",
  Network: "#22D3EE",
  Engine: "#648FFF",
  NPC: "#DC267F",
  Persistence: "#FFB000",
};

// Audit note: this mirrors Sidebar's generic card chrome on purpose. Keeping it
// local makes the extraction atomic; a shared style module can come later as a
// separate cleanup once more panel families are split out.
const sectionStyle: CSSProperties = {
  background: "#141428",
  borderRadius: 8,
  padding: 12,
  marginBottom: 10,
  border: "1px solid #1e1e35",
};

// Audit note: keep every flow-view-only inspector panel in this module so the
// main Sidebar can stay focused on view switching and generic inspector chrome.
export function FlowControls() {
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
  const uncoveredEvents = getUncoveredEvents(graph);

  return (
    <>
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
            const group = flowGroups.find((item) => item.id === selectedFlowGroup);
            return group ? (
              <div style={{ fontSize: 9, color: "#666", lineHeight: 1.4, marginTop: 4 }}>
                {group.description}
              </div>
            ) : null;
          })()}
        </div>
      )}

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
            const group = flowGroups.find((item) => item.id === selectedFlowGroup);
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

      {selectedFlow && <FlowDetail flowType={selectedFlow} />}
      {!selectedFlow && uncoveredEvents.length > 0 && (
        <FlowCoverage uncoveredEvents={uncoveredEvents} />
      )}

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

      {selectedStateMachine && <StateMachineDetail smId={selectedStateMachine} />}

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
              ].map((badge) => (
                <div key={badge.label} style={{ display: "flex", alignItems: "center", gap: 4 }}>
                  <span
                    style={{
                      fontSize: 8,
                      fontWeight: 700,
                      color: badge.color,
                      background: `${badge.color}18`,
                      border: `1px solid ${badge.color}35`,
                      borderRadius: 3,
                      padding: "0px 4px",
                    }}
                  >
                    {badge.label}
                  </span>
                  <span style={{ fontSize: 9, color: "#777" }}>{badge.desc}</span>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}
    </>
  );
}

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
          {uncoveredEvents.map((eventInfo) => (
            <div
              key={eventInfo.eventType}
              style={{
                fontSize: 10,
                color: "#888",
                fontFamily: "monospace",
                lineHeight: 1.6,
              }}
            >
              {eventInfo.eventType}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function FlowDetail({ flowType }: { flowType: string }) {
  const graph = useStore((s) => s.graph);
  const selectedFlowStep = useStore((s) => s.selectedFlowStep);
  const setSelectedFlowStep = useStore((s) => s.setSelectedFlowStep);

  if (!graph) return null;

  const flow = (graph.messageFlows ?? []).find((item) => item.clientMessageType === flowType);
  if (!flow) return null;

  const selectedStep = selectedFlowStep != null ? flow.steps[selectedFlowStep] : null;
  const stateEffects = flow.steps
    .filter((step) => step.stateTransition)
    .map((step) => step.stateTransition!);

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
          {flow.steps.map((step, index) => {
            const laneColor = FLOW_LANE_COLORS[step.lane] ?? "#888";
            const isSelected = selectedFlowStep === index;
            return (
              <div
                key={index}
                onClick={() => setSelectedFlowStep(isSelected ? null : index)}
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

        {stateEffects.length > 0 && (
          <div style={{ marginTop: 10, borderTop: "1px solid #252545", paddingTop: 8 }}>
            <div style={{ fontSize: 10, fontWeight: 600, color: "#a78bfa", marginBottom: 4 }}>
              State effects
            </div>
            {stateEffects.map((transition, index) => (
              <div
                key={index}
                style={{ fontSize: 9, color: "#888", lineHeight: 1.6, fontFamily: "monospace" }}
              >
                <span style={{ color: "#a78bfa" }}>{transition.machineId}</span>: {transition.from} &rarr; {transition.to}
              </div>
            ))}
          </div>
        )}
      </div>

      {selectedStep?.produces && (
        <FlowStepCrossReference
          graph={graph}
          producesValue={selectedStep.produces}
        />
      )}

      {selectedStep?.errorPaths && selectedStep.errorPaths.length > 0 && (
        <div style={sectionStyle}>
          <div style={{ fontSize: 10, fontWeight: 600, color: "#f59e0b", marginBottom: 6 }}>
            Validation checks
          </div>
          {selectedStep.errorPaths.map((errorPath, index) => (
            <div
              key={index}
              style={{
                fontSize: 10,
                color: "#aaa",
                lineHeight: 1.5,
                padding: "2px 0",
                borderBottom: "1px solid #1e1e35",
              }}
            >
              <span style={{ color: "#f59e0b" }}>{errorPath.condition}</span>
              <span style={{ color: "#555", fontSize: 9 }}> &rarr; {errorPath.produces}</span>
            </div>
          ))}
        </div>
      )}
    </>
  );
}

function FlowStepCrossReference({
  graph,
  producesValue,
}: {
  graph: ArchitectureGraph;
  producesValue: string;
}) {
  // Audit note: flow steps can point at either event types or command types, so
  // the drilldown intentionally checks both catalogs before showing "no match".
  const matchingEvent = (graph.events ?? []).find((eventInfo) => eventInfo.eventType === producesValue);
  const matchingCommand = (graph.commands ?? []).find((commandInfo) => commandInfo.commandType === producesValue);

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
              {matchingEvent.emitters.slice(0, 6).map((emitter, index) => (
                <div key={index} style={{ fontSize: 9, color: "#777", fontFamily: "monospace", lineHeight: 1.5 }}>
                  {emitter.fileId.split("/").pop()}
                  {emitter.classId && <span style={{ color: "#555" }}> ({emitter.classId})</span>}
                  {emitter.line && <span style={{ color: "#555" }}>:{emitter.line}</span>}
                </div>
              ))}
            </div>
          )}
          {matchingEvent.subscribers.length > 0 && (
            <div>
              <div style={{ fontSize: 9, fontWeight: 600, color: "#888", marginBottom: 3 }}>
                Subscribers ({matchingEvent.subscribers.length})
              </div>
              {matchingEvent.subscribers.slice(0, 6).map((subscriber, index) => (
                <div key={index} style={{ fontSize: 9, color: "#777", fontFamily: "monospace", lineHeight: 1.5 }}>
                  {subscriber.fileId.split("/").pop()}
                  {subscriber.classId && <span style={{ color: "#555" }}> ({subscriber.classId})</span>}
                  {subscriber.line && <span style={{ color: "#555" }}>:{subscriber.line}</span>}
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
          {matchingCommand.producers.slice(0, 6).map((producer, index) => (
            <div key={index} style={{ fontSize: 9, color: "#777", fontFamily: "monospace", lineHeight: 1.5 }}>
              {producer.fileId.split("/").pop()}
              {producer.classId && <span style={{ color: "#555" }}> ({producer.classId})</span>}
              {producer.line && <span style={{ color: "#555" }}>:{producer.line}</span>}
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

function StateMachineDetail({ smId }: { smId: string }) {
  const graph = useStore((s) => s.graph);
  const setSelectedFlow = useStore((s) => s.setSelectedFlow);

  if (!graph) return null;

  const stateMachine = (graph.stateMachines ?? []).find((item) => item.id === smId);
  if (!stateMachine) return null;

  return (
    <div style={sectionStyle}>
      <div style={{ fontSize: 13, fontWeight: 700, color: "#ccc" }}>
        {stateMachine.label}
      </div>
      <div style={{ fontSize: 10, color: "#888", marginTop: 4, lineHeight: 1.4 }}>
        {stateMachine.description}
      </div>

      <div style={{ marginTop: 10 }}>
        <div style={{ fontSize: 10, fontWeight: 600, color: "#999", marginBottom: 4 }}>
          States
        </div>
        {stateMachine.states.map((state) => (
          <div key={state.id} style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 3 }}>
            <div
              style={{
                width: 10,
                height: 10,
                borderRadius: state.isTerminal ? 3 : 10,
                background: state.color ?? "#888",
                flexShrink: 0,
              }}
            />
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
        {stateMachine.transitions.map((transition, index) => (
          <div
            key={index}
            style={{
              fontSize: 10,
              color: "#aaa",
              lineHeight: 1.6,
              marginBottom: 4,
            }}
          >
            <span style={{ color: stateMachine.states.find((state) => state.id === transition.from)?.color ?? "#888" }}>
              {transition.from}
            </span>
            {" -> "}
            <span style={{ color: stateMachine.states.find((state) => state.id === transition.to)?.color ?? "#888" }}>
              {transition.to}
            </span>
            <span style={{ color: "#666" }}> : {transition.trigger}</span>
            {transition.condition && (
              <div style={{ fontSize: 9, color: "#555", marginLeft: 12 }}>
                {transition.condition}
              </div>
            )}
            {transition.triggeringFlows && transition.triggeringFlows.length > 0 && (
              <div style={{ marginLeft: 12, marginTop: 2, display: "flex", flexWrap: "wrap", gap: 3 }}>
                {transition.triggeringFlows.map((flowType) => (
                  <span
                    key={flowType}
                    onClick={() => setSelectedFlow(flowType)}
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
                    {flowType}
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

function getUncoveredEvents(graph: ArchitectureGraph): EventInfo[] {
  const allProducedValues = new Set<string>();

  // Audit note: coverage is tied to extractor output, not runtime traces. If an
  // event looks uncovered, first check whether the flow step forgot to declare
  // its `produces` field before assuming the event catalog is wrong.
  for (const flow of graph.messageFlows ?? []) {
    for (const step of flow.steps) {
      if (step.produces) {
        allProducedValues.add(step.produces);
      }
    }
  }

  return (graph.events ?? []).filter((eventInfo) => !allProducedValues.has(eventInfo.eventType));
}
