import { Router } from "express";
import type { Pool } from "pg";
import type { GameLoop } from "../engine/gameLoop.js";
import type { Player } from "../engine/types.js";
import type { MemoryManager } from "../npc/memory.js";
import { renderAsciiMap } from "./asciiMap.js";
import { SCENARIOS, listScenarios } from "./scenarios.js";

async function persistPlayer(
  pool: Pool | undefined,
  player: Player,
): Promise<void> {
  if (!pool) return;
  await pool.query(
    `INSERT INTO players (id, name, description, personality, is_npc, x, y, state)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
     ON CONFLICT (id) DO UPDATE SET x = $6, y = $7, state = $8`,
    [
      player.id,
      player.name,
      player.description,
      player.personality ?? null,
      player.isNpc,
      player.x,
      player.y,
      player.state,
    ],
  );
}

export function createDebugRouter(
  game: GameLoop,
  memoryManager?: MemoryManager,
  pool?: Pool,
): Router {
  const router = Router();

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
    const { ascii, legend } = renderAsciiMap(game);
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
    res.json(game.logger.getEvents({ since, limit, playerId }));
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
      const player = game.spawnPlayer({
        id,
        name,
        x,
        y,
        isNpc,
        description,
        personality,
        speed,
      });
      await persistPlayer(pool, player);
      res.json(player);
    } catch (err: any) {
      res.status(400).json({ error: err.message });
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
    const path = game.setPlayerTarget(playerId, x, y);
    if (!path) {
      res.status(400).json({
        error: "Cannot move to target (unreachable or player in conversation)",
      });
      return;
    }
    res.json({ path });
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
    // Reset existing players but keep world
    for (const p of game.getPlayers()) {
      game.removePlayer(p.id);
    }
    SCENARIOS[name].setup(game);
    // Persist all spawned players to DB
    for (const p of game.getPlayers()) {
      await persistPlayer(pool, p);
    }
    res.json({
      ok: true,
      scenario: name,
      playerCount: game.playerCount,
      tick: game.currentTick,
    });
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
      const convo = game.conversations.startConversation(
        player1Id,
        player2Id,
        game.currentTick,
      );
      res.json(convo);
    } catch (err: any) {
      res.status(400).json({ error: err.message });
    }
  });

  router.post("/end-convo", (req, res) => {
    const { convoId } = req.body;
    if (!convoId) {
      res.status(400).json({ error: "Missing required field: convoId" });
      return;
    }
    try {
      const convo = game.conversations.endConversation(
        convoId,
        game.currentTick,
      );
      res.json(convo);
    } catch (err: any) {
      res.status(400).json({ error: err.message });
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
      const msg = game.conversations.addMessage(
        convoId,
        playerId,
        content,
        game.currentTick,
      );
      res.json(msg);
    } catch (err: any) {
      res.status(400).json({ error: err.message });
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

  return router;
}
