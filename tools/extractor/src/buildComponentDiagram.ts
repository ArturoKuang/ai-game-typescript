import type {
  ClassInfo,
  CommandInfo,
  ComponentDiagram,
  ComponentDiagramBoundary,
  ComponentDiagramCard,
  ComponentDiagramConfidence,
  ComponentDiagramContainer,
  ComponentDiagramEdge,
  ComponentDiagramEvidence,
  ComponentDiagramLine,
  ComponentDiagramLineKind,
  ComponentDiagramMetric,
  ComponentDiagramMiniCard,
  ComponentDiagramOpenTarget,
  ComponentDiagramRelationshipKind,
  ComponentDiagramSection,
  ComponentDiagramSystem,
  ComponentDiagramView,
  EventInfo,
  FileAccessFact,
  HttpRequestFact,
  HttpRouteFact,
  ImportEdge,
  MessageFlow,
  ModuleFact,
  SqlOperationFact,
} from "./types.js";

const VIEW_BROWSER_CLIENT = "component-view-browser-client";
const VIEW_GAME_SERVER = "component-view-game-server";

const SYSTEM_BROWSER_CLIENT = `${VIEW_BROWSER_CLIENT}-system`;
const SYSTEM_GAME_SERVER = `${VIEW_GAME_SERVER}-system`;

const BOUNDARY_BROWSER_CLIENT = `${VIEW_BROWSER_CLIENT}-boundary`;
const BOUNDARY_GAME_SERVER = `${VIEW_GAME_SERVER}-boundary`;

const CONTAINER_BROWSER_GAME_SERVER = `${VIEW_BROWSER_CLIENT}-container-game-server`;

const CONTAINER_SERVER_BROWSER_CLIENT = `${VIEW_GAME_SERVER}-container-browser-client`;
const CONTAINER_SERVER_POSTGRES = `${VIEW_GAME_SERVER}-container-postgres`;
const CONTAINER_SERVER_WORLD_DATA = `${VIEW_GAME_SERVER}-container-world-data`;

const CARD_BROWSER_APP_SHELL = `${VIEW_BROWSER_CLIENT}-app-shell`;
const CARD_BROWSER_TRANSPORT = `${VIEW_BROWSER_CLIENT}-transport-client`;
const CARD_BROWSER_RENDER = `${VIEW_BROWSER_CLIENT}-render-pipeline`;
const CARD_BROWSER_PREDICTION = `${VIEW_BROWSER_CLIENT}-prediction-engine`;
const CARD_BROWSER_UI = `${VIEW_BROWSER_CLIENT}-conversation-ui`;

const CARD_SERVER_WEBSOCKET = `${VIEW_GAME_SERVER}-websocket-gateway`;
const CARD_SERVER_DEBUG = `${VIEW_GAME_SERVER}-debug-api`;
const CARD_SERVER_SIMULATION = `${VIEW_GAME_SERVER}-simulation-core`;
const CARD_SERVER_NPC = `${VIEW_GAME_SERVER}-npc-orchestration`;
const CARD_SERVER_PERSISTENCE = `${VIEW_GAME_SERVER}-persistence-adapters`;

const MAX_CANVAS_LINES_PER_SECTION = 3;

const COLORS = {
  system: "#8b5cf6",
  client: "#FE6100",
  server: "#648FFF",
  network: "#22D3EE",
  engine: "#648FFF",
  npc: "#DC267F",
  persistence: "#FFB000",
  debug: "#d1d5db",
  datastore: "#14b8a6",
} as const;

interface DiagramInput {
  classes: ClassInfo[];
  moduleFacts: ModuleFact[];
  imports: ImportEdge[];
  events: EventInfo[];
  commands: CommandInfo[];
  messageFlows: MessageFlow[];
  httpRoutes: HttpRouteFact[];
  httpRequests: HttpRequestFact[];
  fileAccesses: FileAccessFact[];
  sqlOperations: SqlOperationFact[];
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
  httpRoutes: HttpRouteFact[];
  httpRequests: HttpRequestFact[];
  fileAccesses: FileAccessFact[];
  sqlOperations: SqlOperationFact[];
  evidenceBuilder: EvidenceBuilder;
}

interface ViewBuildResult {
  view: ComponentDiagramView;
  system: ComponentDiagramSystem;
  boundary: ComponentDiagramBoundary;
  containers: ComponentDiagramContainer[];
  cards: ComponentDiagramCard[];
  edges: ComponentDiagramEdge[];
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
    httpRoutes: input.httpRoutes,
    httpRequests: input.httpRequests,
    fileAccesses: input.fileAccesses,
    sqlOperations: input.sqlOperations,
    evidenceBuilder: new EvidenceBuilder(),
  };

  const browserClientView = buildBrowserClientView(context);
  const gameServerView = buildGameServerView(context);

  return {
    defaultViewId: VIEW_GAME_SERVER,
    views: [browserClientView.view, gameServerView.view],
    systems: [browserClientView.system, gameServerView.system],
    boundaries: [browserClientView.boundary, gameServerView.boundary],
    containers: [...browserClientView.containers, ...gameServerView.containers],
    cards: [...browserClientView.cards, ...gameServerView.cards],
    edges: [...browserClientView.edges, ...gameServerView.edges],
    evidence: context.evidenceBuilder.evidence,
  };
}

function buildBrowserClientView(context: DiagramContext): ViewBuildResult {
  const cards = buildBrowserClientCards(context);
  const topRow = placeRow([cards.appShell, cards.transport], 44, 116, 28);
  placeRow([cards.render, cards.prediction, cards.ui], 44, topRow.nextY + 74, 28);

  const boundary = buildBoundary(
    VIEW_BROWSER_CLIENT,
    BOUNDARY_BROWSER_CLIENT,
    "Browser Client",
    "TypeScript, PixiJS, Browser APIs",
    "Application container that renders the town, captures player input, predicts local movement, and keeps the browser UI synchronized with server state.",
    COLORS.client,
    { x: 44, y: 118 },
    Object.values(cards),
  );

  const containers = [
    createContextContainer({
      id: CONTAINER_BROWSER_GAME_SERVER,
      viewId: VIEW_BROWSER_CLIENT,
      containerId: "container-game-server",
      name: "Game Server",
      technology: "Node.js, Express, ws",
      description: "Authoritative server container that receives player input, serves startup JSON, and streams back runtime updates.",
      color: COLORS.server,
      kind: "application",
      position: { x: 1088, y: 300 },
      size: { width: 300, height: 186 },
    }),
  ];

  const system = buildSystem(
    VIEW_BROWSER_CLIENT,
    SYSTEM_BROWSER_CLIENT,
    "AI Town",
    "Software system boundary. This component diagram zooms into the Browser Client container while repeating the directly related runtime container for continuity.",
    COLORS.system,
    boundary,
    containers,
  );

  const view: ComponentDiagramView = {
    id: VIEW_BROWSER_CLIENT,
    containerId: "container-browser-client",
    name: "Browser Client",
    description: "C4 component diagram for the Browser Client container.",
    systemId: system.id,
    boundaryId: boundary.id,
  };

  const edges = buildBrowserClientEdges(context);

  return {
    view,
    system,
    boundary,
    containers,
    cards: Object.values(cards),
    edges,
  };
}

function buildGameServerView(context: DiagramContext): ViewBuildResult {
  const cards = buildGameServerCards(context);
  const topRow = placeRow([cards.websocket, cards.debug], 44, 108, 26);
  cards.simulation.position = { x: 44, y: topRow.nextY + 68 };
  placeRow([cards.npc, cards.persistence], 44, cards.simulation.position.y + cards.simulation.size.height + 74, 28);

  const boundary = buildBoundary(
    VIEW_GAME_SERVER,
    BOUNDARY_GAME_SERVER,
    "Game Server",
    "Node.js, TypeScript, Express, ws",
    "Application container that owns the authoritative simulation, WebSocket and HTTP/debug transport surfaces, NPC orchestration, and access to persistent and file-backed data.",
    COLORS.server,
    { x: 326, y: 118 },
    Object.values(cards),
  );

  const containers = [
    createContextContainer({
      id: CONTAINER_SERVER_BROWSER_CLIENT,
      viewId: VIEW_GAME_SERVER,
      containerId: "container-browser-client",
      name: "Browser Client",
      technology: "TypeScript, PixiJS, Browser APIs",
      description: "Browser application that sends player input and consumes authoritative runtime updates.",
      color: COLORS.client,
      kind: "application",
      position: { x: 42, y: 298 },
      size: { width: 260, height: 178 },
    }),
    createContextContainer({
      id: CONTAINER_SERVER_POSTGRES,
      viewId: VIEW_GAME_SERVER,
      containerId: "container-postgres",
      name: "PostgreSQL + pgvector",
      technology: "SQL, pgvector",
      description: "Optional durable datastore for memories, conversations, player records, and generation metadata.",
      color: COLORS.persistence,
      kind: "datastore",
      position: { x: 1298, y: 238 },
      size: { width: 300, height: 186 },
    }),
    createContextContainer({
      id: CONTAINER_SERVER_WORLD_DATA,
      viewId: VIEW_GAME_SERVER,
      containerId: "container-world-data",
      name: "World Data Files",
      technology: "JSON and TypeScript files",
      description: "Static map and NPC seed artifacts loaded during startup and map serving.",
      color: COLORS.datastore,
      kind: "datastore",
      position: { x: 1298, y: 532 },
      size: { width: 300, height: 186 },
    }),
  ];

  const system = buildSystem(
    VIEW_GAME_SERVER,
    SYSTEM_GAME_SERVER,
    "AI Town",
    "Software system boundary. This component diagram zooms into the Game Server container while repeating the surrounding runtime containers for continuity.",
    COLORS.system,
    boundary,
    containers,
  );

  const view: ComponentDiagramView = {
    id: VIEW_GAME_SERVER,
    containerId: "container-game-server",
    name: "Game Server",
    description: "C4 component diagram for the Game Server container.",
    systemId: system.id,
    boundaryId: boundary.id,
  };

  const edges = buildGameServerEdges(context);

  return {
    view,
    system,
    boundary,
    containers,
    cards: Object.values(cards),
    edges,
  };
}

