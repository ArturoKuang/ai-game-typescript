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

import { Project, SyntaxKind, Node, type SourceFile, type ClassDeclaration, type InterfaceDeclaration } from "ts-morph";
import { resolve, relative } from "node:path";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { getComponentId, getComponentDefs, type ComponentDef } from "./componentGrouper.js";
import { buildContainerDiagram } from "./buildContainerDiagram.js";
import { buildComponentDiagram } from "./buildComponentDiagram.js";
import { extractDataModel } from "./extractDataModel.js";
import { extractMessageFlows, extractMessageFlowGroups } from "./extractMessageFlows.js";
import { extractStateMachines } from "./extractStateMachines.js";
import { extractDependencyDiagram } from "./extractDependencies.js";
import type {
  ArchitectureGraph,
  BoundaryDetail,
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
  MethodInfo,
  ModuleFact,
  SqlOperationFact,
  TransportMessageFact,
} from "./types.js";

const ROOT = resolve(import.meta.dirname, "..", "..", "..");
const OUTPUT = resolve(import.meta.dirname, "..", "graph.json");
const EXTRA_FILE_IDS = [
  "server/src/db/schema.sql",
  "data/map.json",
  "data/characters.ts",
];

// ---------------------------------------------------------------------------
// 1. Create ts-morph projects
// ---------------------------------------------------------------------------

function createProjects(): SourceFile[] {
  const serverProject = new Project({
    tsConfigFilePath: resolve(ROOT, "server/tsconfig.json"),
    skipAddingFilesFromTsConfig: true,
  });
  serverProject.addSourceFilesAtPaths(resolve(ROOT, "server/src/**/*.ts"));

  const clientProject = new Project({
    tsConfigFilePath: resolve(ROOT, "client/tsconfig.json"),
    skipAddingFilesFromTsConfig: true,
  });
  clientProject.addSourceFilesAtPaths(resolve(ROOT, "client/src/**/*.ts"));

  return [...serverProject.getSourceFiles(), ...clientProject.getSourceFiles()];
}

// ---------------------------------------------------------------------------
// 2. Extract files and imports
// ---------------------------------------------------------------------------

function extractFilesAndImports(sourceFiles: SourceFile[]): {
  files: FileNode[];
  imports: ImportEdge[];
} {
  const files: FileNode[] = [];
  const imports: ImportEdge[] = [];
  const sourceFileSet = new Set(sourceFiles.map((sf) => sf.getFilePath()));

  for (const sf of sourceFiles) {
    const absPath = sf.getFilePath();
    const relPath = relative(ROOT, absPath);
    const componentId = getComponentId(relPath);

    const classNames = [
      ...sf.getClasses().map((c) => c.getName()).filter(Boolean),
      ...sf.getInterfaces().map((i) => i.getName()).filter(Boolean),
    ] as string[];

    const exportNames = sf
      .getExportedDeclarations()
      .keys()
      .toArray();

    files.push({
      id: relPath,
      componentId,
      classes: classNames,
      exports: exportNames,
      loc: sf.getEndLineNumber(),
    });

    // Extract import edges
    for (const imp of sf.getImportDeclarations()) {
      const moduleFile = imp.getModuleSpecifierSourceFile();
      if (!moduleFile) continue;
      const targetAbs = moduleFile.getFilePath();
      if (!sourceFileSet.has(targetAbs)) continue; // skip node_modules

      const targetRel = relative(ROOT, targetAbs);
      const symbols: string[] = [];
      const typeOnlySymbols: string[] = [];
      const isWholeTypeOnly = imp.isTypeOnly();
      for (const named of imp.getNamedImports()) {
        const name = named.getName();
        symbols.push(name);
        if (isWholeTypeOnly || named.isTypeOnly()) {
          typeOnlySymbols.push(name);
        }
      }
      const defaultImport = imp.getDefaultImport();
      if (defaultImport) symbols.push(defaultImport.getText());

      imports.push({
        source: relPath,
        target: targetRel,
        symbols,
        ...(typeOnlySymbols.length > 0 ? { typeOnlySymbols } : {}),
      });
    }
  }

  for (const fileId of EXTRA_FILE_IDS) {
    const absPath = resolve(ROOT, fileId);
    if (!existsSync(absPath) || files.some((file) => file.id === fileId)) continue;
    const lineCount = readFileSync(absPath, "utf-8").split(/\r?\n/).length;
    files.push({
      id: fileId,
      componentId: getComponentId(fileId),
      classes: [],
      exports: [],
      loc: lineCount,
    });
  }

  return { files, imports };
}

