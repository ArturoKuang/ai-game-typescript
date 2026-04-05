import type { CSSProperties } from "react";

export type EvidenceRowItem = {
  kind: string;
  confidence: string;
  fileId?: string;
  line?: number;
  symbol?: string;
  detail: string;
};

// Audit note: these are the shared inspector primitives reused across multiple
// sidebar families. Keeping them together makes later extractions cheaper and
// gives audits one place to check the common inspector chrome.
export function InspectorHeader({
  title,
  subtitle,
  color,
}: {
  title: string;
  subtitle?: string;
  color: string;
}) {
  return (
    <div style={{ marginBottom: 10 }}>
      <div style={{ fontSize: 13, fontWeight: 800, color: "#fff" }}>{title}</div>
      {subtitle && (
        <div style={{ fontSize: 10, color, marginTop: 2, fontFamily: "monospace" }}>
          [{subtitle}]
        </div>
      )}
    </div>
  );
}

export function EvidenceRow({ item }: { item: EvidenceRowItem }) {
  return (
    <div
      style={{
        padding: "8px 10px",
        marginBottom: 6,
        border: "1px solid #273449",
        borderRadius: 8,
        background: "#0f172a",
      }}
    >
      <div style={{ fontSize: 10, color: "#94a3b8", marginBottom: 4 }}>
        {item.kind}
        {item.fileId ? ` · ${item.fileId}` : ""}
        {item.line ? `:${item.line}` : ""}
        {item.symbol ? ` · ${item.symbol}` : ""}
        {` · ${item.confidence}`}
      </div>
      <div style={{ fontSize: 11, color: "#d1d5db", lineHeight: 1.5 }}>{item.detail}</div>
    </div>
  );
}

export const actionButtonStyle: CSSProperties = {
  display: "block",
  width: "100%",
  appearance: "none",
  textAlign: "left",
  padding: "8px 10px",
  marginBottom: 6,
  background: "#0f172a",
  border: "1px solid #273449",
  borderRadius: 8,
  cursor: "pointer",
};

export const relationshipMetaBadgeStyle: CSSProperties = {
  fontSize: 9,
  fontWeight: 700,
  color: "#dbeafe",
  background: "#111827",
  border: "1px solid #273449",
  borderRadius: 999,
  padding: "3px 8px",
};
