import { readFileSync } from "node:fs";
import { relative, resolve } from "node:path";
import {
  Node,
  SyntaxKind,
  type ClassDeclaration,
  type ConstructorDeclaration,
  type FunctionDeclaration,
  type InterfaceDeclaration,
  type MethodDeclaration,
  type ParameterDeclaration,
  type PropertyDeclaration,
  type PropertySignature,
  type SourceFile,
  type TypeAliasDeclaration,
  type TypeLiteralNode,
  type TypeNode,
  type VariableDeclaration,
} from "ts-morph";
import { getComponentId } from "./componentGrouper.js";
import type {
  ComponentDiagramConfidence,
  DataAccessKind,
  DataAccessLifecycle,
  DataModelEvidence,
  DataStructure,
  DataStructureAccess,
  DataStructureCategory,
  DataStructureField,
  DataStructureKind,
  DataStructureRelation,
  DataStructureVariant,
} from "./types.js";

interface ExtractDataModelOptions {
  rootDir: string;
  sourceFiles: SourceFile[];
}

interface RuntimeStoreSeed {
  structureId: string;
  fileId: string;
  ownerClassName?: string;
  name: string;
  receiverText: string;
  targetNames: string[];
  isIndex: boolean;
}

type ActorNode =
  | MethodDeclaration
  | FunctionDeclaration
  | ConstructorDeclaration;

class EvidenceRecorder {
  private nextId = 1;
  readonly items: DataModelEvidence[] = [];

  add(params: Omit<DataModelEvidence, "id">): string {
    const id = `data-model-evidence-${this.nextId++}`;
    this.items.push({ id, ...params });
    return id;
  }
}

export function extractDataModel(
  {
    rootDir,
    sourceFiles,
  }: ExtractDataModelOptions,
): {
  dataStructures: DataStructure[];
  dataStructureRelations: DataStructureRelation[];
  dataStructureAccesses: DataStructureAccess[];
  dataModelEvidence: DataModelEvidence[];
} {
  const recorder = new EvidenceRecorder();
  const dataStructures: DataStructure[] = [];
  const runtimeStores: RuntimeStoreSeed[] = [];

  for (const sourceFile of sourceFiles) {
    const fileId = relative(rootDir, sourceFile.getFilePath());
    extractSourceFileStructures(sourceFile, fileId, dataStructures, runtimeStores, recorder);
  }

  extractSchemaTables(rootDir, dataStructures, recorder);
  extractMapAsset(rootDir, dataStructures, recorder);
  extractCharacterAsset(rootDir, sourceFiles, dataStructures, recorder);

  const structuresById = new Map(dataStructures.map((structure) => [structure.id, structure]));
  const structuresByName = groupStructuresByName(dataStructures);

  applyMirrorMetadata(dataStructures, structuresByName);
  wireFieldReferences(dataStructures, structuresByName);

  const dataStructureRelations = buildRelations(
    dataStructures,
    structuresByName,
    runtimeStores,
    recorder,
  );
  applyRelationBadges(dataStructures, dataStructureRelations);

  const dataStructureAccesses = buildAccesses(
    sourceFiles,
    dataStructures,
    structuresByName,
    runtimeStores,
    recorder,
  );

  dedupeStructureAccesses(dataStructureAccesses);

  for (const structure of dataStructures) {
    structure.fieldCount = structure.fields.length + structure.variants.reduce((sum, variant) => sum + variant.fields.length, 0);
    structure.componentIds = structure.componentIds.filter((value, index, values) => values.indexOf(value) === index);
  }

  // Ensure referenced structures still point at valid ids after mirror updates.
  for (const structure of dataStructures) {
    for (const field of structure.fields) {
      if (field.referencedStructureId && !structuresById.has(field.referencedStructureId)) {
        delete field.referencedStructureId;
      }
    }
    for (const variant of structure.variants) {
      for (const field of variant.fields) {
        if (field.referencedStructureId && !structuresById.has(field.referencedStructureId)) {
          delete field.referencedStructureId;
        }
      }
    }
  }

  return {
    dataStructures,
    dataStructureRelations,
    dataStructureAccesses,
    dataModelEvidence: recorder.items,
  };
}

function extractSourceFileStructures(
  sourceFile: SourceFile,
  fileId: string,
  dataStructures: DataStructure[],
  runtimeStores: RuntimeStoreSeed[],
  recorder: EvidenceRecorder,
): void {
  for (const iface of sourceFile.getInterfaces()) {
    if (!iface.isExported()) continue;
    if (iface.getMethods().length > 0 && iface.getProperties().length === 0) continue;

    const fields = iface.getProperties().map((property) =>
      buildFieldFromProperty(property, fileId, iface.getName(), recorder),
    );
    if (fields.length === 0) continue;

    const evidenceId = recorder.add({
      kind: "type_definition",
      confidence: "exact",
      fileId,
      line: iface.getStartLineNumber(),
      symbol: iface.getName(),
      detail: `Interface ${iface.getName()} defines ${fields.length} field${fields.length === 1 ? "" : "s"}.`,
    });

    dataStructures.push({
      id: `${fileId}::${iface.getName()}`,
      name: iface.getName(),
      category: categorizeStructure(fileId, iface.getName()),
      conceptGroup: inferConceptGroup(fileId, iface.getName(), categorizeStructure(fileId, iface.getName())),
      kind: "interface",
      sourceKind: "ts",
      fileId,
      exported: true,
      canonical: !fileId.startsWith("client/"),
      componentIds: componentIdsForFile(fileId),
      summary: summarizeNode(iface),
      purpose: firstSentence(summarizeNode(iface)),
      fieldCount: fields.length,
      fields,
      variants: [],
      mirrorIds: [],
      badges: [],
      evidenceIds: [evidenceId],
    });
  }

  for (const alias of sourceFile.getTypeAliases()) {
    if (!alias.isExported()) continue;
    const structure = buildStructureFromAlias(alias, fileId, recorder);
    if (structure) {
      dataStructures.push(structure);
    }
  }

  extractRuntimeStoresFromClassFields(sourceFile, fileId, dataStructures, runtimeStores, recorder);
  extractRuntimeStoresFromTopLevelVariables(sourceFile, fileId, dataStructures, runtimeStores, recorder);
}

