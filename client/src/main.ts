import {
  appendConversationMessage,
  upsertConversationSnapshot,
} from "./conversationDebugState.js";
/**
 * Client entry point — orchestrates rendering, networking, input, and prediction.
 *
 * ## Startup
 * 1. Initialize PixiJS renderer.
 * 2. Fetch the tile map from `/data/map.json` (fallback to blank bordered map).
 * 3. Connect WebSocket to the game server.
 * 4. Register input handlers (WASD, chat, conversation actions).
 * 5. Start the render loop with client-side prediction.
 *
 * ## Server reconciliation
 * The local player is predicted client-side for instant responsiveness.
 * When `player_update` arrives from the server, drift is corrected using
 * one of three modes based on distance:
 *
 * | Condition               | Mode   | Behavior                    |
 * |-------------------------|--------|-----------------------------|
 * | dist > 4                | snap   | Teleport to server position |
 * | moving && dist > 1.0    | snap   | Teleport (large divergence) |
 * | moving && dist > 0.35   | lerp   | Blend 50% toward server     |
 * | stopped && dist > 0.3   | settle | Blend 30% toward server     |
 * | otherwise               | ignore | Trust client prediction      |
 */
import { logClientDebugEvent } from "./debugLog.js";
import { GameClient } from "./network.js";
import {
  MOVE_SPEED,
  PLAYER_RADIUS,
  getHeldDirectionVector,
  predictLocalPlayerStep,
} from "./prediction.js";
import { GameRenderer } from "./renderer.js";
import type {
  Conversation,
  FullGameState,
  MoveDirection,
  Player,
  PlayerSurvivalData,
  TileType,
  WorldEntity,
} from "./types.js";
import { UI } from "./ui.js";

// State
let gameState: FullGameState | null = null;
let selfId: string | null = null;
let awaitingJoinConfirmation = false;
let mapLoaded = false;
let mapTiles: TileType[][] | null = null;
const playerSurvival = new Map<string, PlayerSurvivalData>();
const PLAYER_ATTACK_REACH = 2;

function conversationIncludesPlayer(
  conversation: Conversation,
  playerId: string,
): boolean {
  return (
    conversation.player1Id === playerId || conversation.player2Id === playerId
  );
}

function getConversationPartnerId(
  conversation: Conversation,
  playerId: string,
): string {
  return conversation.player1Id === playerId
    ? conversation.player2Id
    : conversation.player1Id;
}

function manhattanDistance(
  left: { x: number; y: number },
  right: { x: number; y: number },
): number {
  return Math.abs(left.x - right.x) + Math.abs(left.y - right.y);
}

// Init
const canvas = document.getElementById("game-canvas") as HTMLCanvasElement;
const renderer = new GameRenderer(canvas);
const client = new GameClient();
const ui = new UI();
const autoJoinName = new URLSearchParams(window.location.search).get(
  "autojoin",
);

