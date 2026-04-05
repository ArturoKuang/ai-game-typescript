/**
 * Server entry point — wires Express, WebSocket, game engine, and NPC stack.
 *
 * Boot sequence:
 * 1. Create Express app + HTTP server.
 * 2. Resolve database pool (Postgres or in-memory fallback).
 * 3. Initialize NPC components (embedder, memory manager, model provider, orchestrator).
 * 4. Load the tile map and spawn NPC characters.
 * 5. Start the WebSocket server and wire the event bridge.
 * 6. Start the realtime game loop (20 ticks/sec).
 * 7. Mount HTTP routes (/health, /api/debug/*, /data/map.json).
 */
import { existsSync, readFileSync } from "node:fs";
import { createServer } from "node:http";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import express from "express";
import type { Pool } from "pg";
import { CHARACTERS } from "./data/characters.js";
import { checkConnection, getPool } from "./db/client.js";
import { runMigrations } from "./db/migrate.js";
import { InMemoryNpcStore, PostgresNpcStore } from "./db/npcStore.js";
import { InMemoryRepository, Repository } from "./db/repository.js";
import { createDebugRouter } from "./debug/router.js";
import { GameLoop } from "./engine/gameLoop.js";
import type { MapData } from "./engine/types.js";
import { GameWebSocketServer } from "./network/websocket.js";
import { ClaudeCodeProvider } from "./npc/claudeCodeProvider.js";
import { getConfiguredClaudeCommand, resolveCommandPath } from "./npc/commandResolution.js";
import { PlaceholderEmbedder } from "./npc/embedding.js";
import { MemoryManager } from "./npc/memory.js";
import { NpcOrchestrator } from "./npc/orchestrator.js";
import { ResilientNpcProvider } from "./npc/resilientProvider.js";
import { ScriptedNpcProvider } from "./npc/scriptedProvider.js";
import { EntityManager } from "./autonomy/entityManager.js";
import { NpcAutonomyManager } from "./autonomy/manager.js";
import { BearManager } from "./bears/bearManager.js";

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
const claudeCommand = getConfiguredClaudeCommand(process.env);
const resolvedClaudeCommand = resolveCommandPath(claudeCommand, process.env.PATH);
logClaudeCommandAvailability(claudeCommand, resolvedClaudeCommand);
const provider = new ResilientNpcProvider(
  new ClaudeCodeProvider({
    command: claudeCommand,
    cwd: join(__dirname, ".."),
    model: process.env.NPC_MODEL || undefined,
  }),
  new ScriptedNpcProvider(),
);
new NpcOrchestrator(game, memoryManager, provider, npcStore, {
  enableInitiation: false, // Autonomy system handles conversation initiation
});

// Load default map
const mapPath = resolveMapPath();
const mapData: MapData = JSON.parse(readFileSync(mapPath, "utf-8"));
game.loadWorld(mapData);
console.log(`Loaded map: ${mapData.width}x${mapData.height}`);

// --- Entity Manager & NPC Autonomy ---
const entityManager = new EntityManager();
if (mapData.entities) {
  entityManager.loadFromMapData(mapData.entities);
  console.log(`Loaded ${mapData.entities.length} world entities`);
}
const autonomyManager = new NpcAutonomyManager(game, entityManager, {
  provider,
  memoryManager,
});

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
    console.log(
      `Spawned NPC: ${char.name} at (${char.spawnPoint.x}, ${char.spawnPoint.y})`,
    );
  } catch (err) {
    console.error(`Failed to spawn ${char.name}:`, err);
  }
}

// --- Bear Manager ---
const bearManager = new BearManager(game, entityManager);
bearManager.seedInitialBears();
console.log("Bear manager initialized with GoL spawning");

// --- WebSocket ---
const wsServer = new GameWebSocketServer(server, game, entityManager);
wsServer.setBearManager(bearManager);

// --- Event-driven broadcasting ---
game.on("*", (event) => wsServer.broadcastGameEvent(event));

// --- Entity change broadcasting ---
entityManager.onChange((event, entity) => {
  if (event === "update") {
    wsServer.broadcast({
      type: "entity_update",
      data: {
        id: entity.id,
        type: entity.type,
        x: entity.position.x,
        y: entity.position.y,
        properties: entity.properties,
        destroyed: entity.destroyed,
      },
    });
  } else {
    wsServer.broadcast({
      type: "entity_removed",
      data: { entityId: entity.id },
    });
  }
});

// --- NPC needs broadcasting ---
autonomyManager.onNeedsUpdate((npcId, needs) => {
  wsServer.broadcast({
    type: "npc_needs",
    data: { npcId, ...needs },
  });
});

// Start the realtime loop
game.start();

// --- Routes ---
app.get("/health", async (_req, res) => {
  const dbConnected = pool ? await checkConnection(pool) : false;
  const providerDiagnostics = provider.getDiagnostics();
  res.json({
    status: dbConnected ? "ok" : "degraded",
    tick: game.currentTick,
    dbConnected,
    npcProvider: provider.name,
    npcProviderCommand: claudeCommand,
    npcProviderCommandResolved: resolvedClaudeCommand,
    npcPrimaryAvailable: providerDiagnostics.primaryAvailable,
    npcProviderRetryInMs: providerDiagnostics.nextRetryInMs ?? 0,
    npcProviderLastError: providerDiagnostics.lastError?.message ?? null,
  });
});

app.use(
  "/api/debug",
  createDebugRouter(
    game,
    memoryManager,
    pool,
    autonomyManager,
    bearManager,
    wsServer,
    provider,
  ),
);

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

/** Try to connect to Postgres; fall back to in-memory persistence if unavailable. */
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

/** Search several candidate paths for data/map.json (handles Docker volumes and host mode). */
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

function logClaudeCommandAvailability(
  command: string,
  resolvedPath: string | null,
): void {
  if (resolvedPath) {
    console.log(`Claude CLI available for NPC provider: ${resolvedPath}`);
    return;
  }

  console.error(
    [
      `Claude CLI command "${command}" was not found on PATH.`,
      "NPC dialogue and goal selection will fall back to scripted responses.",
      "Set CLAUDE_COMMAND to an absolute path if your server environment does not inherit your shell PATH.",
    ].join(" "),
  );
}