function buildStructureFromAlias(
  alias: TypeAliasDeclaration,
  fileId: string,
  recorder: EvidenceRecorder,
): DataStructure | null {
  const typeNode = alias.getTypeNode();
  if (!typeNode) return null;

  let kind: DataStructureKind = "type_alias";
  const fields: DataStructureField[] = [];
  const variants: DataStructureVariant[] = [];

  if (Node.isUnionTypeNode(typeNode)) {
    kind = "union";
    for (const member of typeNode.getTypeNodes()) {
      const variant = buildVariantFromTypeNode(member, fileId, alias.getName(), recorder);
      if (variant) variants.push(variant);
    }
  } else if (Node.isTypeLiteral(typeNode)) {
    fields.push(...buildFieldsFromTypeLiteral(typeNode, fileId, alias.getName(), recorder));
  } else {
    const text = cleanTypeText(typeNode.getText());
    if (!isLikelyDataAlias(alias.getName(), text)) return null;
    if (looksLikeLiteralUnionText(text)) {
      kind = "union";
      for (const literal of text.split("|").map((part) => part.trim()).filter(Boolean)) {
        variants.push({
          id: `${fileId}::${alias.getName()}::variant:${literal}`,
          label: literal.replaceAll(`"`, ""),
          discriminatorValue: literal.replaceAll(`"`, ""),
          fields: [],
          evidenceIds: [],
        });
      }
    }
  }

  if (fields.length === 0 && variants.length === 0) return null;

  const evidenceId = recorder.add({
    kind: "type_definition",
    confidence: "exact",
    fileId,
    line: alias.getStartLineNumber(),
    symbol: alias.getName(),
    detail: `Type alias ${alias.getName()} is modeled as a ${kind}.`,
  });

  return {
    id: `${fileId}::${alias.getName()}`,
    name: alias.getName(),
    category: categorizeStructure(fileId, alias.getName()),
    conceptGroup: inferConceptGroup(fileId, alias.getName(), categorizeStructure(fileId, alias.getName())),
    kind,
    sourceKind: "ts",
    fileId,
    exported: true,
    canonical: !fileId.startsWith("client/"),
    componentIds: componentIdsForFile(fileId),
    summary: summarizeNode(alias),
    purpose: firstSentence(summarizeNode(alias)),
    fieldCount: fields.length + variants.reduce((sum, variant) => sum + variant.fields.length, 0),
    fields,
    variants,
    mirrorIds: [],
    badges: [],
    evidenceIds: [evidenceId],
  };
}

function buildVariantFromTypeNode(
  typeNode: TypeNode,
  fileId: string,
  ownerName: string,
  recorder: EvidenceRecorder,
): DataStructureVariant | null {
  if (Node.isLiteralTypeNode(typeNode)) {
    const literalText = cleanTypeText(typeNode.getText()).replaceAll(`"`, "");
    return {
      id: `${fileId}::${ownerName}::variant:${literalText}`,
      label: literalText,
      discriminatorValue: literalText,
      fields: [],
      evidenceIds: [],
    };
  }

  if (Node.isTypeLiteral(typeNode)) {
    const properties = typeNode.getProperties().filter(Node.isPropertySignature);
    const discriminator = properties.find((property) => property.getName() === "type");
    const discriminatorValue = discriminator
      ? cleanTypeText(discriminator.getTypeNode()?.getText() ?? discriminator.getType().getText(discriminator)).replaceAll(`"`, "")
      : undefined;

    return {
      id: `${fileId}::${ownerName}::variant:${discriminatorValue ?? typeNode.getText().slice(0, 24)}`,
      label: discriminatorValue ?? "variant",
      discriminatorField: discriminator ? "type" : undefined,
      discriminatorValue,
      summary: discriminatorValue ? `Variant for ${discriminatorValue}.` : undefined,
      fields: buildFieldsFromTypeLiteral(typeNode, fileId, ownerName, recorder, "type"),
      evidenceIds: [],
    };
  }

  return {
    id: `${fileId}::${ownerName}::variant:${cleanTypeText(typeNode.getText())}`,
    label: cleanTypeText(typeNode.getText()),
    fields: [],
    evidenceIds: [],
  };
}

function buildFieldsFromTypeLiteral(
  typeLiteral: TypeLiteralNode,
  fileId: string,
  ownerName: string,
  recorder: EvidenceRecorder,
  excludePropertyName?: string,
): DataStructureField[] {
  const fields: DataStructureField[] = [];
  for (const property of typeLiteral.getProperties()) {
    if (property.getName() === excludePropertyName) continue;

    const typeNode = property.getTypeNode();
    if (typeNode && Node.isTypeLiteral(typeNode)) {
      for (const nestedProperty of typeNode.getProperties().filter(Node.isPropertySignature)) {
        fields.push(
          buildFieldFromProperty(
            nestedProperty,
            fileId,
            ownerName,
            recorder,
            `${property.getName()}.`,
          ),
        );
      }
      continue;
    }

    fields.push(buildFieldFromProperty(property, fileId, ownerName, recorder));
  }
  return fields;
}

function buildFieldFromProperty(
  property: PropertySignature,
  fileId: string,
  ownerName: string,
  recorder: EvidenceRecorder,
  prefix = "",
): DataStructureField {
  const typeText = cleanTypeText(property.getTypeNode()?.getText() ?? property.getType().getText(property));
  const evidenceId = recorder.add({
    kind: "field_definition",
    confidence: "exact",
    fileId,
    line: property.getStartLineNumber(),
    symbol: `${ownerName}.${prefix}${property.getName()}`,
    detail: `Field ${prefix}${property.getName()} is typed as ${typeText}.`,
  });

  return {
    id: `${fileId}::${ownerName}::field:${prefix}${property.getName()}`,
    name: `${prefix}${property.getName()}`,
    typeText,
    optional: property.hasQuestionToken(),
    readonly: property.isReadonly(),
    description: summarizeNode(property),
    evidenceIds: [evidenceId],
  };
}

function extractRuntimeStoresFromClassFields(
  sourceFile: SourceFile,
  fileId: string,
  dataStructures: DataStructure[],
  runtimeStores: RuntimeStoreSeed[],
  recorder: EvidenceRecorder,
): void {
  for (const classDecl of sourceFile.getClasses()) {
    const className = classDecl.getName();
    if (!className) continue;

    for (const property of classDecl.getProperties()) {
      const store = buildRuntimeStoreFromProperty(property, fileId, className, recorder);
      if (!store) continue;
      dataStructures.push(store.structure);
      runtimeStores.push(store.seed);
    }
  }
}

function extractRuntimeStoresFromTopLevelVariables(
  sourceFile: SourceFile,
  fileId: string,
  dataStructures: DataStructure[],
  runtimeStores: RuntimeStoreSeed[],
  recorder: EvidenceRecorder,
): void {
  for (const declaration of sourceFile.getVariableDeclarations()) {
    if (!isTopLevelDeclaration(declaration)) continue;
    const store = buildRuntimeStoreFromVariable(declaration, fileId, recorder);
    if (!store) continue;
    dataStructures.push(store.structure);
    runtimeStores.push(store.seed);
  }
}

