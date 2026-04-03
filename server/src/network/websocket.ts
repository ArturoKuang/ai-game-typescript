/**
 * WebSocket server bridging the game engine to browser clients.
 *
 * Responsibilities:
 * - Accept client connections and send an initial full-state snapshot.
 * - Translate incoming {@link ClientMessage}s into engine commands/inputs.
 * - Translate outgoing {@link GameEvent}s into {@link ServerMessage}s and
 *   broadcast or unicast them to the appropriate clients.
 * - Scrub internal fields (inputX/inputY) before sending player data.
 * - Clean up player state when a WebSocket disconnects.
 *
 * The server is wired to the engine via `game.on("*", broadcastGameEvent)`.
 */
import type { Server } from "node:http";
import { WebSocket, WebSocketServer } from "ws";
import type { Conversation, Message } from "../engine/conversation.js";
import type { GameLoop } from "../engine/gameLoop.js";
import type { GameEvent, Player } from "../engine/types.js";
import type {
  ClientMessage,
  FullGameState,
  ServerMessage,
} from "./protocol.js";

/** Per-connection metadata tracking which player (if any) this socket controls. */
interface ClientInfo {
  playerId: string | null;
  ws: WebSocket;
}

/** Monotonic counter for assigning human player IDs (human_1, human_2, …). */
let humanCounter = 0;

export class GameWebSocketServer {
  private wss: WebSocketServer;
  private clients: Map<WebSocket, ClientInfo> = new Map();
  private game: GameLoop;

  constructor(server: Server, game: GameLoop) {
    this.game = game;
    this.wss = new WebSocketServer({ server });

    this.wss.on("connection", (ws) => this.onConnection(ws));
  }

  /** Broadcast a message to all connected clients */
  broadcast(message: ServerMessage): void {
    const data = JSON.stringify(message);
    for (const client of this.clients.keys()) {
      if (client.readyState === WebSocket.OPEN) {
        client.send(data);
      }
    }
  }