// ---------------------------------------------------------------------------
// 3. Extract classes and interfaces
// ---------------------------------------------------------------------------

function extractClasses(sourceFiles: SourceFile[]): ClassInfo[] {
  const classes: ClassInfo[] = [];

  for (const sf of sourceFiles) {
    const relPath = relative(ROOT, sf.getFilePath());
    const componentId = getComponentId(relPath);

    for (const cls of sf.getClasses()) {
      const name = cls.getName();
      if (!name) continue;
      classes.push({
        id: name,
        fileId: relPath,
        componentId,
        name,
        kind: "class",
        fields: extractFields(cls),
        methods: extractMethods(cls),
        implementsNames: cls.getImplements().map((i) => i.getText()),
        extendsName: cls.getExtends()?.getText(),
      });
    }

    for (const iface of sf.getInterfaces()) {
      const name = iface.getName();
      if (!name) continue;
      classes.push({
        id: name,
        fileId: relPath,
        componentId,
        name,
        kind: "interface",
        fields: extractInterfaceFields(iface),
        methods: extractInterfaceMethods(iface),
        implementsNames: [],
        extendsName: iface.getExtends().map((e) => e.getText())[0],
      });
    }
  }

  return classes;
}

function extractFields(cls: ClassDeclaration): FieldInfo[] {
  return cls.getProperties().map((prop) => ({
    name: prop.getName(),
    type: prop.getType().getText(prop) ?? "unknown",
    visibility: getVisibility(prop),
  }));
}

function extractInterfaceFields(iface: InterfaceDeclaration): FieldInfo[] {
  return iface.getProperties().map((prop) => ({
    name: prop.getName(),
    type: prop.getType().getText(prop) ?? "unknown",
    visibility: "public" as const,
  }));
}

function extractMethods(cls: ClassDeclaration): MethodInfo[] {
  return cls.getMethods().map((method) => ({
    name: method.getName(),
    returnType: method.getReturnType().getText(method) ?? "unknown",
    parameters: method.getParameters().map((p) => ({
      name: p.getName(),
      type: p.getType().getText(p) ?? "unknown",
    })),
    visibility: getVisibility(method),
    isAsync: method.isAsync(),
    loc: method.getEndLineNumber() - method.getStartLineNumber() + 1,
  }));
}

function extractInterfaceMethods(iface: InterfaceDeclaration): MethodInfo[] {
  return iface.getMethods().map((method) => ({
    name: method.getName(),
    returnType: method.getReturnType().getText(method) ?? "unknown",
    parameters: method.getParameters().map((p) => ({
      name: p.getName(),
      type: p.getType().getText(p) ?? "unknown",
    })),
    visibility: "public" as const,
    isAsync: false,
    loc: method.getEndLineNumber() - method.getStartLineNumber() + 1,
  }));
}

function getVisibility(node: { getScope?(): string }): "public" | "private" | "protected" {
  const scope = node.getScope?.();
  if (scope === "private") return "private";
  if (scope === "protected") return "protected";
  return "public";
}

// ---------------------------------------------------------------------------
// 3b. Extract raw per-file module facts
// ---------------------------------------------------------------------------

