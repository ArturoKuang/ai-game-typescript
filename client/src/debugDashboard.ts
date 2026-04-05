import {
  appendConversationMessage,
  upsertConversationSnapshot,
} from "./conversationDebugState.js";
import { GameClient } from "./network.js";
import type {
  Conversation,
  DebugFeedEvent,
  NpcAutonomyDebugState,
  Player,
  PublicPlayer,
  ServerMessage,
} from "./types.js";

const ENDED_RECENTLY_WINDOW_TICKS = 300;
const EXECUTION_STUCK_TICKS = 180;
const CONVERSATION_QUIET_TICKS = 180;
const INVITE_STUCK_TICKS = 120;
const GOAL_SELECTION_STUCK_TICKS = 160;
const PLAN_FAILURE_ALERT_THRESHOLD = 2;
const CRITICAL_NEED_THRESHOLD = 15;
const DANGER_NEED_THRESHOLD = 8;
const MAX_EVENTS = 400;

type ConversationSort =
  | "last_activity_desc"
  | "started_desc"
  | "ended_desc"
  | "npc_name_asc"
  | "participant_name_asc"
  | "message_count_desc";
type ConversationFilter = "all" | "active" | "ended" | "npc" | "human";
type AutonomySort = "priority" | "name" | "need" | "failures" | "action_age";
type AutonomyFilter = "all" | "executing" | "planned" | "llm" | "stalled";
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

interface DashboardState {
  connected: boolean;
  tick: number;
  players: Map<string, PublicPlayer>;
  conversations: Conversation[];
  autonomy: Map<string, NpcAutonomyDebugState>;
  events: DebugFeedEvent[];
  selectedConversationId: number | null;
  selectedNpcId: string | null;
}

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
  autonomy: new Map(),
  events: [],
  selectedConversationId: null,
  selectedNpcId: null,
};

let nextSyntheticEventId = -1;
let renderScheduled = false;

function assertElement<T extends HTMLElement>(id: string): T {
  const element = document.getElementById(id);
  if (!element) {
    throw new Error(`Missing dashboard element #${id}`);
  }
  return element as T;
}

const elements = {
  connection: assertElement<HTMLDivElement>("dashboard-connection"),
  tick: assertElement<HTMLDivElement>("dashboard-tick"),
  counters: assertElement<HTMLDivElement>("health-counters"),
  conversationSummary: assertElement<HTMLDivElement>("conversation-panel-summary"),
  conversationSearch: assertElement<HTMLInputElement>("conversation-search"),
  conversationSort: assertElement<HTMLSelectElement>("conversation-sort"),
  conversationFilter: assertElement<HTMLSelectElement>("conversation-filter"),
  conversationGroups: assertElement<HTMLDivElement>("conversation-groups"),
  conversationDetail: assertElement<HTMLDivElement>("conversation-detail"),
  autonomySummary: assertElement<HTMLDivElement>("autonomy-panel-summary"),
  autonomySearch: assertElement<HTMLInputElement>("autonomy-search"),
  autonomySort: assertElement<HTMLSelectElement>("autonomy-sort"),
  autonomyFilter: assertElement<HTMLSelectElement>("autonomy-filter"),
  autonomyList: assertElement<HTMLDivElement>("autonomy-list"),
  autonomyDetail: assertElement<HTMLDivElement>("autonomy-detail"),
  alertsSummary: assertElement<HTMLDivElement>("alerts-summary"),
  alertsList: assertElement<HTMLDivElement>("alerts-list"),
  eventFeedSummary: assertElement<HTMLDivElement>("event-feed-summary"),
  eventFeed: assertElement<HTMLDivElement>("event-feed"),
};

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
  return typeof tick === "number" ? `T${tick}` : "—";
}

function formatAge(ageTicks: number): string {
  return pluralize(ageTicks, "tick");
}

function formatPoint(player: PublicPlayer | undefined): string {
  if (!player) return "unknown";
  return `${Math.round(player.x)}, ${Math.round(player.y)}`;
}

function getPlayer(playerId: string): PublicPlayer | undefined {
  return state.players.get(playerId);
}

function getPlayerLabel(playerId: string): string {
  return getPlayer(playerId)?.name ?? playerId;
}

function getParticipantData(conversation: Conversation): Array<{
  id: string;
  name: string;
  isNpc: boolean;
}> {
  return [conversation.player1Id, conversation.player2Id].map((playerId) => {
    const player = getPlayer(playerId);
    return {
      id: playerId,
      name: player?.name ?? playerId,
      isNpc: player?.isNpc ?? false,
    };
  });
}

function getConversationParticipantLabel(conversation: Conversation): string {
  return getParticipantData(conversation)
    .map((participant) => participant.name)
    .join(" ↔ ");
}

function getConversationNpcLabel(conversation: Conversation): string {
  const npcNames = getParticipantData(conversation)
    .filter((participant) => participant.isNpc)
    .map((participant) => participant.name);
  return npcNames.join(", ");
}