  /** Send a message to a specific player's client */
  sendToPlayer(playerId: string, message: ServerMessage): void {
    for (const [ws, info] of this.clients) {
      if (info.playerId === playerId && ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify(message));
      }
    }
  }

  sendToPlayers(playerIds: readonly string[], message: ServerMessage): void {
    const targets = new Set(playerIds);
    for (const [ws, info] of this.clients) {
      if (
        info.playerId &&
        targets.has(info.playerId) &&
        ws.readyState === WebSocket.OPEN
      ) {
        ws.send(JSON.stringify(message));
      }
    }
  }

  /**
   * Translate a game engine event into one or more WebSocket messages.
   *
   * Movement events are broadcast to all clients as `player_update`.
   * Conversation events are sent only to the two participants.
   * `tick_complete` becomes a lightweight `tick` broadcast.
   */
  broadcastGameEvent(event: GameEvent): void {
    switch (event.type) {
      case "spawn": {
        const player = event.playerId
          ? this.game.getPlayer(event.playerId)
          : undefined;
        if (player) {
          this.broadcast({
            type: "player_joined",
            data: this.toPublicPlayer(player),
          });
        }
        return;
      }
      case "despawn": {
        if (event.playerId) {
          this.broadcast({ type: "player_left", data: { id: event.playerId } });
        }
        return;
      }
      case "move_direction":
      case "move_start":
      case "input_move":
      case "player_update":
      case "move_end": {
        const player =
          (event.data?.player as Player | undefined) ??
          (event.playerId ? this.game.getPlayer(event.playerId) : undefined);
        if (player) {
          this.broadcast({
            type: "player_update",
            data: this.toPublicPlayer(player),
          });
        }
        return;
      }
      case "convo_started":
      case "convo_accepted":
      case "convo_active":
      case "convo_ended": {
        const conversation = this.resolveConversation(event);
        if (!conversation) return;
        this.sendToPlayers(this.resolveParticipantIds(event, conversation), {
          type: "convo_update",
          data: conversation,
        });
        return;
      }
      case "convo_declined": {
        return;
      }
      case "convo_message": {
        const message = event.data?.message as Message | undefined;
        if (!message) return;
        const conversation =
          this.resolveConversation(event) ??
          this.game.conversations.getConversation(message.convoId);
        if (!conversation) return;
        this.sendToPlayers(this.resolveParticipantIds(event, conversation), {
          type: "message",
          data: message,
        });
        return;
      }
      case "tick_complete": {
        const tick = event.data?.tick;
        if (typeof tick === "number") {
          this.broadcast({ type: "tick", data: { tick } });
        }
        return;
      }
    }
  }

  private onConnection(ws: WebSocket): void {
    const info: ClientInfo = { playerId: null, ws };
    this.clients.set(ws, info);

    this.send(ws, { type: "state", data: this.buildFullState(info.playerId) });

    ws.on("message", (raw) => {
      try {
        const msg = JSON.parse(raw.toString()) as ClientMessage;
        this.onMessage(ws, info, msg);
      } catch {
        this.sendError(ws, "Invalid message format");
      }
    });

    ws.on("close", () => {
      if (info.playerId) {
        const convo = this.game.conversations.getPlayerConversation(
          info.playerId,
        );
        if (convo) {
          this.game.enqueue({
            type: "end_convo",
            playerId: info.playerId,
            data: { convoId: convo.id },
          });
        }
        this.game.enqueue({
          type: "remove",
          playerId: info.playerId,
        });
      }
      this.clients.delete(ws);
    });
  }

  private onMessage(ws: WebSocket, info: ClientInfo, msg: ClientMessage): void {
    switch (msg.type) {
      case "join": {
        if (info.playerId) {
          this.sendError(ws, "Already joined");
          return;
        }
        humanCounter++;
        const id = `human_${humanCounter}`;
        const spawns = this.game.world.getSpawnPoints();
        const spawn = spawns[humanCounter % spawns.length] ?? { x: 1, y: 1 };
        info.playerId = id;

        this.game.enqueue({
          type: "spawn",
          playerId: id,
          data: {
            name: msg.data.name,
            x: spawn.x,
            y: spawn.y,
            isNpc: false,
            description: msg.data.description ?? "",
          },
        });

        const previewPlayer: Player = {
          id,
          name: msg.data.name,
          description: msg.data.description ?? "",
          isNpc: false,
          isWaitingForResponse: false,
          x: spawn.x,
          y: spawn.y,
          orientation: "down",
          pathSpeed: 1.0,
          state: "idle",
          vx: 0,
          vy: 0,
          inputX: 0,
          inputY: 0,
          radius: 0.4,
          inputSpeed: 5.0,
        };
        this.send(ws, {
          type: "player_joined",
          data: this.toPublicPlayer(previewPlayer),
        });
        return;
      }

      case "move": {
        if (!info.playerId) return;
        this.game.enqueue({
          type: "move_to",
          playerId: info.playerId,
          data: { x: msg.data.x, y: msg.data.y },
        });
        return;
      }

      case "move_direction": {
        if (!info.playerId) return;
        this.game.enqueue({
          type: "move_direction",
          playerId: info.playerId,
          data: { direction: msg.data.direction },
        });
        return;
      }

      case "input_start": {
        if (!info.playerId) return;
        this.game.setPlayerInput(info.playerId, msg.data.direction, true);
        return;
      }

      case "input_stop": {
        if (!info.playerId) return;
        this.game.setPlayerInput(info.playerId, msg.data.direction, false);
        return;
      }

      case "say": {
        if (!info.playerId) return;
        const convo = this.game.conversations.getPlayerConversation(
          info.playerId,
        );
        if (!convo || convo.state !== "active") {
          this.sendError(ws, "Not in an active conversation");
          return;
        }
        this.game.enqueue({
          type: "say",
          playerId: info.playerId,
          data: { convoId: convo.id, content: msg.data.content },
        });
        return;
      }

      case "start_convo": {
        if (!info.playerId) return;
        if (msg.data.targetId === info.playerId) {
          this.sendError(ws, "Cannot start a conversation with yourself");
          return;
        }
        const target = this.game.getPlayer(msg.data.targetId);
        if (!target) {
          this.sendError(ws, "Conversation target not found");
          return;
        }
        if (this.game.conversations.getPlayerConversation(info.playerId)) {
          this.sendError(ws, "You are already in a conversation");
          return;
        }
        if (this.game.conversations.getPlayerConversation(msg.data.targetId)) {
          this.sendError(ws, "That player is already in a conversation");
          return;
        }
        this.game.enqueue({
          type: "start_convo",
          playerId: info.playerId,
          data: { targetId: msg.data.targetId },
        });
        return;
      }

      case "accept_convo": {
        if (!info.playerId) return;
        const convo = this.game.conversations.getConversation(msg.data.convoId);
        if (!convo || convo.state !== "invited") {
          this.sendError(ws, "Conversation invite is no longer available");
          return;
        }
        if (convo.player2Id !== info.playerId) {
          this.sendError(
            ws,
            "Only the invited player can accept this conversation",
          );
          return;
        }
        this.game.enqueue({
          type: "accept_convo",
          playerId: info.playerId,
          data: { convoId: msg.data.convoId },
        });
        return;
      }

      case "decline_convo": {
        if (!info.playerId) return;
        const convo = this.game.conversations.getConversation(msg.data.convoId);
        if (!convo || convo.state !== "invited") {
          this.sendError(ws, "Conversation invite is no longer available");
          return;
        }
        if (convo.player2Id !== info.playerId) {
          this.sendError(
            ws,
            "Only the invited player can decline this conversation",
          );
          return;
        }
        this.game.enqueue({
          type: "decline_convo",
          playerId: info.playerId,
          data: { convoId: msg.data.convoId },
        });
        return;
      }

      case "end_convo": {
        if (!info.playerId) return;
        const convo = this.game.conversations.getPlayerConversation(
          info.playerId,
        );
        if (!convo) {
          this.sendError(ws, "Not currently in a conversation");
          return;
        }
        this.game.enqueue({
          type: "end_convo",
          playerId: info.playerId,
          data: { convoId: convo.id },
        });
        return;
      }

      case "ping": {
        return;
      }
    }
  }

  private buildFullState(playerId: string | null): FullGameState {
    const conversations = playerId
      ? this.game.conversations
          .getActiveConversations()
          .filter(
            (conversation) =>
              conversation.player1Id === playerId ||
              conversation.player2Id === playerId,
          )
      : [];

    return {
      tick: this.game.currentTick,
      world: { width: this.game.world.width, height: this.game.world.height },
      players: this.game
        .getPlayers()
        .map((player) => this.toPublicPlayer(player)),
      conversations,
      activities: this.game.world.getActivities(),
    };
  }

  private resolveConversation(event: GameEvent): Conversation | undefined {
    const fromEvent = event.data?.conversation as Conversation | undefined;
    if (fromEvent) return fromEvent;

    const convoId = event.data?.convoId;
    return typeof convoId === "number"
      ? this.game.conversations.getConversation(convoId)
      : undefined;
  }

  private resolveParticipantIds(
    event: GameEvent,
    conversation: Conversation,
  ): string[] {
    const fromEvent = event.data?.participantIds;
    if (
      Array.isArray(fromEvent) &&
      fromEvent.length === 2 &&
      fromEvent.every((value) => typeof value === "string")
    ) {
      return fromEvent;
    }

    return [conversation.player1Id, conversation.player2Id];
  }

  /** Strip internal input state before sending player data to clients. */
  private toPublicPlayer(player: Player): Player {
    const { inputX: _ix, inputY: _iy, ...rest } = player;
    return rest as Player;
  }

  private send(ws: WebSocket, message: ServerMessage): void {
    if (ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify(message));
    }
  }

  private sendError(ws: WebSocket, message: string): void {
    this.send(ws, {
      type: "error",
      data: { message },
    });
  }

  get clientCount(): number {
    return this.clients.size;
  }
}
