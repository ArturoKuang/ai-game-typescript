import { afterEach, describe, expect, it } from "vitest";
import { InMemoryNpcStore } from "../src/db/npcStore.js";
import { InMemoryRepository } from "../src/db/repository.js";
import type {
  NpcModelProvider,
  NpcModelResponse,
  NpcReflectionRequest,
  NpcReplyRequest,
} from "../src/npc/provider.js";
import { PlaceholderEmbedder } from "../src/npc/embedding.js";
import { MemoryManager } from "../src/npc/memory.js";
import { NpcOrchestrator } from "../src/npc/orchestrator.js";
import { ResilientNpcProvider } from "../src/npc/resilientProvider.js";
import { ScriptedNpcProvider } from "../src/npc/scriptedProvider.js";
import { TestGame } from "./helpers/testGame.js";

class FailingProvider implements NpcModelProvider {
  readonly name = "failing";
  callCount = 0;

  async generateReply(): Promise<NpcModelResponse> {
    this.callCount++;
    throw new Error("provider unavailable");
  }

  async generateReflection(): Promise<NpcModelResponse> {
    this.callCount++;
    throw new Error("provider unavailable");
  }
}

class SlowProvider implements NpcModelProvider {
  readonly name = "slow";
  resolvers: Array<(value: NpcModelResponse) => void> = [];

  async generateReply(request: NpcReplyRequest): Promise<NpcModelResponse> {
    return new Promise((resolve) => {
      this.resolvers.push(resolve);
    });
  }

  async generateReflection(): Promise<NpcModelResponse> {
    return { content: "reflected", prompt: "", latencyMs: 0 };
  }

  completeAll(): void {
    for (const resolve of this.resolvers) {
      resolve({
        content: "slow reply arrived",
        prompt: "",
        latencyMs: 500,
      });
    }
    this.resolvers = [];
  }
}

async function flushAsyncWork(): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, 0));
  await new Promise((resolve) => setTimeout(resolve, 0));
}

function makeOrchestrator(
  tg: TestGame,
  provider: NpcModelProvider,
): NpcOrchestrator {
  const repo = new InMemoryRepository();
  const store = new InMemoryNpcStore();
  const memoryManager = new MemoryManager(repo, new PlaceholderEmbedder(64));
  return new NpcOrchestrator(tg.game, memoryManager, provider, store, {
    enableInitiation: false,
    enableReflections: false,
  });
}

