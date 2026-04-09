/**
 * NPC persistence layer — stores players, conversations, messages,
 * and LLM generation metadata.
 *
 * Two implementations:
 * - {@link PostgresNpcStore} — writes to Postgres with `ON CONFLICT` upserts.
 * - {@link InMemoryNpcStore} — Map/array-based for tests and fallback mode.
 */
import type { Pool } from "pg";
import type { NpcAutonomyDebugState } from "../autonomy/types.js";
import type { Conversation, Message } from "../engine/conversation.js";
import type { Player } from "../engine/types.js";

/** Metadata recorded for each LLM generation (reply or reflection). */
export interface GenerationRecord {
  conversationId?: number;
  playerId: string;
  kind: "reply" | "reflection";
  provider: string;
  sessionId?: string;
  prompt: string;
  response?: string;
  latencyMs?: number;
  error?: string;
  tick: number;
}

/** Abstract persistence interface for NPC-related data. */
export interface NpcPersistenceStore {
  upsertPlayer(player: Player): Promise<void>;
  upsertConversation(conversation: Conversation): Promise<void>;
  addMessage(message: Message): Promise<void>;
  addGeneration(record: GenerationRecord): Promise<void>;
  recordDeadNpc(state: NpcAutonomyDebugState): Promise<void>;
  getDeadNpcs(): Promise<NpcAutonomyDebugState[]>;
}

export interface StoredGeneration extends GenerationRecord {
  id: number;
}

export class InMemoryNpcStore implements NpcPersistenceStore {
  readonly players = new Map<string, Player>();
  readonly conversations = new Map<number, Conversation>();
  readonly messages: Message[] = [];
  readonly generations: StoredGeneration[] = [];
  readonly deadNpcs = new Map<string, NpcAutonomyDebugState>();
  private nextGenerationId = 1;

  async upsertPlayer(player: Player): Promise<void> {
    this.players.set(player.id, { ...player });
    this.deadNpcs.delete(player.id);
  }

  async upsertConversation(conversation: Conversation): Promise<void> {
    this.conversations.set(conversation.id, structuredClone(conversation));
  }

  async addMessage(message: Message): Promise<void> {
    this.messages.push({ ...message });
  }

  async addGeneration(record: GenerationRecord): Promise<void> {
    this.generations.push({
      id: this.nextGenerationId++,
      ...record,
    });
  }

  async recordDeadNpc(state: NpcAutonomyDebugState): Promise<void> {
    this.deadNpcs.set(state.npcId, structuredClone(state));
  }

  async getDeadNpcs(): Promise<NpcAutonomyDebugState[]> {
    return Array.from(this.deadNpcs.values()).map((state) =>
      structuredClone(state),
    );
  }
}

export class PostgresNpcStore implements NpcPersistenceStore {
  constructor(private pool: Pool) {}

  async upsertPlayer(player: Player): Promise<void> {
    await this.pool.query(
      `INSERT INTO players
         (id, name, description, personality, is_npc, x, y, target_x, target_y, orientation, speed, state, current_activity_id, current_convo_id)
       VALUES
         ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)
       ON CONFLICT (id) DO UPDATE SET
         name = EXCLUDED.name,
         description = EXCLUDED.description,
         personality = EXCLUDED.personality,
         is_npc = EXCLUDED.is_npc,
         x = EXCLUDED.x,
         y = EXCLUDED.y,
         target_x = EXCLUDED.target_x,
         target_y = EXCLUDED.target_y,
         orientation = EXCLUDED.orientation,
         speed = EXCLUDED.speed,
         state = EXCLUDED.state,
         current_activity_id = EXCLUDED.current_activity_id,
         current_convo_id = EXCLUDED.current_convo_id`,
      [
        player.id,
        player.name,
        player.description,
        player.personality ?? null,
        player.isNpc,
        player.x,
        player.y,
        player.targetX ?? null,
        player.targetY ?? null,
        player.orientation,
        player.pathSpeed,
        player.state,
        player.currentActivityId ?? null,
        null,
      ],
    );
    await this.pool.query("DELETE FROM dead_npcs WHERE npc_id = $1", [player.id]);
  }

  async upsertConversation(conversation: Conversation): Promise<void> {
    await this.pool.query(
      `INSERT INTO conversations (id, player1_id, player2_id, state, ended_at, summary)
       VALUES ($1, $2, $3, $4, $5, $6)
       ON CONFLICT (id) DO UPDATE SET
         state = EXCLUDED.state,
         ended_at = EXCLUDED.ended_at,
         summary = EXCLUDED.summary`,
      [
        conversation.id,
        conversation.player1Id,
        conversation.player2Id,
        conversation.state,
        conversation.endedTick !== undefined ? new Date() : null,
        conversation.summary ?? null,
      ],
    );
  }

  async addMessage(message: Message): Promise<void> {
    await this.pool.query(
      `INSERT INTO messages (id, convo_id, player_id, content, tick)
       VALUES ($1, $2, $3, $4, $5)
       ON CONFLICT (id) DO NOTHING`,
      [
        message.id,
        message.convoId,
        message.playerId,
        message.content,
        message.tick,
      ],
    );
  }

  async addGeneration(record: GenerationRecord): Promise<void> {
    await this.pool.query(
      `INSERT INTO llm_generations
         (convo_id, player_id, kind, provider, session_id, prompt, response, latency_ms, error, tick)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
      [
        record.conversationId ?? null,
        record.playerId,
        record.kind,
        record.provider,
        record.sessionId ?? null,
        record.prompt,
        record.response ?? null,
        record.latencyMs ?? null,
        record.error ?? null,
        record.tick,
      ],
    );
  }

  async recordDeadNpc(state: NpcAutonomyDebugState): Promise<void> {
    await this.pool.query(
      `INSERT INTO dead_npcs (npc_id, died_at_tick, snapshot)
       VALUES ($1, $2, $3::jsonb)
       ON CONFLICT (npc_id) DO UPDATE SET
         died_at_tick = EXCLUDED.died_at_tick,
         snapshot = EXCLUDED.snapshot,
         updated_at = NOW()`,
      [state.npcId, state.death?.tick ?? 0, JSON.stringify(state)],
    );
  }

  async getDeadNpcs(): Promise<NpcAutonomyDebugState[]> {
    const result = await this.pool.query(
      `SELECT snapshot
       FROM dead_npcs
       ORDER BY died_at_tick DESC, npc_id ASC`,
    );
    return result.rows.map((row: { snapshot: NpcAutonomyDebugState }) =>
      row.snapshot,
    );
  }
}
