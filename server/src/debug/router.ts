/**
 * Express debug API — inspect and control the game simulation via HTTP.
 *
 * Routes are grouped into three categories:
 * - **Read** — `/state`, `/map`, `/players`, `/log`, `/conversations`, `/memories`
 * - **Engine-integrated** — `/tick`, `/spawn`, `/move`, `/input`, `/mode`, `/scenario`
 * - **Admin facade** — `/start-convo`, `/say`, `/end-convo` reuse the command path without a full tick
 *
 * @see docs/debug-api.md for full request/response examples
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { type Response, Router } from "express";
import type { Pool } from "pg";
import type { NpcAutonomyManager } from "../autonomy/manager.js";
import type { BearManager } from "../bears/bearManager.js";
import type { GameLoop } from "../engine/gameLoop.js";
import type { GameWebSocketServer } from "../network/websocket.js";
import type { MemoryManager } from "../npc/memory.js";
import type { NpcProviderDiagnosticsSource } from "../npc/resilientProvider.js";
import { serializeDebugWorldEntity } from "../stateSnapshots.js";
import { DebugGameAdmin, DebugRouteError, errorMessage } from "./admin.js";
import { renderAsciiMap } from "./asciiMap.js";
import { SCENARIOS, listScenarios } from "./scenarios.js";

export function createDebugRouter(
  game: GameLoop,
  memoryManager?: MemoryManager,
  pool?: Pool,
  autonomyManager?: NpcAutonomyManager,
  bearManager?: BearManager,
  wsServer?: GameWebSocketServer,
  providerDiagnostics?: NpcProviderDiagnosticsSource,
): Router {
  const router = Router();
  const admin = new DebugGameAdmin(game, pool, autonomyManager);

  registerReadRoutes(
    router,
    game,
    autonomyManager,
    providerDiagnostics,
    wsServer,
  );
  registerCommandRoutes(router, game, admin, wsServer);

  if (memoryManager) {
    registerMemoryRoutes(router, game, memoryManager);
  }

  if (autonomyManager) {
    registerAutonomyRoutes(router, admin, autonomyManager);
  }

  if (bearManager) {
    registerBearRoutes(router, bearManager);
  }

  if (wsServer) {
    registerScreenshotRoutes(router, wsServer);
  }

  return router;
}

function registerReadRoutes(
  router: Router,
  game: GameLoop,
  autonomyManager?: NpcAutonomyManager,
  providerDiagnostics?: NpcProviderDiagnosticsSource,
  wsServer?: GameWebSocketServer,
): void {
  router.get("/state", (_req, res) => {
    res.json({
      tick: game.currentTick,
      mode: game.mode,
      tickRate: game.tickRate,
      playerCount: game.playerCount,
      world: game.world
        ? { width: game.world.width, height: game.world.height }
        : null,
    });
  });

  router.get("/map", (req, res) => {
    const em = autonomyManager?.getEntityManager();
    const { ascii, legend } = renderAsciiMap(game, em);
    if (req.query.format === "json") {
      res.json({ ascii, legend });
      return;
    }
    res.type("text/plain").send(ascii);
  });

  router.get("/players", (_req, res) => {
    res.json(game.getPlayers());
  });

  router.get("/players/:id", (req, res) => {
    const player = game.getPlayer(req.params.id);
    if (!player) {
      res.status(404).json({ error: "Player not found" });
      return;
    }
    res.json(player);
  });

  router.get("/activities", (_req, res) => {
    res.json(game.world.getActivities());
  });

  router.get("/log", (req, res) => {
    const since = parseOptionalInteger(req.query.since, "since");
    const limit = parseIntegerOrFallback(req.query.limit, 50, "limit");
    const playerId =
      typeof req.query.playerId === "string" ? req.query.playerId : undefined;
    const types = parseCsvQuery(req.query.type);
    res.json(game.logger.getEvents({ since, limit, playerId, types }));
  });

  router.get("/scenarios", (_req, res) => {
    res.json(listScenarios());
  });

  router.get("/conversations", (_req, res) => {
    res.json(game.conversations.getAllConversations());
  });

  router.get("/conversations/:id", (req, res) => {
    const convo = game.conversations.getConversation(
      Number.parseInt(req.params.id, 10),
    );
    if (!convo) {
      res.status(404).json({ error: "Conversation not found" });
      return;
    }
    res.json(convo);
  });

  router.get("/npc-provider", (_req, res) => {
    if (!providerDiagnostics) {
      res.status(404).json({ error: "NPC provider diagnostics unavailable" });
      return;
    }
    res.json(providerDiagnostics.getDiagnostics());
  });

  router.get("/clients", (_req, res) => {
    if (!wsServer) {
      res.status(404).json({ error: "Client diagnostics unavailable" });
      return;
    }
    res.json(wsServer.getDebugClients());
  });
}

function registerCommandRoutes(
  router: Router,
  game: GameLoop,
  admin: DebugGameAdmin,
  wsServer?: GameWebSocketServer,
): void {
  router.post("/tick", (req, res) => {
    const count = parsePositiveInteger(req.body?.count ?? 1, "count");
    const allEvents = [];
    for (let i = 0; i < count; i++) {
      const result = game.tick();
      allEvents.push(...result.events);
    }
    res.json({ tick: game.currentTick, events: allEvents });
  });

  router.post("/spawn", (req, res) => {
    handleRoute(res, async () => {
      const { id, name, x, y, isNpc, description, personality, speed } =
        req.body ?? {};
      ensureRouteCondition(
        typeof id === "string" &&
          typeof name === "string" &&
          isFiniteLikeNumber(x) &&
          isFiniteLikeNumber(y),
        "Missing required fields: id, name, x, y",
      );
      return admin.spawnPlayer({
        id,
        name,
        x: parseFiniteNumber(x, "x"),
        y: parseFiniteNumber(y, "y"),
        isNpc,
        description,
        personality,
        speed:
          speed === undefined ? undefined : parsePositiveNumber(speed, "speed"),
      });
    });
  });

  router.post("/move", (req, res) => {
    handleRoute(res, () => {
      const { playerId, x, y } = req.body ?? {};
      ensureRouteCondition(
        typeof playerId === "string" &&
          isFiniteLikeNumber(x) &&
          isFiniteLikeNumber(y),
        "Missing required fields: playerId, x, y",
      );
      return {
        path: admin.movePlayer(
          playerId,
          parseFiniteNumber(x, "x"),
          parseFiniteNumber(y, "y"),
        ),
      };
    });
  });

  router.post("/input", (req, res) => {
    handleRoute(res, () => {
      const { playerId, direction, active } = req.body ?? {};
      ensureRouteCondition(
        playerId &&
          direction &&
          ["up", "down", "left", "right"].includes(direction) &&
          typeof active === "boolean",
        "Missing/invalid fields: playerId (string), direction (up|down|left|right), active (boolean)",
      );
      return admin.setPlayerInput(playerId, direction, active);
    });
  });

  router.post("/reset", (_req, res) => {
    const result = admin.resetSimulation();
    resyncDebugSubscribers(wsServer);
    res.json(result);
  });

  router.post("/scenario", (req, res) => {
    handleRoute(res, async () => {
      const { name } = req.body ?? {};
      ensureRouteCondition(
        name && SCENARIOS[name],
        `Unknown scenario. Available: ${Object.keys(SCENARIOS).join(", ")}`,
      );
      const result = await admin.loadScenario(name, SCENARIOS[name]);
      resyncDebugSubscribers(wsServer);
      return result;
    });
  });

  router.post("/start-convo", (req, res) => {
    handleRoute(res, () => {
      const { player1Id, player2Id } = req.body ?? {};
      ensureRouteCondition(
        player1Id && player2Id,
        "Missing required fields: player1Id, player2Id",
      );
      return admin.startConversation(player1Id, player2Id);
    });
  });

  router.post("/end-convo", (req, res) => {
    handleRoute(res, () => {
      const { convoId } = req.body ?? {};
      ensureRouteCondition(convoId, "Missing required field: convoId");
      return admin.endConversation(convoId);
    });
  });

  router.post("/say", (req, res) => {
    handleRoute(res, () => {
      const { playerId, convoId, content } = req.body ?? {};
      ensureRouteCondition(
        playerId && convoId && content,
        "Missing required fields: playerId, convoId, content",
      );
      return admin.addConversationMessage(playerId, convoId, content);
    });
  });

  router.post("/mode", (req, res) => {
    handleRoute(res, () => {
      const { mode, tickRate } = req.body ?? {};
      ensureRouteCondition(
        mode === "stepped" || mode === "realtime",
        "Missing/invalid field: mode (stepped|realtime)",
      );
      return admin.setSimulationMode({
        mode,
        tickRate:
          tickRate === undefined
            ? undefined
            : parsePositiveNumber(tickRate, "tickRate"),
      });
    });
  });
}

function resyncDebugSubscribers(wsServer?: GameWebSocketServer): void {
  if (!wsServer) {
    return;
  }
  wsServer.resetDebugState();
  wsServer.broadcastDebugBootstrap();
}

function registerMemoryRoutes(
  router: Router,
  game: GameLoop,
  memoryManager: MemoryManager,
): void {
  router.get("/memories/:playerId", (req, res) => {
    handleRoute(
      res,
      async () => {
        const limit = parseOptionalInteger(req.query.limit, "limit");
        const type =
          typeof req.query.type === "string" ? req.query.type : undefined;
        return memoryManager.getMemories(req.params.playerId, {
          limit,
          type,
        });
      },
      500,
    );
  });

  router.get("/memories/:playerId/search", (req, res) => {
    handleRoute(
      res,
      async () => {
        const query = typeof req.query.q === "string" ? req.query.q : undefined;
        ensureRouteCondition(query, "Missing query parameter: q");
        const k = parseIntegerOrFallback(req.query.k, 5, "k");
        return memoryManager.searchMemories({
          playerId: req.params.playerId,
          query,
          k,
        });
      },
      500,
    );
  });

  router.post("/memories", (req, res) => {
    handleRoute(
      res,
      async () => {
        const { playerId, type, content, importance, tick } = req.body ?? {};
        ensureRouteCondition(
          playerId && type && content,
          "Missing required fields: playerId, type, content",
        );
        return memoryManager.addMemory({
          playerId,
          type,
          content,
          importance: importance ?? 5,
          tick: tick ?? game.currentTick,
        });
      },
      500,
    );
  });

  router.post("/remember-convo", (req, res) => {
    handleRoute(
      res,
      async () => {
        const { convoId } = req.body ?? {};
        ensureRouteCondition(convoId, "Missing required field: convoId");
        const convo = game.conversations.getConversation(convoId);
        ensureRouteCondition(convo, "Conversation not found", 404);

        const memories = [];
        for (const pid of [convo.player1Id, convo.player2Id]) {
          const partner =
            pid === convo.player1Id ? convo.player2Id : convo.player1Id;
          const partnerPlayer = game.getPlayer(partner);
          const memory = await memoryManager.rememberConversation({
            playerId: pid,
            partnerName: partnerPlayer?.name ?? partner,
            messages: convo.messages,
            tick: game.currentTick,
          });
          memories.push(memory);
        }
        return memories;
      },
      500,
    );
  });
}

function registerAutonomyRoutes(
  router: Router,
  admin: DebugGameAdmin,
  autonomyManager: NpcAutonomyManager,
): void {
  router.get("/autonomy/state", (_req, res) => {
    const states: Record<string, unknown> = {};
    for (const [npcId, state] of autonomyManager.getAllDebugStates()) {
      states[npcId] = state;
    }
    res.json(states);
  });

  router.get("/autonomy/:npcId", (req, res) => {
    const state = autonomyManager.getDebugState(req.params.npcId);
    if (!state) {
      res.status(404).json({ error: "NPC autonomy state not found" });
      return;
    }
    res.json(state);
  });

  router.post("/autonomy/:npcId/needs", (req, res) => {
    handleRoute(res, () => {
      const { health, food, water, social } = req.body ?? {};
      const debugState = admin.setNpcNeeds(req.params.npcId, {
        health:
          health === undefined
            ? undefined
            : parseBoundedPercent(health, "health"),
        food:
          food === undefined ? undefined : parseBoundedPercent(food, "food"),
        water:
          water === undefined ? undefined : parseBoundedPercent(water, "water"),
        social:
          social === undefined
            ? undefined
            : parseBoundedPercent(social, "social"),
      });
      return debugState.needs;
    });
  });

  router.get("/entities", (_req, res) => {
    const em = autonomyManager.getEntityManager();
    res.json(em.getAll().map((entity) => serializeDebugWorldEntity(entity)));
  });
}

function registerBearRoutes(router: Router, bearManager: BearManager): void {
  router.get("/bears", (_req, res) => {
    res.json(
      bearManager.getBears().map((bear) => ({
        id: bear.id,
        position: bear.position,
        properties: bear.properties,
      })),
    );
  });

  router.post("/spawn-bear", (req, res) => {
    handleRoute(res, () => {
      const { x, y } = req.body ?? {};
      ensureRouteCondition(
        x !== undefined && y !== undefined,
        "Missing required fields: x, y",
      );
      return { ok: true, bearId: bearManager.debugSpawnBear(x, y) };
    });
  });

  router.post("/kill-bear", (req, res) => {
    handleRoute(res, () => {
      const { bearId } = req.body ?? {};
      ensureRouteCondition(bearId, "Missing required field: bearId");
      const killed = bearManager.debugKillBear(bearId);
      ensureRouteCondition(killed, "Bear not found or already dead", 404);
      return { ok: true, bearId };
    });
  });

  router.get("/inventory/:playerId", (req, res) => {
    const inventory = bearManager.getInventory(req.params.playerId);
    res.json(Object.fromEntries(inventory));
  });
}

function registerScreenshotRoutes(
  router: Router,
  wsServer: GameWebSocketServer,
): void {
  router.post("/capture-screenshot", (req, res) => {
    handleRoute(
      res,
      async () => {
        const clientId =
          typeof req.body?.clientId === "string"
            ? req.body.clientId
            : undefined;
        const capture = await wsServer.requestScreenshot({
          clientId,
          timeoutMs:
            req.body?.timeoutMs === undefined
              ? undefined
              : parsePositiveInteger(req.body.timeoutMs, "timeoutMs"),
        });
        ensureRouteCondition(
          capture,
          "No connected gameplay client or capture timed out",
          503,
        );

        const outDir = join(process.env.TMPDIR || "/tmp", "ai-town-debug");
        mkdirSync(outDir, { recursive: true });
        const outPath = join(
          outDir,
          `screenshot-${capture.clientId}-${Date.now()}.png`,
        );
        const base64 = capture.png.replace(/^data:image\/png;base64,/, "");
        writeFileSync(outPath, Buffer.from(base64, "base64"));
        return {
          ok: true,
          clientId: capture.clientId,
          capturedAt: capture.capturedAt,
          savedTo: outPath,
        };
      },
      500,
    );
  });

  router.get("/screenshot", (req, res) => {
    const clientId =
      typeof req.query.clientId === "string" ? req.query.clientId : undefined;
    const capture = wsServer.getLatestScreenshot(clientId);
    if (!capture) {
      res.status(404).json({
        error: "No screenshot available. POST /capture-screenshot first.",
      });
      return;
    }
    const base64 = capture.png.replace(/^data:image\/png;base64,/, "");
    res.type("image/png").send(Buffer.from(base64, "base64"));
  });
}

function handleRoute<T>(
  res: Response,
  action: () => Promise<T> | T,
  fallbackStatus = 400,
): void {
  void Promise.resolve()
    .then(action)
    .then((result) => {
      res.json(result);
    })
    .catch((error) => {
      const status =
        error instanceof DebugRouteError ? error.status : fallbackStatus;
      res.status(status).json({ error: errorMessage(error) });
    });
}

function ensureRouteCondition(
  condition: unknown,
  message: string,
  status = 400,
): asserts condition {
  if (!condition) {
    throw new DebugRouteError(status, message);
  }
}

function isFiniteLikeNumber(value: unknown): boolean {
  return (
    (typeof value === "number" && Number.isFinite(value)) ||
    (typeof value === "string" && value.trim().length > 0)
  );
}

function parseFiniteNumber(value: unknown, name: string): number {
  const parsed =
    typeof value === "number"
      ? value
      : typeof value === "string"
        ? Number.parseFloat(value)
        : Number.NaN;
  if (!Number.isFinite(parsed)) {
    throw new DebugRouteError(400, `Invalid ${name}: expected number`);
  }
  return parsed;
}

function parseOptionalInteger(
  value: unknown,
  name: string,
): number | undefined {
  if (value === undefined) {
    return undefined;
  }
  return parseRequiredInteger(value, name);
}

function parseIntegerOrFallback(
  value: unknown,
  fallback: number,
  name: string,
): number {
  if (value === undefined) {
    return fallback;
  }
  return parseRequiredInteger(value, name);
}

function parseRequiredInteger(value: unknown, name: string): number {
  if (typeof value === "number" && Number.isInteger(value)) {
    return value;
  }
  if (typeof value === "string" && /^-?\d+$/.test(value)) {
    return Number.parseInt(value, 10);
  }
  throw new DebugRouteError(400, `Invalid ${name}: expected integer`);
}

function parsePositiveInteger(value: unknown, name: string): number {
  const parsed = parseRequiredInteger(value, name);
  if (parsed <= 0) {
    throw new DebugRouteError(
      400,
      `Invalid ${name}: expected positive integer`,
    );
  }
  return parsed;
}

function parsePositiveNumber(value: unknown, name: string): number {
  const parsed = parseFiniteNumber(value, name);
  if (parsed <= 0) {
    throw new DebugRouteError(400, `Invalid ${name}: expected positive number`);
  }
  return parsed;
}

function parseBoundedPercent(value: unknown, name: string): number {
  const parsed = parseFiniteNumber(value, name);
  if (parsed < 0 || parsed > 100) {
    throw new DebugRouteError(
      400,
      `Invalid ${name}: expected value between 0 and 100`,
    );
  }
  return parsed;
}

function parseCsvQuery(value: unknown): string[] | undefined {
  if (typeof value !== "string") {
    return undefined;
  }
  return value
    .split(",")
    .map((entry) => entry.trim())
    .filter(Boolean);
}
