import { Handle, Position, type NodeProps } from "@xyflow/react";

interface StateData {
  label: string;
  color: string;
  isInitial?: boolean;
  isTerminal?: boolean;
  dimmed?: boolean;
  [key: string]: unknown;
}

/**
 * A state in a state machine diagram.
 * Initial states have a double border, terminal states have a bold border.
 */
export function StateMachineStateNode({ data, selected }: NodeProps) {
  const d = data as StateData;

  return (
    <div
      style={{
        background: "#13132a",
        border: d.isInitial
          ? `3px double ${d.color}`
          : d.isTerminal
            ? `2.5px solid ${d.color}80`
            : `2px solid ${d.color}60`,
        borderRadius: d.isTerminal ? 14 : 22,
        padding: "10px 20px",
        minWidth: 100,
        textAlign: "center",
        opacity: d.dimmed ? 0.15 : 1,
        transition: "opacity 0.2s ease",
        boxShadow: selected ? `0 0 20px ${d.color}50` : `0 3px 10px rgba(0,0,0,0.5)`,
      }}
    >
      <Handle type="target" position={Position.Left} style={{ background: d.color, width: 8, height: 8 }} />
      <div style={{ fontSize: 14, fontWeight: 700, color: d.color }}>
        {d.label}
      </div>
      {d.isInitial && (
        <div style={{ fontSize: 9, color: `${d.color}88`, marginTop: 3 }}>initial</div>
      )}
      {d.isTerminal && (
        <div style={{ fontSize: 9, color: `${d.color}88`, marginTop: 3 }}>terminal</div>
      )}
      <Handle type="source" position={Position.Right} style={{ background: d.color, width: 8, height: 8 }} />
    </div>
  );
}
