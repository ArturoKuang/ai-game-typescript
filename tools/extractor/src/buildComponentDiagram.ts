import type {
  ClassInfo,
  CommandInfo,
  ComponentDiagram,
  ComponentDiagramBoundary,
  ComponentDiagramCard,
  ComponentDiagramConfidence,
  ComponentDiagramEdge,
  ComponentDiagramEvidence,
  ComponentDiagramLine,
  ComponentDiagramLineKind,
  ComponentDiagramMetric,
  ComponentDiagramMiniCard,
  ComponentDiagramOpenTarget,
  ComponentDiagramRelationshipKind,
  ComponentDiagramSection,
  EventInfo,
  ImportEdge,
  MessageFlow,
  ModuleFact,
} from "./types.js";

const CLIENT_BOUNDARY_ID = "diagram-boundary-client";
const SERVER_BOUNDARY_ID = "diagram-boundary-server";
const MAX_CANVAS_LINES_PER_SECTION = 3;

const COLORS = {
  client: "#FE6100",
  server: "#648FFF",
  network: "#22D3EE",
  engine: "#648FFF",
  npc: "#DC267F",
  persistence: "#FFB000",
  debug: "#d1d5db",
};

interface DiagramInput {
  classes: ClassInfo[];
  moduleFacts: ModuleFact[];
  imports: ImportEdge[];
  events: EventInfo[];
  commands: CommandInfo[];
  messageFlows: MessageFlow[];
}

interface RowPlacement {
  cards: ComponentDiagramCard[];
  nextY: number;
}

interface EvidenceDraft {
  kind: string;
  confidence: ComponentDiagramConfidence;
  fileId: string;
  line?: number;
  symbol?: string;
  detail: string;
}

interface DiagramContext {
  classLookup: Map<string, ClassInfo>;
  factLookup: Map<string, ModuleFact>;
  imports: ImportEdge[];
  events: EventInfo[];
  commands: CommandInfo[];
  messageFlows: MessageFlow[];
  evidenceBuilder: EvidenceBuilder;
}

class EvidenceBuilder {
  private nextId = 1;
  readonly evidence: ComponentDiagramEvidence[] = [];

  add(draft: EvidenceDraft): string {
    const id = `diagram-evidence-${this.nextId++}`;
    this.evidence.push({
      id,
      kind: draft.kind,
      confidence: draft.confidence,
      fileId: draft.fileId,
      line: draft.line,
      symbol: draft.symbol,
      detail: draft.detail,
    });
    return id;
  }

  addMany(drafts: EvidenceDraft[]): string[] {
    return drafts.map((draft) => this.add(draft));
  }
}

export function buildComponentDiagram(input: DiagramInput): ComponentDiagram {
  const context: DiagramContext = {
    classLookup: new Map(input.classes.map((cls) => [`${cls.fileId}:${cls.name}`, cls])),
    factLookup: new Map(input.moduleFacts.map((fact) => [fact.fileId, fact])),
    imports: input.imports,
    events: input.events,
    commands: input.commands,
    messageFlows: input.messageFlows,
    evidenceBuilder: new EvidenceBuilder(),
  };

  const clientCards = buildClientCards(context);
  placeRow(clientCards, 36, 120, 24);

  const clientBoundary = buildBoundary(
    CLIENT_BOUNDARY_ID,
    "Browser Client",
    "PixiJS 8, Vite 6, TypeScript",
    "Rendering, prediction, DOM UI, and browser-side debugging.",
    COLORS.client,
    { x: 80, y: 60 },
    clientCards,
  );

  const serverCards = buildServerCards(context);
  const topRow = placeRow([serverCards.network, serverCards.debug], 36, 120, 28);
  const engineY = topRow.nextY + 60;
  serverCards.engine.position = { x: 36, y: engineY };

  const lowerY = engineY + serverCards.engine.size.height + 60;
  serverCards.npc.position = { x: 36, y: lowerY };
  serverCards.persistence.position = {
    x: serverCards.npc.position.x + Math.round((serverCards.npc.size.width - serverCards.persistence.size.width) / 2),
    y: lowerY + serverCards.npc.size.height + 80,
  };

  const serverBoundary = buildBoundary(
    SERVER_BOUNDARY_ID,
    "Game Server",
    "Node.js 20, Express 4, ws 8",
    "Authoritative simulation, transport bridge, debug surfaces, NPC orchestration, and optional Postgres persistence.",
    COLORS.server,
    { x: 80, y: clientBoundary.position.y + clientBoundary.size.height + 120 },
    [
      serverCards.network,
      serverCards.debug,
      serverCards.engine,
      serverCards.npc,
      serverCards.persistence,
    ],
  );

  const edges = buildEdges(context);

  return {
    boundaries: [clientBoundary, serverBoundary],
    cards: [
      ...clientCards.map((card) => ({ ...card, boundaryId: CLIENT_BOUNDARY_ID })),
      ...Object.values(serverCards).map((card) => ({ ...card, boundaryId: SERVER_BOUNDARY_ID })),
    ],
    edges,
    evidence: context.evidenceBuilder.evidence,
  };
}

