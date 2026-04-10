/**
 * WebSocket server bridging the game engine to browser clients.
 *
 * Responsibilities:
 * - Accept client connections and send an initial full-state snapshot.
 * - Translate incoming {@link ClientMessage}s into engine commands/inputs.
 * - Translate outgoing {@link GameEvent}s into {@link ServerMessage}s and
 *   broadcast or unicast them to the appropriate clients.
 * - Serialize player state through a stable public DTO before sending it.
 * - Clean up player state when a WebSocket disconnects.
 *
 * The server is wired to the engine via `game.on("*", broadcastGameEvent)`.
 */
import type { Server } from "node:http";
import { WebSocket, WebSocketServer } from "ws";
import type { NpcAutonomyManager } from "../autonomy/manager.js";
import type { NpcAutonomyDebugState } from "../autonomy/types.js";
import type {
  DebugDashboardBootstrap,
  DebugFeedEvent,
  DebugFeedEventPayload,
} from "../debug/streamTypes.js";
import type { Conversation, Message } from "../engine/conversation.js";
import type { GameLoop } from "../engine/gameLoop.js";
import type { GameEvent, Player } from "../engine/types.js";
import type { EntityManager } from "../autonomy/entityManager.js";
import type { BearManager } from "../bears/bearManager.js";
import type {
  ClientMessage,
  FullGameState,
  ServerMessage,
} from "./protocol.js";
import { createJoinPreviewPlayer, toPublicPlayer } from "./publicPlayer.js";

/** Per-connection metadata tracking which player (if any) this socket controls.
 *  A client starts with playerId=null and gets assigned one on "join". */
interface ClientInfo {
  /** Player ID this socket controls, or null before the "join" message. */
  playerId: string | null;
  /** True when this connection requested the debug dashboard stream. */
  debugSubscribed: boolean;
  ws: WebSocket;
}

/** Monotonic counter for assigning human player IDs (human_1, human_2, …).
 *  Never resets — ensures unique IDs even across reconnects within the same process. */
let humanCounter = 0;
const DEBUG_EVENT_BUFFER_MAX = 300;

export class GameWebSocketServer {
  private wss: WebSocketServer;
  /** Connected clients keyed by their WebSocket instance.
   *  Each entry tracks which player (if any) the socket controls,
   *  enabling targeted message delivery and cleanup on disconnect. */
  private clients: Map<WebSocket, ClientInfo> = new Map();
  /** Reference to the game engine; used to read state for snapshots and enqueue commands. */
  private game: GameLoop;
  /** Optional entity manager for including entities in state snapshots. */
  private entityManager?: EntityManager;
  /** Optional autonomy manager for debug dashboard bootstrap snapshots. */
  private autonomyManager?: NpcAutonomyManager;
  /** Optional bear manager for routing combat commands. */
  private bearManager?: BearManager;
  /** Latest screenshot captured from a connected client (base64 PNG data URL). */
  private latestScreenshot: string | null = null;
  /** Resolvers waiting for a screenshot to arrive. */
  private screenshotWaiters: Array<(png: string) => void> = [];
  /** Recent debug feed events used to bootstrap newly connected dashboards. */
  private debugEvents: DebugFeedEvent[] = [];
  /** Monotonic sequence for debug feed item IDs. */
  private nextDebugEventId = 1;

  constructor(
    server: Server,
    game: GameLoop,
    entityManager?: EntityManager,
    autonomyManager?: NpcAutonomyManager,
  ) {
    this.game = game;
    this.entityManager = entityManager;
    this.autonomyManager = autonomyManager;
    this.wss = new WebSocketServer({ server });

    this.wss.on("connection", (ws) => this.onConnection(ws));
  }

