import { Handle, Position, type NodeProps } from "@xyflow/react";

interface ContainerCardData {
  containerId: string;
  name: string;
  technology: string;
  description: string;
  summary?: string;
  responsibilities?: string[];
  kind: "application" | "datastore";
  color: string;
  codePaths: string[];
  badges?: string[];
  [key: string]: unknown;
}

export function ContainerCardNode({ data, selected }: NodeProps) {
  const d = data as ContainerCardData;
  const isDatastore = d.kind === "datastore";
  const visiblePaths = d.codePaths.slice(0, 3);
  const hiddenPathCount = Math.max(0, d.codePaths.length - visiblePaths.length);
  const summary = d.summary ?? d.description;

  return (
    <div
      data-testid={`container-card-${d.containerId}`}
      data-container-kind={d.kind}
      style={{
        width: "100%",
        height: "100%",
        background: isDatastore
          ? "linear-gradient(180deg, rgba(7, 18, 31, 0.98) 0%, rgba(10, 25, 25, 0.98) 100%)"
          : "linear-gradient(180deg, rgba(11, 18, 32, 0.98) 0%, rgba(17, 24, 39, 0.98) 100%)",
        border: `2px solid ${selected ? "#ffffff" : `${d.color}99`}`,
        borderRadius: isDatastore ? 24 : 16,
        boxShadow: selected
          ? `0 0 0 1px ${d.color}66, 0 18px 36px rgba(0,0,0,0.42)`
          : `0 18px 36px ${d.color}12, 0 10px 26px rgba(0,0,0,0.35)`,
        overflow: "hidden",
        position: "relative",
      }}
    >
      <div
        style={{
          position: "absolute",
          inset: 0,
          background: isDatastore
            ? `linear-gradient(180deg, ${d.color}10 0%, transparent 28%, transparent 100%)`
            : `linear-gradient(180deg, ${d.color}10 0%, transparent 22%, transparent 100%)`,
          pointerEvents: "none",
        }}
      />
      <Handle type="target" position={Position.Left} style={handleStyle(d.color)} />
      <Handle type="source" position={Position.Right} style={handleStyle(d.color)} />
      <Handle type="target" position={Position.Top} style={{ ...handleStyle(d.color), opacity: 0 }} />
      <Handle type="source" position={Position.Bottom} style={{ ...handleStyle(d.color), opacity: 0 }} />

      <div
        style={{
          padding: "12px 16px 11px",
          background: `linear-gradient(180deg, ${d.color}22 0%, ${d.color}10 100%)`,
          borderBottom: `1px solid ${d.color}45`,
          position: "relative",
        }}
      >
        <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 10 }}>
          <div style={{ display: "flex", alignItems: "flex-start", gap: 10, minWidth: 0 }}>
            <div
              style={{
                width: 28,
                height: 28,
                borderRadius: isDatastore ? 10 : 8,
                border: `1px solid ${d.color}55`,
                background: `${d.color}18`,
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                boxShadow: `0 0 16px ${d.color}18`,
                flexShrink: 0,
                marginTop: 1,
              }}
            >
              <ContainerKindGlyph color={d.color} datastore={isDatastore} />
            </div>
            <div style={{ minWidth: 0 }}>
              <div style={{ fontSize: 16, fontWeight: 800, color: "#f8fafc", overflowWrap: "anywhere" }}>
                {d.name}
              </div>
              <div
                style={{
                  fontSize: 10,
                  color: "#dbe4f0",
                  marginTop: 5,
                  fontFamily: "monospace",
                  overflowWrap: "anywhere",
                  lineHeight: 1.45,
                }}
              >
                {d.technology}
              </div>
            </div>
          </div>
          <span
            style={{
              fontSize: 9,
              fontWeight: 800,
              color: d.color,
              letterSpacing: 0.6,
              border: `1px solid ${d.color}45`,
              background: `${d.color}18`,
              borderRadius: 999,
              padding: "3px 8px",
              flexShrink: 0,
            }}
          >
            {isDatastore ? "DATA STORE" : "APPLICATION"}
          </span>
        </div>
      </div>

      <div style={{ padding: "12px 16px 16px", position: "relative" }}>
        <div
          style={{
            fontSize: 12,
            color: "#dbe4f0",
            lineHeight: 1.55,
            marginBottom: 12,
            display: "-webkit-box",
            WebkitLineClamp: 3,
            WebkitBoxOrient: "vertical",
            overflow: "hidden",
          }}
        >
          {summary}
        </div>

        <div
          style={{
            fontSize: 10,
            fontWeight: 700,
            color: "#94a3b8",
            textTransform: "uppercase",
            letterSpacing: 0.6,
            marginBottom: 6,
          }}
        >
          Code Ownership
        </div>
        <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
          {visiblePaths.map((path) => (
            <div
              key={path}
              style={{
                fontSize: 11,
                color: "#d1d5db",
                lineHeight: 1.35,
                fontFamily: "monospace",
                overflowWrap: "anywhere",
                padding: "5px 7px",
                borderRadius: 8,
                background: "rgba(15, 23, 42, 0.88)",
                border: "1px solid rgba(148, 163, 184, 0.15)",
              }}
            >
              {path}
            </div>
          ))}
          {hiddenPathCount > 0 && (
            <div style={{ fontSize: 10, color: "#94a3b8", lineHeight: 1.35 }}>
              +{hiddenPathCount} more path{hiddenPathCount === 1 ? "" : "s"} in code ownership
            </div>
          )}
        </div>

        {d.badges && d.badges.length > 0 && (
          <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginTop: 12 }}>
            {d.badges.map((badge) => (
              <span
                key={badge}
                style={{
                  fontSize: 10,
                  fontWeight: 700,
                  color: "#e5e7eb",
                  border: `1px solid ${d.color}30`,
                  background: `${d.color}12`,
                  borderRadius: 999,
                  padding: "3px 8px",
                }}
              >
                {badge}
              </span>
            ))}
          </div>
        )}
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

function ContainerKindGlyph({ color, datastore }: { color: string; datastore: boolean }) {
  if (datastore) {
    return (
      <div style={{ width: 14, display: "flex", flexDirection: "column", gap: 2 }}>
        <span style={{ height: 3, borderRadius: 999, background: color, opacity: 0.95 }} />
        <span style={{ height: 3, borderRadius: 999, background: color, opacity: 0.7 }} />
        <span style={{ height: 3, borderRadius: 999, background: color, opacity: 0.45 }} />
      </div>
    );
  }

  return (
    <div
      style={{
        width: 12,
        height: 12,
        borderRadius: 4,
        background: color,
        boxShadow: `0 0 12px ${color}55`,
      }}
    />
  );
}