function buildClientCards(context: DiagramContext): ComponentDiagramCard[] {
  const mainFile = getModuleFact(context, "client/src/main.ts");
  const predictionFile = getModuleFact(context, "client/src/prediction.ts");
  const uiFile = getModuleFact(context, "client/src/ui.ts");
  const debugLogFile = getModuleFact(context, "client/src/debugLog.ts");

  const clientMessageTypes = dedupe(context.messageFlows.map((flow) => flow.clientMessageType));
  const serverMessageTypes = dedupe(
    context.messageFlows.flatMap((flow) =>
      flow.steps
        .filter((step) => step.producesKind === "serverMessage" && step.produces)
        .map((step) => step.produces as string),
    ),
  );

  const mainState = dedupe([
    ...pickNames(mainFile?.topLevelVariables ?? [], ["gameState", "selfId", "mapTiles"]),
    ...pickNames(getFunctionVariableNames(mainFile, "start"), ["heldDirections"]),
  ]);

  const rendererLayers = getClassFieldLabels(
    context,
    "client/src/renderer.ts",
    "GameRenderer",
    {
      tileContainer: "tiles",
      activityContainer: "activity",
      lineContainer: "lines",
      playerContainer: "players",
    },
    ["tileContainer", "activityContainer", "lineContainer", "playerContainer"],
  );

  const predictionExports = (predictionFile?.exportedFunctions ?? [])
    .slice(0, 4)
    .map((name) => `${name}()`);
  const predictionMirrors = derivePredictionMirrors(predictionFile);
  const uiDomains = deriveUiDomains(uiFile);
  const debugSurface = deriveDebugSurface(debugLogFile);

  return [
    createCard({
      id: "diagram-client-main",
      title: "main.ts",
      subtitle: "browser bootstrap",
      fileId: "client/src/main.ts",
      accentColor: COLORS.client,
      width: 280,
      summary:
        "Owns client bootstrap state, wires renderer/prediction/UI together, and mediates the main browser-side message loop.",
      sections: orderedSections([
        section("owns", "Owns", mainState.map((name) => variableLine(context, "diagram-client-main", "client/src/main.ts", name))),
        section(
          "ingress",
          "Ingress",
          pickNames(serverMessageTypes, ["player_joined", "player_update", "convo_update", "message"]).map((messageType) =>
            flowServerMessageLine(context, "diagram-client-main", messageType),
          ),
        ),
        section(
          "egress",
          "Egress",
          pickNames(clientMessageTypes, ["join", "input_start", "input_stop"]).map((messageType) =>
            flowClientMessageLine(context, "diagram-client-main", messageType),
          ),
        ),
        section(
          "depends-on",
          "Depends On",
          [
            derivedLine(context, "diagram-client-main", "GameRenderer", "dependency", "client/src/main.ts", "Main bootstrap wires the renderer."),
            derivedLine(context, "diagram-client-main", "prediction helpers", "dependency", "client/src/main.ts", "Main loop forwards held-input state into prediction helpers."),
            derivedLine(context, "diagram-client-main", "UI", "dependency", "client/src/main.ts", "Main bootstrap wires the DOM UI surface."),
          ],
        ),
        section(
          "internals",
          "Internals",
          [
            exactLine(context, "diagram-client-main", "start()", "internal", "client/src/main.ts", "Exported start() bootstraps the browser client.", "start"),
          ],
        ),
      ]),
      openNext: [
        openTarget("main.ts", "client/src/main.ts", "Entry point for browser state ownership and wiring."),
        openTarget("renderer.ts", "client/src/renderer.ts", "Shows how visual state is projected onto Pixi."),
        openTarget("prediction.ts", "client/src/prediction.ts", "Explains client/server movement parity and reconciliation."),
      ],
    }),
    createCard({
      id: "diagram-client-renderer",
      title: "renderer",
      subtitle: "PixiJS scene graph",
      fileId: "client/src/renderer.ts",
      accentColor: COLORS.client,
      width: 270,
      summary:
        "Owns the Pixi scene graph and turns synchronized game state into tiles, activity markers, player sprites, and chat bubbles.",
      sections: orderedSections([
        section(
          "owns",
          "Owns",
          rendererLayers.map((name) =>
            classFieldLine(context, "diagram-client-renderer", "client/src/renderer.ts", "GameRenderer", name),
          ),
        ),
        section(
          "ingress",
          "Ingress",
          [
            flowClientMethodLine(context, "diagram-client-renderer", "move", "route"),
            derivedLine(context, "diagram-client-renderer", "player snapshots", "message", "client/src/renderer.ts", "Renderer consumes synchronized player state from main.ts."),
            derivedLine(context, "diagram-client-renderer", "conversation overlays", "message", "client/src/renderer.ts", "Renderer positions talk lines and chat bubbles from game state."),
          ],
        ),
        section(
          "egress",
          "Egress",
          [
            flowClientMessageLine(context, "diagram-client-renderer", "move"),
            derivedLine(context, "diagram-client-renderer", "sprite placement", "message", "client/src/renderer.ts", "Renderer writes sprite positions into Pixi containers."),
            derivedLine(context, "diagram-client-renderer", "chat bubble updates", "message", "client/src/renderer.ts", "Renderer updates player chat bubble surfaces."),
          ],
        ),
        section(
          "depends-on",
          "Depends On",
          [
            derivedLine(context, "diagram-client-renderer", "Pixi container graph", "dependency", "client/src/renderer.ts", "Renderer is the Pixi scene graph owner."),
            derivedLine(context, "diagram-client-renderer", "main.ts state snapshots", "dependency", "client/src/renderer.ts", "Renderer redraws from main.ts game state."),
          ],
        ),
        section(
          "internals",
          "Internals",
          getClassMethodNames(context, "client/src/renderer.ts", "GameRenderer", ["render", "onTileClick", "renderPlayers"]).map((method) =>
            classMethodLine(context, "diagram-client-renderer", "client/src/renderer.ts", "GameRenderer", `${method}()`, method),
          ),
        ),
      ]),
      openNext: [
        openTarget("renderer.ts", "client/src/renderer.ts", "Shows how clicks and synchronized state become visuals."),
        openTarget("main.ts", "client/src/main.ts", "Caller that feeds state and inputs into the renderer."),
        openTarget("prediction.ts", "client/src/prediction.ts", "Pairs with renderer when reconciling movement."),
      ],
    }),
    createCard({
      id: "diagram-client-prediction",
      title: "prediction",
      subtitle: "local physics mirror",
      fileId: "client/src/prediction.ts",
      accentColor: COLORS.client,
      width: 250,
      summary:
        "Mirrors movement physics in the browser so held-key input feels immediate before the authoritative server update arrives.",
      sections: orderedSections([
        section(
          "owns",
          "Owns",
          predictionMirrors.map((name) =>
            derivedLine(context, "diagram-client-prediction", name, "state", "client/src/prediction.ts", `Prediction mirrors ${name} locally.`),
          ),
        ),
        section(
          "ingress",
          "Ingress",
          [
            flowClientMessageLine(context, "diagram-client-prediction", "input_start"),
            flowClientMessageLine(context, "diagram-client-prediction", "input_stop"),
            flowServerMessageLine(context, "diagram-client-prediction", "player_update"),
          ],
        ),
        section(
          "egress",
          "Egress",
          [
            flowMethodEvidenceLine(context, "diagram-client-prediction", "predictMovement()", "command", "client/src/prediction.ts", "predictMovement"),
            flowMethodEvidenceLine(context, "diagram-client-prediction", "reconcile()", "message", "client/src/prediction.ts", "reconcile"),
          ],
        ),
        section(
          "depends-on",
          "Depends On",
          [
            derivedLine(context, "diagram-client-prediction", "tile collision", "dependency", "client/src/prediction.ts", "Prediction mirrors tile collision logic."),
            derivedLine(context, "diagram-client-prediction", "player collision", "dependency", "client/src/prediction.ts", "Prediction mirrors player collision logic."),
            derivedLine(context, "diagram-client-prediction", "server parity rules", "dependency", "client/src/prediction.ts", "Prediction is only useful when it stays close to GameLoop movement rules."),
          ],
        ),
        section(
          "internals",
          "Internals",
          predictionExports.map((method) =>
            exactLine(context, "diagram-client-prediction", method, "internal", "client/src/prediction.ts", `Exported helper ${method} participates in client prediction.`),
          ),
        ),
      ]),
      openNext: [
        openTarget("prediction.ts", "client/src/prediction.ts", "Defines the local movement mirror and reconciliation."),
        openTarget("main.ts", "client/src/main.ts", "Owns the held-input state that drives prediction."),
        openTarget("gameLoop.ts", "server/src/engine/gameLoop.ts", "Authoritative movement rules that prediction mirrors."),
      ],
    }),
    createCard({
      id: "diagram-client-ui",
      title: "ui",
      subtitle: "DOM sidebar",
      fileId: "client/src/ui.ts",
      accentColor: COLORS.client,
      width: 230,
      summary:
        "Owns the DOM sidebar surfaces for chat, player list, and conversation controls, then translates user actions into client messages.",
      sections: orderedSections([
        section(
          "owns",
          "Owns",
          uiDomains.map((name) =>
            derivedLine(context, "diagram-client-ui", name, "state", "client/src/ui.ts", `Derived from UI DOM ids for ${name}.`),
          ),
        ),
        section(
          "ingress",
          "Ingress",
          pickNames(serverMessageTypes, ["convo_update", "message", "player_update"]).map((messageType) =>
            flowServerMessageLine(context, "diagram-client-ui", messageType),
          ),
        ),
        section(
          "egress",
          "Egress",
          [
            flowClientMessageLine(context, "diagram-client-ui", "start_convo"),
            flowClientMessageLine(context, "diagram-client-ui", "say"),
            flowClientMessageLine(context, "diagram-client-ui", "end_convo"),
            derivedLine(context, "diagram-client-ui", "accept / decline", "command", "client/src/ui.ts", "Conversation controls include accept and decline actions in the DOM UI."),
          ],
        ),
        section(
          "depends-on",
          "Depends On",
          [
            derivedLine(context, "diagram-client-ui", "main.ts state hooks", "dependency", "client/src/ui.ts", "UI renders from browser state passed in from main.ts."),
            derivedLine(context, "diagram-client-ui", "DOM controls", "dependency", "client/src/ui.ts", "UI binds event handlers to DOM elements."),
          ],
        ),
        section(
          "internals",
          "Internals",
          [
            exactLine(context, "diagram-client-ui", "conversation controls", "internal", "client/src/ui.ts", "Conversation DOM ids drive invite, accept, decline, and end actions."),
            exactLine(context, "diagram-client-ui", "chat controls", "internal", "client/src/ui.ts", "Chat DOM ids drive send and render behavior."),
          ],
        ),
      ]),
      openNext: [
        openTarget("ui.ts", "client/src/ui.ts", "Maps DOM controls to game-facing actions."),
        openTarget("main.ts", "client/src/main.ts", "Passes state and callbacks into the UI surface."),
        openTarget("network.ts", "client/src/network.ts", "Contains the browser WebSocket client used by UI actions."),
      ],
    }),
    createCard({
      id: "diagram-client-debug-log",
      title: "debugLog",
      subtitle: "client ring buffer",
      fileId: "client/src/debugLog.ts",
      accentColor: COLORS.client,
      width: 250,
      summary:
        "Keeps a small browser-side event buffer and exposes debug helpers so local client behavior can be inspected without touching the server.",
      sections: orderedSections([
        section(
          "owns",
          "Owns",
          [
            exactLine(context, "diagram-client-debug-log", "MAX_CLIENT_DEBUG_EVENTS = 200", "state", "client/src/debugLog.ts", "Constant caps the client debug ring buffer."),
            exactLine(context, "diagram-client-debug-log", "clientDebugEvents[]", "state", "client/src/debugLog.ts", "Client debug events are stored in an in-memory array."),
          ],
        ),
        section(
          "ingress",
          "Ingress",
          [
            derivedLine(context, "diagram-client-debug-log", "client debug events", "message", "client/src/debugLog.ts", "Runtime client events are pushed into the debug buffer."),
          ],
        ),
        section(
          "egress",
          "Egress",
          debugSurface.map((lineText) =>
            exactLine(context, "diagram-client-debug-log", lineText, "message", "client/src/debugLog.ts", `Debug surface exposes ${lineText}.`),
          ),
        ),
        section(
          "depends-on",
          "Depends On",
          [
            exactLine(context, "diagram-client-debug-log", "window debug handle", "dependency", "client/src/debugLog.ts", "Debug log exposes a window-scoped inspection handle."),
          ],
        ),
        section(
          "internals",
          "Internals",
          (debugLogFile?.exportedFunctions ?? []).map((name) =>
            exactLine(context, "diagram-client-debug-log", `${name}()`, "internal", "client/src/debugLog.ts", `Exported helper ${name}() participates in debug log inspection.`),
          ),
        ),
      ]),
      openNext: [
        openTarget("debugLog.ts", "client/src/debugLog.ts", "Shows the browser-side inspection surface."),
        openTarget("main.ts", "client/src/main.ts", "One of the main producers/consumers of client debug events."),
      ],
    }),
  ];
}

