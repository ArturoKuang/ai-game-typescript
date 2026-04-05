/**
 * Runtime-fact pass for the architecture extractor.
 *
 * Audit note: this pass only scans source text for transport, HTTP, file I/O,
 * and SQL evidence. It does not assemble higher-level boundaries or diagrams.
 */
import { Node, SyntaxKind, type SourceFile } from "ts-morph";
import { relative } from "node:path";
import type {
  FileAccessFact,
  HttpRequestFact,
  HttpRouteFact,
  SqlOperationFact,
  TransportMessageFact,
} from "./types.js";

export function extractHttpFacts(
  rootDir: string,
  sourceFiles: SourceFile[],
): {
  httpRoutes: HttpRouteFact[];
  httpRequests: HttpRequestFact[];
} {
  const httpRoutes: HttpRouteFact[] = [];
  const httpRequests: HttpRequestFact[] = [];

  for (const sf of sourceFiles) {
    const relPath = relative(rootDir, sf.getFilePath());

    for (const call of sf.getDescendantsOfKind(SyntaxKind.CallExpression)) {
      const exprText = call.getExpression().getText();
      const firstArg = call.getArguments()[0];
      const secondArg = call.getArguments()[1];

      if (
        (exprText === "router.get" ||
          exprText === "router.post" ||
          exprText === "app.get" ||
          exprText === "app.post") &&
        firstArg &&
        Node.isStringLiteral(firstArg)
      ) {
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
    httpRoutes: dedupeFacts(
      httpRoutes,
      (fact) => `${fact.method}:${fact.path}:${fact.fileId}:${fact.line}`,
    ),
    httpRequests: dedupeFacts(
      httpRequests,
      (fact) => `${fact.method}:${fact.path}:${fact.fileId}:${fact.line}`,
    ),
  };
}

export function extractTransportMessages(
  rootDir: string,
  sourceFiles: SourceFile[],
): TransportMessageFact[] {
  const facts: TransportMessageFact[] = [];

  for (const sf of sourceFiles) {
    const relPath = relative(rootDir, sf.getFilePath());

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

      if (
        relPath === "server/src/network/websocket.ts" &&
        (exprText.includes("send") || exprText.includes("broadcast"))
      ) {
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

  return dedupeFacts(
    facts,
    (fact) =>
      `${fact.direction}:${fact.messageType}:${fact.fileId}:${fact.line}`,
  );
}

export function extractFileAccessFacts(
  rootDir: string,
  sourceFiles: SourceFile[],
): FileAccessFact[] {
  const facts: FileAccessFact[] = [];

  for (const sf of sourceFiles) {
    const relPath = relative(rootDir, sf.getFilePath());

    for (const imp of sf.getImportDeclarations()) {
      const moduleFile = imp.getModuleSpecifierSourceFile();
      if (!moduleFile) continue;
      const targetRel = relative(rootDir, moduleFile.getFilePath());
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
      const firstArgText = firstArg
        ? simplifyCallArgument(firstArg)
        : "<unknown>";

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

      if (
        (exprText === "app.get" || exprText === "router.get") &&
        firstArg &&
        Node.isStringLiteral(firstArg)
      ) {
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

  return dedupeFacts(
    facts,
    (fact) => `${fact.kind}:${fact.targetPath}:${fact.fileId}:${fact.line}`,
  );
}

export function extractSqlOperations(
  rootDir: string,
  sourceFiles: SourceFile[],
): SqlOperationFact[] {
  const facts: SqlOperationFact[] = [];

  for (const sf of sourceFiles) {
    const relPath = relative(rootDir, sf.getFilePath());

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

  return dedupeFacts(
    facts,
    (fact) =>
      `${fact.operation}:${fact.tables.join(",")}:${fact.fileId}:${fact.line}`,
  );
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
  const method = node
    .getFirstAncestorByKind(SyntaxKind.MethodDeclaration)
    ?.getName();
  if (method) return method;
  const fn = node
    .getFirstAncestorByKind(SyntaxKind.FunctionDeclaration)
    ?.getName();
  if (fn) return fn;
  const variable = node
    .getFirstAncestorByKind(SyntaxKind.VariableDeclaration)
    ?.getName();
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
    return (
      node.getHead().getLiteralText() +
      node
        .getTemplateSpans()
        .map((span) => span.getLiteral().getLiteralText())
        .join(" ")
    );
  }
  return undefined;
}

function detectSqlOperation(
  sqlText: string,
): SqlOperationFact["operation"] | undefined {
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
      [...sqlText.matchAll(/(?:INSERT INTO|UPDATE|FROM|JOIN)\s+([a-z_]+)/gi)]
        .map((match) => match[1]),
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
