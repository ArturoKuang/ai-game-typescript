import type { Server } from "node:http";
import { WebSocket, WebSocketServer } from "ws";
import type { ConversationManager } from "../engine/conversation.js";
import type { GameLoop } from "../engine/gameLoop.js";
import type {
  ClientMessage,
  FullGameState,
  ServerMessage,
} from "./protocol.js";

interface ClientInfo {
  playerId: string | null;
  ws: WebSocket;
}

let humanCounter = 0;

export class GameWebSocketServer {
  private wss: WebSocketServer;
  private clients: Map<WebSocket, ClientInfo> = new Map();
  private game: GameLoop;
  private convoManager: ConversationManager;

  constructor(
    server: Server,
    game: GameLoop,
    convoManager: ConversationManager,
  ) {
    this.game = game;
    this.convoManager = convoManager;
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

  private onConnection(ws: WebSocket): void {
    const info: ClientInfo = { playerId: null, ws };
    this.clients.set(ws, info);

    // Send current full state
    const state = this.buildFullState();
    this.send(ws, { type: "state", data: state });

    ws.on("message", (raw) => {
      try {
        const msg = JSON.parse(raw.toString()) as ClientMessage;
        this.onMessage(ws, info, msg);
      } catch {
        this.send(ws, {
          type: "error",
          data: { message: "Invalid message format" },
        });
      }
    });

    ws.on("close", () => {
      // Remove player on disconnect
      if (info.playerId) {
        // End any active conversation
        const convo = this.convoManager.getPlayerConversation(info.playerId);
        if (convo) {
          this.convoManager.endConversation(convo.id, this.game.currentTick);
          this.broadcast({ type: "convo_update", data: convo });
        }
        this.game.removePlayer(info.playerId);
        this.broadcast({ type: "player_left", data: { id: info.playerId } });
      }
      this.clients.delete(ws);
    });
  }

  private onMessage(ws: WebSocket, info: ClientInfo, msg: ClientMessage): void {
    switch (msg.type) {
      case "join": {
        if (info.playerId) {
          this.send(ws, { type: "error", data: { message: "Already joined" } });
          return;
        }
        humanCounter++;
        const id = `human_${humanCounter}`;
        const spawns = this.game.world.getSpawnPoints();
        const spawn = spawns[humanCounter % spawns.length] ?? { x: 1, y: 1 };
        const player = this.game.spawnPlayer({
          id,
          name: msg.data.name,
          x: spawn.x,
          y: spawn.y,
          isNpc: false,
          description: msg.data.description ?? "",
        });
        info.playerId = id;
        this.send(ws, { type: "player_joined", data: player });
        this.broadcast({ type: "player_joined", data: player });
        break;
      }

      case "move": {
        if (!info.playerId) return;
        this.game.setPlayerTarget(info.playerId, msg.data.x, msg.data.y);
        break;
      }

      case "say": {
        if (!info.playerId) return;
        const convo = this.convoManager.getPlayerConversation(info.playerId);
        if (!convo || convo.state !== "active") {
          this.send(ws, {
            type: "error",
            data: { message: "Not in an active conversation" },
          });
          return;
        }
        const chatMsg = this.convoManager.addMessage(
          convo.id,
          info.playerId,
          msg.data.content,
          this.game.currentTick,
        );
        this.broadcast({ type: "message", data: chatMsg });
        break;
      }

      case "start_convo": {
        if (!info.playerId) return;
        try {
          const convo = this.convoManager.startConversation(
            info.playerId,
            msg.data.targetId,
            this.game.currentTick,
          );
          this.broadcast({ type: "convo_update", data: convo });
        } catch (err: any) {
          this.send(ws, { type: "error", data: { message: err.message } });
        }
        break;
      }

      case "end_convo": {
        if (!info.playerId) return;
        const convo = this.convoManager.getPlayerConversation(info.playerId);
        if (convo) {
          this.convoManager.endConversation(convo.id, this.game.currentTick);
          this.broadcast({ type: "convo_update", data: convo });
        }
        break;
      }

      case "ping": {
        // No-op keepalive
        break;
      }
    }
  }

  private buildFullState(): FullGameState {
    return {
      tick: this.game.currentTick,
      world: { width: this.game.world.width, height: this.game.world.height },
      players: this.game.getPlayers(),
      conversations: this.convoManager.getActiveConversations(),
      activities: this.game.world.getActivities(),
    };
  }

  private send(ws: WebSocket, message: ServerMessage): void {
    if (ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify(message));
    }
  }

  get clientCount(): number {
    return this.clients.size;
  }
}
