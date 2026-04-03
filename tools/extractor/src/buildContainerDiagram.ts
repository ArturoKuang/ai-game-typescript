import { existsSync } from "node:fs";
import { resolve } from "node:path";
import {
  CONTAINER_SYSTEM,
  DECLARED_CONTAINERS,
  EXPECTED_RELATIONSHIPS,
  type DeclaredContainerDef,
  type DeclaredRelationshipDef,
} from "./containerModel.js";
import type {
  Component,
  ComponentDiagram,
  ContainerDiagram,
  ContainerDiagramContainer,
  ContainerDiagramEvidence,
  ContainerDiagramRelationship,
  FileAccessFact,
  FileNode,
  HttpRequestFact,
  HttpRouteFact,
  ModuleFact,
  SqlOperationFact,
  TransportMessageFact,
} from "./types.js";

interface BuildContainerDiagramInput {
  rootDir: string;
  files: FileNode[];
  components: Component[];
  componentDiagram: ComponentDiagram;
  moduleFacts: ModuleFact[];
  httpRoutes: HttpRouteFact[];
  httpRequests: HttpRequestFact[];
  transportMessages: TransportMessageFact[];
  fileAccesses: FileAccessFact[];
  sqlOperations: SqlOperationFact[];
}

interface EvidenceDraft {
  kind: string;
  confidence: "exact" | "derived" | "declared";
  fileId?: string;
  line?: number;
  symbol?: string;
  detail: string;
}

class EvidenceBuilder {
  private nextId = 1;
  readonly evidence: ContainerDiagramEvidence[] = [];

  add(draft: EvidenceDraft): string {
    const id = `container-evidence-${this.nextId++}`;
    this.evidence.push({ id, ...draft });
    return id;
  }

  addMany(drafts: EvidenceDraft[]): string[] {
    return drafts.map((draft) => this.add(draft));
  }
}

export function buildContainerDiagram(
  input: BuildContainerDiagramInput,
): ContainerDiagram {
  validateContainerModel(input);
  const evidenceBuilder = new EvidenceBuilder();

  const containers = DECLARED_CONTAINERS.map((def) =>
    buildContainer(def, input, evidenceBuilder),
  );
  const relationships = EXPECTED_RELATIONSHIPS.map((def) =>
    buildRelationship(def, input, evidenceBuilder),
  );

  return {
    system: CONTAINER_SYSTEM,
    containers,
    relationships,
    evidence: evidenceBuilder.evidence,
  };
}

function buildContainer(
  def: DeclaredContainerDef,
  input: BuildContainerDiagramInput,
  evidenceBuilder: EvidenceBuilder,
): ContainerDiagramContainer {
  const fileIds = resolveCodePaths(def.codePaths, input.files, input.rootDir);
  const evidenceIds = containerEvidence(def, input, evidenceBuilder);

  return {
    id: def.id,
    kind: def.kind,
    name: def.name,
    technology: def.technology,
    description: def.description,
    responsibilities: def.responsibilities,
    color: def.color,
    position: def.position,
    size: def.size,
    codePaths: def.codePaths,
    componentTargets: def.componentTargets,
    fileIds,
    badges: def.badges,
    summary: def.summary,
    evidenceIds,
    openNext: def.openNext,
  };
}

function buildRelationship(
  def: DeclaredRelationshipDef,
  input: BuildContainerDiagramInput,
  evidenceBuilder: EvidenceBuilder,
): ContainerDiagramRelationship {
  const evidenceDrafts = relationshipEvidence(def, input);
  if (evidenceDrafts.length === 0) {
    throw new Error(
      `Container relationship ${def.id} (${def.source} -> ${def.target}) has no supporting evidence`,
    );
  }

  return {
    id: def.id,
    source: def.source,
    target: def.target,
    description: def.description,
    technology: def.technology,
    confidence: evidenceDrafts.every((draft) => draft.confidence === "exact")
      ? "exact"
      : evidenceDrafts.some((draft) => draft.confidence === "derived")
        ? "derived"
        : "declared",
    optional: def.optional,
    synchronous: def.synchronous,
    evidenceIds: evidenceBuilder.addMany(evidenceDrafts),
  };
}

