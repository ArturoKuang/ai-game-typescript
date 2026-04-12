import "./debugDashboard.css";

import {
  getRenderableConversations,
  getVisibleRoomParticipants,
} from "./conversationRooms.js";
import { deriveDashboardAlerts } from "./debugDashboardAlerts.js";
import {
  buildScreenshotUrl,
  refreshScenarioList as fetchScenarioList,
  handleSystemCommand as runSystemCommand,
  handleSystemFormSubmit as runSystemFormSubmit,
} from "./debugDashboardController.js";
import { formatAge, formatTick } from "./debugDashboardFormatting.js";
import {
  type DashboardInteractionBindings,
  bindDashboardInteractions,
} from "./debugDashboardInteractions.js";
import { applyDashboardMessage } from "./debugDashboardMessages.js";
import {
  buildParticipantDebugData,
  getVisibleNpcStates,
} from "./debugDashboardModel.js";
import {
  renderActivityPanel,
  renderDashboardChrome,
  renderSystemPanel,
} from "./debugDashboardPanels.js";
import { createDashboardRenderScheduler } from "./debugDashboardScheduler.js";
import type {
  CommandStatusKind,
  DashboardAlert,
  DashboardState,
  FrozenActivityState,
} from "./debugDashboardTypes.js";
import {
  buildConversationCardHtml,
  buildConversationDetailHtml,
  buildNpcCardHtml,
  buildNpcDetailHtml,
} from "./debugDashboardViews.js";
import { GameClient } from "./network.js";
import type {
  Conversation,
  ConversationRoom,
  DebugActionDefinition,
  DebugFeedEvent,
  NpcAutonomyDebugPlan,
  NpcAutonomyDebugState,
  Player,
  PublicPlayer,
  ServerMessage,
} from "./types.js";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const MAX_EVENTS = 400;
const RENDER_THROTTLE_MS = 200;

type ConversationFilter = "all" | "active" | "ended";

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------

const collator = new Intl.Collator(undefined, {
  numeric: true,
  sensitivity: "base",
});
const client = new GameClient();

const state: DashboardState = {
  connected: false,
  tick: 0,
  players: new Map(),
  conversations: [],
  conversationRooms: [],
  autonomy: new Map(),
  events: [],
  system: null,
  selectedConversationId: null,
  selectedNpcId: null,
  activeTab: "conversations",
  conversationFilter: "all",
  activitySeverityFilter: "all",
  activitySearch: "",
  activityPaused: false,
  frozenActivity: null,
  pinnedItems: new Set(),
  lastMessageAt: null,
  disconnectedAt: null,
  reconnectCount: 0,
  debugToken: loadInitialDebugToken(),
  commandStatus: { kind: "idle", message: "", at: null },
  screenshotUrl: null,
  scenarios: [],
};

let nextSyntheticEventId = -1;

// Stash the last known plan per NPC so idle NPCs still show what they just did
const lastKnownPlans = new Map<string, NpcAutonomyDebugPlan>();

// Action definitions from the server (populated on bootstrap)
let actionDefs: Record<string, DebugActionDefinition> = {};

// Track NPCs that have died (player_left) so we keep their cards
const deadNpcIds = new Set<string>();
// Cache NPC names so dead NPCs still show their name
const npcNameCache = new Map<string, string>();

// Currently expanded actions (keyed by unique step key, not just actionId)
const expandedActions = new Set<string>();

// Cache last rendered HTML per section to avoid DOM thrashing / blinking
const htmlCache = new Map<string, string>();

/** Only update innerHTML if content actually changed. Returns true if DOM was updated. */
function setHtml(element: HTMLElement, key: string, html: string): boolean {
  if (htmlCache.get(key) === html) return false;
  htmlCache.set(key, html);
  element.innerHTML = html;
  return true;
}

// ---------------------------------------------------------------------------
// DOM references
// ---------------------------------------------------------------------------

function el<T extends HTMLElement>(id: string): T {
  const element = document.getElementById(id);
  if (!element) throw new Error(`Missing #${id}`);
  return element as T;
}

