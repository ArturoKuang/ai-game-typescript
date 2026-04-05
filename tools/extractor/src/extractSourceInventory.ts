/**
 * Source-inventory pass for the architecture extractor.
 *
 * Audit note: this file owns the "what source exists?" step only:
 * - load server/client TypeScript projects
 * - enumerate source files and import edges
 * - extract declared classes/interfaces
 * - collect raw per-file module facts
 *
 * Higher-level runtime coupling, diagrams, and graph assembly stay in
 * `extract.ts` so the passes remain easy to audit independently.
 */
import {
  Node,
  Project,
  SyntaxKind,
  type ClassDeclaration,
  type InterfaceDeclaration,
  type SourceFile,
} from "ts-morph";
import { existsSync, readFileSync } from "node:fs";
import { relative, resolve } from "node:path";
import { getComponentId } from "./componentGrouper.js";
import type {
  ClassInfo,
  FieldInfo,
  FileNode,
  ImportEdge,
  MethodInfo,
  ModuleFact,
} from "./types.js";

const EXTRA_FILE_IDS = [
  "server/src/db/schema.sql",
  "data/map.json",
  "data/characters.ts",
];

export function createProjects(rootDir: string): SourceFile[] {
  const serverProject = new Project({
    tsConfigFilePath: resolve(rootDir, "server/tsconfig.json"),
    skipAddingFilesFromTsConfig: true,
  });
  serverProject.addSourceFilesAtPaths(resolve(rootDir, "server/src/**/*.ts"));

  const clientProject = new Project({
    tsConfigFilePath: resolve(rootDir, "client/tsconfig.json"),
    skipAddingFilesFromTsConfig: true,
  });
  clientProject.addSourceFilesAtPaths(resolve(rootDir, "client/src/**/*.ts"));

  return [...serverProject.getSourceFiles(), ...clientProject.getSourceFiles()];
}

export function extractFilesAndImports(
  rootDir: string,
  sourceFiles: SourceFile[],
): {
  files: FileNode[];
  imports: ImportEdge[];
} {
  const files: FileNode[] = [];
  const imports: ImportEdge[] = [];
  const sourceFileSet = new Set(sourceFiles.map((sf) => sf.getFilePath()));

  for (const sf of sourceFiles) {
    const absPath = sf.getFilePath();
    const relPath = relative(rootDir, absPath);
    const componentId = getComponentId(relPath);

    const classNames = [
      ...sf.getClasses().map((c) => c.getName()).filter(Boolean),
      ...sf.getInterfaces().map((i) => i.getName()).filter(Boolean),
    ] as string[];

    const exportNames = Array.from(sf.getExportedDeclarations().keys());

    files.push({
      id: relPath,
      componentId,
      classes: classNames,
      exports: exportNames,
      loc: sf.getEndLineNumber(),
    });

    for (const imp of sf.getImportDeclarations()) {
      const moduleFile = imp.getModuleSpecifierSourceFile();
      if (!moduleFile) continue;
      const targetAbs = moduleFile.getFilePath();
      if (!sourceFileSet.has(targetAbs)) continue;

      const targetRel = relative(rootDir, targetAbs);
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
      if (defaultImport) {
        symbols.push(defaultImport.getText());
      }

      imports.push({
        source: relPath,
        target: targetRel,
        symbols,
        ...(typeOnlySymbols.length > 0 ? { typeOnlySymbols } : {}),
      });
    }
  }

  for (const fileId of EXTRA_FILE_IDS) {
    const absPath = resolve(rootDir, fileId);
    if (!existsSync(absPath) || files.some((file) => file.id === fileId)) {
      continue;
    }
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

export function extractClasses(
  rootDir: string,
  sourceFiles: SourceFile[],
): ClassInfo[] {
  const classes: ClassInfo[] = [];

  for (const sf of sourceFiles) {
    const relPath = relative(rootDir, sf.getFilePath());
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
        implementsNames: cls.getImplements().map((impl) => impl.getText()),
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
        extendsName: iface.getExtends().map((ext) => ext.getText())[0],
      });
    }
  }

  return classes;
}

export function extractModuleFacts(
  rootDir: string,
  sourceFiles: SourceFile[],
): ModuleFact[] {
  const facts: ModuleFact[] = [];

  for (const sf of sourceFiles) {
    const relPath = relative(rootDir, sf.getFilePath());
    const routerPaths = { get: [] as string[], post: [] as string[] };
    const domElementIds: string[] = [];
    const windowGlobals: string[] = [];

    for (const call of sf.getDescendantsOfKind(SyntaxKind.CallExpression)) {
      const exprText = call.getExpression().getText();
      const [firstArg] = call.getArguments();

      if (
        exprText === "document.getElementById" &&
        firstArg &&
        Node.isStringLiteral(firstArg)
      ) {
        domElementIds.push(firstArg.getLiteralValue());
      }

      if (
        (exprText === "router.get" || exprText === "router.post") &&
        firstArg &&
        Node.isStringLiteral(firstArg)
      ) {
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
          .flatMap((clause) => {
            const expr = clause.getExpression();
            return expr ? [expr] : [];
          })
          .map((expr) =>
            Node.isStringLiteral(expr)
              ? expr.getLiteralValue()
              : expr.getText().replaceAll('"', ""),
          );

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
        .flatMap((statement) =>
          statement.getDeclarations().map((decl) => decl.getName()),
        ),
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

  const schemaPath = resolve(rootDir, "server", "src", "db", "schema.sql");
  const sqlText = readFileSync(schemaPath, "utf-8");
  const schemaTableMatches = [...sqlText.matchAll(/CREATE TABLE IF NOT EXISTS\s+([a-z_]+)/g)];
  facts.push({
    fileId: "server/src/db/schema.sql",
    topLevelVariables: [],
    functionVariables: [],
    exportedFunctions: [],
    domElementIds: [],
    windowGlobals: [],
    routerPaths: { get: [], post: [] },
    switchCases: [],
    sqlTables: schemaTableMatches.map((match) => match[1]),
    sqlFlags: [
      ...(sqlText.includes("vector(1536)") ? ["vector(1536)"] : []),
      ...(sqlText.toLowerCase().includes("ivfflat")
        ? ["IVFFlat memory index"]
        : []),
    ],
  });

  return facts;
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
    parameters: method.getParameters().map((param) => ({
      name: param.getName(),
      type: param.getType().getText(param) ?? "unknown",
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
    parameters: method.getParameters().map((param) => ({
      name: param.getName(),
      type: param.getType().getText(param) ?? "unknown",
    })),
    visibility: "public" as const,
    isAsync: false,
    loc: method.getEndLineNumber() - method.getStartLineNumber() + 1,
  }));
}

function getVisibility(node: {
  getScope?(): string;
}): "public" | "private" | "protected" {
  const scope = node.getScope?.();
  if (scope === "private") return "private";
  if (scope === "protected") return "protected";
  return "public";
}
