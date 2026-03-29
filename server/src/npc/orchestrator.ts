import type { NpcPersistenceStore } from "../db/npcStore.js";
import type { Memory } from "../db/repository.js";
import type { Conversation, Message } from "../engine/conversation.js";
import type { GameEvent, Player } from "../engine/types.js";
import type { GameLoop } from "../engine/gameLoop.js";
import { MemoryManager } from "./memory.js";
import type { NpcModelProvider } from "./provider.js";

interface ModelRuntime {
  sessionId?: string;
  inFlight: boolean;
  lastRequestedMessageCount: number;
}

export interface NpcOrchestratorOptions {
  initiationCooldownTicks?: number;
  initiationScanIntervalTicks?: number;
  initiationRadius?: number;
  joinGraceTicks?: number;
  enableInitiation?: boolean;
  enableReflections?: boolean;
}

/** Ticks before an NPC can initiate another conversation (6s at 20 ticks/sec) */
const DEFAULT_INITIATION_COOLDOWN = 120;
/** Ticks between NPC initiation scans (1s at 20 ticks/sec) */
const DEFAULT_INITIATION_INTERVAL = 20;
/** Manhattan distance within which an NPC will initiate conversation */
const DEFAULT_INITIATION_RADIUS = 6;
/** Grace period after a human joins before NPCs can auto-initiate */
const DEFAULT_JOIN_GRACE_TICKS = 100;
/** Number of recent messages used as the memory retrieval query */
const MEMORY_CONTEXT_MESSAGES = 4;
/** Maximum related memory IDs attached to a reflection */
const MAX_RELATED_MEMORIES = 4;
/** Number of memories retrieved for conversation context */
const RETRIEVAL_LIMIT = 5;

export class NpcOrchestrator {
  private readonly runtimes = new Map<string, ModelRuntime>();
  private readonly lastInitiatedAt = new Map<string, number>();
  private readonly lastReflectionIds = new Map<string, number>();
  private readonly reflectionInFlight = new Set<string>();
  private readonly humanJoinTicks = new Map<string, number>();
  private readonly initiationCooldownTicks: number;
  private readonly initiationScanIntervalTicks: number;
  private readonly initiationRadius: number;
  private readonly joinGraceTicks: number;
  private readonly enableInitiation: boolean;
  private readonly enableReflections: boolean;

  constructor(
    private game: GameLoop,
    private memoryManager: MemoryManager,
    private provider: NpcModelProvider,
    private store: NpcPersistenceStore,
    options: NpcOrchestratorOptions = {},
  ) {
    this.initiationCooldownTicks =
      options.initiationCooldownTicks ?? DEFAULT_INITIATION_COOLDOWN;
    this.initiationScanIntervalTicks =
      options.initiationScanIntervalTicks ?? DEFAULT_INITIATION_INTERVAL;
    this.initiationRadius = options.initiationRadius ?? DEFAULT_INITIATION_RADIUS;
    this.joinGraceTicks = options.joinGraceTicks ?? DEFAULT_JOIN_GRACE_TICKS;
    this.enableInitiation = options.enableInitiation ?? true;
    this.enableReflections = options.enableReflections ?? true;

    this.game.on("spawn", (event) => {
      const player = event.playerId ? this.game.getPlayer(event.playerId) : undefined;
      if (player && !player.isNpc) {
        this.humanJoinTicks.set(player.id, event.tick);
      }
    });
    this.game.on("despawn", (event) => {
      if (event.playerId) {
        this.humanJoinTicks.delete(event.playerId);
      }
    });
    this.game.on("convo_started", (event) => this.handleEvent(event));
    this.game.on("convo_accepted", (event) => this.handleEvent(event));
    this.game.on("convo_active", (event) => this.handleEvent(event));
    this.game.on("convo_ended", (event) => this.handleEvent(event));
    this.game.on("convo_message", (event) => this.handleEvent(event));
    this.game.onAfterTick(() => {
      if (this.enableInitiation) {
        this.maybeInitiateConversations();
      }
    });
  }

  private handleEvent(event: GameEvent): void {
    void this.handleEventAsync(event).catch((error) => {
      console.error("NPC orchestrator error:", error);
    });
  }