const dom = {
  connStatus: el<HTMLSpanElement>("conn-status"),
  connMeta: el<HTMLSpanElement>("conn-meta"),
  staleBanner: el<HTMLDivElement>("stale-banner"),
  tickDisplay: el<HTMLSpanElement>("tick-display"),
  badgeConvos: el<HTMLSpanElement>("badge-convos"),
  badgeNpcs: el<HTMLSpanElement>("badge-npcs"),
  badgeActivity: el<HTMLSpanElement>("badge-activity"),
  badgeSystem: el<HTMLSpanElement>("badge-system"),
  convoSearch: el<HTMLInputElement>("convo-search"),
  convoFilters: el<HTMLDivElement>("convo-filters"),
  convoList: el<HTMLDivElement>("convo-list"),
  convoDetail: el<HTMLDivElement>("convo-detail"),
  npcSearch: el<HTMLInputElement>("npc-search"),
  npcList: el<HTMLDivElement>("npc-list"),
  npcDetail: el<HTMLDivElement>("npc-detail"),
  activitySearch: el<HTMLInputElement>("activity-search"),
  activityFilters: el<HTMLDivElement>("activity-filters"),
  activityPause: el<HTMLButtonElement>("activity-pause"),
  activityClearPins: el<HTMLButtonElement>("activity-clear-pins"),
  activityContent: el<HTMLDivElement>("activity-content"),
  systemContent: el<HTMLDivElement>("system-content"),
};

// ---------------------------------------------------------------------------
// Utilities
// ---------------------------------------------------------------------------

function loadInitialDebugToken(): string | null {
  const params = new URLSearchParams(window.location.search);
  const tokenFromUrl = params.get("debugToken")?.trim() || null;
  if (tokenFromUrl) {
    window.localStorage.setItem("ai-town-debug-token", tokenFromUrl);
    return tokenFromUrl;
  }
  return window.localStorage.getItem("ai-town-debug-token")?.trim() || null;
}

function getPlayer(playerId: string): PublicPlayer | undefined {
  return state.players.get(playerId);
}

function getPlayerLabel(playerId: string): string {
  return (
    getPlayer(playerId)?.name ??
    state.autonomy.get(playerId)?.name ??
    npcNameCache.get(playerId) ??
    playerId
  );
}

// ---------------------------------------------------------------------------
// Conversation helpers
// ---------------------------------------------------------------------------

function getParticipantData(conversation: Conversation) {
  return [conversation.player1Id, conversation.player2Id].map((playerId) =>
    buildParticipantDebugData({
      playerId,
      players: state.players,
      autonomy: state.autonomy,
      npcNameCache,
    }),
  );
}

function getConversationRoom(
  conversationId: number,
): ConversationRoom | undefined {
  return state.conversationRooms.find((room) => room.id === conversationId);
}

function getConversationParticipantLabel(c: Conversation): string {
  return getParticipantData(c)
    .map((p) => p.name)
    .join(" \u2194 ");
}

function getConversationNpcLabel(c: Conversation): string {
  return getParticipantData(c)
    .filter((p) => p.isNpc)
    .map((p) => p.name)
    .join(", ");
}

function getConversationLastActivityTick(c: Conversation): number {
  const last = c.messages[c.messages.length - 1];
  return last?.tick ?? c.endedTick ?? c.startedTick;
}

function getConversationDurationTicks(c: Conversation): number {
  return Math.max(0, (c.endedTick ?? state.tick) - c.startedTick);
}

function getConversationTone(c: Conversation): string {
  if (c.state === "ended") return "ended";
  if (c.state === "active") return "active";
  return "warning";
}

function getConversationWaitingLabel(c: Conversation): string | null {
  const waiting = [c.player1Id, c.player2Id]
    .map((id) => getPlayer(id))
    .find(
      (p) => p?.isNpc && p.currentConvoId === c.id && p.isWaitingForResponse,
    );
  return waiting ? `${waiting.name} thinking` : null;
}