function buildRuntimeStoreFromProperty(
  property: PropertyDeclaration,
  fileId: string,
  ownerClassName: string,
  recorder: EvidenceRecorder,
): { structure: DataStructure; seed: RuntimeStoreSeed } | null {
  const typeText = cleanTypeText(property.getTypeNode()?.getText() ?? property.getType().getText(property));
  const name = property.getName();
  if (!isInterestingRuntimeStore(typeText, name)) return null;

  const evidenceId = recorder.add({
    kind: "runtime_store_definition",
    confidence: "exact",
    fileId,
    line: property.getStartLineNumber(),
    symbol: `${ownerClassName}.${name}`,
    detail: `Runtime store ${ownerClassName}.${name} uses ${typeText}.`,
  });

  const isIndex = looksLikeIndexStore(name, typeText);
  const targetNames = extractTypeNames(typeText);
  const structureId = `${fileId}::store:${ownerClassName}.${name}`;

  return {
    structure: {
      id: structureId,
      name: `${ownerClassName}.${name}`,
      category: "in_memory",
      conceptGroup: inferConceptGroup(fileId, `${ownerClassName}.${name}`, "in_memory"),
      kind: "store",
      sourceKind: "ts",
      fileId,
      exported: false,
      canonical: true,
      componentIds: componentIdsForFile(fileId),
      summary: summarizeRuntimeStore(name, typeText, ownerClassName),
      purpose: isIndex ? "Runtime lookup index." : "Runtime in-memory store.",
      fieldCount: 2,
      fields: [
        {
          id: `${structureId}::field:owner`,
          name: "owner",
          typeText: ownerClassName,
          optional: false,
          readonly: false,
          evidenceIds: [evidenceId],
        },
        {
          id: `${structureId}::field:container`,
          name: "container",
          typeText,
          optional: false,
          readonly: false,
          evidenceIds: [evidenceId],
        },
      ],
      variants: [],
      mirrorIds: [],
      badges: [isIndex ? "Index" : "Store"],
      evidenceIds: [evidenceId],
    },
    seed: {
      structureId,
      fileId,
      ownerClassName,
      name,
      receiverText: `this.${name}`,
      targetNames,
      isIndex,
    },
  };
}

function buildRuntimeStoreFromVariable(
  declaration: VariableDeclaration,
  fileId: string,
  recorder: EvidenceRecorder,
): { structure: DataStructure; seed: RuntimeStoreSeed } | null {
  const name = declaration.getName();
  if (isAssetBackedDeclaration(fileId, name)) return null;
  const typeText = cleanTypeText(
    declaration.getTypeNode()?.getText() ?? declaration.getType().getText(declaration),
  );
  if (!isInterestingRuntimeStore(typeText, name)) return null;

  const evidenceId = recorder.add({
    kind: "runtime_store_definition",
    confidence: "exact",
    fileId,
    line: declaration.getStartLineNumber(),
    symbol: name,
    detail: `Top-level runtime store ${name} uses ${typeText}.`,
  });

  const isIndex = looksLikeIndexStore(name, typeText);
  const targetNames = extractTypeNames(typeText);
  const structureId = `${fileId}::store:${name}`;

  return {
    structure: {
      id: structureId,
      name,
      category: "in_memory",
      conceptGroup: inferConceptGroup(fileId, name, "in_memory"),
      kind: "store",
      sourceKind: "ts",
      fileId,
      exported: false,
      canonical: true,
      componentIds: componentIdsForFile(fileId),
      summary: summarizeRuntimeStore(name, typeText),
      purpose: isIndex ? "Top-level runtime lookup index." : "Top-level in-memory runtime store.",
      fieldCount: 2,
      fields: [
        {
          id: `${structureId}::field:owner`,
          name: "owner",
          typeText: fileId.split("/").pop() ?? fileId,
          optional: false,
          readonly: false,
          evidenceIds: [evidenceId],
        },
        {
          id: `${structureId}::field:container`,
          name: "container",
          typeText,
          optional: false,
          readonly: false,
          evidenceIds: [evidenceId],
        },
      ],
      variants: [],
      mirrorIds: [],
      badges: [isIndex ? "Index" : "Store"],
      evidenceIds: [evidenceId],
    },
    seed: {
      structureId,
      fileId,
      name,
      receiverText: name,
      targetNames,
      isIndex,
    },
  };
}

function extractSchemaTables(
  rootDir: string,
  dataStructures: DataStructure[],
  recorder: EvidenceRecorder,
): void {
  const schemaFileId = "server/src/db/schema.sql";
  const schemaPath = resolve(rootDir, schemaFileId);
  const sqlText = readFileSync(schemaPath, "utf-8");
  const tableRegex = /CREATE TABLE IF NOT EXISTS\s+([a-z_]+)\s*\(([\s\S]*?)\);/g;

  for (const match of sqlText.matchAll(tableRegex)) {
    const tableName = match[1];
    const body = match[2];
    const startIndex = match.index ?? 0;
    const line = sqlText.slice(0, startIndex).split("\n").length;
    const columns = body
      .split("\n")
      .map((rawLine) => rawLine.trim())
      .filter((rawLine) => rawLine.length > 0 && !rawLine.startsWith("--"));

    const fields: DataStructureField[] = [];
    for (const column of columns) {
      const columnMatch = /^([a-z_]+)\s+([A-Z0-9_]+(?:\([^)]+\))?(?:\[\])?)/i.exec(column);
      if (!columnMatch) continue;
      const columnName = columnMatch[1];
      const columnType = columnMatch[2].toUpperCase();
      const evidenceId = recorder.add({
        kind: "schema_column",
        confidence: "exact",
        fileId: schemaFileId,
        line,
        symbol: `${tableName}.${columnName}`,
        detail: `Schema column ${tableName}.${columnName} is ${columnType}.`,
      });
      fields.push({
        id: `table:${tableName}::field:${columnName}`,
        name: columnName,
        typeText: columnType,
        optional: !column.toUpperCase().includes("NOT NULL"),
        readonly: false,
        description: buildColumnDescription(column),
        evidenceIds: [evidenceId],
      });
    }

    const evidenceId = recorder.add({
      kind: "schema_table",
      confidence: "exact",
      fileId: schemaFileId,
      line,
      symbol: tableName,
      detail: `Table ${tableName} defines ${fields.length} column${fields.length === 1 ? "" : "s"}.`,
    });

    dataStructures.push({
      id: `table:${tableName}`,
      name: tableName,
      category: "database",
      conceptGroup: inferConceptGroup(schemaFileId, tableName, "database"),
      kind: "table",
      sourceKind: "sql",
      fileId: schemaFileId,
      exported: false,
      canonical: true,
      componentIds: ["Persistence"],
      summary: `SQL table ${tableName}.`,
      purpose: "Persistence schema table.",
      fieldCount: fields.length,
      fields,
      variants: [],
      mirrorIds: [],
      badges: [],
      evidenceIds: [evidenceId],
    });
  }
}

