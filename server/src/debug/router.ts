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
import { Router } from "express";
import type { Pool } from "pg";
import { DebugGameAdmin, DebugRouteError, errorMessage } from "./admin.js";
import type { NpcAutonomyManager } from "../autonomy/manager.js";
import type { BearManager } from "../bears/bearManager.js";
import type { GameLoop } from "../engine/gameLoop.js";
import type { MemoryManager } from "../npc/memory.js";
import type { NpcProviderDiagnosticsSource } from "../npc/resilientProvider.js";
import type { GameWebSocketServer } from "../network/websocket.js";
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

  // --- Read endpoints ---

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
    } else {
      res.type("text/plain").send(ascii);
    }
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
    const since = req.query.since
      ? Number.parseInt(req.query.since as string, 10)
      : undefined;
    const limit = req.query.limit
      ? Number.parseInt(req.query.limit as string, 10)
      : 50;
    const playerId = req.query.playerId as string | undefined;
    const types =
      typeof req.query.type === "string"
        ? req.query.type
            .split(",")
            .map((value) => value.trim())
            .filter(Boolean)
        : undefined;
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

  // --- Command endpoints ---

  router.post("/tick", (req, res) => {
    const count = req.body?.count ?? 1;
    const allEvents = [];
    for (let i = 0; i < count; i++) {
      const result = game.tick();
      allEvents.push(...result.events);
    }
    res.json({ tick: game.currentTick, events: allEvents });
  });

  router.post("/spawn", async (req, res) => {
    const { id, name, x, y, isNpc, description, personality, speed } = req.body;
    if (!id || !name || x === undefined || y === undefined) {
      res
        .status(400)
        .json({ error: "Missing required fields: id, name, x, y" });
      return;
    }
    try {
      const player = await admin.spawnPlayer({
        id,
        name,
        x,
        y,
        isNpc,
        description,
        personality,
        speed,
      });
      res.json(player);
    } catch (error) {
      const status = error instanceof DebugRouteError ? error.status : 400;
      res.status(status).json({ error: errorMessage(error) });
    }
  });

  router.post("/move", (req, res) => {
    const { playerId, x, y } = req.body;
    if (!playerId || x === undefined || y === undefined) {
      res
        .status(400)
        .json({ error: "Missing required fields: playerId, x, y" });
      return;
    }
    try {
      const path = admin.movePlayer(playerId, x, y);
      res.json({ path });
    } catch (error) {
      const status = error instanceof DebugRouteError ? error.status : 400;
      res.status(status).json({ error: errorMessage(error) });
    }
  });

  router.post("/input", (req, res) => {
    const { playerId, direction, active } = req.body;
    if (
      !playerId ||
      !direction ||
      !["up", "down", "left", "right"].includes(direction) ||
      typeof active !== "boolean"
    ) {
      res.status(400).json({
        error:
          "Missing/invalid fields: playerId (string), direction (up|down|left|right), active (boolean)",
      });
      return;
    }
    try {
      const player = admin.setPlayerInput(playerId, direction, active);
      res.json(player);
    } catch (error) {
      const status = error instanceof DebugRouteError ? error.status : 400;
      res.status(status).json({ error: errorMessage(error) });
    }
  });

  router.post("/reset", (_req, res) => {
    game.reset();
    res.json({ ok: true });
  });

  router.post("/scenario", async (req, res) => {
    const { name } = req.body;
    if (!name || !SCENARIOS[name]) {
      res.status(400).json({
        error: `Unknown scenario. Available: ${Object.keys(SCENARIOS).join(", ")}`,
      });
      return;
    }
    const result = await admin.loadScenario(name, SCENARIOS[name]);
    res.json(result);
  });

  router.post("/start-convo", (req, res) => {
    const { player1Id, player2Id } = req.body;
    if (!player1Id || !player2Id) {
      res
        .status(400)
        .json({ error: "Missing required fields: player1Id, player2Id" });
      return;
    }
    try {
      const convo = admin.startConversation(player1Id, player2Id);
      res.json(convo);
    } catch (error) {
      const status = error instanceof DebugRouteError ? error.status : 400;
      res.status(status).json({ error: errorMessage(error) });
    }
  });

  router.post("/end-convo", (req, res) => {
    const { convoId } = req.body;
    if (!convoId) {
      res.status(400).json({ error: "Missing required field: convoId" });
      return;
    }
    try {
      const convo = admin.endConversation(convoId);
      res.json(convo);
    } catch (error) {
      const status = error instanceof DebugRouteError ? error.status : 400;
      res.status(status).json({ error: errorMessage(error) });
    }
  });

  router.post("/say", (req, res) => {
    const { playerId, convoId, content } = req.body;
    if (!playerId || !convoId || !content) {
      res
        .status(400)
        .json({ error: "Missing required fields: playerId, convoId, content" });
      return;
    }
    try {
      const msg = admin.addConversationMessage(playerId, convoId, content);
      res.json(msg);
    } catch (error) {
      const status = error instanceof DebugRouteError ? error.status : 400;
      res.status(status).json({ error: errorMessage(error) });
    }
  });

  router.post("/mode", (req, res) => {
    const { mode, tickRate } = req.body;
    if (mode && (mode === "stepped" || mode === "realtime")) {
      game.mode = mode;
    }
    res.json({ mode: game.mode, tickRate: game.tickRate });
  });

  // --- Memory endpoints (require memoryManager) ---

  if (memoryManager) {
    router.get("/memories/:playerId", async (req, res) => {
      try {
        const limit = req.query.limit
          ? Number.parseInt(req.query.limit as string, 10)
          : undefined;
        const type = req.query.type as string | undefined;
        const memories = await memoryManager.getMemories(req.params.playerId, {
          limit,
          type,
        });
        res.json(memories);
      } catch (err: any) {
        res.status(500).json({ error: err.message });
      }
    });

    router.get("/memories/:playerId/search", async (req, res) => {
      try {
        const q = req.query.q as string;
        if (!q) {
          res.status(400).json({ error: "Missing query parameter: q" });
          return;
        }
        const k = req.query.k ? Number.parseInt(req.query.k as string, 10) : 5;
        const memories = await memoryManager.searchMemories({
          playerId: req.params.playerId,
          query: q,
          k,
        });
        res.json(memories);
      } catch (err: any) {
        res.status(500).json({ error: err.message });
      }
    });

    router.post("/memories", async (req, res) => {
      try {
        const { playerId, type, content, importance, tick } = req.body;
        if (!playerId || !type || !content) {
          res.status(400).json({
            error: "Missing required fields: playerId, type, content",
          });
          return;
        }
        const memory = await memoryManager.addMemory({
          playerId,
          type,
          content,
          importance: importance ?? 5,
          tick: tick ?? game.currentTick,
        });
        res.json(memory);
      } catch (err: any) {
        res.status(500).json({ error: err.message });
      }
    });

    router.post("/remember-convo", async (req, res) => {
      try {
        const { convoId } = req.body;
        if (!convoId) {
          res.status(400).json({ error: "Missing required field: convoId" });
          return;
        }
        const convo = game.conversations.getConversation(convoId);
        if (!convo) {
          res.status(404).json({ error: "Conversation not found" });
          return;
        }
        // Create memories for both participants
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
        res.json(memories);
      } catch (err: any) {
        res.status(500).json({ error: err.message });
      }
    });
  }

  // --- Autonomy endpoints (require autonomyManager) ---

  if (autonomyManager) {
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
      const { health, food, water, social } = req.body;
      if (health !== undefined && player) {
        const maxHp = player.maxHp ?? 100;
        player.hp = Math.max(0, Math.min(maxHp, (health / 100) * maxHp));
      }
      if (food !== undefined) state.needs.food = food;
      if (water !== undefined) state.needs.water = water;
      if (social !== undefined) state.needs.social = social;
      res.json(autonomyManager.getDebugState(req.params.npcId)?.needs ?? state.needs);
    });

    router.get("/entities", (_req, res) => {
      const em = autonomyManager.getEntityManager();
      res.json(
        em.getAll().map((e) => ({
          id: e.id,
          type: e.type,
          position: e.position,
          properties: e.properties,
          destroyed: e.destroyed,
        })),
      );
    });
  }

  // --- Bear endpoints (require bearManager) ---

  if (bearManager) {
    router.get("/bears", (_req, res) => {
      res.json(
        bearManager.getBears().map((b) => ({
          id: b.id,
          position: b.position,
          properties: b.properties,
        })),
      );
    });

    router.post("/spawn-bear", (req, res) => {
      const { x, y } = req.body;
      if (x === undefined || y === undefined) {
        res.status(400).json({ error: "Missing required fields: x, y" });
        return;
      }
      const bearId = bearManager.debugSpawnBear(x, y);
      res.json({ ok: true, bearId });
    });

    router.post("/kill-bear", (req, res) => {
      const { bearId } = req.body;
      if (!bearId) {
        res.status(400).json({ error: "Missing required field: bearId" });
        return;
      }
      const killed = bearManager.debugKillBear(bearId);
      if (!killed) {
        res.status(404).json({ error: "Bear not found or already dead" });
        return;
      }
      res.json({ ok: true, bearId });
    });

    router.get("/inventory/:playerId", (_req, res) => {
      const inv = bearManager.getInventory(_req.params.playerId);
      res.json(Object.fromEntries(inv));
    });
  }

  // --- Screenshot endpoints (require wsServer) ---

  if (wsServer) {
    router.post("/capture-screenshot", async (_req, res) => {
      const png = await wsServer.requestScreenshot();
      if (!png) {
        res.status(503).json({ error: "No connected client or capture timed out" });
        return;
      }
      // Save to temp file for CLI tools to read
      const tmpDir = process.env.TMPDIR || "/tmp";
      const outPath = join(tmpDir, "claude", "qa-screenshot.png");
      try {
        const base64 = png.replace(/^data:image\/png;base64,/, "");
        writeFileSync(outPath, Buffer.from(base64, "base64"));
      } catch {
        // ignore write errors — the API response is the primary output
      }
      res.json({ ok: true, savedTo: outPath });
    });

    router.get("/screenshot", (_req, res) => {
      const png = wsServer.getLatestScreenshot();
      if (!png) {
        res.status(404).json({ error: "No screenshot available. POST /capture-screenshot first." });
        return;
      }
      const base64 = png.replace(/^data:image\/png;base64,/, "");
      res.type("image/png").send(Buffer.from(base64, "base64"));
    });
  }

  return router;
}