function buildServerCards(context: DiagramContext): {
  network: ComponentDiagramCard;
  debug: ComponentDiagramCard;
  engine: ComponentDiagramCard;
  npc: ComponentDiagramCard;
  persistence: ComponentDiagramCard;
} {
  const websocketFile = getModuleFact(context, "server/src/network/websocket.ts");
  const routerFile = getModuleFact(context, "server/src/debug/router.ts");
  const schemaFile = getModuleFact(context, "server/src/db/schema.sql");

  const networkCases = getSwitchCaseLabels(context, websocketFile, "GameWebSocketServer", "onMessage");
  const routeGroups = deriveRouterPaths(routerFile);
  const schemaInfo = deriveSchemaSummary(schemaFile);
  const websocketServerMessages = dedupe(
    context.messageFlows.flatMap((flow) =>
      flow.steps
        .filter((step) => step.fileId === "server/src/network/websocket.ts" && step.producesKind === "serverMessage" && step.produces)
        .map((step) => step.produces as string),
    ),
  );
  const engineEvents = pickNames(
    eventTypesByFilePrefix(context.events, "server/src/engine/"),
    ["spawn", "player_update", "input_state", "input_move", "convo_started", "convo_active", "convo_ended", "message"],
  );
  const engineCommands = pickNames(
    commandTypesByProducerPrefix(context.commands, "server/src/"),
    ["spawn", "move_to", "start_convo", "say", "end_convo"],
  );
  const npcIngressEvents = pickNames(
    eventTypesBySubscriberPrefix(context.events, "server/src/npc/"),
    ["spawn", "convo_started", "convo_active", "convo_ended", "message", "tick_complete"],
  );
  const npcCommands = pickNames(
    commandTypesByProducerPrefix(context.commands, "server/src/npc/"),
    ["start_convo", "say", "end_convo"],
  );

  return {
    network: createCard({
      id: "diagram-server-network",
      title: "GameWebSocketServer",
      subtitle: "server/src/network/websocket.ts",
      fileId: "server/src/network/websocket.ts",
      accentColor: COLORS.network,
      width: 360,
      summary:
        "Accepts browser sockets, routes client protocol messages into engine mutations, and fans authoritative game events back out as public server messages.",
      sections: orderedSections([
        section(
          "owns",
          "Owns",
          [
            exactLine(context, "diagram-server-network", "clients map", "state", "server/src/network/websocket.ts", "GameWebSocketServer owns the socket registry.", "GameWebSocketServer"),
            exactLine(context, "diagram-server-network", "player socket registry", "state", "server/src/network/websocket.ts", "GameWebSocketServer tracks playerId to socket mapping.", "GameWebSocketServer"),
          ],
        ),
        section(
          "ingress",
          "Ingress",
          pickNames(networkCases, ["join", "move", "say", "start_convo", "input_start", "input_stop", "end_convo"]).map((messageType) =>
            flowClientMessageLine(context, "diagram-server-network", messageType),
          ),
        ),
        section(
          "egress",
          "Egress",
          pickNames(websocketServerMessages, ["player_joined", "player_update", "convo_update", "message"]).map((messageType) =>
            flowServerMessageLine(context, "diagram-server-network", messageType),
          ),
        ),
        section(
          "depends-on",
          "Depends On",
          [
            derivedLine(context, "diagram-server-network", "GameLoop", "dependency", "server/src/network/websocket.ts", "WebSocket server mutates or listens through the authoritative game loop."),
            derivedLine(context, "diagram-server-network", "protocol.ts unions", "dependency", "server/src/network/websocket.ts", "WebSocket routing is constrained by ClientMessage and ServerMessage unions."),
          ],
        ),
        section(
          "internals",
          "Internals",
          [
            classMethodLine(context, "diagram-server-network", "server/src/network/websocket.ts", "GameWebSocketServer", "broadcastGameEvent()", "broadcastGameEvent"),
            classMethodLine(context, "diagram-server-network", "server/src/network/websocket.ts", "GameWebSocketServer", "toPublicPlayer()", "toPublicPlayer"),
            derivedLine(context, "diagram-server-network", "participant-scoped convo sends", "internal", "server/src/network/websocket.ts", "Conversation updates are scoped to participants before being sent."),
          ],
        ),
      ]),
      openNext: [
        openTarget("websocket.ts", "server/src/network/websocket.ts", "Shows protocol ingress, event fanout, and player scoping."),
        openTarget("protocol.ts", "server/src/network/protocol.ts", "Defines the discriminated unions this server routes."),
        openTarget("gameLoop.ts", "server/src/engine/gameLoop.ts", "Consumes the commands and direct calls coming from the socket bridge."),
      ],
    }),
    debug: createCard({
      id: "diagram-server-debug",
      title: "Debug API",
      subtitle: "Express router",
      fileId: "server/src/debug/router.ts",
      accentColor: COLORS.debug,
      width: 430,
      summary:
        "Exposes read-only state inspection plus a small set of queued and direct debug mutations for local harnesses and scenario control.",
      sections: orderedSections([
        section(
          "owns",
          "Owns",
          [
            exactLine(context, "diagram-server-debug", "GET debug routes", "state", "server/src/debug/router.ts", "Router registers read-only debug endpoints."),
            exactLine(context, "diagram-server-debug", "POST debug routes", "state", "server/src/debug/router.ts", "Router registers mutation endpoints for runtime control."),
          ],
        ),
        section(
          "ingress",
          "Ingress",
          [
            ...pickNames(routeGroups.get, ["state", "map", "players", "log", "conversations", "memories/:playerId"]).map((path) =>
              routeLine(context, "diagram-server-debug", "server/src/debug/router.ts", "GET", path),
            ),
            ...pickNames(routeGroups.post, ["tick", "spawn", "move", "input", "scenario", "start-convo", "say", "end-convo"]).map((path) =>
              routeLine(context, "diagram-server-debug", "server/src/debug/router.ts", "POST", path),
            ),
          ],
        ),
        section(
          "egress",
          "Egress",
          [
            derivedLine(context, "diagram-server-debug", "JSON snapshots", "message", "server/src/debug/router.ts", "GET routes serialize current runtime state."),
            derivedLine(context, "diagram-server-debug", "queued engine mutations", "command", "server/src/debug/router.ts", "Some POST routes flow through GameLoop methods."),
            derivedLine(context, "diagram-server-debug", "direct conversation mutations", "command", "server/src/debug/router.ts", "Conversation debug routes bypass the normal queue path."),
          ],
        ),
        section(
          "depends-on",
          "Depends On",
          [
            derivedLine(context, "diagram-server-debug", "GameLoop", "dependency", "server/src/debug/router.ts", "Debug API reads and mutates authoritative runtime state."),
            derivedLine(context, "diagram-server-debug", "scenario presets", "dependency", "server/src/debug/router.ts", "Scenario routes load prebuilt runtime setups."),
          ],
        ),
        section(
          "internals",
          "Internals",
          [
            exactLine(context, "diagram-server-debug", "renderAsciiMap()", "internal", "server/src/debug/router.ts", "Map endpoint renders an ASCII debug view.", "renderAsciiMap"),
            exactLine(context, "diagram-server-debug", "scenario loader", "internal", "server/src/debug/router.ts", "Scenario route clears state and loads a named preset."),
          ],
        ),
      ]),
      openNext: [
        openTarget("router.ts", "server/src/debug/router.ts", "Defines every debug API route and whether it is read-only, queued, or direct."),
        openTarget("scenarios.ts", "server/src/debug/scenarios.ts", "Contains the named runtime presets loaded by /scenario."),
        openTarget("gameLoop.ts", "server/src/engine/gameLoop.ts", "Shows the authoritative state these routes inspect or mutate."),
      ],
    }),
    engine: createCard({
      id: "diagram-server-engine",
      title: "ENGINE",
      subtitle: "I/O-free simulation core",
      accentColor: COLORS.engine,
      width: 920,
      summary:
        "Owns the authoritative tick-based state machine for movement, collisions, pathing, conversations, and event emission without any network or database dependencies.",
      sections: orderedSections([
        section(
          "owns",
          "Owns",
          getClassFieldLabels(
            context,
            "server/src/engine/gameLoop.ts",
            "GameLoop",
            {
              players_: "players_",
              heldKeys_: "heldKeys_",
              commandQueue_: "commandQueue_",
              afterTickCallbacks: "afterTickCallbacks",
              eventHandlers: "eventHandlers",
            },
            ["players_", "heldKeys_", "commandQueue_", "afterTickCallbacks", "eventHandlers"],
          ).map((name) =>
            classFieldLine(context, "diagram-server-engine", "server/src/engine/gameLoop.ts", "GameLoop", name),
          ),
        ),
        section(
          "ingress",
          "Ingress",
          dedupe([
            ...engineCommands,
            "setPlayerInput()",
          ]).map((name) =>
            name.endsWith("()")
              ? exactLine(context, "diagram-server-engine", name, "command", "server/src/engine/gameLoop.ts", "Direct input path mutates held-key state inside GameLoop.", "setPlayerInput")
              : commandLine(context, "diagram-server-engine", name),
          ),
        ),
        section(
          "egress",
          "Egress",
          engineEvents.map((eventType) => eventLine(context, "diagram-server-engine", eventType, "emitters")),
        ),
        section(
          "depends-on",
          "Depends On",
          [
            derivedLine(context, "diagram-server-engine", "pathfinding (A* + heap)", "dependency", "server/src/engine/gameLoop.ts", "GameLoop delegates click-to-move route finding to pathfinding helpers."),
            derivedLine(context, "diagram-server-engine", "collision (AABB tile)", "dependency", "server/src/engine/gameLoop.ts", "GameLoop uses tile and player collision helpers for movement."),
            derivedLine(context, "diagram-server-engine", "SeededRNG", "dependency", "server/src/engine/gameLoop.ts", "Engine randomness is deterministic for reproducible tests."),
          ],
        ),
        section(
          "internals",
          "Internals",
          [
            exactLine(context, "diagram-server-engine", "GameLoop", "internal", "server/src/engine/gameLoop.ts", "Primary authority for runtime state.", "GameLoop"),
            exactLine(context, "diagram-server-engine", "World", "internal", "server/src/engine/world.ts", "Owns map tiles, activities, and spawn points.", "World"),
            exactLine(context, "diagram-server-engine", "ConversationManager", "internal", "server/src/engine/conversation.ts", "Owns the conversation lifecycle state machine.", "ConversationManager"),
            exactLine(context, "diagram-server-engine", "GameLogger", "internal", "server/src/engine/logger.ts", "Captures the authoritative event ring buffer.", "GameLogger"),
          ],
        ),
      ]),
      childCards: [
        miniCard(
          "World",
          "world.ts",
          "server/src/engine/world.ts",
          getClassFieldLabels(
            context,
            "server/src/engine/world.ts",
            "World",
            {
              tiles: "tiles[][]",
              activities: "activities",
              spawns: "spawnPoints",
            },
            ["tiles", "activities", "spawns"],
          ),
          "Owns the map grid, activity fixtures, and spawn points.",
        ),
        miniCard(
          "ConversationManager",
          "conversation.ts",
          "server/src/engine/conversation.ts",
          getClassFieldLabels(
            context,
            "server/src/engine/conversation.ts",
            "ConversationManager",
            {
              conversations: "conversations",
              playerToConvo: "playerToConvo",
              nextId: "nextId",
            },
            ["conversations", "playerToConvo", "nextId"],
          ),
          "Owns invite/walking/active/ended conversation state.",
        ),
        miniCard(
          "GameLogger",
          "logger.ts",
          "server/src/engine/logger.ts",
          ["circular buffer (1000 events)"],
          "Captures the authoritative event history.",
        ),
      ],
      openNext: [
        openTarget("gameLoop.ts", "server/src/engine/gameLoop.ts", "Central authority for runtime state, commands, and tick processing."),
        openTarget("conversation.ts", "server/src/engine/conversation.ts", "Conversation lifecycle and its state transitions live here."),
        openTarget("world.ts", "server/src/engine/world.ts", "Defines the map, activities, and spawn surfaces the engine owns."),
      ],
    }),
    npc: createCard({
      id: "diagram-server-npc",
      title: "NPC STACK",
      subtitle: "server/src/npc/*",
      accentColor: COLORS.npc,
      width: 920,
      summary:
        "Listens to engine lifecycle events, schedules NPC replies and initiations, retrieves relevant memories, and coordinates persistence-facing memory writes.",
      sections: orderedSections([
        section(
          "owns",
          "Owns",
          [
            exactLine(context, "diagram-server-npc", "reply scheduling", "state", "server/src/npc/orchestrator.ts", "NpcOrchestrator schedules replies after conversation events.", "scheduleReply"),
            exactLine(context, "diagram-server-npc", "memory retrieval", "state", "server/src/npc/memory.ts", "MemoryManager retrieves memories for prompt context.", "retrieveMemories"),
            exactLine(context, "diagram-server-npc", "reflection triggers", "state", "server/src/npc/orchestrator.ts", "Orchestrator triggers reflection when importance thresholds are crossed.", "maybeReflect"),
          ],
        ),
        section(
          "ingress",
          "Ingress",
          npcIngressEvents.map((eventType) => eventLine(context, "diagram-server-npc", eventType, "subscribers")),
        ),
        section(
          "egress",
          "Egress",
          [
            ...npcCommands.map((commandType) => commandLine(context, "diagram-server-npc", commandType)),
            derivedLine(context, "diagram-server-npc", "memory upserts", "command", "server/src/npc/memory.ts", "NPC memory work results in persistence writes."),
          ],
        ),
        section(
          "depends-on",
          "Depends On",
          [
            derivedLine(context, "diagram-server-npc", "Claude CLI subprocess", "dependency", "server/src/npc/providers/claudeCodeProvider.ts", "Primary reply provider shells out to Claude Code."),
            derivedLine(context, "diagram-server-npc", "scripted fallback", "dependency", "server/src/npc/resilientProvider.ts", "Fallback provider keeps replies available when the primary model fails."),
            derivedLine(context, "diagram-server-npc", "placeholder embeddings", "dependency", "server/src/npc/embedder.ts", "Memory retrieval uses generated embeddings even without a live embedding backend."),
          ],
        ),
        section(
          "internals",
          "Internals",
          [
            exactLine(context, "diagram-server-npc", "NpcOrchestrator", "internal", "server/src/npc/orchestrator.ts", "Coordinates subscriptions, replies, and initiations.", "NpcOrchestrator"),
            exactLine(context, "diagram-server-npc", "MemoryManager", "internal", "server/src/npc/memory.ts", "Scores, summarizes, and persists memories.", "MemoryManager"),
            exactLine(context, "diagram-server-npc", "Provider Stack", "internal", "server/src/npc/provider.ts", "Abstracts the NPC model provider chain.", "NpcModelProvider"),
          ],
        ),
      ]),
      childCards: [
        miniCard(
          "NpcOrchestrator",
          "orchestrator.ts",
          "server/src/npc/orchestrator.ts",
          deriveNpcResponsibilities(context, "server/src/npc/orchestrator.ts", "NpcOrchestrator"),
          "Subscribes to game events, schedules replies, and triggers initiations/reflections.",
        ),
        miniCard(
          "MemoryManager",
          "memory.ts",
          "server/src/npc/memory.ts",
          deriveMemoryResponsibilities(context, "server/src/npc/memory.ts", "MemoryManager"),
          "Scores, summarizes, and writes memory records used by NPC prompting.",
        ),
        miniCard(
          "Provider Stack",
          "provider.ts / resilientProvider.ts",
          "server/src/npc/provider.ts",
          [
            "NpcModelProvider interface",
            "ResilientNpcProvider",
            "ClaudeCodeProvider",
            "ScriptedNpcProvider",
          ],
          "Composes the primary model provider with scripted fallback behavior.",
        ),
      ],
      openNext: [
        openTarget("orchestrator.ts", "server/src/npc/orchestrator.ts", "Coordinates event subscriptions, reply timing, and initiative."),
        openTarget("memory.ts", "server/src/npc/memory.ts", "Explains retrieval, scoring, summarization, and reflection logic."),
        openTarget("resilientProvider.ts", "server/src/npc/resilientProvider.ts", "Shows how model fallback behavior is enforced."),
      ],
    }),
    persistence: createCard({
      id: "diagram-server-persistence",
      title: "PERSISTENCE",
      subtitle: "server/src/db/*",
      accentColor: COLORS.persistence,
      width: 640,
      summary:
        "Provides durable storage contracts for memories, NPC state, conversations, and generated artifacts, with in-memory fallback when Postgres is unavailable.",
      sections: orderedSections([
        section(
          "owns",
          "Owns",
          [
            exactLine(context, "diagram-server-persistence", "Repository implementations", "state", "server/src/db/repository.ts", "MemoryStore implementations live behind the repository contract.", "Repository"),
            exactLine(context, "diagram-server-persistence", "Npc store implementations", "state", "server/src/db/npcStore.ts", "NPC persistence implementations live behind the NPC store contract.", "PostgresNpcStore"),
            exactLine(context, "diagram-server-persistence", "schema + vector index", "state", "server/src/db/schema.sql", "Schema defines relational tables plus pgvector indexing."),
          ],
        ),
        section(
          "ingress",
          "Ingress",
          [
            derivedLine(context, "diagram-server-persistence", "memory writes", "command", "server/src/db/repository.ts", "Repository persists NPC memories and related artifacts."),
            derivedLine(context, "diagram-server-persistence", "conversation snapshots", "command", "server/src/db/schema.sql", "Schema stores conversation and message history."),
            derivedLine(context, "diagram-server-persistence", "player/NPC snapshots", "command", "server/src/db/npcStore.ts", "NPC and player state can be restored from persistence."),
          ],
        ),
        section(
          "egress",
          "Egress",
          [
            derivedLine(context, "diagram-server-persistence", "memory search results", "message", "server/src/db/repository.ts", "Repository search returns ranked memories for prompting."),
            derivedLine(context, "diagram-server-persistence", "restored NPC state", "message", "server/src/db/npcStore.ts", "NPC store returns persisted NPC state when available."),
          ],
        ),
        section(
          "depends-on",
          "Depends On",
          [
            exactLine(context, "diagram-server-persistence", "in-memory fallback", "dependency", "server/src/db/repository.ts", "InMemoryRepository and InMemoryNpcStore back local development without Postgres."),
            exactLine(context, "diagram-server-persistence", "Postgres + pgvector", "dependency", "server/src/db/schema.sql", "Schema relies on Postgres storage and pgvector indexes."),
          ],
        ),
        section(
          "internals",
          "Internals",
          [
            exactLine(context, "diagram-server-persistence", "MemoryStore", "internal", "server/src/db/repository.ts", "Memory repository contract and implementations.", "Repository"),
            exactLine(context, "diagram-server-persistence", "NpcPersistenceStore", "internal", "server/src/db/npcStore.ts", "NPC persistence contract and implementations.", "PostgresNpcStore"),
            exactLine(context, "diagram-server-persistence", "PostgreSQL + pgvector", "internal", "server/src/db/schema.sql", "Schema and vector index definitions.", "schema"),
          ],
        ),
      ]),
      childCards: [
        miniCard(
          "MemoryStore",
          "repository.ts",
          "server/src/db/repository.ts",
          ["Repository (Postgres)", "InMemoryRepository"],
          "Memory repository interface with Postgres and in-memory implementations.",
        ),
        miniCard(
          "NpcPersistenceStore",
          "npcStore.ts",
          "server/src/db/npcStore.ts",
          ["PostgresNpcStore", "InMemoryNpcStore"],
          "NPC persistence interface with durable and fallback implementations.",
        ),
        miniCard(
          "PostgreSQL + pgvector",
          "schema.sql",
          "server/src/db/schema.sql",
          schemaInfo,
          "Schema contains relational tables plus pgvector indexing for memory search.",
        ),
      ],
      openNext: [
        openTarget("repository.ts", "server/src/db/repository.ts", "Defines the memory repository interface and fallback behavior."),
        openTarget("npcStore.ts", "server/src/db/npcStore.ts", "Defines how NPC state is stored and restored."),
        openTarget("schema.sql", "server/src/db/schema.sql", "Shows the physical tables and vector index used by persistence."),
      ],
    }),
  };
}

