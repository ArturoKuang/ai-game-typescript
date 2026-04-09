import {
  appendConversationMessage,
  upsertConversationSnapshot,
} from "./conversationDebugState.js";
import { GameClient } from "./network.js";
import type {
  Conversation,
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

const ENDED_RECENTLY_WINDOW_TICKS = 300;
const EXECUTION_STUCK_TICKS = 180;
const CONVERSATION_QUIET_TICKS = 180;
const INVITE_STUCK_TICKS = 120;
const GOAL_SELECTION_STUCK_TICKS = 160;
const PLAN_FAILURE_ALERT_THRESHOLD = 2;
const CRITICAL_NEED_THRESHOLD = 15;
const DANGER_NEED_THRESHOLD = 8;
const MAX_EVENTS = 400;

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type ConversationFilter = "all" | "active" | "ended";
type TabId = "conversations" | "npcs" | "activity";
type AlertSeverity = "warning" | "danger";

interface DashboardAlert {
  id: string;
  severity: AlertSeverity;
  title: string;
  message: string;
  ageTicks: number;
  targetConversationId?: number;
  targetNpcId?: string;
}

interface PlanHistoryEntry {
  goalId: string;
  source: string;
  startedTick: number;
  endedTick: number | null;
  outcome: "running" | "completed" | "failed" | "interrupted";
  failReason?: string;
  message: string;
  steps: NpcAutonomyDebugPlan["steps"];
  reasoning?: string;
}

const MAX_PLAN_HISTORY = 30;

interface DashboardState {
  connected: boolean;
  tick: number;
  players: Map<string, PublicPlayer>;
  conversations: Conversation[];
  autonomy: Map<string, NpcAutonomyDebugState>;
  events: DebugFeedEvent[];
  selectedConversationId: number | null;
  selectedNpcId: string | null;
  activeTab: TabId;
  conversationFilter: ConversationFilter;
}

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------

const collator = new Intl.Collator(undefined, { numeric: true, sensitivity: "base" });
const client = new GameClient();

const state: DashboardState = {
  connected: false,
  tick: 0,
  players: new Map(),
  conversations: [],
  autonomy: new Map(),
  events: [],
  selectedConversationId: null,
  selectedNpcId: null,
  activeTab: "conversations",
  conversationFilter: "all",
};

let nextSyntheticEventId = -1;
let renderScheduled = false;
const RENDER_THROTTLE_MS = 200;
let lastRenderTime = 0;
let pendingThrottleTimer: ReturnType<typeof setTimeout> | null = null;
let npcDetailHoverLock = false;
let pendingNpcDetailRefresh = false;
let lastRenderedNpcDetailId: string | null = null;
let forceNpcDetailRefresh = false;

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

// Per-NPC plan history built from debug events + plan snapshots
const planHistory = new Map<string, PlanHistoryEntry[]>();

function getOrCreateHistory(npcId: string): PlanHistoryEntry[] {
  let h = planHistory.get(npcId);
  if (!h) { h = []; planHistory.set(npcId, h); }
  return h;
}

function clonePlanSteps(plan?: NpcAutonomyDebugPlan): NpcAutonomyDebugPlan["steps"] {
  return plan?.steps ? [...plan.steps] : [];
}

function resolveHistoryPlan(
  npcId: string,
  plan?: NpcAutonomyDebugPlan,
): NpcAutonomyDebugPlan | undefined {
  return plan ?? lastKnownPlans.get(npcId);
}

function applyPlanSnapshot(
  entry: PlanHistoryEntry,
  plan: NpcAutonomyDebugPlan,
): void {
  entry.goalId = plan.goalId;
  entry.source = plan.source;
  entry.steps = clonePlanSteps(plan);
  entry.reasoning = plan.reasoning;
}

/** Called when we see a plan_started event for an NPC */
function recordPlanStarted(
  npcId: string,
  tick: number,
  message: string,
  eventPlan?: NpcAutonomyDebugPlan,
): void {
  const h = getOrCreateHistory(npcId);
  const plan = resolveHistoryPlan(npcId, eventPlan);
  h.push({
    goalId: plan?.goalId ?? "unknown",
    source: plan?.source ?? "unknown",
    startedTick: tick,
    endedTick: null,
    outcome: "running",
    message,
    steps: clonePlanSteps(plan),
    reasoning: plan?.reasoning,
  });
  if (h.length > MAX_PLAN_HISTORY) h.splice(0, h.length - MAX_PLAN_HISTORY);
}

/** Called when we see plan_cleared or plan_failed */
function recordPlanEnded(
  npcId: string,
  tick: number,
  outcome: "completed" | "failed" | "interrupted",
  message: string,
  failReason?: string,
  eventPlan?: NpcAutonomyDebugPlan,
): void {
  const h = getOrCreateHistory(npcId);
  const plan = resolveHistoryPlan(npcId, eventPlan);
  // Find the most recent running entry to close
  const running = [...h].reverse().find((e) => e.outcome === "running");
  if (running) {
    running.endedTick = tick;
    running.outcome = outcome;
    running.message = message;
    if (failReason) running.failReason = failReason;
    if (plan) applyPlanSnapshot(running, plan);
  } else {
    // No running entry — create a synthetic one
    h.push({
      goalId: plan?.goalId ?? "unknown",
      source: plan?.source ?? "unknown",
      startedTick: tick,
      endedTick: tick,
      outcome,
      message,
      failReason,
      steps: clonePlanSteps(plan),
      reasoning: plan?.reasoning,
    });
    if (h.length > MAX_PLAN_HISTORY) h.splice(0, h.length - MAX_PLAN_HISTORY);
  }
}

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
  tickDisplay: el<HTMLSpanElement>("tick-display"),
  badgeConvos: el<HTMLSpanElement>("badge-convos"),
  badgeNpcs: el<HTMLSpanElement>("badge-npcs"),
  badgeActivity: el<HTMLSpanElement>("badge-activity"),
  convoSearch: el<HTMLInputElement>("convo-search"),
  convoFilters: el<HTMLDivElement>("convo-filters"),
  convoList: el<HTMLDivElement>("convo-list"),
  convoDetail: el<HTMLDivElement>("convo-detail"),
  npcSearch: el<HTMLInputElement>("npc-search"),
  npcList: el<HTMLDivElement>("npc-list"),
  npcDetail: el<HTMLDivElement>("npc-detail"),
  activityContent: el<HTMLDivElement>("activity-content"),
};

// ---------------------------------------------------------------------------
// Utilities
// ---------------------------------------------------------------------------

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function pluralize(count: number, singular: string, plural = `${singular}s`): string {
  return `${count} ${count === 1 ? singular : plural}`;
}

