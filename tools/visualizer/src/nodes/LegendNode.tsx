import type { NodeProps } from "@xyflow/react";
import { useStore } from "../store";

interface LegendEntry {
  color: string;
  label: string;
  legendKey: string;
  dash?: string;
}

interface LegendData {
  title: string;
  sections: { title: string; entries: LegendEntry[] }[];
  [key: string]: unknown;
}

/**
 * An inline legend node rendered on the canvas.
 * Click entries to toggle them — multiple can be active at once.
 * Matching diagram nodes stay bright; everything else dims.
 */
export function LegendNode({ data }: NodeProps) {
  const d = data as LegendData;
  const activeLegendKeys = useStore((s) => s.activeLegendKeys);
  const toggleLegendKey = useStore((s) => s.toggleLegendKey);
  const clearLegendKeys = useStore((s) => s.clearLegendKeys);

  const hasActive = activeLegendKeys.size > 0;

  return (
    <div
      style={{
        background: "#0d0d1aee",
        border: "1px solid #333",
        borderRadius: 10,
        padding: "12px 16px",
        minWidth: 180,
      }}
    >
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          marginBottom: 10,
        }}
      >
        <div style={{ fontSize: 12, fontWeight: 800, color: "#ccc" }}>
          {d.title}
        </div>
        {hasActive && (
          <button
            onClick={(e) => {
              e.stopPropagation();
              clearLegendKeys();
            }}
            style={{
              fontSize: 9,
              color: "#888",
              background: "#252545",
              border: "1px solid #444",
              borderRadius: 4,
              padding: "2px 6px",
              cursor: "pointer",
            }}
          >
            Clear
          </button>
        )}
      </div>

      {d.sections.map((section) => (
        <div key={section.title} style={{ marginBottom: 10 }}>
          <div
            style={{
              fontSize: 9,
              fontWeight: 700,
              color: "#777",
              textTransform: "uppercase",
              letterSpacing: 0.6,
              marginBottom: 5,
            }}
          >
            {section.title}
          </div>
          {section.entries.map((entry) => {
            const isActive = activeLegendKeys.has(entry.legendKey);
            return (
              <div
                key={entry.legendKey}
                onClick={(e) => {
                  e.stopPropagation();
                  toggleLegendKey(entry.legendKey);
                }}
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 8,
                  marginBottom: 3,
                  padding: "3px 6px",
                  borderRadius: 5,
                  cursor: "pointer",
                  background: isActive ? `${entry.color}18` : "transparent",
                  border: isActive ? `1px solid ${entry.color}40` : "1px solid transparent",
                  transition: "all 0.15s ease",
                }}
              >
                {entry.dash ? (
                  <svg width="24" height="10" style={{ flexShrink: 0 }}>
                    <line
                      x1="0"
                      y1="5"
                      x2="24"
                      y2="5"
                      stroke={entry.color}
                      strokeWidth={2}
                      strokeDasharray={entry.dash}
                    />
                  </svg>
                ) : (
                  <div
                    style={{
                      width: 14,
                      height: 14,
                      borderRadius: 4,
                      background: isActive ? `${entry.color}50` : `${entry.color}30`,
                      border: `2px solid ${entry.color}`,
                      flexShrink: 0,
                      transition: "background 0.15s ease",
                    }}
                  />
                )}
                <span
                  style={{
                    fontSize: 11,
                    color: isActive ? "#fff" : "#ccc",
                    fontWeight: isActive ? 600 : 400,
                    transition: "all 0.15s ease",
                  }}
                >
                  {entry.label}
                </span>
              </div>
            );
          })}
        </div>
      ))}
    </div>
  );
}