function buildEdges(context: DiagramContext): ComponentDiagramEdge[] {
  return [
    edge(context, {
      id: "diagram-edge-client-server",
      source: CLIENT_BOUNDARY_ID,
      target: SERVER_BOUNDARY_ID,
      label: "transport\nclient msgs ↔ server msgs",
      color: "#9ca3af",
      relationshipKind: "transport",
      dash: "10 6",
      bidirectional: true,
      sourceHandle: "bottom",
      targetHandle: "top",
      evidence: [
        {
          kind: "message_flow",
          confidence: "derived",
          fileId: "server/src/network/websocket.ts",
          detail: `Transport spans ${context.messageFlows.length} extracted message flows over the browser WebSocket boundary.`,
        },
      ],
    }),
    edge(context, {
      id: "diagram-edge-main-renderer",
      source: "diagram-client-main",
      target: "diagram-client-renderer",
      label: "render state sync",
      color: COLORS.client,
      relationshipKind: "direct_call",
      sourceHandle: "right",
      targetHandle: "left",
      evidence: [
        {
          kind: "module_wiring",
          confidence: "derived",
          fileId: "client/src/main.ts",
          detail: "Main bootstrap wires renderer creation and state updates.",
        },
      ],
    }),
    edge(context, {
      id: "diagram-edge-network-engine",
      source: "diagram-server-network",
      target: "diagram-server-engine",
      label: "commands + input state",
      color: COLORS.network,
      relationshipKind: "mixed",
      sourceHandle: "bottom",
      targetHandle: "top",
      evidence: [
        ...pickNames(commandTypesByProducerPrefix(context.commands, "server/src/network/"), ["spawn", "move_to", "start_convo", "say", "end_convo"]).map(
          (commandType) => commandEvidenceDraft(context, commandType, "server/src/network/"),
        ),
        {
          kind: "message_flow",
          confidence: "exact",
          fileId: "server/src/network/websocket.ts",
          line: findFlowStep(context.messageFlows, (step) => step.fileId === "server/src/network/websocket.ts" && step.produces === "input_start")?.line,
          symbol: "onMessage",
          detail: "input_start/input_stop route directly into GameLoop.setPlayerInput().",
        },
      ],
    }),
    edge(context, {
      id: "diagram-edge-debug-engine",
      source: "diagram-server-debug",
      target: "diagram-server-engine",
      label: "debug calls + queue",
      color: COLORS.debug,
      relationshipKind: "mixed",
      sourceHandle: "bottom",
      targetHandle: "top",
      evidence: [
        {
          kind: "route_group",
          confidence: "exact",
          fileId: "server/src/debug/router.ts",
          detail: "POST /tick, /spawn, /move, /input, and /scenario mutate authoritative runtime state through debug handlers.",
        },
        {
          kind: "route_group",
          confidence: "exact",
          fileId: "server/src/debug/router.ts",
          detail: "POST /start-convo, /say, and /end-convo bypass the normal queue and mutate ConversationManager directly.",
        },
      ],
    }),
    edge(context, {
      id: "diagram-edge-engine-npc",
      source: "diagram-server-engine",
      target: "diagram-server-npc",
      label: "events + after tick",
      color: COLORS.engine,
      relationshipKind: "event_subscription",
      sourceHandle: "bottom",
      targetHandle: "top",
      evidence: [
        ...pickNames(eventTypesBySubscriberPrefix(context.events, "server/src/npc/"), ["spawn", "convo_started", "convo_active", "convo_ended", "message", "tick_complete"]).map(
          (eventType) => eventEvidenceDraft(context.events, eventType, "subscribers", "server/src/npc/"),
        ),
      ],
    }),
    edge(context, {
      id: "diagram-edge-npc-persistence",
      source: "diagram-server-npc",
      target: "diagram-server-persistence",
      label: "queries + upserts",
      color: COLORS.persistence,
      relationshipKind: "persistence_io",
      sourceHandle: "bottom",
      targetHandle: "top",
      evidence: [
        {
          kind: "memory_pipeline",
          confidence: "derived",
          fileId: "server/src/npc/memory.ts",
          detail: "MemoryManager retrieves and persists memory records through repository interfaces.",
        },
        {
          kind: "schema",
          confidence: "exact",
          fileId: "server/src/db/schema.sql",
          detail: "Schema provides relational tables plus vector indexing for memory search and storage.",
        },
      ],
    }),
  ];
}

