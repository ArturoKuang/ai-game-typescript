/**
 * Maps file paths to architectural components based on directory structure.
 */

export interface ComponentDef {
  id: string;
  label: string;
  dirPattern: string;
  color: string;
}

const COMPONENT_DEFS: ComponentDef[] = [
  { id: "Engine", label: "Engine", dirPattern: "server/src/engine/", color: "#648FFF" },
  { id: "Network", label: "Network", dirPattern: "server/src/network/", color: "#22D3EE" },
  { id: "NPC", label: "NPC", dirPattern: "server/src/npc/", color: "#DC267F" },
  { id: "Persistence", label: "Persistence", dirPattern: "server/src/db/", color: "#FFB000" },
  { id: "Debug", label: "Debug", dirPattern: "server/src/debug/", color: "#d1d5db" },
  { id: "Client", label: "Client", dirPattern: "client/src/", color: "#FE6100" },
  { id: "Bootstrap", label: "Bootstrap", dirPattern: "server/src/", color: "#785EF0" },
];

/**
 * Determine which component a file belongs to.
 * Matches are checked in order — more specific patterns first.
 * The final "server/src/" pattern catches index.ts and data/.
 */
export function getComponentId(relPath: string): string {
  for (const def of COMPONENT_DEFS) {
    if (def.id === "Bootstrap") continue; // fallback, checked last
    if (relPath.startsWith(def.dirPattern)) return def.id;
  }
  if (relPath.startsWith("server/src/")) return "Bootstrap";
  if (relPath.startsWith("client/")) return "Client";
  return "Other";
}

export function getComponentDefs(): ComponentDef[] {
  return COMPONENT_DEFS;
}

export function getComponentDef(id: string): ComponentDef | undefined {
  return COMPONENT_DEFS.find((d) => d.id === id);
}
