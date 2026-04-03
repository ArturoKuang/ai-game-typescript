/**
 * Conversation lifecycle manager.
 *
 * Conversations follow a state machine:
 *
 *   invited ──▶ walking ──▶ active ──▶ ended
 *       │                              ▲
 *       └──────── declined ────────────┘
 *
 * - **invited**: initiator has requested; target has not yet responded.
 *   NPCs auto-accept (they have no client UI for manual acceptance).
 * - **walking**: both players are navigating toward a rendezvous point
 *   near the midpoint. Once within `CONVERSATION_DISTANCE` tiles, the
 *   conversation activates.
 * - **active**: messages can be exchanged. Ends when either player
 *   leaves, a timeout fires, or message/duration limits are hit.
 * - **ended**: terminal state; players are freed to start new conversations.
 *
 * The manager tracks a `playerToConvo` index for O(1) lookups of a
 * player's current conversation.
 */
import type { GameEvent, Player, Position } from "./types.js";

/**
 * Conversation state machine states.
 * @see module docs for the transition diagram.
 */
export type ConvoState = "invited" | "walking" | "active" | "ended";
export type ConversationEndReason =
  | "declined"
  | "manual"
  | "max_duration"
  | "max_messages"
  | "timeout"
  | "missing_player";

/** A single chat message within a conversation. Stored in Conversation.messages in send order. */
export interface Message {
  id: number;
  /** The conversation this message belongs to. */
  convoId: number;
  /** The player who sent this message. */
  playerId: string;
  content: string;
  /** Game tick when the message was sent; used for conversation timeout calculation. */
  tick: number;
}

export interface Conversation {
  id: number;
  /** The player who initiated the conversation. */
  player1Id: string;
  /** The player who was invited (and must accept/decline). */
  player2Id: string;
  state: ConvoState;
  /** Ordered list of messages exchanged during the conversation. */
  messages: Message[];
  /** Tick when the conversation was created (invited state). */
  startedTick: number;
  /** Tick when the conversation entered the ended state (undefined while active). */
  endedTick?: number;
  endedReason?: ConversationEndReason;
  /** LLM-generated summary stored after the conversation ends, used for NPC memory. */
  summary?: string;
}

/** Manhattan distance (tiles) at which two walking players transition to "active". */
const CONVERSATION_DISTANCE = 2;
/** Ticks of silence before auto-ending an active conversation (30s at 20 ticks/sec). */
const CONVERSATION_TIMEOUT = 600;
/** Hard cap on messages per conversation; triggers auto-end when reached. */
const MAX_MESSAGES = 20;
/** Hard cap on conversation duration in ticks (60s at 20 ticks/sec); triggers auto-end. */
const MAX_DURATION = 1200;

export class ConversationManager {
  /** All conversations (active and ended) keyed by conversation ID. */
  private conversations: Map<number, Conversation> = new Map();
  /** Reverse index: player ID → their current (non-ended) conversation ID.
   *  Enables O(1) "is this player busy?" checks. Entries are removed when a conversation ends. */
  private playerToConvo: Map<string, number> = new Map();
  /** Auto-incrementing conversation ID counter. */
  private nextId = 1;
  /** Auto-incrementing message ID counter (unique across all conversations). */
  private nextMsgId = 1;

  startConversation(
    player1Id: string,
    player2Id: string,
    tick: number,
  ): Conversation {
    if (player1Id === player2Id) {
      throw new Error("Cannot start a conversation with yourself");
    }

    // Check neither player is already in a conversation (O(1))
    if (
      this.playerToConvo.has(player1Id) ||
      this.playerToConvo.has(player2Id)
    ) {
      throw new Error("One or both players are already in a conversation");
    }

    const convo: Conversation = {
      id: this.nextId++,
      player1Id,
      player2Id,
      state: "invited",
      messages: [],
      startedTick: tick,
    };
    this.conversations.set(convo.id, convo);
    this.playerToConvo.set(player1Id, convo.id);
    this.playerToConvo.set(player2Id, convo.id);
    return convo;
  }

  acceptInvite(convoId: number, playerId?: string): Conversation {
    const convo = this.getConversation(convoId);
    if (!convo) throw new Error(`Conversation ${convoId} not found`);
    if (convo.state !== "invited")
      throw new Error("Conversation is not in invited state");
    if (playerId && playerId !== convo.player2Id) {
      throw new Error("Only the invitee can accept this conversation");
    }
    convo.state = "walking";
    return convo;
  }