function orderedSections(sections: ComponentDiagramSection[]): ComponentDiagramSection[] {
  return sections.filter((sectionItem) => sectionItem.lines.length > 0);
}

function section(
  id: string,
  label: ComponentDiagramSection["label"],
  lines: ComponentDiagramLine[],
): ComponentDiagramSection {
  return {
    id,
    label,
    lines: dedupeLines(lines),
  };
}

function createCard(options: {
  id: string;
  title: string;
  subtitle?: string;
  fileId?: string;
  accentColor: string;
  width: number;
  summary: string;
  sections: ComponentDiagramSection[];
  childCards?: ComponentDiagramMiniCard[];
  badges?: string[];
  metrics?: ComponentDiagramMetric[];
  openNext?: ComponentDiagramOpenTarget[];
}): ComponentDiagramCard {
  const sections = options.sections;
  const childCards = options.childCards ?? [];
  const badges = options.badges ?? [];
  const metrics = options.metrics ?? buildMetrics(sections, childCards);
  const childColumns = options.width >= 850 ? 3 : 2;
  const childRows = childCards.length === 0 ? 0 : Math.ceil(childCards.length / childColumns);
  const headerHeight = 96;
  const metricsHeight = metrics.length > 0 ? 42 : 0;
  const sectionBlockHeight = sections.reduce((sum, sectionItem) => {
    const visibleCount = Math.min(sectionItem.lines.length, MAX_CANVAS_LINES_PER_SECTION);
    const overflowCount = sectionItem.lines.length > MAX_CANVAS_LINES_PER_SECTION ? 1 : 0;
    return sum + 26 + (visibleCount + overflowCount) * 18;
  }, 0);
  const badgeHeight = badges.length > 0 ? 52 : 0;
  const childSectionHeight = childCards.length > 0 ? 40 + childRows * 126 : 0;
  const bottomPadding = 30;
  const height = headerHeight + metricsHeight + sectionBlockHeight + badgeHeight + childSectionHeight + bottomPadding;

  return {
    id: options.id,
    boundaryId: "",
    title: options.title,
    subtitle: options.subtitle,
    fileId: options.fileId,
    accentColor: options.accentColor,
    position: { x: 0, y: 0 },
    size: { width: options.width, height },
    summary: options.summary,
    sections,
    childCards,
    badges,
    metrics,
    openNext: options.openNext,
  };
}

