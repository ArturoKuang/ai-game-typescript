import type { KeyboardEvent, MouseEvent } from "react";
import {
  BaseEdge,
  EdgeLabelRenderer,
  getSmoothStepPath,
  type EdgeProps,
} from "@xyflow/react";
import { useStore } from "../store";

interface DataModelRelationEdgeData {
  relationKind?: string;
  relationLabel?: string;
  reason?: string;
  showLabel?: boolean;
  stroke?: string;
}

export function DataModelRelationEdge({
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
  const setDataModelInspectorTab = useStore((state) => state.setDataModelInspectorTab);
  const relation = (data ?? {}) as DataModelRelationEdgeData;
  const [edgePath, labelX, labelY] = getSmoothStepPath({
    sourceX,
    sourceY,
    targetX,
    targetY,
    sourcePosition,
    targetPosition,
    borderRadius: 24,
    offset: 26,
  });

  const deltaX = targetX - sourceX;
  const deltaY = targetY - sourceY;
  const mostlyHorizontal = Math.abs(deltaY) < 70;
  const mostlyVertical = Math.abs(deltaX) < 90;
  const labelOffsetY = mostlyHorizontal ? -58 : deltaY > 0 ? 24 : -24;
  const labelOffsetX = mostlyVertical ? (deltaX >= 0 ? 84 : -84) : deltaX > 0 ? -22 : 22;
  const stroke = style?.stroke?.toString() ?? relation.stroke ?? "#cbd5e1";
  const shouldRenderLabel = selected || relation.showLabel;

  const selectThisEdge = (event: MouseEvent | KeyboardEvent) => {
    event.stopPropagation();
    selectEdge(id);
    setDataModelInspectorTab("access");
  };

  return (
    <>
      <BaseEdge id={id} path={edgePath} markerEnd={markerEnd} style={style} interactionWidth={14} />
      {shouldRenderLabel && (
        <EdgeLabelRenderer>
          <div
            role="button"
            tabIndex={0}
            aria-label={relation.reason ?? relation.relationLabel ?? "Data model relation"}
            onClick={selectThisEdge}
            onKeyDown={(event) => {
              if (event.key !== "Enter" && event.key !== " ") return;
              event.preventDefault();
              selectThisEdge(event);
            }}
            style={{
              position: "absolute",
              transform: `translate(-50%, -50%) translate(${labelX + labelOffsetX}px, ${labelY + labelOffsetY}px)`,
              pointerEvents: "all",
              zIndex: 40,
              maxWidth: selected ? 240 : 132,
              padding: selected ? "7px 9px" : "4px 8px",
              borderRadius: 999,
              border: `1px solid ${selected ? "#ffffff" : `${stroke}55`}`,
              background: "rgba(11, 16, 32, 0.96)",
              boxShadow: selected
                ? `0 0 0 1px ${stroke}55, 0 14px 24px rgba(2, 6, 23, 0.35)`
                : "0 10px 20px rgba(2, 6, 23, 0.24)",
              color: "#e5e7eb",
              cursor: "pointer",
            }}
          >
            <div style={{ fontSize: 9.5, fontWeight: 800, lineHeight: 1.3 }}>
              {relation.relationLabel ?? relation.relationKind ?? "relation"}
            </div>
            {selected && relation.reason && (
              <div style={{ marginTop: 4, fontSize: 9, color: "#94a3b8", lineHeight: 1.35 }}>
                {relation.reason}
              </div>
            )}
          </div>
        </EdgeLabelRenderer>
      )}
    </>
  );
}
