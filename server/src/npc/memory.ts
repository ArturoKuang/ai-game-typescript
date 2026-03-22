import type { Memory, Repository, ScoredMemory } from "../db/repository.js";
import type { Embedder } from "./embedding.js";
import { cosineSimilarity } from "./embedding.js";

const RECENCY_DECAY = 0.99; // per tick
const REFLECTION_THRESHOLD = 50; // cumulative importance to trigger reflection
const MEMORY_ACCESS_THROTTLE = 30; // ticks between access updates

export class MemoryManager {
  constructor(
    private repo: Repository,
    private embedder: Embedder,
  ) {}

  /** Create a new memory with embedding */
  async addMemory(params: {
    playerId: string;
    type: "observation" | "conversation" | "reflection";
    content: string;
    importance: number;
    tick: number;
    relatedIds?: number[];
  }): Promise<Memory> {
    const embedding = await this.embedder.embed(params.content);
    return this.repo.addMemory({
      ...params,
      embedding,
    });
  }

  /** Summarize a conversation and store as memory */
  async rememberConversation(params: {
    playerId: string;
    partnerName: string;
    messages: { playerId: string; content: string }[];
    tick: number;
  }): Promise<Memory> {
    const { playerId, partnerName, messages, tick } = params;

    // Build a simple summary from the messages
    const transcript = messages
      .map(
        (m) => `${m.playerId === playerId ? "I" : partnerName}: ${m.content}`,
      )
      .join(". ");

    const summary = `Had a conversation with ${partnerName}. ${transcript}`;
    const importance = Math.min(
      9,
      Math.max(1, Math.ceil(messages.length * 1.5)),
    );

    return this.addMemory({
      playerId,
      type: "conversation",
      content: summary,
      importance,
      tick,
    });
  }

  /** Get memories for a player */
  async getMemories(
    playerId: string,
    options?: { limit?: number; type?: string },
  ): Promise<Memory[]> {
    return this.repo.getMemories(playerId, options);
  }

  /**
   * Retrieve memories ranked by composite score:
   * score = α*recency + β*importance + γ*relevance
   */
  async retrieveMemories(params: {
    playerId: string;
    query: string;
    currentTick: number;
    k?: number;
  }): Promise<ScoredMemory[]> {
    const { playerId, query, currentTick, k = 5 } = params;

    // Get candidates via vector search (overfetch for re-ranking)
    const queryEmbedding = await this.embedder.embed(query);
    const candidates = await this.repo.searchMemoriesByVector(
      playerId,
      queryEmbedding,
      k * 6,
    );

    if (candidates.length === 0) return [];

    // Score each candidate
    const scored: ScoredMemory[] = candidates.map(({ memory, similarity }) => {
      const ticksAgo = Math.max(0, currentTick - memory.tick);
      const recencyScore = RECENCY_DECAY ** ticksAgo;
      const importanceScore = memory.importance / 10;
      const relevanceScore = Math.max(0, similarity); // cosine sim can be negative

      const score = recencyScore + importanceScore + relevanceScore;

      return {
        ...memory,
        score,
        recencyScore,
        importanceScore,
        relevanceScore,
      };
    });

    // Sort by score descending, take top k
    scored.sort((a, b) => b.score - a.score);
    const topK = scored.slice(0, k);

    // Update access timestamps (throttled)
    for (const m of topK) {
      if (
        !m.lastAccessedTick ||
        currentTick - m.lastAccessedTick > MEMORY_ACCESS_THROTTLE
      ) {
        await this.repo.updateMemoryAccess(m.id, currentTick);
      }
    }

    return topK;
  }

  /** Search memories by text query */
  async searchMemories(params: {
    playerId: string;
    query: string;
    k?: number;
  }): Promise<ScoredMemory[]> {
    const { playerId, query, k = 5 } = params;
    const queryEmbedding = await this.embedder.embed(query);
    const candidates = await this.repo.searchMemoriesByVector(
      playerId,
      queryEmbedding,
      k,
    );

    return candidates.map(({ memory, similarity }) => ({
      ...memory,
      score: similarity,
      recencyScore: 0,
      importanceScore: memory.importance / 10,
      relevanceScore: similarity,
    }));
  }

  /**
   * Generate reflections when cumulative importance exceeds threshold.
   * Returns the reflection memory if generated, null otherwise.
   */
  async maybeReflect(params: {
    playerId: string;
    currentTick: number;
    lastReflectionId?: number;
  }): Promise<Memory | null> {
    const { playerId, currentTick, lastReflectionId } = params;

    const recentMemories = await this.repo.getRecentMemories(
      playerId,
      100,
      lastReflectionId,
    );

    if (recentMemories.length < 3) return null;

    const cumulativeImportance = recentMemories.reduce(
      (sum, m) => sum + m.importance,
      0,
    );

    if (cumulativeImportance < REFLECTION_THRESHOLD) return null;

    // Generate a template-based reflection (Phase 7 upgrades to LLM)
    const topics = recentMemories
      .filter((m) => m.type === "conversation")
      .slice(0, 5)
      .map((m) => m.content.split(".")[0]);

    const reflectionContent =
      topics.length > 0
        ? `Reflecting on recent experiences: ${topics.join("; ")}. These interactions have shaped my understanding of the community.`
        : `I've been observing the town and reflecting on what I've experienced so far.`;

    const reflection = await this.addMemory({
      playerId,
      type: "reflection",
      content: reflectionContent,
      importance: 8,
      tick: currentTick,
      relatedIds: recentMemories.slice(0, 5).map((m) => m.id),
    });

    return reflection;
  }
}
