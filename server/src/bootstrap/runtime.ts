import { existsSync, readFileSync } from "node:fs";
import { type Server, createServer } from "node:http";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import express, { type Express } from "express";
import type { Pool } from "pg";
import { EntityManager } from "../autonomy/entityManager.js";
import { NpcAutonomyManager } from "../autonomy/manager.js";
import { BearManager } from "../bears/bearManager.js";
import { CHARACTERS } from "../data/characters.js";
import { checkConnection, getPool } from "../db/client.js";
import { runMigrations } from "../db/migrate.js";
import {
  InMemoryNpcStore,
  type NpcPersistenceStore,
  PostgresNpcStore,
} from "../db/npcStore.js";
import {
  InMemoryRepository,
  type MemoryStore,
  Repository,
} from "../db/repository.js";
import { createDebugRouter } from "../debug/router.js";
import { GameLoop } from "../engine/gameLoop.js";
import type { CharacterDef, MapData } from "../engine/types.js";
import { GameWebSocketServer } from "../network/websocket.js";
import { ClaudeCodeProvider } from "../npc/claudeCodeProvider.js";
import {
  getConfiguredClaudeCommand,
  resolveCommandPath,
} from "../npc/commandResolution.js";
import { PlaceholderEmbedder } from "../npc/embedding.js";
import { MemoryManager } from "../npc/memory.js";
import { NpcOrchestrator } from "../npc/orchestrator.js";
import { ResilientNpcProvider } from "../npc/resilientProvider.js";
import { ScriptedNpcProvider } from "../npc/scriptedProvider.js";
import { serializeWorldEntity } from "../stateSnapshots.js";

interface PersistenceServices {
  pool?: Pool;
  repo: MemoryStore;
  npcStore: NpcPersistenceStore;
}

interface BaseRuntimeServices {
  app: Express;
  server: Server;
  port: number;
  serverRoot: string;
  game: GameLoop;
}

interface NpcServices {
  memoryManager: MemoryManager;
  provider: ResilientNpcProvider;
  claudeCommand: string;
  resolvedClaudeCommand: string | null;
}

interface GameplayServices {
  entityManager: EntityManager;
  autonomyManager: NpcAutonomyManager;
  bearManager: BearManager;
  wsServer: GameWebSocketServer;
}

interface PersistedDeadNpcServices {
  persistedDeadNpcs: Awaited<ReturnType<NpcPersistenceStore["getDeadNpcs"]>>;
  deadNpcIds: Set<string>;
}

const DEFAULT_BOOT_NPC_COUNT = 4;

export interface GameServerRuntime {
  app: Express;
  server: Server;
  port: number;
  pool?: Pool;
  game: GameLoop;
  mapPath: string;
  mapData: MapData;
  memoryManager: MemoryManager;
  provider: ResilientNpcProvider;
  autonomyManager: NpcAutonomyManager;
  bearManager: BearManager;
  wsServer: GameWebSocketServer;
  claudeCommand: string;
  resolvedClaudeCommand: string | null;
}

export async function createGameServerRuntime(options?: {
  env?: NodeJS.ProcessEnv;
  moduleUrl?: string;
}): Promise<GameServerRuntime> {
  const env = options?.env ?? process.env;
  const base = createBaseRuntime(env, options?.moduleUrl ?? import.meta.url);
  const { pool, repo, npcStore } = await createPersistence(env);
  const { persistedDeadNpcs, deadNpcIds } =
    await loadPersistedDeadNpcs(npcStore);
  const { memoryManager, provider, claudeCommand, resolvedClaudeCommand } =
    createNpcRuntime(base.game, repo, npcStore, env, base.serverRoot);

  const { mapPath, mapData } = loadMapData(base.serverRoot);
  loadWorld(base.game, mapData);

  const { entityManager, autonomyManager, bearManager, wsServer } =
    createGameplayRuntime({
      server: base.server,
      game: base.game,
      mapData,
      provider,
      memoryManager,
      npcStore,
      persistedDeadNpcs,
    });

  initializeWorldActors(base.game, npcStore, deadNpcIds);
  wireRuntimeBroadcasts(base.game, entityManager, autonomyManager, wsServer);
  registerHttpRoutes(base.app, {
    pool,
    game: base.game,
    mapPath,
    memoryManager,
    autonomyManager,
    bearManager,
    wsServer,
    provider,
    claudeCommand,
    resolvedClaudeCommand,
  });

  base.game.start();

  return {
    app: base.app,
    server: base.server,
    port: base.port,
    pool,
    game: base.game,
    mapPath,
    mapData,
    memoryManager,
    provider,
    autonomyManager,
    bearManager,
    wsServer,
    claudeCommand,
    resolvedClaudeCommand,
  };
}

export async function startGameServer(
  server: Server,
  port: number,
): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    const onError = (error: Error) => {
      server.off("error", onError);
      reject(error);
    };

    server.once("error", onError);
    server.listen(port, "0.0.0.0", () => {
      server.off("error", onError);
      console.log(`Game server listening on port ${port}`);
      console.log(`WebSocket server ready on ws://0.0.0.0:${port}`);
      resolve();
    });
  });
}

