import { useState, useCallback } from "react";
import { Handle, Position, type NodeProps } from "@xyflow/react";
import { useStore } from "../store";

interface FlowStepData {
  action: string;
  method: string;
  produces?: string;
  producesKind?: "command" | "event" | "serverMessage" | "directCall";
  laneColor: string;
  isFirst?: boolean;
  isLast?: boolean;
  flowLabel?: string;
  dimmed?: boolean;
  // Improvement 1: source file link
  fileId?: string;
  line?: number;
  // Improvement 2: step index for click selection
  stepIndex?: number;
  flowType?: string;
  // Improvement 3: error paths
  errorPaths?: { condition: string; produces: string }[];
  // Improvement 4: state transition
  stateTransition?: { machineId: string; from: string; to: string };
  // Improvement 5: data shape
  dataShape?: string;
  [key: string]: unknown;
}

const PRODUCES_COLORS: Record<string, string> = {
  command: "#DC267F",
  event: "#648FFF",
  serverMessage: "#22D3EE",
  directCall: "#94a3b8",
};

const PRODUCES_LABELS: Record<string, string> = {
  command: "CMD",
  event: "EVT",
  serverMessage: "MSG",
  directCall: "CALL",
};

export function FlowStepNode({ data, selected }: NodeProps) {
  const d = data as FlowStepData;
  const producesColor = d.producesKind ? PRODUCES_COLORS[d.producesKind] : undefined;
  const setSelectedFlowStep = useStore((s) => s.setSelectedFlowStep);
  const [copiedTooltip, setCopiedTooltip] = useState(false);
  const [shapeExpanded, setShapeExpanded] = useState(false);

  const handleNodeClick = useCallback(() => {
    if (d.stepIndex != null) {
      setSelectedFlowStep(d.stepIndex);
    }
  }, [d.stepIndex, setSelectedFlowStep]);

  const handleCopyPath = useCallback(
    (e: React.MouseEvent) => {
      e.stopPropagation();
      if (d.fileId) {
        const text = d.line ? `${d.fileId}:${d.line}` : d.fileId;
        navigator.clipboard.writeText(text).then(() => {
          setCopiedTooltip(true);
          setTimeout(() => setCopiedTooltip(false), 1200);
        });
      }
    },
    [d.fileId, d.line],
  );

  const handleToggleShape = useCallback((e: React.MouseEvent) => {
    e.stopPropagation();
    setShapeExpanded((prev) => !prev);
  }, []);

  // Extract filename from fileId
  const fileName = d.fileId ? d.fileId.split("/").pop() : undefined;

  return (
    <div
      onClick={handleNodeClick}
      style={{
        background: "#13132a",
        border: `2px solid ${selected ? "#fff" : d.laneColor}70`,
        borderRadius: 10,
        padding: "8px 12px",
        width: "100%",
        minHeight: 50,
        opacity: d.dimmed ? 0.15 : 1,
        transition: "opacity 0.2s ease, box-shadow 0.2s ease",
        boxShadow: selected ? `0 0 16px ${d.laneColor}50` : "0 2px 10px rgba(0,0,0,0.5)",
        cursor: d.stepIndex != null ? "pointer" : "default",
      }}
    >
      <Handle type="target" position={Position.Left} style={{ background: d.laneColor, width: 8, height: 8 }} />

      {/* Flow label — only on the first step */}
      {d.isFirst && d.flowLabel && (
        <div
          style={{
            fontSize: 11,
            fontWeight: 800,
            color: d.laneColor,
            textTransform: "uppercase",
            letterSpacing: 0.8,
            marginBottom: 4,
            whiteSpace: "nowrap",
            overflow: "hidden",
            textOverflow: "ellipsis",
          }}
        >
          {d.flowLabel}
        </div>
      )}

      {/* Action description */}
      <div
        style={{
          fontSize: 12,
          color: "#ddd",
          lineHeight: 1.4,
          marginBottom: 4,
        }}
      >
        {d.action}
      </div>

      {/* Method name */}
      {d.method && (
        <div
          style={{
            fontSize: 11,
            color: "#999",
            fontFamily: "monospace",
            marginBottom: d.produces ? 4 : 0,
          }}
        >
          {d.method}
        </div>
      )}

      {/* Produces badge */}
      {d.produces && producesColor && (
        <div style={{ display: "flex", alignItems: "center", gap: 5, marginTop: 2 }}>
          <span
            style={{
              fontSize: 9,
              fontWeight: 700,
              color: producesColor,
              background: `${producesColor}20`,
              border: `1px solid ${producesColor}40`,
              borderRadius: 4,
              padding: "1px 5px",
            }}
          >
            {PRODUCES_LABELS[d.producesKind!]}
          </span>
          <span style={{ fontSize: 10, color: producesColor, fontFamily: "monospace" }}>
            {d.produces}
          </span>
        </div>
      )}

      {/* Improvement 4: State transition badge */}
      {d.stateTransition && (
        <div
          style={{
            display: "inline-flex",
            alignItems: "center",
            gap: 3,
            marginTop: 4,
            fontSize: 9,
            fontWeight: 600,
            color: "#a78bfa",
            background: "#a78bfa18",
            border: "1px solid #a78bfa35",
            borderRadius: 4,
            padding: "1px 5px",
          }}
        >
          <span style={{ fontSize: 8 }}>FSM</span>
          <span>{d.stateTransition.from} &rarr; {d.stateTransition.to}</span>
        </div>
      )}

      {/* Improvement 3: Error paths badge */}
      {d.errorPaths && d.errorPaths.length > 0 && (
        <div
          style={{
            display: "inline-flex",
            alignItems: "center",
            gap: 3,
            marginTop: 4,
            marginLeft: d.stateTransition ? 4 : 0,
            fontSize: 9,
            fontWeight: 600,
            color: "#f59e0b",
            background: "#f59e0b18",
            border: "1px solid #f59e0b35",
            borderRadius: 4,
            padding: "1px 5px",
          }}
        >
          {d.errorPaths.length} check{d.errorPaths.length > 1 ? "s" : ""}
        </div>
      )}

      {/* Improvement 5: Data shape indicator */}
      {d.dataShape && (
        <div style={{ marginTop: 3 }}>
          <span
            onClick={handleToggleShape}
            style={{
              fontSize: 9,
              color: "#666",
              fontFamily: "monospace",
              cursor: "pointer",
              userSelect: "none",
            }}
          >
            {shapeExpanded ? d.dataShape : "{...}"}
          </span>
        </div>
      )}

      {/* Improvement 1: Source file link */}
      {fileName && (
        <div
          style={{
            position: "relative",
            marginTop: 4,
            borderTop: "1px solid #ffffff08",
            paddingTop: 3,
          }}
        >
          <span
            onClick={handleCopyPath}
            style={{
              fontSize: 9,
              color: "#555",
              fontFamily: "monospace",
              cursor: "pointer",
              textDecoration: "none",
            }}
            onMouseEnter={(e) => {
              (e.target as HTMLElement).style.color = "#888";
            }}
            onMouseLeave={(e) => {
              (e.target as HTMLElement).style.color = "#555";
            }}
          >
            {fileName}
            {d.line != null ? `:${d.line}` : ""}
          </span>
          {copiedTooltip && (
            <span
              style={{
                position: "absolute",
                top: -14,
                left: 0,
                fontSize: 8,
                color: "#22D3EE",
                fontWeight: 600,
              }}
            >
              Copied!
            </span>
          )}
        </div>
      )}

      <Handle type="source" position={Position.Right} style={{ background: d.laneColor, width: 8, height: 8 }} />
    </div>
  );
}