function getConversationLastActivityTick(conversation: Conversation): number {
  const lastMessage = conversation.messages[conversation.messages.length - 1];
  return lastMessage?.tick ?? conversation.endedTick ?? conversation.startedTick;
}

function getConversationDurationTicks(conversation: Conversation): number {
  const endTick = conversation.endedTick ?? state.tick;
  return Math.max(0, endTick - conversation.startedTick);
}

function getConversationTone(conversation: Conversation): string {
  switch (conversation.state) {
    case "ended":
      return "ended";
    case "active":
      return "active";
    default:
      return "warning";
  }
}

function getConversationWaitingLabel(conversation: Conversation): string | null {
  const waitingNpc = [conversation.player1Id, conversation.player2Id]
    .map((playerId) => getPlayer(playerId))
    .find(
      (player) =>
        player?.isNpc &&
        player.currentConvoId === conversation.id &&
        player.isWaitingForResponse,
    );
  return waitingNpc ? `${waitingNpc.name} thinking` : null;
}

function getConversationSearchBlob(conversation: Conversation): string {
  const participants = getParticipantData(conversation)
    .map((participant) => participant.name)
    .join(" ");
  return `${conversation.id} ${participants} ${conversation.state}`.toLowerCase();
}

function getConversationMatchesFilter(
  conversation: Conversation,
  filter: ConversationFilter,
): boolean {
  if (filter === "all") return true;
  if (filter === "active") return conversation.state !== "ended";
  if (filter === "ended") return conversation.state === "ended";
  const participants = getParticipantData(conversation);
  if (filter === "npc") return participants.some((participant) => participant.isNpc);
  if (filter === "human") {
    return participants.some((participant) => !participant.isNpc);
  }
  return true;
}

function sortConversations(
  left: Conversation,
  right: Conversation,
  sort: ConversationSort,
): number {
  if (sort === "last_activity_desc") {
    const diff = getConversationLastActivityTick(right) - getConversationLastActivityTick(left);
    return diff || right.id - left.id;
  }
  if (sort === "started_desc") {
    return right.startedTick - left.startedTick || right.id - left.id;
  }
  if (sort === "ended_desc") {
    return (right.endedTick ?? -1) - (left.endedTick ?? -1) || right.id - left.id;
  }
  if (sort === "npc_name_asc") {
    const diff = collator.compare(
      getConversationNpcLabel(left) || "~",
      getConversationNpcLabel(right) || "~",
    );
    return diff || sortConversations(left, right, "last_activity_desc");
  }
  if (sort === "participant_name_asc") {
    const diff = collator.compare(
      getConversationParticipantLabel(left),
      getConversationParticipantLabel(right),
    );
    return diff || sortConversations(left, right, "last_activity_desc");
  }
  return right.messages.length - left.messages.length || sortConversations(left, right, "last_activity_desc");
}

function getLowestNeed(debugState: NpcAutonomyDebugState): number {
  return Math.min(
    debugState.needs.health,
    debugState.needs.food,
    debugState.needs.water,
    debugState.needs.social,
  );
}

function getAutonomySearchBlob(debugState: NpcAutonomyDebugState): string {
  const player = getPlayer(debugState.npcId);
  const goal = debugState.currentPlan?.goalId ?? "";
  const action = debugState.currentExecution?.actionLabel ?? "";
  return `${debugState.npcId} ${player?.name ?? ""} ${goal} ${action}`.toLowerCase();
}

function getAutonomyMatchesFilter(
  debugState: NpcAutonomyDebugState,
  filter: AutonomyFilter,
  stalledNpcIds: ReadonlySet<string>,
): boolean {
  if (filter === "all") return true;
  if (filter === "executing") return Boolean(debugState.currentExecution);
  if (filter === "planned") return Boolean(debugState.currentPlan);
  if (filter === "llm") return debugState.currentPlan?.source === "llm";
  if (filter === "stalled") return stalledNpcIds.has(debugState.npcId);
  return true;
}

function sortAutonomyStates(
  left: NpcAutonomyDebugState,
  right: NpcAutonomyDebugState,
  sort: AutonomySort,
  stalledNpcIds: ReadonlySet<string>,
): number {
  const leftName = getPlayerLabel(left.npcId);
  const rightName = getPlayerLabel(right.npcId);

  if (sort === "name") {
    return collator.compare(leftName, rightName);
  }

  if (sort === "need") {
    return getLowestNeed(left) - getLowestNeed(right) || collator.compare(leftName, rightName);
  }

  if (sort === "failures") {
    return (
      right.consecutivePlanFailures - left.consecutivePlanFailures ||
      sortAutonomyStates(left, right, "need", stalledNpcIds)
    );
  }

  if (sort === "action_age") {
    const leftAge = left.currentExecution ? state.tick - left.currentExecution.startedAtTick : -1;
    const rightAge = right.currentExecution ? state.tick - right.currentExecution.startedAtTick : -1;
    return rightAge - leftAge || collator.compare(leftName, rightName);
  }

  const leftExecuting = left.currentExecution ? 0 : 1;
  const rightExecuting = right.currentExecution ? 0 : 1;
  if (leftExecuting !== rightExecuting) {
    return leftExecuting - rightExecuting;
  }

  const leftPlanned = left.currentPlan ? 0 : 1;
  const rightPlanned = right.currentPlan ? 0 : 1;
  if (leftPlanned !== rightPlanned) {
    return leftPlanned - rightPlanned;
  }

  const leftStalled = stalledNpcIds.has(left.npcId) ? 0 : 1;
  const rightStalled = stalledNpcIds.has(right.npcId) ? 0 : 1;
  if (leftStalled !== rightStalled) {
    return leftStalled - rightStalled;
  }

  return getLowestNeed(left) - getLowestNeed(right) || collator.compare(leftName, rightName);
}