function createBaseRuntime(
  env: NodeJS.ProcessEnv,
  moduleUrl: string,
): BaseRuntimeServices {
  const serverRoot = resolveServerRoot(moduleUrl);
  const app = express();
  const server = createServer(app);
  const port = Number.parseInt(env.PORT || "3001", 10);
  const game = new GameLoop({ mode: "realtime", tickRate: 20 });
  app.use(express.json());
  return { app, server, port, serverRoot, game };
}

function resolveServerRoot(moduleUrl: string): string {
  return join(dirname(fileURLToPath(moduleUrl)), "..", "..");
}

function loadMapData(serverRoot: string): {
  mapPath: string;
  mapData: MapData;
} {
  const mapPath = resolveMapPath(serverRoot);
  const mapData = JSON.parse(readFileSync(mapPath, "utf-8")) as MapData;
  return { mapPath, mapData };
}

function loadWorld(game: GameLoop, mapData: MapData): void {
  game.loadWorld(mapData);
  console.log(`Loaded map: ${mapData.width}x${mapData.height}`);
}

function createEntityManager(mapData: MapData): EntityManager {
  const entityManager = new EntityManager();
  if (mapData.entities) {
    entityManager.loadFromMapData(mapData.entities);
    console.log(`Loaded ${mapData.entities.length} world entities`);
  }
  return entityManager;
}

function spawnDefaultNpcs(
  game: GameLoop,
  characters: CharacterDef[],
  deadNpcIds: ReadonlySet<string> = new Set(),
  maxCount = characters.length,
): void {
  let spawned = 0;
  for (const char of characters) {
    if (spawned >= maxCount) {
      break;
    }
    if (deadNpcIds.has(char.id)) {
      console.log(`Skipping dead NPC: ${char.name} (${char.id})`);
      continue;
    }
    try {
      game.spawnPlayer({
        id: char.id,
        name: char.name,
        x: char.spawnPoint.x,
        y: char.spawnPoint.y,
        isNpc: true,
        description: char.description,
        personality: char.personality,
        traits: char.traits,
      });
      console.log(
        `Spawned NPC: ${char.name} at (${char.spawnPoint.x}, ${char.spawnPoint.y})`,
      );
      spawned += 1;
    } catch (error) {
      console.error(`Failed to spawn ${char.name}:`, error);
    }
  }
}

function initializeWorldActors(
  game: GameLoop,
  npcStore: NpcPersistenceStore,
  deadNpcIds: ReadonlySet<string>,
): void {
  wirePersistence(game, npcStore);
  spawnDefaultNpcs(game, CHARACTERS, deadNpcIds, DEFAULT_BOOT_NPC_COUNT);
}

function wirePersistence(game: GameLoop, npcStore: NpcPersistenceStore): void {
  game.on("spawn", (event) => {
    if (!event.playerId) {
      return;
    }
    const player = game.getPlayer(event.playerId);
    if (!player) {
      return;
    }
    void npcStore.upsertPlayer(player).catch((error) => {
      console.error(`Failed to persist player ${player.id}:`, error);
    });
  });
}

function createWebSocketRuntime(
  server: Server,
  game: GameLoop,
  entityManager: EntityManager,
  autonomyManager: NpcAutonomyManager,
  bearManager: BearManager,
): GameWebSocketServer {
  const wsServer = new GameWebSocketServer(
    server,
    game,
    entityManager,
    autonomyManager,
  );
  wsServer.setBearManager(bearManager);
  return wsServer;
}

function createGameplayRuntime(options: {
  server: Server;
  game: GameLoop;
  mapData: MapData;
  provider: ResilientNpcProvider;
  memoryManager: MemoryManager;
  npcStore: NpcPersistenceStore;
  persistedDeadNpcs: Awaited<ReturnType<NpcPersistenceStore["getDeadNpcs"]>>;
}): GameplayServices {
  const entityManager = createEntityManager(options.mapData);
  const autonomyManager = new NpcAutonomyManager(options.game, entityManager, {
    provider: options.provider,
    memoryManager: options.memoryManager,
    npcStore: options.npcStore,
    persistedDeadNpcs: options.persistedDeadNpcs,
  });
  const bearManager = createBearRuntime(options.game, entityManager);
  const wsServer = createWebSocketRuntime(
    options.server,
    options.game,
    entityManager,
    autonomyManager,
    bearManager,
  );

  return {
    entityManager,
    autonomyManager,
    bearManager,
    wsServer,
  };
}

function createBearRuntime(
  game: GameLoop,
  entityManager: EntityManager,
): BearManager {
  const bearManager = new BearManager(game, entityManager);
  bearManager.seedInitialBears();
  console.log("Bear manager initialized with GoL spawning");
  return bearManager;
}