function extractModuleFacts(sourceFiles: SourceFile[]): ModuleFact[] {
  const facts: ModuleFact[] = [];

  for (const sf of sourceFiles) {
    const relPath = relative(ROOT, sf.getFilePath());
    const routerPaths = { get: [] as string[], post: [] as string[] };
    const domElementIds: string[] = [];
    const windowGlobals: string[] = [];

    for (const call of sf.getDescendantsOfKind(SyntaxKind.CallExpression)) {
      const exprText = call.getExpression().getText();
      const [firstArg] = call.getArguments();

      if (exprText === "document.getElementById" && firstArg && Node.isStringLiteral(firstArg)) {
        domElementIds.push(firstArg.getLiteralValue());
      }

      if ((exprText === "router.get" || exprText === "router.post") && firstArg && Node.isStringLiteral(firstArg)) {
        const route = firstArg.getLiteralValue().replace(/^\//, "");
        if (exprText === "router.get") routerPaths.get.push(route);
        else routerPaths.post.push(route);
      }
    }

    const fileText = sf.getFullText();
    for (const match of fileText.matchAll(/window\.(__[A-Z0-9_]+__)/g)) {
      windowGlobals.push(match[1]);
    }

    const switchCases: ModuleFact["switchCases"] = [];
    for (const cls of sf.getClasses()) {
      for (const method of cls.getMethods()) {
        const labels = method
          .getDescendantsOfKind(SyntaxKind.CaseClause)
          .map((clause) => clause.getExpression())
          .filter((expr): expr is Node => Boolean(expr))
          .map((expr) => (Node.isStringLiteral(expr) ? expr.getLiteralValue() : expr.getText().replaceAll('"', "")));

        if (labels.length > 0) {
          switchCases.push({
            className: cls.getName(),
            methodName: method.getName(),
            labels,
          });
        }
      }
    }

    facts.push({
      fileId: relPath,
      topLevelVariables: sf
        .getVariableStatements()
        .flatMap((statement) => statement.getDeclarations().map((decl) => decl.getName())),
      functionVariables: sf.getFunctions().map((fn) => ({
        functionName: fn.getName() ?? "<anonymous>",
        variableNames: fn
          .getDescendantsOfKind(SyntaxKind.VariableDeclaration)
          .map((decl) => decl.getName()),
      })),
      exportedFunctions: sf
        .getFunctions()
        .filter((fn) => fn.isExported())
        .map((fn) => fn.getName())
        .filter(Boolean) as string[],
      domElementIds: Array.from(new Set(domElementIds)),
      windowGlobals: Array.from(new Set(windowGlobals)),
      routerPaths: {
        get: Array.from(new Set(routerPaths.get)),
        post: Array.from(new Set(routerPaths.post)),
      },
      switchCases,
      sqlTables: [],
      sqlFlags: [],
    });
  }

  const schemaPath = resolve(ROOT, "server", "src", "db", "schema.sql");
  const sqlText = readFileSync(schemaPath, "utf-8");
  facts.push({
    fileId: "server/src/db/schema.sql",
    topLevelVariables: [],
    functionVariables: [],
    exportedFunctions: [],
    domElementIds: [],
    windowGlobals: [],
    routerPaths: { get: [], post: [] },
    switchCases: [],
    sqlTables: Array.from(
      sqlText.matchAll(/CREATE TABLE IF NOT EXISTS\s+([a-z_]+)/g),
      (match) => match[1],
    ),
    sqlFlags: [
      ...(sqlText.includes("vector(1536)") ? ["vector(1536)"] : []),
      ...(sqlText.toLowerCase().includes("ivfflat") ? ["IVFFlat memory index"] : []),
    ],
  });

  return facts;
}

// ---------------------------------------------------------------------------
// 3c. Extract transport, HTTP, file, and SQL facts
// ---------------------------------------------------------------------------

function extractHttpFacts(sourceFiles: SourceFile[]): {
  httpRoutes: HttpRouteFact[];
  httpRequests: HttpRequestFact[];
} {
  const httpRoutes: HttpRouteFact[] = [];
  const httpRequests: HttpRequestFact[] = [];

  for (const sf of sourceFiles) {
    const relPath = relative(ROOT, sf.getFilePath());

    for (const call of sf.getDescendantsOfKind(SyntaxKind.CallExpression)) {
      const exprText = call.getExpression().getText();
      const firstArg = call.getArguments()[0];
      const secondArg = call.getArguments()[1];

      if ((exprText === "router.get" || exprText === "router.post" || exprText === "app.get" || exprText === "app.post") &&
        firstArg &&
        Node.isStringLiteral(firstArg)) {
        httpRoutes.push({
          method: exprText.endsWith(".post") ? "POST" : "GET",
          path: firstArg.getLiteralValue(),
          fileId: relPath,
          line: call.getStartLineNumber(),
          ownerSymbol: getEnclosingSymbolName(call),
        });
      }

      if (exprText === "fetch" && firstArg && Node.isStringLiteral(firstArg)) {
        httpRequests.push({
          method: extractFetchMethod(secondArg),
          path: firstArg.getLiteralValue(),
          fileId: relPath,
          line: call.getStartLineNumber(),
          caller: getEnclosingSymbolName(call),
        });
      }
    }
  }

  return {
    httpRoutes: dedupeFacts(httpRoutes, (fact) => `${fact.method}:${fact.path}:${fact.fileId}:${fact.line}`),
    httpRequests: dedupeFacts(httpRequests, (fact) => `${fact.method}:${fact.path}:${fact.fileId}:${fact.line}`),
  };
}

function extractTransportMessages(sourceFiles: SourceFile[]): TransportMessageFact[] {
  const facts: TransportMessageFact[] = [];

  for (const sf of sourceFiles) {
    const relPath = relative(ROOT, sf.getFilePath());

    for (const call of sf.getDescendantsOfKind(SyntaxKind.CallExpression)) {
      const exprText = call.getExpression().getText();
      const messageType = extractCallObjectTypeProperty(call);
      if (!messageType) continue;

      if (relPath.startsWith("client/") && exprText.endsWith(".send")) {
        facts.push({
          channel: "websocket",
          direction: "client_to_server",
          messageType,
          fileId: relPath,
          line: call.getStartLineNumber(),
          symbol: exprText,
        });
      }

      if (relPath === "server/src/network/websocket.ts" && (exprText.includes("send") || exprText.includes("broadcast"))) {
        facts.push({
          channel: "websocket",
          direction: "server_to_client",
          messageType,
          fileId: relPath,
          line: call.getStartLineNumber(),
          symbol: exprText,
        });
      }
    }
  }

  return dedupeFacts(facts, (fact) => `${fact.direction}:${fact.messageType}:${fact.fileId}:${fact.line}`);
}

function extractFileAccessFacts(sourceFiles: SourceFile[]): FileAccessFact[] {
  const facts: FileAccessFact[] = [];

  for (const sf of sourceFiles) {
    const relPath = relative(ROOT, sf.getFilePath());

    for (const imp of sf.getImportDeclarations()) {
      const moduleFile = imp.getModuleSpecifierSourceFile();
      if (!moduleFile) continue;
      const targetRel = relative(ROOT, moduleFile.getFilePath());
      if (!targetRel.startsWith("server/src/data/")) continue;
      facts.push({
        kind: "import",
        fileId: relPath,
        line: imp.getStartLineNumber(),
        targetPath: targetRel,
        detail: `Imports seed data from ${targetRel}`,
      });
    }

    for (const call of sf.getDescendantsOfKind(SyntaxKind.CallExpression)) {
      const exprText = call.getExpression().getText();
      const firstArg = call.getArguments()[0];
      const firstArgText = firstArg ? simplifyCallArgument(firstArg) : "<unknown>";

      if (exprText === "readFileSync") {
        facts.push({
          kind: "read",
          fileId: relPath,
          line: call.getStartLineNumber(),
          targetPath: firstArgText,
          detail: `Reads file via readFileSync(${firstArgText})`,
        });
      }

      if (exprText === "existsSync") {
        facts.push({
          kind: "exists_check",
          fileId: relPath,
          line: call.getStartLineNumber(),
          targetPath: firstArgText,
          detail: `Checks file existence via existsSync(${firstArgText})`,
        });
      }

      if ((exprText === "app.get" || exprText === "router.get") && firstArg && Node.isStringLiteral(firstArg)) {
        const path = firstArg.getLiteralValue();
        if (path.startsWith("/data/")) {
          facts.push({
            kind: "static_serve",
            fileId: relPath,
            line: call.getStartLineNumber(),
            targetPath: path.replace(/^\//, ""),
            detail: `Serves static data from ${path}`,
          });
        }
      }
    }
  }

  return dedupeFacts(facts, (fact) => `${fact.kind}:${fact.targetPath}:${fact.fileId}:${fact.line}`);
}

function extractSqlOperations(sourceFiles: SourceFile[]): SqlOperationFact[] {
  const facts: SqlOperationFact[] = [];

  for (const sf of sourceFiles) {
    const relPath = relative(ROOT, sf.getFilePath());

    for (const call of sf.getDescendantsOfKind(SyntaxKind.CallExpression)) {
      const exprText = call.getExpression().getText();
      if (!exprText.endsWith(".query")) continue;

      const firstArg = call.getArguments()[0];
      if (!firstArg) continue;
      const sqlText = extractSqlText(firstArg);
      if (!sqlText) continue;

      const operation = detectSqlOperation(sqlText);
      const tables = extractSqlTables(sqlText);
      if (!operation || tables.length === 0) continue;

      facts.push({
        operation,
        tables,
        fileId: relPath,
        line: call.getStartLineNumber(),
        symbol: getEnclosingSymbolName(call),
        detail: `${operation.toUpperCase()} ${tables.join(", ")}`,
      });
    }
  }

  return dedupeFacts(facts, (fact) => `${fact.operation}:${fact.tables.join(",")}:${fact.fileId}:${fact.line}`);
}

function extractFetchMethod(arg: Node | undefined): "GET" | "POST" {
  if (!arg || !Node.isObjectLiteralExpression(arg)) return "GET";
  const methodProp = arg.getProperty("method");
  if (!methodProp || !Node.isPropertyAssignment(methodProp)) return "GET";
  const init = methodProp.getInitializer();
  if (!init || !Node.isStringLiteral(init)) return "GET";
  return init.getLiteralValue().toUpperCase() === "POST" ? "POST" : "GET";
}

function getEnclosingSymbolName(node: Node): string | undefined {
  const method = node.getFirstAncestorByKind(SyntaxKind.MethodDeclaration)?.getName();
  if (method) return method;
  const fn = node.getFirstAncestorByKind(SyntaxKind.FunctionDeclaration)?.getName();
  if (fn) return fn;
  const variable = node.getFirstAncestorByKind(SyntaxKind.VariableDeclaration)?.getName();
  if (variable) return variable;
  return undefined;
}

function simplifyCallArgument(node: Node): string {
  if (Node.isStringLiteral(node)) return node.getLiteralValue();
  if (Node.isNoSubstitutionTemplateLiteral(node)) return node.getLiteralText();
  return node.getText();
}

function extractCallObjectTypeProperty(call: Node): string | undefined {
  if (!Node.isCallExpression(call)) return undefined;
  for (const arg of call.getArguments()) {
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

function extractSqlText(node: Node): string | undefined {
  if (Node.isNoSubstitutionTemplateLiteral(node)) return node.getLiteralText();
  if (Node.isStringLiteral(node)) return node.getLiteralValue();
  if (Node.isTemplateExpression(node)) {
    return node.getHead().getLiteralText() + node.getTemplateSpans().map((span) => span.getLiteral().getLiteralText()).join(" ");
  }
  return undefined;
}

function detectSqlOperation(sqlText: string): SqlOperationFact["operation"] | undefined {
  const normalized = sqlText.trim().toUpperCase();
  if (normalized.startsWith("INSERT")) return "insert";
  if (normalized.startsWith("UPDATE")) return "update";
  if (normalized.startsWith("DELETE")) return "delete";
  if (normalized.startsWith("SELECT")) return "select";
  return undefined;
}

function extractSqlTables(sqlText: string): string[] {
  return Array.from(
    new Set(
      [...sqlText.matchAll(/(?:INSERT INTO|UPDATE|FROM|JOIN)\s+([a-z_]+)/gi)].map((match) => match[1]),
    ),
  );
}

function dedupeFacts<T>(items: T[], keyFn: (item: T) => string): T[] {
  const seen = new Set<string>();
  return items.filter((item) => {
    const key = keyFn(item);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

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

const sourceFiles = createProjects();
console.log(`  Loaded ${sourceFiles.length} source files`);

const { files, imports } = extractFilesAndImports(sourceFiles);
console.log(`  Extracted ${files.length} files, ${imports.length} import edges`);

const classes = extractClasses(sourceFiles);
console.log(`  Extracted ${classes.length} classes/interfaces`);

const moduleFacts = extractModuleFacts(sourceFiles);
console.log(`  Extracted ${moduleFacts.length} module fact records`);

const { httpRoutes, httpRequests } = extractHttpFacts(sourceFiles);
console.log(`  Extracted ${httpRoutes.length} HTTP routes and ${httpRequests.length} HTTP requests`);

const transportMessages = extractTransportMessages(sourceFiles);
console.log(`  Extracted ${transportMessages.length} WebSocket transport message facts`);

const fileAccesses = extractFileAccessFacts(sourceFiles);
console.log(`  Extracted ${fileAccesses.length} file access facts`);

const sqlOperations = extractSqlOperations(sourceFiles);
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
