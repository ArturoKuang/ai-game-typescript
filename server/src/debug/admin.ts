import type { Pool } from "pg";
import type { Conversation, Message } from "../engine/conversation.js";
import type { GameLoop } from "../engine/gameLoop.js";
import type { Orientation, Player, Position } from "../engine/types.js";
import type { ScenarioDef } from "./scenarios.js";

export class DebugRouteError extends Error {
  readonly status: number;

  constructor(status: number, message: string) {
    super(message);
    this.name = "DebugRouteError";
    this.status = status;
  }
}

export function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : "Unexpected error";
}

/**
 * Centralized write surface for the debug API.
 *
 * Audit note: the router should not reach into `GameLoop` or
 * `ConversationManager` directly anymore. This facade makes it obvious which
 * debug writes reuse the production command queue and which ones remain
 * explicit admin-only operations.
 */
export class DebugGameAdmin {
  constructor(
    private readonly game: GameLoop,
    private readonly pool?: Pool,
  ) {}

  async spawnPlayer(params: {
    id: string;
    name: string;
    x: number;
    y: number;
    isNpc?: boolean;
    description?: string;
    personality?: string;
    speed?: number;
  }): Promise<Player> {
    if (this.game.getPlayer(params.id)) {
      throw new DebugRouteError(400, `Player ${params.id} already exists`);
    }

    this.game.enqueue({
      type: "spawn",
      playerId: params.id,
      data: {
        name: params.name,
        x: params.x,
        y: params.y,
        isNpc: params.isNpc,
        description: params.description,
        personality: params.personality,
        speed: params.speed,
      },
    });
    this.game.processPendingCommands();

    const player = this.game.getPlayer(params.id);
    if (!player) {
      throw new DebugRouteError(400, "Failed to spawn player");
    }

    await persistPlayer(this.pool, player);
    return player;
  }

  movePlayer(playerId: string, x: number, y: number): Position[] {
    this.requirePlayer(playerId);

    this.game.enqueue({
      type: "move_to",
      playerId,
      data: { x, y },
    });
    this.game.processPendingCommands();

    const player = this.requirePlayer(playerId);
    if (!player.path || player.targetX !== x || player.targetY !== y) {
      throw new DebugRouteError(
        400,
        "Cannot move to target (unreachable or player in conversation)",
      );
    }

    return player.path.map((step) => ({ ...step }));
  }

  setPlayerInput(
    playerId: string,
    direction: Orientation,
    active: boolean,
  ): Player {
    this.requirePlayer(playerId);
    this.game.setPlayerInput(playerId, direction, active);
    return this.requirePlayer(playerId);
  }

  async loadScenario(name: string, scenario: ScenarioDef): Promise<{
    ok: true;
    scenario: string;
    playerCount: number;
    tick: number;
  }> {
    // Scenario loading is intentionally admin-only: it resets and respawns a
    // whole fixture rather than replaying one player command at a time.
    for (const player of this.game.getPlayers()) {
      this.game.removePlayer(player.id);
    }

    scenario.setup(this.game);

    for (const player of this.game.getPlayers()) {
      await persistPlayer(this.pool, player);
    }

    return {
      ok: true,
      scenario: name,
      playerCount: this.game.playerCount,
      tick: this.game.currentTick,
    };
  }

  startConversation(player1Id: string, player2Id: string): Conversation {
    this.requirePlayer(player1Id);
    this.requirePlayer(player2Id);
    if (player1Id === player2Id) {
      throw new DebugRouteError(400, "Cannot start a conversation with yourself");
    }
    if (this.game.conversations.getPlayerConversation(player1Id)) {
      throw new DebugRouteError(400, "That player is already in a conversation");
    }
    if (this.game.conversations.getPlayerConversation(player2Id)) {
      throw new DebugRouteError(400, "That player is already in a conversation");
    }

    this.game.enqueue({
      type: "start_convo",
      playerId: player1Id,
      data: { targetId: player2Id },
    });
    this.game.processPendingCommands();

    const conversation = this.game.conversations.getPlayerConversation(player1Id);
    if (!conversation || conversation.player2Id !== player2Id) {
      throw new DebugRouteError(400, "Failed to start conversation");
    }

    return conversation;
  }

  endConversation(convoId: number): Conversation {
    const conversation = this.requireConversation(convoId);

    this.game.enqueue({
      type: "end_convo",
      playerId: conversation.player1Id,
      data: { convoId },
    });
    this.game.processPendingCommands();

    const endedConversation = this.requireConversation(convoId);
    if (endedConversation.state !== "ended") {
      throw new DebugRouteError(400, "Failed to end conversation");
    }

    return endedConversation;
  }

  addConversationMessage(
    playerId: string,
    convoId: number,
    content: string,
  ): Message {
    this.requirePlayer(playerId);
    const conversation = this.requireConversation(convoId);
    if (!this.game.conversations.isParticipant(conversation, playerId)) {
      throw new DebugRouteError(400, "Player is not part of this conversation");
    }
    if (conversation.state !== "active") {
      throw new DebugRouteError(400, "Conversation is not active");
    }

    const previousCount = conversation.messages.length;
    this.game.enqueue({
      type: "say",
      playerId,
      data: { convoId, content },
    });
    this.game.processPendingCommands();

    const updatedConversation = this.requireConversation(convoId);
    if (updatedConversation.messages.length !== previousCount + 1) {
      throw new DebugRouteError(400, "Failed to add message");
    }

    return updatedConversation.messages[updatedConversation.messages.length - 1];
  }

  private requirePlayer(playerId: string): Player {
    const player = this.game.getPlayer(playerId);
    if (!player) {
      throw new DebugRouteError(404, "Player not found");
    }
    return player;
  }

  private requireConversation(convoId: number): Conversation {
    const conversation = this.game.conversations.getConversation(convoId);
    if (!conversation) {
      throw new DebugRouteError(404, "Conversation not found");
    }
    return conversation;
  }
}

async function persistPlayer(
  pool: Pool | undefined,
  player: Player,
): Promise<void> {
  if (!pool) return;
  await pool.query(
    `INSERT INTO players (id, name, description, personality, is_npc, x, y, state)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
     ON CONFLICT (id) DO UPDATE SET x = $6, y = $7, state = $8`,
    [
      player.id,
      player.name,
      player.description,
      player.personality ?? null,
      player.isNpc,
      player.x,
      player.y,
      player.state,
    ],
  );
}