function extractMapAsset(
  rootDir: string,
  dataStructures: DataStructure[],
  recorder: EvidenceRecorder,
): void {
  const fileId = "data/map.json";
  const mapPath = resolve(rootDir, fileId);
  const raw = JSON.parse(readFileSync(mapPath, "utf-8")) as Record<string, unknown>;

  const fieldDefs: Array<[string, string, string | undefined]> = [
    ["width", "number", "Map width in tiles."],
    ["height", "number", "Map height in tiles."],
    ["tiles", "TileType[][]", "Row-major tile grid."],
    ["activities", "Activity[]", "Placed activity definitions."],
    ["spawnPoints", "Position[]", "Spawn positions used for players and NPCs."],
  ];

  const fields = fieldDefs.map(([name, typeText, description]) => {
    const evidenceId = recorder.add({
      kind: "asset_field",
      confidence: "exact",
      fileId,
      line: 1,
      symbol: `map.${name}`,
      detail: `Asset field ${name} is represented as ${typeText}.`,
    });
    return {
      id: `${fileId}::field:${name}`,
      name,
      typeText,
      optional: !(name in raw),
      readonly: false,
      description,
      evidenceIds: [evidenceId],
    };
  });

  const evidenceId = recorder.add({
    kind: "asset_definition",
    confidence: "exact",
    fileId,
    line: 1,
    symbol: "map",
    detail: "Checked-in world map asset loaded at server startup and fetched by the client.",
  });

  dataStructures.push({
    id: `asset:${fileId}`,
    name: "data/map.json",
    category: "disk_file",
    conceptGroup: inferConceptGroup(fileId, "data/map.json", "disk_file"),
    kind: "asset",
    sourceKind: "json",
    fileId,
    exported: false,
    canonical: true,
    componentIds: [],
    summary: "Checked-in world asset that defines map dimensions, tiles, activities, and spawn points.",
    purpose: "File-backed world data source.",
    fieldCount: fields.length,
    fields,
    variants: [],
    mirrorIds: [],
    badges: ["Asset"],
    evidenceIds: [evidenceId],
  });
}

function extractCharacterAsset(
  rootDir: string,
  sourceFiles: SourceFile[],
  dataStructures: DataStructure[],
  recorder: EvidenceRecorder,
): void {
  const fileId = "server/src/data/characters.ts";
  const sourceFile = sourceFiles.find((candidate) => relative(rootDir, candidate.getFilePath()) === fileId);
  if (!sourceFile) return;

  const charactersDecl = sourceFile.getVariableDeclaration("CHARACTERS");
  if (!charactersDecl) return;

  const evidenceId = recorder.add({
    kind: "asset_definition",
    confidence: "exact",
    fileId,
    line: charactersDecl.getStartLineNumber(),
    symbol: "CHARACTERS",
    detail: "NPC seed definitions used at startup to spawn the default town cast.",
  });

  dataStructures.push({
    id: `asset:${fileId}`,
    name: "CHARACTERS",
    category: "disk_file",
    conceptGroup: inferConceptGroup(fileId, "CHARACTERS", "disk_file"),
    kind: "asset",
    sourceKind: "ts",
    fileId,
    exported: true,
    canonical: true,
    componentIds: ["Bootstrap"],
    summary: "Repo-owned NPC seed list used to create the default non-player cast.",
    purpose: "Startup NPC seed data.",
    fieldCount: 1,
    fields: [
      {
        id: `${fileId}::field:entries`,
        name: "entries",
        typeText: "CharacterDef[]",
        optional: false,
        readonly: false,
        description: "Array of NPC seed definitions.",
        evidenceIds: [evidenceId],
      },
    ],
    variants: [],
    mirrorIds: [],
    badges: ["Asset"],
    evidenceIds: [evidenceId],
  });
}

function buildRelations(
  dataStructures: DataStructure[],
  structuresByName: Map<string, DataStructure[]>,
  runtimeStores: RuntimeStoreSeed[],
  recorder: EvidenceRecorder,
): DataStructureRelation[] {
  const relations: DataStructureRelation[] = [];
  const relationKeys = new Set<string>();
  const byId = new Map(dataStructures.map((structure) => [structure.id, structure]));

  const addRelation = (relation: DataStructureRelation) => {
    const key = `${relation.kind}:${relation.sourceId}:${relation.targetId}:${relation.label}`;
    if (relationKeys.has(key)) return;
    relationKeys.add(key);
    relations.push(relation);
  };

  for (const structure of dataStructures) {
    for (const field of structure.fields) {
      for (const refId of referencedIdsForField(field, structure.fileId, structuresByName)) {
        field.referencedStructureId ??= refId;
        addRelationFromField(structure, refId, field, addRelation, recorder);
      }
    }
    for (const variant of structure.variants) {
      for (const field of variant.fields) {
        for (const refId of referencedIdsForField(field, structure.fileId, structuresByName)) {
          field.referencedStructureId ??= refId;
          addRelationFromField(structure, refId, field, addRelation, recorder);
        }
      }
    }
  }

  for (const structure of dataStructures) {
    for (const mirrorId of structure.mirrorIds) {
      const evidenceId = recorder.add({
        kind: "mirror_detection",
        confidence: "derived",
        fileId: structure.fileId,
        symbol: structure.name,
        detail: `${structure.name} is mirrored in ${byId.get(mirrorId)?.fileId ?? mirrorId}.`,
      });
      addRelation({
        id: `relation:mirror:${structure.id}:${mirrorId}`,
        sourceId: structure.id,
        targetId: mirrorId,
        kind: "mirrors",
        label: "mirrors",
        reason: "Same conceptual structure appears in multiple source files.",
        confidence: "derived",
        evidenceIds: [evidenceId],
      });
    }
  }

  addNamedRelation("MapData", "asset:data/map.json", "loaded_from", "loaded from", "World data is loaded from the checked-in map asset.", dataStructures, structuresByName, addRelation, recorder);
  addNamedRelation("CharacterDef", "asset:server/src/data/characters.ts", "loaded_from", "loaded from", "Character seed definitions are loaded from the checked-in NPC list.", dataStructures, structuresByName, addRelation, recorder);

  const tableMapping: Record<string, string> = {
    Player: "players",
    Conversation: "conversations",
    Message: "messages",
    Memory: "memories",
    MemoryRow: "memories",
    GenerationRecord: "llm_generations",
    StoredGeneration: "llm_generations",
    GameEvent: "game_log",
  };

  for (const [structureName, tableName] of Object.entries(tableMapping)) {
    addNamedRelation(
      structureName,
      `table:${tableName}`,
      "persisted_as",
      "persisted as",
      `${structureName} is written to or reconstructed from ${tableName}.`,
      dataStructures,
      structuresByName,
      addRelation,
      recorder,
    );
  }

  for (const runtimeStore of runtimeStores) {
    for (const targetName of runtimeStore.targetNames) {
      const targetId = pickStructureIdForReference(targetName, runtimeStore.fileId, structuresByName);
      if (!targetId) continue;
      const evidenceId = recorder.add({
        kind: "runtime_store_relation",
        confidence: "derived",
        fileId: runtimeStore.fileId,
        symbol: runtimeStore.name,
        detail: `${runtimeStore.name} stores or indexes ${targetName}.`,
      });
      addRelation({
        id: `relation:${runtimeStore.isIndex ? "indexed" : "stored"}:${targetId}:${runtimeStore.structureId}`,
        sourceId: targetId,
        targetId: runtimeStore.structureId,
        kind: runtimeStore.isIndex ? "indexed_by" : "stored_in",
        label: runtimeStore.isIndex ? "indexed by" : "stored in",
        reason: runtimeStore.isIndex
          ? "Runtime index exists to speed up lookups."
          : "Runtime container holds instances in memory.",
        confidence: "derived",
        evidenceIds: [evidenceId],
      });
    }

    if (runtimeStore.name === "playerToConvo") {
      addNamedRelation(
        "Conversation",
        runtimeStore.structureId,
        "indexed_by",
        "indexed by",
        "Secondary player-to-conversation index for O(1) lookup.",
        dataStructures,
        structuresByName,
        addRelation,
        recorder,
      );
    }
  }

  return relations;
}

