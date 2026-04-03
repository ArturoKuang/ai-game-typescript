import {
  BaseEdge,
  EdgeLabelRenderer,
  getSmoothStepPath,
  type EdgeProps,
} from "@xyflow/react";
import { useStore } from "../store";

interface ContainerRelationshipEdgeData {
  description?: string;
  technology?: string;
  optional?: boolean;
  synchronous?: boolean;
}

export function ContainerRelationshipEdge({
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
  const selectEdge = useStore((s) => s.selectEdge);
  const setContainerInspectorTab = useStore((s) => s.setContainerInspectorTab);
  const relationship = (data ?? {}) as ContainerRelationshipEdgeData;
  const [edgePath, labelX, labelY] = getSmoothStepPath({
    sourceX,
    sourceY,
    targetX,
    targetY,
    sourcePosition,
    targetPosition,
    borderRadius: 22,
    offset: 28,
  });

  const deltaX = targetX - sourceX;
  const deltaY = targetY - sourceY;
  const sameRow = Math.abs(deltaY) < 80;
  const labelOffsetY = sameRow ? -180 : deltaY > 0 ? 38 : -38;
  const labelOffsetX = sameRow ? 0 : deltaX > 0 ? -78 : 78;
  const stroke = style?.stroke?.toString() ?? "#cbd5e1";

  return (
    <>
      <BaseEdge id={id} path={edgePath} markerEnd={markerEnd} style={style} interactionWidth={30} />
      <EdgeLabelRenderer>
        <button
          type="button"
          data-testid={`container-edge-label-${id}`}
          aria-label={relationship.description ?? "Container relationship"}
          onClick={(event) => {
            event.stopPropagation();
            selectEdge(id);
            setContainerInspectorTab("relationships");
          }}
          onKeyDown={(event) => {
            if (event.key !== "Enter" && event.key !== " ") return;
            event.preventDefault();
            event.stopPropagation();
            selectEdge(id);
            setContainerInspectorTab("relationships");
          }}
          style={{
            position: "absolute",
            transform: `translate(-50%, -50%) translate(${labelX + labelOffsetX}px, ${labelY + labelOffsetY}px)`,
            pointerEvents: "all",
            maxWidth: 224,
            padding: "9px 11px",
            borderRadius: 14,
            border: `1px solid ${selected ? "#ffffff" : `${stroke}55`}`,
            background: "rgba(11, 16, 32, 0.96)",
            boxShadow: selected
              ? `0 0 0 1px ${stroke}55, 0 16px 30px rgba(2, 6, 23, 0.45)`
              : "0 12px 24px rgba(2, 6, 23, 0.32)",
            color: "#e5e7eb",
            cursor: "pointer",
            textAlign: "left",
            appearance: "none",
          }}
        >
          <div style={{ fontSize: 10.5, fontWeight: 800, lineHeight: 1.4 }}>
            {relationship.description ?? ""}
          </div>
          <div
            style={{
              marginTop: 5,
              fontSize: 9,
              fontWeight: 700,
              color: "#94a3b8",
              lineHeight: 1.35,
            }}
          >
            {relationship.technology ?? ""}
          </div>
          {relationship.optional && (
            <div style={{ marginTop: 6 }}>
              <span
                style={{
                  fontSize: 8,
                  fontWeight: 800,
                  color: "#f8fafc",
                  background: `${stroke}22`,
                  border: `1px solid ${stroke}44`,
                  borderRadius: 999,
                  padding: "2px 6px",
                  letterSpacing: 0.4,
                }}
              >
                OPTIONAL
              </span>
            </div>
          )}
        </button>
      </EdgeLabelRenderer>
    </>
  );
}
