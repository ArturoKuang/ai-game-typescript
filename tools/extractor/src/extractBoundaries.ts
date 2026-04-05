/**
 * Boundary-classification pass for the architecture extractor.
 *
 * Audit note: this file is where low-level facts become architectural claims.
 * If a coupling edge looks wrong in the graph, the heuristics here are the
 * first place to audit.
 */
import type {
  BoundaryEdge,
  CommandInfo,
  EventInfo,
  FileNode,
  ImportEdge,
} from "./types.js";

const MUTATION_METHODS = new Set([
  "spawnPlayer",
  "removePlayer",
  "setPlayerTarget",
  "movePlayerDirection",
  "setPlayerInput",
  "setPlayerWaitingForResponse",
  "enqueue",
  "loadWorld",
  "reset",
  "startConversation",
  "endConversation",
  "acceptInvite",
  "declineInvite",
  "addMessage",
  "clear",
]);

export function classifyBoundaries(
  files: FileNode[],
  imports: ImportEdge[],
  events: EventInfo[],
  commands: CommandInfo[],
): BoundaryEdge[] {
  const fileToComponent = new Map(files.map((file) => [file.id, file.componentId]));
  const boundaryMap = new Map<string, BoundaryEdge>();

  for (const event of events) {
    for (const emitter of event.emitters) {
      for (const subscriber of event.subscribers) {
        const sourceComponent = fileToComponent.get(emitter.fileId);
        const targetComponent = fileToComponent.get(subscriber.fileId);
        if (
          !sourceComponent ||
          !targetComponent ||
          sourceComponent === targetComponent
        ) {
          continue;
        }

        const edge = getOrCreateBoundary(
          boundaryMap,
          sourceComponent,
          targetComponent,
        );
        edge.eventCount++;
        edge.details.push({
          kind: "event",
          description: `event "${event.eventType}"`,
          sourceFile: emitter.fileId,
          targetFile: subscriber.fileId,
          line: subscriber.line,
        });
      }
    }
  }

  for (const command of commands) {
    for (const producer of command.producers) {
      const sourceComponent = fileToComponent.get(producer.fileId);
      const targetComponent = fileToComponent.get(command.consumer);
      if (
        !sourceComponent ||
        !targetComponent ||
        sourceComponent === targetComponent
      ) {
        continue;
      }

      const edge = getOrCreateBoundary(
        boundaryMap,
        sourceComponent,
        targetComponent,
      );
      edge.mutationCount++;
      edge.details.push({
        kind: "mutation",
        description: `enqueue "${command.commandType}"`,
        sourceFile: producer.fileId,
        targetFile: command.consumer,
        line: producer.line,
      });
    }
  }

  for (const imp of imports) {
    const sourceComponent = fileToComponent.get(imp.source);
    const targetComponent = fileToComponent.get(imp.target);
    if (
      !sourceComponent ||
      !targetComponent ||
      sourceComponent === targetComponent
    ) {
      continue;
    }

    for (const symbol of imp.symbols) {
      const edge = getOrCreateBoundary(
        boundaryMap,
        sourceComponent,
        targetComponent,
      );
      if (MUTATION_METHODS.has(symbol)) {
        edge.mutationCount++;
        edge.details.push({
          kind: "mutation",
          description: `imports ${symbol}`,
          sourceFile: imp.source,
          targetFile: imp.target,
        });
      } else {
        edge.callCount++;
        edge.details.push({
          kind: "call",
          description: `imports ${symbol}`,
          sourceFile: imp.source,
          targetFile: imp.target,
        });
      }
    }
  }

  for (const edge of boundaryMap.values()) {
    dedupeBoundaryDetails(edge);
    edge.couplingType = deriveCouplingType(edge);
  }

  return Array.from(boundaryMap.values());
}

function getOrCreateBoundary(
  boundaryMap: Map<string, BoundaryEdge>,
  source: string,
  target: string,
): BoundaryEdge {
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

function dedupeBoundaryDetails(edge: BoundaryEdge): void {
  const seen = new Set<string>();
  edge.details = edge.details.filter((detail) => {
    const key = [
      detail.kind,
      detail.description,
      detail.sourceFile,
      detail.targetFile,
      detail.line ?? "",
    ].join(":");
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function deriveCouplingType(edge: BoundaryEdge): BoundaryEdge["couplingType"] {
  if (edge.mutationCount > 0 && edge.eventCount > 0) {
    return "mixed";
  }
  if (edge.mutationCount > 0) {
    return "mutation";
  }
  if (edge.eventCount > 0) {
    return "event";
  }
  return "call";
}
