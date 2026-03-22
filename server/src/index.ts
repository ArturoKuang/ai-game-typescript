import { readFileSync } from "node:fs";
import { createServer } from "node:http";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import express from "express";
import { checkConnection, pool } from "./db/client.js";
import { runMigrations } from "./db/migrate.js";
import { Repository } from "./db/repository.js";
import { createDebugRouter } from "./debug/router.js";
import { GameLoop } from "./engine/gameLoop.js";
import type { MapData } from "./engine/types.js";
import { GameWebSocketServer } from "./network/websocket.js";
import { PlaceholderEmbedder } from "./npc/embedding.js";
import { MemoryManager } from "./npc/memory.js";

const __dirname = dirname(fileURLToPath(import.meta.url));

const app = express();
const server = createServer(app);
const PORT = Number.parseInt(process.env.PORT || "3001", 10);

app.use(express.json());

// --- Game setup ---
const game = new GameLoop({ mode: "realtime", tickRate: 20 });
const repo = new Repository(pool);
const embedder = new PlaceholderEmbedder();
const memoryManager = new MemoryManager(repo, embedder);

// Load default map
const mapPath = join(__dirname, "..", "data", "map.json");
try {
  const mapData: MapData = JSON.parse(readFileSync(mapPath, "utf-8"));
  game.loadWorld(mapData);
  console.log(`Loaded map: ${mapData.width}x${mapData.height}`);
} catch (err) {
  console.error("Failed to load map:", err);
}

// --- WebSocket ---
const wsServer = new GameWebSocketServer(server, game, game.conversations);

// Broadcast all walking player positions after every tick
game.onAfterTick((result) => {
  for (const player of game.getPlayers()) {
    if (player.state === "walking") {
      wsServer.broadcast({ type: "player_update", data: player });
    }
  }
  wsServer.broadcast({ type: "tick", data: { tick: result.tick } });
});

// Start the realtime loop
game.start();

// --- Routes ---
app.get("/health", async (_req, res) => {
  const dbConnected = await checkConnection();
  res.json({
    status: dbConnected ? "ok" : "degraded",
    tick: game.currentTick,
    dbConnected,
  });
});

app.use("/api/debug", createDebugRouter(game, memoryManager, pool));

// Serve map data
app.get("/data/map.json", (_req, res) => {
  try {
    const data = readFileSync(mapPath, "utf-8");
    res.type("application/json").send(data);
  } catch {
    res.status(404).json({ error: "Map not found" });
  }
});

async function start() {
  try {
    await runMigrations();
    server.listen(PORT, "0.0.0.0", () => {
      console.log(`Game server listening on port ${PORT}`);
      console.log(`WebSocket server ready on ws://0.0.0.0:${PORT}`);
    });
  } catch (error) {
    console.error("Failed to start server:", error);
    process.exit(1);
  }
}

start();