function addRelationFromField(
  structure: DataStructure,
  refId: string,
  field: DataStructureField,
  addRelation: (relation: DataStructureRelation) => void,
  recorder: EvidenceRecorder,
): void {
  const evidenceId = recorder.add({
    kind: "field_reference",
    confidence: "derived",
    fileId: structure.fileId,
    symbol: `${structure.name}.${field.name}`,
    detail: `${field.name} references ${refId.split("::").pop() ?? refId}.`,
  });

  if (structure.category === "transport") {
    addRelation({
      id: `relation:serialized:${refId}:${structure.id}:${field.id}`,
      sourceId: refId,
      targetId: structure.id,
      kind: "serialized_as",
      label: "serialized as",
      reason: `${field.name} carries this structure through a transport payload.`,
      confidence: "derived",
      evidenceIds: [evidenceId],
    });
    return;
  }

  addRelation({
    id: `relation:contains:${structure.id}:${refId}:${field.id}`,
    sourceId: structure.id,
    targetId: refId,
    kind: "contains",
    label: "contains",
    reason: `${field.name} nests or references this structure.`,
    confidence: "derived",
    evidenceIds: [evidenceId],
  });
}

function addNamedRelation(
  sourceName: string,
  targetId: string,
  kind: DataStructureRelation["kind"],
  label: string,
  reason: string,
  dataStructures: DataStructure[],
  structuresByName: Map<string, DataStructure[]>,
  addRelation: (relation: DataStructureRelation) => void,
  recorder: EvidenceRecorder,
): void {
  const sourceCandidates = structuresByName.get(sourceName) ?? [];
  const target = dataStructures.find((candidate) => candidate.id === targetId);
  if (!target) return;

  for (const source of sourceCandidates) {
    const evidenceId = recorder.add({
      kind: "named_relation",
      confidence: "derived",
      fileId: source.fileId,
      symbol: source.name,
      detail: `${source.name} ${label} ${target.name}.`,
    });
    addRelation({
      id: `relation:${kind}:${source.id}:${target.id}`,
      sourceId: source.id,
      targetId: target.id,
      kind,
      label,
      reason,
      confidence: "derived",
      evidenceIds: [evidenceId],
    });
  }
}

function buildAccesses(
  sourceFiles: SourceFile[],
  dataStructures: DataStructure[],
  structuresByName: Map<string, DataStructure[]>,
  runtimeStores: RuntimeStoreSeed[],
  recorder: EvidenceRecorder,
): DataStructureAccess[] {
  const accesses: DataStructureAccess[] = [];

  const rootGuess = commonRootForSourceFiles(sourceFiles);

  for (const sourceFile of sourceFiles) {
    const actorFileId = relative(rootGuess, sourceFile.getFilePath());
    for (const actor of getActorNodes(sourceFile)) {
      collectTypedAccesses(actor, actorFileId, structuresByName, accesses, recorder);
    }
  }

  for (const runtimeStore of runtimeStores) {
    const sourceFile = sourceFiles.find((candidate) => relative(rootGuess, candidate.getFilePath()) === runtimeStore.fileId);
    if (!sourceFile) continue;
    collectRuntimeStoreAccesses(sourceFile, runtimeStore, accesses, recorder);
  }

  return accesses.filter((access) => dataStructures.some((structure) => structure.id === access.structureId));
}

function collectTypedAccesses(
  actor: ActorNode,
  actorFileId: string,
  structuresByName: Map<string, DataStructure[]>,
  accesses: DataStructureAccess[],
  recorder: EvidenceRecorder,
): void {
  const actorName = getActorName(actor);
  const actorKind = Node.isFunctionDeclaration(actor) ? "function" : Node.isConstructorDeclaration(actor) ? "method" : "method";
  const lifecycle = inferLifecycle(actorFileId, actorName);

  for (const parameter of actor.getParameters()) {
    addAccessesForTypeText(
      parameter.getTypeNode()?.getText() ?? "",
      actorFileId,
      actorName,
      actorKind,
      lifecycle,
      inferParameterAccessKind(actorName),
      `Parameter ${parameter.getName()}.`,
      parameter.getStartLineNumber(),
      accesses,
      structuresByName,
      recorder,
    );
  }

  const returnTypeText = actor.getReturnTypeNode()?.getText() ?? "";
  addAccessesForTypeText(
    returnTypeText,
    actorFileId,
    actorName,
    actorKind,
    lifecycle,
    inferReturnAccessKind(actorName, returnTypeText),
    "Return type.",
    actor.getStartLineNumber(),
    accesses,
    structuresByName,
    recorder,
  );

  for (const declaration of actor.getDescendantsOfKind(SyntaxKind.VariableDeclaration)) {
    const typeText = declaration.getTypeNode()?.getText() ?? "";
    if (!typeText) continue;
    const initializerText = declaration.getInitializer()?.getText() ?? "";
    addAccessesForTypeText(
      typeText,
      actorFileId,
      actorName,
      actorKind,
      lifecycle,
      inferVariableAccessKind(initializerText, actorName),
      initializerText.includes("JSON.parse")
        ? "Deserialized local value."
        : "Local typed value.",
      declaration.getStartLineNumber(),
      accesses,
      structuresByName,
      recorder,
    );
  }
}

