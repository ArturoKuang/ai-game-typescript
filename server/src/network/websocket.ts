import type { Server } from "node:http";
import { WebSocket, WebSocketServer } from "ws";
import type { GameLoop } from "../engine/gameLoop.js";
import type { Player } from "../engine/types.js";
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
      if (info.playerId) {
        // End any active conversation via command queue
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

  private onMessage(
    ws: WebSocket,
    info: ClientInfo,
    msg: ClientMessage,
  ): void {
    switch (msg.type) {
      case "join": {
        if (info.playerId) {
          this.send(ws, {
            type: "error",
            data: { message: "Already joined" },
          });
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

        // Send player_joined directly to the joining client so they know
        // their ID immediately. The broadcast to all other clients happens
        // when the spawn command is processed in the next tick.
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
        this.send(ws, { type: "player_joined", data: previewPlayer });
        break;
      }

      case "move": {
        if (!info.playerId) return;
        this.game.enqueue({
          type: "move_to",
          playerId: info.playerId,
          data: { x: msg.data.x, y: msg.data.y },
        });
        break;
      }

      case "move_direction": {
        if (!info.playerId) return;
        this.game.enqueue({
          type: "move_direction",
          playerId: info.playerId,
          data: { direction: msg.data.direction },
        });
        break;
      }

      case "input_start": {
        if (!info.playerId) return;
        this.game.setPlayerInput(info.playerId, msg.data.direction, true);
        break;
      }

      case "input_stop": {
        if (!info.playerId) return;
        this.game.setPlayerInput(info.playerId, msg.data.direction, false);
        break;
      }

      case "say": {
        if (!info.playerId) return;
        // Validate conversation state for immediate error feedback
        const convo = this.game.conversations.getPlayerConversation(
          info.playerId,
        );
        if (!convo || convo.state !== "active") {
          this.send(ws, {
            type: "error",
            data: { message: "Not in an active conversation" },
          });
          return;
        }
        this.game.enqueue({
          type: "say",
          playerId: info.playerId,
          data: { convoId: convo.id, content: msg.data.content },
        });
        break;
      }

      case "start_convo": {
        if (!info.playerId) return;
        this.game.enqueue({
          type: "start_convo",
          playerId: info.playerId,
          data: { targetId: msg.data.targetId },
        });
        break;
      }

      case "end_convo": {
        if (!info.playerId) return;
        const endConvo = this.game.conversations.getPlayerConversation(
          info.playerId,
        );
        if (endConvo) {
          this.game.enqueue({
            type: "end_convo",
            playerId: info.playerId,
            data: { convoId: endConvo.id },
          });
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
      conversations: this.game.conversations.getActiveConversations(),
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