function buildMetrics(
  sections: ComponentDiagramSection[],
  childCards: ComponentDiagramMiniCard[],
): ComponentDiagramMetric[] {
  const metricMap = new Map(sections.map((sectionItem) => [sectionItem.label, sectionItem.lines.length]));
  const metrics: ComponentDiagramMetric[] = [];
  const owns = metricMap.get("Owns") ?? 0;
  const ingress = metricMap.get("Ingress") ?? 0;
  const egress = metricMap.get("Egress") ?? 0;

  if (owns > 0) metrics.push({ label: "Owns", value: String(owns) });
  if (ingress > 0) metrics.push({ label: "In", value: String(ingress) });
  if (egress > 0) metrics.push({ label: "Out", value: String(egress) });
  if (childCards.length > 0) metrics.push({ label: "Inside", value: String(childCards.length) });

  return metrics.slice(0, 4);
}

function miniCard(
  title: string,
  subtitle: string,
  fileId: string,
  lines: string[],
  summary: string,
): ComponentDiagramMiniCard {
  return { title, subtitle, fileId, lines, summary };
}

function openTarget(label: string, fileId: string, reason: string): ComponentDiagramOpenTarget {
  return { label, fileId, reason };
}

function variableLine(
  context: DiagramContext,
  cardId: string,
  fileId: string,
  variableName: string,
): ComponentDiagramLine {
  return exactLine(
    context,
    cardId,
    variableName,
    "state",
    fileId,
    `Module-level or function-local variable ${variableName} is captured in extracted module facts.`,
  );
}

function classFieldLine(
  context: DiagramContext,
  cardId: string,
  fileId: string,
  className: string,
  text: string,
): ComponentDiagramLine {
  return exactLine(
    context,
    cardId,
    text,
    "state",
    fileId,
    `${className} field ${text} is present in extracted class fields.`,
    className,
  );
}

function classMethodLine(
  context: DiagramContext,
  cardId: string,
  fileId: string,
  className: string,
  text: string,
  methodName: string,
): ComponentDiagramLine {
  return exactLine(
    context,
    cardId,
    text,
    "internal",
    fileId,
    `${className}.${methodName}() is part of the extracted class API.`,
    methodName,
  );
}

function routeLine(
  context: DiagramContext,
  cardId: string,
  fileId: string,
  method: "GET" | "POST",
  path: string,
): ComponentDiagramLine {
  return line(context, {
    id: `${cardId}-${method.toLowerCase()}-${sanitizeId(path)}`,
    text: `${method} /${path}`,
    kind: "route",
    confidence: "exact",
    evidence: [
      {
        kind: "route",
        confidence: "exact",
        fileId,
        detail: `Express router registers ${method} /${path}.`,
      },
    ],
  });
}

function commandLine(
  context: DiagramContext,
  cardId: string,
  commandType: string,
): ComponentDiagramLine {
  return line(context, {
    id: `${cardId}-command-${sanitizeId(commandType)}`,
    text: commandType,
    kind: "command",
    confidence: "exact",
    evidence: [commandEvidenceDraft(context, commandType)],
  });
}

function eventLine(
  context: DiagramContext,
  cardId: string,
  eventType: string,
  role: "emitters" | "subscribers",
): ComponentDiagramLine {
  return line(context, {
    id: `${cardId}-event-${role}-${sanitizeId(eventType)}`,
    text: eventType,
    kind: "event",
    confidence: "exact",
    evidence: [eventEvidenceDraft(context.events, eventType, role)],
  });
}

function flowClientMessageLine(
  context: DiagramContext,
  cardId: string,
  messageType: string,
): ComponentDiagramLine {
  return line(context, {
    id: `${cardId}-client-message-${sanitizeId(messageType)}`,
    text: messageType,
    kind: "message",
    confidence: "exact",
    evidence: [flowClientMessageEvidenceDraft(context.messageFlows, messageType)],
  });
}

