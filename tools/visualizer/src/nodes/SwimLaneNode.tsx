import type { NodeProps } from "@xyflow/react";

interface SwimLaneData {
  label: string;
  color: string;
  description: string;
  laneWidth: number;
  laneHeight: number;
  [key: string]: unknown;
}

/**
 * Full-width horizontal band representing a swim lane (Client, Network, Engine, etc).
 * The label sits on the left with a colored vertical stripe.
 */
export function SwimLaneNode({ data }: NodeProps) {
  const d = data as SwimLaneData;
  return (
    <div
      style={{
        width: d.laneWidth,
        height: d.laneHeight,
        background: `${d.color}06`,
        borderTop: `1px solid ${d.color}20`,
        borderBottom: `1px solid ${d.color}20`,
        position: "relative",
        borderRadius: 6,
      }}
    >
      {/* Lane label on the left */}
      {d.label && (
        <div
          style={{
            position: "absolute",
            left: 0,
            top: 0,
            bottom: 0,
            width: 130,
            display: "flex",
            flexDirection: "column",
            justifyContent: "center",
            paddingLeft: 16,
            borderRight: `3px solid ${d.color}50`,
            background: `${d.color}0c`,
            borderRadius: "6px 0 0 6px",
          }}
        >
          <div
            style={{
              fontSize: 16,
              fontWeight: 800,
              color: d.color,
              letterSpacing: 0.4,
            }}
          >
            {d.label}
          </div>
          {d.description && (
            <div
              style={{
                fontSize: 10,
                color: `${d.color}aa`,
                marginTop: 4,
                lineHeight: 1.3,
              }}
            >
              {d.description}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