  /** Wire the bear manager for routing combat commands. */
  setBearManager(bm: BearManager): void {
    this.bearManager = bm;
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
            data: toPublicPlayer(player),
          });
        }
        return;
      }
      case "despawn": {
        if (event.playerId) {
          const reason =
            event.data?.reason === "death" ? "death" : undefined;
          const cause =
            typeof event.data?.cause === "string"
              ? event.data.cause
              : undefined;
          const depletedNeed =
            event.data?.depletedNeed === "health" ||
            event.data?.depletedNeed === "food" ||
            event.data?.depletedNeed === "water" ||
            event.data?.depletedNeed === "social"
              ? event.data.depletedNeed
              : undefined;
          this.broadcast({
            type: "player_left",
            data: {
              id: event.playerId,
              reason,
              cause,
              depletedNeed,
            },
          });
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
            data: toPublicPlayer(player),
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
        this.broadcastToDebugSubscribers({
          type: "debug_conversation_upsert",
          data: conversation,
        });
        this.publishDebugEventIfPresent(
          this.buildDebugEventFromGameEvent(event, conversation),
        );
        return;
      }
      case "convo_declined": {
        const conversation = this.resolveConversation(event);
        if (conversation) {
          this.broadcastToDebugSubscribers({
            type: "debug_conversation_upsert",
            data: conversation,
          });
          this.publishDebugEventIfPresent(
            this.buildDebugEventFromGameEvent(event, conversation),
          );
        }
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
        this.broadcastToDebugSubscribers({
          type: "debug_conversation_message",
          data: message,
        });
        this.publishDebugEventIfPresent(
          this.buildDebugEventFromGameEvent(event, conversation),
        );
        return;
      }
      case "tick_complete": {
        const tick = event.data?.tick;
        if (typeof tick === "number") {
          this.broadcast({ type: "tick", data: { tick } });
        }
        return;
      }

      // Combat and item events
      case "bear_spawn":
      case "bear_death":
      case "bear_attack":
      case "player_attack":
      case "item_drop": {
        this.broadcast({
          type: "combat_event",
          data: { eventType: event.type, ...event.data },
        });
        return;
      }
      case "item_pickup": {
        this.broadcast({
          type: "combat_event",
          data: { eventType: event.type, ...event.data },
        });
        // Send inventory_update to the player who picked up
        if (event.playerId && this.bearManager) {
          this.sendInventoryUpdate(event.playerId);
        }
        return;
      }
      case "player_damage":
      case "player_death": {
        const survivalDeath = event.data?.cause === "survival";
        // Broadcast updated player state + combat event
        const player = event.playerId
          ? this.game.getPlayer(event.playerId)
          : undefined;
        if (player && !survivalDeath) {
          this.broadcast({
            type: "player_update",
            data: toPublicPlayer(player),
          });
        }
        this.broadcast({
          type: "combat_event",
          data: { eventType: event.type, ...event.data },
        });
        return;
      }
      case "player_heal": {
        const player = event.playerId
          ? this.game.getPlayer(event.playerId)
          : undefined;
        if (player) {
          this.broadcast({
            type: "player_update",
            data: toPublicPlayer(player),
          });
        }
        this.broadcast({
          type: "combat_event",
          data: { eventType: event.type, ...event.data },
        });
        // Eating consumes an item — send updated inventory
        if (event.playerId && this.bearManager) {
          this.sendInventoryUpdate(event.playerId);
        }
        return;
      }
      case "item_consumed": {
        if (event.playerId && this.bearManager) {
          this.sendInventoryUpdate(event.playerId);
        }
        return;
      }
    }
  }

  private onConnection(ws: WebSocket): void {
    const info: ClientInfo = { playerId: null, debugSubscribed: false, ws };
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
      case "subscribe_debug": {
        info.debugSubscribed = true;
        this.sendDebugBootstrap(ws);
        return;
      }

      case "join": {
        if (info.playerId && this.game.getPlayer(info.playerId)) {
          this.sendError(ws, "Already joined");
          return;
        }
        info.playerId = null;
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

        this.send(ws, {
          type: "player_joined",
          data: createJoinPreviewPlayer({
            id,
            name: msg.data.name,
            description: msg.data.description ?? "",
            x: spawn.x,
            y: spawn.y,
          }),
        });
        // Send initial (empty) inventory
        if (this.bearManager) {
          const items = this.bearManager.getInventoryItems(id);
          const capacity = this.bearManager.getInventoryCapacity();
          this.send(ws, {
            type: "inventory_update",
            data: { playerId: id, items, capacity },
          });
        }
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

      case "attack": {
        if (!info.playerId) return;
        this.game.enqueue({
          type: "attack",
          playerId: info.playerId,
          data: { targetId: msg.data.targetId },
        });
        return;
      }

      case "pickup": {
        if (!info.playerId) return;
        this.game.enqueue({
          type: "pickup",
          playerId: info.playerId,
          data: { entityId: msg.data.entityId },
        });
        return;
      }

      case "pickup_nearby": {
        if (!info.playerId || !this.bearManager) return;
        const nearestId = this.bearManager.findNearestPickupable(info.playerId);
        if (nearestId) {
          this.game.enqueue({
            type: "pickup",
            playerId: info.playerId,
            data: { entityId: nearestId },
          });
        }
        return;
      }

      case "eat": {
        if (!info.playerId) return;
        this.game.enqueue({
          type: "eat",
          playerId: info.playerId,
          data: { item: msg.data.item },
        });
        return;
      }

      case "ping": {
        return;
      }

      case "screenshot_data": {
        if (msg.data?.png) {
          this.handleScreenshotData(msg.data.png);
        }
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

    const entities = this.entityManager
      ? this.entityManager.getAll().map((e) => ({
          id: e.id,
          type: e.type,
          x: e.position.x,
          y: e.position.y,
          properties: e.properties,
          destroyed: e.destroyed,
        }))
      : undefined;

    return {
      tick: this.game.currentTick,
      world: { width: this.game.world.width, height: this.game.world.height },
      players: this.game.getPlayers().map((player) => toPublicPlayer(player)),
      conversations,
      activities: this.game.world.getActivities(),
      entities,
    };
  }

  private buildDebugBootstrap(): DebugDashboardBootstrap {
    const autonomyStates = Object.fromEntries(
      Array.from(this.autonomyManager?.getAllDebugStates() ?? []).map(
        ([npcId, state]) => [npcId, state],
      ),
    ) as Record<string, NpcAutonomyDebugState>;

    return {
      tick: this.game.currentTick,
      players: this.game.getPlayers().map((player) => toPublicPlayer(player)),
      conversations: this.game.conversations.getAllConversations(),
      autonomyStates,
      recentEvents: [...this.debugEvents],
      actionDefinitions: this.autonomyManager?.getActionDefinitions() ?? {},
    };
  }

  private sendDebugBootstrap(ws: WebSocket): void {
    this.send(ws, {
      type: "debug_bootstrap",
      data: this.buildDebugBootstrap(),
    });
  }

  private broadcastToDebugSubscribers(message: ServerMessage): void {
    const payload = JSON.stringify(message);
    for (const [ws, info] of this.clients) {
      if (!info.debugSubscribed || ws.readyState !== WebSocket.OPEN) {
        continue;
      }
      ws.send(payload);
    }
  }

  broadcastDebugAutonomyUpsert(state: NpcAutonomyDebugState): void {
    this.broadcastToDebugSubscribers({
      type: "debug_autonomy_upsert",
      data: state,
    });
  }

  publishDebugEvent(event: DebugFeedEventPayload): void {
    const item: DebugFeedEvent = {
      id: this.nextDebugEventId++,
      ...event,
    };
    this.debugEvents.push(item);
    if (this.debugEvents.length > DEBUG_EVENT_BUFFER_MAX) {
      this.debugEvents.splice(0, this.debugEvents.length - DEBUG_EVENT_BUFFER_MAX);
    }
    this.broadcastToDebugSubscribers({
      type: "debug_event",
      data: item,
    });
  }

  private publishDebugEventIfPresent(
    event: DebugFeedEventPayload | null,
  ): void {
    if (!event) {
      return;
    }
    this.publishDebugEvent(event);
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

  private buildDebugEventFromGameEvent(
    event: GameEvent,
    conversation: Conversation,
  ): DebugFeedEventPayload | null {
    const participantLabel = this.describeConversationParticipants(conversation);

    switch (event.type) {
      case "convo_started":
        return {
          tick: event.tick,
          type: "conversation_started",
          severity: "info",
          subjectType: "conversation",
          subjectId: String(conversation.id),
          relatedConversationId: conversation.id,
          title: "Conversation started",
          message: `${participantLabel} started a conversation.`,
        };
      case "convo_accepted":
      case "convo_active":
        return {
          tick: event.tick,
          type: "conversation_active",
          severity: "info",
          subjectType: "conversation",
          subjectId: String(conversation.id),
          relatedConversationId: conversation.id,
          title: "Conversation active",
          message: `${participantLabel} are now talking.`,
        };
      case "convo_declined":
      case "convo_ended": {
        const reason =
          typeof conversation.endedReason === "string"
            ? ` (${conversation.endedReason.replaceAll("_", " ")})`
            : "";
        return {
          tick: event.tick,
          type: "conversation_ended",
          severity: "info",
          subjectType: "conversation",
          subjectId: String(conversation.id),
          relatedConversationId: conversation.id,
          title: "Conversation ended",
          message: `${participantLabel} ended their conversation${reason}.`,
        };
      }
      case "convo_message": {
        const message = event.data?.message as Message | undefined;
        if (!message) {
          return null;
        }
        return {
          tick: event.tick,
          type: "conversation_message",
          severity: "info",
          subjectType: "conversation",
          subjectId: String(conversation.id),
          relatedConversationId: conversation.id,
          title: "Message sent",
          message: `${this.getPlayerLabel(message.playerId)}: ${message.content}`,
        };
      }
      default:
        return null;
    }
  }

  private describeConversationParticipants(conversation: Conversation): string {
    return `${this.getPlayerLabel(conversation.player1Id)} and ${this.getPlayerLabel(conversation.player2Id)}`;
  }

  private getPlayerLabel(playerId: string): string {
    return this.game.getPlayer(playerId)?.name ?? playerId;
  }

  /** Send the current inventory state to a specific player. */
  private sendInventoryUpdate(playerId: string): void {
    if (!this.bearManager) return;
    const items = this.bearManager.getInventoryItems(playerId);
    const capacity = this.bearManager.getInventoryCapacity();
    this.sendToPlayer(playerId, {
      type: "inventory_update",
      data: { playerId, items, capacity },
    });
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
    const info = this.clients.get(ws);
    this.publishDebugEvent({
      tick: this.game.currentTick,
      type: "error",
      severity: "error",
      subjectType: info?.playerId ? "player" : "system",
      subjectId: info?.playerId ?? "system",
      title: "Server error",
      message: info?.playerId
        ? `${this.getPlayerLabel(info.playerId)}: ${message}`
        : message,
    });
  }

  get clientCount(): number {
    return this.clients.size;
  }

  /** Request a screenshot from the first connected client. Returns the base64 PNG data URL. */
  requestScreenshot(timeoutMs = 5000): Promise<string | null> {
    // Find a connected client to ask
    let sent = false;
    for (const [ws] of this.clients) {
      if (ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({ type: "capture_screenshot" }));
        sent = true;
        break;
      }
    }
    if (!sent) return Promise.resolve(null);

    return new Promise((resolve) => {
      const timer = setTimeout(() => {
        const idx = this.screenshotWaiters.indexOf(resolve as (png: string) => void);
        if (idx >= 0) this.screenshotWaiters.splice(idx, 1);
        resolve(null);
      }, timeoutMs);

      this.screenshotWaiters.push((png: string) => {
        clearTimeout(timer);
        resolve(png);
      });
    });
  }

  /** Get the latest screenshot without requesting a new one. */
  getLatestScreenshot(): string | null {
    return this.latestScreenshot;
  }

  /** Called when a client sends screenshot data. */
  private handleScreenshotData(png: string): void {
    this.latestScreenshot = png;
    const waiter = this.screenshotWaiters.shift();
    if (waiter) waiter(png);
  }
}