function flowClientMethodLine(
  context: DiagramContext,
  cardId: string,
  messageType: string,
  kind: ComponentDiagramLineKind,
): ComponentDiagramLine {
  const step = findFlowStep(
    context.messageFlows,
    (candidate) => candidate.lane === "Client" && candidate.produces === messageType,
  );
  const text = step?.method ? `${step.method}()` : messageType;

  return line(context, {
    id: `${cardId}-client-step-${sanitizeId(text)}`,
    text,
    kind,
    confidence: step ? "exact" : "derived",
    evidence: [
      step
        ? {
            kind: "message_flow",
            confidence: "exact",
            fileId: step.fileId,
            line: step.line,
            symbol: step.method,
            detail: `${messageType} originates from ${step.method}() in ${step.fileId}.`,
          }
        : {
            kind: "message_flow",
            confidence: "derived",
            fileId: "client/src/renderer.ts",
            detail: `${messageType} is initiated from the client rendering surface.`,
          },
    ],
  });
}

function flowServerMessageLine(
  context: DiagramContext,
  cardId: string,
  messageType: string,
): ComponentDiagramLine {
  return line(context, {
    id: `${cardId}-server-message-${sanitizeId(messageType)}`,
    text: messageType,
    kind: "message",
    confidence: "exact",
    evidence: [flowServerMessageEvidenceDraft(context.messageFlows, messageType)],
  });
}

function flowMethodEvidenceLine(
  context: DiagramContext,
  cardId: string,
  text: string,
  kind: ComponentDiagramLineKind,
  fileId: string,
  methodName: string,
): ComponentDiagramLine {
  const step = findFlowStep(context.messageFlows, (candidate) => candidate.fileId === fileId && candidate.method === methodName);
  return line(context, {
    id: `${cardId}-${sanitizeId(methodName)}`,
    text,
    kind,
    confidence: step ? "exact" : "derived",
    evidence: [
      step
        ? {
            kind: "message_flow",
            confidence: "exact",
            fileId: step.fileId,
            line: step.line,
            symbol: step.method,
            detail: `${step.method}() appears in extracted message flows as ${step.action}.`,
          }
        : {
            kind: "message_flow",
            confidence: "derived",
            fileId,
            symbol: methodName,
            detail: `${methodName}() is part of the component's runtime path.`,
          },
    ],
  });
}

function exactLine(
  context: DiagramContext,
  cardId: string,
  text: string,
  kind: ComponentDiagramLineKind,
  fileId: string,
  detail: string,
  symbol?: string,
  lineNumber?: number,
): ComponentDiagramLine {
  return line(context, {
    id: `${cardId}-${kind}-${sanitizeId(text)}`,
    text,
    kind,
    confidence: "exact",
    evidence: [
      {
        kind,
        confidence: "exact",
        fileId,
        line: lineNumber,
        symbol,
        detail,
      },
    ],
  });
}

function derivedLine(
  context: DiagramContext,
  cardId: string,
  text: string,
  kind: ComponentDiagramLineKind,
  fileId: string,
  detail: string,
): ComponentDiagramLine {
  return line(context, {
    id: `${cardId}-${kind}-${sanitizeId(text)}`,
    text,
    kind,
    confidence: "derived",
    evidence: [
      {
        kind,
        confidence: "derived",
        fileId,
        detail,
      },
    ],
  });
}

function line(
  context: DiagramContext,
  options: {
    id: string;
    text: string;
    kind: ComponentDiagramLineKind;
    confidence: ComponentDiagramConfidence;
    evidence: EvidenceDraft[];
    targetFileId?: string;
    targetSymbol?: string;
  },
): ComponentDiagramLine {
  return {
    id: options.id,
    text: options.text,
    kind: options.kind,
    confidence: options.confidence,
    evidenceIds: context.evidenceBuilder.addMany(options.evidence),
    targetFileId: options.targetFileId,
    targetSymbol: options.targetSymbol,
  };
}

function edge(
  context: DiagramContext,
  options: {
    id: string;
    source: string;
    target: string;
    label: string;
    color: string;
    relationshipKind: ComponentDiagramRelationshipKind;
    evidence: EvidenceDraft[];
    dash?: string;
    bidirectional?: boolean;
    sourceHandle?: "top" | "right" | "bottom" | "left";
    targetHandle?: "top" | "right" | "bottom" | "left";
  },
): ComponentDiagramEdge {
  const evidenceIds = context.evidenceBuilder.addMany(options.evidence);
  return {
    id: options.id,
    source: options.source,
    target: options.target,
    label: options.label,
    color: options.color,
    relationshipKind: options.relationshipKind,
    evidenceIds,
    counts: countConfidence(options.evidence),
    dash: options.dash,
    bidirectional: options.bidirectional,
    sourceHandle: options.sourceHandle,
    targetHandle: options.targetHandle,
  };
}

function countConfidence(
  evidence: EvidenceDraft[],
): Partial<Record<ComponentDiagramConfidence, number>> {
  const counts: Partial<Record<ComponentDiagramConfidence, number>> = {};
  for (const draft of evidence) {
    counts[draft.confidence] = (counts[draft.confidence] ?? 0) + 1;
  }
  return counts;
}

function flowClientMessageEvidenceDraft(
  messageFlows: MessageFlow[],
  messageType: string,
): EvidenceDraft {
  const flow = messageFlows.find((candidate) => candidate.clientMessageType === messageType);
  const step = flow?.steps.find((candidate) => candidate.produces === messageType) ?? flow?.steps[0];

  return {
    kind: "message_flow",
    confidence: "exact",
    fileId: step?.fileId ?? "client/src/main.ts",
    line: step?.line,
    symbol: step?.method,
    detail: flow
      ? `${messageType} flow: ${flow.description}`
      : `Client message ${messageType} participates in the extracted browser/server protocol.`,
  };
}

function flowServerMessageEvidenceDraft(
  messageFlows: MessageFlow[],
  messageType: string,
): EvidenceDraft {
  const step = findFlowStep(
    messageFlows,
    (candidate) => candidate.producesKind === "serverMessage" && candidate.produces === messageType,
  );

  return {
    kind: "message_flow",
    confidence: step ? "exact" : "derived",
    fileId: step?.fileId ?? "server/src/network/websocket.ts",
    line: step?.line,
    symbol: step?.method,
    detail: step
      ? `${messageType} is emitted from ${step.method}() in the extracted message flow.`
      : `Server message ${messageType} is part of the browser/server contract.`,
  };
}

function commandEvidenceDraft(
  context: DiagramContext,
  commandType: string,
  filePrefix?: string,
): EvidenceDraft {
  const command = context.commands.find((candidate) => candidate.commandType === commandType);
  const producer = command?.producers.find((candidate) => !filePrefix || candidate.fileId.startsWith(filePrefix)) ?? command?.producers[0];
  return {
    kind: "command",
    confidence: producer ? "exact" : "derived",
    fileId: producer?.fileId ?? "server/src/engine/gameLoop.ts",
    line: producer?.line,
    symbol: producer?.classId,
    detail: producer
      ? `${commandType} is produced from ${producer.fileId}.`
      : `${commandType} participates in the engine command pipeline.`,
  };
}

function eventEvidenceDraft(
  events: EventInfo[],
  eventType: string,
  role: "emitters" | "subscribers",
  filePrefix?: string,
): EvidenceDraft {
  const eventInfo = events.find((candidate) => candidate.eventType === eventType);
  const site =
    (role === "emitters" ? eventInfo?.emitters : eventInfo?.subscribers).find((candidate) =>
      filePrefix ? candidate.fileId.startsWith(filePrefix) : true,
    ) ??
    (role === "emitters" ? eventInfo?.emitters[0] : eventInfo?.subscribers[0]);

  return {
    kind: "event",
    confidence: site ? "exact" : "derived",
    fileId: site?.fileId ?? "server/src/engine/gameLoop.ts",
    line: site?.line,
    symbol: site?.classId,
    detail: site
      ? `${eventType} appears in extracted ${role === "emitters" ? "emitters" : "subscribers"} from ${site.fileId}.`
      : `${eventType} participates in the runtime event graph.`,
  };
}

