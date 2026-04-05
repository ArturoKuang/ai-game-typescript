/**
 * Event and command discovery pass for the architecture extractor.
 *
 * Audit note: this is the one extractor pass that intentionally knows about
 * runtime semantics such as `.emit`, `.on`, `.onAfterTick`, and `.enqueue`.
 * Keep those heuristics here so the orchestration file does not hide them.
 */
import { Node, SyntaxKind, type SourceFile } from "ts-morph";
import { relative } from "node:path";
import type { CommandInfo, EventInfo } from "./types.js";

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

const GAME_LOOP_FILE = "server/src/engine/gameLoop.ts";

export function extractEventsAndCommands(
  rootDir: string,
  sourceFiles: SourceFile[],
): {
  events: EventInfo[];
  commands: CommandInfo[];
} {
  const emits: RawEventEmit[] = [];
  const subs: RawEventSub[] = [];
  const cmds: RawCommand[] = [];

  for (const sf of sourceFiles) {
    const relPath = relative(rootDir, sf.getFilePath());
    const callExprs = sf.getDescendantsOfKind(SyntaxKind.CallExpression);

    for (const call of callExprs) {
      const exprText = call.getExpression().getText();
      const enclosingClass = call
        .getFirstAncestorByKind(SyntaxKind.ClassDeclaration)
        ?.getName();

      if (exprText === "this.emit") {
        const eventType = extractObjectTypeProperty(call);
        if (eventType) {
          emits.push({
            eventType,
            fileId: relPath,
            classId: enclosingClass,
            line: call.getStartLineNumber(),
          });
        }
      }

      if (
        exprText.endsWith(".on") &&
        !exprText.endsWith("onConnection") &&
        !exprText.endsWith("onmessage") &&
        !exprText.endsWith("onopen") &&
        !exprText.endsWith("onclose") &&
        !exprText.endsWith("onerror")
      ) {
        const firstArg = call.getArguments()[0];
        if (firstArg && Node.isStringLiteral(firstArg)) {
          subs.push({
            eventType: firstArg.getLiteralValue(),
            fileId: relPath,
            classId: enclosingClass,
            line: call.getStartLineNumber(),
          });
        }
      }

      if (exprText.endsWith(".onAfterTick")) {
        subs.push({
          eventType: "tick_complete",
          fileId: relPath,
          classId: enclosingClass,
          line: call.getStartLineNumber(),
        });
      }

      if (exprText.endsWith(".enqueue")) {
        const commandType = extractObjectTypeProperty(call);
        if (commandType) {
          cmds.push({
            commandType,
            fileId: relPath,
            classId: enclosingClass,
            line: call.getStartLineNumber(),
          });
        }
      }
    }
  }

  scanConversationTickEvents(rootDir, sourceFiles, emits);

  return {
    events: aggregateEvents(emits, subs),
    commands: aggregateCommands(cmds),
  };
}

function scanConversationTickEvents(
  rootDir: string,
  sourceFiles: SourceFile[],
  emits: RawEventEmit[],
): void {
  for (const sf of sourceFiles) {
    const relPath = relative(rootDir, sf.getFilePath());
    if (!relPath.includes("conversation")) continue;

    const objLiterals = sf.getDescendantsOfKind(SyntaxKind.ObjectLiteralExpression);
    for (const obj of objLiterals) {
      const typeProp = obj.getProperty("type");
      if (!typeProp || !Node.isPropertyAssignment(typeProp)) continue;
      const init = typeProp.getInitializer();
      if (!init || !Node.isStringLiteral(init)) continue;
      const eventType = init.getLiteralValue();
      if (!eventType.startsWith("convo_")) continue;

      const enclosingClass = obj
        .getFirstAncestorByKind(SyntaxKind.ClassDeclaration)
        ?.getName();
      const enclosingMethod = obj.getFirstAncestorByKind(
        SyntaxKind.MethodDeclaration,
      );
      if (enclosingMethod?.getName() !== "processTick") continue;

      const exists = emits.some(
        (event) =>
          event.eventType === eventType &&
          event.fileId === relPath &&
          event.classId === enclosingClass,
      );
      if (exists) continue;

      emits.push({
        eventType,
        fileId: relPath,
        classId: enclosingClass,
        line: obj.getStartLineNumber(),
      });
    }
  }
}

function aggregateEvents(
  emits: RawEventEmit[],
  subs: RawEventSub[],
): EventInfo[] {
  const eventMap = new Map<string, EventInfo>();

  for (const emit of emits) {
    if (!eventMap.has(emit.eventType)) {
      eventMap.set(emit.eventType, {
        eventType: emit.eventType,
        emitters: [],
        subscribers: [],
      });
    }
    const info = eventMap.get(emit.eventType)!;
    if (
      !info.emitters.some(
        (entry) => entry.fileId === emit.fileId && entry.line === emit.line,
      )
    ) {
      info.emitters.push({
        fileId: emit.fileId,
        classId: emit.classId,
        line: emit.line,
      });
    }
  }

  for (const sub of subs) {
    if (!eventMap.has(sub.eventType)) {
      eventMap.set(sub.eventType, {
        eventType: sub.eventType,
        emitters: [],
        subscribers: [],
      });
    }
    eventMap.get(sub.eventType)!.subscribers.push({
      fileId: sub.fileId,
      classId: sub.classId,
      line: sub.line,
    });
  }

  const wildcardSubs = subs.filter((sub) => sub.eventType === "*");
  if (wildcardSubs.length > 0) {
    for (const info of eventMap.values()) {
      if (info.eventType === "*") continue;
      for (const wildcard of wildcardSubs) {
        if (
          !info.subscribers.some(
            (entry) =>
              entry.fileId === wildcard.fileId && entry.line === wildcard.line,
          )
        ) {
          info.subscribers.push({
            fileId: wildcard.fileId,
            classId: wildcard.classId,
            line: wildcard.line,
          });
        }
      }
    }
  }

  return Array.from(eventMap.values()).filter((event) => event.eventType !== "*");
}

function aggregateCommands(cmds: RawCommand[]): CommandInfo[] {
  const commandMap = new Map<string, CommandInfo>();

  for (const cmd of cmds) {
    if (!commandMap.has(cmd.commandType)) {
      commandMap.set(cmd.commandType, {
        commandType: cmd.commandType,
        producers: [],
        consumer: GAME_LOOP_FILE,
      });
    }
    commandMap.get(cmd.commandType)!.producers.push({
      fileId: cmd.fileId,
      classId: cmd.classId,
      line: cmd.line,
    });
  }

  return Array.from(commandMap.values());
}

function extractObjectTypeProperty(call: Node): string | undefined {
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
