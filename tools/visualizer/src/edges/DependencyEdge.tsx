import {
  BaseEdge,
  EdgeLabelRenderer,
  getBezierPath,
  type EdgeProps,
} from "@xyflow/react";
import { useStore } from "../store";

interface DependencyEdgeData {
  strength?: "weak" | "moderate" | "strong";
  fileEdgeCount?: number;
  isCircular?: boolean;
  isBundled?: boolean;
  stroke?: string;
}

const STRENGTH_WIDTH = {
  weak: 1.5,
  moderate: 2.2,
  strong: 3,
} as const;

export function DependencyEdge({
  id,
  sourceX,
  sourceY,
  targetX,
  targetY,
  sourcePosition,
  targetPosition,
  style,
  markerEnd,
  selected,
  data,
}: EdgeProps) {
  const selectEdge = useStore((state) => state.selectEdge);
  const setDependencyInspectorTab = useStore((state) => state.setDependencyInspectorTab);
  const d = (data ?? {}) as DependencyEdgeData;
  const dx = targetX - sourceX;
  const dy = targetY - sourceY;
  const distance = Math.sqrt(dx * dx + dy * dy);
  const curvature = Math.min(0.5, 0.15 + distance / 2000);
  const [edgePath, labelX, labelY] = getBezierPath({
    sourceX,
    sourceY,
    targetX,
    targetY,
    sourcePosition,
    targetPosition,
    curvature,
  });

  const isCircular = d.isCircular ?? false;
  const strength = d.strength ?? "weak";
  const strokeWidth = STRENGTH_WIDTH[strength];
  const stroke = isCircular ? "#ef4444" : (style?.stroke?.toString() ?? d.stroke ?? "#94a3b8");
  const dashArray = isCircular ? "6 3" : undefined;

  const handleClick = (event: React.MouseEvent | React.KeyboardEvent) => {
    event.stopPropagation();
    selectEdge(id);
    setDependencyInspectorTab("dependencies");
  };

  return (
    <>
      <BaseEdge
        id={id}
        path={edgePath}
        markerEnd={markerEnd}
        style={{
          ...style,
          stroke,
          strokeWidth,
          strokeDasharray: dashArray,
        }}
        interactionWidth={14}
      />
      {(selected || isCircular || d.isBundled) && (
        <EdgeLabelRenderer>
          <div
            role="button"
            tabIndex={0}
            aria-label={`${d.fileEdgeCount ?? 0} file imports${isCircular ? " (circular)" : ""}`}
            onClick={handleClick}
            onKeyDown={(event) => {
              if (event.key !== "Enter" && event.key !== " ") return;
              event.preventDefault();
              handleClick(event);
            }}
            style={{
              position: "absolute",
              transform: `translate(-50%, -50%) translate(${labelX}px, ${labelY - 16}px)`,
              pointerEvents: "all",
              zIndex: 40,
              padding: selected ? "5px 9px" : "3px 7px",
              borderRadius: 999,
              border: `1px solid ${selected ? "#ffffff" : `${stroke}55`}`,
              background: "rgba(11, 16, 32, 0.96)",
              boxShadow: selected
                ? `0 0 0 1px ${stroke}55, 0 14px 24px rgba(2, 6, 23, 0.35)`
                : "0 10px 20px rgba(2, 6, 23, 0.24)",
              color: isCircular ? "#fbbf24" : "#e5e7eb",
              cursor: "pointer",
            }}
          >
            <div style={{ fontSize: 9.5, fontWeight: 800, lineHeight: 1.3, whiteSpace: "nowrap" }}>
              {d.fileEdgeCount ?? 0} imports
              {isCircular && " (circular)"}
            </div>
          </div>
        </EdgeLabelRenderer>
      )}
    </>
  );
}
