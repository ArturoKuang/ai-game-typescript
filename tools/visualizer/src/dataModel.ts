import type { ArchitectureGraph, DataStructure, DataStructureCategory } from "./types";

export interface DataModelVisibilityOptions {
  showRuntimeStores: boolean;
  showDebugStructures: boolean;
  expandMirrors: boolean;
}

export const DATA_MODEL_CATEGORY_ORDER: DataStructureCategory[] = [
  "domain",
  "transport",
  "in_memory",
  "database",
  "disk_file",
  "ui_view",
  "debug_test",
];

export const DATA_MODEL_CATEGORY_META: Record<
  DataStructureCategory,
  { label: string; color: string; description: string }
> = {
  domain: {
    label: "Gameplay Models",
    color: "#38bdf8",
    description: "Authoritative gameplay state and shared runtime concepts.",
  },
  transport: {
    label: "Wire Contracts",
    color: "#22c55e",
    description: "Socket payloads and snapshot/message contracts crossing the client/server boundary.",
  },
  database: {
    label: "Database",
    color: "#f59e0b",
    description: "Postgres-backed tables, row shapes, and write records that are stored outside process memory.",
  },
  in_memory: {
    label: "In-Memory State",
    color: "#a855f7",
    description: "Process memory: maps, arrays, queues, indexes, and fallback stores held in RAM while the server is running.",
  },
  disk_file: {
    label: "Disk Files",
    color: "#f97316",
    description: "Checked-in files and seed bundles loaded from disk at startup or fetch time.",
  },
  ui_view: {
    label: "UI / Debug Views",
    color: "#f43f5e",
    description: "Client-facing or developer-facing view models used for rendering and diagnostics.",
  },
  debug_test: {
    label: "Harness & Tests",
    color: "#94a3b8",
    description: "Harness, debug-only, and diagnostic structures that are useful on demand but noisy by default.",
  },
};

const CONCEPT_GROUP_META: Record<string, { label: string; order: number }> = {
  player_movement: { label: "Players & Movement", order: 0 },
  conversation: { label: "Conversations", order: 1 },
  world_map: { label: "World & Map", order: 2 },
  npc_memory: { label: "NPC & Memory", order: 3 },
  gameplay_misc: { label: "Gameplay Misc", order: 4 },
  client_server_transport: { label: "Client / Server Transport", order: 0 },
  live_state: { label: "Live State Tables", order: 0 },
  database_schema: { label: "Tables & Row Shapes", order: 1 },
  repo_assets: { label: "Seed Files & Static Data", order: 0 },
  ui_debug_views: { label: "UI Panels & Debug Views", order: 0 },
  events_logging: { label: "Event Buffers & Logs", order: 0 },
  runtime_indexes: { label: "Indexes, Queues & Registries", order: 1 },
  debug_harness: { label: "Harnesses & Diagnostics", order: 2 },
  general: { label: "General", order: 99 },
};

export function getDataModelCategoryMeta(category: DataStructureCategory) {
  return DATA_MODEL_CATEGORY_META[category];
}

export function getConceptGroupLabel(group?: string): string {
  if (!group) return "General";
  return CONCEPT_GROUP_META[group]?.label ?? group.replaceAll("_", " ").replace(/\b\w/g, (value) => value.toUpperCase());
}

function getConceptGroupOrder(group?: string): number {
  if (!group) return 99;
  return CONCEPT_GROUP_META[group]?.order ?? 99;
}

export function getStructureById(
  graph: ArchitectureGraph,
  structureId: string,
): DataStructure | undefined {
  return graph.dataStructures.find((structure) => structure.id === structureId);
}

export function getStructureFamily(
  graph: ArchitectureGraph,
  structureOrId: DataStructure | string,
): DataStructure[] {
  const structure = typeof structureOrId === "string" ? getStructureById(graph, structureOrId) : structureOrId;
  if (!structure) return [];
  const ids = new Set<string>([structure.id, ...structure.mirrorIds]);
  return Array.from(ids)
    .map((id) => getStructureById(graph, id))
    .filter((item): item is DataStructure => Boolean(item));
}

export function getFamilyLeader(
  graph: ArchitectureGraph,
  structureOrId: DataStructure | string,
): DataStructure | undefined {
  const family = getStructureFamily(graph, structureOrId);
  if (family.length === 0) return undefined;
  return family.find((candidate) => candidate.canonical) ?? [...family].sort(compareMirrorPreference)[0];
}

function compareMirrorPreference(left: DataStructure, right: DataStructure): number {
  let leftScore = 0;
  let rightScore = 0;
  if (left.fileId.startsWith("server/")) leftScore += 4;
  if (right.fileId.startsWith("server/")) rightScore += 4;
  if (left.kind === "interface") leftScore += 2;
  if (right.kind === "interface") rightScore += 2;
  return rightScore - leftScore || left.name.localeCompare(right.name);
}

export function getFamilyLeaderId(
  graph: ArchitectureGraph,
  structureOrId: DataStructure | string,
): string | undefined {
  return getFamilyLeader(graph, structureOrId)?.id;
}

export function isStructureVisible(
  graph: ArchitectureGraph,
  structure: DataStructure,
  visibility: DataModelVisibilityOptions,
): boolean {
  if (!visibility.showRuntimeStores && structure.category === "in_memory") return false;
  if (!visibility.showDebugStructures && structure.category === "debug_test") return false;
  if (!visibility.expandMirrors) {
    const familyLeaderId = getFamilyLeaderId(graph, structure);
    if (familyLeaderId && familyLeaderId !== structure.id && structure.mirrorIds.length > 0) {
      return false;
    }
  }
  return true;
}

export function getVisibleDataStructures(
  graph: ArchitectureGraph,
  visibility: DataModelVisibilityOptions,
): DataStructure[] {
  return graph.dataStructures
    .filter((structure) => isStructureVisible(graph, structure, visibility))
    .sort(compareStructureOrder);
}

export function getVisibleDataStructureIds(
  graph: ArchitectureGraph,
  visibility: DataModelVisibilityOptions,
): Set<string> {
  return new Set(getVisibleDataStructures(graph, visibility).map((structure) => structure.id));
}

export function compareStructureOrder(left: DataStructure, right: DataStructure): number {
  const categoryDelta = DATA_MODEL_CATEGORY_ORDER.indexOf(left.category) - DATA_MODEL_CATEGORY_ORDER.indexOf(right.category);
  if (categoryDelta !== 0) return categoryDelta;
  const conceptDelta = getConceptGroupOrder(left.conceptGroup) - getConceptGroupOrder(right.conceptGroup);
  if (conceptDelta !== 0) return conceptDelta;
  if (left.canonical !== right.canonical) return left.canonical ? -1 : 1;
  return left.name.localeCompare(right.name) || left.fileId.localeCompare(right.fileId);
}
