/**
 * Architecture extractor — reads TypeScript source and produces graph.json.
 *
 * Uses ts-morph (the TypeScript compiler API) to extract:
 * - Import graph (file → file edges with imported symbols)
 * - Class/interface declarations with fields, methods, visibility
 * - Event emissions (this.emit / this.logger_.log patterns)
 * - Event subscriptions (game.on / this.game.on patterns)
 * - Command enqueues (game.enqueue / this.game.enqueue patterns)
 * - Cross-component boundary classification
 */

import { SyntaxKind, Node, type SourceFile } from "ts-morph";
import { resolve, relative } from "node:path";
import { writeFileSync } from "node:fs";
import { getComponentDefs, type ComponentDef } from "./componentGrouper.js";
import { buildContainerDiagram } from "./buildContainerDiagram.js";
import { buildComponentDiagram } from "./buildComponentDiagram.js";
import { extractDataModel } from "./extractDataModel.js";
import { extractMessageFlows, extractMessageFlowGroups } from "./extractMessageFlows.js";
import { extractStateMachines } from "./extractStateMachines.js";
import { extractDependencyDiagram } from "./extractDependencies.js";
import {
  extractFileAccessFacts,
  extractHttpFacts,
  extractSqlOperations,
  extractTransportMessages,
} from "./extractRuntimeFacts.js";
import {
  createProjects,
  extractClasses,
  extractFilesAndImports,
  extractModuleFacts,
} from "./extractSourceInventory.js";
import type {
  ArchitectureGraph,
  BoundaryEdge,
  ClassInfo,
  CommandInfo,
  Component,
  ComponentInternal,
  EventInfo,
  FileAccessFact,
  FieldInfo,
  FileNode,
  HttpRequestFact,
  HttpRouteFact,
  ImportEdge,
  ModuleFact,
  SqlOperationFact,
  TransportMessageFact,
} from "./types.js";

const ROOT = resolve(import.meta.dirname, "..", "..", "..");
const OUTPUT = resolve(import.meta.dirname, "..", "graph.json");

// ---------------------------------------------------------------------------
// 4. Extract events (emit/subscribe) and commands (enqueue)
// ---------------------------------------------------------------------------

interface RawEventEmit {
  eventType: string;
  fileId: string;
  classId?: string;
  line: number;
}

interface RawEventSub {
  eventType: string;
  fileId: string;
  classId?: string;
  line: number;
}

interface RawCommand {
  commandType: string;
  fileId: string;
  classId?: string;
  line: number;
}

