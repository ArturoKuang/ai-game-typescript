import { Handle, Position, type NodeProps } from "@xyflow/react";

interface DataStructureNodeData {
  label: string;
  categoryLabel: string;
  kindLabel: string;
  accentColor: string;
  summary?: string;
  previewLines: string[];
  statItems?: string[];
  badges?: string[];
  sourceFile?: string;
  [key: string]: unknown;
}

export function DataStructureNode({ data, selected }: NodeProps) {
  const d = data as DataStructureNodeData;
  const sourceLabel = shortenSourcePath(d.sourceFile);
  const kindLower = d.kindLabel.toLowerCase();
  const dedupedBadges = d.badges?.filter((b) => b.toLowerCase() !== kindLower).slice(0, 1) ?? [];

  return (
    <div
      style={{
        background: "linear-gradient(180deg, #0f172a 0%, #0b1220 100%)",
        border: `1.5px solid ${selected ? "#f8fafc" : `${d.accentColor}78`}`,
        boxShadow: selected
          ? `0 0 0 1px ${d.accentColor}, 0 18px 36px rgba(2, 6, 23, 0.3)`
          : "0 12px 28px rgba(2, 6, 23, 0.24)",
        borderRadius: 14,
        padding: "10px 12px 11px",
        minWidth: 236,
        maxWidth: 236,
      }}
    >
      <Handle type="target" position={Position.Left} style={{ background: d.accentColor }} />

      <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginBottom: 7 }}>
        <span
          style={{
            fontSize: 9,
            fontWeight: 800,
            color: d.accentColor,
            background: `${d.accentColor}18`,
            border: `1px solid ${d.accentColor}33`,
            borderRadius: 999,
            padding: "2px 7px",
          }}
        >
          {d.categoryLabel}
        </span>
        <span
          style={{
            fontSize: 9,
            fontWeight: 700,
            color: "#cbd5e1",
            background: "#111827",
            border: "1px solid #334155",
            borderRadius: 999,
            padding: "2px 7px",
          }}
        >
          {d.kindLabel}
        </span>
        {dedupedBadges.map((badge) => (
          <span
            key={badge}
            style={{
              fontSize: 8,
              fontWeight: 800,
              color: "#e2e8f0",
              background: "#172033",
              border: "1px solid #334155",
              borderRadius: 999,
              padding: "2px 6px",
            }}
          >
            {badge}
          </span>
        ))}
      </div>

      <div style={{ fontSize: 13, fontWeight: 800, color: "#f8fafc", lineHeight: 1.25 }}>{d.label}</div>

      {d.summary && (
        <div
          style={{
            fontSize: 10,
            color: "#cbd5e1",
            lineHeight: 1.45,
            marginTop: 6,
            overflow: "hidden",
            display: "-webkit-box",
            WebkitLineClamp: 2,
            WebkitBoxOrient: "vertical",
          }}
        >
          {d.summary}
        </div>
      )}

      {d.statItems && d.statItems.length > 0 && (
        <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginTop: 7 }}>
          {d.statItems.map((item) => (
            <span
              key={item}
              style={{
                fontSize: 8,
                fontWeight: 700,
                letterSpacing: 0.2,
                color: "#cbd5e1",
                background: "#0f172a",
                border: "1px solid #243041",
                borderRadius: 999,
                padding: "2px 6px",
              }}
            >
              {item}
            </span>
          ))}
        </div>
      )}

      <div
        style={{
          marginTop: 8,
          paddingTop: 8,
          borderTop: "1px solid #1e293b",
        }}
      >
        {d.previewLines.slice(0, 3).map((line) => (
          <div key={line} style={{ fontSize: 10, color: "#e2e8f0", lineHeight: 1.45, fontFamily: "monospace" }}>
            {line}
          </div>
        ))}
      </div>

      {sourceLabel && (
        <div
          style={{
            fontSize: 9,
            color: "#64748b",
            marginTop: 8,
            fontFamily: "monospace",
            borderTop: "1px solid #111827",
            paddingTop: 6,
          }}
        >
          {sourceLabel}
        </div>
      )}

      <Handle type="source" position={Position.Right} style={{ background: d.accentColor }} />
    </div>
  );
}

function shortenSourcePath(path?: string): string | undefined {
  if (!path) return undefined;
  const parts = path.split("/");
  return parts.length <= 2 ? path : parts.slice(-2).join("/");
}
