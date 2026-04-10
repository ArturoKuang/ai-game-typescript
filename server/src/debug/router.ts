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
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { type Response, Router } from "express";
import type { Pool } from "pg";
import type { NpcAutonomyManager } from "../autonomy/manager.js";
import type { BearManager } from "../bears/bearManager.js";
import type { GameLoop } from "../engine/gameLoop.js";
import type { GameWebSocketServer } from "../network/websocket.js";
import type { MemoryManager } from "../npc/memory.js";
import type { NpcProviderDiagnosticsSource } from "../npc/resilientProvider.js";
import {
  serializeDebugWorldEntity,
  snapshotMapData,
} from "../stateSnapshots.js";
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
  const admin = new DebugGameAdmin(game, pool);

  registerReadRoutes(router, game, autonomyManager, providerDiagnostics);
  registerCommandRoutes(router, game, admin);

  if (memoryManager) {
    registerMemoryRoutes(router, game, memoryManager);
  }

  if (autonomyManager) {
    registerAutonomyRoutes(router, game, autonomyManager);
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
    const since = parseOptionalInteger(req.query.since);
    const limit = parseIntegerOrFallback(req.query.limit, 50);
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
}

function registerCommandRoutes(
  router: Router,
  game: GameLoop,
  admin: DebugGameAdmin,
): void {
  router.post("/tick", (req, res) => {
    const count = req.body?.count ?? 1;
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
        id && name && x !== undefined && y !== undefined,
        "Missing required fields: id, name, x, y",
      );
      return admin.spawnPlayer({
        id,
        name,
        x,
        y,
        isNpc,
        description,
        personality,
        speed,
      });
    });
  });

  router.post("/move", (req, res) => {
    handleRoute(res, () => {
      const { playerId, x, y } = req.body ?? {};
      ensureRouteCondition(
        playerId && x !== undefined && y !== undefined,
        "Missing required fields: playerId, x, y",
      );
      return { path: admin.movePlayer(playerId, x, y) };
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
    const mapData = snapshotMapData(game.world);
    game.reset();
    game.loadWorld(mapData);
    res.json({ ok: true });
  });

  router.post("/scenario", (req, res) => {
    handleRoute(res, async () => {
      const { name } = req.body ?? {};
      ensureRouteCondition(
        name && SCENARIOS[name],
        `Unknown scenario. Available: ${Object.keys(SCENARIOS).join(", ")}`,
      );
      return admin.loadScenario(name, SCENARIOS[name]);
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
    const { mode, tickRate } = req.body ?? {};
    if (mode && (mode === "stepped" || mode === "realtime")) {
      game.mode = mode;
    }
    res.json({ mode: game.mode, tickRate: game.tickRate });
  });
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
        const limit = parseOptionalInteger(req.query.limit);
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
        const k = parseIntegerOrFallback(req.query.k, 5);
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
  game: GameLoop,
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
    const state = autonomyManager.getState(req.params.npcId);
    const player = game.getPlayer(req.params.npcId);
    const { health, food, water, social } = req.body ?? {};
    if (health !== undefined && player) {
      const maxHp = player.maxHp ?? 100;
      player.hp = Math.max(0, Math.min(maxHp, (health / 100) * maxHp));
    }
    if (food !== undefined) state.needs.food = food;
    if (water !== undefined) state.needs.water = water;
    if (social !== undefined) state.needs.social = social;
    res.json(
      autonomyManager.getDebugState(req.params.npcId)?.needs ?? state.needs,
    );
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
        const png = await wsServer.requestScreenshot();
        ensureRouteCondition(
          png,
          "No connected client or capture timed out",
          503,
        );

        const tmpDir = process.env.TMPDIR || "/tmp";
        const outPath = join(tmpDir, "claude", "qa-screenshot.png");
        try {
          const base64 = png.replace(/^data:image\/png;base64,/, "");
          writeFileSync(outPath, Buffer.from(base64, "base64"));
        } catch {
          // ignore write errors — the API response is the primary output
        }
        return { ok: true, savedTo: outPath };
      },
      500,
    );
  });

  router.get("/screenshot", (_req, res) => {
    const png = wsServer.getLatestScreenshot();
    if (!png) {
      res.status(404).json({
        error: "No screenshot available. POST /capture-screenshot first.",
      });
      return;
    }
    const base64 = png.replace(/^data:image\/png;base64,/, "");
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

function parseOptionalInteger(value: unknown): number | undefined {
  return typeof value === "string" ? Number.parseInt(value, 10) : undefined;
}

function parseIntegerOrFallback(value: unknown, fallback: number): number {
  return typeof value === "string" ? Number.parseInt(value, 10) : fallback;
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