  private async handleEventAsync(event: GameEvent): Promise<void> {
    switch (event.type) {
      case "convo_started":
      case "convo_accepted":
      case "convo_active": {
        const conversation = this.resolveConversation(event);
        if (!conversation) return;
        await this.persistConversationPlayers(conversation);
        await this.store.upsertConversation(conversation);
        if (event.type === "convo_active") {
          this.scheduleReply(conversation.id);
        }
        return;
      }
      case "convo_message": {
        const conversation = this.resolveConversation(event);
        const message = event.data?.message as Message | undefined;
        if (conversation) {
          await this.persistConversationPlayers(conversation);
          await this.store.upsertConversation(conversation);
        }
        if (message) {
          await this.store.addMessage(message);
        }
        const convoId = message?.convoId ?? conversation?.id;
        if (convoId !== undefined) {
          this.scheduleReply(convoId);
        }
        return;
      }
      case "convo_ended": {
        const conversation = this.resolveConversation(event);
        if (!conversation) return;
        await this.persistConversationPlayers(conversation);
        await this.store.upsertConversation(conversation);
        await this.rememberConversation(conversation);
        this.clearConversationRuntimes(conversation.id);
        return;
      }
    }
  }

  private resolveConversation(event: GameEvent): Conversation | undefined {
    const fromEvent = event.data?.conversation as Conversation | undefined;
    if (fromEvent) return fromEvent;
    const convoId = event.data?.convoId as number | undefined;
    return convoId !== undefined
      ? this.game.conversations.getConversation(convoId)
      : undefined;
  }

  private scheduleReply(conversationId: number): void {
    const conversation = this.game.conversations.getConversation(conversationId);
    if (!conversation || conversation.state !== "active") return;

    const npc = this.chooseNextNpcSpeaker(conversation);
    if (!npc) return;

    const runtime = this.getRuntime(this.replyRuntimeKey(conversation.id, npc.id));
    const currentMessageCount = conversation.messages.length;
    if (
      runtime.inFlight ||
      runtime.lastRequestedMessageCount === currentMessageCount
    ) {
      return;
    }

    runtime.inFlight = true;
    runtime.lastRequestedMessageCount = currentMessageCount;
    this.game.setPlayerWaitingForResponse(npc.id, true);
    void this.generateReply(conversation, npc, runtime).catch((error) => {
      console.error("Failed to generate NPC reply:", error);
      runtime.inFlight = false;
      this.game.setPlayerWaitingForResponse(npc.id, false);
    });
  }

  private async generateReply(
    conversation: Conversation,
    npc: Player,
    runtime: ModelRuntime,
  ): Promise<void> {
    const partnerId =
      npc.id === conversation.player1Id
        ? conversation.player2Id
        : conversation.player1Id;
    const partner = this.game.getPlayer(partnerId);
    if (!partner) {
      runtime.inFlight = false;
      this.game.setPlayerWaitingForResponse(npc.id, false);
      return;
    }

    const memoryQuery = conversation.messages
      .slice(-MEMORY_CONTEXT_MESSAGES)
      .map((message) => message.content)
      .join(" ");
    const memories = await this.retrieveMemories(npc.id, memoryQuery);

    try {
      const response = await this.provider.generateReply({
        conversationId: conversation.id,
        npc,
        partner,
        messages: conversation.messages,
        memories,
        currentTick: this.game.currentTick,
        sessionId: runtime.sessionId,
      });

      runtime.sessionId = response.sessionId ?? runtime.sessionId;
      await this.store.addGeneration({
        conversationId: conversation.id,
        playerId: npc.id,
        kind: "reply",
        provider: this.provider.name,
        sessionId: runtime.sessionId,
        prompt: response.prompt,
        response: response.content,
        latencyMs: response.latencyMs,
        tick: this.game.currentTick,
      });

      const currentConversation = this.game.conversations.getConversation(
        conversation.id,
      );
      if (!currentConversation || currentConversation.state !== "active") {
        runtime.inFlight = false;
        this.game.setPlayerWaitingForResponse(npc.id, false);
        return;
      }

      this.game.enqueue({
        type: "say",
        playerId: npc.id,
        data: {
          convoId: conversation.id,
          content: response.content,
        },
      });
    } catch (error) {
      await this.store.addGeneration({
        conversationId: conversation.id,
        playerId: npc.id,
        kind: "reply",
        provider: this.provider.name,
        sessionId: runtime.sessionId,
        prompt: `reply:${conversation.id}`,
        error: error instanceof Error ? error.message : String(error),
        tick: this.game.currentTick,
      });
      throw error;
    } finally {
      runtime.inFlight = false;
      this.game.setPlayerWaitingForResponse(npc.id, false);
    }
  }