function collectRuntimeStoreAccesses(
  sourceFile: SourceFile,
  runtimeStore: RuntimeStoreSeed,
  accesses: DataStructureAccess[],
  recorder: EvidenceRecorder,
): void {
  const actors = runtimeStore.ownerClassName
    ? sourceFile
        .getClassOrThrow(runtimeStore.ownerClassName)
        .getMembers()
        .filter(
          (member): member is MethodDeclaration | ConstructorDeclaration =>
            Node.isMethodDeclaration(member) || Node.isConstructorDeclaration(member),
        )
    : [
        ...sourceFile.getFunctions(),
      ];

  for (const actor of actors) {
    const bodyText = actor.getText();
    if (!bodyText.includes(runtimeStore.receiverText)) continue;
    const actorName = getActorName(actor);
    const lifecycle = inferLifecycle(runtimeStore.fileId, actorName);
    const actorKind = "method";

    const checks: Array<{ token: string; kind: DataAccessKind; reason: string }> = [
      { token: `${runtimeStore.receiverText}.get(`, kind: runtimeStore.isIndex ? "index_lookup" : "lookup", reason: "Keyed lookup." },
      { token: `${runtimeStore.receiverText}.has(`, kind: runtimeStore.isIndex ? "index_lookup" : "lookup", reason: "Membership lookup." },
      { token: `${runtimeStore.receiverText}.set(`, kind: "write", reason: "Store write." },
      { token: `${runtimeStore.receiverText}.delete(`, kind: "remove", reason: "Store delete." },
      { token: `${runtimeStore.receiverText}.push(`, kind: "append", reason: "Append to runtime buffer." },
      { token: `${runtimeStore.receiverText}.pop(`, kind: "remove", reason: "Remove from runtime buffer." },
      { token: `${runtimeStore.receiverText}.shift(`, kind: "remove", reason: "Remove oldest buffered item." },
      { token: `${runtimeStore.receiverText}.splice(`, kind: "remove", reason: "Mutating array removal." },
      { token: `${runtimeStore.receiverText}.values(`, kind: "iterate", reason: "Iterates all stored values." },
      { token: `${runtimeStore.receiverText}.entries(`, kind: "iterate", reason: "Iterates stored entries." },
      { token: `${runtimeStore.receiverText}.keys(`, kind: "iterate", reason: "Iterates stored keys." },
      { token: `${runtimeStore.receiverText}.clear(`, kind: "remove", reason: "Clears stored values." },
    ];

    let matched = false;
    for (const check of checks) {
      if (!bodyText.includes(check.token)) continue;
      matched = true;
      const evidenceId = recorder.add({
        kind: "runtime_store_access",
        confidence: "exact",
        fileId: runtimeStore.fileId,
        line: actor.getStartLineNumber(),
        symbol: `${actorName}`,
        detail: `${actorName} uses ${check.token.replace("(", "")}.`,
      });
      accesses.push({
        id: `access:${runtimeStore.structureId}:${check.kind}:${actorName}:${check.token}`,
        structureId: runtimeStore.structureId,
        accessKind: check.kind,
        actorName,
        actorKind,
        actorFileId: runtimeStore.fileId,
        componentId: componentIdsForFile(runtimeStore.fileId)[0],
        accessPath: check.token.replace(`(`, ""),
        lifecycle,
        reason: check.reason,
        line: actor.getStartLineNumber(),
        confidence: "exact",
        evidenceIds: [evidenceId],
      });
    }

    if (!matched && bodyText.includes(runtimeStore.receiverText)) {
      const evidenceId = recorder.add({
        kind: "runtime_store_access",
        confidence: "derived",
        fileId: runtimeStore.fileId,
        line: actor.getStartLineNumber(),
        symbol: actorName,
        detail: `${actorName} touches ${runtimeStore.receiverText}.`,
      });
      accesses.push({
        id: `access:${runtimeStore.structureId}:read:${actorName}:touch`,
        structureId: runtimeStore.structureId,
        accessKind: "read",
        actorName,
        actorKind,
        actorFileId: runtimeStore.fileId,
        componentId: componentIdsForFile(runtimeStore.fileId)[0],
        lifecycle,
        reason: "Method touches the runtime store.",
        line: actor.getStartLineNumber(),
        confidence: "derived",
        evidenceIds: [evidenceId],
      });
    }
  }
}

function addAccessesForTypeText(
  rawTypeText: string,
  actorFileId: string,
  actorName: string,
  actorKind: "function" | "method",
  lifecycle: DataAccessLifecycle,
  accessKind: DataAccessKind,
  reason: string,
  line: number,
  accesses: DataStructureAccess[],
  structuresByName: Map<string, DataStructure[]>,
  recorder: EvidenceRecorder,
): void {
  const typeText = cleanTypeText(rawTypeText);
  if (!typeText) return;
  const referencedNames = extractTypeNames(typeText);
  for (const referencedName of referencedNames) {
    const structureId = pickStructureIdForReference(referencedName, actorFileId, structuresByName);
    if (!structureId) continue;
    const evidenceId = recorder.add({
      kind: "typed_access",
      confidence: "derived",
      fileId: actorFileId,
      line,
      symbol: actorName,
      detail: `${actorName} uses ${referencedName} in a typed signature.`,
    });
    accesses.push({
      id: `access:${structureId}:${accessKind}:${actorName}:${line}:${referencedName}`,
      structureId,
      accessKind,
      actorName,
      actorKind,
      actorFileId,
      componentId: componentIdsForFile(actorFileId)[0],
      lifecycle,
      reason,
      line,
      confidence: "derived",
      evidenceIds: [evidenceId],
    });
  }
}

function wireFieldReferences(
  dataStructures: DataStructure[],
  structuresByName: Map<string, DataStructure[]>,
): void {
  for (const structure of dataStructures) {
    for (const field of structure.fields) {
      const refId = pickFirstReferencedStructureId(field.typeText, structure.fileId, structuresByName);
      if (refId) field.referencedStructureId = refId;
    }
    for (const variant of structure.variants) {
      for (const field of variant.fields) {
        const refId = pickFirstReferencedStructureId(field.typeText, structure.fileId, structuresByName);
        if (refId) field.referencedStructureId = refId;
      }
    }
  }
}

function referencedIdsForField(
  field: DataStructureField,
  fileId: string,
  structuresByName: Map<string, DataStructure[]>,
): string[] {
  const ids: string[] = [];
  for (const name of extractTypeNames(field.typeText)) {
    const id = pickStructureIdForReference(name, fileId, structuresByName);
    if (id) ids.push(id);
  }
  return ids.filter((value, index, values) => values.indexOf(value) === index);
}