function getSortedEvents(): DebugFeedEvent[] {
  return [...state.events].sort((left, right) => {
    if (left.tick !== right.tick) {
      return right.tick - left.tick;
    }
    return right.id - left.id;
  });
}

function deriveAlerts(): DashboardAlert[] {
  const alerts: DashboardAlert[] = [];

  for (const conversation of state.conversations) {
    if (conversation.state === "ended") {
      continue;
    }

    const lastMessageTick =
      conversation.messages[conversation.messages.length - 1]?.tick ??
      conversation.startedTick;
    const quietAge = state.tick - lastMessageTick;
    const inviteAge = state.tick - conversation.startedTick;

    if (conversation.state === "active" && quietAge >= CONVERSATION_QUIET_TICKS) {
      alerts.push({
        id: `conversation-quiet-${conversation.id}`,
        severity: quietAge >= CONVERSATION_QUIET_TICKS * 2 ? "danger" : "warning",
        title: "Conversation quiet",
        message: `${getConversationParticipantLabel(conversation)} has been active without a new message for ${formatAge(quietAge)}.`,
        ageTicks: quietAge,
        targetConversationId: conversation.id,
      });
    }

    if (
      (conversation.state === "invited" || conversation.state === "walking") &&
      inviteAge >= INVITE_STUCK_TICKS
    ) {
      alerts.push({
        id: `conversation-pending-${conversation.id}`,
        severity: inviteAge >= INVITE_STUCK_TICKS * 2 ? "danger" : "warning",
        title: conversation.state === "invited" ? "Invite pending too long" : "Conversation rendezvous stalled",
        message: `${getConversationParticipantLabel(conversation)} has been ${conversation.state} for ${formatAge(inviteAge)}.`,
        ageTicks: inviteAge,
        targetConversationId: conversation.id,
      });
    }
  }

  for (const debugState of state.autonomy.values()) {
    const npcLabel = getPlayerLabel(debugState.npcId);

    if (debugState.currentExecution) {
      const executionAge = state.tick - debugState.currentExecution.startedAtTick;
      if (executionAge >= EXECUTION_STUCK_TICKS) {
        alerts.push({
          id: `npc-execution-${debugState.npcId}`,
          severity: executionAge >= EXECUTION_STUCK_TICKS * 2 ? "danger" : "warning",
          title: "Action taking too long",
          message: `${npcLabel} has been executing ${debugState.currentExecution.actionLabel} for ${formatAge(executionAge)}.`,
          ageTicks: executionAge,
          targetNpcId: debugState.npcId,
        });
      }
    }

    if (debugState.consecutivePlanFailures >= PLAN_FAILURE_ALERT_THRESHOLD) {
      alerts.push({
        id: `npc-failures-${debugState.npcId}`,
        severity: debugState.consecutivePlanFailures >= 3 ? "danger" : "warning",
        title: "Repeated plan failures",
        message: `${npcLabel} has failed ${pluralize(debugState.consecutivePlanFailures, "plan")} in a row.`,
        ageTicks: debugState.consecutivePlanFailures,
        targetNpcId: debugState.npcId,
      });
    }

    if (
      !debugState.currentPlan &&
      !debugState.goalSelectionInFlight &&
      getLowestNeed(debugState) <= CRITICAL_NEED_THRESHOLD
    ) {
      const lowestNeed = [
        ["health", debugState.needs.health],
        ["food", debugState.needs.food],
        ["water", debugState.needs.water],
        ["social", debugState.needs.social],
      ] as Array<[string, number]>;
      lowestNeed.sort((left, right) => left[1] - right[1]);
      const [needLabel, needValue] = lowestNeed[0];

      alerts.push({
        id: `npc-critical-need-${debugState.npcId}`,
        severity: needValue <= DANGER_NEED_THRESHOLD ? "danger" : "warning",
        title: "Critical need without plan",
        message: `${npcLabel} has no active plan while ${needLabel} is at ${Math.round(needValue)}.`,
        ageTicks: Math.round(100 - needValue),
        targetNpcId: debugState.npcId,
      });
    }

    if (
      debugState.goalSelectionInFlight &&
      typeof debugState.goalSelectionStartedAtTick === "number"
    ) {
      const selectionAge = state.tick - debugState.goalSelectionStartedAtTick;
      if (selectionAge >= GOAL_SELECTION_STUCK_TICKS) {
        alerts.push({
          id: `npc-goal-selection-${debugState.npcId}`,
          severity:
            selectionAge >= GOAL_SELECTION_STUCK_TICKS * 2 ? "danger" : "warning",
          title: "Goal selection stuck",
          message: `${npcLabel} has been waiting on goal selection for ${formatAge(selectionAge)}.`,
          ageTicks: selectionAge,
          targetNpcId: debugState.npcId,
        });
      }
    }
  }

  return alerts.sort((left, right) => {
    const severityDiff =
      (left.severity === "danger" ? 0 : 1) - (right.severity === "danger" ? 0 : 1);
    if (severityDiff !== 0) {
      return severityDiff;
    }
    return right.ageTicks - left.ageTicks;
  });
}

