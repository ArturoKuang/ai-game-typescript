import { Handle, Position, type NodeProps } from "@xyflow/react";
import { useStore } from "../store";
import type { ComponentInternal } from "../types";

interface FileEntry {
  name: string;
  loc: number;
  classes: string[];
}

interface ComponentData {
  label: string;
  description: string;
  technology?: string;
  keyClasses?: string[];
  fileCount: number;
  totalLoc: number;
  color: string;
  expanded: boolean;
  fileNames: string[];
  files?: FileEntry[];
  internal?: ComponentInternal;
  [key: string]: unknown;
}

export function ComponentNode({ id, data, selected }: NodeProps) {
  const d = data as ComponentData;
  const toggleExpanded = useStore((s) => s.toggleExpanded);

  return (
    <div
      style={{
        background: "#13132a",
        border: `2px solid ${selected ? "#fff" : d.color}`,
        borderRadius: 12,
        padding: 0,
        width: d.expanded ? 360 : 300,
        cursor: "pointer",
        transition: "box-shadow 0.2s",
        boxShadow: selected
          ? `0 0 24px ${d.color}50`
          : "0 4px 16px rgba(0,0,0,0.5)",
        overflow: "hidden",
      }}
      onDoubleClick={() => toggleExpanded(id)}
    >
      <Handle type="target" position={Position.Left} style={{ background: d.color, width: 10, height: 10 }} />

      {/* Header */}
      <div
        style={{
          background: `${d.color}30`,
          padding: "10px 14px",
          display: "flex",
          justifyContent: "space-between",
          alignItems: "flex-start",
          borderBottom: `1px solid ${d.color}40`,
        }}
      >
        <div>
          <div style={{ fontWeight: 800, fontSize: 15, color: "#fff" }}>{d.label}</div>
          {d.technology && (
            <div style={{ fontSize: 9, color: `${d.color}bb`, marginTop: 2 }}>[{d.technology}]</div>
          )}
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 6, flexShrink: 0, marginTop: 2 }}>
          <span style={{ fontSize: 10, color: "#aaa" }}>{d.fileCount} files</span>
          <button
            onClick={(e) => { e.stopPropagation(); toggleExpanded(id); }}
            style={{
              background: "rgba(255,255,255,0.1)",
              border: "1px solid rgba(255,255,255,0.2)",
              borderRadius: 4, color: "#ddd", fontSize: 10, padding: "2px 7px", cursor: "pointer",
            }}
          >
            {d.expanded ? "▾ Collapse" : "▸ Expand"}
          </button>
        </div>
      </div>

      {/* Body */}
      <div style={{ padding: "8px 14px 10px" }}>
        <div style={{ fontSize: 11, color: "#999", lineHeight: 1.5, marginBottom: 6 }}>
          {d.description}
        </div>
        <div style={{ fontSize: 10, color: "#555", marginTop: 4 }}>
          {d.totalLoc.toLocaleString()} lines of code
        </div>

        {/* --- COLLAPSED VIEW --- */}
        {!d.expanded && (
          <>
            {d.keyClasses && d.keyClasses.length > 0 && (
              <div style={{ marginTop: 6 }}>
                <SectionLabel>Key classes</SectionLabel>
                <div style={{ display: "flex", flexWrap: "wrap", gap: 4 }}>
                  {d.keyClasses.map((cls) => (
                    <ClassBadge key={cls} name={cls} color={d.color} />
                  ))}
                </div>
              </div>
            )}
            {d.fileNames.length > 0 && (
              <div style={{ marginTop: 8, padding: "5px 8px", background: "rgba(255,255,255,0.02)", borderRadius: 5, border: "1px solid rgba(255,255,255,0.05)" }}>
                {d.fileNames.slice(0, 3).map((name) => (
                  <div key={name} style={{ fontSize: 10, color: "#666", lineHeight: 1.5, fontFamily: "monospace" }}>{name}</div>
                ))}
                {d.fileNames.length > 3 && (
                  <div style={{ fontSize: 9, color: "#444", marginTop: 1 }}>+{d.fileNames.length - 3} more</div>
                )}
              </div>
            )}
          </>
        )}

        {/* --- EXPANDED VIEW: Internal architecture --- */}
        {d.expanded && d.internal && d.internal.primaryClass && (
          <ExpandedInternal internal={d.internal} color={d.color} />
        )}

        {/* Fallback: file list if no internal data */}
        {d.expanded && (!d.internal || !d.internal.primaryClass) && d.files && (
          <div style={{ marginTop: 8 }}>
            <SectionLabel>Files</SectionLabel>
            {d.files.map((f) => (
              <FileRow key={f.name} file={f} color={d.color} />
            ))}
          </div>
        )}
      </div>

      <Handle type="source" position={Position.Right} style={{ background: d.color, width: 10, height: 10 }} />
    </div>
  );
}