function formatTick(tick?: number | null): string {
  return typeof tick === "number" ? `T${tick}` : "\u2014";
}

function formatAge(ageTicks: number): string {
  return pluralize(ageTicks, "tick");
}

function formatPoint(player: PublicPlayer | undefined): string {
  if (!player) return "unknown";
  return `${Math.round(player.x)}, ${Math.round(player.y)}`;
}

function formatNpcPoint(s: NpcAutonomyDebugState, player: PublicPlayer | undefined): string {
  if (player) {
    return formatPoint(player);
  }
  if (s.lastPosition) {
    return `${Math.round(s.lastPosition.x)}, ${Math.round(s.lastPosition.y)}`;
  }
  return "unknown";
}

function getPlayer(playerId: string): PublicPlayer | undefined {
  return state.players.get(playerId);
}

function getPlayerLabel(playerId: string): string {
  return getPlayer(playerId)?.name
    ?? state.autonomy.get(playerId)?.name
    ?? npcNameCache.get(playerId)
    ?? playerId;
}

function getNpcDeathSummary(s: NpcAutonomyDebugState): string {
  if (!s.death) {
    return "Cause unknown.";
  }
  if (s.death.cause === "survival" && s.death.depletedNeed) {
    return `${s.death.depletedNeed} reached 0.`;
  }
  if (s.death.message) {
    return s.death.message;
  }
  if (s.death.cause) {
    return s.death.cause.replaceAll("_", " ");
  }
  return "Cause unknown.";
}

// ---------------------------------------------------------------------------
// Conversation helpers
// ---------------------------------------------------------------------------

function getParticipantData(conversation: Conversation) {
  return [conversation.player1Id, conversation.player2Id].map((id) => {
    const p = getPlayer(id);
    return { id, name: p?.name ?? id, isNpc: p?.isNpc ?? false };
  });
}

function getConversationParticipantLabel(c: Conversation): string {
  return getParticipantData(c).map((p) => p.name).join(" \u2194 ");
}

function getConversationNpcLabel(c: Conversation): string {
  return getParticipantData(c).filter((p) => p.isNpc).map((p) => p.name).join(", ");
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
    .find((p) => p?.isNpc && p.currentConvoId === c.id && p.isWaitingForResponse);
  return waiting ? `${waiting.name} thinking` : null;
}

function getConversationSearchBlob(c: Conversation): string {
  return `${c.id} ${getParticipantData(c).map((p) => p.name).join(" ")} ${c.state}`.toLowerCase();
}

function matchesConversationFilter(c: Conversation, filter: ConversationFilter): boolean {
  if (filter === "all") return true;
  if (filter === "active") return c.state !== "ended";
  return c.state === "ended";
}

// ---------------------------------------------------------------------------
// NPC helpers
// ---------------------------------------------------------------------------

function getLowestNeed(s: NpcAutonomyDebugState): number {
  return Math.min(s.needs.health, s.needs.food, s.needs.water, s.needs.social);
}

function getNpcSearchBlob(s: NpcAutonomyDebugState): string {
  const p = getPlayer(s.npcId);
  const goal = s.currentPlan?.goalId ?? "";
  const action = s.currentExecution?.actionLabel ?? "";
  const death = s.death?.message ?? "";
  return `${s.npcId} ${s.name} ${p?.name ?? ""} ${goal} ${action} ${death}`.toLowerCase();
}

function needFillClass(value: number): string {
  if (value >= 50) return "good";
  if (value >= 25) return "mid";
  return "low";
}

// ---------------------------------------------------------------------------
// Action detail rendering
// ---------------------------------------------------------------------------

function renderActionDetail(actionId: string): string {
  const def = actionDefs[actionId];
  if (!def) return `<div class="action-detail"><div class="action-detail-empty">No definition found for <strong>${escapeHtml(actionId)}</strong></div></div>`;

  const precondEntries = Object.entries(def.preconditions);
  const effectEntries = Object.entries(def.effects);

  const precondHtml = precondEntries.length > 0
    ? precondEntries.map(([k, v]) => `<div class="action-predicate"><span class="predicate-key">${escapeHtml(k)}</span> <span class="predicate-op">=</span> <span class="predicate-val">${escapeHtml(String(v))}</span><span class="predicate-desc">${escapeHtml(describeGamePredicate(k, true))}</span></div>`).join("")
    : '<div class="action-predicate muted">None</div>';

  const effectHtml = effectEntries.length > 0
    ? effectEntries.map(([k, v]) => `<div class="action-predicate"><span class="predicate-key">${escapeHtml(k)}</span> <span class="predicate-op">\u2192</span> <span class="predicate-val">${escapeHtml(String(v))}</span><span class="predicate-desc">${escapeHtml(describeGamePredicate(k, false))}</span></div>`).join("")
    : '<div class="action-predicate muted">Dynamic (set by planner)</div>';

  let proximityHtml = "";
  if (def.proximityRequirement) {
    const pr = def.proximityRequirement;
    proximityHtml = `
      <div class="action-field">
        <span class="action-field-label">Proximity</span>
        <span>Must be near <strong>${escapeHtml(pr.target)}</strong> (${escapeHtml(pr.type)}, ${pr.distance ?? 1} tile${(pr.distance ?? 1) !== 1 ? "s" : ""})</span>
      </div>
    `;
  }

  return `
    <div class="action-detail">
      <div class="action-detail-header">${escapeHtml(def.displayName)} <span class="action-detail-id">${escapeHtml(def.id)}</span></div>
      <div class="action-detail-row">
        <div class="action-field"><span class="action-field-label">Cost</span><span>${def.cost}</span></div>
        <div class="action-field"><span class="action-field-label">Duration</span><span>${def.estimatedDurationTicks} ticks (~${(def.estimatedDurationTicks / 20).toFixed(1)}s)</span></div>
      </div>
      ${proximityHtml}
      <div class="action-section-label">Preconditions (what the world must look like)</div>
      ${precondHtml}
      <div class="action-section-label">Effects (what changes after)</div>
      ${effectHtml}
    </div>
  `;
}

/** Map GOAP predicates to human-readable game descriptions */
function describeGamePredicate(key: string, isPrecondition: boolean): string {
  const descriptions: Record<string, [string, string]> = {
    "has_raw_food": ["NPC has raw food in inventory", "Adds raw food to inventory"],
    "has_cooked_food": ["NPC has cooked food in inventory", "Adds cooked food to inventory"],
    "near_campfire": ["NPC is next to a campfire", "Moves NPC near a campfire"],
    "near_berry_bush": ["NPC is next to a berry bush", "Moves NPC near a berry bush"],
    "near_water_source": ["NPC is next to water", "Moves NPC near water"],
    "near_pickupable": ["NPC is next to a pickupable item", "Moves NPC near a pickupable"],
    "near_player": ["NPC is near another player", "Moves NPC near another player"],
    "near_hostile": ["NPC is near a hostile entity", "Moves NPC near a hostile"],
    "need_food_satisfied": ["Food need is above threshold", "Satisfies food need"],
    "need_water_satisfied": ["Water need is above threshold", "Satisfies water need"],
    "need_social_satisfied": ["Social need is above threshold", "Satisfies social need"],
    "escaped_hostile": ["NPC has escaped danger", "NPC flees to safety"],
  };
  const pair = descriptions[key];
  if (!pair) return "";
  return ` \u2014 ${isPrecondition ? pair[0] : pair[1]}`;
}

