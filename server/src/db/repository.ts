import type { Pool } from "pg";

export interface MemoryRow {
  id: number;
  player_id: string;
  type: string;
  content: string;
  importance: number;
  embedding: number[] | null;
  related_ids: number[] | null;
  tick: number;
  last_accessed_tick: number | null;
  created_at: Date;
}

export interface Memory {
  id: number;
  playerId: string;
  type: "observation" | "conversation" | "reflection";
  content: string;
  importance: number;
  embedding?: number[];
  relatedIds: number[];
  tick: number;
  lastAccessedTick?: number;
}

export interface ScoredMemory extends Memory {
  score: number;
  recencyScore: number;
  importanceScore: number;
  relevanceScore: number;
}

export class Repository {
  constructor(private pool: Pool) {}

  // --- Memories ---

  async addMemory(params: {
    playerId: string;
    type: string;
    content: string;
    importance: number;
    embedding: number[] | null;
    relatedIds?: number[];
    tick: number;
  }): Promise<Memory> {
    const embeddingStr = params.embedding
      ? `[${params.embedding.join(",")}]`
      : null;

    const result = await this.pool.query(
      `INSERT INTO memories (player_id, type, content, importance, embedding, related_ids, tick)
       VALUES ($1, $2, $3, $4, $5::vector, $6, $7)
       RETURNING id, player_id, type, content, importance, related_ids, tick, last_accessed_tick`,
      [
        params.playerId,
        params.type,
        params.content,
        params.importance,
        embeddingStr,
        params.relatedIds ?? [],
        params.tick,
      ],
    );

    return this.rowToMemory(result.rows[0]);
  }

  async getMemories(
    playerId: string,
    options?: { limit?: number; type?: string },
  ): Promise<Memory[]> {
    let query = "SELECT * FROM memories WHERE player_id = $1";
    const params: unknown[] = [playerId];

    if (options?.type) {
      params.push(options.type);
      query += ` AND type = $${params.length}`;
    }

    query += " ORDER BY tick DESC";

    if (options?.limit) {
      params.push(options.limit);
      query += ` LIMIT $${params.length}`;
    }

    const result = await this.pool.query(query, params);
    return result.rows.map((r: MemoryRow) => this.rowToMemory(r));
  }

  async searchMemoriesByVector(
    playerId: string,
    embedding: number[],
    k: number,
  ): Promise<{ memory: Memory; similarity: number }[]> {
    const embeddingStr = `[${embedding.join(",")}]`;

    const result = await this.pool.query(
      `SELECT *, 1 - (embedding <=> $1::vector) AS similarity
       FROM memories
       WHERE player_id = $2 AND embedding IS NOT NULL
       ORDER BY embedding <=> $1::vector
       LIMIT $3`,
      [embeddingStr, playerId, k],
    );

    return result.rows.map((r: MemoryRow & { similarity: number }) => ({
      memory: this.rowToMemory(r),
      similarity: Number.parseFloat(String(r.similarity)),
    }));
  }

  async updateMemoryAccess(id: number, tick: number): Promise<void> {
    await this.pool.query(
      "UPDATE memories SET last_accessed_tick = $1 WHERE id = $2",
      [tick, id],
    );
  }

  async getMemoryCount(playerId: string, sinceId?: number): Promise<number> {
    let query = "SELECT COUNT(*) FROM memories WHERE player_id = $1";
    const params: unknown[] = [playerId];
    if (sinceId !== undefined) {
      params.push(sinceId);
      query += ` AND id > $${params.length}`;
    }
    const result = await this.pool.query(query, params);
    return Number.parseInt(result.rows[0].count, 10);
  }

  async getRecentMemories(
    playerId: string,
    limit: number,
    sinceId?: number,
  ): Promise<Memory[]> {
    let query = "SELECT * FROM memories WHERE player_id = $1";
    const params: unknown[] = [playerId];
    if (sinceId !== undefined) {
      params.push(sinceId);
      query += ` AND id > $${params.length}`;
    }
    params.push(limit);
    query += ` ORDER BY tick DESC LIMIT $${params.length}`;
    const result = await this.pool.query(query, params);
    return result.rows.map((r: MemoryRow) => this.rowToMemory(r));
  }

  async deleteOldMemories(
    maxAgeTicks: number,
    currentTick: number,
  ): Promise<number> {
    const cutoff = currentTick - maxAgeTicks;
    const result = await this.pool.query(
      "DELETE FROM memories WHERE tick < $1",
      [cutoff],
    );
    return result.rowCount ?? 0;
  }

  // --- Game Log ---

  async logEvent(
    tick: number,
    eventType: string,
    playerId?: string,
    data?: Record<string, unknown>,
  ): Promise<void> {
    await this.pool.query(
      "INSERT INTO game_log (tick, event_type, player_id, data) VALUES ($1, $2, $3, $4)",
      [tick, eventType, playerId ?? null, data ? JSON.stringify(data) : null],
    );
  }

  async getLog(options?: {
    since?: number;
    limit?: number;
    playerId?: string;
  }): Promise<
    {
      tick: number;
      eventType: string;
      playerId?: string;
      data?: Record<string, unknown>;
    }[]
  > {
    let query = "SELECT * FROM game_log WHERE 1=1";
    const params: unknown[] = [];

    if (options?.since !== undefined) {
      params.push(options.since);
      query += ` AND tick >= $${params.length}`;
    }
    if (options?.playerId) {
      params.push(options.playerId);
      query += ` AND player_id = $${params.length}`;
    }

    query += " ORDER BY tick DESC";

    if (options?.limit) {
      params.push(options.limit);
      query += ` LIMIT $${params.length}`;
    }

    const result = await this.pool.query(query, params);
    return result.rows.map(
      (r: {
        tick: number;
        event_type: string;
        player_id: string | null;
        data: Record<string, unknown> | null;
      }) => ({
        tick: r.tick,
        eventType: r.event_type,
        playerId: r.player_id ?? undefined,
        data: r.data ?? undefined,
      }),
    );
  }

  // --- Helpers ---

  private rowToMemory(row: MemoryRow): Memory {
    return {
      id: row.id,
      playerId: row.player_id,
      type: row.type as Memory["type"],
      content: row.content,
      importance: row.importance,
      relatedIds: row.related_ids ?? [],
      tick: row.tick,
      lastAccessedTick: row.last_accessed_tick ?? undefined,
    };
  }
}