// ---------------------------------------------------------------------------
// Expanded internal architecture sub-components
// ---------------------------------------------------------------------------

function ExpandedInternal({ internal, color }: { internal: ComponentInternal; color: string }) {
  return (
    <div style={{ marginTop: 8 }}>
      {/* Primary class box */}
      <div style={{
        border: `1.5px solid ${color}60`,
        borderRadius: 8,
        padding: "8px 10px",
        background: `${color}0c`,
        marginBottom: 6,
      }}>
        <div style={{ fontSize: 12, fontWeight: 700, color: "#ddd", fontFamily: "monospace" }}>
          {internal.primaryClass}
        </div>

        {/* Primary state */}
        {internal.primaryState.length > 0 && (
          <div style={{ marginTop: 6 }}>
            <SectionLabel>owns</SectionLabel>
            {internal.primaryState.map((s) => (
              <div key={s.name} style={{ fontSize: 10, color: "#999", fontFamily: "monospace", lineHeight: 1.5 }}>
                {s.name}: <span style={{ color: "#666" }}>{s.type}</span>
              </div>
            ))}
          </div>
        )}

        {/* Owned sub-classes: nested boxes inside the primary */}
        {internal.ownedClasses.length > 0 && (
          <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginTop: 8 }}>
            {internal.ownedClasses.map((owned) => (
              <div key={owned.name} style={{
                flex: "1 1 140px",
                border: `1px solid ${color}40`,
                borderRadius: 6,
                padding: "6px 8px",
                background: `${color}08`,
                minWidth: 130,
              }}>
                <div style={{ fontSize: 11, fontWeight: 600, color: "#ccc", fontFamily: "monospace" }}>
                  {owned.name}
                </div>
                <div style={{ fontSize: 9, color: "#555", marginBottom: 3 }}>
                  via {owned.fieldName}
                </div>
                {owned.stateFields.map((f) => (
                  <div key={f.name} style={{ fontSize: 9, color: "#888", fontFamily: "monospace", lineHeight: 1.4 }}>
                    {f.name}
                  </div>
                ))}
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Used utilities */}
      {internal.usedUtilities.length > 0 && (
        <div style={{ marginTop: 4 }}>
          <SectionLabel>uses</SectionLabel>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 4 }}>
            {internal.usedUtilities
              .filter((u) => u.purpose) // only show ones with known purposes
              .map((u) => (
                <div key={u.name} style={{
                  fontSize: 9,
                  fontFamily: "monospace",
                  color: "#aaa",
                  background: "rgba(255,255,255,0.04)",
                  border: "1px solid rgba(255,255,255,0.08)",
                  borderRadius: 4,
                  padding: "2px 6px",
                }}
                title={u.purpose}
                >
                  {u.name}
                  {u.purpose && <span style={{ color: "#555", marginLeft: 4 }}>— {u.purpose}</span>}
                </div>
              ))}
          </div>
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Shared small components
// ---------------------------------------------------------------------------

function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <div style={{
      fontSize: 9, fontWeight: 700, color: "#666",
      textTransform: "uppercase", letterSpacing: 0.5, marginBottom: 3,
    }}>
      {children}
    </div>
  );
}

function ClassBadge({ name, color }: { name: string; color: string }) {
  return (
    <span style={{
      fontSize: 10, fontFamily: "monospace", color,
      background: `${color}15`, border: `1px solid ${color}30`,
      borderRadius: 4, padding: "1px 6px",
    }}>
      {name}
    </span>
  );
}

function FileRow({ file, color }: { file: FileEntry; color: string }) {
  return (
    <div style={{
      padding: "4px 8px", marginBottom: 2,
      background: `${color}08`, borderRadius: 4, borderLeft: `3px solid ${color}50`,
    }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline" }}>
        <span style={{ fontSize: 11, color: "#ccc", fontFamily: "monospace", fontWeight: 600 }}>{file.name}</span>
        <span style={{ fontSize: 9, color: "#555", marginLeft: 8, flexShrink: 0 }}>{file.loc}L</span>
      </div>
      {file.classes.length > 0 && (
        <div style={{ fontSize: 9, color: "#888", marginTop: 1 }}>{file.classes.join(", ")}</div>
      )}
    </div>
  );
}