function extractEventsAndCommands(sourceFiles: SourceFile[]): {
  events: EventInfo[];
  commands: CommandInfo[];
} {
  const emits: RawEventEmit[] = [];
  const subs: RawEventSub[] = [];
  const cmds: RawCommand[] = [];

  for (const sf of sourceFiles) {
    const relPath = relative(ROOT, sf.getFilePath());
    const callExprs = sf.getDescendantsOfKind(SyntaxKind.CallExpression);

    for (const call of callExprs) {
      const expr = call.getExpression();
      const exprText = expr.getText();
      const enclosingClass = call.getFirstAncestorByKind(SyntaxKind.ClassDeclaration)?.getName();

      // --- Event emissions: this.emit({...type: "..."...}) ---
      if (exprText === "this.emit") {
        const typeStr = extractObjectTypeProperty(call);
        if (typeStr) {
          emits.push({
            eventType: typeStr,
            fileId: relPath,
            classId: enclosingClass,
            line: call.getStartLineNumber(),
          });
        }
      }

      // --- Event subscriptions: *.on("eventType", handler) ---
      if (exprText.endsWith(".on") && !exprText.endsWith("onConnection") && !exprText.endsWith("onmessage") && !exprText.endsWith("onopen") && !exprText.endsWith("onclose") && !exprText.endsWith("onerror")) {
        const args = call.getArguments();
        if (args.length >= 2) {
          const firstArg = args[0];
          if (Node.isStringLiteral(firstArg)) {
            subs.push({
              eventType: firstArg.getLiteralValue(),
              fileId: relPath,
              classId: enclosingClass,
              line: call.getStartLineNumber(),
            });
          }
        }
      }

      // --- onAfterTick subscriptions ---
      if (exprText.endsWith(".onAfterTick")) {
        subs.push({
          eventType: "tick_complete",
          fileId: relPath,
          classId: enclosingClass,
          line: call.getStartLineNumber(),
        });
      }

      // --- Command enqueues: *.enqueue({type: "...", ...}) ---
      if (exprText.endsWith(".enqueue")) {
        const typeStr = extractObjectTypeProperty(call);
        if (typeStr) {
          cmds.push({
            commandType: typeStr,
            fileId: relPath,
            classId: enclosingClass,
            line: call.getStartLineNumber(),
          });
        }
      }
    }
  }

  // Also scan for GameEvent object literals returned from conversation.ts processTick
  for (const sf of sourceFiles) {
    const relPath = relative(ROOT, sf.getFilePath());
    if (!relPath.includes("conversation")) continue;

    const objLiterals = sf.getDescendantsOfKind(SyntaxKind.ObjectLiteralExpression);
    for (const obj of objLiterals) {
      const typeProp = obj.getProperty("type");
      if (!typeProp || !Node.isPropertyAssignment(typeProp)) continue;
      const init = typeProp.getInitializer();
      if (!init || !Node.isStringLiteral(init)) continue;
      const eventType = init.getLiteralValue();
      if (!eventType.startsWith("convo_")) continue;

      const enclosingClass = obj.getFirstAncestorByKind(SyntaxKind.ClassDeclaration)?.getName();
      // Avoid duplicates — only add if this is inside a method returning GameEvent[]
      const enclosingMethod = obj.getFirstAncestorByKind(SyntaxKind.MethodDeclaration);
      if (enclosingMethod?.getName() === "processTick") {
        const exists = emits.some(
          (e) => e.eventType === eventType && e.fileId === relPath && e.classId === enclosingClass,
        );
        if (!exists) {
          emits.push({
            eventType,
            fileId: relPath,
            classId: enclosingClass,
            line: obj.getStartLineNumber(),
          });
        }
      }
    }
  }

  // Aggregate into EventInfo[]
  const eventMap = new Map<string, EventInfo>();
  for (const e of emits) {
    if (!eventMap.has(e.eventType)) {
      eventMap.set(e.eventType, { eventType: e.eventType, emitters: [], subscribers: [] });
    }
    const info = eventMap.get(e.eventType)!;
    if (!info.emitters.some((x) => x.fileId === e.fileId && x.line === e.line)) {
      info.emitters.push({ fileId: e.fileId, classId: e.classId, line: e.line });
    }
  }
  for (const s of subs) {
    if (!eventMap.has(s.eventType)) {
      eventMap.set(s.eventType, { eventType: s.eventType, emitters: [], subscribers: [] });
    }
    const info = eventMap.get(s.eventType)!;
    info.subscribers.push({ fileId: s.fileId, classId: s.classId, line: s.line });
  }

  // Wildcard subscribers receive all events
  const wildcardSubs = subs.filter((s) => s.eventType === "*");
  if (wildcardSubs.length > 0) {
    for (const info of eventMap.values()) {
      if (info.eventType === "*") continue;
      for (const ws of wildcardSubs) {
        if (!info.subscribers.some((x) => x.fileId === ws.fileId && x.line === ws.line)) {
          info.subscribers.push({ fileId: ws.fileId, classId: ws.classId, line: ws.line });
        }
      }
    }
  }

  // Aggregate into CommandInfo[]
  const cmdMap = new Map<string, CommandInfo>();
  const gameLoopFile = "server/src/engine/gameLoop.ts";
  for (const c of cmds) {
    if (!cmdMap.has(c.commandType)) {
      cmdMap.set(c.commandType, { commandType: c.commandType, producers: [], consumer: gameLoopFile });
    }
    cmdMap.get(c.commandType)!.producers.push({
      fileId: c.fileId,
      classId: c.classId,
      line: c.line,
    });
  }

  return {
    events: Array.from(eventMap.values()).filter((e) => e.eventType !== "*"),
    commands: Array.from(cmdMap.values()),
  };
}

/** Extract the string value of a `type` property from the first object argument of a call. */
function extractObjectTypeProperty(call: Node): string | undefined {
  const args = call.getChildrenOfKind(SyntaxKind.SyntaxList)[0]?.getChildren() ?? [];
  for (const arg of args) {
    if (!Node.isObjectLiteralExpression(arg)) continue;
    const typeProp = arg.getProperty("type");
    if (!typeProp || !Node.isPropertyAssignment(typeProp)) continue;
    const init = typeProp.getInitializer();
    if (init && Node.isStringLiteral(init)) {
      return init.getLiteralValue();
    }
  }
  return undefined;
}

// ---------------------------------------------------------------------------
// 5. Classify cross-component boundaries
// ---------------------------------------------------------------------------

