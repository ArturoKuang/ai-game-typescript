import { existsSync, readFileSync } from "node:fs";
import { createServer } from "node:http";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import express from "express";
import type { Pool } from "pg";
import { checkConnection, getPool } from "./db/client.js";
import { runMigrations } from "./db/migrate.js";
import { InMemoryNpcStore, PostgresNpcStore } from "./db/npcStore.js";
import { InMemoryRepository, Repository } from "./db/repository.js";
import { createDebugRouter } from "./debug/router.js";
import { GameLoop } from "./engine/gameLoop.js";
import type { MapData } from "./engine/types.js";
import { CHARACTERS } from "./data/characters.js";
import { GameWebSocketServer } from "./network/websocket.js";
import { ClaudeCodeProvider } from "./npc/claudeCodeProvider.js";
import { PlaceholderEmbedder } from "./npc/embedding.js";
import { MemoryManager } from "./npc/memory.js";
import { NpcOrchestrator } from "./npc/orchestrator.js";
import { ResilientNpcProvider } from "./npc/resilientProvider.js";
import { ScriptedNpcProvider } from "./npc/scriptedProvider.js";

const __dirname = dirname(fileURLToPath(import.meta.url));

const app = express();
const server = createServer(app);
const PORT = Number.parseInt(process.env.PORT || "3001", 10);

app.use(express.json());

// --- Game setup ---
const game = new GameLoop({ mode: "realtime", tickRate: 20 });
const pool = await resolvePool();
const repo = pool ? new Repository(pool) : new InMemoryRepository();
const npcStore = pool ? new PostgresNpcStore(pool) : new InMemoryNpcStore();
const embedder = new PlaceholderEmbedder();
const memoryManager = new MemoryManager(repo, embedder);
const provider = new ResilientNpcProvider(
  new ClaudeCodeProvider({
    cwd: join(__dirname, ".."),
    model: process.env.NPC_MODEL || undefined,
  }),
  new ScriptedNpcProvider(),
);
new NpcOrchestrator(game, memoryManager, provider, npcStore);

// Load default map
const mapPath = resolveMapPath();
const mapData: MapData = JSON.parse(readFileSync(mapPath, "utf-8"));
game.loadWorld(mapData);
console.log(`Loaded map: ${mapData.width}x${mapData.height}`);

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
game.on("*", (event) => wsServer.broadcastGameEvent(event));

// Start the realtime loop
game.start();

// --- Routes ---
app.get("/health", async (_req, res) => {
  const dbConnected = pool ? await checkConnection(pool) : false;
  res.json({
    status: dbConnected ? "ok" : "degraded",
    tick: game.currentTick,
    dbConnected,
    npcProvider: provider.name,
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

async function resolvePool(): Promise<Pool | undefined> {
  if (!process.env.DATABASE_URL) {
    console.log("DATABASE_URL not set; using in-memory NPC persistence");
    return undefined;
  }

  const candidatePool = getPool();
  const connected = await checkConnection(candidatePool);
  if (!connected) {
    console.warn("Postgres unavailable; using in-memory NPC persistence");
    await candidatePool.end().catch(() => undefined);
    return undefined;
  }

  await runMigrations(candidatePool);
  return candidatePool;
}

function resolveMapPath(): string {
  const candidates = [
    join(process.cwd(), "..", "data", "map.json"),
    join(process.cwd(), "data", "map.json"),
    join(__dirname, "..", "..", "data", "map.json"),
    join(__dirname, "..", "data", "map.json"),
  ];

  for (const candidate of candidates) {
    if (existsSync(candidate)) {
      return candidate;
    }
  }

  throw new Error(
    `Failed to locate map.json. Checked: ${candidates.join(", ")}`,
  );
}
