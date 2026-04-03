import { Handle, Position, type NodeProps } from "@xyflow/react";
import type { CSSProperties } from "react";
import type {
  ComponentDiagramLine,
  ComponentDiagramMetric,
  ComponentDiagramMiniCard,
  ComponentDiagramSection,
} from "../types";
import { useStore } from "../store";

const MAX_VISIBLE_LINES = 3;

interface DetailedComponentCardData {
  cardId: string;
  title: string;
  subtitle?: string;
  fileId?: string;
  accentColor: string;
  summary?: string;
  sections: ComponentDiagramSection[];
  childCards?: ComponentDiagramMiniCard[];
  childColumns?: number;
  badges?: string[];
  metrics?: ComponentDiagramMetric[];
  [key: string]: unknown;
}

export function DetailedComponentCardNode({ data, selected }: NodeProps) {
  const d = data as DetailedComponentCardData;
  const selectNode = useStore((s) => s.selectNode);
  const setComponentInspectorTab = useStore((s) => s.setComponentInspectorTab);
  const setHighlightedEvidenceId = useStore((s) => s.setHighlightedEvidenceId);

  return (
    <div
      style={{
        width: "100%",
        height: "100%",
        background: "#111827",
        border: `2px solid ${selected ? "#ffffff" : d.accentColor}`,
        borderRadius: 16,
        boxShadow: selected
          ? `0 0 26px ${d.accentColor}50`
          : "0 10px 26px rgba(0,0,0,0.35)",
        overflow: "hidden",
      }}
    >
      <EdgeHandles color={d.accentColor} />

      <div
        style={{
          padding: "12px 16px 10px",
          background: `${d.accentColor}18`,
          borderBottom: `1px solid ${d.accentColor}50`,
        }}
      >
        <div style={{ fontSize: 17, fontWeight: 800, color: "#f8fafc", overflowWrap: "anywhere" }}>
          {d.title}
        </div>
        {d.subtitle && (
          <div
            style={{
              fontSize: 11,
              color: `${d.accentColor}dd`,
              marginTop: 3,
              fontFamily: "monospace",
              overflowWrap: "anywhere",
            }}
          >
            {d.subtitle}
          </div>
        )}
      </div>

      <div style={{ padding: "12px 16px 24px" }}>
        {d.metrics && d.metrics.length > 0 && (
          <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginBottom: 12 }}>
            {d.metrics.map((metric) => (
              <span
                key={`${metric.label}-${metric.value}`}
                style={{
                  fontSize: 10,
                  fontWeight: 700,
                  color: "#e5e7eb",
                  border: `1px solid ${d.accentColor}30`,
                  background: `${d.accentColor}12`,
                  borderRadius: 999,
                  padding: "3px 8px",
                }}
              >
                {metric.label} {metric.value}
              </span>
            ))}
          </div>
        )}

        {d.sections.map((section) => (
          <div key={section.id} style={{ marginBottom: 10 }}>
            <div
              style={{
                fontSize: 10,
                fontWeight: 700,
                color: "#94a3b8",
                textTransform: "uppercase",
                letterSpacing: 0.6,
                marginBottom: 5,
              }}
            >
              {section.label}
            </div>
            {section.lines.slice(0, MAX_VISIBLE_LINES).map((line) => (
              <LineRow
                key={line.id}
                accentColor={d.accentColor}
                line={line}
                onClick={(evidenceId) => {
                  selectNode(d.cardId);
                  setComponentInspectorTab("evidence");
                  setHighlightedEvidenceId(evidenceId);
                }}
              />
            ))}
            {section.lines.length > MAX_VISIBLE_LINES && (
              <div
                style={{
                  fontSize: 11,
                  color: "#94a3b8",
                  lineHeight: 1.4,
                  fontFamily: "monospace",
                }}
              >
                +{section.lines.length - MAX_VISIBLE_LINES} more
              </div>
            )}
          </div>
        ))}

        {d.badges && d.badges.length > 0 && (
          <div style={{ marginBottom: 12 }}>
            <div
              style={{
                fontSize: 10,
                fontWeight: 700,
                color: "#94a3b8",
                textTransform: "uppercase",
                letterSpacing: 0.6,
                marginBottom: 6,
              }}
            >
              uses
            </div>
            <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
              {d.badges.map((badge) => (
                <span
                  key={badge}
                  style={{
                    fontSize: 10,
                    color: d.accentColor,
                    border: `1px solid ${d.accentColor}40`,
                    background: `${d.accentColor}12`,
                    borderRadius: 999,
                    padding: "3px 8px",
                    overflowWrap: "anywhere",
                  }}
                >
                  {badge}
                </span>
              ))}
            </div>
          </div>
        )}

        {d.childCards && d.childCards.length > 0 && (
          <div>
            <div
              style={{
                fontSize: 10,
                fontWeight: 700,
                color: "#94a3b8",
                textTransform: "uppercase",
                letterSpacing: 0.6,
                marginBottom: 8,
              }}
            >
              internals
            </div>
            <div
              style={{
                display: "grid",
                gridTemplateColumns: `repeat(${Math.max(d.childColumns ?? Math.min(d.childCards.length, 2), 1)}, minmax(0, 1fr))`,
                gap: 10,
              }}
            >
              {d.childCards.map((child) => (
                <div
                  key={`${child.title}-${child.subtitle ?? ""}`}
                  style={{
                    border: `1px solid ${d.accentColor}35`,
                    background: `${d.accentColor}10`,
                    borderRadius: 10,
                    padding: "10px 10px 14px",
                    minHeight: 90,
                  }}
                >
                  <div style={{ fontSize: 12, fontWeight: 700, color: "#f3f4f6", overflowWrap: "anywhere" }}>
                    {child.title}
                  </div>
                  {child.subtitle && (
                    <div
                      style={{
                        fontSize: 10,
                        color: `${d.accentColor}cc`,
                        marginTop: 2,
                        fontFamily: "monospace",
                        overflowWrap: "anywhere",
                      }}
                    >
                      {child.subtitle}
                    </div>
                  )}
                  <div style={{ marginTop: 6 }}>
                    {child.lines.map((line) => (
                      <div
                        key={line}
                        style={{
                          fontSize: 11,
                          color: "#d1d5db",
                          lineHeight: 1.4,
                          fontFamily: "monospace",
                          overflowWrap: "anywhere",
                        }}
                      >
                        {line}
                      </div>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

function LineRow(
  {
    line,
    accentColor,
    onClick,
  }: {
    line: ComponentDiagramLine;
    accentColor: string;
    onClick: (evidenceId: string | null) => void;
  },
) {
  const firstEvidenceId = line.evidenceIds[0] ?? null;
  const clickable = firstEvidenceId !== null;

  return (
    <button
      type="button"
      onClick={(event) => {
        event.stopPropagation();
        onClick(firstEvidenceId);
      }}
      style={{
        display: "flex",
        alignItems: "flex-start",
        justifyContent: "space-between",
        gap: 8,
        width: "100%",
        padding: 0,
        marginBottom: 2,
        border: "none",
        background: "transparent",
        cursor: clickable ? "pointer" : "default",
        textAlign: "left",
      }}
    >
      <span
        style={{
          fontSize: 12,
          color: "#d1d5db",
          lineHeight: 1.45,
          fontFamily: "monospace",
          overflowWrap: "anywhere",
          flex: 1,
        }}
      >
        {line.text}
      </span>
      <span
        style={{
          fontSize: 8,
          fontWeight: 800,
          letterSpacing: 0.5,
          color: confidenceColor(line.confidence, accentColor),
          border: `1px solid ${confidenceColor(line.confidence, accentColor)}40`,
          background: `${confidenceColor(line.confidence, accentColor)}12`,
          borderRadius: 4,
          padding: "1px 4px",
          marginTop: 1,
          flexShrink: 0,
        }}
        title={confidenceExplanation(line.confidence)}
      >
        {confidenceBadgeLabel(line.confidence)}
      </span>
    </button>
  );
}

function EdgeHandles({ color }: { color: string }) {
  return (
    <>
      <Handle id="top" type="target" position={Position.Top} style={handleStyle(color)} />
      <Handle id="left" type="target" position={Position.Left} style={handleStyle(color)} />
      <Handle id="right" type="source" position={Position.Right} style={handleStyle(color)} />
      <Handle id="bottom" type="source" position={Position.Bottom} style={handleStyle(color)} />
      <Handle id="top-source" type="source" position={Position.Top} style={{ ...handleStyle(color), opacity: 0 }} />
      <Handle id="left-source" type="source" position={Position.Left} style={{ ...handleStyle(color), opacity: 0 }} />
      <Handle id="right-target" type="target" position={Position.Right} style={{ ...handleStyle(color), opacity: 0 }} />
      <Handle id="bottom-target" type="target" position={Position.Bottom} style={{ ...handleStyle(color), opacity: 0 }} />
    </>
  );
}

function handleStyle(color: string): CSSProperties {
  return {
    background: color,
    width: 10,
    height: 10,
    border: "1px solid rgba(255,255,255,0.7)",
    opacity: 0,
  };
}

function confidenceColor(
  confidence: ComponentDiagramLine["confidence"],
  accentColor: string,
): string {
  if (confidence === "exact") return accentColor;
  if (confidence === "derived") return "#cbd5e1";
  return "#f59e0b";
}

function confidenceBadgeLabel(confidence: ComponentDiagramLine["confidence"]): string {
  if (confidence === "exact") return "CODE";
  if (confidence === "derived") return "SUMMARY";
  return "GUESS";
}

function confidenceExplanation(confidence: ComponentDiagramLine["confidence"]): string {
  if (confidence === "exact") return "Read straight from code.";
  if (confidence === "derived") return "Short summary built from several code facts.";
  return "Best-effort guess based on nearby code patterns.";
}