function derivePredictionMirrors(moduleFact: ModuleFact | undefined): string[] {
  if (!moduleFact) return ["tile collision", "player collision"];
  const fnNames = new Set(moduleFact.exportedFunctions);
  const nestedFunctionNames = new Set([
    ...fnNames,
    ...moduleFact.functionVariables.map((fact) => fact.functionName),
  ]);
  const lines: string[] = [];
  if (nestedFunctionNames.has("clientMoveWithCollision")) lines.push("tile collision");
  if (nestedFunctionNames.has("resolveClientPlayerCollision")) lines.push("player collision");
  if (fnNames.has("getHeldDirectionVector")) lines.push("held-input vector");
  return lines.slice(0, 3);
}

function deriveUiDomains(moduleFact: ModuleFact | undefined): string[] {
  if (!moduleFact) return ["chat", "player list", "conversation panel"];
  const lines: string[] = [];
  if (moduleFact.domElementIds.some((id) => id.startsWith("chat-"))) lines.push("chat");
  if (moduleFact.domElementIds.includes("player-list")) lines.push("player list");
  if (moduleFact.domElementIds.some((id) => id.startsWith("conversation-"))) lines.push("conversation panel");
  if (moduleFact.domElementIds.includes("status-bar")) lines.push("status bar");
  return dedupe(lines).slice(0, 4);
}

function deriveDebugSurface(moduleFact: ModuleFact | undefined): string[] {
  if (!moduleFact) return ["window.__AI_TOWN_CLIENT_DEBUG__", "getEvents()", "clear()"];
  const lines: string[] = [];
  const windowHandle = moduleFact.windowGlobals[0];
  if (windowHandle) lines.push(`window.${windowHandle}`);
  const allFunctionNames = new Set([
    ...moduleFact.exportedFunctions,
    ...moduleFact.functionVariables.map((fact) => fact.functionName),
  ]);
  if (allFunctionNames.has("getClientDebugEvents")) lines.push("getEvents()");
  if (allFunctionNames.has("clearClientDebugEvents")) lines.push("clear()");
  return dedupe(lines).slice(0, 3);
}

function deriveRouterPaths(moduleFact: ModuleFact | undefined): { get: string[]; post: string[] } {
  return moduleFact?.routerPaths ?? { get: [], post: [] };
}

function deriveSchemaSummary(moduleFact: ModuleFact | undefined): string[] {
  if (!moduleFact) return ["8 tables", "vector(1536)", "IVFFlat memory index"];
  const lines = [`${moduleFact.sqlTables.length} tables`];
  lines.push(...moduleFact.sqlFlags);
  return lines;
}

function deriveNpcResponsibilities(
  context: DiagramContext,
  fileId: string,
  className: string,
): string[] {
  const methodNames = new Set(getClassMethodNames(context, fileId, className));
  const lines: string[] = [];
  if (methodNames.has("scheduleReply")) lines.push("reply scheduling");
  if (methodNames.has("maybeInitiateConversations")) lines.push("initiation scans");
  if (methodNames.has("maybeReflect")) lines.push("reflection triggering");
  if (methodNames.has("persistConversationPlayers")) lines.push("persistence coordination");
  return lines;
}

function deriveMemoryResponsibilities(
  context: DiagramContext,
  fileId: string,
  className: string,
): string[] {
  const methodNames = new Set(getClassMethodNames(context, fileId, className));
  const lines: string[] = [];
  if (methodNames.has("retrieveMemories")) lines.push("composite scoring");
  if (methodNames.has("maybeReflect") || methodNames.has("addReflection")) lines.push("reflection logic");
  if (methodNames.has("rememberConversation")) lines.push("conversation summarization");
  return lines;
}

function getModuleFact(
  context: DiagramContext,
  fileId: string,
): ModuleFact | undefined {
  return context.factLookup.get(fileId);
}

function getFunctionVariableNames(
  moduleFact: ModuleFact | undefined,
  functionName: string,
): string[] {
  return moduleFact?.functionVariables.find((fact) => fact.functionName === functionName)?.variableNames ?? [];
}

function getClassFieldLabels(
  context: DiagramContext,
  fileId: string,
  className: string,
  aliases: Record<string, string>,
  orderedKeys?: string[],
): string[] {
  const cls = context.classLookup.get(`${fileId}:${className}`);
  if (!cls) return [];

  const fields = new Map(cls.fields.map((field) => [field.name, aliases[field.name] ?? field.name]));
  const keys = orderedKeys ?? Array.from(fields.keys());
  const result: string[] = [];

  for (const key of keys) {
    const label = fields.get(key);
    if (label) result.push(label);
  }

  return result;
}

function getClassMethodNames(
  context: DiagramContext,
  fileId: string,
  className: string,
  orderedNames?: string[],
): string[] {
  const cls = context.classLookup.get(`${fileId}:${className}`);
  if (!cls) return [];
  const names = cls.methods.map((method) => method.name);
  if (!orderedNames) return names;
  return orderedNames.filter((name) => names.includes(name));
}

function getSwitchCaseLabels(
  context: DiagramContext,
  moduleFact: ModuleFact | undefined,
  className: string,
  methodName: string,
): string[] {
  void context;
  return moduleFact?.switchCases.find(
    (switchCase) => switchCase.className === className && switchCase.methodName === methodName,
  )?.labels ?? [];
}

function eventTypesByFilePrefix(events: EventInfo[], prefix: string): string[] {
  return dedupe(
    events
      .filter((eventInfo) => eventInfo.emitters.some((emit) => emit.fileId.startsWith(prefix)))
      .map((eventInfo) => eventInfo.eventType),
  );
}

function eventTypesBySubscriberPrefix(events: EventInfo[], prefix: string): string[] {
  return dedupe(
    events
      .filter((eventInfo) => eventInfo.subscribers.some((subscriber) => subscriber.fileId.startsWith(prefix)))
      .map((eventInfo) => eventInfo.eventType),
  );
}

function commandTypesByProducerPrefix(commands: CommandInfo[], prefix: string): string[] {
  return dedupe(
    commands
      .filter((command) => command.producers.some((producer) => producer.fileId.startsWith(prefix)))
      .map((command) => command.commandType),
  );
}

function findFlowStep(
  messageFlows: MessageFlow[],
  predicate: (step: MessageFlow["steps"][number]) => boolean,
): MessageFlow["steps"][number] | undefined {
  for (const flow of messageFlows) {
    const match = flow.steps.find(predicate);
    if (match) return match;
  }
  return undefined;
}

function pickNames(names: string[], allowList: string[]): string[] {
  return allowList.filter((name) => names.includes(name));
}

function dedupe(values: string[]): string[] {
  return Array.from(new Set(values.filter(Boolean)));
}

function dedupeLines(lines: ComponentDiagramLine[]): ComponentDiagramLine[] {
  const seen = new Set<string>();
  const deduped: ComponentDiagramLine[] = [];
  for (const lineItem of lines) {
    const key = `${lineItem.kind}:${lineItem.text}`;
    if (seen.has(key)) continue;
    seen.add(key);
    deduped.push(lineItem);
  }
  return deduped;
}

function sanitizeId(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, "-");
}

function placeRow(
  cards: ComponentDiagramCard[],
  startX: number,
  startY: number,
  gap: number,
): RowPlacement {
  let cursorX = startX;
  let maxHeight = 0;

  for (const card of cards) {
    card.position = { x: cursorX, y: startY };
    cursorX += card.size.width + gap;
    maxHeight = Math.max(maxHeight, card.size.height);
  }

  return {
    cards,
    nextY: startY + maxHeight,
  };
}

function buildBoundary(
  id: string,
  label: string,
  technology: string,
  description: string,
  color: string,
  position: { x: number; y: number },
  cards: ComponentDiagramCard[],
): ComponentDiagramBoundary {
  const headerHeight = 112;
  const padding = 36;
  let maxX = 0;
  let maxY = headerHeight;

  for (const card of cards) {
    maxX = Math.max(maxX, card.position.x + card.size.width);
    maxY = Math.max(maxY, card.position.y + card.size.height);
  }

  return {
    id,
    label,
    technology,
    description,
    color,
    position,
    size: {
      width: maxX + padding,
      height: maxY + padding,
    },
  };
}