function groupStructuresByName(
  dataStructures: DataStructure[],
): Map<string, DataStructure[]> {
  const map = new Map<string, DataStructure[]>();
  for (const structure of dataStructures) {
    const group = map.get(structure.name) ?? [];
    group.push(structure);
    map.set(structure.name, group);
  }
  return map;
}

function applyMirrorMetadata(
  dataStructures: DataStructure[],
  structuresByName: Map<string, DataStructure[]>,
): void {
  for (const [name, candidates] of structuresByName) {
    void name;
    const mirrorable = candidates.filter((candidate) =>
      candidate.kind === "interface" || candidate.kind === "type_alias" || candidate.kind === "union",
    );
    if (mirrorable.length <= 1) continue;
    const sorted = [...mirrorable].sort((left, right) => mirrorPreference(right) - mirrorPreference(left));
    const canonicalId = sorted[0]?.id;
    for (const candidate of mirrorable) {
      candidate.canonical = candidate.id === canonicalId;
      candidate.mirrorIds = mirrorable.filter((other) => other.id !== candidate.id).map((other) => other.id);
      if (candidate.mirrorIds.length > 0 && !candidate.badges.includes("Mirrored")) {
        candidate.badges.push("Mirrored");
      }
    }
  }
}

function applyRelationBadges(
  dataStructures: DataStructure[],
  relations: DataStructureRelation[],
): void {
  const byId = new Map(dataStructures.map((structure) => [structure.id, structure]));
  for (const relation of relations) {
    const source = byId.get(relation.sourceId);
    const target = byId.get(relation.targetId);
    if (!source || !target) continue;
    if (relation.kind === "persisted_as" && !source.badges.includes("Persisted")) {
      source.badges.push("Persisted");
    }
    if (relation.kind === "loaded_from" && !source.badges.includes("Asset-backed")) {
      source.badges.push("Asset-backed");
    }
    if (relation.kind === "serialized_as" && !source.badges.includes("Transported")) {
      source.badges.push("Transported");
    }
    if ((relation.kind === "stored_in" || relation.kind === "indexed_by") && !target.badges.includes("Runtime")) {
      target.badges.push("Runtime");
    }
  }
}

function dedupeStructureAccesses(accesses: DataStructureAccess[]): void {
  const seen = new Set<string>();
  for (let index = accesses.length - 1; index >= 0; index--) {
    const access = accesses[index];
    const key = [
      access.structureId,
      access.accessKind,
      access.actorFileId,
      access.actorName ?? "",
      access.accessPath ?? "",
      access.line ?? 0,
    ].join("|");
    if (seen.has(key)) {
      accesses.splice(index, 1);
      continue;
    }
    seen.add(key);
  }
}

function categorizeStructure(
  fileId: string,
  name: string,
): DataStructureCategory {
  if (fileId.startsWith("server/src/debug/")) return "debug_test";
  if (fileId === "client/src/ui.ts") return "ui_view";
  if (fileId === "client/src/debugLog.ts") return "ui_view";
  if (fileId.startsWith("server/src/network/")) return "transport";
  if (fileId.startsWith("server/src/db/")) {
    if (DOMAIN_DB_ADJACENT_TYPE_NAMES.has(name)) return "domain";
    return "database";
  }
  if (fileId.startsWith("data/")) return "disk_file";
  if (fileId.startsWith("client/src/types.ts")) {
    if (TRANSPORT_TYPE_NAMES.has(name)) return "transport";
    return "domain";
  }
  if (PERSISTENCE_TYPE_NAMES.has(name)) return "database";
  return "domain";
}

function inferConceptGroup(
  fileId: string,
  name: string,
  category: DataStructureCategory,
): string {
  const lowerName = name.toLowerCase();

  if (category === "debug_test") return "debug_harness";
  if (category === "transport") return "client_server_transport";
  if (category === "database") {
    if (/memory|generation|llm/.test(lowerName)) return "npc_memory";
    if (/player|conversation|message/.test(lowerName)) return "live_state";
    return "database_schema";
  }
  if (category === "disk_file") return "repo_assets";
  if (category === "ui_view") return "ui_debug_views";
  if (category === "in_memory") {
    if (/player|heldkeys|input/.test(lowerName)) return "player_movement";
    if (/conversation|convo|message/.test(lowerName)) return "conversation";
    if (/memory|generation|runtime|runtimes/.test(lowerName) || fileId.includes("/npc/") || fileId.includes("/db/")) {
      return "npc_memory";
    }
    if (/event|buffer|log/.test(lowerName)) return "events_logging";
    if (fileId.includes("/debug/")) return "debug_harness";
    return "runtime_indexes";
  }
  if (category === "domain") {
    if (fileId.includes("/conversation") || /conversation|convo|message/.test(lowerName)) return "conversation";
    if (/player|position|orientation|activity|command|gameevent|tickresult|gamemode|tiletype|tile/.test(lowerName)) {
      return /tile|map|activity/.test(lowerName) ? "world_map" : "player_movement";
    }
    if (fileId.includes("/npc/") || /npc|memory|embed|generation|provider/.test(lowerName)) return "npc_memory";
    if (/map|tile|world|characterdef/.test(lowerName)) return "world_map";
    return "gameplay_misc";
  }
  return "general";
}

const TRANSPORT_TYPE_NAMES = new Set([
  "ClientMessage",
  "ServerMessage",
  "FullGameState",
  "MoveDirection",
]);

const PERSISTENCE_TYPE_NAMES = new Set([
  "MemoryRow",
  "GenerationRecord",
  "StoredGeneration",
]);

const DOMAIN_DB_ADJACENT_TYPE_NAMES = new Set([
  "Memory",
  "ScoredMemory",
]);

function isAssetBackedDeclaration(fileId: string, name: string): boolean {
  return fileId === "server/src/data/characters.ts" && name === "CHARACTERS";
}

function componentIdsForFile(fileId: string): string[] {
  const componentId = getComponentId(fileId);
  return componentId === "Other" ? [] : [componentId];
}