function containerEvidence(
  def: DeclaredContainerDef,
  input: BuildContainerDiagramInput,
  evidenceBuilder: EvidenceBuilder,
): string[] {
  switch (def.id) {
    case "container-browser-client":
      return evidenceBuilder.addMany([
        {
          kind: "container_bootstrap",
          confidence: "exact",
          fileId: "client/src/main.ts",
          detail: "main.ts initializes renderer, fetches map/debug data, and connects the WebSocket client.",
        },
        {
          kind: "container_transport",
          confidence: "exact",
          fileId: "client/src/network.ts",
          detail: "GameClient opens a browser WebSocket connection to the game server.",
        },
      ]);
    case "container-game-server":
      return evidenceBuilder.addMany([
        {
          kind: "container_bootstrap",
          confidence: "exact",
          fileId: "server/src/index.ts",
          detail: "index.ts wires the Express app, GameLoop, NPC stack, debug router, and WebSocket server.",
        },
        {
          kind: "container_transport",
          confidence: "exact",
          fileId: "server/src/network/websocket.ts",
          detail: "GameWebSocketServer translates browser messages into engine actions and sends server messages back out.",
        },
        {
          kind: "container_debug",
          confidence: "exact",
          fileId: "server/src/debug/router.ts",
          detail: "Debug router exposes HTTP read/control surfaces for local inspection and mutation.",
        },
      ]);
    case "container-postgres": {
      const schemaFact = input.moduleFacts.find(
        (fact) => fact.fileId === "server/src/db/schema.sql",
      );
      const drafts: EvidenceDraft[] = [
        {
          kind: "datastore_schema",
          confidence: "exact",
          fileId: "server/src/db/schema.sql",
          detail: "schema.sql defines the persistent tables and indexes for the datastore.",
        },
      ];
      if (schemaFact?.sqlTables.length) {
        drafts.push({
          kind: "datastore_tables",
          confidence: "derived",
          fileId: "server/src/db/schema.sql",
          detail: `Schema defines tables: ${schemaFact.sqlTables.join(", ")}.`,
        });
      }
      if (schemaFact?.sqlFlags.length) {
        drafts.push({
          kind: "datastore_capability",
          confidence: "derived",
          fileId: "server/src/db/schema.sql",
          detail: `Schema flags: ${schemaFact.sqlFlags.join(", ")}.`,
        });
      }
      return evidenceBuilder.addMany(drafts);
    }
    case "container-world-data":
      return evidenceBuilder.addMany([
        {
          kind: "datastore_artifact",
          confidence: "exact",
          fileId: "data/map.json",
          detail: "map.json stores world geometry, activities, and spawn points.",
        },
        {
          kind: "datastore_artifact",
          confidence: "exact",
          fileId: "data/characters.ts",
          detail: "Shared characters.ts stores default NPC seed data in the repo root.",
        },
        {
          kind: "datastore_artifact",
          confidence: "exact",
          fileId: "server/src/data/characters.ts",
          detail: "Server-local characters.ts is the seed file imported by the runtime at startup.",
        },
      ]);
    default:
      return [];
  }
}

function relationshipEvidence(
  def: DeclaredRelationshipDef,
  input: BuildContainerDiagramInput,
): EvidenceDraft[] {
  switch (def.id) {
    case "container-rel-browser-server":
      return browserToServerEvidence(input);
    case "container-rel-server-postgres":
      return serverToPostgresEvidence(input);
    case "container-rel-server-world-data":
      return serverToWorldDataEvidence(input);
    default:
      return [];
  }
}

function browserToServerEvidence(
  input: BuildContainerDiagramInput,
): EvidenceDraft[] {
  const outboundMessages = input.transportMessages
    .filter(
      (fact) =>
        fact.direction === "client_to_server" && fact.fileId.startsWith("client/"),
    )
    .sort((a, b) => a.messageType.localeCompare(b.messageType));
  const inboundMessages = input.transportMessages
    .filter(
      (fact) =>
        fact.direction === "server_to_client" &&
        fact.fileId === "server/src/network/websocket.ts",
    )
    .sort((a, b) => a.messageType.localeCompare(b.messageType));
  const httpRequests = input.httpRequests
    .filter(
      (fact) =>
        fact.fileId.startsWith("client/") &&
        (fact.path.startsWith("/api/") || fact.path.startsWith("/data/")),
    )
    .sort((a, b) => a.path.localeCompare(b.path));

  const matchingRoutes = input.httpRoutes
    .filter((route) => httpRequests.some((request) => request.path === route.path))
    .sort((a, b) => a.path.localeCompare(b.path));

  return [
    ...outboundMessages.map((fact) => ({
      kind: "websocket_outbound",
      confidence: "exact" as const,
      fileId: fact.fileId,
      line: fact.line,
      symbol: fact.symbol,
      detail: `Browser sends WebSocket message "${fact.messageType}".`,
    })),
    ...inboundMessages.map((fact) => ({
      kind: "websocket_inbound",
      confidence: "exact" as const,
      fileId: fact.fileId,
      line: fact.line,
      symbol: fact.symbol,
      detail: `Game server emits WebSocket message "${fact.messageType}".`,
    })),
    ...httpRequests.map((fact) => ({
      kind: "http_request",
      confidence: "exact" as const,
      fileId: fact.fileId,
      line: fact.line,
      symbol: fact.caller,
      detail: `Browser fetches ${fact.method} ${fact.path}.`,
    })),
    ...matchingRoutes.map((fact) => ({
      kind: "http_route",
      confidence: "exact" as const,
      fileId: fact.fileId,
      line: fact.line,
      symbol: fact.ownerSymbol,
      detail: `Game server exposes ${fact.method} ${fact.path}.`,
    })),
  ];
}

