import { createServer, type Server } from "node:http";
import express from "express";
import { afterEach, describe, expect, it } from "vitest";
import { createDebugRouter } from "../src/debug/router.js";
import type { NpcModelResponse } from "../src/npc/provider.js";
import { ResilientNpcProvider } from "../src/npc/resilientProvider.js";
import { ScriptedNpcProvider } from "../src/npc/scriptedProvider.js";
import { TestGame } from "./helpers/testGame.js";

class FailingProvider {
  readonly name = "failing";

  async generateReply(): Promise<NpcModelResponse> {
    throw new Error("provider unavailable");
  }

  async generateReflection(): Promise<NpcModelResponse> {
    throw new Error("provider unavailable");
  }
}

describe("NPC provider debug API", () => {
  let tg: TestGame;
  let server: Server | undefined;

  afterEach(async () => {
    tg?.destroy();
    if (server) {
      await new Promise<void>((resolve, reject) => {
        server?.close((error) => {
          if (error) {
            reject(error);
            return;
          }
          resolve();
        });
      });
      server = undefined;
    }
  });

  it("returns provider diagnostics including the last primary failure", async () => {
    tg = new TestGame();
    tg.spawn("human_1", 1, 1, false);
    tg.spawn("npc_1", 2, 1, true);

    const provider = new ResilientNpcProvider(
      new FailingProvider(),
      new ScriptedNpcProvider(),
    );

    await provider.generateReply({
      conversationId: 99,
      npc: tg.getPlayer("npc_1"),
      partner: tg.getPlayer("human_1"),
      messages: [],
      memories: [],
      currentTick: tg.game.currentTick,
    });

    const app = express();
    app.use("/api/debug", createDebugRouter(tg.game, undefined, undefined, undefined, undefined, undefined, provider));
    server = createServer(app);

    const port = await new Promise<number>((resolve, reject) => {
      server?.listen(0, "127.0.0.1", () => {
        const address = server?.address();
        if (!address || typeof address === "string") {
          reject(new Error("Failed to resolve test server port"));
          return;
        }
        resolve(address.port);
      });
      server?.once("error", reject);
    });

    const response = await fetch(`http://127.0.0.1:${port}/api/debug/npc-provider`);
    expect(response.ok).toBe(true);

    const json = await response.json();
    expect(json.primaryProvider).toBe("failing");
    expect(json.fallbackProvider).toBe("scripted");
    expect(json.primaryAvailable).toBe(false);
    expect(json.lastError.message).toContain("provider unavailable");
    expect(
      json.events.some(
        (event: { outcome: string; conversationId?: number }) =>
          event.outcome === "primary_failure" && event.conversationId === 99,
      ),
    ).toBe(true);
  });
});