  declineInvite(convoId: number, playerId: string, tick: number): Conversation {
    const convo = this.getConversation(convoId);
    if (!convo) throw new Error(`Conversation ${convoId} not found`);
    if (convo.state !== "invited") {
      throw new Error("Conversation is not in invited state");
    }
    if (playerId !== convo.player2Id) {
      throw new Error("Only the invitee can decline this conversation");
    }

    return this.endConversation(convoId, tick, "declined");
  }

  addMessage(
    convoId: number,
    playerId: string,
    content: string,
    tick: number,
  ): Message {
    const convo = this.getConversation(convoId);
    if (!convo) throw new Error(`Conversation ${convoId} not found`);
    if (convo.state !== "active") throw new Error("Conversation is not active");
    if (playerId !== convo.player1Id && playerId !== convo.player2Id) {
      throw new Error("Player is not part of this conversation");
    }

    const msg: Message = {
      id: this.nextMsgId++,
      convoId,
      playerId,
      content,
      tick,
    };
    convo.messages.push(msg);
    return msg;
  }

  endConversation(
    convoId: number,
    tick: number,
    reason: ConversationEndReason = "manual",
  ): Conversation {
    const convo = this.getConversation(convoId);
    if (!convo) throw new Error(`Conversation ${convoId} not found`);
    if (convo.state === "ended") return convo;
    convo.state = "ended";
    convo.endedTick = tick;
    convo.endedReason = reason;
    this.playerToConvo.delete(convo.player1Id);
    this.playerToConvo.delete(convo.player2Id);
    return convo;
  }

  /**
   * Process conversations each tick:
   * - walking: check if players close enough to activate
   * - active: check timeout and max messages/duration
   */
  processTick(
    tick: number,
    getPlayer: (id: string) => Player | undefined,
    setTarget: (playerId: string, x: number, y: number) => boolean,
  ): GameEvent[] {
    const events: GameEvent[] = [];

    for (const convo of this.conversations.values()) {
      if (convo.state === "invited") {
        // Auto-accept when either participant is an NPC. NPCs have no
        // client UX to manually accept an invitation, so we skip the
        // "invited" state and go straight to "walking" toward each other.
        const p1 = getPlayer(convo.player1Id);
        const p2 = getPlayer(convo.player2Id);
        if (p1?.isNpc || p2?.isNpc) {
          this.acceptInvite(convo.id);
          events.push({
            tick,
            type: "convo_accepted",
            data: {
              convoId: convo.id,
              conversation: snapshotConversation(convo),
              participantIds: this.getParticipantIds(convo),
            },
          });
        }
      }

      if (convo.state === "walking") {
        const p1 = getPlayer(convo.player1Id);
        const p2 = getPlayer(convo.player2Id);
        if (!p1 || !p2) {
          const ended = this.endConversation(convo.id, tick, "missing_player");
          events.push({
            tick,
            type: "convo_ended",
            data: {
              convoId: ended.id,
              reason: ended.endedReason,
              conversation: snapshotConversation(ended),
              participantIds: this.getParticipantIds(ended),
            },
          });
          continue;
        }

        const dist = distance(p1, p2);
        if (dist <= CONVERSATION_DISTANCE) {
          // Close enough — activate
          convo.state = "active";
          events.push({
            tick,
            type: "convo_active",
            data: {
              convoId: convo.id,
              conversation: snapshotConversation(convo),
              participantIds: this.getParticipantIds(convo),
            },
          });
        } else {
          // Both players walk toward a small set of rendezvous candidates near
          // the midpoint. This avoids getting stuck when the rounded midpoint
          // lands on a blocked tile.
          const candidates = buildRendezvousCandidates(p1, p2);
          ensureConversationTarget(p1, candidates, setTarget);
          ensureConversationTarget(p2, candidates, setTarget);
        }
      }

      if (convo.state === "active") {
        // Check max duration
        if (tick - convo.startedTick >= MAX_DURATION) {
          this.endConversation(convo.id, tick, "max_duration");
          events.push({
            tick,
            type: "convo_ended",
            data: {
              convoId: convo.id,
              reason: "max_duration",
              conversation: snapshotConversation(convo),
              participantIds: this.getParticipantIds(convo),
            },
          });
          continue;
        }

        // Check max messages
        if (convo.messages.length >= MAX_MESSAGES) {
          this.endConversation(convo.id, tick, "max_messages");
          events.push({
            tick,
            type: "convo_ended",
            data: {
              convoId: convo.id,
              reason: "max_messages",
              conversation: snapshotConversation(convo),
              participantIds: this.getParticipantIds(convo),
            },
          });
          continue;
        }

        // Check timeout (no messages for N ticks)
        const lastMsgTick =
          convo.messages.length > 0
            ? convo.messages[convo.messages.length - 1].tick
            : convo.startedTick;
        if (tick - lastMsgTick >= CONVERSATION_TIMEOUT) {
          this.endConversation(convo.id, tick, "timeout");
          events.push({
            tick,
            type: "convo_ended",
            data: {
              convoId: convo.id,
              reason: "timeout",
              conversation: snapshotConversation(convo),
              participantIds: this.getParticipantIds(convo),
            },
          });
        }
      }
    }

    return events;
  }

