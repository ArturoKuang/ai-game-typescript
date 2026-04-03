import { Handle, Position, type NodeProps } from "@xyflow/react";

interface FileData {
  label: string;
  loc: number;
  classes: string[];
  componentColor: string;
  componentLabel?: string;
  [key: string]: unknown;
}

export function FileNode({ data, selected }: NodeProps) {
  const d = data as FileData;
  return (
    <div
      style={{
        background: "#1e1e2e",
        border: `1.5px solid ${selected ? "#fff" : d.componentColor}`,
        borderRadius: 8,
        padding: "8px 12px",
        minWidth: 150,
      }}
    >
      <Handle type="target" position={Position.Left} style={{ background: d.componentColor }} />
      <div style={{ fontSize: 12, fontWeight: 600, color: "#e0e0e0" }}>{d.label}</div>
      <div style={{ fontSize: 10, color: "#888", marginTop: 2 }}>
        {d.loc} lines
        {d.classes.length > 0 && ` \u00b7 ${d.classes.join(", ")}`}
      </div>
      {d.componentLabel && (
        <div
          style={{
            fontSize: 9,
            color: d.componentColor,
            marginTop: 3,
            opacity: 0.8,
          }}
        >
          {d.componentLabel}
        </div>
      )}
      <Handle type="source" position={Position.Right} style={{ background: d.componentColor }} />
    </div>
  );
}
