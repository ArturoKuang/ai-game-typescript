import { Handle, Position, type NodeProps } from "@xyflow/react";

interface ClassData {
  label: string;
  methods: string[];
  fields: string[];
  componentColor: string;
  componentLabel?: string;
  kind: "class" | "interface";
  [key: string]: unknown;
}

export function ClassNode({ data, selected }: NodeProps) {
  const d = data as ClassData;
  return (
    <div
      style={{
        background: "#1a1a2e",
        border: `1.5px solid ${selected ? "#fff" : d.componentColor}`,
        borderRadius: 8,
        padding: "8px 12px",
        minWidth: 200,
        maxWidth: 260,
      }}
    >
      <Handle type="target" position={Position.Left} style={{ background: d.componentColor }} />
      <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 4 }}>
        <span
          style={{
            fontSize: 9,
            fontWeight: 700,
            padding: "1px 5px",
            borderRadius: 3,
            background: d.kind === "class" ? "#648FFF33" : "#DC267F33",
            color: d.kind === "class" ? "#648FFF" : "#DC267F",
          }}
        >
          {d.kind === "class" ? "C" : "I"}
        </span>
        <span style={{ fontSize: 13, fontWeight: 700, color: "#e0e0e0" }}>{d.label}</span>
      </div>

      {d.fields.length > 0 && (
        <div style={{ borderTop: "1px solid #333", paddingTop: 4, marginTop: 2 }}>
          {d.fields.slice(0, 5).map((f) => (
            <div key={f} style={{ fontSize: 10, color: "#888", lineHeight: 1.4 }}>
              {f}
            </div>
          ))}
          {d.fields.length > 5 && (
            <div style={{ fontSize: 9, color: "#666" }}>+{d.fields.length - 5} more</div>
          )}
        </div>
      )}

      {d.methods.length > 0 && (
        <div style={{ borderTop: "1px solid #333", paddingTop: 4, marginTop: 4 }}>
          {d.methods.slice(0, 8).map((m) => (
            <div key={m} style={{ fontSize: 10, color: "#aaa", lineHeight: 1.4 }}>
              {m}()
            </div>
          ))}
          {d.methods.length > 8 && (
            <div style={{ fontSize: 9, color: "#666" }}>+{d.methods.length - 8} more</div>
          )}
        </div>
      )}

      {d.componentLabel && (
        <div style={{ fontSize: 9, color: d.componentColor, marginTop: 4, opacity: 0.7 }}>
          {d.componentLabel}
        </div>
      )}
      <Handle type="source" position={Position.Right} style={{ background: d.componentColor }} />
    </div>
  );
}