function buildBrowserClientCards(context: DiagramContext): {
  appShell: ComponentDiagramCard;
  transport: ComponentDiagramCard;
  render: ComponentDiagramCard;
  prediction: ComponentDiagramCard;
  ui: ComponentDiagramCard;
} {
  const mainFile = getModuleFact(context, "client/src/main.ts");
  const networkFile = getModuleFact(context, "client/src/network.ts");
  const rendererFile = getModuleFact(context, "client/src/renderer.ts");
  const predictionFile = getModuleFact(context, "client/src/prediction.ts");
  const uiFile = getModuleFact(context, "client/src/ui.ts");

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
      activityContainer: "activities",
      lineContainer: "conversation lines",
      playerContainer: "player sprites",
      playerSprites: "sprite registry",
    },
    ["tileContainer", "activityContainer", "lineContainer", "playerContainer", "playerSprites"],
  );

  const predictionMirrors = derivePredictionMirrors(predictionFile);
  const uiDomains = deriveUiDomains(uiFile);

  return {
    appShell: createCard({
      viewId: VIEW_BROWSER_CLIENT,
      boundaryId: BOUNDARY_BROWSER_CLIENT,
      id: CARD_BROWSER_APP_SHELL,
      title: "App Shell",
      subtitle: "TypeScript + browser APIs",
      fileId: "client/src/main.ts",
      accentColor: COLORS.client,
      width: 376,
      summary:
        "Bootstraps rendering, transport, prediction, and DOM UI; owns browser-side game state; and reconciles authoritative server updates into the local experience.",
      sections: orderedSections([
        section(
          "owns",
          "Owns",
          mainState.map((name) => variableLine(context, CARD_BROWSER_APP_SHELL, "client/src/main.ts", name)),
        ),
        section(
          "ingress",
          "Ingress",
          [
            httpRequestLine(context, CARD_BROWSER_APP_SHELL, "GET", "/data/map.json"),
            httpRequestLine(context, CARD_BROWSER_APP_SHELL, "GET", "/api/debug/activities"),
            flowServerMessageLine(context, CARD_BROWSER_APP_SHELL, "state"),
            flowServerMessageLine(context, CARD_BROWSER_APP_SHELL, "player_update"),
            flowServerMessageLine(context, CARD_BROWSER_APP_SHELL, "convo_update"),
          ],
        ),
        section(
          "egress",
          "Egress",
          pickNames(clientMessageTypes, [
            "join",
            "move",
            "input_start",
            "input_stop",
            "start_convo",
            "accept_convo",
            "decline_convo",
            "say",
            "end_convo",
          ]).map((messageType) => flowClientMessageLine(context, CARD_BROWSER_APP_SHELL, messageType)),
        ),
        section(
          "depends-on",
          "Depends On",
          [
            derivedLine(context, CARD_BROWSER_APP_SHELL, "Transport Client", "dependency", "client/src/main.ts", "App shell creates the WebSocket client and routes messages through it."),
            derivedLine(context, CARD_BROWSER_APP_SHELL, "Render Pipeline", "dependency", "client/src/main.ts", "App shell pushes synchronized state into the renderer."),
            derivedLine(context, CARD_BROWSER_APP_SHELL, "Prediction Engine", "dependency", "client/src/main.ts", "App shell feeds held input into client-side prediction and applies reconciliation."),
            derivedLine(context, CARD_BROWSER_APP_SHELL, "Conversation UI", "dependency", "client/src/main.ts", "App shell renders conversation/player state into the DOM UI and receives UI callbacks."),
          ],
        ),
        section(
          "internals",
          "Internals",
          [
            exactLine(context, CARD_BROWSER_APP_SHELL, "start()", "internal", "client/src/main.ts", "start() bootstraps the browser client runtime.", "start"),
            exactLine(context, CARD_BROWSER_APP_SHELL, "refreshConversationUi()", "internal", "client/src/main.ts", "App shell recomputes who is talkable and which conversation panel state to show.", "refreshConversationUi"),
            exactLine(context, CARD_BROWSER_APP_SHELL, "describeConversationUpdate()", "internal", "client/src/main.ts", "App shell derives system chat messages from conversation state transitions.", "describeConversationUpdate"),
          ],
        ),
      ]),
      openNext: [
        openTarget("main.ts", "client/src/main.ts", "Composition point for browser state, transport wiring, reconciliation, and UI updates."),
        openTarget("network.ts", "client/src/network.ts", "Shows how client messages leave the browser and how server messages come back in."),
        openTarget("prediction.ts", "client/src/prediction.ts", "Contains the client-side movement mirror that main.ts drives."),
        openTarget("ui.ts", "client/src/ui.ts", "Contains the DOM surface that app shell updates and listens to."),
      ],
    }),
    transport: createCard({
      viewId: VIEW_BROWSER_CLIENT,
      boundaryId: BOUNDARY_BROWSER_CLIENT,
      id: CARD_BROWSER_TRANSPORT,
      title: "Transport Client",
      subtitle: "WebSocket",
      fileId: "client/src/network.ts",
      accentColor: COLORS.network,
      width: 302,
      summary:
        "Owns the browser WebSocket connection, message handler registry, reconnect behavior, and JSON serialization for the client/server protocol.",
      sections: orderedSections([
        section(
          "owns",
          "Owns",
          [
            exactLine(context, CARD_BROWSER_TRANSPORT, "WebSocket connection", "state", "client/src/network.ts", "GameClient stores the active browser WebSocket instance.", "GameClient"),
            exactLine(context, CARD_BROWSER_TRANSPORT, "message handlers", "state", "client/src/network.ts", "GameClient keeps an in-memory list of onMessage handlers.", "GameClient"),
            exactLine(context, CARD_BROWSER_TRANSPORT, "server URL", "state", "client/src/network.ts", "GameClient resolves the WebSocket URL from the browser location.", "GameClient"),
          ],
        ),
        section(
          "ingress",
          "Ingress",
          pickNames(serverMessageTypes, ["state", "player_update", "convo_update", "message", "tick", "error"]).map((messageType) =>
            flowServerMessageLine(context, CARD_BROWSER_TRANSPORT, messageType),
          ),
        ),
        section(
          "egress",
          "Egress",
          pickNames(clientMessageTypes, ["join", "move", "input_start", "input_stop", "start_convo", "say", "end_convo"]).map((messageType) =>
            flowClientMessageLine(context, CARD_BROWSER_TRANSPORT, messageType),
          ),
        ),
        section(
          "depends-on",
          "Depends On",
          [
            derivedLine(context, CARD_BROWSER_TRANSPORT, "browser WebSocket", "dependency", "client/src/network.ts", "Transport client depends on the browser WebSocket API."),
            derivedLine(context, CARD_BROWSER_TRANSPORT, "protocol message types", "dependency", "client/src/network.ts", "Transport client serializes and parses the browser/server message contract."),
          ],
        ),
        section(
          "internals",
          "Internals",
          [
            exactLine(context, CARD_BROWSER_TRANSPORT, "connect()", "internal", "client/src/network.ts", "connect() opens the browser WebSocket and installs lifecycle handlers.", "connect"),
            exactLine(context, CARD_BROWSER_TRANSPORT, "send()", "internal", "client/src/network.ts", "send() serializes ClientMessage payloads to JSON.", "send"),
            exactLine(context, CARD_BROWSER_TRANSPORT, "onMessage()", "internal", "client/src/network.ts", "onMessage() registers browser-side message listeners.", "onMessage"),
          ],
        ),
      ]),
      openNext: [
        openTarget("network.ts", "client/src/network.ts", "Socket lifecycle, reconnect behavior, and protocol send/receive live here."),
        openTarget("main.ts", "client/src/main.ts", "Shows which browser actions produce client messages and how incoming messages are handled."),
        openTarget("server/src/network/websocket.ts", "server/src/network/websocket.ts", "Counterpart transport component on the server side."),
      ],
    }),
    render: createCard({
      viewId: VIEW_BROWSER_CLIENT,
      boundaryId: BOUNDARY_BROWSER_CLIENT,
      id: CARD_BROWSER_RENDER,
      title: "Render Pipeline",
      subtitle: "PixiJS 8",
      fileId: "client/src/renderer.ts",
      accentColor: COLORS.client,
      width: 286,
      summary:
        "Projects the current game state into a Pixi scene graph: tiles, activity markers, conversation lines, player sprites, and chat bubbles.",
      sections: orderedSections([
        section(
          "owns",
          "Owns",
          rendererLayers.map((name) => classFieldLine(context, CARD_BROWSER_RENDER, "client/src/renderer.ts", "GameRenderer", name)),
        ),
        section(
          "ingress",
          "Ingress",
          [
            derivedLine(context, CARD_BROWSER_RENDER, "map tiles + activities", "message", "client/src/renderer.ts", "Renderer consumes map tiles and activity fixtures from app shell startup."),
            derivedLine(context, CARD_BROWSER_RENDER, "player snapshots", "message", "client/src/renderer.ts", "Renderer consumes synchronized player state and local prediction output."),
            derivedLine(context, CARD_BROWSER_RENDER, "conversation overlays", "message", "client/src/renderer.ts", "Renderer draws active conversation lines and transient chat bubbles."),
          ],
        ),
        section(
          "egress",
          "Egress",
          [
            exactLine(context, CARD_BROWSER_RENDER, "screenToTile()", "message", "client/src/renderer.ts", "Renderer converts pointer coordinates into tile coordinates for click-to-move.", "screenToTile"),
            derivedLine(context, CARD_BROWSER_RENDER, "sprite placement", "message", "client/src/renderer.ts", "Renderer updates sprite positions inside the Pixi container graph."),
            derivedLine(context, CARD_BROWSER_RENDER, "chat bubble updates", "message", "client/src/renderer.ts", "Renderer renders temporary chat bubbles over actors."),
          ],
        ),
        section(
          "depends-on",
          "Depends On",
          [
            derivedLine(context, CARD_BROWSER_RENDER, "Pixi container graph", "dependency", "client/src/renderer.ts", "Render pipeline depends on a layered Pixi scene graph."),
            derivedLine(context, CARD_BROWSER_RENDER, "App Shell state", "dependency", "client/src/renderer.ts", "Render pipeline redraws from browser-side game state owned by app shell."),
          ],
        ),
        section(
          "internals",
          "Internals",
          [
            exactLine(context, CARD_BROWSER_RENDER, "renderMap()", "internal", "client/src/renderer.ts", "renderMap() builds the tile grid and activity layer.", "renderMap"),
            exactLine(context, CARD_BROWSER_RENDER, "updatePlayers()", "internal", "client/src/renderer.ts", "updatePlayers() updates sprites, smoothing, and conversation lines.", "updatePlayers"),
            exactLine(context, CARD_BROWSER_RENDER, "showChatBubble()", "internal", "client/src/renderer.ts", "showChatBubble() renders transient speech bubbles over actors.", "showChatBubble"),
          ],
        ),
      ]),
      openNext: [
        openTarget("renderer.ts", "client/src/renderer.ts", "Shows how synchronized state becomes visuals and click targets."),
        openTarget("main.ts", "client/src/main.ts", "Feeds state and input into the render pipeline."),
      ],
    }),
    prediction: createCard({
      viewId: VIEW_BROWSER_CLIENT,
      boundaryId: BOUNDARY_BROWSER_CLIENT,
      id: CARD_BROWSER_PREDICTION,
      title: "Prediction Engine",
      subtitle: "TypeScript movement mirror",
      fileId: "client/src/prediction.ts",
      accentColor: COLORS.client,
      width: 286,
      summary:
        "Mirrors the server movement rules in the browser so held-key input feels immediate while the authoritative server remains the source of truth.",
      sections: orderedSections([
        section(
          "owns",
          "Owns",
          [
            exactLine(context, CARD_BROWSER_PREDICTION, "MOVE_SPEED", "state", "client/src/prediction.ts", "Client prediction defines MOVE_SPEED to mirror the server input speed."),
            exactLine(context, CARD_BROWSER_PREDICTION, "PLAYER_RADIUS", "state", "client/src/prediction.ts", "Client prediction defines PLAYER_RADIUS to mirror the server collision radius."),
            ...predictionMirrors.map((name) =>
              derivedLine(context, CARD_BROWSER_PREDICTION, name, "state", "client/src/prediction.ts", `Prediction engine mirrors ${name} locally.`),
            ),
          ],
        ),
        section(
          "ingress",
          "Ingress",
          [
            flowClientMessageLine(context, CARD_BROWSER_PREDICTION, "input_start"),
            flowClientMessageLine(context, CARD_BROWSER_PREDICTION, "input_stop"),
            flowServerMessageLine(context, CARD_BROWSER_PREDICTION, "player_update"),
          ],
        ),
        section(
          "egress",
          "Egress",
          [
            exactLine(context, CARD_BROWSER_PREDICTION, "predictLocalPlayerStep()", "command", "client/src/prediction.ts", "predictLocalPlayerStep() produces the next local movement state.", "predictLocalPlayerStep"),
            exactLine(context, CARD_BROWSER_PREDICTION, "getHeldDirectionVector()", "message", "client/src/prediction.ts", "Prediction engine converts held directions into a normalized input vector.", "getHeldDirectionVector"),
          ],
        ),
        section(
          "depends-on",
          "Depends On",
          [
            derivedLine(context, CARD_BROWSER_PREDICTION, "server parity rules", "dependency", "client/src/prediction.ts", "Prediction stays useful only while it mirrors the authoritative GameLoop movement rules."),
            derivedLine(context, CARD_BROWSER_PREDICTION, "tile collision", "dependency", "client/src/prediction.ts", "Prediction engine reproduces the server tile collision behavior."),
            derivedLine(context, CARD_BROWSER_PREDICTION, "player collision", "dependency", "client/src/prediction.ts", "Prediction engine reproduces the server player collision behavior."),
          ],
        ),
        section(
          "internals",
          "Internals",
          [
            exactLine(context, CARD_BROWSER_PREDICTION, "predictLocalPlayerStep()", "internal", "client/src/prediction.ts", "Primary prediction entry point for one local frame of movement.", "predictLocalPlayerStep"),
            exactLine(context, CARD_BROWSER_PREDICTION, "clientMoveWithCollision()", "internal", "client/src/prediction.ts", "Mirrors server-side collision resolution for map tiles.", "clientMoveWithCollision"),
            exactLine(context, CARD_BROWSER_PREDICTION, "resolveClientPlayerCollision()", "internal", "client/src/prediction.ts", "Mirrors server-side player collision resolution.", "resolveClientPlayerCollision"),
          ],
        ),
      ]),
      openNext: [
        openTarget("prediction.ts", "client/src/prediction.ts", "Contains the client-side movement mirror and local collision logic."),
        openTarget("server/src/engine/gameLoop.ts", "server/src/engine/gameLoop.ts", "Authoritative movement rules that prediction mirrors."),
      ],
    }),
    ui: createCard({
      viewId: VIEW_BROWSER_CLIENT,
      boundaryId: BOUNDARY_BROWSER_CLIENT,
      id: CARD_BROWSER_UI,
      title: "Conversation UI",
      subtitle: "DOM APIs",
      fileId: "client/src/ui.ts",
      accentColor: COLORS.client,
      width: 286,
      summary:
        "Owns the browser sidebar surfaces for player discovery, chat, conversation controls, and status, then exposes callbacks back into the app shell.",
      sections: orderedSections([
        section(
          "owns",
          "Owns",
          uiDomains.map((name) =>
            derivedLine(context, CARD_BROWSER_UI, name, "state", "client/src/ui.ts", `Conversation UI owns the ${name} surface in the DOM sidebar.`),
          ),
        ),
        section(
          "ingress",
          "Ingress",
          pickNames(serverMessageTypes, ["convo_update", "message", "player_update"]).map((messageType) =>
            flowServerMessageLine(context, CARD_BROWSER_UI, messageType),
          ),
        ),
        section(
          "egress",
          "Egress",
          pickNames(clientMessageTypes, ["start_convo", "accept_convo", "decline_convo", "say", "end_convo"]).map((messageType) =>
            flowClientMessageLine(context, CARD_BROWSER_UI, messageType),
          ),
        ),
        section(
          "depends-on",
          "Depends On",
          [
            derivedLine(context, CARD_BROWSER_UI, "App Shell callbacks", "dependency", "client/src/ui.ts", "Conversation UI depends on callbacks supplied by app shell."),
            derivedLine(context, CARD_BROWSER_UI, "DOM controls", "dependency", "client/src/ui.ts", "Conversation UI depends on fixed DOM element ids defined in index.html."),
          ],
        ),
        section(
          "internals",
          "Internals",
          [
            exactLine(context, CARD_BROWSER_UI, "updatePlayerList()", "internal", "client/src/ui.ts", "Renders talkable players and talk actions into the sidebar.", "updatePlayerList"),
            exactLine(context, CARD_BROWSER_UI, "renderConversationPanel()", "internal", "client/src/ui.ts", "Renders invite, active chat, and idle conversation panel states.", "renderConversationPanel"),
            exactLine(context, CARD_BROWSER_UI, "addChatMessage()", "internal", "client/src/ui.ts", "Adds user or system chat messages to the sidebar log.", "addChatMessage"),
          ],
        ),
      ]),
      openNext: [
        openTarget("ui.ts", "client/src/ui.ts", "DOM surfaces and user callbacks for conversations live here."),
        openTarget("main.ts", "client/src/main.ts", "App shell supplies state and callbacks to the UI component."),
      ],
    }),
  };
}