function pushEvent(event: DebugFeedEvent): void {
  const existingIndex = state.events.findIndex((item) => item.id === event.id);
  if (existingIndex >= 0) {
    state.events[existingIndex] = event;
  } else {
    state.events.push(event);
    if (state.events.length > MAX_EVENTS) {
      state.events.splice(0, state.events.length - MAX_EVENTS);
    }
  }
}

function syncPlayers(players: readonly Player[]): void {
  state.players = new Map(players.map((player) => [player.id, { ...player }]));
}

function focusConversation(conversationId: number): void {
  elements.conversationSearch.value = "";
  elements.conversationFilter.value = "all";
  state.selectedConversationId = conversationId;
  scheduleRender();
}

function focusNpc(npcId: string): void {
  elements.autonomySearch.value = "";
  elements.autonomyFilter.value = "all";
  state.selectedNpcId = npcId;
  scheduleRender();
}

function scheduleRender(): void {
  if (renderScheduled) return;
  renderScheduled = true;
  requestAnimationFrame(() => {
    renderScheduled = false;
    renderDashboard();
  });
}

function renderCounters(alerts: readonly DashboardAlert[], stalledNpcIds: ReadonlySet<string>): void {
  const activeConversations = state.conversations.filter(
    (conversation) => conversation.state !== "ended",
  ).length;
  const endedRecently = state.conversations.filter((conversation) => {
    if (typeof conversation.endedTick !== "number") return false;
    return state.tick - conversation.endedTick <= ENDED_RECENTLY_WINDOW_TICKS;
  }).length;
  const executingNpcs = Array.from(state.autonomy.values()).filter(
    (debugState) => debugState.currentExecution,
  ).length;
  const llmPlans = Array.from(state.autonomy.values()).filter(
    (debugState) => debugState.currentPlan?.source === "llm",
  ).length;
  const recentFailures = getSortedEvents().filter((event) => {
    if (state.tick - event.tick > ENDED_RECENTLY_WINDOW_TICKS) {
      return false;
    }
    return event.type === "plan_failed" || event.type === "action_failed";
  }).length;

  const cards = [
    {
      label: "Active Conversations",
      value: activeConversations,
      detail: `${pluralize(
        state.conversations.filter((conversation) => conversation.state === "active").length,
        "conversation",
      )} talking now`,
      tone: activeConversations > 0 ? "active" : "",
    },
    {
      label: "Ended Recently",
      value: endedRecently,
      detail: `Last ${ENDED_RECENTLY_WINDOW_TICKS} ticks`,
      tone: "",
    },
    {
      label: "NPCs Executing",
      value: executingNpcs,
      detail: `${pluralize(executingNpcs, "NPC")} currently running an action`,
      tone: executingNpcs > 0 ? "active" : "",
    },
    {
      label: "LLM Plans",
      value: llmPlans,
      detail: `${pluralize(llmPlans, "NPC")} on an LLM-selected plan`,
      tone: llmPlans > 0 ? "llm" : "",
    },
    {
      label: "Stalled NPCs",
      value: stalledNpcIds.size,
      detail: `${pluralize(alerts.filter((alert) => alert.targetNpcId).length, "alert")} targeting autonomy`,
      tone: stalledNpcIds.size > 0 ? "danger" : "",
    },
    {
      label: "Recent Failures",
      value: recentFailures,
      detail: `${pluralize(recentFailures, "plan or action failure")} in the recent window`,
      tone: recentFailures > 0 ? "warning" : "",
    },
  ];

  elements.counters.innerHTML = cards
    .map(
      (card) => `
        <article class="counter-card"${card.tone ? ` data-tone="${card.tone}"` : ""}>
          <div class="counter-label">${escapeHtml(card.label)}</div>
          <div class="counter-value">${card.value}</div>
          <div class="counter-detail">${escapeHtml(card.detail)}</div>
        </article>
      `,
    )
    .join("");
}

