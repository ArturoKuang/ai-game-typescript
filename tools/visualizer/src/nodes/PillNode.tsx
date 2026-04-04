import { Handle, Position, type NodeProps } from "@xyflow/react";

interface PillNodeData {
  label: string;
  componentColor: string;
  kind: "class" | "interface" | "function";
  hasCycles?: boolean;
  [key: string]: unknown;
}

const KIND_STYLE = {
  class:     { bg: "#648FFF33", color: "#648FFF", badge: "C" },
  interface: { bg: "#DC267F33", color: "#DC267F", badge: "I" },
  function:  { bg: "#22c55e33", color: "#22c55e", badge: "fn" },
} as const;

export function PillNode({ data, selected }: NodeProps) {
  const d = data as PillNodeData;
  const ks = KIND_STYLE[d.kind] ?? KIND_STYLE.function;

  return (
    <div
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 6,
        background: "#0f172a",
        border: `1.5px solid ${selected ? "#f8fafc" : `${d.componentColor}66`}`,
        borderRadius: 999,
        padding: "5px 12px 5px 8px",
        whiteSpace: "nowrap",
      }}
    >
      <Handle id="left" type="target" position={Position.Left} style={{ background: d.componentColor, width: 6, height: 6 }} />
      <Handle id="top" type="target" position={Position.Top} style={{ background: d.componentColor, width: 6, height: 6 }} />

      <span
        style={{
          fontSize: 9,
          fontWeight: 800,
          padding: "1px 5px",
          borderRadius: 4,
          background: ks.bg,
          color: ks.color,
          lineHeight: 1.3,
        }}
      >
        {ks.badge}
      </span>
      <span style={{ fontSize: 11, fontWeight: 700, color: "#e2e8f0" }}>
        {d.label}
      </span>
      {d.hasCycles && (
        <span style={{ width: 6, height: 6, borderRadius: 999, background: "#fbbf24", flexShrink: 0 }} />
      )}

      <Handle id="right" type="source" position={Position.Right} style={{ background: d.componentColor, width: 6, height: 6 }} />
      <Handle id="bottom" type="source" position={Position.Bottom} style={{ background: d.componentColor, width: 6, height: 6 }} />
    </div>
  );
}
