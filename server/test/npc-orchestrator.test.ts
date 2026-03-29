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
import { TestGame } from "./helpers/testGame.js";

class TestProvider implements NpcModelProvider {
  readonly name = "test";

  async generateReply(request: NpcReplyRequest): Promise<NpcModelResponse> {
    return {
      content: `(${request.npc.id}) reply ${request.messages.length}`,
      prompt: `reply:${request.conversationId}`,
      sessionId: `${request.npc.id}-session`,
      latencyMs: 0,
    };
  }

  async generateReflection(
    request: NpcReflectionRequest,
  ): Promise<NpcModelResponse> {
    return {
      content: `${request.npc.id} learned something new.`,
      prompt: `reflection:${request.npc.id}`,
      sessionId: `${request.npc.id}-reflection`,
      latencyMs: 0,
    };
  }
}

async function flushAsyncWork(): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, 0));
  await new Promise((resolve) => setTimeout(resolve, 0));
}

describe("NpcOrchestrator", () => {
  let tg: TestGame;

  afterEach(() => {
    tg?.destroy();
  });

  it("queues NPC replies for active human conversations", async () => {
    tg = new TestGame({ map: "default" });
    const repo = new InMemoryRepository();
    const store = new InMemoryNpcStore();
    const memoryManager = new MemoryManager(repo, new PlaceholderEmbedder(64));
    new NpcOrchestrator(tg.game, memoryManager, new TestProvider(), store, {
      enableInitiation: false,
      enableReflections: false,
    });

    tg.spawn("human_1", 5, 8, false);
    tg.spawn("npc_alice", 6, 8, true);

    tg.game.enqueue({
      type: "start_convo",
      playerId: "human_1",
      data: { targetId: "npc_alice" },
    });

    tg.tick();
    await flushAsyncWork();
    tg.tick();

    let conversation = tg.game.conversations.getPlayerConversation("human_1");
    expect(conversation?.state).toBe("active");
    expect(conversation?.messages).toHaveLength(1);
    expect(conversation?.messages[0].playerId).toBe("npc_alice");

    tg.game.enqueue({
      type: "say",
      playerId: "human_1",
      data: { convoId: conversation!.id, content: "Hi there." },
    });

    tg.tick();
    await flushAsyncWork();
    tg.tick();
    await flushAsyncWork();

    conversation = tg.game.conversations.getPlayerConversation("human_1");
    expect(conversation?.messages).toHaveLength(3);
    expect(conversation?.messages[2].playerId).toBe("npc_alice");
    expect(store.messages).toHaveLength(3);
    expect(store.generations.filter((record) => record.kind === "reply")).toHaveLength(2);
  });

  it("lets NPCs initiate conversations with nearby humans", async () => {
    tg = new TestGame({ map: "default" });
    const repo = new InMemoryRepository();
    const store = new InMemoryNpcStore();
    const memoryManager = new MemoryManager(repo, new PlaceholderEmbedder(64));
    new NpcOrchestrator(tg.game, memoryManager, new TestProvider(), store, {
      initiationCooldownTicks: 0,
      initiationScanIntervalTicks: 1,
      initiationRadius: 3,
      enableReflections: false,
    });

    tg.spawn("human_1", 5, 8, false);
    tg.spawn("npc_alice", 6, 8, true);

    tg.tick();
    tg.tick();
    await flushAsyncWork();

    const conversation = tg.game.conversations.getPlayerConversation("human_1");
    expect(conversation).toBeDefined();
    expect(conversation?.player1Id).toBe("npc_alice");
  });

  it("stores ended conversations and generates reflections for NPCs", async () => {
    tg = new TestGame({ map: "default" });
    const repo = new InMemoryRepository();
    const store = new InMemoryNpcStore();
    const memoryManager = new MemoryManager(repo, new PlaceholderEmbedder(64));
    new NpcOrchestrator(tg.game, memoryManager, new TestProvider(), store, {
      enableInitiation: false,
      enableReflections: true,
    });

    tg.spawn("human_1", 5, 8, false);
    tg.spawn("npc_alice", 6, 8, true);

    await memoryManager.addMemory({
      playerId: "npc_alice",
      type: "observation",
      content: "I saw a lively crowd at the cafe.",
      importance: 20,
      tick: 0,
    });
    await memoryManager.addMemory({
      playerId: "npc_alice",
      type: "observation",
      content: "The baker mentioned a town rumor.",
      importance: 30,
      tick: 0,
    });

    tg.game.enqueue({
      type: "start_convo",
      playerId: "human_1",
      data: { targetId: "npc_alice" },
    });
    tg.tick();
    await flushAsyncWork();
    tg.tick();

    const conversation = tg.game.conversations.getPlayerConversation("human_1");
    expect(conversation).toBeDefined();

    tg.game.enqueue({
      type: "say",
      playerId: "human_1",
      data: { convoId: conversation!.id, content: "How's the town today?" },
    });
    tg.tick();
    await flushAsyncWork();
    tg.tick();

    tg.game.enqueue({
      type: "end_convo",
      playerId: "human_1",
      data: { convoId: conversation!.id },
    });
    tg.tick();
    await flushAsyncWork();

    const reflections = await memoryManager.getMemories("npc_alice", {
      type: "reflection",
    });
    expect(reflections).toHaveLength(1);
    expect(reflections[0].content).toContain("npc_alice learned");
    expect(store.conversations.get(conversation!.id)?.state).toBe("ended");
    expect(store.generations.some((record) => record.kind === "reflection")).toBe(true);
  });
});