function getConversationSearchBlob(c: Conversation): string {
  const room = getConversationRoom(c.id);
  const roster = room
    ? getVisibleRoomParticipants(room)
        .map(
          (participant) =>
            `${getPlayerLabel(participant.playerId)} ${participant.inviteStatus} ${participant.presenceStatus}`,
        )
        .join(" ")
    : "";
  return `${c.id} ${getParticipantData(c)
    .map((p) => p.name)
    .join(" ")} ${c.state} ${c.summary ?? ""} ${roster}`.toLowerCase();
}

function matchesConversationFilter(
  c: Conversation,
  filter: ConversationFilter,
): boolean {
  if (filter === "all") return true;
  if (filter === "active") return c.state !== "ended";
  return c.state === "ended";
}

// ---------------------------------------------------------------------------
// NPC helpers
// ---------------------------------------------------------------------------

function getNpcSearchBlob(s: NpcAutonomyDebugState): string {
  const p = getPlayer(s.npcId);
  const goal = s.currentPlan?.goalId ?? "";
  const action = s.currentExecution?.actionLabel ?? "";
  const death = s.death?.message ?? "";
  return `${s.npcId} ${s.name} ${p?.name ?? ""} ${goal} ${action} ${death}`.toLowerCase();
}

function getDerivedAlerts(): DashboardAlert[] {
  return deriveDashboardAlerts({
    tick: state.tick,
    conversations: state.conversations,
    autonomy: state.autonomy.values(),
    players: state.players,
    deadNpcIds,
    getConversationParticipantLabel,
    getPlayerLabel,
  });
}

// ---------------------------------------------------------------------------
// Event management
// ---------------------------------------------------------------------------

function pushEvent(event: DebugFeedEvent): void {
  const idx = state.events.findIndex((e) => e.id === event.id);
  if (idx >= 0) {
    state.events[idx] = event;
  } else {
    state.events.push(event);
    if (state.events.length > MAX_EVENTS) {
      state.events.splice(0, state.events.length - MAX_EVENTS);
    }
  }
}

function getSortedEvents(): DebugFeedEvent[] {
  return [...state.events].sort((a, b) =>
    b.tick !== a.tick ? b.tick - a.tick : b.id - a.id,
  );
}

function syncPlayers(players: readonly Player[]): void {
  state.players = new Map(players.map((p) => [p.id, { ...p }]));
  for (const p of players) {
    if (p.isNpc) npcNameCache.set(p.id, p.name);
  }
}

// ---------------------------------------------------------------------------
// Render scheduling
// ---------------------------------------------------------------------------

const renderScheduler = createDashboardRenderScheduler({
  throttleMs: RENDER_THROTTLE_MS,
  render,
});

function scheduleRender(immediate = false): void {
  renderScheduler.schedule(immediate);
}

// ---------------------------------------------------------------------------
// Render: Conversations
// ---------------------------------------------------------------------------

function renderConversations(): void {
  const renderableConversations = getRenderableConversations({
    rooms: state.conversationRooms,
    conversations: state.conversations,
  });
  const search = dom.convoSearch.value.trim().toLowerCase();
  const filtered = renderableConversations
    .filter((c) => !search || getConversationSearchBlob(c).includes(search))
    .filter((c) => matchesConversationFilter(c, state.conversationFilter))
    .sort(
      (a, b) =>
        getConversationLastActivityTick(b) -
          getConversationLastActivityTick(a) || b.id - a.id,
    );

  // Clear selection only when the conversation no longer exists in state
  if (
    state.selectedConversationId !== null &&
    !renderableConversations.some((c) => c.id === state.selectedConversationId)
  ) {
    state.selectedConversationId = null;
  }

  // Group into active / ended
  const active = filtered.filter((c) => c.state !== "ended");
  const ended = filtered.filter((c) => c.state === "ended");

  let listHtml = "";

  if (active.length > 0) {
    listHtml += `<div class="list-group-header">Active (${active.length})</div>`;
    listHtml += active.map((c) => renderConvoCard(c)).join("");
  }
  if (ended.length > 0) {
    listHtml += `<div class="list-group-header">Ended (${ended.length})</div>`;
    listHtml += ended.map((c) => renderConvoCard(c)).join("");
  }

  if (filtered.length === 0) {
    listHtml =
      '<div class="empty-state">No conversations match your search.</div>';
  }

  setHtml(dom.convoList, "convo-list", listHtml);
  interactions.scrollSelectedCard(dom.convoList, "[data-convo-id].selected");
  renderConvoDetail();
}