function renderConversationPanel(filteredConversations: readonly Conversation[]): void {
  const activeConversations = filteredConversations.filter(
    (conversation) => conversation.state !== "ended",
  );
  const endedConversations = filteredConversations.filter(
    (conversation) => conversation.state === "ended",
  );

  elements.conversationSummary.textContent = `${pluralize(filteredConversations.length, "conversation")} shown • ${pluralize(activeConversations.length, "active")} • ${pluralize(endedConversations.length, "ended")}`;

  const groups = [
    { title: "Active", items: activeConversations },
    { title: "Ended", items: endedConversations },
  ];

  elements.conversationGroups.innerHTML = groups
    .filter((group) => group.items.length > 0)
    .map((group) => {
      const rows = group.items
        .map((conversation) => {
          const lastActivityTick = getConversationLastActivityTick(conversation);
          const waitingLabel = getConversationWaitingLabel(conversation);
          return `
            <article class="selectable-card${state.selectedConversationId === conversation.id ? " is-selected" : ""}" data-conversation-id="${conversation.id}">
              <div class="card-head">
                <div>
                  <div class="card-title">${escapeHtml(getConversationParticipantLabel(conversation))}</div>
                  <div class="card-meta">Conversation #${conversation.id} • ${escapeHtml(formatTick(conversation.startedTick))} started • ${escapeHtml(formatTick(lastActivityTick))} last activity</div>
                </div>
                <div class="chip-row">
                  <span class="chip" data-tone="${getConversationTone(conversation)}">${escapeHtml(conversation.state)}</span>
                </div>
              </div>
              <div class="chip-row">
                <span class="chip">${pluralize(conversation.messages.length, "message")}</span>
                <span class="chip">${escapeHtml(formatAge(getConversationDurationTicks(conversation)))}</span>
                ${waitingLabel ? `<span class="chip" data-tone="warning">${escapeHtml(waitingLabel)}</span>` : ""}
              </div>
            </article>
          `;
        })
        .join("");

      return `
        <section class="group-block">
          <div class="group-header">
            <div class="group-title">${escapeHtml(group.title)}</div>
            <div class="group-count">${pluralize(group.items.length, "conversation")}</div>
          </div>
          <div class="row-list">${rows}</div>
        </section>
      `;
    })
    .join("");

  if (filteredConversations.length === 0) {
    elements.conversationGroups.innerHTML =
      '<div class="empty-state">No conversations match the current search and filters.</div>';
  }

  const selectedConversation = state.conversations.find(
    (conversation) => conversation.id === state.selectedConversationId,
  );

  if (!selectedConversation) {
    elements.conversationDetail.innerHTML =
      '<div class="empty-state">Select a conversation to inspect its transcript, participants, and timing.</div>';
  } else {
    const waitingLabel = getConversationWaitingLabel(selectedConversation);
    const lastActivityTick = getConversationLastActivityTick(selectedConversation);
    const metrics = [
      { label: "State", value: selectedConversation.state },
      { label: "Started", value: formatTick(selectedConversation.startedTick) },
      { label: "Last Activity", value: formatTick(lastActivityTick) },
      { label: "Duration", value: formatAge(getConversationDurationTicks(selectedConversation)) },
      { label: "Messages", value: String(selectedConversation.messages.length) },
      {
        label: "Ended",
        value:
          typeof selectedConversation.endedTick === "number"
            ? `${formatTick(selectedConversation.endedTick)}${selectedConversation.endedReason ? ` • ${selectedConversation.endedReason.replaceAll("_", " ")}` : ""}`
            : "—",
      },
    ];

    const participantChips = getParticipantData(selectedConversation)
      .map(
        (participant) =>
          `<span class="chip"${participant.isNpc ? ' data-tone="llm"' : ""}>${escapeHtml(participant.isNpc ? `NPC: ${participant.name}` : `Player: ${participant.name}`)}</span>`,
      )
      .join("");

    const transcript = selectedConversation.messages.length
      ? selectedConversation.messages
          .map(
            (message) =>
              `<div class="transcript-line"><strong>${escapeHtml(getPlayerLabel(message.playerId))}</strong>: ${escapeHtml(message.content)}</div>`,
          )
          .join("")
      : `<div class="transcript-line">${
          selectedConversation.state === "invited"
            ? "Invitation sent. Waiting for the invitee to respond."
            : selectedConversation.state === "walking"
              ? "Participants are walking to their rendezvous point."
              : "No transcript captured for this conversation yet."
        }</div>`;

    elements.conversationDetail.innerHTML = `
      <div class="detail-head">
        <div>
          <div class="detail-title">${escapeHtml(getConversationParticipantLabel(selectedConversation))}</div>
          <div class="detail-meta">Conversation #${selectedConversation.id} • ${escapeHtml(formatTick(lastActivityTick))} last activity</div>
        </div>
        <div class="chip-row">
          <span class="chip" data-tone="${getConversationTone(selectedConversation)}">${escapeHtml(selectedConversation.state)}</span>
          ${waitingLabel ? `<span class="chip" data-tone="warning">${escapeHtml(waitingLabel)}</span>` : ""}
        </div>
      </div>
      <div class="chip-row">${participantChips}</div>
      <div class="metric-grid">
        ${metrics
          .map(
            (metric) => `
              <div class="metric-card">
                <div class="metric-label">${escapeHtml(metric.label)}</div>
                <div class="metric-value">${escapeHtml(metric.value)}</div>
              </div>
            `,
          )
          .join("")}
      </div>
      ${
        selectedConversation.summary
          ? `<div class="detail-copy">${escapeHtml(selectedConversation.summary)}</div>`
          : ""
      }
      <div class="transcript">${transcript}</div>
    `;
  }

  elements.conversationGroups
    .querySelectorAll<HTMLElement>("[data-conversation-id]")
    .forEach((card) => {
      card.addEventListener("click", () => {
        const rawId = card.dataset.conversationId;
        if (!rawId) return;
        state.selectedConversationId = Number(rawId);
        scheduleRender();
      });
    });
}