async function start() {
  await renderer.init();

  // Load map tiles eagerly
  try {
    const mapRes = await fetch("/data/map.json");
    if (mapRes.ok) {
      const mapData = await mapRes.json();
      renderer.renderMap(mapData.tiles);
      mapTiles = mapData.tiles;
      mapLoaded = true;
    }
  } catch (err) {
    console.error("Failed to load map:", err);
  }

  // Fallback: render blank map from state dimensions
  if (!mapLoaded) {
    const stateRes = await fetch("/api/debug/state");
    if (stateRes.ok) {
      const state = await stateRes.json();
      const w = state.world?.width ?? 20;
      const h = state.world?.height ?? 20;
      const tiles: TileType[][] = [];
      for (let y = 0; y < h; y++) {
        const row: TileType[] = [];
        for (let x = 0; x < w; x++) {
          row.push(
            x === 0 || x === w - 1 || y === 0 || y === h - 1 ? "wall" : "floor",
          );
        }
        tiles.push(row);
      }
      renderer.renderMap(tiles);
      mapLoaded = true;
    }
  }

  // Connect WebSocket
  client.connect();
  client.onOpen(() => {
    if (!autoJoinName || selfId || awaitingJoinConfirmation) return;
    requestJoin(autoJoinName);
  });

  // --- WASD / Arrow key continuous movement with input_start/input_stop ---
  const KEY_TO_DIR: Record<string, MoveDirection> = {
    w: "up",
    a: "left",
    s: "down",
    d: "right",
    ArrowUp: "up",
    ArrowLeft: "left",
    ArrowDown: "down",
    ArrowRight: "right",
  };

  const heldDirections = new Set<MoveDirection>();

  function getSelfConversation(): Conversation | undefined {
    if (!gameState || !selfId) return undefined;
    const currentSelfId = selfId;
    return gameState.conversations.find(
      (conversation) =>
        conversationIncludesPlayer(conversation, currentSelfId) &&
        conversation.state !== "ended",
    );
  }

  function getPlayerName(playerId: string): string {
    return (
      gameState?.players.find((player) => player.id === playerId)?.name ??
      playerId
    );
  }

  function getPlayer(playerId: string): Player | undefined {
    return gameState?.players.find((player) => player.id === playerId);
  }

  function getSelfPlayer(): Player | undefined {
    return selfId ? getPlayer(selfId) : undefined;
  }

  function findNearestAttackTargetId(): string | undefined {
    if (!gameState) return undefined;
    const selfPlayer = getSelfPlayer();
    if (!selfPlayer) return undefined;

    const candidates = [
      ...gameState.players
        .filter((player) => player.id !== selfPlayer.id)
        .map((player) => ({
          id: player.id,
          x: player.x,
          y: player.y,
          targetType: "player" as const,
        })),
      ...(gameState.entities ?? [])
        .filter((entity) => entity.type === "bear" && !entity.destroyed)
        .map((entity) => ({
          id: entity.id,
          x: entity.x,
          y: entity.y,
          targetType: "bear" as const,
        })),
    ]
      .map((candidate) => ({
        ...candidate,
        distance: manhattanDistance(selfPlayer, candidate),
      }))
      .filter((candidate) => candidate.distance <= PLAYER_ATTACK_REACH)
      .sort(
        (left, right) =>
          left.distance - right.distance ||
          left.targetType.localeCompare(right.targetType),
      );

    return candidates[0]?.id;
  }

  /** Generate system chat messages describing a conversation state change. */
  function describeConversationUpdate(
    previous: Conversation | undefined,
    next: Conversation,
  ): string[] {
    if (!selfId || !conversationIncludesPlayer(next, selfId)) return [];

    const partnerName = getPlayerName(getConversationPartnerId(next, selfId));
    const messages: string[] = [];
    const changedState =
      !previous ||
      previous.state !== next.state ||
      previous.endedReason !== next.endedReason;

    if (!changedState) return messages;

    if (!previous && next.state === "invited") {
      messages.push(
        next.player2Id === selfId
          ? `${partnerName} invited you to chat`
          : `Invitation sent to ${partnerName}`,
      );
      return messages;
    }

    if (next.state === "walking") {
      messages.push(`Walking to meet ${partnerName}`);
    } else if (next.state === "active") {
      messages.push(`Conversation with ${partnerName} is active`);
    } else if (next.state === "ended") {
      if (next.endedReason === "declined") {
        messages.push(
          next.player2Id === selfId
            ? `You declined ${partnerName}`
            : `${partnerName} declined`,
        );
      } else {
        messages.push(`Conversation with ${partnerName} ended`);
      }
    }

    return messages;
  }

  /**
   * Recalculate the conversation panel and player list UI.
   *
   * Determines which players are "talkable" (idle, not in a conversation,
   * and the local player is also free), then renders the appropriate panel
   * state: no conversation, incoming invite, walking to meet, or active chat.
   */
  function refreshConversationUi(): void {
    if (!gameState) return;

    const currentConversation = getSelfConversation();
    const talkablePlayerIds = new Set<string>();
    const attackablePlayerIds = new Set<string>();
    const selfBusy = Boolean(currentConversation);
    const occupiedPlayerIds = new Set<string>();
    const selfPlayer = getSelfPlayer();

    for (const conversation of gameState.conversations) {
      if (conversation.state === "ended") continue;
      occupiedPlayerIds.add(conversation.player1Id);
      occupiedPlayerIds.add(conversation.player2Id);
    }

    for (const player of gameState.players) {
      if (!selfId || player.id === selfId) continue;
      if (
        selfPlayer &&
        manhattanDistance(selfPlayer, player) <= PLAYER_ATTACK_REACH
      ) {
        attackablePlayerIds.add(player.id);
      }
      if (selfBusy) continue;
      if (occupiedPlayerIds.has(player.id)) continue;
      if (player.state === "conversing") continue;
      talkablePlayerIds.add(player.id);
    }
    ui.updatePlayerList(
      gameState.players,
      talkablePlayerIds,
      attackablePlayerIds,
    );

    ui.updateConversationList(
      gameState.conversations,
      currentConversation?.id ?? null,
    );
    ui.setActiveConversation(currentConversation ?? null);

    if (selfPlayer) {
      const activity = currentConversation
        ? currentConversation.state === "active"
          ? `Talking with ${getPlayerName(getConversationPartnerId(currentConversation, selfPlayer.id))}`
          : currentConversation.state === "walking"
            ? "Walking to meet"
            : "Awaiting reply"
        : selfPlayer.state === "walking"
          ? "Walking"
          : selfPlayer.state === "doing_activity"
            ? "Foraging"
            : "Idle";
      ui.updateActorBadge(selfPlayer.name, activity);
    } else {
      ui.updateActorBadge("Not joined", "Press Join to enter");
    }

    if (!selfId || !currentConversation) {
      ui.renderConversationPanel({
        title: "No active conversation",
        status: "Start a conversation from the player list to chat.",
        chatEnabled: false,
        chatPlaceholder: "Start a conversation to chat",
        showInviteActions: false,
        showEndAction: false,
      });
      return;
    }

    const partnerId = getConversationPartnerId(currentConversation, selfId);
    const partnerName = getPlayerName(partnerId);
    const partner = getPlayer(partnerId);

    if (currentConversation.state === "invited") {
      const incomingInvite = currentConversation.player2Id === selfId;
      ui.renderConversationPanel({
        title: incomingInvite
          ? `Invite from ${partnerName}`
          : `Waiting on ${partnerName}`,
        status: incomingInvite
          ? `${partnerName} invited you to chat.`
          : `Waiting for ${partnerName} to respond.`,
        chatEnabled: false,
        chatPlaceholder: "Accept a conversation to chat",
        showInviteActions: incomingInvite,
        showEndAction: false,
      });
      return;
    }

    if (currentConversation.state === "walking") {
      ui.renderConversationPanel({
        title: `Meeting ${partnerName}`,
        status: `Walking to meet ${partnerName}.`,
        chatEnabled: false,
        chatPlaceholder: `Walking to meet ${partnerName}`,
        showInviteActions: false,
        showEndAction: false,
      });
      return;
    }

    ui.renderConversationPanel({
      title: `Talking with ${partnerName}`,
      status: partner?.isWaitingForResponse
        ? `${partnerName} is thinking...`
        : `Conversation with ${partnerName} is active.`,
      chatEnabled: true,
      chatPlaceholder: `Message ${partnerName}`,
      showInviteActions: false,
      showEndAction: true,
    });
  }

  function refreshSurvivalUi(): void {
    if (!selfId) {
      ui.updatePlayerSurvival(null);
      return;
    }
    ui.updatePlayerSurvival(playerSurvival.get(selfId) ?? null);
  }

  client.onMessage((msg) => {
    switch (msg.type) {
      case "state": {
        gameState = msg.data;
        ui.setStatus(
          `Connected | Tick: ${gameState.tick} | Players: ${gameState.players.length}`,
        );
        // Render initial entities
        if (gameState.entities) {
          renderer.updateEntities(gameState.entities);
        }
        refreshConversationUi();
        refreshSurvivalUi();
        break;
      }

      case "tick": {
        if (gameState) {
          gameState.tick = msg.data.tick;
        }
        break;
      }

      case "player_joined": {
        if (!gameState) break;
        const existing = gameState.players.findIndex(
          (p) => p.id === msg.data.id,
        );
        if (existing >= 0) {
          gameState.players[existing] = msg.data;
        } else {
          gameState.players.push(msg.data);
        }

        // If this is our join confirmation (first non-NPC join we see)
        if (awaitingJoinConfirmation && !msg.data.isNpc) {
          selfId = msg.data.id;
          awaitingJoinConfirmation = false;
          renderer.setSelfId(selfId);
          ui.setSelfId(selfId);
          joinBtn.textContent = "Joined";
          ui.addChatMessage("", `You joined as ${msg.data.name}`, true);
        }
        refreshConversationUi();
        refreshSurvivalUi();
        break;
      }

      case "player_left": {
        if (!gameState) break;
        const name = gameState.players.find((p) => p.id === msg.data.id)?.name;
        gameState.players = gameState.players.filter(
          (p) => p.id !== msg.data.id,
        );
        if (name) {
          const detail =
            msg.data.reason === "death" && msg.data.cause === "survival"
              ? ` (${msg.data.depletedNeed ?? "survival"} reached 0)`
              : "";
          ui.addChatMessage(
            "",
            msg.data.reason === "death"
              ? `${name} died${detail}`
              : `${name} left`,
            true,
          );
        }
        playerSurvival.delete(msg.data.id);
        if (msg.data.id === selfId) {
          selfId = null;
          awaitingJoinConfirmation = false;
          renderer.setSelfId(null);
          ui.setSelfId(null);
          ui.setStatus("You died. Enter a name to rejoin.");
          joinBtn.textContent = "Join";
          joinBtn.removeAttribute("disabled");
          nameInput.removeAttribute("disabled");
        }
        refreshConversationUi();
        refreshSurvivalUi();
        break;
      }

      case "player_update": {
        if (!gameState) break;
        const idx = gameState.players.findIndex((p) => p.id === msg.data.id);
        if (idx >= 0) {
          if (msg.data.id === selfId) {
            // Server reconciliation for self
            const local = gameState.players[idx];
            const dx = msg.data.x - local.x;
            const dy = msg.data.y - local.y;
            const dist = Math.sqrt(dx * dx + dy * dy);

            if (dist > 4) {
              // Teleport/spawn — snap immediately
              logClientDebugEvent("reconciliation_correction", {
                mode: "snap",
                playerId: msg.data.id,
                dist,
                serverX: msg.data.x,
                serverY: msg.data.y,
                localX: local.x,
                localY: local.y,
              });
              local.x = msg.data.x;
              local.y = msg.data.y;
            } else if (heldDirections.size > 0) {
              // Actively moving: tolerate tiny drift but correct collision-sized divergence.
              if (dist > 1.0) {
                logClientDebugEvent("reconciliation_correction", {
                  mode: "snap",
                  playerId: msg.data.id,
                  dist,
                  serverX: msg.data.x,
                  serverY: msg.data.y,
                  localX: local.x,
                  localY: local.y,
                });
                local.x = msg.data.x;
                local.y = msg.data.y;
              } else if (dist > 0.35) {
                logClientDebugEvent("reconciliation_correction", {
                  mode: "lerp",
                  playerId: msg.data.id,
                  dist,
                  serverX: msg.data.x,
                  serverY: msg.data.y,
                  localX: local.x,
                  localY: local.y,
                });
                local.x += dx * 0.5;
                local.y += dy * 0.5;
              }
            } else if (dist > 0.3) {
              // Stopped: correct toward server position
              logClientDebugEvent("reconciliation_correction", {
                mode: "settle",
                playerId: msg.data.id,
                dist,
                serverX: msg.data.x,
                serverY: msg.data.y,
                localX: local.x,
                localY: local.y,
              });
              local.x += dx * 0.3;
              local.y += dy * 0.3;
            }

            // Update non-position fields from server
            const { x: _serverX, y: _serverY, ...rest } = msg.data;
            Object.assign(local, rest);
          } else {
            gameState.players[idx] = msg.data;
          }
        }
        refreshConversationUi();
        break;
      }

      case "convo_update": {
        if (!gameState) break;
        const gameStateResult = upsertConversationSnapshot(
          gameState.conversations,
          msg.data,
        );
        gameState.conversations = gameStateResult.conversations;
        const previous = gameStateResult.previous;
        for (const systemMessage of describeConversationUpdate(
          previous,
          msg.data,
        )) {
          ui.addChatMessage("", systemMessage, true);
        }
        refreshConversationUi();
        break;
      }

      case "message": {
        if (gameState) {
          gameState.conversations = appendConversationMessage(
            gameState.conversations,
            msg.data,
          );
        }
        const sender = gameState?.players.find(
          (p) => p.id === msg.data.playerId,
        );
        const senderName = sender?.name ?? msg.data.playerId;
        ui.addChatMessage(
          senderName,
          msg.data.content,
          false,
          msg.data.convoId,
        );
        renderer.showChatBubble(msg.data.playerId, msg.data.content);
        refreshConversationUi();
        break;
      }

      case "entity_update": {
        if (!gameState) break;
        if (!gameState.entities) gameState.entities = [];
        const entityIdx = gameState.entities.findIndex(
          (e) => e.id === msg.data.id,
        );
        if (entityIdx >= 0) {
          gameState.entities[entityIdx] = msg.data;
        } else {
          gameState.entities.push(msg.data);
        }
        renderer.updateEntity(msg.data);
        break;
      }

      case "entity_removed": {
        if (!gameState?.entities) break;
        gameState.entities = gameState.entities.filter(
          (e) => e.id !== msg.data.entityId,
        );
        renderer.removeEntity(msg.data.entityId);
        break;
      }

      case "npc_needs": {
        renderer.updateNpcNeeds(msg.data);
        break;
      }

      case "player_survival": {
        playerSurvival.set(msg.data.playerId, msg.data);
        if (msg.data.playerId === selfId) {
          refreshSurvivalUi();
        }
        break;
      }

      case "inventory_update": {
        if (msg.data.playerId === selfId) {
          ui.updateInventory(msg.data.items, msg.data.capacity);
        }
        break;
      }

      case "combat_event": {
        // Combat events are informational; no specific UI handling needed yet
        break;
      }

      case "error": {
        ui.addChatMessage("", `Error: ${msg.data.message}`, true);
        break;
      }

      case "capture_screenshot": {
        // Extract canvas contents as PNG and send back to server
        const dataUrl = canvas.toDataURL("image/png");
        client.send({ type: "screenshot_data", data: { png: dataUrl } });
        break;
      }
    }
  });

  // Join button
  const joinBtn = document.getElementById("join-btn")!;
  const nameInput = document.getElementById("name-input") as HTMLInputElement;
  function requestJoin(name: string): void {
    const trimmed = name.trim();
    if (!trimmed || awaitingJoinConfirmation || selfId) return;
    awaitingJoinConfirmation = true;
    client.send({ type: "join", data: { name: trimmed } });
    joinBtn.textContent = "Joining...";
    joinBtn.setAttribute("disabled", "true");
    nameInput.setAttribute("disabled", "true");
  }

  if (autoJoinName) {
    nameInput.value = autoJoinName;
  }

  joinBtn.addEventListener("click", () => {
    requestJoin(nameInput.value);
  });
  nameInput.addEventListener("keydown", (e) => {
    if (e.key === "Enter") joinBtn.click();
  });

  // Chat
  ui.onChatSubmit((text) => {
    client.send({ type: "say", data: { content: text } });
  });

  ui.onTalk((playerId) => {
    client.send({ type: "start_convo", data: { targetId: playerId } });
  });

  ui.onAttack((playerId) => {
    client.send({ type: "attack", data: { targetId: playerId } });
  });

  ui.onUseInventoryItem((itemId) => {
    client.send({ type: "eat", data: { item: itemId } });
  });

  ui.onAcceptConversation(() => {
    const conversation = getSelfConversation();
    if (
      conversation &&
      selfId &&
      conversation.state === "invited" &&
      conversation.player2Id === selfId
    ) {
      client.send({
        type: "accept_convo",
        data: { convoId: conversation.id },
      });
    }
  });

  ui.onDeclineConversation(() => {
    const conversation = getSelfConversation();
    if (
      conversation &&
      selfId &&
      conversation.state === "invited" &&
      conversation.player2Id === selfId
    ) {
      client.send({
        type: "decline_convo",
        data: { convoId: conversation.id },
      });
    }
  });

  ui.onEndConversation(() => {
    const conversation = getSelfConversation();
    if (conversation?.state === "active") {
      client.send({ type: "end_convo" });
    }
  });

  function isInputFocused(): boolean {
    const tag = document.activeElement?.tagName;
    return tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT";
  }

  window.addEventListener("keydown", (e) => {
    // Tab: toggle band modal (allowed even when chat input is focused)
    if (e.key === "Tab") {
      e.preventDefault();
      ui.togglePlayerModal();
      return;
    }

    if (isInputFocused()) return;

    // I key: toggle inventory panel
    if (e.key === "i" || e.key === "I") {
      e.preventDefault();
      ui.toggleInventory();
      return;
    }

    // E key: pick up nearest item
    if (e.key === "e" || e.key === "E") {
      e.preventDefault();
      if (selfId) {
        client.send({ type: "pickup_nearby" });
      }
      return;
    }

    if (e.key === "f" || e.key === "F") {
      e.preventDefault();
      const targetId = findNearestAttackTargetId();
      if (targetId) {
        client.send({ type: "attack", data: { targetId } });
      }
      return;
    }

    const dir = KEY_TO_DIR[e.key];
    if (!dir) return;

    e.preventDefault();
    if (!heldDirections.has(dir)) {
      heldDirections.add(dir);
      client.send({ type: "input_start", data: { direction: dir } });
    }
  });

  window.addEventListener("keyup", (e) => {
    const dir = KEY_TO_DIR[e.key];
    if (!dir) return;
    if (heldDirections.has(dir)) {
      heldDirections.delete(dir);
      client.send({ type: "input_stop", data: { direction: dir } });
    }
  });

  // Stop all movement on blur
  window.addEventListener("blur", () => {
    for (const dir of heldDirections) {
      client.send({ type: "input_stop", data: { direction: dir } });
    }
    heldDirections.clear();
  });

  // --- Render loop with client-side prediction ---
  // Runs every frame via requestAnimationFrame. Applies the same physics
  // as the server to the local player so movement feels instant. The
  // server remains authoritative — see reconciliation in the player_update
  // handler above.
  let lastFrameTime = performance.now();

  function renderLoop(now: number) {
    const dt = (now - lastFrameTime) / 1000;
    lastFrameTime = now;

    if (gameState && selfId) {
      const self = gameState.players.find((p) => p.id === selfId);
      if (self && self.state !== "conversing") {
        // Client-side prediction: apply same physics as server
        const { ix, iy } = getHeldDirectionVector(heldDirections);
        if (ix !== 0 || iy !== 0) {
          const predicted = predictLocalPlayerStep({
            player: {
              id: self.id,
              x: self.x,
              y: self.y,
              orientation: self.orientation,
              radius: self.radius ?? PLAYER_RADIUS,
              inputSpeed: self.inputSpeed ?? MOVE_SPEED,
            },
            otherPlayers: gameState.players
              .filter((player) => player.id !== self.id)
              .map((player) => ({
                id: player.id,
                x: player.x,
                y: player.y,
                radius: player.radius ?? PLAYER_RADIUS,
              })),
            heldDirections,
            mapTiles,
            dt,
          });
          self.x = predicted.x;
          self.y = predicted.y;
          self.orientation = predicted.orientation;
        }
      }
    }

    if (gameState) {
      renderer.updatePlayers(gameState.players);
    }
    requestAnimationFrame(renderLoop);
  }
  requestAnimationFrame(renderLoop);
}

start().catch(console.error);