describe("Provider failure behavior", () => {
  let tg: TestGame;

  afterEach(() => {
    tg?.destroy();
  });

  it("NPC gets scripted fallback when primary provider throws", async () => {
    tg = new TestGame({ map: "default" });
    const failing = new FailingProvider();
    const scripted = new ScriptedNpcProvider();
    const resilient = new ResilientNpcProvider(failing, scripted);
    makeOrchestrator(tg, resilient);

    tg.spawn("human_1", 5, 8, false);
    tg.spawn("npc_1", 6, 8, true);

    tg.game.enqueue({
      type: "start_convo",
      playerId: "human_1",
      data: { targetId: "npc_1" },
    });
    tg.tick(); // start + auto-accept
    await flushAsyncWork();
    tg.tick(); // activate and schedule reply
    await flushAsyncWork();
    tg.tick(); // process say command from reply
    await flushAsyncWork();

    const convo = tg.game.conversations.getPlayerConversation("human_1");
    // NPC should have replied (via scripted fallback)
    expect(convo?.messages.length).toBeGreaterThanOrEqual(1);
    expect(failing.callCount).toBe(1);

    const diagnostics = resilient.getDiagnostics();
    expect(diagnostics.primaryAvailable).toBe(false);
    expect(diagnostics.lastError?.message).toContain("provider unavailable");
    expect(
      diagnostics.events.some(
        (event) =>
          event.phase === "reply" &&
          event.outcome === "primary_failure" &&
          event.conversationId === convo?.id &&
          event.npcId === "npc_1",
      ),
    ).toBe(true);
    expect(
      diagnostics.events.some(
        (event) =>
          event.phase === "reply" &&
          event.outcome === "fallback_used" &&
          event.conversationId === convo?.id,
      ),
    ).toBe(true);
  });

  it("records cooldown skip diagnostics after a primary failure", async () => {
    tg = new TestGame();
    tg.spawn("human_1", 1, 1, false);
    tg.spawn("npc_1", 2, 1, true);

    const failing = new FailingProvider();
    const resilient = new ResilientNpcProvider(failing, new ScriptedNpcProvider());
    const request: NpcReplyRequest = {
      conversationId: 42,
      npc: tg.getPlayer("npc_1"),
      partner: tg.getPlayer("human_1"),
      messages: [],
      memories: [],
      currentTick: tg.game.currentTick,
    };

    await resilient.generateReply(request);
    await resilient.generateReply(request);

    const diagnostics = resilient.getDiagnostics();
    expect(failing.callCount).toBe(1);
    expect(
      diagnostics.events.some(
        (event) =>
          event.phase === "reply" &&
          event.outcome === "primary_skipped" &&
          event.conversationId === 42 &&
          typeof event.cooldownRemainingMs === "number",
      ),
    ).toBe(true);
  });

  it("orchestrator does not crash when provider rejects", async () => {
    tg = new TestGame({ map: "default" });
    const failing = new FailingProvider();
    makeOrchestrator(tg, failing);

    tg.spawn("human_1", 5, 8, false);
    tg.spawn("npc_1", 6, 8, true);

    tg.game.enqueue({
      type: "start_convo",
      playerId: "human_1",
      data: { targetId: "npc_1" },
    });
    tg.tick();
    await flushAsyncWork();
    tg.tick();
    await flushAsyncWork();

    // Game should continue without crashing
    expect(() => tg.tick(5)).not.toThrow();
    // NPC should no longer be waiting
    expect(tg.game.getPlayer("npc_1")?.isWaitingForResponse).toBe(false);
  });

  it("orchestrator handles slow provider without blocking tick", async () => {
    tg = new TestGame({ map: "default" });
    const slow = new SlowProvider();
    makeOrchestrator(tg, slow);

    tg.spawn("human_1", 5, 8, false);
    tg.spawn("npc_1", 6, 8, true);

    tg.game.enqueue({
      type: "start_convo",
      playerId: "human_1",
      data: { targetId: "npc_1" },
    });
    tg.tick();
    await flushAsyncWork();

    // Tick continues even though provider hasn't responded
    const start = performance.now();
    tg.tick(10);
    const elapsed = performance.now() - start;
    expect(elapsed).toBeLessThan(100); // ticks are not blocked

    // NPC is waiting
    expect(tg.game.getPlayer("npc_1")?.isWaitingForResponse).toBe(true);

    // Now complete the slow reply
    slow.completeAll();
    await flushAsyncWork();
    tg.tick();
    await flushAsyncWork();

    // Reply should have arrived
    const convo = tg.game.conversations.getPlayerConversation("human_1");
    expect(convo?.messages.some((m) => m.content === "slow reply arrived")).toBe(
      true,
    );
  });

  it("multiple NPCs can have in-flight requests simultaneously", async () => {
    tg = new TestGame({ map: "default" });
    const slow = new SlowProvider();
    makeOrchestrator(tg, slow);

    tg.spawn("h1", 3, 8, false);
    tg.spawn("h2", 10, 8, false);
    tg.spawn("n1", 4, 8, true);
    tg.spawn("n2", 11, 8, true);

    // Start two conversations
    tg.game.enqueue({
      type: "start_convo",
      playerId: "h1",
      data: { targetId: "n1" },
    });
    tg.game.enqueue({
      type: "start_convo",
      playerId: "h2",
      data: { targetId: "n2" },
    });
    tg.tick();
    await flushAsyncWork();
    tg.tick();
    await flushAsyncWork();

    // Both NPCs should be waiting
    expect(tg.game.getPlayer("n1")?.isWaitingForResponse).toBe(true);
    expect(tg.game.getPlayer("n2")?.isWaitingForResponse).toBe(true);
    expect(slow.resolvers.length).toBe(2); // 2 concurrent requests

    // Complete all
    slow.completeAll();
    await flushAsyncWork();
    tg.tick();
    await flushAsyncWork();

    expect(tg.game.getPlayer("n1")?.isWaitingForResponse).toBe(false);
    expect(tg.game.getPlayer("n2")?.isWaitingForResponse).toBe(false);
  });
});