function renderAutonomyPanel(
  filteredAutonomy: readonly NpcAutonomyDebugState[],
  stalledNpcIds: ReadonlySet<string>,
): void {
  const executingCount = filteredAutonomy.filter((debugState) => debugState.currentExecution).length;
  const plannedCount = filteredAutonomy.filter((debugState) => debugState.currentPlan).length;
  elements.autonomySummary.textContent = `${pluralize(filteredAutonomy.length, "NPC")} shown • ${pluralize(executingCount, "executing action")} • ${pluralize(plannedCount, "active plan")}`;

  if (filteredAutonomy.length === 0) {
    elements.autonomyList.innerHTML =
      '<div class="empty-state">No NPC autonomy state matches the current search and filters.</div>';
  } else {
    elements.autonomyList.innerHTML = filteredAutonomy
      .map((debugState) => {
        const player = getPlayer(debugState.npcId);
        const actionAge = debugState.currentExecution
          ? state.tick - debugState.currentExecution.startedAtTick
          : null;
        return `
          <article class="selectable-card${state.selectedNpcId === debugState.npcId ? " is-selected" : ""}" data-npc-id="${escapeHtml(debugState.npcId)}">
            <div class="card-head">
              <div>
                <div class="card-title">${escapeHtml(player?.name ?? debugState.npcId)}</div>
                <div class="card-meta">${escapeHtml(debugState.npcId)} • ${escapeHtml(player?.state ?? "unknown")} • @ ${escapeHtml(formatPoint(player))}</div>
              </div>
              <div class="chip-row">
                ${debugState.currentPlan?.source === "llm" ? '<span class="chip" data-tone="llm">LLM</span>' : ""}
                ${stalledNpcIds.has(debugState.npcId) ? '<span class="chip" data-tone="danger">Stalled</span>' : ""}
              </div>
            </div>
            <div class="card-meta">${
              debugState.currentPlan
                ? `Plan: ${escapeHtml(debugState.currentPlan.goalId.replaceAll("_", " "))}`
                : "No active plan"
            }</div>
            <div class="chip-row">
              <span class="chip">${escapeHtml(`Need ${Math.round(getLowestNeed(debugState))}`)}</span>
              <span class="chip">${escapeHtml(debugState.currentExecution?.actionLabel ?? "No action executing")}</span>
              ${
                typeof actionAge === "number"
                  ? `<span class="chip" data-tone="${actionAge >= EXECUTION_STUCK_TICKS ? "warning" : "active"}">${escapeHtml(formatAge(actionAge))}</span>`
                  : ""
              }
            </div>
          </article>
        `;
      })
      .join("");
  }

  const selectedState = state.selectedNpcId
    ? state.autonomy.get(state.selectedNpcId)
    : undefined;

  if (!selectedState) {
    elements.autonomyDetail.innerHTML =
      '<div class="empty-state">Select an NPC to inspect needs, active plan steps, and execution state.</div>';
  } else {
    const player = getPlayer(selectedState.npcId);
    const currentActionAge = selectedState.currentExecution
      ? state.tick - selectedState.currentExecution.startedAtTick
      : null;
    const metrics = [
      { label: "Position", value: formatPoint(player) },
      { label: "State", value: player?.state ?? "unknown" },
      {
        label: "Plan Source",
        value: selectedState.currentPlan?.source ?? "idle",
      },
      {
        label: "Current Action",
        value: selectedState.currentExecution?.actionLabel ?? "none",
      },
      {
        label: "Action Age",
        value: typeof currentActionAge === "number" ? formatAge(currentActionAge) : "—",
      },
      {
        label: "Failures",
        value: String(selectedState.consecutivePlanFailures),
      },
    ];

    const needRows = ([
      ["Health", selectedState.needs.health],
      ["Food", selectedState.needs.food],
      ["Water", selectedState.needs.water],
      ["Social", selectedState.needs.social],
    ] as Array<[string, number]>)
      .map(
        ([label, value]) => `
          <div class="need-row">
            <div class="need-header">
              <span>${escapeHtml(label)}</span>
              <span>${Math.round(value)}</span>
            </div>
            <div class="need-bar">
              <div class="need-fill" style="width: ${Math.max(0, Math.min(100, value))}%"></div>
            </div>
          </div>
        `,
      )
      .join("");

    const steps = selectedState.currentPlan?.steps.length
      ? selectedState.currentPlan.steps
          .map(
            (step) => `
              <div class="step-item${step.isCurrent ? " is-current" : ""}">
                <div class="step-title">Step ${step.index + 1}: ${escapeHtml(step.actionLabel)}</div>
                <div class="step-detail">${step.targetPosition ? `Target ${step.targetPosition.x}, ${step.targetPosition.y}` : "No explicit target"}</div>
              </div>
            `,
          )
          .join("")
      : '<div class="empty-state">No current plan steps.</div>';

    const inventoryEntries = Object.entries(selectedState.inventory);

    elements.autonomyDetail.innerHTML = `
      <div class="detail-head">
        <div>
          <div class="detail-title">${escapeHtml(player?.name ?? selectedState.npcId)}</div>
          <div class="detail-meta">${escapeHtml(selectedState.npcId)} • ${escapeHtml(player?.state ?? "unknown")} • @ ${escapeHtml(formatPoint(player))}</div>
        </div>
        <div class="chip-row">
          ${
            selectedState.currentPlan
              ? `<span class="chip"${selectedState.currentPlan.source === "llm" ? ' data-tone="llm"' : ""}>${escapeHtml(selectedState.currentPlan.source)} plan</span>`
              : '<span class="chip">idle</span>'
          }
          ${
            stalledNpcIds.has(selectedState.npcId)
              ? '<span class="chip" data-tone="danger">Stalled</span>'
              : ""
          }
          ${
            selectedState.goalSelectionInFlight
              ? '<span class="chip" data-tone="warning">Goal selection</span>'
              : ""
          }
        </div>
      </div>
      <div class="metric-grid">
        ${metrics
          .map(
            (metric) => `
              <div class="metric-card">
                <div class="metric-label">${escapeHtml(metric.label)}</div>
                <div class="metric-value">${escapeHtml(metric.value)}</div>
              </div>
            `,
          )
          .join("")}
      </div>
      <div class="need-list">${needRows}</div>
      ${
        selectedState.currentPlan?.reasoning
          ? `<div class="detail-copy">${escapeHtml(selectedState.currentPlan.reasoning)}</div>`
          : ""
      }
      <div class="steps-list">${steps}</div>
      ${
        inventoryEntries.length
          ? `<div class="detail-copy">Inventory: ${escapeHtml(
              inventoryEntries.map(([item, count]) => `${item} ×${count}`).join(", "),
            )}</div>`
          : '<div class="detail-copy">Inventory empty.</div>'
      }
    `;
  }

  elements.autonomyList
    .querySelectorAll<HTMLElement>("[data-npc-id]")
    .forEach((card) => {
      card.addEventListener("click", () => {
        const npcId = card.dataset.npcId;
        if (!npcId) return;
        state.selectedNpcId = npcId;
        scheduleRender();
      });
    });
}