function buildGameServerCards(context: DiagramContext): {
  websocket: ComponentDiagramCard;
  debug: ComponentDiagramCard;
  simulation: ComponentDiagramCard;
  npc: ComponentDiagramCard;
  persistence: ComponentDiagramCard;
} {
  const websocketFile = getModuleFact(context, "server/src/network/websocket.ts");
  const routerFile = getModuleFact(context, "server/src/debug/router.ts");
  const schemaFile = getModuleFact(context, "server/src/db/schema.sql");
  const orchestratorFile = getModuleFact(context, "server/src/npc/orchestrator.ts");

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
    ["spawn", "despawn", "player_update", "input_move", "convo_started", "convo_active", "convo_ended", "convo_message", "tick_complete"],
  );
  const engineCommands = pickNames(
    commandTypesByProducerPrefix(context.commands, "server/src/"),
    ["spawn", "move_to", "start_convo", "accept_convo", "decline_convo", "say", "end_convo", "remove"],
  );
  const npcIngressEvents = pickNames(
    eventTypesBySubscriberPrefix(context.events, "server/src/npc/"),
    ["spawn", "despawn", "convo_started", "convo_active", "convo_ended", "convo_message", "tick_complete"],
  );
  const npcCommands = pickNames(
    commandTypesByProducerPrefix(context.commands, "server/src/npc/"),
    ["start_convo", "say", "end_convo"],
  );

  const orchestratorState = getClassFieldLabels(
    context,
    "server/src/npc/orchestrator.ts",
    "NpcOrchestrator",
    {
      runtimes: "runtime sessions",
      lastInitiatedAt: "initiation cooldowns",
      lastReflectionIds: "reflection checkpoints",
      reflectionInFlight: "reflection in-flight set",
      humanJoinTicks: "recent human joins",
    },
    ["runtimes", "lastInitiatedAt", "lastReflectionIds", "reflectionInFlight", "humanJoinTicks"],
  );

  return {
    websocket: createCard({
      viewId: VIEW_GAME_SERVER,
      boundaryId: BOUNDARY_GAME_SERVER,
      id: CARD_SERVER_WEBSOCKET,
      title: "WebSocket Gateway",
      subtitle: "ws 8",
      fileId: "server/src/network/websocket.ts",
      accentColor: COLORS.network,
      width: 388,
      summary:
        "Accepts browser sockets, translates incoming client messages into engine mutations, and fans authoritative game events back out as public server messages.",
      sections: orderedSections([
        section(
          "owns",
          "Owns",
          [
            exactLine(context, CARD_SERVER_WEBSOCKET, "clients map", "state", "server/src/network/websocket.ts", "GameWebSocketServer owns the socket registry.", "GameWebSocketServer"),
            exactLine(context, CARD_SERVER_WEBSOCKET, "player/socket mapping", "state", "server/src/network/websocket.ts", "GameWebSocketServer maps sockets to player ids.", "GameWebSocketServer"),
          ],
        ),
        section(
          "ingress",
          "Ingress",
          pickNames(networkCases, ["join", "move", "start_convo", "accept_convo", "decline_convo", "say", "input_start", "input_stop", "end_convo"]).map((messageType) =>
            flowClientMessageLine(context, CARD_SERVER_WEBSOCKET, messageType),
          ),
        ),
        section(
          "egress",
          "Egress",
          pickNames(websocketServerMessages, ["state", "player_joined", "player_left", "player_update", "convo_update", "message", "tick", "error"]).map((messageType) =>
            flowServerMessageLine(context, CARD_SERVER_WEBSOCKET, messageType),
          ),
        ),
        section(
          "depends-on",
          "Depends On",
          [
            derivedLine(context, CARD_SERVER_WEBSOCKET, "Simulation Core", "dependency", "server/src/network/websocket.ts", "WebSocket gateway mutates and observes the authoritative simulation core."),
            derivedLine(context, CARD_SERVER_WEBSOCKET, "protocol unions", "dependency", "server/src/network/websocket.ts", "WebSocket routing is constrained by the client/server protocol types."),
          ],
        ),
        section(
          "internals",
          "Internals",
          [
            exactLine(context, CARD_SERVER_WEBSOCKET, "onMessage()", "internal", "server/src/network/websocket.ts", "Routes incoming ClientMessage payloads into engine actions.", "onMessage"),
            exactLine(context, CARD_SERVER_WEBSOCKET, "broadcastGameEvent()", "internal", "server/src/network/websocket.ts", "Translates authoritative GameEvent values into public ServerMessage payloads.", "broadcastGameEvent"),
            exactLine(context, CARD_SERVER_WEBSOCKET, "toPublicPlayer()", "internal", "server/src/network/websocket.ts", "Scrubs internal movement fields before player data leaves the server.", "toPublicPlayer"),
          ],
        ),
      ]),
      openNext: [
        openTarget("websocket.ts", "server/src/network/websocket.ts", "Socket registry, protocol routing, and event fanout live here."),
        openTarget("protocol.ts", "server/src/network/protocol.ts", "Defines the transport message contract routed by the gateway."),
        openTarget("gameLoop.ts", "server/src/engine/gameLoop.ts", "Authoritative target of the commands and input mutations coming from transport."),
      ],
    }),
    debug: createCard({
      viewId: VIEW_GAME_SERVER,
      boundaryId: BOUNDARY_GAME_SERVER,
      id: CARD_SERVER_DEBUG,
      title: "Debug API",
      subtitle: "Express 4",
      fileId: "server/src/debug/router.ts",
      accentColor: COLORS.debug,
      width: 360,
      summary:
        "Exposes HTTP read/control routes for local inspection, harnesses, scenario setup, and a small set of direct conversation mutations.",
      sections: orderedSections([
        section(
          "owns",
          "Owns",
          [
            exactLine(context, CARD_SERVER_DEBUG, "GET debug routes", "state", "server/src/debug/router.ts", "Debug router owns read-only inspection endpoints.", "createDebugRouter"),
            exactLine(context, CARD_SERVER_DEBUG, "POST debug routes", "state", "server/src/debug/router.ts", "Debug router owns mutation endpoints for runtime control.", "createDebugRouter"),
          ],
        ),
        section(
          "ingress",
          "Ingress",
          [
            ...pickNames(routeGroups.get, ["state", "map", "players", "activities", "log", "scenarios", "conversations"]).map((path) =>
              httpRouteLine(context, CARD_SERVER_DEBUG, "GET", `/${path}`),
            ),
            ...pickNames(routeGroups.post, ["tick", "spawn", "move", "input", "reset", "scenario", "start-convo", "say", "end-convo"]).map((path) =>
              httpRouteLine(context, CARD_SERVER_DEBUG, "POST", `/${path}`),
            ),
          ],
        ),
        section(
          "egress",
          "Egress",
          [
            derivedLine(context, CARD_SERVER_DEBUG, "JSON snapshots", "message", "server/src/debug/router.ts", "GET routes serialize current runtime state into JSON or ASCII."),
            derivedLine(context, CARD_SERVER_DEBUG, "queued engine mutations", "command", "server/src/debug/router.ts", "Some POST routes mutate the simulation through normal GameLoop paths."),
            derivedLine(context, CARD_SERVER_DEBUG, "direct conversation mutations", "command", "server/src/debug/router.ts", "Conversation debug routes bypass the normal queue path and mutate conversation state directly."),
          ],
        ),
        section(
          "depends-on",
          "Depends On",
          [
            derivedLine(context, CARD_SERVER_DEBUG, "Simulation Core", "dependency", "server/src/debug/router.ts", "Debug API reads and mutates authoritative runtime state."),
            derivedLine(context, CARD_SERVER_DEBUG, "ASCII map renderer", "dependency", "server/src/debug/router.ts", "Debug API uses renderAsciiMap() for a text-based map snapshot."),
            derivedLine(context, CARD_SERVER_DEBUG, "scenario presets", "dependency", "server/src/debug/router.ts", "Debug API can reset into named scenario presets."),
          ],
        ),
        section(
          "internals",
          "Internals",
          [
            exactLine(context, CARD_SERVER_DEBUG, "createDebugRouter()", "internal", "server/src/debug/router.ts", "Registers the debug read/control route surface.", "createDebugRouter"),
            exactLine(context, CARD_SERVER_DEBUG, "renderAsciiMap()", "internal", "server/src/debug/router.ts", "Produces the ASCII map snapshot served by GET /map.", "renderAsciiMap"),
            exactLine(context, CARD_SERVER_DEBUG, "persistPlayer()", "internal", "server/src/debug/router.ts", "Persists spawned debug players when a database pool is available.", "persistPlayer"),
          ],
        ),
      ]),
      openNext: [
        openTarget("router.ts", "server/src/debug/router.ts", "Defines the full debug route surface and which routes are queued vs direct."),
        openTarget("asciiMap.ts", "server/src/debug/asciiMap.ts", "Defines the textual map view used by GET /map."),
        openTarget("scenarios.ts", "server/src/debug/scenarios.ts", "Named scenario presets live here."),
      ],
    }),
    simulation: createCard({
      viewId: VIEW_GAME_SERVER,
      boundaryId: BOUNDARY_GAME_SERVER,
      id: CARD_SERVER_SIMULATION,
      title: "Simulation Core",
      subtitle: "Pure TypeScript",
      accentColor: COLORS.engine,
      width: 860,
      summary:
        "Owns the authoritative tick-based state machine for movement, collisions, pathing, conversations, and event emission without any transport or database dependencies.",
      sections: orderedSections([
        section(
          "owns",
          "Owns",
          [
            ...getClassFieldLabels(
              context,
              "server/src/engine/gameLoop.ts",
              "GameLoop",
              {
                players_: "players_",
                heldKeys_: "heldKeys_",
                commandQueue_: "commandQueue_",
                eventHandlers: "eventHandlers",
                afterTickCallbacks: "afterTickCallbacks",
                logger_: "logger_",
                convoManager_: "convoManager_",
              },
              ["players_", "heldKeys_", "commandQueue_", "eventHandlers", "afterTickCallbacks", "logger_", "convoManager_"],
            ).map((name) =>
              classFieldLine(context, CARD_SERVER_SIMULATION, "server/src/engine/gameLoop.ts", "GameLoop", name),
            ),
          ],
        ),
        section(
          "ingress",
          "Ingress",
          [
            ...engineCommands.map((commandType) => commandLine(context, CARD_SERVER_SIMULATION, commandType)),
            exactLine(context, CARD_SERVER_SIMULATION, "setPlayerInput()", "command", "server/src/engine/gameLoop.ts", "Direct held-input path mutates authoritative input state inside GameLoop.", "setPlayerInput"),
          ],
        ),
        section(
          "egress",
          "Egress",
          engineEvents.map((eventType) => eventLine(context, CARD_SERVER_SIMULATION, eventType, "emitters")),
        ),
        section(
          "depends-on",
          "Depends On",
          [
            derivedLine(context, CARD_SERVER_SIMULATION, "pathfinding", "dependency", "server/src/engine/gameLoop.ts", "Simulation core delegates click-to-move path computation to A* helpers."),
            derivedLine(context, CARD_SERVER_SIMULATION, "collision", "dependency", "server/src/engine/gameLoop.ts", "Simulation core delegates tile and player collision resolution to collision helpers."),
            derivedLine(context, CARD_SERVER_SIMULATION, "SeededRNG", "dependency", "server/src/engine/gameLoop.ts", "Simulation core uses deterministic randomness for reproducible runs."),
          ],
        ),
        section(
          "internals",
          "Internals",
          [
            exactLine(context, CARD_SERVER_SIMULATION, "GameLoop", "internal", "server/src/engine/gameLoop.ts", "Primary authority for runtime state and tick processing.", "GameLoop"),
            exactLine(context, CARD_SERVER_SIMULATION, "World", "internal", "server/src/engine/world.ts", "Owns map tiles, activities, and spawn points.", "World"),
            exactLine(context, CARD_SERVER_SIMULATION, "ConversationManager", "internal", "server/src/engine/conversation.ts", "Owns the invite/walking/active/ended conversation state machine.", "ConversationManager"),
            exactLine(context, CARD_SERVER_SIMULATION, "GameLogger", "internal", "server/src/engine/logger.ts", "Captures the authoritative event ring buffer.", "GameLogger"),
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
              spawnPoints: "spawn points",
            },
            ["tiles", "activities", "spawnPoints"],
          ),
          "Owns the map grid, activity fixtures, and spawn points used by the authoritative simulation.",
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
          "Owns the invite, walking, active, and ended conversation lifecycle.",
        ),
        miniCard(
          "GameLogger",
          "logger.ts",
          "server/src/engine/logger.ts",
          ["ring buffer", "event filters", "debug reads"],
          "Captures the authoritative event history used by debug routes and harnesses.",
        ),
      ],
      openNext: [
        openTarget("gameLoop.ts", "server/src/engine/gameLoop.ts", "Authoritative commands, movement, conversations, and events are coordinated here."),
        openTarget("conversation.ts", "server/src/engine/conversation.ts", "Conversation lifecycle and message storage live here."),
        openTarget("world.ts", "server/src/engine/world.ts", "Defines the map and activity surfaces the simulation owns."),
      ],
    }),
    npc: createCard({
      viewId: VIEW_GAME_SERVER,
      boundaryId: BOUNDARY_GAME_SERVER,
      id: CARD_SERVER_NPC,
      title: "NPC Orchestration",
      subtitle: "Provider stack + memory retrieval",
      accentColor: COLORS.npc,
      width: 420,
      summary:
        "Listens to engine lifecycle events, schedules NPC replies and initiations, retrieves relevant memories, and coordinates persistence-facing memory and generation writes.",
      sections: orderedSections([
        section(
          "owns",
          "Owns",
          orchestratorState.map((name) =>
            classFieldLine(context, CARD_SERVER_NPC, "server/src/npc/orchestrator.ts", "NpcOrchestrator", name),
          ),
        ),
        section(
          "ingress",
          "Ingress",
          npcIngressEvents.map((eventType) => eventLine(context, CARD_SERVER_NPC, eventType, "subscribers")),
        ),
        section(
          "egress",
          "Egress",
          [
            ...npcCommands.map((commandType) => commandLine(context, CARD_SERVER_NPC, commandType)),
            derivedLine(context, CARD_SERVER_NPC, "memory writes + generation records", "command", "server/src/npc/orchestrator.ts", "NPC orchestration writes memories, conversations, and generation metadata through persistence adapters."),
          ],
        ),
        section(
          "depends-on",
          "Depends On",
          [
            derivedLine(context, CARD_SERVER_NPC, "MemoryManager", "dependency", "server/src/npc/orchestrator.ts", "NPC orchestration depends on memory retrieval and reflection helpers."),
            derivedLine(context, CARD_SERVER_NPC, "Resilient provider stack", "dependency", "server/src/index.ts", "NPC orchestration depends on the primary model provider plus scripted fallback."),
            derivedLine(context, CARD_SERVER_NPC, "Persistence Adapters", "dependency", "server/src/npc/orchestrator.ts", "NPC orchestration persists conversations, messages, and generation artifacts through persistence adapters."),
          ],
        ),
        section(
          "internals",
          "Internals",
          [
            exactLine(context, CARD_SERVER_NPC, "NpcOrchestrator", "internal", "server/src/npc/orchestrator.ts", "Coordinates subscriptions, reply timing, initiations, and reflections.", "NpcOrchestrator"),
            exactLine(context, CARD_SERVER_NPC, "MemoryManager", "internal", "server/src/npc/memory.ts", "Scores, summarizes, and persists memories used for NPC prompting.", "MemoryManager"),
            exactLine(context, CARD_SERVER_NPC, "ResilientNpcProvider", "internal", "server/src/npc/resilientProvider.ts", "Enforces fallback from the primary provider to scripted behavior.", "ResilientNpcProvider"),
          ],
        ),
      ]),
      childCards: [
        miniCard(
          "NpcOrchestrator",
          "orchestrator.ts",
          "server/src/npc/orchestrator.ts",
          deriveNpcResponsibilities(context, "server/src/npc/orchestrator.ts", "NpcOrchestrator"),
          "Subscribes to game events, schedules replies, and triggers autonomous initiations and reflections.",
        ),
        miniCard(
          "MemoryManager",
          "memory.ts",
          "server/src/npc/memory.ts",
          deriveMemoryResponsibilities(context, "server/src/npc/memory.ts", "MemoryManager"),
          "Scores, summarizes, and persists the memory context used to prompt NPC behavior.",
        ),
        miniCard(
          "Provider Stack",
          "provider.ts + resilientProvider.ts",
          "server/src/npc/provider.ts",
          [
            "NpcModelProvider",
            "ResilientNpcProvider",
            "ClaudeCodeProvider",
            "ScriptedNpcProvider",
          ],
          "Composes the primary NPC model provider with the scripted fallback path.",
        ),
      ],
      openNext: [
        openTarget("orchestrator.ts", "server/src/npc/orchestrator.ts", "Coordinates subscriptions, reply timing, and initiation behavior."),
        openTarget("memory.ts", "server/src/npc/memory.ts", "Retrieval, scoring, summarization, and reflection logic live here."),
        openTarget("resilientProvider.ts", "server/src/npc/resilientProvider.ts", "Fallback behavior for model failures is enforced here."),
      ],
    }),
    persistence: createCard({
      viewId: VIEW_GAME_SERVER,
      boundaryId: BOUNDARY_GAME_SERVER,
      id: CARD_SERVER_PERSISTENCE,
      title: "Persistence Adapters",
      subtitle: "pg + pgvector / in-memory fallback",
      accentColor: COLORS.persistence,
      width: 412,
      summary:
        "Provides durable storage contracts and implementations for memories, NPC state, conversations, messages, and generation metadata, with in-memory fallback when Postgres is unavailable.",
      sections: orderedSections([
        section(
          "owns",
          "Owns",
          [
            exactLine(context, CARD_SERVER_PERSISTENCE, "MemoryStore", "state", "server/src/db/repository.ts", "Repository implementations live behind the MemoryStore contract.", "Repository"),
            exactLine(context, CARD_SERVER_PERSISTENCE, "NpcPersistenceStore", "state", "server/src/db/npcStore.ts", "NPC persistence implementations live behind the NpcPersistenceStore contract.", "PostgresNpcStore"),
            exactLine(context, CARD_SERVER_PERSISTENCE, "schema + vector index", "state", "server/src/db/schema.sql", "Schema defines relational tables plus pgvector indexing.", "schema"),
          ],
        ),
        section(
          "ingress",
          "Ingress",
          [
            derivedLine(context, CARD_SERVER_PERSISTENCE, "memory writes", "command", "server/src/db/repository.ts", "Repository persists memories and memory access metadata."),
            derivedLine(context, CARD_SERVER_PERSISTENCE, "conversation + message snapshots", "command", "server/src/db/npcStore.ts", "NPC store persists conversation and message history."),
            derivedLine(context, CARD_SERVER_PERSISTENCE, "generation records", "command", "server/src/db/npcStore.ts", "NPC store persists reply and reflection generation metadata."),
          ],
        ),
        section(
          "egress",
          "Egress",
          [
            derivedLine(context, CARD_SERVER_PERSISTENCE, "memory search results", "message", "server/src/db/repository.ts", "Repository returns ranked memories for NPC prompting."),
            derivedLine(context, CARD_SERVER_PERSISTENCE, "restored runtime records", "message", "server/src/db/npcStore.ts", "Persistence adapters can restore player, conversation, and NPC records."),
          ],
        ),
        section(
          "depends-on",
          "Depends On",
          [
            exactLine(context, CARD_SERVER_PERSISTENCE, "PostgreSQL + pgvector", "dependency", "server/src/db/schema.sql", "Schema relies on PostgreSQL storage and pgvector indexing.", "schema"),
            exactLine(context, CARD_SERVER_PERSISTENCE, "in-memory fallback", "dependency", "server/src/index.ts", "Server startup selects in-memory persistence when PostgreSQL is unavailable.", "resolvePool"),
          ],
        ),
        section(
          "internals",
          "Internals",
          [
            exactLine(context, CARD_SERVER_PERSISTENCE, "Repository", "internal", "server/src/db/repository.ts", "Memory repository interface and implementations.", "Repository"),
            exactLine(context, CARD_SERVER_PERSISTENCE, "PostgresNpcStore", "internal", "server/src/db/npcStore.ts", "NPC persistence store and fallback implementation.", "PostgresNpcStore"),
            exactLine(context, CARD_SERVER_PERSISTENCE, "schema.sql", "internal", "server/src/db/schema.sql", "Physical tables and pgvector index definitions.", "schema"),
          ],
        ),
      ]),
      childCards: [
        miniCard(
          "MemoryStore",
          "repository.ts",
          "server/src/db/repository.ts",
          ["Repository", "InMemoryRepository", "logEvent()"],
          "Memory persistence interface with Postgres and in-memory implementations.",
        ),
        miniCard(
          "NpcPersistenceStore",
          "npcStore.ts",
          "server/src/db/npcStore.ts",
          ["PostgresNpcStore", "InMemoryNpcStore", "addGeneration()"],
          "NPC persistence interface for players, conversations, messages, and generation records.",
        ),
        miniCard(
          "schema.sql",
          "PostgreSQL + pgvector",
          "server/src/db/schema.sql",
          schemaInfo,
          "Physical schema that backs durable storage and vector similarity search.",
        ),
      ],
      openNext: [
        openTarget("repository.ts", "server/src/db/repository.ts", "Memory repository contract, vector search, and in-memory fallback live here."),
        openTarget("npcStore.ts", "server/src/db/npcStore.ts", "NPC/player/conversation/message persistence lives here."),
        openTarget("schema.sql", "server/src/db/schema.sql", "Concrete tables and pgvector index definitions live here."),
      ],
    }),
  };
}