function summarizeNode(node: Node): string | undefined {
  if (Node.isJSDocable(node)) {
    const text = node
      .getJsDocs()
      .map((doc) => doc.getCommentText())
      .filter((value): value is string => typeof value === "string" && value.trim().length > 0)
      .join(" ")
      .replace(/\s+/g, " ")
      .trim();
    if (text) return text;
  }
  const leading = node
    .getLeadingCommentRanges()
    .map((range) => range.getText())
    .join(" ")
    .replace(/\/\*\*?/g, "")
    .replace(/\*\//g, "")
    .replace(/\*/g, "")
    .replace(/\s+/g, " ")
    .trim();
  return leading || undefined;
}

function firstSentence(text: string | undefined): string | undefined {
  if (!text) return undefined;
  const match = text.match(/(.+?[.!?])(?:\s|$)/);
  return (match?.[1] ?? text).trim();
}

function cleanTypeText(typeText: string): string {
  return typeText
    .replace(/import\([^)]+\)\./g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function isLikelyDataAlias(name: string, typeText: string): boolean {
  if (TRANSPORT_TYPE_NAMES.has(name)) return true;
  if (typeText.includes("|")) return true;
  if (typeText.startsWith("{")) return true;
  return /State$|Reason$|Type$|Request$|Response$/.test(name);
}

function looksLikeLiteralUnionText(typeText: string): boolean {
  return typeText.includes("|") && !typeText.includes("{");
}

function isInterestingRuntimeStore(typeText: string, name: string): boolean {
  if (/Map<|Set<|Record<|Array<|\[\]/.test(typeText)) return true;
  return /(buffer|events|messages|conversations|players|generations|memories|clientDebugEvents|playerToConvo|runtimes|clients)/i.test(name);
}

function looksLikeIndexStore(name: string, typeText: string): boolean {
  return /by|index|lookup|playerToConvo/i.test(name) || /Map<string, number>/.test(typeText);
}

function summarizeRuntimeStore(
  name: string,
  typeText: string,
  ownerClassName?: string,
): string {
  const owner = ownerClassName ? `${ownerClassName}.` : "";
  if (looksLikeIndexStore(name, typeText)) {
    return `${owner}${name} is an in-memory index backed by ${typeText}.`;
  }
  return `${owner}${name} is an in-memory runtime store backed by ${typeText}.`;
}

function extractTypeNames(typeText: string): string[] {
  const cleaned = cleanTypeText(typeText);
  const matches = cleaned.match(/\b[A-Z][A-Za-z0-9_]*\b/g) ?? [];
  return matches.filter((value, index, values) => values.indexOf(value) === index);
}

function pickFirstReferencedStructureId(
  typeText: string,
  fileId: string,
  structuresByName: Map<string, DataStructure[]>,
): string | undefined {
  for (const name of extractTypeNames(typeText)) {
    const id = pickStructureIdForReference(name, fileId, structuresByName);
    if (id) return id;
  }
  return undefined;
}

function pickStructureIdForReference(
  name: string,
  fileId: string,
  structuresByName: Map<string, DataStructure[]>,
): string | undefined {
  const candidates = structuresByName.get(name) ?? [];
  if (candidates.length === 0) return undefined;

  const preferred = [...candidates].sort((left, right) => {
    const leftScore = referencePreference(left, fileId);
    const rightScore = referencePreference(right, fileId);
    return rightScore - leftScore;
  });
  return preferred[0]?.id;
}

function referencePreference(
  structure: DataStructure,
  fileId: string,
): number {
  let score = structure.canonical ? 10 : 0;
  if (sameRepoSide(structure.fileId, fileId)) score += 8;
  if (structure.fileId === fileId) score += 12;
  if (structure.category === "in_memory") score -= 10;
  if (structure.category === "disk_file") score -= 4;
  if (structure.category === "debug_test") score -= 12;
  return score;
}

function sameRepoSide(
  left: string,
  right: string,
): boolean {
  return (left.startsWith("client/") && right.startsWith("client/"))
    || (left.startsWith("server/") && right.startsWith("server/"))
    || (left.startsWith("data/") && right.startsWith("data/"));
}

function mirrorPreference(structure: DataStructure): number {
  let score = 0;
  if (structure.fileId.startsWith("server/")) score += 10;
  if (structure.kind === "interface") score += 4;
  if (structure.kind === "union") score += 3;
  if (structure.category === "transport") score += 2;
  if (structure.category === "debug_test") score -= 20;
  return score;
}

function getActorNodes(sourceFile: SourceFile): ActorNode[] {
  const actors: ActorNode[] = [];
  actors.push(...sourceFile.getFunctions());
  for (const classDecl of sourceFile.getClasses()) {
    actors.push(...classDecl.getMethods());
    actors.push(...classDecl.getConstructors());
  }
  return actors;
}

function getActorName(actor: ActorNode): string {
  if (Node.isConstructorDeclaration(actor)) return "constructor";
  return actor.getName() ?? "<anonymous>";
}

function inferLifecycle(
  fileId: string,
  actorName: string,
): DataAccessLifecycle {
  if (fileId.includes("/debug/")) return "debug_only";
  if (fileId.includes(".test.")) return "test_only";
  if (/processTick|tick|onAfterTick|maybeInitiateConversations/.test(actorName)) return "tick_path";
  if (/onMessage|broadcastGameEvent|onConnection|handle|render|send|waitFor/.test(actorName)) return "event_driven";
  if (/create|build|constructor|load|init|start/.test(actorName)) return "startup";
  if (fileId.includes("/network/") || fileId.includes("/router")) return "request_path";
  return "unknown";
}

function inferParameterAccessKind(actorName: string): DataAccessKind {
  if (/get|find|resolve/.test(actorName)) return "lookup";
  return "read";
}

function inferReturnAccessKind(
  actorName: string,
  returnTypeText: string,
): DataAccessKind {
  if (!returnTypeText) return "read";
  if (/snapshot|clone/.test(actorName)) return "clone";
  if (/rowTo|parse|from/.test(actorName)) return "deserialize";
  if (/toPublic|build|format|send/.test(actorName)) return "serialize";
  if (/create|start|add|remember|build|resolve/.test(actorName)) return "create";
  return "read";
}

function inferVariableAccessKind(
  initializerText: string,
  actorName: string,
): DataAccessKind {
  if (initializerText.includes("JSON.parse")) return "deserialize";
  if (initializerText.includes("JSON.stringify")) return "serialize";
  if (initializerText.includes("structuredClone")) return "clone";
  if (initializerText.includes("{") || initializerText.includes("[") || /build|create|start|add|remember/.test(actorName)) {
    return "create";
  }
  return "read";
}

function isTopLevelDeclaration(declaration: VariableDeclaration): boolean {
  return Node.isVariableStatement(declaration.getParentOrThrow().getParentOrThrow());
}

function buildColumnDescription(column: string): string | undefined {
  const details: string[] = [];
  if (column.toUpperCase().includes("PRIMARY KEY")) details.push("primary key");
  if (column.toUpperCase().includes("REFERENCES")) details.push("foreign key");
  if (column.toUpperCase().includes("DEFAULT")) details.push("default value");
  return details.length > 0 ? details.join(", ") : undefined;
}

function commonRootForSourceFiles(sourceFiles: SourceFile[]): string {
  const first = sourceFiles[0]?.getFilePath();
  if (!first) return process.cwd();
  return resolve(first, "..", "..", "..");
}
