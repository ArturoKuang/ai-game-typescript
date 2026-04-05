import type { CSSProperties } from "react";
import { useStore, type ContainerInspectorTab } from "../store";
import type { ArchitectureGraph } from "../types";
import { EvidenceRow, InspectorHeader, actionButtonStyle, relationshipMetaBadgeStyle } from "./sharedInspector";

export const CONTAINER_INSPECTOR_TABS: {
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

// Audit note: the container view is the most complete inspector family outside
// the main Sidebar shell. Keeping its controls, inspectors, and search helper in
// one module makes it easier to audit the container story end to end.
const sectionStyle: CSSProperties = {
  background: "#141428",
  borderRadius: 8,
  padding: 12,
  marginBottom: 10,
  border: "1px solid #1e1e35",
};

export function ContainerTabControls(
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

export function ContainerInspector() {
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
    relationships: NonNullable<ArchitectureGraph["containerDiagram"]>["relationships"];
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