function buildBrowserClientEdges(context: DiagramContext): ComponentDiagramEdge[] {
  return [
    edge(context, {
      viewId: VIEW_BROWSER_CLIENT,
      id: `${VIEW_BROWSER_CLIENT}-edge-app-shell-transport`,
      source: CARD_BROWSER_APP_SHELL,
      target: CARD_BROWSER_TRANSPORT,
      label: "connects and sends client messages",
      color: COLORS.network,
      relationshipKind: "direct_call",
      evidence: [
        {
          kind: "module_wiring",
          confidence: "derived",
          fileId: "client/src/main.ts",
          detail: "App shell constructs GameClient and calls client.connect()/client.send(...).",
        },
      ],
      sourceHandle: "right",
      targetHandle: "left",
    }),
    edge(context, {
      viewId: VIEW_BROWSER_CLIENT,
      id: `${VIEW_BROWSER_CLIENT}-edge-transport-app-shell`,
      source: CARD_BROWSER_TRANSPORT,
      target: CARD_BROWSER_APP_SHELL,
      label: "delivers server messages",
      color: COLORS.network,
      relationshipKind: "transport",
      technology: "WebSocket + JSON",
      evidence: [
        flowServerMessageEvidenceDraft(context.messageFlows, "player_update"),
        flowServerMessageEvidenceDraft(context.messageFlows, "convo_update"),
      ],
      sourceHandle: "left",
      targetHandle: "right",
    }),
    edge(context, {
      viewId: VIEW_BROWSER_CLIENT,
      id: `${VIEW_BROWSER_CLIENT}-edge-app-shell-render`,
      source: CARD_BROWSER_APP_SHELL,
      target: CARD_BROWSER_RENDER,
      label: "projects current state",
      color: COLORS.client,
      relationshipKind: "direct_call",
      evidence: [
        {
          kind: "module_wiring",
          confidence: "derived",
          fileId: "client/src/main.ts",
          detail: "App shell calls renderer methods to render the map, players, and chat bubbles.",
        },
      ],
      sourceHandle: "bottom",
      targetHandle: "top",
    }),
    edge(context, {
      viewId: VIEW_BROWSER_CLIENT,
      id: `${VIEW_BROWSER_CLIENT}-edge-app-shell-prediction`,
      source: CARD_BROWSER_APP_SHELL,
      target: CARD_BROWSER_PREDICTION,
      label: "predicts input and reconciles drift",
      color: COLORS.client,
      relationshipKind: "direct_call",
      evidence: [
        {
          kind: "module_wiring",
          confidence: "derived",
          fileId: "client/src/main.ts",
          detail: "App shell feeds held directions and server updates into the prediction helpers.",
        },
      ],
      sourceHandle: "bottom",
      targetHandle: "top",
    }),
    edge(context, {
      viewId: VIEW_BROWSER_CLIENT,
      id: `${VIEW_BROWSER_CLIENT}-edge-app-shell-ui`,
      source: CARD_BROWSER_APP_SHELL,
      target: CARD_BROWSER_UI,
      label: "renders player and conversation state",
      color: COLORS.client,
      relationshipKind: "direct_call",
      evidence: [
        {
          kind: "module_wiring",
          confidence: "derived",
          fileId: "client/src/main.ts",
          detail: "App shell updates the DOM UI as conversation and player state change.",
        },
      ],
      sourceHandle: "bottom",
      targetHandle: "top",
    }),
    edge(context, {
      viewId: VIEW_BROWSER_CLIENT,
      id: `${VIEW_BROWSER_CLIENT}-edge-ui-app-shell`,
      source: CARD_BROWSER_UI,
      target: CARD_BROWSER_APP_SHELL,
      label: "emits talk and chat actions",
      color: COLORS.client,
      relationshipKind: "direct_call",
      evidence: [
        {
          kind: "module_wiring",
          confidence: "derived",
          fileId: "client/src/main.ts",
          detail: "Conversation UI invokes callbacks that app shell maps to client messages and local state updates.",
        },
      ],
      sourceHandle: "top",
      targetHandle: "bottom",
    }),
    edge(context, {
      viewId: VIEW_BROWSER_CLIENT,
      id: `${VIEW_BROWSER_CLIENT}-edge-app-shell-game-server`,
      source: CARD_BROWSER_APP_SHELL,
      target: CONTAINER_BROWSER_GAME_SERVER,
      label: "fetches startup data",
      color: COLORS.server,
      relationshipKind: "transport",
      technology: "JSON/HTTP",
      evidence: [
        httpRequestEvidenceDraft(context.httpRequests, "GET", "/data/map.json"),
        httpRequestEvidenceDraft(context.httpRequests, "GET", "/api/debug/activities"),
        httpRequestEvidenceDraft(context.httpRequests, "GET", "/api/debug/state"),
      ],
      sourceHandle: "right",
      targetHandle: "left",
    }),
    edge(context, {
      viewId: VIEW_BROWSER_CLIENT,
      id: `${VIEW_BROWSER_CLIENT}-edge-game-server-transport`,
      source: CONTAINER_BROWSER_GAME_SERVER,
      target: CARD_BROWSER_TRANSPORT,
      label: "streams runtime updates",
      color: COLORS.server,
      relationshipKind: "transport",
      technology: "WebSocket + JSON",
      evidence: [
        flowServerMessageEvidenceDraft(context.messageFlows, "state"),
        flowServerMessageEvidenceDraft(context.messageFlows, "player_update"),
        flowServerMessageEvidenceDraft(context.messageFlows, "convo_update"),
      ],
      sourceHandle: "left",
      targetHandle: "right",
    }),
  ];
}