function serverToPostgresEvidence(
  input: BuildContainerDiagramInput,
): EvidenceDraft[] {
  return input.sqlOperations
    .filter((fact) => fact.fileId.startsWith("server/src/db/"))
    .map((fact) => ({
      kind: "sql_operation",
      confidence: "exact" as const,
      fileId: fact.fileId,
      line: fact.line,
      symbol: fact.symbol,
      detail: `Database layer performs ${fact.detail}.`,
    }));
}

function serverToWorldDataEvidence(
  input: BuildContainerDiagramInput,
): EvidenceDraft[] {
  return input.fileAccesses
    .filter((fact) => {
      if (fact.fileId !== "server/src/index.ts") return false;
      if (fact.kind === "import" && fact.targetPath === "server/src/data/characters.ts") return true;
      if (fact.kind === "static_serve" && fact.targetPath === "data/map.json") return true;
      if ((fact.kind === "read" || fact.kind === "exists_check") && (fact.targetPath.includes("mapPath") || fact.targetPath.includes("candidate"))) {
        return true;
      }
      return false;
    })
    .map((fact) => ({
      kind: "file_access",
      confidence: "exact" as const,
      fileId: fact.fileId,
      line: fact.line,
      detail: fact.detail,
    }));
}

function validateContainerModel(input: BuildContainerDiagramInput): void {
  const componentIds = new Set(input.components.map((component) => component.id));
  const boundaryIds = new Set(input.componentDiagram.boundaries.map((boundary) => boundary.id));
  const cardIds = new Set(input.componentDiagram.cards.map((card) => card.id));
  const knownFileIds = new Set(input.files.map((file) => file.id));

  for (const container of DECLARED_CONTAINERS) {
    for (const pattern of container.codePaths) {
      const matches = resolvePatternMatches(pattern, input.files, input.rootDir);
      if (matches.length === 0) {
        throw new Error(`Container ${container.id} path pattern "${pattern}" matched no files`);
      }
    }

    for (const componentId of container.requiredComponentIds ?? []) {
      if (!componentIds.has(componentId)) {
        throw new Error(`Container ${container.id} expected component ${componentId}, but it was not extracted`);
      }
    }

    for (const requiredPath of container.requiredPaths ?? []) {
      if (!existsSync(resolve(input.rootDir, requiredPath))) {
        throw new Error(`Container ${container.id} required path ${requiredPath}, but it does not exist`);
      }
    }

    for (const target of container.componentTargets ?? []) {
      const exists = target.kind === "boundary" ? boundaryIds.has(target.id) : cardIds.has(target.id);
      if (!exists) {
        throw new Error(`Container ${container.id} targets missing component ${target.id}`);
      }
    }

    for (const target of container.openNext ?? []) {
      switch (target.target.kind) {
        case "component_boundary":
          if (!boundaryIds.has(target.target.boundaryId)) {
            throw new Error(`Container ${container.id} openNext references missing boundary ${target.target.boundaryId}`);
          }
          break;
        case "component_card":
          if (!cardIds.has(target.target.cardId)) {
            throw new Error(`Container ${container.id} openNext references missing card ${target.target.cardId}`);
          }
          break;
        case "file":
          if (!knownFileIds.has(target.target.fileId) && !existsSync(resolve(input.rootDir, target.target.fileId))) {
            throw new Error(`Container ${container.id} openNext references missing file ${target.target.fileId}`);
          }
          break;
        case "flow":
          break;
      }
    }
  }
}

function resolveCodePaths(
  patterns: string[],
  files: FileNode[],
  rootDir: string,
): string[] {
  const resolved = new Set<string>();

  for (const pattern of patterns) {
    for (const match of resolvePatternMatches(pattern, files, rootDir)) {
      resolved.add(match);
    }
  }

  return Array.from(resolved).sort();
}

function resolvePatternMatches(
  pattern: string,
  files: FileNode[],
  rootDir: string,
): string[] {
  if (pattern.endsWith("/*")) {
    const prefix = pattern.slice(0, -1);
    return files
      .map((file) => file.id)
      .filter((fileId) => fileId.startsWith(prefix))
      .sort();
  }

  if (existsSync(resolve(rootDir, pattern))) {
    return [pattern];
  }

  return files
    .map((file) => file.id)
    .filter((fileId) => fileId === pattern)
    .sort();
}