  private chooseNextNpcSpeaker(conversation: Conversation): Player | undefined {
    const lastMessage = conversation.messages[conversation.messages.length - 1];
    const nextSpeakerId = !lastMessage
      ? this.initialSpeakerId(conversation)
      : lastMessage.playerId === conversation.player1Id
        ? conversation.player2Id
        : conversation.player1Id;
    if (!nextSpeakerId) return undefined;
    const nextSpeaker = this.game.getPlayer(nextSpeakerId);
    return nextSpeaker?.isNpc ? nextSpeaker : undefined;
  }

  private initialSpeakerId(conversation: Conversation): string | undefined {
    const player1 = this.game.getPlayer(conversation.player1Id);
    if (player1?.isNpc) return player1.id;
    const player2 = this.game.getPlayer(conversation.player2Id);
    return player2?.isNpc ? player2.id : undefined;
  }

  private async retrieveMemories(
    playerId: string,
    query: string,
  ): Promise<Memory[]> {
    if (!query.trim()) {
      return this.memoryManager.getMemories(playerId, { limit: RETRIEVAL_LIMIT });
    }
    const scored = await this.memoryManager.retrieveMemories({
      playerId,
      query,
      currentTick: this.game.currentTick,
      k: RETRIEVAL_LIMIT,
    });
    return scored.map((memory) => memory);
  }

  private async rememberConversation(conversation: Conversation): Promise<void> {
    await this.persistConversationPlayers(conversation);
    for (const playerId of [conversation.player1Id, conversation.player2Id]) {
      const partnerId =
        playerId === conversation.player1Id
          ? conversation.player2Id
          : conversation.player1Id;
      const partner = this.game.getPlayer(partnerId);
      const memory = await this.memoryManager.rememberConversation({
        playerId,
        partnerName: partner?.name ?? partnerId,
        messages: conversation.messages,
        tick: this.game.currentTick,
      });

      if (this.game.getPlayer(playerId)?.isNpc && this.enableReflections) {
        void this.maybeReflect(playerId, memory.id).catch((error) => {
          console.error("Failed to generate NPC reflection:", error);
        });
      }
    }
  }

  private async persistConversationPlayers(
    conversation: Conversation,
  ): Promise<void> {
    const playerIds = [conversation.player1Id, conversation.player2Id];
    for (const playerId of playerIds) {
      const player = this.game.getPlayer(playerId);
      if (player) {
        await this.store.upsertPlayer(player);
      }
    }
  }

  private async maybeReflect(
    npcId: string,
    lastConversationMemoryId: number,
  ): Promise<void> {
    if (this.reflectionInFlight.has(npcId)) return;
    this.reflectionInFlight.add(npcId);
    try {
      const recentMemories = await this.memoryManager.getRecentMemoriesForReflection({
        playerId: npcId,
        lastReflectionId: this.lastReflectionIds.get(npcId),
        limit: 100,
      });

      const importanceSum = recentMemories.reduce(
        (sum, memory) => sum + memory.importance,
        0,
      );
      if (
        recentMemories.length < 3 ||
        importanceSum < this.memoryManager.getReflectionThreshold()
      ) {
        return;
      }

      const npc = this.game.getPlayer(npcId);
      if (!npc) return;

      const runtime = this.getRuntime(this.reflectionRuntimeKey(npcId));
      const response = await this.provider.generateReflection({
        npc,
        memories: recentMemories,
        currentTick: this.game.currentTick,
        sessionId: runtime.sessionId,
      });
      runtime.sessionId = response.sessionId ?? runtime.sessionId;
      await this.store.addGeneration({
        playerId: npcId,
        kind: "reflection",
        provider: this.provider.name,
        sessionId: runtime.sessionId,
        prompt: response.prompt,
        response: response.content,
        latencyMs: response.latencyMs,
        tick: this.game.currentTick,
      });

      const reflection = await this.memoryManager.addReflection({
        playerId: npcId,
        content: response.content,
        tick: this.game.currentTick,
        relatedIds: [lastConversationMemoryId, ...recentMemories.slice(0, MAX_RELATED_MEMORIES).map((memory) => memory.id)],
      });
      this.lastReflectionIds.set(npcId, reflection.id);
    } finally {
      this.reflectionInFlight.delete(npcId);
    }
  }