function wireRuntimeBroadcasts(
  game: GameLoop,
  entityManager: EntityManager,
  autonomyManager: NpcAutonomyManager,
  wsServer: GameWebSocketServer,
): void {
  game.on("*", (event) => wsServer.broadcastGameEvent(event));

  entityManager.onChange((event, entity) => {
    if (event === "update") {
      wsServer.broadcast({
        type: "entity_update",
        data: serializeWorldEntity(entity),
      });
      return;
    }

    wsServer.broadcast({
      type: "entity_removed",
      data: { entityId: entity.id },
    });
  });

  autonomyManager.onNeedsUpdate((npcId, needs) => {
    wsServer.broadcast({
      type: "npc_needs",
      data: { npcId, ...needs },
    });
  });

  autonomyManager.onPlayerSurvivalUpdate((playerId, needs) => {
    wsServer.broadcast({
      type: "player_survival",
      data: { playerId, ...needs },
    });
  });

  autonomyManager.onDebugStateUpdate((state) => {
    wsServer.broadcastDebugAutonomyUpsert(state);
  });

  autonomyManager.onDebugEvent((event) => {
    wsServer.publishDebugEvent(event);
  });
}

function registerHttpRoutes(
  app: Express,
  runtime: {
    pool?: Pool;
    game: GameLoop;
    mapPath: string;
    memoryManager: MemoryManager;
    autonomyManager: NpcAutonomyManager;
    bearManager: BearManager;
    wsServer: GameWebSocketServer;
    provider: ResilientNpcProvider;
    claudeCommand: string;
    resolvedClaudeCommand: string | null;
  },
): void {
  app.get("/health", async (_req, res) => {
    const dbConnected = runtime.pool
      ? await checkConnection(runtime.pool)
      : false;
    const providerDiagnostics = runtime.provider.getDiagnostics();
    res.json({
      status: dbConnected ? "ok" : "degraded",
      tick: runtime.game.currentTick,
      dbConnected,
      npcProvider: runtime.provider.name,
      npcProviderCommand: runtime.claudeCommand,
      npcProviderCommandResolved: runtime.resolvedClaudeCommand,
      npcPrimaryAvailable: providerDiagnostics.primaryAvailable,
      npcProviderRetryInMs: providerDiagnostics.nextRetryInMs ?? 0,
      npcProviderLastError: providerDiagnostics.lastError?.message ?? null,
    });
  });

  app.use(
    "/api/debug",
    createDebugRouter(
      runtime.game,
      runtime.memoryManager,
      runtime.pool,
      runtime.autonomyManager,
      runtime.bearManager,
      runtime.wsServer,
      runtime.provider,
    ),
  );

  app.get("/data/map.json", (_req, res) => {
    try {
      const data = readFileSync(runtime.mapPath, "utf-8");
      res.type("application/json").send(data);
    } catch {
      res.status(404).json({ error: "Map not found" });
    }
  });
}

async function createPersistence(
  env: NodeJS.ProcessEnv,
): Promise<PersistenceServices> {
  const pool = await resolvePool(env);
  return {
    pool,
    repo: pool ? new Repository(pool) : new InMemoryRepository(),
    npcStore: pool ? new PostgresNpcStore(pool) : new InMemoryNpcStore(),
  };
}

async function loadPersistedDeadNpcs(
  npcStore: NpcPersistenceStore,
): Promise<PersistedDeadNpcServices> {
  const persistedDeadNpcs = await npcStore.getDeadNpcs();
  const deadNpcIds = new Set(persistedDeadNpcs.map((state) => state.npcId));
  return { persistedDeadNpcs, deadNpcIds };
}

function createNpcRuntime(
  game: GameLoop,
  repo: MemoryStore,
  npcStore: NpcPersistenceStore,
  env: NodeJS.ProcessEnv,
  serverRoot: string,
): NpcServices {
  const memoryManager = new MemoryManager(repo, new PlaceholderEmbedder());
  const claudeCommand = getConfiguredClaudeCommand(env);
  const resolvedClaudeCommand = resolveCommandPath(claudeCommand, env.PATH);
  logClaudeCommandAvailability(claudeCommand, resolvedClaudeCommand);
  const provider = new ResilientNpcProvider(
    new ClaudeCodeProvider({
      command: claudeCommand,
      cwd: serverRoot,
      model: env.NPC_MODEL || undefined,
    }),
    new ScriptedNpcProvider(),
  );
  new NpcOrchestrator(game, memoryManager, provider, npcStore, {
    enableInitiation: false,
  });

  return {
    memoryManager,
    provider,
    claudeCommand,
    resolvedClaudeCommand,
  };
}

async function resolvePool(env: NodeJS.ProcessEnv): Promise<Pool | undefined> {
  if (!env.DATABASE_URL) {
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

function resolveMapPath(serverRoot: string): string {
  const candidates = [
    join(process.cwd(), "..", "data", "map.json"),
    join(process.cwd(), "data", "map.json"),
    join(serverRoot, "..", "data", "map.json"),
    join(serverRoot, "data", "map.json"),
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
