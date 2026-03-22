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
import type { MapData, Player } from "./engine/types.js";
import { CHARACTERS } from "./data/characters.js";
import { GameWebSocketServer } from "./network/websocket.js";
import { PlaceholderEmbedder } from "./npc/embedding.js";
import { MemoryManager } from "./npc/memory.js";

const __dirname = dirname(fileURLToPath(import.meta.url));

/** Strip server-internal fields from player before broadcasting to clients */
function stripInternalFields(player: Player): Omit<Player, "inputX" | "inputY"> {
  const { inputX: _ix, inputY: _iy, ...rest } = player;
  return rest;
}

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

// --- Spawn NPCs ---
for (const char of CHARACTERS) {
  try {
    game.spawnPlayer({
      id: char.id,
      name: char.name,
      x: char.spawnPoint.x,
      y: char.spawnPoint.y,
      isNpc: true,
      description: char.description,
      personality: char.personality,
    });
    console.log(`Spawned NPC: ${char.name} at (${char.spawnPoint.x}, ${char.spawnPoint.y})`);
  } catch (err) {
    console.error(`Failed to spawn ${char.name}:`, err);
  }
}

// --- WebSocket ---
const wsServer = new GameWebSocketServer(server, game);

// --- Event-driven broadcasting ---
// All game events flow through this single handler
game.on("*", (event) => {
  switch (event.type) {
    case "spawn": {
      const player = game.getPlayer(event.playerId!);
      if (player) {
        wsServer.broadcast({ type: "player_joined", data: player });
      }
      break;
    }
    case "despawn": {
      wsServer.broadcast({
        type: "player_left",
        data: { id: event.playerId! },
      });
      break;
    }
    case "move_direction": {
      const playerData = event.data?.player as Player | undefined;
      if (playerData) {
        wsServer.broadcast({ type: "player_update", data: stripInternalFields(playerData) as Player });
      }
      break;
    }
    case "move_start": {
      const player = game.getPlayer(event.playerId!);
      if (player) {
        wsServer.broadcast({ type: "player_update", data: stripInternalFields(player) as Player });
      }
      break;
    }
    case "input_move":
    case "player_update": {
      const playerData = event.data?.player as Player | undefined;
      if (playerData) {
        wsServer.broadcast({ type: "player_update", data: stripInternalFields(playerData) as Player });
      }
      break;
    }
    case "move_end": {
      const player = game.getPlayer(event.playerId!);
      if (player) {
        wsServer.broadcast({ type: "player_update", data: stripInternalFields(player) as Player });
      }
      break;
    }
    case "convo_started":
    case "convo_active":
    case "convo_accepted":
    case "convo_ended": {
      const convo = event.data?.conversation;
      if (convo) {
        wsServer.broadcast({ type: "convo_update", data: convo });
      }
      break;
    }
    case "convo_message": {
      const msg = event.data?.message;
      if (msg) {
        wsServer.broadcast({ type: "message", data: msg });
      }
      break;
    }
    case "tick_complete": {
      wsServer.broadcast({
        type: "tick",
        data: { tick: event.data!.tick as number },
      });
      break;
    }
  }
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