function renderAlerts(alerts: readonly DashboardAlert[]): void {
  elements.alertsSummary.textContent = alerts.length
    ? `${pluralize(alerts.length, "alert")} active`
    : "No stuck-state alerts";

  if (alerts.length === 0) {
    elements.alertsList.innerHTML =
      '<div class="empty-state">No current alerts. Autonomy and conversation flows look healthy.</div>';
    return;
  }

  elements.alertsList.innerHTML = alerts
    .map(
      (alert) => `
        <article class="alert-card" data-severity="${alert.severity}" data-alert-id="${escapeHtml(alert.id)}">
          <div class="alert-title">${escapeHtml(alert.title)}</div>
          <div class="alert-meta">${escapeHtml(formatAge(alert.ageTicks))} • ${alert.targetNpcId ? escapeHtml(getPlayerLabel(alert.targetNpcId)) : `Conversation #${alert.targetConversationId}`}</div>
          <div class="alert-copy">${escapeHtml(alert.message)}</div>
        </article>
      `,
    )
    .join("");

  const alertsById = new Map(alerts.map((alert) => [alert.id, alert]));
  elements.alertsList
    .querySelectorAll<HTMLElement>("[data-alert-id]")
    .forEach((card) => {
      card.addEventListener("click", () => {
        const alert = alertsById.get(card.dataset.alertId ?? "");
        if (!alert) return;
        if (alert.targetConversationId) {
          focusConversation(alert.targetConversationId);
        } else if (alert.targetNpcId) {
          focusNpc(alert.targetNpcId);
        }
      });
    });
}

function renderEventFeed(events: readonly DebugFeedEvent[]): void {
  elements.eventFeedSummary.textContent = events.length
    ? `${pluralize(events.length, "event")} buffered`
    : "No events captured yet";

  if (events.length === 0) {
    elements.eventFeed.innerHTML =
      '<div class="empty-state">Waiting for conversations, plans, actions, and errors to enter the feed.</div>';
    return;
  }

  elements.eventFeed.innerHTML = events
    .map(
      (event) => `
        <article class="event-card" data-severity="${event.severity}" data-event-id="${event.id}">
          <div class="event-title">${escapeHtml(event.title)}</div>
          <div class="event-meta">${escapeHtml(formatTick(event.tick))} • ${escapeHtml(event.subjectType)} ${escapeHtml(event.subjectId)}</div>
          <div class="event-copy">${escapeHtml(event.message)}</div>
        </article>
      `,
    )
    .join("");

  const eventsById = new Map(events.map((event) => [String(event.id), event]));
  elements.eventFeed
    .querySelectorAll<HTMLElement>("[data-event-id]")
    .forEach((card) => {
      card.addEventListener("click", () => {
        const event = eventsById.get(card.dataset.eventId ?? "");
        if (!event) return;
        if (typeof event.relatedConversationId === "number") {
          focusConversation(event.relatedConversationId);
          return;
        }
        if (event.relatedNpcId) {
          focusNpc(event.relatedNpcId);
          return;
        }
        if (event.subjectType === "npc") {
          focusNpc(event.subjectId);
        }
      });
    });
}

function renderDashboard(): void {
  const alerts = deriveAlerts();
  const stalledNpcIds = new Set(
    alerts
      .map((alert) => alert.targetNpcId)
      .filter((npcId): npcId is string => Boolean(npcId)),
  );

  const conversationSearch = elements.conversationSearch.value.trim().toLowerCase();
  const conversationFilter = elements.conversationFilter.value as ConversationFilter;
  const conversationSort = elements.conversationSort.value as ConversationSort;

  const filteredConversations = [...state.conversations]
    .filter((conversation) =>
      !conversationSearch || getConversationSearchBlob(conversation).includes(conversationSearch),
    )
    .filter((conversation) =>
      getConversationMatchesFilter(conversation, conversationFilter),
    )
    .sort((left, right) => sortConversations(left, right, conversationSort));

  if (
    state.selectedConversationId === null ||
    !state.conversations.some((conversation) => conversation.id === state.selectedConversationId)
  ) {
    state.selectedConversationId = filteredConversations[0]?.id ?? null;
  } else if (
    filteredConversations.length > 0 &&
    !filteredConversations.some(
      (conversation) => conversation.id === state.selectedConversationId,
    )
  ) {
    state.selectedConversationId = filteredConversations[0].id;
  }

  const autonomySearch = elements.autonomySearch.value.trim().toLowerCase();
  const autonomyFilter = elements.autonomyFilter.value as AutonomyFilter;
  const autonomySort = elements.autonomySort.value as AutonomySort;
  const filteredAutonomy = [...state.autonomy.values()]
    .filter(
      (debugState) =>
        !autonomySearch || getAutonomySearchBlob(debugState).includes(autonomySearch),
    )
    .filter((debugState) =>
      getAutonomyMatchesFilter(debugState, autonomyFilter, stalledNpcIds),
    )
    .sort((left, right) => sortAutonomyStates(left, right, autonomySort, stalledNpcIds));

  if (
    state.selectedNpcId === null ||
    !state.autonomy.has(state.selectedNpcId)
  ) {
    state.selectedNpcId = filteredAutonomy[0]?.npcId ?? null;
  } else if (
    filteredAutonomy.length > 0 &&
    !filteredAutonomy.some((debugState) => debugState.npcId === state.selectedNpcId)
  ) {
    state.selectedNpcId = filteredAutonomy[0].npcId;
  }

  elements.connection.textContent = state.connected ? "Connected" : "Disconnected";
  elements.connection.classList.toggle("is-connected", state.connected);
  elements.connection.classList.toggle("is-disconnected", !state.connected);
  elements.tick.textContent = `Tick ${state.tick}`;

  renderCounters(alerts, stalledNpcIds);
  renderConversationPanel(filteredConversations);
  renderAutonomyPanel(filteredAutonomy, stalledNpcIds);
  renderAlerts(alerts);
  renderEventFeed(getSortedEvents());
}

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
      break;
    case "player_left":
      state.players.delete(message.data.id);
      state.autonomy.delete(message.data.id);
      break;
    case "debug_bootstrap":
      state.tick = message.data.tick;
      syncPlayers(message.data.players);
      state.conversations = [...message.data.conversations];
      state.autonomy = new Map(Object.entries(message.data.autonomyStates));
      state.events = [...message.data.recentEvents];
      break;
    case "debug_conversation_upsert":
      state.conversations = upsertConversationSnapshot(
        state.conversations,
        message.data,
      ).conversations;
      break;
    case "debug_conversation_message":
      state.conversations = appendConversationMessage(
        state.conversations,
        message.data,
      );
      break;
    case "debug_autonomy_upsert":
      state.autonomy.set(message.data.npcId, message.data);
      break;
    case "debug_event":
      pushEvent(message.data);
      break;
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

  scheduleRender();
}

for (const control of [
  elements.conversationSearch,
  elements.conversationSort,
  elements.conversationFilter,
  elements.autonomySearch,
  elements.autonomySort,
  elements.autonomyFilter,
]) {
  control.addEventListener("input", () => scheduleRender());
  control.addEventListener("change", () => scheduleRender());
}

client.onOpen(() => {
  state.connected = true;
  client.send({ type: "subscribe_debug" });
  scheduleRender();
});

client.onClose(() => {
  state.connected = false;
  scheduleRender();
});

client.onMessage(handleMessage);
client.connect();
renderDashboard();