const MUTATION_METHODS = new Set([
  "spawnPlayer", "removePlayer", "setPlayerTarget", "movePlayerDirection",
  "setPlayerInput", "setPlayerWaitingForResponse", "enqueue", "loadWorld",
  "reset", "startConversation", "endConversation", "acceptInvite",
  "declineInvite", "addMessage", "clear",
]);

function classifyBoundaries(
  files: FileNode[],
  imports: ImportEdge[],
  events: EventInfo[],
  commands: CommandInfo[],
): BoundaryEdge[] {
  const fileToComponent = new Map(files.map((f) => [f.id, f.componentId]));
  const boundaryMap = new Map<string, BoundaryEdge>();

  function getOrCreate(source: string, target: string): BoundaryEdge {
    const key = `${source}->${target}`;
    if (!boundaryMap.has(key)) {
      boundaryMap.set(key, {
        source,
        target,
        eventCount: 0,
        callCount: 0,
        mutationCount: 0,
        couplingType: "call",
        details: [],
      });
    }
    return boundaryMap.get(key)!;
  }

  // Event-based coupling
  for (const event of events) {
    for (const emitter of event.emitters) {
      for (const sub of event.subscribers) {
        const srcComp = fileToComponent.get(emitter.fileId);
        const tgtComp = fileToComponent.get(sub.fileId);
        if (!srcComp || !tgtComp || srcComp === tgtComp) continue;

        const edge = getOrCreate(srcComp, tgtComp);
        edge.eventCount++;
        edge.details.push({
          kind: "event",
          description: `event "${event.eventType}"`,
          sourceFile: emitter.fileId,
          targetFile: sub.fileId,
          line: sub.line,
        });
      }
    }
  }

  // Command-based coupling (producer → Engine)
  for (const cmd of commands) {
    for (const producer of cmd.producers) {
      const srcComp = fileToComponent.get(producer.fileId);
      const tgtComp = fileToComponent.get(cmd.consumer);
      if (!srcComp || !tgtComp || srcComp === tgtComp) continue;

      const edge = getOrCreate(srcComp, tgtComp);
      edge.mutationCount++;
      edge.details.push({
        kind: "mutation",
        description: `enqueue "${cmd.commandType}"`,
        sourceFile: producer.fileId,
        targetFile: cmd.consumer,
        line: producer.line,
      });
    }
  }

  // Import-based coupling (classify as call or mutation)
  for (const imp of imports) {
    const srcComp = fileToComponent.get(imp.source);
    const tgtComp = fileToComponent.get(imp.target);
    if (!srcComp || !tgtComp || srcComp === tgtComp) continue;

    for (const sym of imp.symbols) {
      const isMutation = MUTATION_METHODS.has(sym);
      const edge = getOrCreate(srcComp, tgtComp);
      if (isMutation) {
        edge.mutationCount++;
        edge.details.push({
          kind: "mutation",
          description: `imports ${sym}`,
          sourceFile: imp.source,
          targetFile: imp.target,
        });
      } else {
        edge.callCount++;
        edge.details.push({
          kind: "call",
          description: `imports ${sym}`,
          sourceFile: imp.source,
          targetFile: imp.target,
        });
      }
    }
  }

  // Deduplicate details and set coupling type
  for (const edge of boundaryMap.values()) {
    const seen = new Set<string>();
    edge.details = edge.details.filter((d) => {
      const key = `${d.kind}:${d.description}:${d.sourceFile}:${d.targetFile}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });

    if (edge.mutationCount > 0 && edge.eventCount > 0) {
      edge.couplingType = "mixed";
    } else if (edge.mutationCount > 0) {
      edge.couplingType = "mutation";
    } else if (edge.eventCount > 0) {
      edge.couplingType = "event";
    } else {
      edge.couplingType = "call";
    }
  }

  return Array.from(boundaryMap.values());
}

// ---------------------------------------------------------------------------
// 6. Detect internal component architecture (ownership, state, utilities)
// ---------------------------------------------------------------------------

/** Well-known class names in the codebase — used to detect ownership vs primitive fields */
function buildClassNameSet(allClasses: ClassInfo[]): Set<string> {
  return new Set(allClasses.filter((c) => c.kind === "class").map((c) => c.name));
}

/** Simple heuristic descriptions for common utility imports */
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

function extractComponentInternals(
  allClasses: ClassInfo[],
  imports: ImportEdge[],
  components: Component[],
): ComponentInternal[] {
  const classNames = buildClassNameSet(allClasses);
  const classMap = new Map(allClasses.map((c) => [c.name, c]));
  const internals: ComponentInternal[] = [];

  for (const comp of components) {
    // Get classes in this component
    const compClasses = allClasses.filter(
      (c) => c.componentId === comp.id && c.kind === "class",
    );
    if (compClasses.length === 0) {
      internals.push({
        componentId: comp.id,
        primaryClass: "",
        primaryState: [],
        ownedClasses: [],
        usedUtilities: [],
      });
      continue;
    }

    // Primary class: the one with the most methods (the coordinator/hub)
    const primary = compClasses.reduce((best, c) =>
      c.methods.length > best.methods.length ? c : best,
    );

    // Owned classes: primary's fields whose type is another class in this component
    const ownedClasses: ComponentInternal["ownedClasses"] = [];
    const ownedClassNames = new Set<string>();

    for (const field of primary.fields) {
      // Strip generics and nullability to get the base type name
      const baseType = field.type
        .replace(/\s*\|\s*null$/g, "")
        .replace(/<.*>$/g, "")
        .trim();

      const ownedCandidate = classMap.get(baseType);
      // Only count as "owned" if the class belongs to the SAME component
      if (classNames.has(baseType) && baseType !== primary.name && ownedCandidate?.componentId === comp.id) {
        ownedClassNames.add(baseType);
        const ownedClass = ownedCandidate;
        ownedClasses.push({
          name: baseType,
          fieldName: field.name,
          stateFields: (ownedClass?.fields ?? [])
            .filter((f) => f.visibility !== "private" || ownedClass?.componentId === comp.id)
            .slice(0, 6)
            .map((f) => ({
              name: f.name,
              type: f.type.length > 40 ? f.type.substring(0, 37) + "..." : f.type,
            })),
        });
      }
    }

    // Primary state: fields of the primary class that aren't owned classes
    const primaryState = primary.fields
      .filter((f) => {
        const baseType = f.type.replace(/\s*\|\s*null$/g, "").replace(/<.*>$/g, "").trim();
        return !classNames.has(baseType) || baseType === primary.name;
      })
      .filter((f) => !f.name.startsWith("_")) // skip truly internal bookkeeping
      .slice(0, 8)
      .map((f) => ({
        name: f.name,
        type: f.type.length > 50 ? f.type.substring(0, 47) + "..." : f.type,
      }));

    // Used utilities: functions/classes imported from within the component
    // that aren't stored as fields (used directly in method bodies)
    const usedUtilities: ComponentInternal["usedUtilities"] = [];
    const compFileIds = new Set(comp.fileIds);

    for (const imp of imports) {
      if (!compFileIds.has(imp.source) || !compFileIds.has(imp.target)) continue;
      // Only look at imports FROM the primary class's file
      const primaryFile = primary.fileId;
      if (imp.source !== primaryFile) continue;

      for (const sym of imp.symbols) {
        // Skip if it's an owned class, an interface, or the primary class itself
        if (ownedClassNames.has(sym)) continue;
        if (sym === primary.name) continue;
        // Skip type-only imports (interfaces, types)
        const symClass = classMap.get(sym);
        if (symClass && symClass.kind === "interface") continue;

        const purpose = UTILITY_PURPOSES[sym] ?? "";
        const sourceFile = imp.target.split("/").pop() ?? imp.target;
        usedUtilities.push({ name: sym, source: sourceFile, purpose });
      }
    }

    internals.push({
      componentId: comp.id,
      primaryClass: primary.name,
      primaryState,
      ownedClasses,
      usedUtilities,
    });
  }

  return internals;
}

// ---------------------------------------------------------------------------
// 7. Assemble and write
// ---------------------------------------------------------------------------

function buildComponents(files: FileNode[], componentDefs: ComponentDef[]): Component[] {
  const components: Component[] = [];
  const filesByComponent = new Map<string, FileNode[]>();

  for (const f of files) {
    if (!filesByComponent.has(f.componentId)) {
      filesByComponent.set(f.componentId, []);
    }
    filesByComponent.get(f.componentId)!.push(f);
  }

  for (const def of componentDefs) {
    const compFiles = filesByComponent.get(def.id) ?? [];
    if (compFiles.length === 0) continue;
    components.push({
      id: def.id,
      label: def.label,
      dirPattern: def.dirPattern,
      fileIds: compFiles.map((f) => f.id),
      color: def.color,
      totalLoc: compFiles.reduce((sum, f) => sum + f.loc, 0),
    });
  }

  return components;
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

console.log("Extracting architecture from", ROOT);
console.time("extraction");

const sourceFiles = createProjects(ROOT);
console.log(`  Loaded ${sourceFiles.length} source files`);

const { files, imports } = extractFilesAndImports(ROOT, sourceFiles);
console.log(`  Extracted ${files.length} files, ${imports.length} import edges`);

const classes = extractClasses(ROOT, sourceFiles);
console.log(`  Extracted ${classes.length} classes/interfaces`);

const moduleFacts = extractModuleFacts(ROOT, sourceFiles);
console.log(`  Extracted ${moduleFacts.length} module fact records`);

const { httpRoutes, httpRequests } = extractHttpFacts(ROOT, sourceFiles);
console.log(`  Extracted ${httpRoutes.length} HTTP routes and ${httpRequests.length} HTTP requests`);

const transportMessages = extractTransportMessages(ROOT, sourceFiles);
console.log(`  Extracted ${transportMessages.length} WebSocket transport message facts`);

const fileAccesses = extractFileAccessFacts(ROOT, sourceFiles);
console.log(`  Extracted ${fileAccesses.length} file access facts`);

const sqlOperations = extractSqlOperations(ROOT, sourceFiles);
console.log(`  Extracted ${sqlOperations.length} SQL operation facts`);

const { events, commands } = extractEventsAndCommands(sourceFiles);
console.log(`  Found ${events.length} event types, ${commands.length} command types`);

const boundaries = classifyBoundaries(files, imports, events, commands);
console.log(`  Classified ${boundaries.length} cross-component boundaries`);

const components = buildComponents(files, getComponentDefs());
console.log(`  Built ${components.length} components`);

const internals = extractComponentInternals(classes, imports, components);
console.log(`  Extracted internals for ${internals.filter((i) => i.primaryClass).length} components`);

const messageFlows = extractMessageFlows();
console.log(`  Defined ${messageFlows.length} message flows`);

const stateMachines = extractStateMachines();
console.log(`  Defined ${stateMachines.length} state machines`);

const messageFlowGroups = extractMessageFlowGroups();
console.log(`  Defined ${messageFlowGroups.length} message flow groups`);

const {
  dataStructures,
  dataStructureRelations,
  dataStructureAccesses,
  dataModelEvidence,
} = extractDataModel({
  rootDir: ROOT,
  sourceFiles,
});
console.log(`  Extracted ${dataStructures.length} data structures`);
console.log(`  Extracted ${dataStructureRelations.length} data structure relations`);
console.log(`  Extracted ${dataStructureAccesses.length} data structure access patterns`);

const componentDiagram = buildComponentDiagram({
  classes,
  moduleFacts,
  imports,
  events,
  commands,
  messageFlows,
  httpRoutes,
  httpRequests,
  fileAccesses,
  sqlOperations,
});
console.log(`  Built detailed component diagram with ${componentDiagram.cards.length} cards`);

const containerDiagram = buildContainerDiagram({
  rootDir: ROOT,
  files,
  components,
  componentDiagram,
  moduleFacts,
  httpRoutes,
  httpRequests,
  transportMessages,
  fileAccesses,
  sqlOperations,
});
console.log(`  Built container diagram with ${containerDiagram.containers.length} containers`);

const dependencyDiagram = await extractDependencyDiagram(ROOT, files);
console.log(`  Built dependency diagram: ${dependencyDiagram.modules.length} modules, ${dependencyDiagram.fileDeps.length} file deps, ${dependencyDiagram.cycles.length} cycles`);

const graph: ArchitectureGraph = {
  meta: {
    extractedAt: new Date().toISOString(),
    rootDir: ROOT,
    fileCount: files.length,
    classCount: classes.length,
    eventTypeCount: events.length,
    commandTypeCount: commands.length,
  },
  components,
  files,
  classes,
  moduleFacts,
  imports,
  events,
  commands,
  boundaries,
  internals,
  httpRoutes,
  httpRequests,
  transportMessages,
  fileAccesses,
  sqlOperations,
  messageFlows,
  messageFlowGroups,
  stateMachines,
  dataStructures,
  dataStructureRelations,
  dataStructureAccesses,
  dataModelEvidence,
  containerDiagram,
  componentDiagram,
  dependencyDiagram,
};

writeFileSync(OUTPUT, JSON.stringify(graph, null, 2));
console.timeEnd("extraction");
console.log(`Wrote ${OUTPUT}`);
