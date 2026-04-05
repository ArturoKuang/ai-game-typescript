import { once } from "node:events";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import express from "express";
import { afterEach, describe, expect, it } from "vitest";
import { createDebugRouter } from "../src/debug/router.js";
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
  let port = 0;

  afterEach(async () => {
    tg?.destroy();
    if (server) {
      await new Promise<void>((resolve, reject) => {
        server!.close((error) => {
          if (error) reject(error);
          else resolve();
        });
      });
    }
    server = undefined;
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

  it("routes conversation mutations through engine events without advancing the tick", async () => {
    await startHarness();

    const spawnAlice = await fetchJson<{ id: string }>(port, "/api/debug/spawn", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        id: "alice",
        name: "Alice",
        x: 1,
        y: 1,
        isNpc: false,
      }),
    });
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
    const activeConversation = tg.game.conversations.getConversation(started.body.id);
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

    const ended = await fetchJson<{ state: string }>(port, "/api/debug/end-convo", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ convoId: started.body.id }),
    });
    expect(ended.status).toBe(200);
    expect(ended.body.state).toBe("ended");
    expect(
      tg.game.logger.getEvents({ types: ["convo_ended"] }).at(-1)?.type,
    ).toBe("convo_ended");
  });
});
