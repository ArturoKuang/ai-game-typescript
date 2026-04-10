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
import type { EntityManager } from "../autonomy/entityManager.js";
import type { NpcAutonomyManager } from "../autonomy/manager.js";
import type { NpcAutonomyDebugState } from "../autonomy/types.js";
import type { BearManager } from "../bears/bearManager.js";
import type {
  DebugDashboardBootstrap,
  DebugFeedEvent,
  DebugFeedEventPayload,
} from "../debug/streamTypes.js";
import {
  type Conversation,
  type Message,
  resolveConversationFromEvent,
  resolveConversationParticipantIds,
} from "../engine/conversation.js";
import type { GameLoop } from "../engine/gameLoop.js";
import type { Command, GameEvent, Player } from "../engine/types.js";
import { serializeWorldEntity } from "../stateSnapshots.js";
import type {
  ClientMessage,
  FullGameState,
  MoveDirection,
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
        this.broadcastSpawnEvent(event);
        return;
      }
      case "despawn": {
        this.broadcastDespawnEvent(event);
        return;
      }
      case "move_direction":
      case "move_start":
      case "input_move":
      case "player_update":
      case "move_end": {
        this.broadcastPlayerEventUpdate(event);
        return;
      }
      case "convo_started":
      case "convo_accepted":
      case "convo_active":
      case "convo_ended": {
        this.broadcastConversationEventUpdate(event, true);
        return;
      }
      case "convo_declined": {
        this.broadcastConversationEventUpdate(event, false);
        return;
      }
      case "convo_message": {
        this.broadcastConversationMessageEvent(event);
        return;
      }
      case "tick_complete": {
        this.broadcastTickEvent(event);
        return;
      }

      // Combat and item events
      case "bear_spawn":
      case "bear_death":
      case "bear_attack":
      case "player_attack":
      case "item_drop": {
        this.broadcastCombatEvent(event);
        return;
      }
      case "item_pickup": {
        this.broadcastCombatEvent(event);
        this.sendInventoryUpdateIfPossible(event.playerId);
        return;
      }
      case "player_damage":
      case "player_death": {
        const survivalDeath = event.data?.cause === "survival";
        if (!survivalDeath) {
          this.broadcastPlayerEventUpdate(event);
        }
        this.broadcastCombatEvent(event);
        return;
      }
      case "player_heal": {
        this.broadcastPlayerEventUpdate(event);
        this.broadcastCombatEvent(event);
        this.sendInventoryUpdateIfPossible(event.playerId);
        return;
      }
      case "item_consumed": {
        this.sendInventoryUpdateIfPossible(event.playerId);
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
      this.handleConnectionClose(info);
      this.clients.delete(ws);
    });
  }

  private onMessage(ws: WebSocket, info: ClientInfo, msg: ClientMessage): void {
    switch (msg.type) {
      case "subscribe_debug": {
        this.handleDebugSubscription(ws, info);
        return;
      }

      case "join": {
        this.handleJoinMessage(
          ws,
          info,
          msg.data.name,
          msg.data.description ?? "",
        );
        return;
      }

      case "move": {
        this.handleMoveMessage(info.playerId, msg.data.x, msg.data.y);
        return;
      }

      case "move_direction": {
        this.handleMoveDirectionMessage(info.playerId, msg.data.direction);
        return;
      }

      case "input_start": {
        this.handleInputMessage(info.playerId, msg.data.direction, true);
        return;
      }

      case "input_stop": {
        this.handleInputMessage(info.playerId, msg.data.direction, false);
        return;
      }

      case "say": {
        this.handleSayMessage(ws, info.playerId, msg.data.content);
        return;
      }

      case "start_convo": {
        this.handleStartConversationMessage(
          ws,
          info.playerId,
          msg.data.targetId,
        );
        return;
      }

      case "accept_convo": {
        this.handleInviteResponseMessage(
          ws,
          info.playerId,
          msg.data.convoId,
          "accept_convo",
          "Only the invited player can accept this conversation",
        );
        return;
      }

      case "decline_convo": {
        this.handleInviteResponseMessage(
          ws,
          info.playerId,
          msg.data.convoId,
          "decline_convo",
          "Only the invited player can decline this conversation",
        );
        return;
      }

      case "end_convo": {
        this.handleEndConversationMessage(ws, info.playerId);
        return;
      }

      case "attack": {
        this.handleAttackMessage(info.playerId, msg.data.targetId);
        return;
      }

      case "pickup": {
        this.handlePickupMessage(info.playerId, msg.data.entityId);
        return;
      }

      case "pickup_nearby": {
        this.handlePickupNearbyMessage(info.playerId);
        return;
      }

      case "eat": {
        this.handleEatMessage(info.playerId, msg.data.item);
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

  private broadcastSpawnEvent(event: GameEvent): void {
    this.broadcastPlayerJoined(this.resolvePlayerFromEvent(event));
  }

  private broadcastDespawnEvent(event: GameEvent): void {
    if (!event.playerId) {
      return;
    }
    const reason = event.data?.reason === "death" ? "death" : undefined;
    const cause =
      typeof event.data?.cause === "string" ? event.data.cause : undefined;
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

  private broadcastPlayerEventUpdate(event: GameEvent): void {
    this.broadcastPlayerUpdate(this.resolvePlayerFromEvent(event));
  }

  private broadcastConversationEventUpdate(
    event: GameEvent,
    notifyParticipants: boolean,
  ): void {
    const conversation = this.resolveConversationForEvent(event);
    if (!conversation) {
      return;
    }
    if (notifyParticipants) {
      this.sendConversationUpdate(event, conversation);
    }
    this.broadcastConversationDebugUpdate(event, conversation);
  }

  private broadcastConversationMessageEvent(event: GameEvent): void {
    const message = event.data?.message as Message | undefined;
    if (!message) {
      return;
    }
    const conversation =
      this.resolveConversationForEvent(event) ??
      this.game.conversations.getConversation(message.convoId);
    if (!conversation) {
      return;
    }
    this.sendToPlayers(resolveConversationParticipantIds(event, conversation), {
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
  }

  private broadcastTickEvent(event: GameEvent): void {
    const tick = event.data?.tick;
    if (typeof tick !== "number") {
      return;
    }
    this.broadcast({ type: "tick", data: { tick } });
  }

  private broadcastCombatEvent(event: GameEvent): void {
    this.broadcast({
      type: "combat_event",
      data: { eventType: event.type, ...event.data },
    });
  }

  private broadcastPlayerJoined(player: Player | undefined): void {
    if (!player) {
      return;
    }
    this.broadcast({
      type: "player_joined",
      data: toPublicPlayer(player),
    });
  }

  private broadcastPlayerUpdate(player: Player | undefined): void {
    if (!player) {
      return;
    }
    this.broadcast({
      type: "player_update",
      data: toPublicPlayer(player),
    });
  }

  private resolvePlayerFromEvent(event: GameEvent): Player | undefined {
    return (
      (event.data?.player as Player | undefined) ??
      (event.playerId ? this.game.getPlayer(event.playerId) : undefined)
    );
  }

  private resolveConversationForEvent(event: GameEvent): Conversation | null {
    return (
      resolveConversationFromEvent(event, (convoId) =>
        this.game.conversations.getConversation(convoId),
      ) ?? null
    );
  }

  private sendConversationUpdate(
    event: GameEvent,
    conversation: Conversation,
  ): void {
    this.sendToPlayers(resolveConversationParticipantIds(event, conversation), {
      type: "convo_update",
      data: conversation,
    });
  }

  private broadcastConversationDebugUpdate(
    event: GameEvent,
    conversation: Conversation,
  ): void {
    this.broadcastToDebugSubscribers({
      type: "debug_conversation_upsert",
      data: conversation,
    });
    this.publishDebugEventIfPresent(
      this.buildDebugEventFromGameEvent(event, conversation),
    );
  }

  private sendInventoryUpdateIfPossible(
    playerId: string | null | undefined,
  ): void {
    if (!playerId || !this.bearManager) {
      return;
    }
    this.sendInventoryUpdate(playerId);
  }

  private handleConnectionClose(info: ClientInfo): void {
    const { playerId } = info;
    if (!playerId) {
      return;
    }
    const convo = this.game.conversations.getPlayerConversation(playerId);
    if (convo) {
      this.game.enqueue({
        type: "end_convo",
        playerId,
        data: { convoId: convo.id },
      });
    }
    this.game.enqueue({
      type: "remove",
      playerId,
    });
  }

  private handleDebugSubscription(ws: WebSocket, info: ClientInfo): void {
    info.debugSubscribed = true;
    this.sendDebugBootstrap(ws);
  }

  private handleJoinMessage(
    ws: WebSocket,
    info: ClientInfo,
    name: string,
    description: string,
  ): void {
    if (info.playerId && this.game.getPlayer(info.playerId)) {
      this.sendError(ws, "Already joined");
      return;
    }
    info.playerId = null;
    humanCounter++;
    const playerId = `human_${humanCounter}`;
    const spawn = this.pickHumanSpawnPoint();
    info.playerId = playerId;

    this.game.enqueue({
      type: "spawn",
      playerId,
      data: {
        name,
        x: spawn.x,
        y: spawn.y,
        isNpc: false,
        description,
      },
    });

    this.send(ws, {
      type: "player_joined",
      data: createJoinPreviewPlayer({
        id: playerId,
        name,
        description,
        x: spawn.x,
        y: spawn.y,
      }),
    });
    this.sendInitialInventory(ws, playerId);
  }

  private pickHumanSpawnPoint(): { x: number; y: number } {
    const spawns = this.game.world.getSpawnPoints();
    return spawns[humanCounter % spawns.length] ?? { x: 1, y: 1 };
  }

  private sendInitialInventory(ws: WebSocket, playerId: string): void {
    const message = this.buildInventoryUpdateMessage(playerId);
    if (message) {
      this.send(ws, message);
    }
  }

  private handleMoveMessage(
    playerId: string | null,
    x: number,
    y: number,
  ): void {
    this.enqueueIfPlayerJoined(playerId, (joinedPlayerId) => ({
      type: "move_to",
      playerId: joinedPlayerId,
      data: { x, y },
    }));
  }

  private handleMoveDirectionMessage(
    playerId: string | null,
    direction: MoveDirection,
  ): void {
    this.enqueueIfPlayerJoined(playerId, (joinedPlayerId) => ({
      type: "move_direction",
      playerId: joinedPlayerId,
      data: { direction },
    }));
  }

  private handleInputMessage(
    playerId: string | null,
    direction: MoveDirection,
    active: boolean,
  ): void {
    this.withJoinedPlayerId(playerId, (joinedPlayerId) => {
      this.game.setPlayerInput(joinedPlayerId, direction, active);
    });
  }

  private handleSayMessage(
    ws: WebSocket,
    playerId: string | null,
    content: string,
  ): void {
    const convo = this.getConversationForJoinedPlayer(playerId);
    if (!convo || convo.state !== "active") {
      this.sendError(ws, "Not in an active conversation");
      return;
    }
    this.game.enqueue({
      type: "say",
      playerId: convo.playerId,
      data: { convoId: convo.id, content },
    });
  }

  private handleStartConversationMessage(
    ws: WebSocket,
    playerId: string | null,
    targetId: string,
  ): void {
    const joinedPlayerId = this.getJoinedPlayerId(playerId);
    if (!joinedPlayerId) {
      return;
    }
    if (targetId === joinedPlayerId) {
      this.sendError(ws, "Cannot start a conversation with yourself");
      return;
    }
    const target = this.game.getPlayer(targetId);
    if (!target) {
      this.sendError(ws, "Conversation target not found");
      return;
    }
    if (this.game.conversations.getPlayerConversation(joinedPlayerId)) {
      this.sendError(ws, "You are already in a conversation");
      return;
    }
    if (this.game.conversations.getPlayerConversation(targetId)) {
      this.sendError(ws, "That player is already in a conversation");
      return;
    }
    this.game.enqueue({
      type: "start_convo",
      playerId: joinedPlayerId,
      data: { targetId },
    });
  }

  private handleInviteResponseMessage(
    ws: WebSocket,
    playerId: string | null,
    convoId: number,
    type: "accept_convo" | "decline_convo",
    unauthorizedMessage: string,
  ): void {
    const invite = this.getPendingInviteForJoinedPlayer(
      ws,
      playerId,
      convoId,
      unauthorizedMessage,
    );
    if (!invite) {
      return;
    }
    this.game.enqueue({
      type,
      playerId: invite.playerId,
      data: { convoId },
    });
  }

  private handleEndConversationMessage(
    ws: WebSocket,
    playerId: string | null,
  ): void {
    const convo = this.getConversationForJoinedPlayer(playerId);
    if (!convo) {
      this.sendError(ws, "Not currently in a conversation");
      return;
    }
    this.game.enqueue({
      type: "end_convo",
      playerId: convo.playerId,
      data: { convoId: convo.id },
    });
  }

  private handleAttackMessage(playerId: string | null, targetId: string): void {
    this.enqueueIfPlayerJoined(playerId, (joinedPlayerId) => ({
      type: "attack",
      playerId: joinedPlayerId,
      data: { targetId },
    }));
  }

  private handlePickupMessage(playerId: string | null, entityId: string): void {
    this.enqueueIfPlayerJoined(playerId, (joinedPlayerId) => ({
      type: "pickup",
      playerId: joinedPlayerId,
      data: { entityId },
    }));
  }

  private handlePickupNearbyMessage(playerId: string | null): void {
    this.withJoinedPlayerId(playerId, (joinedPlayerId) => {
      if (!this.bearManager) {
        return;
      }
      const nearestId = this.bearManager.findNearestPickupable(joinedPlayerId);
      if (!nearestId) {
        return;
      }
      this.game.enqueue({
        type: "pickup",
        playerId: joinedPlayerId,
        data: { entityId: nearestId },
      });
    });
  }

  private handleEatMessage(playerId: string | null, item: string): void {
    this.enqueueIfPlayerJoined(playerId, (joinedPlayerId) => ({
      type: "eat",
      playerId: joinedPlayerId,
      data: { item },
    }));
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
      ? this.entityManager
          .getAll()
          .map((entity) => serializeWorldEntity(entity))
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
      this.debugEvents.splice(
        0,
        this.debugEvents.length - DEBUG_EVENT_BUFFER_MAX,
      );
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

  private buildDebugEventFromGameEvent(
    event: GameEvent,
    conversation: Conversation,
  ): DebugFeedEventPayload | null {
    const participantLabel =
      this.describeConversationParticipants(conversation);

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
    const message = this.buildInventoryUpdateMessage(playerId);
    if (message) {
      this.sendToPlayer(playerId, message);
    }
  }

  private getJoinedPlayerId(playerId: string | null): string | null {
    return playerId;
  }

  private withJoinedPlayerId(
    playerId: string | null,
    callback: (playerId: string) => void,
  ): void {
    const joinedPlayerId = this.getJoinedPlayerId(playerId);
    if (!joinedPlayerId) {
      return;
    }
    callback(joinedPlayerId);
  }

  private enqueueIfPlayerJoined(
    playerId: string | null,
    buildCommand: (playerId: string) => Command,
  ): void {
    this.withJoinedPlayerId(playerId, (joinedPlayerId) => {
      this.game.enqueue(buildCommand(joinedPlayerId));
    });
  }

  private getConversationForJoinedPlayer(
    playerId: string | null,
  ): (Conversation & { playerId: string }) | null {
    const joinedPlayerId = this.getJoinedPlayerId(playerId);
    if (!joinedPlayerId) {
      return null;
    }
    const conversation =
      this.game.conversations.getPlayerConversation(joinedPlayerId);
    if (!conversation) {
      return null;
    }
    return { ...conversation, playerId: joinedPlayerId };
  }

  private getPendingInviteForJoinedPlayer(
    ws: WebSocket,
    playerId: string | null,
    convoId: number,
    unauthorizedMessage: string,
  ): { playerId: string; convo: Conversation } | null {
    const joinedPlayerId = this.getJoinedPlayerId(playerId);
    if (!joinedPlayerId) {
      return null;
    }
    const convo = this.game.conversations.getConversation(convoId);
    if (!convo || convo.state !== "invited") {
      this.sendError(ws, "Conversation invite is no longer available");
      return null;
    }
    if (convo.player2Id !== joinedPlayerId) {
      this.sendError(ws, unauthorizedMessage);
      return null;
    }
    return { playerId: joinedPlayerId, convo };
  }

  private buildInventoryUpdateMessage(playerId: string): ServerMessage | null {
    if (!this.bearManager) {
      return null;
    }
    const items = this.bearManager.getInventoryItems(playerId);
    const capacity = this.bearManager.getInventoryCapacity();
    return {
      type: "inventory_update",
      data: { playerId, items, capacity },
    };
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
        const idx = this.screenshotWaiters.indexOf(
          resolve as (png: string) => void,
        );
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