// ---------------------------------------------------------------------------
// Alert derivation
// ---------------------------------------------------------------------------

function deriveAlerts(): DashboardAlert[] {
  const alerts: DashboardAlert[] = [];

  for (const c of state.conversations) {
    if (c.state === "ended") continue;
    const lastMsgTick = c.messages[c.messages.length - 1]?.tick ?? c.startedTick;
    const quietAge = state.tick - lastMsgTick;
    const inviteAge = state.tick - c.startedTick;

    if (c.state === "active" && quietAge >= CONVERSATION_QUIET_TICKS) {
      alerts.push({
        id: `conversation-quiet-${c.id}`,
        severity: quietAge >= CONVERSATION_QUIET_TICKS * 2 ? "danger" : "warning",
        title: "Conversation quiet",
        message: `${getConversationParticipantLabel(c)} has been active without a new message for ${formatAge(quietAge)}.`,
        ageTicks: quietAge,
        targetConversationId: c.id,
      });
    }

    if ((c.state === "invited" || c.state === "walking") && inviteAge >= INVITE_STUCK_TICKS) {
      alerts.push({
        id: `conversation-pending-${c.id}`,
        severity: inviteAge >= INVITE_STUCK_TICKS * 2 ? "danger" : "warning",
        title: c.state === "invited" ? "Invite pending too long" : "Rendezvous stalled",
        message: `${getConversationParticipantLabel(c)} has been ${c.state} for ${formatAge(inviteAge)}.`,
        ageTicks: inviteAge,
        targetConversationId: c.id,
      });
    }
  }

  for (const s of state.autonomy.values()) {
    if (s.isDead) {
      continue;
    }
    const label = getPlayerLabel(s.npcId);

    if (s.currentExecution) {
      const age = state.tick - s.currentExecution.startedAtTick;
      if (age >= EXECUTION_STUCK_TICKS) {
        alerts.push({
          id: `npc-execution-${s.npcId}`,
          severity: age >= EXECUTION_STUCK_TICKS * 2 ? "danger" : "warning",
          title: "Action taking too long",
          message: `${label} has been executing ${s.currentExecution.actionLabel} for ${formatAge(age)}.`,
          ageTicks: age,
          targetNpcId: s.npcId,
        });
      }
    }

    if (s.consecutivePlanFailures >= PLAN_FAILURE_ALERT_THRESHOLD) {
      alerts.push({
        id: `npc-failures-${s.npcId}`,
        severity: s.consecutivePlanFailures >= 3 ? "danger" : "warning",
        title: "Repeated plan failures",
        message: `${label} has failed ${pluralize(s.consecutivePlanFailures, "plan")} in a row.`,
        ageTicks: s.consecutivePlanFailures,
        targetNpcId: s.npcId,
      });
    }

    if (!s.currentPlan && !s.goalSelectionInFlight && getLowestNeed(s) <= CRITICAL_NEED_THRESHOLD) {
      const needs: [string, number][] = [
        ["health", s.needs.health],
        ["food", s.needs.food],
        ["water", s.needs.water],
        ["social", s.needs.social],
      ];
      needs.sort((a, b) => a[1] - b[1]);
      const [needLabel, needValue] = needs[0];
      alerts.push({
        id: `npc-critical-need-${s.npcId}`,
        severity: needValue <= DANGER_NEED_THRESHOLD ? "danger" : "warning",
        title: "Critical need without plan",
        message: `${label} has no active plan while ${needLabel} is at ${Math.round(needValue)}.`,
        ageTicks: Math.round(100 - needValue),
        targetNpcId: s.npcId,
      });
    }

    if (s.goalSelectionInFlight && typeof s.goalSelectionStartedAtTick === "number") {
      const age = state.tick - s.goalSelectionStartedAtTick;
      if (age >= GOAL_SELECTION_STUCK_TICKS) {
        alerts.push({
          id: `npc-goal-selection-${s.npcId}`,
          severity: age >= GOAL_SELECTION_STUCK_TICKS * 2 ? "danger" : "warning",
          title: "Goal selection stuck",
          message: `${label} has been waiting on goal selection for ${formatAge(age)}.`,
          ageTicks: age,
          targetNpcId: s.npcId,
        });
      }
    }
  }

  return alerts.sort((a, b) => {
    const sd = (a.severity === "danger" ? 0 : 1) - (b.severity === "danger" ? 0 : 1);
    return sd || b.ageTicks - a.ageTicks;
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
  return [...state.events].sort((a, b) => b.tick !== a.tick ? b.tick - a.tick : b.id - a.id);
}

function syncPlayers(players: readonly Player[]): void {
  state.players = new Map(players.map((p) => [p.id, { ...p }]));
  for (const p of players) {
    if (p.isNpc) npcNameCache.set(p.id, p.name);
  }
}

// ---------------------------------------------------------------------------
// Tab management
// ---------------------------------------------------------------------------

function switchTab(tabId: TabId): void {
  state.activeTab = tabId;
  document.querySelectorAll<HTMLElement>(".tab-btn").forEach((btn) => {
    btn.classList.toggle("active", btn.dataset.tab === tabId);
  });
  document.querySelectorAll<HTMLElement>(".tab-panel").forEach((panel) => {
    panel.classList.toggle("active", panel.id === `tab-${tabId}`);
  });
  // Invalidate cache for this tab so it renders fresh
  htmlCache.delete("convo-list");
  htmlCache.delete("convo-detail");
  htmlCache.delete("npc-list");
  htmlCache.delete("npc-detail");
  htmlCache.delete("activity");
  scheduleRender(true);
}

document.querySelectorAll<HTMLElement>(".tab-btn").forEach((btn) => {
  btn.addEventListener("click", () => {
    switchTab(btn.dataset.tab as TabId);
  });
});

// Capture conversation selection on pointer down so a live rerender cannot
// detach the card before the user's click completes.
dom.convoList.addEventListener("pointerdown", (event) => {
  if (event.button !== 0) return;
  const card = (event.target as HTMLElement).closest<HTMLElement>("[data-convo-id]");
  if (!card) return;

  const convoId = Number(card.dataset.convoId);
  if (Number.isNaN(convoId) || state.selectedConversationId === convoId) {
    return;
  }

  state.selectedConversationId = convoId;
  scheduleRender(true);
});

// Capture NPC selection on pointer down so a live rerender cannot detach the
// card before the user's click completes.
dom.npcList.addEventListener("pointerdown", (event) => {
  if (event.button !== 0) return;
  const card = (event.target as HTMLElement).closest<HTMLElement>("[data-npc-id]");
  if (!card) return;

  const npcId = card.dataset.npcId;
  if (!npcId || state.selectedNpcId === npcId) {
    return;
  }

  state.selectedNpcId = npcId;
  expandedActions.clear();
  scheduleRender(true);
});

// ---------------------------------------------------------------------------
// Filter management
// ---------------------------------------------------------------------------

dom.convoFilters.addEventListener("click", (e) => {
  const pill = (e.target as HTMLElement).closest<HTMLElement>(".filter-pill");
  if (!pill) return;
  state.conversationFilter = (pill.dataset.filter ?? "all") as ConversationFilter;
  dom.convoFilters.querySelectorAll(".filter-pill").forEach((p) => {
    p.classList.toggle("active", p === pill);
  });
  scheduleRender(true);
});

// ---------------------------------------------------------------------------
// Focus navigation
// ---------------------------------------------------------------------------

function focusConversation(convoId: number): void {
  dom.convoSearch.value = "";
  state.conversationFilter = "all";
  dom.convoFilters.querySelectorAll(".filter-pill").forEach((p) => {
    p.classList.toggle("active", (p as HTMLElement).dataset.filter === "all");
  });
  state.selectedConversationId = convoId;
  switchTab("conversations"); // already calls scheduleRender(true)
}

function focusNpc(npcId: string): void {
  dom.npcSearch.value = "";
  state.selectedNpcId = npcId;
  expandedActions.clear();
  switchTab("npcs"); // already calls scheduleRender(true)
}

// ---------------------------------------------------------------------------
// Render scheduling
// ---------------------------------------------------------------------------

function scheduleRender(immediate = false): void {
  if (immediate) {
    // User interaction -- render on next frame, cancel any pending throttle
    if (pendingThrottleTimer !== null) {
      clearTimeout(pendingThrottleTimer);
      pendingThrottleTimer = null;
    }
    if (renderScheduled) return;
    renderScheduled = true;
    requestAnimationFrame(() => {
      renderScheduled = false;
      lastRenderTime = performance.now();
      render();
    });
    return;
  }
  // Data-driven (WebSocket tick) -- throttle to avoid blinking
  if (renderScheduled || pendingThrottleTimer !== null) return;
  const elapsed = performance.now() - lastRenderTime;
  if (elapsed >= RENDER_THROTTLE_MS) {
    renderScheduled = true;
    requestAnimationFrame(() => {
      renderScheduled = false;
      lastRenderTime = performance.now();
      render();
    });
  } else {
    pendingThrottleTimer = setTimeout(() => {
      pendingThrottleTimer = null;
      renderScheduled = true;
      requestAnimationFrame(() => {
        renderScheduled = false;
        lastRenderTime = performance.now();
        render();
      });
    }, RENDER_THROTTLE_MS - elapsed);
  }
}

// ---------------------------------------------------------------------------
// Render: Top bar
// ---------------------------------------------------------------------------

function renderTopBar(): void {
  dom.connStatus.textContent = state.connected ? "Connected" : "Disconnected";
  dom.connStatus.className = `status-pill ${state.connected ? "connected" : "disconnected"}`;
  dom.tickDisplay.textContent = `Tick ${state.tick}`;
}

// ---------------------------------------------------------------------------
// Render: Conversations
// ---------------------------------------------------------------------------

function renderConversations(): void {
  const search = dom.convoSearch.value.trim().toLowerCase();
  const filtered = state.conversations
    .filter((c) => !search || getConversationSearchBlob(c).includes(search))
    .filter((c) => matchesConversationFilter(c, state.conversationFilter))
    .sort((a, b) => getConversationLastActivityTick(b) - getConversationLastActivityTick(a) || b.id - a.id);

  // Clear selection only when the conversation no longer exists in state
  if (
    state.selectedConversationId !== null &&
    !state.conversations.some((c) => c.id === state.selectedConversationId)
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
    listHtml = '<div class="empty-state">No conversations match your search.</div>';
  }

  setHtml(dom.convoList, "convo-list", listHtml);
  renderConvoDetail();
}

function renderConvoCard(c: Conversation): string {
  const selected = state.selectedConversationId === c.id;
  const waiting = getConversationWaitingLabel(c);
  return `
    <div class="list-card${selected ? " selected" : ""}" data-convo-id="${c.id}">
      <div class="list-card-header">
        <span class="list-card-title">${escapeHtml(getConversationParticipantLabel(c))}</span>
        <span class="chip ${getConversationTone(c)}">${escapeHtml(c.state)}</span>
      </div>
      <div class="list-card-chips">
        <span class="chip">${pluralize(c.messages.length, "msg")}</span>
        <span class="chip">${escapeHtml(formatAge(getConversationDurationTicks(c)))}</span>
        ${waiting ? `<span class="chip warning">${escapeHtml(waiting)}</span>` : ""}
      </div>
    </div>
  `;
}

function renderConvoDetail(): void {
  const c = state.conversations.find((cv) => cv.id === state.selectedConversationId);
  if (!c) {
    setHtml(dom.convoDetail, "convo-detail", '<div class="detail-empty">Select a conversation</div>');
    return;
  }

  const participants = getParticipantData(c);
  const waiting = getConversationWaitingLabel(c);
  const lastActivity = getConversationLastActivityTick(c);

  const participantChips = participants
    .map((p) => `<span class="chip ${p.isNpc ? "llm" : "accent"}">${escapeHtml(p.isNpc ? `NPC: ${p.name}` : p.name)}</span>`)
    .join("");

  const metrics = [
    { label: "State", value: c.state },
    { label: "Started", value: formatTick(c.startedTick) },
    { label: "Last Activity", value: formatTick(lastActivity) },
    { label: "Duration", value: formatAge(getConversationDurationTicks(c)) },
    { label: "Messages", value: String(c.messages.length) },
    {
      label: "Ended",
      value: typeof c.endedTick === "number"
        ? `${formatTick(c.endedTick)}${c.endedReason ? ` \u2022 ${c.endedReason.replaceAll("_", " ")}` : ""}`
        : "\u2014",
    },
  ];

  let transcript: string;
  if (c.messages.length > 0) {
    transcript = c.messages
      .map((m) => `<div class="transcript-msg"><strong>${escapeHtml(getPlayerLabel(m.playerId))}</strong>: ${escapeHtml(m.content)}</div>`)
      .join("");
  } else if (c.state === "invited") {
    transcript = '<div class="transcript-empty">Invitation sent. Waiting for response.</div>';
  } else if (c.state === "walking") {
    transcript = '<div class="transcript-empty">Participants walking to rendezvous.</div>';
  } else {
    transcript = '<div class="transcript-empty">No messages yet.</div>';
  }

  setHtml(dom.convoDetail, "convo-detail", `
    <div class="detail-header">
      <div>
        <div class="detail-title">${escapeHtml(getConversationParticipantLabel(c))}</div>
        <div class="detail-subtitle">Conversation #${c.id}</div>
      </div>
      <div class="detail-chips">
        <span class="chip ${getConversationTone(c)}">${escapeHtml(c.state)}</span>
        ${waiting ? `<span class="chip warning">${escapeHtml(waiting)}</span>` : ""}
      </div>
    </div>
    <div class="detail-chips" style="margin-bottom:16px">${participantChips}</div>
    <div class="metrics">
      ${metrics.map((m) => `
        <div class="metric">
          <div class="metric-label">${escapeHtml(m.label)}</div>
          <div class="metric-value">${escapeHtml(m.value)}</div>
        </div>
      `).join("")}
    </div>
    ${c.summary ? `<div class="inventory-text">${escapeHtml(c.summary)}</div>` : ""}
    <div class="detail-section-label">Transcript</div>
    <div class="transcript">${transcript}</div>
  `);
}

// ---------------------------------------------------------------------------
// Render: NPCs
// ---------------------------------------------------------------------------

function renderNpcs(stalledNpcIds: ReadonlySet<string>, alerts: readonly DashboardAlert[]): void {
  const search = dom.npcSearch.value.trim().toLowerCase();

  // Always sort alphabetically for stable ordering
  const filtered = [...state.autonomy.values()]
    .filter((s) => !search || getNpcSearchBlob(s).includes(search))
    .sort((a, b) => collator.compare(getPlayerLabel(a.npcId), getPlayerLabel(b.npcId)));

  // Clear selection only when the NPC no longer exists in state
  if (state.selectedNpcId && !state.autonomy.has(state.selectedNpcId)) {
    state.selectedNpcId = null;
  }

  let listHtml: string;
  if (filtered.length === 0) {
    listHtml = '<div class="empty-state">No NPCs match your search.</div>';
  } else {
    listHtml = filtered.map((s) => renderNpcCard(s, stalledNpcIds)).join("");
  }

  setHtml(dom.npcList, "npc-list", listHtml);
  renderNpcDetail(stalledNpcIds, alerts);
}

function renderNpcCard(s: NpcAutonomyDebugState, stalledNpcIds: ReadonlySet<string>): string {
  const player = getPlayer(s.npcId);
  const selected = state.selectedNpcId === s.npcId;
  const stalled = stalledNpcIds.has(s.npcId);

  const isDead = s.isDead || deadNpcIds.has(s.npcId);

  let statusChip = "";
  if (isDead) {
    statusChip = '<span class="chip dead">Dead</span>';
  } else if (stalled) {
    statusChip = '<span class="chip danger">Stalled</span>';
  } else if (s.currentExecution) {
    statusChip = '<span class="chip active">Executing</span>';
  } else if (s.currentPlan) {
    statusChip = '<span class="chip accent">Planned</span>';
  } else if (s.goalSelectionInFlight) {
    statusChip = '<span class="chip warning">Thinking</span>';
  } else {
    statusChip = '<span class="chip ended">Idle</span>';
  }

  const sourceChip = s.currentPlan
    ? `<span class="chip${s.currentPlan.source === "llm" ? " llm" : ""}">${escapeHtml(s.currentPlan.source)}</span>`
    : "";

  // Show current plan, or fall back to last known plan for idle NPCs
  const activePlan = s.currentPlan;
  const displayPlan = activePlan ?? lastKnownPlans.get(s.npcId) ?? null;
  const isStale = !activePlan && displayPlan !== null;

  let planHtml = "";
  if (displayPlan?.steps.length) {
    const label = isStale ? "Last plan" : "Plan";
    const goalLabel = escapeHtml(displayPlan.goalId.replaceAll("_", " "));
    planHtml = `<div class="card-plan${isStale ? " stale" : ""}">
      <div class="card-plan-label">${label}: ${goalLabel}</div>
      ${displayPlan.steps.map((step) =>
        `<div class="card-step${!isStale && step.isCurrent ? " current" : ""}"><span class="card-step-num">${step.index + 1}</span>${escapeHtml(step.actionLabel)}${step.targetPosition ? ` \u2192 ${step.targetPosition.x},${step.targetPosition.y}` : ""}</div>`
      ).join("")}</div>`;
  }

  const deathHtml = isDead && s.death
    ? `<div class="inventory-text">Died: ${escapeHtml(getNpcDeathSummary(s))}</div>`
    : "";

  return `
    <div class="list-card${selected ? " selected" : ""}" data-npc-id="${escapeHtml(s.npcId)}">
      <div class="list-card-header">
        <span class="list-card-title">${escapeHtml(s.name ?? player?.name ?? npcNameCache.get(s.npcId) ?? s.npcId)}</span>
        ${statusChip}
      </div>
      <div class="list-card-meta">
        ${isDead ? "dead" : escapeHtml(s.lastState ?? player?.state ?? "unknown")} \u2022 ${escapeHtml(formatNpcPoint(s, player))}${activePlan ? ` \u2022 ${escapeHtml(activePlan.goalId.replaceAll("_", " "))}` : ""}
      </div>
      ${sourceChip ? `<div class="list-card-chips">${sourceChip}</div>` : ""}
      ${deathHtml}
      ${planHtml}
    </div>
  `;
}

function renderNpcDetail(stalledNpcIds: ReadonlySet<string>, alerts: readonly DashboardAlert[]): void {
  const s = state.selectedNpcId ? state.autonomy.get(state.selectedNpcId) : undefined;
  if (!s) {
    lastRenderedNpcDetailId = null;
    pendingNpcDetailRefresh = false;
    forceNpcDetailRefresh = false;
    setHtml(dom.npcDetail, "npc-detail", '<div class="detail-empty">Select an NPC</div>');
    return;
  }

  if (npcDetailHoverLock && !forceNpcDetailRefresh && lastRenderedNpcDetailId === s.npcId) {
    pendingNpcDetailRefresh = true;
    return;
  }

  const player = getPlayer(s.npcId);
  const actionAge = s.currentExecution ? state.tick - s.currentExecution.startedAtTick : null;
  const isDead = s.isDead || deadNpcIds.has(s.npcId);

  const metrics = [
    { label: "Position", value: formatNpcPoint(s, player) },
    { label: "State", value: isDead ? "dead" : s.lastState ?? player?.state ?? "unknown" },
    { label: "Plan Source", value: s.currentPlan?.source ?? (isDead ? "dead" : "idle") },
    { label: "Current Action", value: s.currentExecution?.actionLabel ?? "none" },
    { label: "Action Age", value: typeof actionAge === "number" ? formatAge(actionAge) : "\u2014" },
    { label: "Failures", value: String(s.consecutivePlanFailures) },
  ];

  const needsHtml = (
    [
      ["Health", s.needs.health],
      ["Food", s.needs.food],
      ["Water", s.needs.water],
      ["Social", s.needs.social],
    ] as [string, number][]
  )
    .map(([label, value]) => `
      <div class="need-row">
        <span class="need-label">${escapeHtml(label)}</span>
        <div class="need-bar"><div class="need-fill ${needFillClass(value)}" style="width:${Math.max(0, Math.min(100, value))}%"></div></div>
        <span class="need-value">${Math.round(value)}</span>
      </div>
    `)
    .join("");

  // Stalled reasons: filter alerts targeting this NPC
  const npcAlerts = alerts.filter((a) => a.targetNpcId === s.npcId);
  let stalledHtml = "";
  if (npcAlerts.length > 0) {
    stalledHtml = `
      <div class="stalled-section">
        <div class="section-label">Stalled \u2014 Why?</div>
        ${npcAlerts.map((a) => `
          <div class="stalled-reason ${a.severity}">
            <div class="stalled-reason-title">${escapeHtml(a.title)}</div>
            <div class="stalled-reason-msg">${escapeHtml(a.message)}</div>
          </div>
        `).join("")}
      </div>
    `;
  }

  const deathHtml = isDead && s.death
    ? `
      <div class="stalled-section">
        <div class="section-label">Death</div>
        <div class="stalled-reason danger">
          <div class="stalled-reason-title">${escapeHtml(formatTick(s.death.tick))}</div>
          <div class="stalled-reason-msg">${escapeHtml(getNpcDeathSummary(s))}</div>
        </div>
      </div>
    `
    : "";

  const detailPlan = s.currentPlan ?? lastKnownPlans.get(s.npcId) ?? null;
  const detailPlanStale = !s.currentPlan && detailPlan !== null;

  let stepsHtml = "";
  if (detailPlan?.steps.length) {
    const stepsLabel = detailPlanStale
      ? `Last Plan: ${escapeHtml(detailPlan.goalId.replaceAll("_", " "))}`
      : "Plan Steps";
    stepsHtml = `
      <div class="plan-steps${detailPlanStale ? " stale" : ""}">
        <div class="detail-section-label">${stepsLabel}</div>
        ${detailPlan.steps.map((step) => {
          const stepKey = `plan-${step.index}-${step.actionId}`;
          return `
          <div class="step-item clickable${!detailPlanStale && step.isCurrent ? " current" : ""}" data-step-key="${escapeHtml(stepKey)}" data-action-id="${escapeHtml(step.actionId)}">
            <span class="step-num">${step.index + 1}</span>
            <span>${escapeHtml(step.actionLabel)}${step.targetPosition ? ` \u2192 ${step.targetPosition.x},${step.targetPosition.y}` : ""}</span>
          </div>
          ${expandedActions.has(stepKey) ? renderActionDetail(step.actionId) : ""}
        `;}).join("")}
      </div>
    `;
  }

  const inventoryEntries = Object.entries(s.inventory);
  const inventoryHtml = inventoryEntries.length
    ? `<div class="inventory-text">Inventory: ${escapeHtml(inventoryEntries.map(([item, count]) => `${item} \u00d7${count}`).join(", "))}</div>`
    : '<div class="inventory-text">Inventory empty.</div>';

  // Plan history timeline
  const history = planHistory.get(s.npcId) ?? [];
  const reversedHistory = [...history].reverse(); // newest first
  let historyHtml = "";
  if (reversedHistory.length > 0) {
    const failCount = reversedHistory.filter((e) => e.outcome === "failed").length;
    const retryCount = reversedHistory.filter((e, i) => {
      if (e.outcome !== "failed" || i >= reversedHistory.length - 1) return false;
      // A retry is when the next entry (older) also targeted the same goal and failed
      return reversedHistory[i + 1]?.goalId === e.goalId;
    }).length;
    const summaryParts = [pluralize(reversedHistory.length, "plan")];
    if (failCount > 0) summaryParts.push(`${failCount} failed`);
    if (retryCount > 0) summaryParts.push(`${retryCount} ${retryCount === 1 ? "retry" : "retries"}`);

    historyHtml = `
      <div class="plan-history-section">
        <div class="section-label">Plan History (${summaryParts.join(" \u2022 ")})</div>
        <div class="plan-history-timeline">
          ${reversedHistory.map((entry, hi) => {
            const outcomeClass = entry.outcome === "completed" ? "completed"
              : entry.outcome === "failed" ? "failed"
              : entry.outcome === "interrupted" ? "interrupted"
              : "running";
            const duration = entry.endedTick !== null
              ? formatAge(entry.endedTick - entry.startedTick)
              : "in progress";
            return `
              <div class="history-entry ${outcomeClass}">
                <div class="history-dot"></div>
                <div class="history-content">
                  <div class="history-header">
                    <span class="history-goal">${escapeHtml(entry.goalId.replaceAll("_", " "))}</span>
                    <span class="chip ${entry.source === "llm" ? "llm" : entry.source === "emergency" ? "danger" : ""}">${escapeHtml(entry.source)}</span>
                    <span class="chip ${outcomeClass}">${escapeHtml(entry.outcome)}</span>
                  </div>
                  <div class="history-meta">${escapeHtml(formatTick(entry.startedTick))}${entry.endedTick !== null ? ` \u2192 ${escapeHtml(formatTick(entry.endedTick))}` : ""} \u2022 ${escapeHtml(duration)}</div>
                  ${entry.outcome === "failed" && entry.failReason ? `<div class="history-fail-reason">${escapeHtml(entry.failReason)}</div>` : ""}
                  ${entry.reasoning ? `<div class="history-reasoning">${escapeHtml(entry.reasoning)}</div>` : ""}
                  ${entry.steps.length > 0 ? `<div class="history-steps">${entry.steps.map((step, si) => {
                    const stepKey = `hist-${hi}-${si}-${step.actionId}`;
                    return `<span class="history-step-chip clickable" data-step-key="${escapeHtml(stepKey)}" data-action-id="${escapeHtml(step.actionId)}">${escapeHtml(step.actionLabel)}</span>${expandedActions.has(stepKey) ? renderActionDetail(step.actionId) : ""}`;
                  }).join("")}</div>` : ""}
                </div>
              </div>
            `;
          }).join("")}
        </div>
      </div>
    `;
  }

  let headerChips = "";
  if (isDead) {
    headerChips += '<span class="chip dead">Dead</span>';
  } else if (s.currentPlan) {
    headerChips += `<span class="chip ${s.currentPlan.source === "llm" ? "llm" : ""}">${escapeHtml(s.currentPlan.source)} plan</span>`;
  } else {
    headerChips += '<span class="chip ended">idle</span>';
  }
  if (stalledNpcIds.has(s.npcId)) {
    headerChips += '<span class="chip danger">Stalled</span>';
  }
  if (s.goalSelectionInFlight) {
    headerChips += '<span class="chip warning">Goal selection</span>';
  }

  setHtml(dom.npcDetail, "npc-detail", `
    <div class="detail-header">
      <div>
        <div class="detail-title">${escapeHtml(s.name ?? player?.name ?? s.npcId)}</div>
        <div class="detail-subtitle">${escapeHtml(s.npcId)}</div>
      </div>
      <div class="detail-chips">
        ${headerChips}
        ${expandedActions.size > 0 ? '<button class="collapse-all-btn" id="collapse-all-actions">Collapse all</button>' : ""}
      </div>
    </div>
    ${deathHtml}
    ${stalledHtml}
    <div class="metrics">
      ${metrics.map((m) => `
        <div class="metric">
          <div class="metric-label">${escapeHtml(m.label)}</div>
          <div class="metric-value">${escapeHtml(m.value)}</div>
        </div>
      `).join("")}
    </div>
    <div class="needs-section">
      <div class="section-label">Needs</div>
      ${needsHtml}
    </div>
    ${s.currentPlan?.reasoning ? `<div class="inventory-text">${escapeHtml(s.currentPlan.reasoning)}</div>` : ""}
    ${stepsHtml}
    ${inventoryHtml}
    ${historyHtml}
  `);
  lastRenderedNpcDetailId = s.npcId;
  pendingNpcDetailRefresh = false;
  forceNpcDetailRefresh = false;
}

// ---------------------------------------------------------------------------
// Render: Activity (alerts + events)
// ---------------------------------------------------------------------------

function renderActivity(alerts: readonly DashboardAlert[]): void {
  const events = getSortedEvents();
  let html = "";

  // Alerts section
  html += '<div class="section-divider">Alerts</div>';
  if (alerts.length === 0) {
    html += '<div class="empty-state">No stuck-state alerts. Everything looks healthy.</div>';
  } else {
    html += alerts.map((a) => `
      <div class="alert-card ${a.severity}" data-alert-id="${escapeHtml(a.id)}">
        <div class="alert-title">${escapeHtml(a.title)}</div>
        <div class="alert-meta">${escapeHtml(formatAge(a.ageTicks))} \u2022 ${a.targetNpcId ? escapeHtml(getPlayerLabel(a.targetNpcId)) : `Conversation #${a.targetConversationId}`}</div>
      </div>
    `).join("");
  }

  // Events section
  html += '<div class="section-divider">Event Feed</div>';
  if (events.length === 0) {
    html += '<div class="empty-state">Waiting for events.</div>';
  } else {
    html += events.map((e) => {
      const borderClass = e.severity === "error" ? "error-border" : e.severity === "warning" ? "warning-border" : "";
      return `
        <div class="event-card ${borderClass}" data-event-id="${e.id}">
          <div class="event-title">${escapeHtml(e.title)}</div>
          <div class="event-meta">${escapeHtml(formatTick(e.tick))} \u2022 ${escapeHtml(e.subjectType)} ${escapeHtml(e.subjectId)}</div>
        </div>
      `;
    }).join("");
  }

  const changed = setHtml(dom.activityContent, "activity", html);

  if (changed) {
    // Bind alert clicks
    const alertsById = new Map(alerts.map((a) => [a.id, a]));
    dom.activityContent.querySelectorAll<HTMLElement>("[data-alert-id]").forEach((card) => {
      card.addEventListener("click", () => {
        const alert = alertsById.get(card.dataset.alertId ?? "");
        if (!alert) return;
        if (alert.targetConversationId) focusConversation(alert.targetConversationId);
        else if (alert.targetNpcId) focusNpc(alert.targetNpcId);
      });
    });

    // Bind event clicks
    const eventsById = new Map(events.map((e) => [String(e.id), e]));
    dom.activityContent.querySelectorAll<HTMLElement>("[data-event-id]").forEach((card) => {
      card.addEventListener("click", () => {
        const event = eventsById.get(card.dataset.eventId ?? "");
        if (!event) return;
        if (typeof event.relatedConversationId === "number") {
          focusConversation(event.relatedConversationId);
        } else if (event.relatedNpcId) {
          focusNpc(event.relatedNpcId);
        } else if (event.subjectType === "npc") {
          focusNpc(event.subjectId);
        }
      });
    });
  }
}

// ---------------------------------------------------------------------------
// Main render
// ---------------------------------------------------------------------------

function render(): void {
  const alerts = deriveAlerts();
  const stalledNpcIds = new Set(
    alerts.map((a) => a.targetNpcId).filter((id): id is string => Boolean(id)),
  );

  renderTopBar();

  // Always update tab badges
  const activeConvos = state.conversations.filter((c) => c.state !== "ended").length;
  dom.badgeConvos.textContent = String(activeConvos);
  dom.badgeNpcs.textContent = String(state.autonomy.size);
  dom.badgeActivity.textContent = alerts.length > 0 ? String(alerts.length) : "0";

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
  }
}

// ---------------------------------------------------------------------------
// Input handlers
// ---------------------------------------------------------------------------

dom.convoSearch.addEventListener("input", () => scheduleRender(true));
dom.npcSearch.addEventListener("input", () => scheduleRender(true));

// Single delegated handler for action detail expansion (bound once, never re-bound)
function handleNpcDetailInteraction(target: HTMLElement): boolean {
  if (target.closest("#collapse-all-actions")) {
    expandedActions.clear();
    htmlCache.delete("npc-detail");
    forceNpcDetailRefresh = true;
    scheduleRender(true);
    return true;
  }

  const stepEl = target.closest<HTMLElement>("[data-step-key]");
  if (!stepEl) {
    return false;
  }

  const key = stepEl.dataset.stepKey;
  if (!key) {
    return false;
  }

  if (expandedActions.has(key)) {
    expandedActions.delete(key);
  } else {
    expandedActions.add(key);
  }
  htmlCache.delete("npc-detail");
  forceNpcDetailRefresh = true;
  scheduleRender(true);
  return true;
}

function isNpcDetailInteractiveTarget(target: EventTarget | null): target is HTMLElement {
  return target instanceof HTMLElement
    && Boolean(target.closest("[data-step-key], #collapse-all-actions"));
}

function releaseNpcDetailHoverLock(): void {
  if (!npcDetailHoverLock) {
    return;
  }
  npcDetailHoverLock = false;
  if (pendingNpcDetailRefresh) {
    htmlCache.delete("npc-detail");
    scheduleRender(true);
  }
}

dom.npcDetail.addEventListener("pointerover", (event) => {
  if (!isNpcDetailInteractiveTarget(event.target)) {
    return;
  }
  npcDetailHoverLock = true;
});

dom.npcDetail.addEventListener("pointerout", (event) => {
  if (!isNpcDetailInteractiveTarget(event.target)) {
    return;
  }
  if (isNpcDetailInteractiveTarget(event.relatedTarget)) {
    return;
  }
  releaseNpcDetailHoverLock();
});

dom.npcDetail.addEventListener("pointerleave", () => {
  releaseNpcDetailHoverLock();
});

// Capture NPC detail interactions on pointer down so live rerenders cannot
// detach the target before click dispatch.
dom.npcDetail.addEventListener("pointerdown", (event) => {
  if (event.button !== 0) return;
  pendingNpcDetailRefresh = false;
  handleNpcDetailInteraction(event.target as HTMLElement);
});

// Preserve keyboard activation for the real button in the detail header.
dom.npcDetail.addEventListener("click", (event) => {
  const mouseEvent = event as MouseEvent;
  if (mouseEvent.detail !== 0) {
    return;
  }
  handleNpcDetailInteraction(event.target as HTMLElement);
});

// ---------------------------------------------------------------------------
// WebSocket
// ---------------------------------------------------------------------------

function handleMessage(message: ServerMessage): void {
  switch (message.type) {
    case "state":
      state.tick = message.data.tick;
      syncPlayers(message.data.players);
      break;
    case "tick":
      state.tick = message.data.tick;
      break;
    case "player_joined":
    case "player_update":
      state.players.set(message.data.id, { ...message.data });
      if (message.data.isNpc) npcNameCache.set(message.data.id, message.data.name);
      break;
    case "player_left":
      // Keep autonomy state for dead NPCs so their card stays visible
      if (state.autonomy.has(message.data.id)) {
        deadNpcIds.add(message.data.id);
      }
      state.players.delete(message.data.id);
      break;
    case "debug_bootstrap":
      state.tick = message.data.tick;
      syncPlayers(message.data.players);
      state.conversations = [...message.data.conversations];
      state.autonomy = new Map(Object.entries(message.data.autonomyStates));
      lastKnownPlans.clear();
      deadNpcIds.clear();
      for (const [npcId, s] of state.autonomy) {
        npcNameCache.set(npcId, s.name);
        if (s.currentPlan) lastKnownPlans.set(npcId, s.currentPlan);
        if (s.isDead) deadNpcIds.add(npcId);
      }
      actionDefs = message.data.actionDefinitions ?? {};
      state.events = [...message.data.recentEvents];
      // Reset session state on fresh bootstrap
      planHistory.clear();
      for (const ev of message.data.recentEvents) {
        if (ev.subjectType !== "npc") continue;
        if (ev.plan) {
          lastKnownPlans.set(ev.subjectId, ev.plan);
        }
        if (ev.type === "plan_started") {
          recordPlanStarted(ev.subjectId, ev.tick, ev.message, ev.plan);
        } else if (ev.type === "plan_cleared") {
          const outcome = ev.severity === "info" ? "completed" : "interrupted";
          recordPlanEnded(
            ev.subjectId,
            ev.tick,
            outcome,
            ev.message,
            undefined,
            ev.plan,
          );
        } else if (ev.type === "plan_failed") {
          recordPlanEnded(
            ev.subjectId,
            ev.tick,
            "failed",
            ev.message,
            ev.message,
            ev.plan,
          );
        }
      }
      break;
    case "debug_conversation_upsert":
      state.conversations = upsertConversationSnapshot(
        state.conversations,
        message.data,
      ).conversations;
      break;
    case "debug_conversation_message":
      state.conversations = appendConversationMessage(state.conversations, message.data);
      break;
    case "debug_autonomy_upsert":
      npcNameCache.set(message.data.npcId, message.data.name);
      if (message.data.currentPlan) {
        lastKnownPlans.set(message.data.npcId, message.data.currentPlan);
      }
      if (message.data.isDead) {
        deadNpcIds.add(message.data.npcId);
      } else {
        deadNpcIds.delete(message.data.npcId);
      }
      state.autonomy.set(message.data.npcId, message.data);
      break;
    case "debug_event": {
      pushEvent(message.data);
      const ev = message.data;
      if (ev.subjectType === "npc") {
        if (ev.plan) {
          lastKnownPlans.set(ev.subjectId, ev.plan);
        }
        if (ev.type === "plan_started") {
          recordPlanStarted(ev.subjectId, ev.tick, ev.message, ev.plan);
        } else if (ev.type === "plan_cleared") {
          // Distinguish completed vs interrupted by severity
          const outcome = ev.severity === "info" ? "completed" : "interrupted";
          recordPlanEnded(
            ev.subjectId,
            ev.tick,
            outcome,
            ev.message,
            undefined,
            ev.plan,
          );
        } else if (ev.type === "plan_failed") {
          recordPlanEnded(
            ev.subjectId,
            ev.tick,
            "failed",
            ev.message,
            ev.message,
            ev.plan,
          );
        }
      }
      break;
    }
    case "error":
      pushEvent({
        id: nextSyntheticEventId--,
        tick: state.tick,
        type: "error",
        severity: "error",
        subjectType: "system",
        subjectId: "dashboard",
        title: "Client error",
        message: message.data.message,
      });
      break;
    default:
      break;
  }
  // Keep the selected detail pane responsive, but throttle unrelated conversation
  // updates so new conversations do not jolt the current selection view.
  const isImmediate = message.type === "debug_bootstrap"
    || message.type === "error"
    || (message.type === "debug_conversation_upsert"
      && message.data.id === state.selectedConversationId)
    || (message.type === "debug_conversation_message"
      && message.data.convoId === state.selectedConversationId);
  scheduleRender(isImmediate);
}

client.onOpen(() => {
  state.connected = true;
  client.send({ type: "subscribe_debug" });
  scheduleRender(true);
});

client.onClose(() => {
  state.connected = false;
  scheduleRender(true);
});

client.onMessage(handleMessage);
client.connect();
render();