function renderConvoCard(c: Conversation): string {
  return buildConversationCardHtml({
    conversation: c,
    room: getConversationRoom(c.id),
    selected: state.selectedConversationId === c.id,
    participantLabel: getConversationParticipantLabel(c),
    tone: getConversationTone(c),
    waitingLabel: getConversationWaitingLabel(c),
    durationTicks: getConversationDurationTicks(c),
    getPlayerLabel,
  });
}

function renderConvoDetail(): void {
  const c = getRenderableConversations({
    rooms: state.conversationRooms,
    conversations: state.conversations,
  }).find((cv) => cv.id === state.selectedConversationId);
  if (!c) {
    setHtml(
      dom.convoDetail,
      "convo-detail",
      '<div class="detail-empty">Select a conversation</div>',
    );
    return;
  }

  const participants = getParticipantData(c);
  const waiting = getConversationWaitingLabel(c);
  const lastActivity = getConversationLastActivityTick(c);
  const room = getConversationRoom(c.id);
  const metrics = [
    { label: "State", value: c.state },
    { label: "Started", value: formatTick(c.startedTick) },
    { label: "Last Activity", value: formatTick(lastActivity) },
    { label: "Duration", value: formatAge(getConversationDurationTicks(c)) },
    { label: "Messages", value: String(c.messages.length) },
    { label: "Room State", value: room?.state ?? "legacy" },
    {
      label: "Roster",
      value: room ? String(getVisibleRoomParticipants(room).length) : "2",
    },
    {
      label: "Ended",
      value:
        typeof c.endedTick === "number"
          ? `${formatTick(c.endedTick)}${c.endedReason ? ` \u2022 ${c.endedReason.replaceAll("_", " ")}` : ""}`
          : "\u2014",
    },
  ];
  setHtml(
    dom.convoDetail,
    "convo-detail",
    buildConversationDetailHtml({
      conversation: c,
      room,
      participantLabel: getConversationParticipantLabel(c),
      participants,
      tone: getConversationTone(c),
      waitingLabel: waiting,
      metrics,
      summary: c.summary,
      getPlayerLabel,
    }),
  );
}

// ---------------------------------------------------------------------------
// Render: NPCs
// ---------------------------------------------------------------------------

function renderNpcs(
  stalledNpcIds: ReadonlySet<string>,
  alerts: readonly DashboardAlert[],
): void {
  const search = dom.npcSearch.value.trim().toLowerCase();
  const visibleNpcStates = getVisibleNpcStates({
    autonomy: state.autonomy.values(),
    players: state.players,
    deadNpcIds,
  });

  // Always sort alphabetically for stable ordering
  const filtered = visibleNpcStates
    .filter((s) => !search || getNpcSearchBlob(s).includes(search))
    .sort((a, b) =>
      collator.compare(getPlayerLabel(a.npcId), getPlayerLabel(b.npcId)),
    );

  // Clear selection only when the NPC no longer exists in state
  if (
    state.selectedNpcId &&
    !visibleNpcStates.some((npcState) => npcState.npcId === state.selectedNpcId)
  ) {
    state.selectedNpcId = null;
  }

  let listHtml: string;
  if (filtered.length === 0) {
    listHtml = '<div class="empty-state">No NPCs match your search.</div>';
  } else {
    listHtml = filtered.map((s) => renderNpcCard(s, stalledNpcIds)).join("");
  }

  setHtml(dom.npcList, "npc-list", listHtml);
  interactions.scrollSelectedCard(dom.npcList, "[data-npc-id].selected");
  renderNpcDetail(stalledNpcIds, alerts);
}

