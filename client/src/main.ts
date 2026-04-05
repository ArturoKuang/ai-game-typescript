/**
 * Client entry point — orchestrates rendering, networking, input, and prediction.
 *
 * ## Startup
 * 1. Initialize PixiJS renderer.
 * 2. Fetch the tile map from `/data/map.json` (fallback to blank bordered map).
 * 3. Connect WebSocket to the game server.
 * 4. Register input handlers (WASD, click-to-move, chat, conversation actions).
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
import {
  appendConversationMessage,
  reconcileDebugConversationSnapshots,
  upsertConversationSnapshot,
} from "./conversationDebugState.js";
import type {
  Conversation,
  FullGameState,
  MoveDirection,
  NpcAutonomyDebugState,
  Player,
  PlayerSurvivalData,
  TileType,
  WorldEntity,
} from "./types.js";
import { UI } from "./ui.js";

const DEBUG_CONVERSATION_POLL_MS = 750;
const DEBUG_AUTONOMY_POLL_MS = 750;
const DEBUG_CONVERSATION_SECTIONS: Array<{
  key: Conversation["state"];
  title: string;
  filter: (conversation: Conversation) => boolean;
}> = [
  {
    key: "active",
    title: "Active",
    filter: (conversation) => conversation.state !== "ended",
  },
  {
    key: "ended",
    title: "Ended",
    filter: (conversation) => conversation.state === "ended",
  },
];

// State
let gameState: FullGameState | null = null;
let selfId: string | null = null;
let mapLoaded = false;
let mapTiles: TileType[][] | null = null;
let debugModeEnabled = false;
let debugConversationPollId: number | null = null;
let debugConversationFetchInFlight = false;
let debugConversationError: string | null = null;
let debugConversations: Conversation[] = [];
let debugAutonomyModeEnabled = false;
let debugAutonomyPollId: number | null = null;
let debugAutonomyFetchInFlight = false;
let debugAutonomyError: string | null = null;
let debugAutonomyStates: Record<string, NpcAutonomyDebugState> = {};
const playerSurvival = new Map<string, PlayerSurvivalData>();

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

// Init
const canvas = document.getElementById("game-canvas") as HTMLCanvasElement;
const renderer = new GameRenderer(canvas);
const client = new GameClient();
const ui = new UI();

async function start() {
  await renderer.init();
  ui.renderConversationDebug({
    enabled: false,
    summary: "Debug mode off",
    sections: [],
    menuStatus: "Off",
    menuDetail: "Turn this on to inspect NPC and player conversations.",
    menuTone: "off",
  });
  ui.renderAutonomyDebug({
    enabled: false,
    summary: "Debug mode off",
    cards: [],
    menuStatus: "Off",
    menuDetail: "Turn this on to inspect live autonomy state.",
    menuTone: "off",
  });

  // Load map tiles eagerly
  try {
    const mapRes = await fetch("/data/map.json");
    if (mapRes.ok) {
      const mapData = await mapRes.json();
      const actRes = await fetch("/api/debug/activities");
      const activities = actRes.ok ? await actRes.json() : [];
      renderer.renderMap(mapData.tiles, activities);
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
      renderer.renderMap(tiles, []);
      mapLoaded = true;
    }
  }

  // Connect WebSocket
  client.connect();

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

  function sortDebugConversations(
    left: Conversation,
    right: Conversation,
  ): number {
    if (left.startedTick !== right.startedTick) {
      return right.startedTick - left.startedTick;
    }
    return right.id - left.id;
  }

  function formatConversationEndReason(
    reason: Conversation["endedReason"],
  ): string | null {
    return reason ? reason.replaceAll("_", " ") : null;
  }

  function getDebugParticipant(playerId: string): {
    label: string;
    role: "npc" | "human" | "unknown";
  } {
    const player = getPlayer(playerId);
    if (!player) {
      return { label: playerId, role: "unknown" };
    }
    return {
      label: `${player.isNpc ? "NPC" : "Player"}: ${player.name}`,
      role: player.isNpc ? "npc" : "human",
    };
  }

  function buildDebugConversationLines(conversation: Conversation): Array<{
    speaker?: string;
    content: string;
    kind: "message" | "system";
  }> {
    if (conversation.messages.length > 0) {
      return conversation.messages.map((message) => ({
        speaker: getPlayerName(message.playerId),
        content: message.content,
        kind: "message" as const,
      }));
    }

    if (conversation.state === "walking") {
      return [
        {
          content: "Participants are walking to their meeting point.",
          kind: "system",
        },
      ];
    }

    if (conversation.state === "invited") {
      return [
        {
          content: "Invitation sent. Waiting for the invitee to respond.",
          kind: "system",
        },
      ];
    }

    if (conversation.state === "ended") {
      const endedReason = formatConversationEndReason(conversation.endedReason);
      return [
        {
          content: endedReason
            ? `Conversation ended: ${endedReason}.`
            : "Conversation ended without any transcript messages.",
          kind: "system",
        },
      ];
    }

    return [
      {
        content: "Conversation is active but no messages have been sent yet.",
        kind: "system",
      },
    ];
  }

  function formatAutonomyGoal(goalId: string): string {
    return goalId.replaceAll("_", " ");
  }

  function formatAutonomyPlanSource(
    state: NpcAutonomyDebugState,
  ): {
    label: string;
    tone: "scripted" | "llm" | "emergency" | "idle";
  } {
    if (!state.currentPlan) {
      return { label: "Idle", tone: "idle" };
    }
    if (state.currentPlan.source === "llm") {
      return { label: "LLM plan", tone: "llm" };
    }
    if (state.currentPlan.source === "emergency") {
      return { label: "Emergency plan", tone: "emergency" };
    }
    return { label: "Scripted plan", tone: "scripted" };
  }

  function formatAutonomyStepDetail(
    step: NonNullable<NpcAutonomyDebugState["currentPlan"]>["steps"][number],
  ): string | undefined {
    if (!step.targetPosition) {
      return undefined;
    }
    return `target (${step.targetPosition.x}, ${step.targetPosition.y})`;
  }

  function sortAutonomyCards(
    left: NpcAutonomyDebugState,
    right: NpcAutonomyDebugState,
  ): number {
    const leftPriority = left.currentExecution ? 0 : left.currentPlan ? 1 : 2;
    const rightPriority = right.currentExecution ? 0 : right.currentPlan ? 1 : 2;
    if (leftPriority !== rightPriority) {
      return leftPriority - rightPriority;
    }
    return getPlayerName(left.npcId).localeCompare(getPlayerName(right.npcId));
  }

  function refreshConversationDebugUi(): void {
    const liveCount = debugConversations.filter(
      (conversation) => conversation.state !== "ended",
    ).length;
    const endedCount = debugConversations.length - liveCount;
    const liveParticipantIds = new Set<string>();

    for (const conversation of debugConversations) {
      if (conversation.state === "ended") continue;
      liveParticipantIds.add(conversation.player1Id);
      liveParticipantIds.add(conversation.player2Id);
    }

    ui.renderConversationDebug({
      enabled: debugModeEnabled,
      summary: debugConversationError
        ? debugConversationError
        : `${liveCount} live conversation${
            liveCount === 1 ? "" : "s"
          } across ${liveParticipantIds.size} participant${
            liveParticipantIds.size === 1 ? "" : "s"
          }${endedCount > 0 ? ` • ${endedCount} ended` : ""}`,
      menuStatus: debugConversationError
        ? "Error"
        : debugModeEnabled
          ? "Live"
          : "Off",
      menuDetail: debugConversationError
        ? debugConversationError
        : debugModeEnabled
          ? `${liveCount} active • ${endedCount} ended`
          : "Turn this on to inspect NPC and player conversations.",
      menuTone: debugConversationError
        ? "error"
        : debugModeEnabled
          ? "live"
          : "off",
      sections: DEBUG_CONVERSATION_SECTIONS.map((section) => {
        const conversations = debugConversations
          .filter(section.filter)
          .sort(sortDebugConversations);

        return {
          key: section.key,
          title: section.title,
          summary: `${conversations.length} conversation${
            conversations.length === 1 ? "" : "s"
          }`,
          cards: conversations.map((conversation) => {
            const endedReason = formatConversationEndReason(
              conversation.endedReason,
            );
            const metaParts = [
              `started t${conversation.startedTick}`,
              `${conversation.messages.length} message${
                conversation.messages.length === 1 ? "" : "s"
              }`,
            ];

            if (conversation.endedTick !== undefined) {
              metaParts.push(`ended t${conversation.endedTick}`);
            }
            if (endedReason) {
              metaParts.push(`reason: ${endedReason}`);
            }

            return {
              id: conversation.id,
              state: conversation.state,
              title: `${getPlayerName(
                conversation.player1Id,
              )} <-> ${getPlayerName(conversation.player2Id)}`,
              meta: metaParts.join(" • "),
              participants: [
                getDebugParticipant(conversation.player1Id),
                getDebugParticipant(conversation.player2Id),
              ],
              lines: buildDebugConversationLines(conversation),
            };
          }),
        };
      }),
    });
  }

  async function fetchDebugConversations(): Promise<void> {
    if (!debugModeEnabled || debugConversationFetchInFlight) {
      return;
    }

    debugConversationFetchInFlight = true;
    try {
      const response = await fetch("/api/debug/conversations");
      if (!response.ok) {
        throw new Error(`Conversation debug API returned ${response.status}`);
      }
      debugConversations = reconcileDebugConversationSnapshots({
        current: debugConversations,
        fetched: (await response.json()) as Conversation[],
        localConversations: gameState?.conversations ?? [],
      });
      debugConversationError = null;
    } catch (error) {
      debugConversationError =
        error instanceof Error
          ? error.message
          : "Conversation debug API unavailable";
    } finally {
      debugConversationFetchInFlight = false;
      refreshConversationDebugUi();
    }
  }

  function stopDebugConversationPolling(): void {
    if (debugConversationPollId !== null) {
      window.clearInterval(debugConversationPollId);
      debugConversationPollId = null;
    }
  }

  function setDebugConversationMode(enabled: boolean): void {
    debugModeEnabled = enabled;
    stopDebugConversationPolling();

    if (!enabled) {
      debugConversationError = null;
      debugConversations = [];
      refreshConversationDebugUi();
      return;
    }

    debugConversationError = null;
    refreshConversationDebugUi();
    void fetchDebugConversations();
    debugConversationPollId = window.setInterval(() => {
      void fetchDebugConversations();
    }, DEBUG_CONVERSATION_POLL_MS);
  }

  function refreshAutonomyDebugUi(): void {
    const states = Object.values(debugAutonomyStates).sort(sortAutonomyCards);
    const executingCount = states.filter((state) => state.currentExecution).length;
    const llmPlanCount = states.filter(
      (state) => state.currentPlan?.llmGenerated,
    ).length;

    ui.renderAutonomyDebug({
      enabled: debugAutonomyModeEnabled,
      summary: debugAutonomyError
        ? debugAutonomyError
        : `${states.length} NPC${states.length === 1 ? "" : "s"} • ${executingCount} executing • ${llmPlanCount} LLM plan${
            llmPlanCount === 1 ? "" : "s"
          }`,
      menuStatus: debugAutonomyError
        ? "Error"
        : debugAutonomyModeEnabled
          ? "Live"
          : "Off",
      menuDetail: debugAutonomyError
        ? debugAutonomyError
        : debugAutonomyModeEnabled
          ? `${states.length} NPC${states.length === 1 ? "" : "s"} • ${executingCount} executing • ${llmPlanCount} LLM`
          : "Turn this on to inspect live autonomy state.",
      menuTone: debugAutonomyError
        ? "error"
        : debugAutonomyModeEnabled
          ? "live"
          : "off",
      cards: states.map((state) => {
        const source = formatAutonomyPlanSource(state);
        const executionLabel = state.currentExecution
          ? `Executing ${state.currentExecution.actionLabel} (${state.currentExecution.status}) since t${state.currentExecution.startedAtTick}`
          : state.currentPlan
            ? "Waiting to start next action"
            : "No action executing";
        const metaParts = [
          state.currentPlan
            ? `goal: ${formatAutonomyGoal(state.currentPlan.goalId)}`
            : "no active plan",
          `${state.consecutivePlanFailures} failure${
            state.consecutivePlanFailures === 1 ? "" : "s"
          }`,
        ];

        if (state.goalSelectionInFlight) {
          metaParts.push("LLM selection pending");
        }

        return {
          npcId: state.npcId,
          title: getPlayerName(state.npcId),
          sourceLabel: source.label,
          sourceTone: source.tone,
          goalLabel: state.currentPlan
            ? `Plan: ${formatAutonomyGoal(state.currentPlan.goalId)}`
            : "Plan: idle",
          executionLabel,
          meta: metaParts.join(" • "),
          steps:
            state.currentPlan?.steps.map((step) => ({
              label: `${step.index + 1}. ${step.actionLabel}`,
              detail: formatAutonomyStepDetail(step),
              isCurrent: step.isCurrent,
            })) ?? [],
        };
      }),
    });
  }

  async function fetchAutonomyDebugState(): Promise<void> {
    if (!debugAutonomyModeEnabled || debugAutonomyFetchInFlight) {
      return;
    }

    debugAutonomyFetchInFlight = true;
    try {
      const response = await fetch("/api/debug/autonomy/state");
      if (!response.ok) {
        throw new Error(`Autonomy debug API returned ${response.status}`);
      }
      debugAutonomyStates = (await response.json()) as Record<
        string,
        NpcAutonomyDebugState
      >;
      debugAutonomyError = null;
    } catch (error) {
      debugAutonomyError =
        error instanceof Error
          ? error.message
          : "Autonomy debug API unavailable";
    } finally {
      debugAutonomyFetchInFlight = false;
      refreshAutonomyDebugUi();
    }
  }

  function stopAutonomyDebugPolling(): void {
    if (debugAutonomyPollId !== null) {
      window.clearInterval(debugAutonomyPollId);
      debugAutonomyPollId = null;
    }
  }

  function setAutonomyDebugMode(enabled: boolean): void {
    debugAutonomyModeEnabled = enabled;
    stopAutonomyDebugPolling();

    if (!enabled) {
      debugAutonomyError = null;
      debugAutonomyStates = {};
      refreshAutonomyDebugUi();
      return;
    }

    debugAutonomyError = null;
    refreshAutonomyDebugUi();
    void fetchAutonomyDebugState();
    debugAutonomyPollId = window.setInterval(() => {
      void fetchAutonomyDebugState();
    }, DEBUG_AUTONOMY_POLL_MS);
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
    const selfBusy = Boolean(currentConversation);
    const occupiedPlayerIds = new Set<string>();

    for (const conversation of gameState.conversations) {
      if (conversation.state === "ended") continue;
      occupiedPlayerIds.add(conversation.player1Id);
      occupiedPlayerIds.add(conversation.player2Id);
    }

    for (const player of gameState.players) {
      if (!selfId || player.id === selfId) continue;
      if (selfBusy) continue;
      if (occupiedPlayerIds.has(player.id)) continue;
      if (player.state === "conversing") continue;
      talkablePlayerIds.add(player.id);
    }

    ui.updatePlayerList(gameState.players, talkablePlayerIds);
    refreshConversationDebugUi();
    refreshAutonomyDebugUi();

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
        debugConversations = reconcileDebugConversationSnapshots({
          current: debugConversations,
          fetched: [],
          localConversations: gameState.conversations,
        });
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
        if (!selfId && !msg.data.isNpc) {
          selfId = msg.data.id;
          renderer.setSelfId(selfId);
          ui.setSelfId(selfId);
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
        if (name) ui.addChatMessage("", `${name} left`, true);
        playerSurvival.delete(msg.data.id);
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
        debugConversations = upsertConversationSnapshot(
          debugConversations,
          msg.data,
        ).conversations;
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
        debugConversations = appendConversationMessage(
          debugConversations,
          msg.data,
        );
        const sender = gameState?.players.find(
          (p) => p.id === msg.data.playerId,
        );
        const senderName = sender?.name ?? msg.data.playerId;
        ui.addChatMessage(senderName, msg.data.content);
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
  joinBtn.addEventListener("click", () => {
    const name = nameInput.value.trim();
    if (!name) return;
    client.send({ type: "join", data: { name } });
    joinBtn.setAttribute("disabled", "true");
    nameInput.setAttribute("disabled", "true");
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

  ui.onConversationDebugModeChange((enabled) => {
    setDebugConversationMode(enabled);
  });

  ui.onAutonomyDebugModeChange((enabled) => {
    setAutonomyDebugMode(enabled);
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

  // Click to move (pathfinding)
  canvas.addEventListener("click", (e) => {
    if (!selfId) return;
    const tile = renderer.screenToTile(e.clientX, e.clientY);
    if (tile) {
      client.send({ type: "move", data: { x: tile.x, y: tile.y } });
    }
  });

  function isInputFocused(): boolean {
    const tag = document.activeElement?.tagName;
    return tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT";
  }

  window.addEventListener("keydown", (e) => {
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
