import { Handle, Position, type NodeProps } from "@xyflow/react";

interface BoundaryData {
  label: string;
  technology: string;
  description: string;
  borderColor: string;
  componentCount: number;
  [key: string]: unknown;
}

/**
 * C4-style system boundary container.
 * Renders as a large dashed-border rectangle with a label in the top-left corner.
 * Child component nodes are positioned inside via React Flow's parentId mechanism.
 */
export function BoundaryNode({ data }: NodeProps) {
  const d = data as BoundaryData;
  const hiddenHandle = {
    background: d.borderColor,
    width: 10,
    height: 10,
    opacity: 0,
  };

  return (
    <div
      style={{
        width: "100%",
        height: "100%",
        border: `2px dashed ${d.borderColor}40`,
        borderRadius: 16,
        background: `${d.borderColor}06`,
        position: "relative",
      }}
    >
      <Handle id="top" type="target" position={Position.Top} style={hiddenHandle} />
      <Handle id="left" type="target" position={Position.Left} style={hiddenHandle} />
      <Handle id="right-target" type="target" position={Position.Right} style={hiddenHandle} />
      <Handle id="bottom-target" type="target" position={Position.Bottom} style={hiddenHandle} />

      {/* C4-style boundary label: top-left corner */}
      <div
        style={{
          position: "absolute",
          top: 14,
          left: 20,
          display: "flex",
          flexDirection: "column",
          gap: 2,
        }}
      >
        <div style={{ fontSize: 18, fontWeight: 800, color: d.borderColor, letterSpacing: 0.5 }}>
          {d.label}
        </div>
        <div style={{ fontSize: 11, color: `${d.borderColor}aa`, fontWeight: 500 }}>
          [{d.technology}]
        </div>
        <div style={{ fontSize: 11, color: "#777", marginTop: 2, maxWidth: 400 }}>
          {d.description}
        </div>
      </div>

      <Handle id="right" type="source" position={Position.Right} style={hiddenHandle} />
      <Handle id="bottom" type="source" position={Position.Bottom} style={hiddenHandle} />
      <Handle id="left-source" type="source" position={Position.Left} style={hiddenHandle} />
      <Handle id="top-source" type="source" position={Position.Top} style={hiddenHandle} />
    </div>
  );
}