  private maybeInitiateConversations(): void {
    if (this.game.currentTick % this.initiationScanIntervalTicks !== 0) {
      return;
    }

    const reserved = new Set<string>();
    // Sort by ID for deterministic initiation order under seeded RNG.
    const npcs = this.game
      .getPlayers()
      .filter((player) => player.isNpc)
      .sort((left: Player, right: Player) => left.id.localeCompare(right.id));

    for (const npc of npcs) {
      if (reserved.has(npc.id)) continue;
      if (npc.state !== "idle") continue;
      if (this.game.conversations.getPlayerConversation(npc.id)) continue;
      const lastInitiatedAt = this.lastInitiatedAt.get(npc.id) ?? -Infinity;
      if (this.game.currentTick - lastInitiatedAt < this.initiationCooldownTicks) {
        continue;
      }

      const target = this.findInitiationTarget(npc, reserved);
      if (!target) continue;

      reserved.add(npc.id);
      reserved.add(target.id);
      this.lastInitiatedAt.set(npc.id, this.game.currentTick);
      this.game.enqueue({
        type: "start_convo",
        playerId: npc.id,
        data: { targetId: target.id },
      });
    }
  }

  private findInitiationTarget(
    npc: Player,
    reserved: Set<string>,
  ): Player | undefined {
    return this.game
      .getPlayers()
      .filter((player) => {
        if (player.id === npc.id) return false;
        if (reserved.has(player.id)) return false;
        if (player.state !== "idle") return false;
        if (this.game.conversations.getPlayerConversation(player.id)) return false;
        if (
          !player.isNpc &&
          this.game.currentTick - (this.humanJoinTicks.get(player.id) ?? -Infinity) <
            this.joinGraceTicks
        ) {
          return false;
        }
        return manhattanDistance(npc, player) <= this.initiationRadius;
      })
      .sort((left, right) => {
        const leftDistance = manhattanDistance(npc, left);
        const rightDistance = manhattanDistance(npc, right);
        if (leftDistance !== rightDistance) {
          return leftDistance - rightDistance;
        }
        if (left.isNpc !== right.isNpc) {
          return left.isNpc ? 1 : -1;
        }
        return left.id.localeCompare(right.id);
      })[0];
  }

  private getRuntime(key: string): ModelRuntime {
    const existing = this.runtimes.get(key);
    if (existing) return existing;
    const created: ModelRuntime = {
      inFlight: false,
      lastRequestedMessageCount: -1,
    };
    this.runtimes.set(key, created);
    return created;
  }

  private clearConversationRuntimes(conversationId: number): void {
    for (const key of this.runtimes.keys()) {
      if (key.startsWith(`${conversationId}:`)) {
        const npcId = key.slice(key.indexOf(":") + 1);
        this.game.setPlayerWaitingForResponse(npcId, false);
        this.runtimes.delete(key);
      }
    }
  }

  private replyRuntimeKey(conversationId: number, npcId: string): string {
    return `${conversationId}:${npcId}`;
  }

  private reflectionRuntimeKey(npcId: string): string {
    return `reflection:${npcId}`;
  }
}

function manhattanDistance(left: Player, right: Player): number {
  return Math.abs(left.x - right.x) + Math.abs(left.y - right.y);
}
