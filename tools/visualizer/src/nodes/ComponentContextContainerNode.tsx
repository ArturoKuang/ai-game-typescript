import { Handle, Position, type NodeProps } from "@xyflow/react";

interface ComponentContextContainerData {
  containerId: string;
  name: string;
  technology: string;
  description: string;
  color: string;
  kind: "application" | "datastore";
  [key: string]: unknown;
}

export function ComponentContextContainerNode({ data, selected }: NodeProps) {
  const d = data as ComponentContextContainerData;
  const isDatastore = d.kind === "datastore";

  return (
    <div
      data-testid={`component-context-container-${d.containerId}`}
      style={{
        width: "100%",
        height: "100%",
        background: isDatastore
          ? "linear-gradient(180deg, rgba(7, 18, 31, 0.98) 0%, rgba(10, 25, 25, 0.98) 100%)"
          : "linear-gradient(180deg, rgba(11, 18, 32, 0.98) 0%, rgba(17, 24, 39, 0.98) 100%)",
        border: `2px solid ${selected ? "#ffffff" : `${d.color}88`}`,
        borderRadius: isDatastore ? 22 : 16,
        boxShadow: selected
          ? `0 0 0 1px ${d.color}55, 0 16px 34px rgba(0,0,0,0.42)`
          : `0 16px 34px ${d.color}10, 0 10px 24px rgba(0,0,0,0.34)`,
        overflow: "hidden",
        position: "relative",
      }}
    >
      <Handle id="top" type="target" position={Position.Top} style={handleStyle(d.color)} />
      <Handle id="left" type="target" position={Position.Left} style={handleStyle(d.color)} />
      <Handle id="right" type="source" position={Position.Right} style={handleStyle(d.color)} />
      <Handle id="bottom" type="source" position={Position.Bottom} style={handleStyle(d.color)} />
      <Handle id="top-source" type="source" position={Position.Top} style={{ ...handleStyle(d.color), opacity: 0 }} />
      <Handle id="left-source" type="source" position={Position.Left} style={{ ...handleStyle(d.color), opacity: 0 }} />
      <Handle id="right-target" type="target" position={Position.Right} style={{ ...handleStyle(d.color), opacity: 0 }} />
      <Handle id="bottom-target" type="target" position={Position.Bottom} style={{ ...handleStyle(d.color), opacity: 0 }} />

      <div
        style={{
          padding: "12px 14px 10px",
          background: `linear-gradient(180deg, ${d.color}20 0%, ${d.color}10 100%)`,
          borderBottom: `1px solid ${d.color}45`,
        }}
      >
        <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 8 }}>
          <div style={{ minWidth: 0 }}>
            <div style={{ fontSize: 15, fontWeight: 800, color: "#f8fafc", overflowWrap: "anywhere" }}>
              {d.name}
            </div>
            <div
              style={{
                fontSize: 10,
                color: `${d.color}dd`,
                marginTop: 4,
                fontFamily: "monospace",
                overflowWrap: "anywhere",
                lineHeight: 1.4,
              }}
            >
              {d.technology}
            </div>
          </div>
          <span
            style={{
              fontSize: 8,
              fontWeight: 800,
              color: d.color,
              letterSpacing: 0.5,
              border: `1px solid ${d.color}40`,
              background: `${d.color}16`,
              borderRadius: 999,
              padding: "3px 7px",
              flexShrink: 0,
            }}
          >
            {isDatastore ? "DATA STORE" : "CONTAINER"}
          </span>
        </div>
      </div>

      <div style={{ padding: "12px 14px 16px" }}>
        <div
          style={{
            fontSize: 11,
            color: "#dbe4f0",
            lineHeight: 1.5,
            display: "-webkit-box",
            WebkitLineClamp: 5,
            WebkitBoxOrient: "vertical",
            overflow: "hidden",
          }}
        >
          {d.description}
        </div>
      </div>
    </div>
  );
}

function handleStyle(color: string) {
  return {
    background: color,
    width: 10,
    height: 10,
    border: "1px solid rgba(255,255,255,0.7)",
    opacity: 0,
  };
}