function renderNpcCard(
  s: NpcAutonomyDebugState,
  stalledNpcIds: ReadonlySet<string>,
): string {
  return buildNpcCardHtml({
    npcState: s,
    player: getPlayer(s.npcId),
    selected: state.selectedNpcId === s.npcId,
    stalled: stalledNpcIds.has(s.npcId),
    isDead: s.isDead || deadNpcIds.has(s.npcId),
    lastKnownPlan: lastKnownPlans.get(s.npcId) ?? null,
    fallbackName:
      s.name ??
      getPlayer(s.npcId)?.name ??
      npcNameCache.get(s.npcId) ??
      s.npcId,
  });
}

function renderNpcDetail(
  stalledNpcIds: ReadonlySet<string>,
  alerts: readonly DashboardAlert[],
): void {
  const s = state.selectedNpcId
    ? state.autonomy.get(state.selectedNpcId)
    : undefined;
  if (!s) {
    interactions.resetNpcDetailRenderState();
    setHtml(
      dom.npcDetail,
      "npc-detail",
      '<div class="detail-empty">Select an NPC</div>',
    );
    return;
  }

  if (interactions.shouldDeferNpcDetailRender(s.npcId)) {
    interactions.markNpcDetailRefreshPending();
    return;
  }

  const player = getPlayer(s.npcId);
  const isDead = s.isDead || deadNpcIds.has(s.npcId);
  setHtml(
    dom.npcDetail,
    "npc-detail",
    buildNpcDetailHtml({
      npcState: s,
      player,
      tick: state.tick,
      stalled: stalledNpcIds.has(s.npcId),
      isDead,
      alerts,
      lastKnownPlan: lastKnownPlans.get(s.npcId) ?? null,
      expandedActions,
      actionDefs,
      title: s.name ?? player?.name ?? s.npcId,
    }),
  );
  interactions.markNpcDetailRendered(s.npcId);
}

// ---------------------------------------------------------------------------
// Render: Activity (alerts + events)
// ---------------------------------------------------------------------------

function getFrozenOrLiveActivity(
  alerts: readonly DashboardAlert[],
): FrozenActivityState {
  if (state.activityPaused && state.frozenActivity) {
    return state.frozenActivity;
  }
  return {
    alerts: [...alerts],
    events: getSortedEvents(),
    capturedAt: Date.now(),
  };
}

function renderActivity(alerts: readonly DashboardAlert[]): void {
  const snapshot = getFrozenOrLiveActivity(alerts);
  renderActivityPanel({
    dom,
    snapshot,
    activityPaused: state.activityPaused,
    activitySeverityFilter: state.activitySeverityFilter,
    activitySearch: state.activitySearch,
    pinnedItems: state.pinnedItems,
    getPlayerLabel,
    focusConversation: interactions.focusConversation,
    focusNpc: interactions.focusNpc,
    scheduleRender,
    setHtml,
  });
}

function renderSystem(alerts: readonly DashboardAlert[]): void {
  const selectedConversation = state.selectedConversationId
    ? getRenderableConversations({
        rooms: state.conversationRooms,
        conversations: state.conversations,
      }).find(
        (conversation) => conversation.id === state.selectedConversationId,
      )
    : undefined;
  renderSystemPanel({
    dom,
    system: state.system,
    connected: state.connected,
    lastMessageAt: state.lastMessageAt,
    reconnectCount: state.reconnectCount,
    alerts,
    selectedNpcId: state.selectedNpcId,
    selectedConversationPlayerIds: selectedConversation
      ? [selectedConversation.player1Id, selectedConversation.player2Id]
      : [],
    players: [...state.players.values()],
    screenshotUrl: state.screenshotUrl,
    scenarios: state.scenarios,
    commandStatus: state.commandStatus,
    tick: state.tick,
    debugToken: state.debugToken,
    autonomyNpcIds: new Set(state.autonomy.keys()),
    focusNpc: interactions.focusNpc,
    handleSystemCommand,
    handleSystemFormSubmit,
    setHtml,
  });
}

