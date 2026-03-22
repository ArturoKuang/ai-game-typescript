import type { GameEvent, Player, Position } from "./types.js";

export type ConvoState = "invited" | "walking" | "active" | "ended";

export interface Message {
  id: number;
  convoId: number;
  playerId: string;
  content: string;
  tick: number;
}

export interface Conversation {
  id: number;
  player1Id: string;
  player2Id: string;
  state: ConvoState;
  messages: Message[];
  startedTick: number;
  endedTick?: number;
  summary?: string;
}

const CONVERSATION_DISTANCE = 2; // tiles
const CONVERSATION_TIMEOUT = 60; // ticks with no messages before auto-end
const MAX_MESSAGES = 20;
const MAX_DURATION = 300; // ticks

export class ConversationManager {
  private conversations: Map<number, Conversation> = new Map();
  private nextId = 1;
  private nextMsgId = 1;

  startConversation(
    player1Id: string,
    player2Id: string,
    tick: number,
  ): Conversation {
    // Check neither player is already in a conversation
    for (const c of this.conversations.values()) {
      if (c.state === "ended") continue;
      if (
        c.player1Id === player1Id ||
        c.player2Id === player1Id ||
        c.player1Id === player2Id ||
        c.player2Id === player2Id
      ) {
        throw new Error("One or both players are already in a conversation");
      }
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
    return convo;
  }

  acceptInvite(convoId: number): Conversation {
    const convo = this.getConversation(convoId);
    if (!convo) throw new Error(`Conversation ${convoId} not found`);
    if (convo.state !== "invited")
      throw new Error("Conversation is not in invited state");
    convo.state = "walking";
    return convo;
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

  endConversation(convoId: number, tick: number): Conversation {
    const convo = this.getConversation(convoId);
    if (!convo) throw new Error(`Conversation ${convoId} not found`);
    if (convo.state === "ended") return convo;
    convo.state = "ended";
    convo.endedTick = tick;
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
    setTarget: (playerId: string, x: number, y: number) => void,
  ): GameEvent[] {
    const events: GameEvent[] = [];

    for (const convo of this.conversations.values()) {
      if (convo.state === "invited") {
        // Auto-accept for NPCs
        const p2 = getPlayer(convo.player2Id);
        if (p2?.isNpc) {
          convo.state = "walking";
          events.push({
            tick,
            type: "convo_accepted",
            data: { convoId: convo.id },
          });
        }
      }

      if (convo.state === "walking") {
        const p1 = getPlayer(convo.player1Id);
        const p2 = getPlayer(convo.player2Id);
        if (!p1 || !p2) {
          this.endConversation(convo.id, tick);
          continue;
        }

        const dist = distance(p1, p2);
        if (dist <= CONVERSATION_DISTANCE) {
          // Close enough — activate
          convo.state = "active";
          events.push({
            tick,
            type: "convo_active",
            data: { convoId: convo.id },
          });
        } else {
          // Move toward each other (meet at midpoint)
          const midX = Math.round((p1.x + p2.x) / 2);
          const midY = Math.round((p1.y + p2.y) / 2);
          if (p1.state !== "walking") setTarget(p1.id, midX, midY);
          if (p2.state !== "walking") setTarget(p2.id, midX, midY);
        }
      }

      if (convo.state === "active") {
        // Check max duration
        if (tick - convo.startedTick >= MAX_DURATION) {
          this.endConversation(convo.id, tick);
          events.push({
            tick,
            type: "convo_ended",
            data: { convoId: convo.id, reason: "max_duration" },
          });
          continue;
        }

        // Check max messages
        if (convo.messages.length >= MAX_MESSAGES) {
          this.endConversation(convo.id, tick);
          events.push({
            tick,
            type: "convo_ended",
            data: { convoId: convo.id, reason: "max_messages" },
          });
          continue;
        }

        // Check timeout (no messages for N ticks)
        const lastMsgTick =
          convo.messages.length > 0
            ? convo.messages[convo.messages.length - 1].tick
            : convo.startedTick;
        if (tick - lastMsgTick >= CONVERSATION_TIMEOUT) {
          this.endConversation(convo.id, tick);
          events.push({
            tick,
            type: "convo_ended",
            data: { convoId: convo.id, reason: "timeout" },
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

  /** Get conversation a player is currently in (not ended) */
  getPlayerConversation(playerId: string): Conversation | undefined {
    for (const c of this.conversations.values()) {
      if (c.state === "ended") continue;
      if (c.player1Id === playerId || c.player2Id === playerId) return c;
    }
    return undefined;
  }

  clear(): void {
    this.conversations.clear();
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
