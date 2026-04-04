import { Handle, Position, type NodeProps } from "@xyflow/react";

interface DependencyModuleNodeData {
  label: string;
  componentLabel?: string;
  color: string;
  totalLoc: number;
  fanIn: number;
  fanOut: number;
  instability: number;
  hasCycles: boolean;
  /** Module-only: number of files in the module */
  fileCount?: number;
  /** Module-only: internal import count */
  internalEdgeCount?: number;
  /** Module-only: files with no imports */
  orphanCount?: number;
  [key: string]: unknown;
}

function instabilityColor(instability: number): string {
  if (instability <= 0.3) return "#22c55e";
  if (instability <= 0.6) return "#f59e0b";
  return "#ef4444";
}

export function DependencyModuleNode({ data, selected }: NodeProps) {
  const d = data as DependencyModuleNodeData;
  const instColor = instabilityColor(d.instability);
  const isModule = (d.fileCount ?? 0) > 0 && (d.internalEdgeCount ?? -1) >= 0;

  return (
    <div
      style={{
        background: "linear-gradient(180deg, #0f172a 0%, #0b1220 100%)",
        border: `1.5px solid ${selected ? "#f8fafc" : `${d.color}78`}`,
        boxShadow: selected
          ? `0 0 0 1px ${d.color}, 0 18px 36px rgba(2, 6, 23, 0.3)`
          : "0 12px 28px rgba(2, 6, 23, 0.24)",
        borderRadius: 14,
        padding: "12px 14px 13px",
        minWidth: 190,
        maxWidth: 210,
      }}
    >
      <Handle id="left" type="target" position={Position.Left} style={{ background: d.color }} />
      <Handle id="top" type="target" position={Position.Top} style={{ background: d.color }} />

      {/* Header badges */}
      <div style={{ display: "flex", gap: 5, flexWrap: "wrap", marginBottom: 8 }}>
        <span
          style={{
            fontSize: 9,
            fontWeight: 700,
            color: "#cbd5e1",
            background: "#111827",
            border: "1px solid #334155",
            borderRadius: 999,
            padding: "2px 7px",
          }}
        >
          {d.totalLoc} LOC
        </span>
        {isModule && (
          <span
            style={{
              fontSize: 9,
              fontWeight: 800,
              color: d.color,
              background: `${d.color}18`,
              border: `1px solid ${d.color}33`,
              borderRadius: 999,
              padding: "2px 7px",
            }}
          >
            {d.fileCount} files
          </span>
        )}
        {d.hasCycles && (
          <span
            style={{
              fontSize: 8,
              fontWeight: 800,
              color: "#fbbf24",
              background: "#451a0333",
              border: "1px solid #92400e55",
              borderRadius: 999,
              padding: "2px 6px",
            }}
          >
            CIRCULAR
          </span>
        )}
      </div>

      {/* Name */}
      <div style={{ fontSize: 14, fontWeight: 800, color: "#f8fafc", lineHeight: 1.25 }}>
        {d.label}
      </div>
      {d.componentLabel && d.componentLabel !== d.label && (
        <div style={{ fontSize: 9, color: d.color, marginTop: 2, opacity: 0.8 }}>
          {d.componentLabel}
        </div>
      )}

      {/* Metrics */}
      <div style={{ display: "flex", gap: 10, marginTop: 10 }}>
        <div style={{ textAlign: "center", flex: 1 }}>
          <div style={{ fontSize: 16, fontWeight: 800, color: "#22D3EE" }}>{d.fanIn}</div>
          <div style={{ fontSize: 8, color: "#64748b", fontWeight: 600 }}>IN</div>
        </div>
        <div style={{ textAlign: "center", flex: 1 }}>
          <div style={{ fontSize: 16, fontWeight: 800, color: "#f59e0b" }}>{d.fanOut}</div>
          <div style={{ fontSize: 8, color: "#64748b", fontWeight: 600 }}>OUT</div>
        </div>
        <div style={{ textAlign: "center", flex: 1 }}>
          <div style={{ fontSize: 16, fontWeight: 800, color: instColor }}>
            {d.instability.toFixed(2)}
          </div>
          <div style={{ fontSize: 8, color: "#64748b", fontWeight: 600 }}>INSTAB</div>
        </div>
      </div>

      {/* Instability bar */}
      <div style={{ marginTop: 8, height: 4, borderRadius: 2, background: "#1e293b", overflow: "hidden" }}>
        <div
          style={{
            width: `${Math.round(d.instability * 100)}%`,
            height: "100%",
            borderRadius: 2,
            background: instColor,
          }}
        />
      </div>

      {/* Module-only footer */}
      {isModule && d.internalEdgeCount != null && (
        <div style={{ marginTop: 8, fontSize: 9, color: "#64748b", fontFamily: "monospace" }}>
          {d.internalEdgeCount} internal deps
          {(d.orphanCount ?? 0) > 0 && ` · ${d.orphanCount} orphans`}
        </div>
      )}

      <Handle id="right" type="source" position={Position.Right} style={{ background: d.color }} />
      <Handle id="bottom" type="source" position={Position.Bottom} style={{ background: d.color }} />
    </div>
  );
}