function setCommandStatus(kind: CommandStatusKind, message: string): void {
  state.commandStatus = { kind, message, at: Date.now() };
  scheduleRender(true);
}

function refreshScreenshotUrl(clientId?: string): void {
  state.screenshotUrl = buildScreenshotUrl({
    clientId: clientId ?? state.system?.lastScreenshot?.clientId,
    debugToken: state.debugToken,
  });
}

async function refreshScenarioList(): Promise<void> {
  await fetchScenarioList({ state, scheduleRender });
}

async function handleSystemCommand(
  command: string,
  dataset: DOMStringMap,
): Promise<void> {
  await runSystemCommand(
    {
      state,
      client,
      setCommandStatus,
      setScreenshotUrl: (url) => {
        state.screenshotUrl = url;
      },
      refreshScenarioList,
    },
    command,
    dataset,
  );
}

async function handleSystemFormSubmit(form: HTMLFormElement): Promise<void> {
  await runSystemFormSubmit(
    {
      state,
      client,
      setCommandStatus,
      setScreenshotUrl: (url) => {
        state.screenshotUrl = url;
      },
      refreshScenarioList,
    },
    form.id,
    new FormData(form),
  );
}

// ---------------------------------------------------------------------------
// Main render
// ---------------------------------------------------------------------------

function render(): void {
  const alerts = getDerivedAlerts();
  const visibleNpcStates = getVisibleNpcStates({
    autonomy: state.autonomy.values(),
    players: state.players,
    deadNpcIds,
  });
  const stalledNpcIds = new Set(
    alerts.map((a) => a.targetNpcId).filter((id): id is string => Boolean(id)),
  );

  const activeConvos = getRenderableConversations({
    rooms: state.conversationRooms,
    conversations: state.conversations,
  }).filter((c) => c.state !== "ended").length;
  renderDashboardChrome({
    dom,
    connected: state.connected,
    tick: state.tick,
    lastMessageAt: state.lastMessageAt,
    disconnectedAt: state.disconnectedAt,
    reconnectCount: state.reconnectCount,
    activeConversationCount: activeConvos,
    visibleNpcCount: visibleNpcStates.length,
    alerts,
    system: state.system,
  });

  // Only render the visible tab to avoid unnecessary DOM work
  switch (state.activeTab) {
    case "conversations":
      renderConversations();
      break;
    case "npcs":
      renderNpcs(stalledNpcIds, alerts);
      break;
    case "activity":
      renderActivity(alerts);
      break;
    case "system":
      renderSystem(alerts);
      break;
  }
}

const interactions: DashboardInteractionBindings = bindDashboardInteractions({
  document,
  dom,
  state,
  expandedActions,
  htmlCache,
  scheduleRender,
  refreshScenarioList,
  getDerivedAlerts,
  getSortedEvents,
});

// ---------------------------------------------------------------------------
// WebSocket
// ---------------------------------------------------------------------------

function handleMessage(message: ServerMessage): void {
  const result = applyDashboardMessage(
    {
      state,
      deadNpcIds,
      npcNameCache,
      lastKnownPlans,
      expandedActions,
      actionDefs,
      nextSyntheticEventId,
      syncPlayers,
      pushEvent,
      refreshScreenshotUrl,
    },
    message,
  );
  actionDefs = result.actionDefs;
  nextSyntheticEventId = result.nextSyntheticEventId;
  scheduleRender(result.isImmediate);
}

client.onOpen(() => {
  if (state.lastMessageAt !== null || state.disconnectedAt !== null) {
    state.reconnectCount += 1;
  }
  state.connected = true;
  state.disconnectedAt = null;
  client.send({
    type: "subscribe_debug",
    data: state.debugToken ? { token: state.debugToken } : undefined,
  });
  void refreshScenarioList();
  scheduleRender(true);
});

client.onClose(() => {
  state.connected = false;
  state.disconnectedAt = Date.now();
  scheduleRender(true);
});

client.onMessage(handleMessage);
client.connect();
window.setInterval(() => {
  scheduleRender(false);
}, 1000);
render();