  getConversation(id: number): Conversation | undefined {
    return this.conversations.get(id);
  }

  getActiveConversations(): Conversation[] {
    return Array.from(this.conversations.values()).filter(
      (c) => c.state !== "ended",
    );
  }

  getAllConversations(): Conversation[] {
    return Array.from(this.conversations.values());
  }

  /** Get conversation a player is currently in (not ended). O(1). */
  getPlayerConversation(playerId: string): Conversation | undefined {
    const convoId = this.playerToConvo.get(playerId);
    return convoId !== undefined ? this.conversations.get(convoId) : undefined;
  }

  isParticipant(conversation: Conversation, playerId: string): boolean {
    return (
      playerId === conversation.player1Id || playerId === conversation.player2Id
    );
  }

  getParticipantIds(
    conversation: Pick<Conversation, "player1Id" | "player2Id">,
  ): [string, string] {
    return [conversation.player1Id, conversation.player2Id];
  }

  clear(): void {
    this.conversations.clear();
    this.playerToConvo.clear();
    this.nextId = 1;
    this.nextMsgId = 1;
  }
}

function distance(
  a: { x: number; y: number },
  b: { x: number; y: number },
): number {
  return Math.abs(a.x - b.x) + Math.abs(a.y - b.y);
}

/**
 * Generate candidate meeting points for two players.
 *
 * Starts with the rounded midpoint, then offsets by ±1 tile in each
 * cardinal direction, and finally each player's own rounded position.
 * This gives pathfinding several options if the midpoint lands on a
 * blocked tile.
 */
function buildRendezvousCandidates(
  left: Position,
  right: Position,
): Position[] {
  const midX = Math.round((left.x + right.x) / 2);
  const midY = Math.round((left.y + right.y) / 2);
  const rawCandidates: Position[] = [
    { x: midX, y: midY },
    { x: midX + 1, y: midY },
    { x: midX - 1, y: midY },
    { x: midX, y: midY + 1 },
    { x: midX, y: midY - 1 },
    { x: Math.round(left.x), y: Math.round(left.y) },
    { x: Math.round(right.x), y: Math.round(right.y) },
  ];

  const seen = new Set<string>();
  return rawCandidates.filter((candidate) => {
    const key = `${candidate.x},${candidate.y}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

/** Set a player's movement target to the first reachable rendezvous candidate. */
function ensureConversationTarget(
  player: Player,
  candidates: Position[],
  setTarget: (playerId: string, x: number, y: number) => boolean,
): void {
  const alreadyHeadingToCandidate =
    player.state === "walking" &&
    player.targetX !== undefined &&
    player.targetY !== undefined &&
    candidates.some(
      (candidate) =>
        candidate.x === player.targetX && candidate.y === player.targetY,
    );

  if (alreadyHeadingToCandidate) {
    return;
  }

  for (const candidate of candidates) {
    if (setTarget(player.id, candidate.x, candidate.y)) {
      return;
    }
  }
}

/** Deep-clone a conversation (including its messages) for safe event payloads. */
export function snapshotConversation(conversation: Conversation): Conversation {
  return {
    ...conversation,
    messages: conversation.messages.map((message) => ({ ...message })),
  };
}
