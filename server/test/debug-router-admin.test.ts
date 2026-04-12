import { once } from "node:events";
import { type Server, createServer } from "node:http";
import type { AddressInfo } from "node:net";
import express from "express";
import { afterEach, describe, expect, it } from "vitest";
import { WebSocket } from "ws";
import { EntityManager } from "../src/autonomy/entityManager.js";
import { NpcAutonomyManager } from "../src/autonomy/manager.js";
import { InMemoryNpcStore } from "../src/db/npcStore.js";
import { createDebugRouter } from "../src/debug/router.js";
import type { ServerMessage } from "../src/network/protocol.js";
import { GameWebSocketServer } from "../src/network/websocket.js";
import { TestGame } from "./helpers/testGame.js";

async function fetchJson<T>(
  port: number,
  path: string,
  init?: RequestInit,
): Promise<{ status: number; body: T }> {
  const response = await fetch(`http://127.0.0.1:${port}${path}`, init);
  return {
    status: response.status,
    body: (await response.json()) as T,
  };
}

describe("Debug router admin facade", () => {
  let tg: TestGame;
  let server: Server | undefined;
  let dashboardWs: WebSocket | undefined;
  let gameplayWs: WebSocket | undefined;
  let port = 0;

  afterEach(async () => {
    tg?.destroy();
    if (dashboardWs?.readyState === WebSocket.OPEN) {
      dashboardWs.close();
    }
    if (gameplayWs?.readyState === WebSocket.OPEN) {
      gameplayWs.close();
    }
    if (server) {
      await new Promise<void>((resolve, reject) => {
        server!.close((error) => {
          if (error) reject(error);
          else resolve();
        });
      });
    }
    server = undefined;
    dashboardWs = undefined;
    gameplayWs = undefined;
    port = 0;
  });

  async function startHarness(): Promise<void> {
    tg = new TestGame();
    const app = express();
    app.use(express.json());
    app.use("/api/debug", createDebugRouter(tg.game));
    server = createServer(app);
    server.listen(0, "127.0.0.1");
    await once(server, "listening");
    port = (server.address() as AddressInfo).port;
  }

  async function connectDebugDashboard(): Promise<ServerMessage[]> {
    dashboardWs = new WebSocket(`ws://127.0.0.1:${port}`);
    const messages: ServerMessage[] = [];
    dashboardWs.on("message", (raw) => {
      messages.push(JSON.parse(raw.toString()) as ServerMessage);
    });
    await once(dashboardWs, "open");
    dashboardWs.send(JSON.stringify({ type: "subscribe_debug" }));
    await waitForMessage(
      messages,
      (message) => message.type === "debug_bootstrap",
    );
    return messages;
  }

  async function startHarnessWithDebug(): Promise<{
    autonomyManager: NpcAutonomyManager;
    wsServer: GameWebSocketServer;
  }> {
    tg = new TestGame();
    const app = express();
    app.use(express.json());
    server = createServer(app);
    const autonomyManager = new NpcAutonomyManager(
      tg.game,
      new EntityManager(),
      { npcStore: new InMemoryNpcStore() },
    );
    const wsServer = new GameWebSocketServer(
      server,
      tg.game,
      undefined,
      autonomyManager,
    );
    tg.game.on("*", (event) => wsServer.broadcastGameEvent(event));
    app.use(
      "/api/debug",
      createDebugRouter(
        tg.game,
        undefined,
        undefined,
        autonomyManager,
        undefined,
        wsServer,
      ),
    );
    server.listen(0, "127.0.0.1");
    await once(server, "listening");
    port = (server.address() as AddressInfo).port;
    return { autonomyManager, wsServer };
  }

  it("routes conversation mutations through engine events without advancing the tick", async () => {
    await startHarness();

    const spawnAlice = await fetchJson<{ id: string }>(
      port,
      "/api/debug/spawn",
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          id: "alice",
          name: "Alice",
          x: 1,
          y: 1,
          isNpc: false,
        }),
      },
    );
    expect(spawnAlice.status).toBe(200);

    const spawnBob = await fetchJson<{ id: string }>(port, "/api/debug/spawn", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        id: "npc_bob",
        name: "Bob",
        x: 2,
        y: 1,
        isNpc: true,
      }),
    });
    expect(spawnBob.status).toBe(200);
    expect(tg.game.currentTick).toBe(0);
    expect(tg.game.logger.getEvents({ types: ["spawn"] })).toHaveLength(2);

    const started = await fetchJson<{ id: number; state: string }>(
      port,
      "/api/debug/start-convo",
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          player1Id: "alice",
          player2Id: "npc_bob",
        }),
      },
    );
    expect(started.status).toBe(200);
    expect(started.body.state).toBe("invited");
    expect(tg.game.currentTick).toBe(0);
    expect(
      tg.game.logger.getEvents({ types: ["convo_started"] }).at(-1)?.type,
    ).toBe("convo_started");

    tg.game.tick();
    const activeConversation = tg.game.conversations.getConversation(
      started.body.id,
    );
    expect(activeConversation?.state).toBe("active");

    const said = await fetchJson<{ content: string }>(port, "/api/debug/say", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        playerId: "alice",
        convoId: started.body.id,
        content: "hello from debug",
      }),
    });
    expect(said.status).toBe(200);
    expect(said.body.content).toBe("hello from debug");
    expect(
      tg.game.logger.getEvents({ types: ["convo_message"] }).at(-1)?.type,
    ).toBe("convo_message");

    const ended = await fetchJson<{ state: string }>(
      port,
      "/api/debug/end-convo",
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ convoId: started.body.id }),
      },
    );
    expect(ended.status).toBe(200);
    expect(ended.body.state).toBe("ended");
    expect(
      tg.game.logger.getEvents({ types: ["convo_ended"] }).at(-1)?.type,
    ).toBe("convo_ended");
  });

  it("debug reset clears simulation state without unloading the world", async () => {
    await startHarness();

    tg.spawn("alice", 1, 1);
    expect(tg.game.playerCount).toBe(1);

    const reset = await fetchJson<{ ok: boolean }>(port, "/api/debug/reset", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
    });
    expect(reset.status).toBe(200);
    expect(reset.body.ok).toBe(true);
    expect(tg.game.playerCount).toBe(0);

    const state = await fetchJson<{
      tick: number;
      playerCount: number;
      world: { width: number; height: number } | null;
    }>(port, "/api/debug/state");
    expect(state.status).toBe(200);
    expect(state.body.tick).toBe(0);
    expect(state.body.playerCount).toBe(0);
    expect(state.body.world).toEqual({ width: 5, height: 5 });
  });

  it("scenario loading resets tick state and clears prior conversations", async () => {
    await startHarness();

    tg.spawn("alice", 1, 1);
    tg.spawn("npc_bob", 2, 1, true);
    const started = await fetchJson<{ id: number }>(
      port,
      "/api/debug/start-convo",
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          player1Id: "alice",
          player2Id: "npc_bob",
        }),
      },
    );
    expect(started.status).toBe(200);
    tg.game.tick();
    expect(tg.game.currentTick).toBe(1);
    expect(tg.game.conversations.getAllConversations()).toHaveLength(1);

    const scenario = await fetchJson<{
      ok: boolean;
      scenario: string;
      playerCount: number;
      tick: number;
    }>(port, "/api/debug/scenario", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: "two_founders_meet" }),
    });
    expect(scenario.status).toBe(200);
    expect(scenario.body.ok).toBe(true);
    expect(scenario.body.scenario).toBe("two_founders_meet");
    expect(scenario.body.tick).toBe(0);
    expect(scenario.body.playerCount).toBe(2);
    expect(tg.game.currentTick).toBe(0);
    expect(tg.game.conversations.getAllConversations()).toHaveLength(0);
  });

  it("reset rebroadcasts a clean debug bootstrap to subscribed dashboards", async () => {
    await startHarnessWithDebug();

    tg.spawn("npc_alice", 1, 1, true);
    const messages = await connectDebugDashboard();

    const initialBootstrap = messages.find(
      (message) => message.type === "debug_bootstrap",
    ) as Extract<ServerMessage, { type: "debug_bootstrap" }>;
    expect(initialBootstrap.data.autonomyStates.npc_alice).toBeDefined();

    const reset = await fetchJson<{ ok: boolean }>(port, "/api/debug/reset", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
    });
    expect(reset.status).toBe(200);
    expect(reset.body.ok).toBe(true);

    const freshBootstrap = (await waitForMessage(
      messages,
      (message) =>
        message.type === "debug_bootstrap" &&
        message.data.players.length === 0 &&
        Object.keys(message.data.autonomyStates).length === 0,
    )) as Extract<ServerMessage, { type: "debug_bootstrap" }>;

    expect(freshBootstrap.data.conversations).toHaveLength(0);
    expect(freshBootstrap.data.recentEvents).toHaveLength(0);
  });

  it("lists connected clients and captures a targeted screenshot", async () => {
    await startHarnessWithDebug();

    const gameplayMessages: ServerMessage[] = [];
    gameplayWs = new WebSocket(`ws://127.0.0.1:${port}`);
    gameplayWs.on("message", (raw) => {
      const message = JSON.parse(raw.toString()) as ServerMessage;
      gameplayMessages.push(message);
      if (message.type === "capture_screenshot") {
        gameplayWs?.send(
          JSON.stringify({
            type: "screenshot_data",
            data: {
              png: "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/X/sAAAAASUVORK5CYII=",
            },
          }),
        );
      }
    });
    await once(gameplayWs, "open");

    gameplayWs.send(
      JSON.stringify({
        type: "join",
        data: { name: "Capture Client", description: "Test player" },
      }),
    );
    await waitForMessage(
      gameplayMessages,
      (message) =>
        message.type === "player_joined" &&
        message.data.name === "Capture Client",
    );

    const clients = await fetchJson<
      Array<{
        clientId: string;
        role: string;
        canCaptureScreenshot: boolean;
      }>
    >(port, "/api/debug/clients");
    expect(clients.status).toBe(200);
    const gameplayClient = clients.body.find(
      (client) => client.role === "player" && client.canCaptureScreenshot,
    );
    expect(gameplayClient).toBeDefined();

    const capture = await fetchJson<{
      ok: boolean;
      clientId: string;
      capturedAt: string;
      savedTo: string;
    }>(port, "/api/debug/capture-screenshot", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        clientId: gameplayClient?.clientId,
        timeoutMs: 500,
      }),
    });
    expect(capture.status).toBe(200);
    expect(capture.body.ok).toBe(true);
    expect(capture.body.clientId).toBe(gameplayClient?.clientId);
    expect(capture.body.savedTo).toContain(
      `screenshot-${gameplayClient?.clientId}-`,
    );

    const screenshot = await fetch(
      `http://127.0.0.1:${port}/api/debug/screenshot?clientId=${gameplayClient?.clientId}`,
    );
    expect(screenshot.status).toBe(200);
    expect((await screenshot.arrayBuffer()).byteLength).toBeGreaterThan(0);
  });
});

async function waitForMessage(
  messages: ServerMessage[],
  predicate: (message: ServerMessage) => boolean,
): Promise<ServerMessage> {
  const existing = messages.find(predicate);
  if (existing) {
    return existing;
  }

  return new Promise((resolve, reject) => {
    const startedAt = Date.now();
    const interval = setInterval(() => {
      const found = messages.find(predicate);
      if (found) {
        clearInterval(interval);
        resolve(found);
        return;
      }
      if (Date.now() - startedAt > 1000) {
        clearInterval(interval);
        reject(new Error("Timed out waiting for WebSocket message"));
      }
    }, 5);
  });
}