function buildGameServerEdges(context: DiagramContext): ComponentDiagramEdge[] {
  const npcCommands = pickNames(
    commandTypesByProducerPrefix(context.commands, "server/src/npc/"),
    ["start_convo", "say", "end_convo"],
  );

  return [
    edge(context, {
      viewId: VIEW_GAME_SERVER,
      id: `${VIEW_GAME_SERVER}-edge-browser-websocket`,
      source: CONTAINER_SERVER_BROWSER_CLIENT,
      target: CARD_SERVER_WEBSOCKET,
      label: "sends player commands",
      color: COLORS.client,
      relationshipKind: "transport",
      technology: "WebSocket + JSON",
      evidence: [
        flowClientMessageEvidenceDraft(context.messageFlows, "join"),
        flowClientMessageEvidenceDraft(context.messageFlows, "move"),
        flowClientMessageEvidenceDraft(context.messageFlows, "input_start"),
        flowClientMessageEvidenceDraft(context.messageFlows, "say"),
      ],
      sourceHandle: "right",
      targetHandle: "left",
    }),
    edge(context, {
      viewId: VIEW_GAME_SERVER,
      id: `${VIEW_GAME_SERVER}-edge-websocket-browser`,
      source: CARD_SERVER_WEBSOCKET,
      target: CONTAINER_SERVER_BROWSER_CLIENT,
      label: "broadcasts runtime updates",
      color: COLORS.network,
      relationshipKind: "transport",
      technology: "WebSocket + JSON",
      evidence: [
        flowServerMessageEvidenceDraft(context.messageFlows, "state"),
        flowServerMessageEvidenceDraft(context.messageFlows, "player_update"),
        flowServerMessageEvidenceDraft(context.messageFlows, "convo_update"),
        flowServerMessageEvidenceDraft(context.messageFlows, "message"),
      ],
      sourceHandle: "left",
      targetHandle: "right",
    }),
    edge(context, {
      viewId: VIEW_GAME_SERVER,
      id: `${VIEW_GAME_SERVER}-edge-browser-debug`,
      source: CONTAINER_SERVER_BROWSER_CLIENT,
      target: CARD_SERVER_DEBUG,
      label: "fetches startup and debug snapshots",
      color: COLORS.client,
      relationshipKind: "transport",
      technology: "JSON/HTTP",
      evidence: [
        httpRequestEvidenceDraft(context.httpRequests, "GET", "/api/debug/activities"),
        httpRequestEvidenceDraft(context.httpRequests, "GET", "/api/debug/state"),
      ],
      sourceHandle: "right",
      targetHandle: "left",
    }),
    edge(context, {
      viewId: VIEW_GAME_SERVER,
      id: `${VIEW_GAME_SERVER}-edge-websocket-simulation`,
      source: CARD_SERVER_WEBSOCKET,
      target: CARD_SERVER_SIMULATION,
      label: "enqueues commands and input",
      color: COLORS.network,
      relationshipKind: "queued_command",
      evidence: [
        ...pickNames(commandTypesByProducerPrefix(context.commands, "server/src/network/"), ["spawn", "move_to", "start_convo", "accept_convo", "decline_convo", "say", "end_convo", "remove"]).map(
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
      sourceHandle: "bottom",
      targetHandle: "top",
    }),
    edge(context, {
      viewId: VIEW_GAME_SERVER,
      id: `${VIEW_GAME_SERVER}-edge-debug-simulation`,
      source: CARD_SERVER_DEBUG,
      target: CARD_SERVER_SIMULATION,
      label: "reads state and mutates debug paths",
      color: COLORS.debug,
      relationshipKind: "mixed",
      technology: "JSON/HTTP handlers",
      evidence: [
        httpRouteEvidenceDraft(context.httpRoutes, "POST", "/tick"),
        httpRouteEvidenceDraft(context.httpRoutes, "POST", "/move"),
        httpRouteEvidenceDraft(context.httpRoutes, "POST", "/scenario"),
        {
          kind: "route",
          confidence: "exact",
          fileId: "server/src/debug/router.ts",
          detail: "POST /start-convo, /say, and /end-convo bypass the normal queue and mutate ConversationManager directly.",
        },
      ],
      sourceHandle: "bottom",
      targetHandle: "top",
    }),
    edge(context, {
      viewId: VIEW_GAME_SERVER,
      id: `${VIEW_GAME_SERVER}-edge-simulation-websocket`,
      source: CARD_SERVER_SIMULATION,
      target: CARD_SERVER_WEBSOCKET,
      label: "emits events for fanout",
      color: COLORS.engine,
      relationshipKind: "event_subscription",
      evidence: [
        eventEvidenceDraft(context.events, "player_update", "emitters", "server/src/engine/"),
        eventEvidenceDraft(context.events, "convo_active", "emitters", "server/src/engine/"),
        eventEvidenceDraft(context.events, "convo_message", "emitters", "server/src/engine/"),
      ],
      sourceHandle: "top",
      targetHandle: "bottom",
    }),
    edge(context, {
      viewId: VIEW_GAME_SERVER,
      id: `${VIEW_GAME_SERVER}-edge-simulation-npc`,
      source: CARD_SERVER_SIMULATION,
      target: CARD_SERVER_NPC,
      label: "publishes conversation and tick events",
      color: COLORS.engine,
      relationshipKind: "event_subscription",
      evidence: [
        ...pickNames(eventTypesBySubscriberPrefix(context.events, "server/src/npc/"), ["spawn", "convo_started", "convo_active", "convo_ended", "convo_message", "tick_complete"]).map(
          (eventType) => eventEvidenceDraft(context.events, eventType, "subscribers", "server/src/npc/"),
        ),
      ],
      sourceHandle: "bottom",
      targetHandle: "top",
    }),
    edge(context, {
      viewId: VIEW_GAME_SERVER,
      id: `${VIEW_GAME_SERVER}-edge-npc-simulation`,
      source: CARD_SERVER_NPC,
      target: CARD_SERVER_SIMULATION,
      label: "queues NPC dialogue actions",
      color: COLORS.npc,
      relationshipKind: "queued_command",
      evidence: npcCommands.map((commandType) => commandEvidenceDraft(context, commandType, "server/src/npc/")),
      sourceHandle: "top",
      targetHandle: "bottom",
    }),
    edge(context, {
      viewId: VIEW_GAME_SERVER,
      id: `${VIEW_GAME_SERVER}-edge-npc-persistence`,
      source: CARD_SERVER_NPC,
      target: CARD_SERVER_PERSISTENCE,
      label: "retrieves memories and stores generations",
      color: COLORS.persistence,
      relationshipKind: "persistence_io",
      evidence: [
        {
          kind: "memory_pipeline",
          confidence: "derived",
          fileId: "server/src/npc/memory.ts",
          detail: "MemoryManager retrieves and persists memory records through repository interfaces.",
        },
        {
          kind: "generation_record",
          confidence: "exact",
          fileId: "server/src/npc/orchestrator.ts",
          detail: "NpcOrchestrator writes reply and reflection generations through the persistence store.",
        },
      ],
      sourceHandle: "right",
      targetHandle: "left",
    }),
    edge(context, {
      viewId: VIEW_GAME_SERVER,
      id: `${VIEW_GAME_SERVER}-edge-persistence-postgres`,
      source: CARD_SERVER_PERSISTENCE,
      target: CONTAINER_SERVER_POSTGRES,
      label: "reads and writes runtime records",
      color: COLORS.persistence,
      relationshipKind: "persistence_io",
      technology: "SQL + pgvector",
      evidence: context.sqlOperations
        .filter((fact) => fact.fileId.startsWith("server/src/db/"))
        .slice(0, 8)
        .map((fact) => sqlEvidenceDraft(fact)),
      sourceHandle: "right",
      targetHandle: "left",
    }),
    edge(context, {
      viewId: VIEW_GAME_SERVER,
      id: `${VIEW_GAME_SERVER}-edge-world-simulation`,
      source: CONTAINER_SERVER_WORLD_DATA,
      target: CARD_SERVER_SIMULATION,
      label: "loads map and seed data at startup",
      color: COLORS.datastore,
      relationshipKind: "transport",
      technology: "file I/O",
      evidence: [
        fileAccessEvidenceDraft(context.fileAccesses, "server/src/index.ts", "Reads file via readFileSync(mapPath)"),
        fileAccessEvidenceDraft(context.fileAccesses, "server/src/index.ts", "Imports seed data from server/src/data/characters.ts"),
      ],
      sourceHandle: "left",
      targetHandle: "right",
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
  viewId: string;
  boundaryId: string;
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
  const childColumns = options.width >= 760 ? 3 : 2;
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
    viewId: options.viewId,
    boundaryId: options.boundaryId,
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

function createContextContainer(options: ComponentDiagramContainer): ComponentDiagramContainer {
  return options;
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
    `Variable ${variableName} is captured in extracted module facts for this component.`,
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

function httpRequestLine(
  context: DiagramContext,
  cardId: string,
  method: "GET" | "POST",
  path: string,
): ComponentDiagramLine {
  const fact = findHttpRequest(context.httpRequests, method, path);
  return line(context, {
    id: `${cardId}-http-request-${method.toLowerCase()}-${sanitizeId(path)}`,
    text: `${method} ${path}`,
    kind: "route",
    confidence: fact ? "exact" : "derived",
    evidence: [
      fact
        ? {
            kind: "http_request",
            confidence: "exact",
            fileId: fact.fileId,
            line: fact.line,
            symbol: fact.caller,
            detail: `Browser component performs ${method} ${path}.`,
          }
        : {
            kind: "http_request",
            confidence: "derived",
            fileId: "client/src/main.ts",
            detail: `Browser component performs ${method} ${path}.`,
          },
    ],
  });
}

function httpRouteLine(
  context: DiagramContext,
  cardId: string,
  method: "GET" | "POST",
  path: string,
): ComponentDiagramLine {
  const fact = findHttpRoute(context.httpRoutes, method, path);
  return line(context, {
    id: `${cardId}-http-route-${method.toLowerCase()}-${sanitizeId(path)}`,
    text: `${method} ${path}`,
    kind: "route",
    confidence: fact ? "exact" : "derived",
    evidence: [
      fact
        ? {
            kind: "route",
            confidence: "exact",
            fileId: fact.fileId,
            line: fact.line,
            symbol: fact.ownerSymbol,
            detail: `Server component exposes ${method} ${path}.`,
          }
        : {
            kind: "route",
            confidence: "derived",
            fileId: "server/src/debug/router.ts",
            detail: `Server component exposes ${method} ${path}.`,
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
    viewId: string;
    id: string;
    source: string;
    target: string;
    label: string;
    color: string;
    relationshipKind: ComponentDiagramRelationshipKind;
    evidence: EvidenceDraft[];
    technology?: string;
    dash?: string;
    bidirectional?: boolean;
    sourceHandle?: "top" | "right" | "bottom" | "left";
    targetHandle?: "top" | "right" | "bottom" | "left";
  },
): ComponentDiagramEdge {
  return {
    id: options.id,
    viewId: options.viewId,
    source: options.source,
    target: options.target,
    label: options.label,
    color: options.color,
    relationshipKind: options.relationshipKind,
    evidenceIds: context.evidenceBuilder.addMany(options.evidence),
    technology: options.technology,
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

function httpRequestEvidenceDraft(
  httpRequests: HttpRequestFact[],
  method: "GET" | "POST",
  path: string,
): EvidenceDraft {
  const fact = findHttpRequest(httpRequests, method, path);
  return {
    kind: "http_request",
    confidence: fact ? "exact" : "derived",
    fileId: fact?.fileId ?? "client/src/main.ts",
    line: fact?.line,
    symbol: fact?.caller,
    detail: fact
      ? `Browser performs ${method} ${path}.`
      : `Browser performs ${method} ${path} as part of startup/runtime coordination.`,
  };
}

function httpRouteEvidenceDraft(
  httpRoutes: HttpRouteFact[],
  method: "GET" | "POST",
  path: string,
): EvidenceDraft {
  const fact = findHttpRoute(httpRoutes, method, path);
  return {
    kind: "route",
    confidence: fact ? "exact" : "derived",
    fileId: fact?.fileId ?? "server/src/debug/router.ts",
    line: fact?.line,
    symbol: fact?.ownerSymbol,
    detail: fact
      ? `Server exposes ${method} ${path}.`
      : `Server exposes ${method} ${path}.`,
  };
}

function fileAccessEvidenceDraft(
  fileAccesses: FileAccessFact[],
  fileId: string,
  detailPrefix: string,
): EvidenceDraft {
  const fact = fileAccesses.find((candidate) => candidate.fileId === fileId && candidate.detail.startsWith(detailPrefix));
  return {
    kind: "file_access",
    confidence: fact ? "exact" : "derived",
    fileId: fact?.fileId ?? fileId,
    line: fact?.line,
    detail: fact?.detail ?? detailPrefix,
  };
}

function sqlEvidenceDraft(fact: SqlOperationFact): EvidenceDraft {
  return {
    kind: "sql_operation",
    confidence: "exact",
    fileId: fact.fileId,
    line: fact.line,
    symbol: fact.symbol,
    detail: `Database layer performs ${fact.detail}.`,
  };
}

function commandEvidenceDraft(
  context: DiagramContext,
  commandType: string,
  filePrefix?: string,
): EvidenceDraft {
  const command = context.commands.find((candidate) => candidate.commandType === commandType);
  const producer =
    command?.producers.find((candidate) => !filePrefix || candidate.fileId.startsWith(filePrefix)) ??
    command?.producers[0];
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

function findHttpRequest(
  httpRequests: HttpRequestFact[],
  method: "GET" | "POST",
  path: string,
): HttpRequestFact | undefined {
  return httpRequests.find((fact) => fact.method === method && fact.path === path);
}

function findHttpRoute(
  httpRoutes: HttpRouteFact[],
  method: "GET" | "POST",
  path: string,
): HttpRouteFact | undefined {
  return httpRoutes.find((fact) => fact.method === method && fact.path === path);
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
  viewId: string,
  id: string,
  label: string,
  technology: string,
  description: string,
  color: string,
  position: DiagramPoint,
  cards: ComponentDiagramCard[],
): ComponentDiagramBoundary {
  const headerHeight = 116;
  const padding = 36;
  let maxX = 0;
  let maxY = headerHeight;

  for (const card of cards) {
    maxX = Math.max(maxX, card.position.x + card.size.width);
    maxY = Math.max(maxY, card.position.y + card.size.height);
  }

  return {
    id,
    viewId,
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

function buildSystem(
  viewId: string,
  id: string,
  label: string,
  description: string,
  color: string,
  boundary: ComponentDiagramBoundary,
  containers: ComponentDiagramContainer[],
): ComponentDiagramSystem {
  const padding = 44;
  let maxX = boundary.position.x + boundary.size.width;
  let maxY = boundary.position.y + boundary.size.height;

  for (const container of containers) {
    maxX = Math.max(maxX, container.position.x + container.size.width);
    maxY = Math.max(maxY, container.position.y + container.size.height);
  }

  return {
    id,
    viewId,
    label,
    description,
    color,
    position: { x: 60, y: 40 },
    size: {
      width: maxX + padding,
      height: maxY + padding,
    },
  };
}
