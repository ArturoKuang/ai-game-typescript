/**
 * Component-structure pass for the architecture extractor.
 *
 * Audit note: this pass contains the heuristics that infer "what owns what"
 * inside each component. If a primary class or owned utility looks wrong in the
 * diagrams, start auditing here.
 */
import type { ComponentDef } from "./componentGrouper.js";
import type {
  ClassInfo,
  Component,
  ComponentInternal,
  FileNode,
  ImportEdge,
} from "./types.js";

/** Well-known class names in the codebase — used to detect ownership vs primitive fields. */
function buildClassNameSet(allClasses: ClassInfo[]): Set<string> {
  return new Set(
    allClasses.filter((classInfo) => classInfo.kind === "class").map((classInfo) => classInfo.name),
  );
}

/** Simple heuristic descriptions for common utility imports. */
const UTILITY_PURPOSES: Record<string, string> = {
  findPath: "A* pathfinding on tile grid",
  moveWithCollision: "AABB tile collision resolution",
  findBlockedTileOverlap: "Blocked tile overlap detection",
  PLAYER_RADIUS: "Player collision half-extent constant",
  SeededRNG: "Deterministic pseudo-random number generator",
  cosineSimilarity: "Vector similarity for memory retrieval",
  PlaceholderEmbedder: "Hash-based deterministic text embedder",
  buildReplyPrompt: "Formats NPC reply prompt for LLM",
  buildReflectionPrompt: "Formats NPC reflection prompt for LLM",
  snapshotConversation: "Deep-clone conversation for safe event payloads",
  renderAsciiMap: "Terminal ASCII map visualization",
  CHARACTERS: "NPC character definitions",
};

export function extractComponentInternals(
  allClasses: ClassInfo[],
  imports: ImportEdge[],
  components: Component[],
): ComponentInternal[] {
  const classNames = buildClassNameSet(allClasses);
  const classMap = new Map(allClasses.map((classInfo) => [classInfo.name, classInfo]));
  const internals: ComponentInternal[] = [];

  for (const component of components) {
    const componentClasses = allClasses.filter(
      (classInfo) =>
        classInfo.componentId === component.id && classInfo.kind === "class",
    );
    if (componentClasses.length === 0) {
      internals.push({
        componentId: component.id,
        primaryClass: "",
        primaryState: [],
        ownedClasses: [],
        usedUtilities: [],
      });
      continue;
    }

    const primary = componentClasses.reduce((best, candidate) =>
      candidate.methods.length > best.methods.length ? candidate : best,
    );

    const ownedClasses: ComponentInternal["ownedClasses"] = [];
    const ownedClassNames = new Set<string>();

    for (const field of primary.fields) {
      const baseType = stripTypeWrapperNoise(field.type);
      const ownedCandidate = classMap.get(baseType);
      if (
        classNames.has(baseType) &&
        baseType !== primary.name &&
        ownedCandidate?.componentId === component.id
      ) {
        ownedClassNames.add(baseType);
        ownedClasses.push({
          name: baseType,
          fieldName: field.name,
          stateFields: (ownedCandidate.fields ?? [])
            .filter(
              (ownedField) =>
                ownedField.visibility !== "private" ||
                ownedCandidate.componentId === component.id,
            )
            .slice(0, 6)
            .map((ownedField) => ({
              name: ownedField.name,
              type: truncateType(ownedField.type, 40),
            })),
        });
      }
    }

    const primaryState = primary.fields
      .filter((field) => {
        const baseType = stripTypeWrapperNoise(field.type);
        return !classNames.has(baseType) || baseType === primary.name;
      })
      .filter((field) => !field.name.startsWith("_"))
      .slice(0, 8)
      .map((field) => ({
        name: field.name,
        type: truncateType(field.type, 50),
      }));

    const usedUtilities: ComponentInternal["usedUtilities"] = [];
    const componentFileIds = new Set(component.fileIds);

    for (const imp of imports) {
      if (!componentFileIds.has(imp.source) || !componentFileIds.has(imp.target)) {
        continue;
      }
      if (imp.source !== primary.fileId) continue;

      for (const symbol of imp.symbols) {
        if (ownedClassNames.has(symbol) || symbol === primary.name) continue;

        const symbolClass = classMap.get(symbol);
        if (symbolClass && symbolClass.kind === "interface") continue;

        const sourceFile = imp.target.split("/").pop() ?? imp.target;
        usedUtilities.push({
          name: symbol,
          source: sourceFile,
          purpose: UTILITY_PURPOSES[symbol] ?? "",
        });
      }
    }

    internals.push({
      componentId: component.id,
      primaryClass: primary.name,
      primaryState,
      ownedClasses,
      usedUtilities,
    });
  }

  return internals;
}

export function buildComponents(
  files: FileNode[],
  componentDefs: ComponentDef[],
): Component[] {
  const components: Component[] = [];
  const filesByComponent = new Map<string, FileNode[]>();

  for (const file of files) {
    if (!filesByComponent.has(file.componentId)) {
      filesByComponent.set(file.componentId, []);
    }
    filesByComponent.get(file.componentId)!.push(file);
  }

  for (const def of componentDefs) {
    const componentFiles = filesByComponent.get(def.id) ?? [];
    if (componentFiles.length === 0) continue;
    components.push({
      id: def.id,
      label: def.label,
      dirPattern: def.dirPattern,
      fileIds: componentFiles.map((file) => file.id),
      color: def.color,
      totalLoc: componentFiles.reduce((sum, file) => sum + file.loc, 0),
    });
  }

  return components;
}

function stripTypeWrapperNoise(typeText: string): string {
  return typeText
    .replace(/\s*\|\s*null$/g, "")
    .replace(/<.*>$/g, "")
    .trim();
}

function truncateType(typeText: string, maxLength: number): string {
  if (typeText.length <= maxLength) return typeText;
  return `${typeText.substring(0, maxLength - 3)}...`;
}
