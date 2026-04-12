import { getVisibleRoomParticipants } from "./conversationRooms.js";
import {
  escapeHtml,
  formatAge,
  formatClientRole,
  formatIsoTimestamp,
  formatNpcPoint,
  formatRelativeTime,
  formatTick,
  getNpcDeathSummary,
  pluralize,
} from "./debugDashboardFormatting.js";
import {
  buildHistoryStepKey,
  buildPlanStepKey,
} from "./debugDashboardModel.js";
import type {
  ActivitySeverityFilter,
  CommandStatus,
  DashboardAlert,
  FrozenActivityState,
} from "./debugDashboardTypes.js";
import type {
  Conversation,
  ConversationRoom,
  DebugActionDefinition,
  DebugFeedEvent,
  DebugSystemSnapshot,
  NpcAutonomyDebugPlan,
  NpcAutonomyDebugState,
  PublicPlayer,
} from "./types.js";

interface ParticipantDisplayData {
  id: string;
  name: string;
  isNpc: boolean;
}

function describeGamePredicate(key: string, isPrecondition: boolean): string {
  const descriptions: Record<string, [string, string]> = {
    has_raw_food: [
      "NPC has raw food in inventory",
      "Adds raw food to inventory",
    ],
    has_cooked_food: [
      "NPC has cooked food in inventory",
      "Adds cooked food to inventory",
    ],
    near_campfire: ["NPC is next to a campfire", "Moves NPC near a campfire"],
    near_berry_bush: [
      "NPC is next to a berry bush",
      "Moves NPC near a berry bush",
    ],
    near_water_source: ["NPC is next to water", "Moves NPC near water"],
    near_pickupable: [
      "NPC is next to a pickupable item",
      "Moves NPC near a pickupable",
    ],
    near_player: [
      "NPC is near another player",
      "Moves NPC near another player",
    ],
    near_hostile: ["NPC is near a hostile entity", "Moves NPC near a hostile"],
    need_food_satisfied: [
      "Food need is above threshold",
      "Satisfies food need",
    ],
    need_water_satisfied: [
      "Water need is above threshold",
      "Satisfies water need",
    ],
    need_social_satisfied: [
      "Social need is above threshold",
      "Satisfies social need",
    ],
    escaped_hostile: ["NPC has escaped danger", "NPC flees to safety"],
  };
  const pair = descriptions[key];
  if (!pair) return "";
  return ` \u2014 ${isPrecondition ? pair[0] : pair[1]}`;
}

export function renderActionDetail(
  actionId: string,
  actionDefs: Record<string, DebugActionDefinition>,
): string {
  const def = actionDefs[actionId];
  if (!def) {
    return `<div class="action-detail"><div class="action-detail-empty">No definition found for <strong>${escapeHtml(actionId)}</strong></div></div>`;
  }

  const precondEntries = Object.entries(def.preconditions);
  const effectEntries = Object.entries(def.effects);

  const precondHtml =
    precondEntries.length > 0
      ? precondEntries
          .map(
            ([key, value]) =>
              `<div class="action-predicate"><span class="predicate-key">${escapeHtml(key)}</span> <span class="predicate-op">=</span> <span class="predicate-val">${escapeHtml(String(value))}</span><span class="predicate-desc">${escapeHtml(describeGamePredicate(key, true))}</span></div>`,
          )
          .join("")
      : '<div class="action-predicate muted">None</div>';

  const effectHtml =
    effectEntries.length > 0
      ? effectEntries
          .map(
            ([key, value]) =>
              `<div class="action-predicate"><span class="predicate-key">${escapeHtml(key)}</span> <span class="predicate-op">\u2192</span> <span class="predicate-val">${escapeHtml(String(value))}</span><span class="predicate-desc">${escapeHtml(describeGamePredicate(key, false))}</span></div>`,
          )
          .join("")
      : '<div class="action-predicate muted">Dynamic (set by planner)</div>';

  const proximityHtml = def.proximityRequirement
    ? `
      <div class="action-field">
        <span class="action-field-label">Proximity</span>
        <span>Must be near <strong>${escapeHtml(def.proximityRequirement.target)}</strong> (${escapeHtml(def.proximityRequirement.type)}, ${def.proximityRequirement.distance ?? 1} tile${(def.proximityRequirement.distance ?? 1) !== 1 ? "s" : ""})</span>
      </div>
    `
    : "";

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

function needFillClass(value: number): string {
  if (value >= 50) return "good";
  if (value >= 25) return "mid";
  return "low";
}

export function buildConversationCardHtml(options: {
  conversation: Conversation;
  room?: ConversationRoom;
  selected: boolean;
  participantLabel: string;
  tone: string;
  waitingLabel: string | null;
  durationTicks: number;
  getPlayerLabel: (playerId: string) => string;
}): string {
  const {
    conversation,
    room,
    selected,
    participantLabel,
    tone,
    waitingLabel,
    durationTicks,
    getPlayerLabel,
  } = options;
  const participantCount = room ? getVisibleRoomParticipants(room).length : 2;
  return `
    <button type="button" class="list-card list-card-button${selected ? " selected" : ""}" data-convo-id="${conversation.id}">
      <div class="list-card-header">
        <span class="list-card-title">${escapeHtml(participantLabel)}</span>
        <span class="chip ${tone}">${escapeHtml(conversation.state)}</span>
      </div>
      <div class="list-card-meta">
        #${conversation.id}${room ? ` \u2022 ${participantCount} participants` : ""}
      </div>
      <div class="list-card-chips">
        <span class="chip">${pluralize(conversation.messages.length, "msg")}</span>
        <span class="chip">${escapeHtml(formatAge(durationTicks))}</span>
        ${waitingLabel ? `<span class="chip warning">${escapeHtml(waitingLabel)}</span>` : ""}
        ${room?.turn.lastSpeakerId ? `<span class="chip">Last: ${escapeHtml(getPlayerLabel(room.turn.lastSpeakerId))}</span>` : ""}
      </div>
    </button>
  `;
}

export function buildConversationDetailHtml(options: {
  conversation: Conversation;
  room?: ConversationRoom;
  participantLabel: string;
  participants: readonly ParticipantDisplayData[];
  tone: string;
  waitingLabel: string | null;
  metrics: ReadonlyArray<{ label: string; value: string }>;
  summary?: string | null;
  getPlayerLabel: (playerId: string) => string;
}): string {
  const {
    conversation,
    room,
    participantLabel,
    participants,
    tone,
    waitingLabel,
    metrics,
    summary,
    getPlayerLabel,
  } = options;
  const participantChips = participants
    .map(
      (participant) =>
        `<span class="chip ${participant.isNpc ? "llm" : "accent"}">${escapeHtml(participant.isNpc ? `NPC: ${participant.name}` : participant.name)}</span>`,
    )
    .join("");

  let transcript: string;
  if (conversation.messages.length > 0) {
    transcript = conversation.messages
      .map(
        (message) =>
          `<div class="transcript-msg"><strong>${escapeHtml(getPlayerLabel(message.playerId))}</strong>: ${escapeHtml(message.content)}</div>`,
      )
      .join("");
  } else if (conversation.state === "invited") {
    transcript =
      '<div class="transcript-empty">Invitation sent. Waiting for response.</div>';
  } else if (conversation.state === "walking") {
    transcript =
      '<div class="transcript-empty">Participants walking to rendezvous.</div>';
  } else {
    transcript = '<div class="transcript-empty">No messages yet.</div>';
  }

  const roomParticipants = room ? getVisibleRoomParticipants(room) : [];
  const rosterHtml = room
    ? `
      <div class="detail-section-label">Room Roster</div>
      <div class="room-roster">
        ${roomParticipants
          .map(
            (participant) => `
          <div class="room-roster-row">
            <div>
              <div class="room-roster-name">${escapeHtml(getPlayerLabel(participant.playerId))}</div>
              <div class="room-roster-meta">${escapeHtml(participant.role)} \u2022 ${escapeHtml(participant.inviteStatus)} \u2022 ${escapeHtml(participant.presenceStatus)}</div>
            </div>
            ${room.turn.lastSpeakerId === participant.playerId ? '<span class="chip accent">Last speaker</span>' : ""}
          </div>
        `,
          )
          .join("")}
      </div>
    `
    : "";

  const roomSummaryHtml = room
    ? `
      <div class="inventory-text">
        Turn: ${escapeHtml(room.turn.mode)}${room.turn.expectedSpeakerIds.length > 0 ? ` \u2022 Expected: ${escapeHtml(room.turn.expectedSpeakerIds.map((playerId) => getPlayerLabel(playerId)).join(", "))}` : ""}
        ${room.anchor ? ` \u2022 Anchor ${Math.round(room.anchor.x)}, ${Math.round(room.anchor.y)}` : ""}
        \u2022 Radius ${room.radius}
      </div>
    `
    : "";

  return `
    <div class="detail-header">
      <div>
        <div class="detail-title">${escapeHtml(participantLabel)}</div>
        <div class="detail-subtitle">Conversation #${conversation.id}</div>
      </div>
      <div class="detail-chips">
        <span class="chip ${tone}">${escapeHtml(conversation.state)}</span>
        ${waitingLabel ? `<span class="chip warning">${escapeHtml(waitingLabel)}</span>` : ""}
      </div>
    </div>
    <div class="detail-chips" style="margin-bottom:16px">${participantChips}</div>
    <div class="metrics">
      ${metrics
        .map(
          (metric) => `
        <div class="metric">
          <div class="metric-label">${escapeHtml(metric.label)}</div>
          <div class="metric-value">${escapeHtml(metric.value)}</div>
        </div>
      `,
        )
        .join("")}
    </div>
    ${summary ? `<div class="inventory-text">${escapeHtml(summary)}</div>` : ""}
    ${roomSummaryHtml}
    ${rosterHtml}
    <div class="detail-section-label">Transcript</div>
    <div class="transcript">${transcript}</div>
  `;
}

export function buildNpcCardHtml(options: {
  npcState: NpcAutonomyDebugState;
  player?: PublicPlayer;
  selected: boolean;
  stalled: boolean;
  isDead: boolean;
  lastKnownPlan?: NpcAutonomyDebugPlan | null;
  fallbackName: string;
}): string {
  const {
    npcState,
    player,
    selected,
    stalled,
    isDead,
    lastKnownPlan,
    fallbackName,
  } = options;
  let statusChip = "";
  if (isDead) {
    statusChip = '<span class="chip dead">Dead</span>';
  } else if (stalled) {
    statusChip = '<span class="chip danger">Stalled</span>';
  } else if (npcState.currentExecution) {
    statusChip = '<span class="chip active">Executing</span>';
  } else if (npcState.currentPlan) {
    statusChip = '<span class="chip accent">Planned</span>';
  } else if (npcState.goalSelectionInFlight) {
    statusChip = '<span class="chip warning">Thinking</span>';
  } else {
    statusChip = '<span class="chip ended">Idle</span>';
  }

  const sourceChip = npcState.currentPlan
    ? `<span class="chip${npcState.currentPlan.source === "llm" ? " llm" : ""}">${escapeHtml(npcState.currentPlan.source)}</span>`
    : "";

  const activePlan = npcState.currentPlan;
  const displayPlan = activePlan ?? lastKnownPlan ?? null;
  const isStale = !activePlan && displayPlan !== null;
  let planHtml = "";
  if (displayPlan?.steps.length) {
    const label = isStale ? "Last plan" : "Plan";
    const goalLabel = escapeHtml(displayPlan.goalId.replaceAll("_", " "));
    planHtml = `<div class="card-plan${isStale ? " stale" : ""}">
      <div class="card-plan-label">${label}: ${goalLabel}</div>
      ${displayPlan.steps
        .map(
          (step) =>
            `<div class="card-step${!isStale && step.isCurrent ? " current" : ""}"><span class="card-step-num">${step.index + 1}</span>${escapeHtml(step.actionLabel)}${step.targetPosition ? ` \u2192 ${step.targetPosition.x},${step.targetPosition.y}` : ""}</div>`,
        )
        .join("")}</div>`;
  }

  const deathHtml =
    isDead && npcState.death
      ? `<div class="inventory-text">Died: ${escapeHtml(getNpcDeathSummary(npcState))}</div>`
      : "";

  return `
    <button type="button" class="list-card list-card-button${selected ? " selected" : ""}" data-npc-id="${escapeHtml(npcState.npcId)}">
      <div class="list-card-header">
        <span class="list-card-title">${escapeHtml(fallbackName)}</span>
        ${statusChip}
      </div>
      <div class="list-card-meta">
        ${isDead ? "dead" : escapeHtml(npcState.lastState ?? player?.state ?? "unknown")} \u2022 ${escapeHtml(formatNpcPoint(npcState, player))}${activePlan ? ` \u2022 ${escapeHtml(activePlan.goalId.replaceAll("_", " "))}` : ""}
      </div>
      ${sourceChip ? `<div class="list-card-chips">${sourceChip}</div>` : ""}
      ${deathHtml}
      ${planHtml}
    </button>
  `;
}

export function buildNpcDetailHtml(options: {
  npcState: NpcAutonomyDebugState;
  player?: PublicPlayer;
  tick: number;
  stalled: boolean;
  isDead: boolean;
  alerts: readonly DashboardAlert[];
  lastKnownPlan?: NpcAutonomyDebugPlan | null;
  expandedActions: ReadonlySet<string>;
  actionDefs: Record<string, DebugActionDefinition>;
  title: string;
}): string {
  const {
    npcState,
    player,
    tick,
    stalled,
    isDead,
    alerts,
    lastKnownPlan,
    expandedActions,
    actionDefs,
    title,
  } = options;
  const actionAge = npcState.currentExecution
    ? tick - npcState.currentExecution.startedAtTick
    : null;
  const metrics = [
    { label: "Position", value: formatNpcPoint(npcState, player) },
    {
      label: "State",
      value: isDead
        ? "dead"
        : (npcState.lastState ?? player?.state ?? "unknown"),
    },
    {
      label: "Plan Source",
      value: npcState.currentPlan?.source ?? (isDead ? "dead" : "idle"),
    },
    {
      label: "Current Action",
      value: npcState.currentExecution?.actionLabel ?? "none",
    },
    {
      label: "Action Age",
      value: typeof actionAge === "number" ? formatAge(actionAge) : "\u2014",
    },
    { label: "Failures", value: String(npcState.consecutivePlanFailures) },
  ];

  const needsHtml = (
    [
      ["Health", npcState.needs.health],
      ["Food", npcState.needs.food],
      ["Water", npcState.needs.water],
      ["Social", npcState.needs.social],
    ] as [string, number][]
  )
    .map(
      ([label, value]) => `
      <div class="need-row">
        <span class="need-label">${escapeHtml(label)}</span>
        <div class="need-bar"><div class="need-fill ${needFillClass(value)}" style="width:${Math.max(0, Math.min(100, value))}%"></div></div>
        <span class="need-value">${Math.round(value)}</span>
      </div>
    `,
    )
    .join("");

  const npcAlerts = alerts.filter(
    (alert) => alert.targetNpcId === npcState.npcId,
  );
  const stalledHtml =
    npcAlerts.length > 0
      ? `
      <div class="stalled-section">
        <div class="section-label">Stalled \u2014 Why?</div>
        ${npcAlerts
          .map(
            (alert) => `
          <div class="stalled-reason ${alert.severity}">
            <div class="stalled-reason-title">${escapeHtml(alert.title)}</div>
            <div class="stalled-reason-msg">${escapeHtml(alert.message)}</div>
          </div>
        `,
          )
          .join("")}
      </div>
    `
      : "";

  const deathHtml =
    isDead && npcState.death
      ? `
      <div class="stalled-section">
        <div class="section-label">Death</div>
        <div class="stalled-reason danger">
          <div class="stalled-reason-title">${escapeHtml(formatTick(npcState.death.tick))}</div>
          <div class="stalled-reason-msg">${escapeHtml(getNpcDeathSummary(npcState))}</div>
        </div>
      </div>
    `
      : "";

  const detailPlan = npcState.currentPlan ?? lastKnownPlan ?? null;
  const detailPlanStale = !npcState.currentPlan && detailPlan !== null;
  let stepsHtml = "";
  if (detailPlan?.steps.length) {
    const stepsLabel = detailPlanStale
      ? `Last Plan: ${escapeHtml(detailPlan.goalId.replaceAll("_", " "))}`
      : "Plan Steps";
    stepsHtml = `
      <div class="plan-steps${detailPlanStale ? " stale" : ""}">
        <div class="detail-section-label">${stepsLabel}</div>
        ${detailPlan.steps
          .map((step) => {
            const stepKey = buildPlanStepKey(npcState.npcId, detailPlan, step);
            return `
          <button type="button" class="step-item step-item-button clickable${!detailPlanStale && step.isCurrent ? " current" : ""}" data-step-key="${escapeHtml(stepKey)}" data-action-id="${escapeHtml(step.actionId)}">
            <span class="step-num">${step.index + 1}</span>
            <span>${escapeHtml(step.actionLabel)}${step.targetPosition ? ` \u2192 ${step.targetPosition.x},${step.targetPosition.y}` : ""}</span>
          </button>
          ${expandedActions.has(stepKey) ? renderActionDetail(step.actionId, actionDefs) : ""}
        `;
          })
          .join("")}
      </div>
    `;
  }

  const inventoryEntries = Object.entries(npcState.inventory);
  const inventoryHtml = inventoryEntries.length
    ? `<div class="inventory-text">Inventory: ${escapeHtml(inventoryEntries.map(([item, count]) => `${item} \u00d7${count}`).join(", "))}</div>`
    : '<div class="inventory-text">Inventory empty.</div>';

  const history = npcState.planHistory ?? [];
  const reversedHistory = [...history].reverse();
  let historyHtml = "";
  if (reversedHistory.length > 0) {
    const failCount = reversedHistory.filter(
      (entry) => entry.outcome === "failed",
    ).length;
    const retryCount = reversedHistory.filter((entry, index) => {
      if (entry.outcome !== "failed" || index >= reversedHistory.length - 1) {
        return false;
      }
      return reversedHistory[index + 1]?.goalId === entry.goalId;
    }).length;
    const summaryParts = [pluralize(reversedHistory.length, "plan")];
    if (failCount > 0) summaryParts.push(`${failCount} failed`);
    if (retryCount > 0)
      summaryParts.push(
        `${retryCount} ${retryCount === 1 ? "retry" : "retries"}`,
      );

    historyHtml = `
      <div class="plan-history-section">
        <div class="section-label">Plan History (${summaryParts.join(" \u2022 ")})</div>
        <div class="plan-history-timeline">
          ${reversedHistory
            .map((entry) => {
              const outcomeClass =
                entry.outcome === "completed"
                  ? "completed"
                  : entry.outcome === "failed"
                    ? "failed"
                    : entry.outcome === "interrupted"
                      ? "interrupted"
                      : "running";
              const duration =
                entry.endedTick !== null
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
                  ${
                    entry.steps.length > 0
                      ? `<div class="history-steps">${entry.steps
                          .map((step) => {
                            const stepKey = buildHistoryStepKey(
                              npcState.npcId,
                              entry,
                              step,
                            );
                            return `<button type="button" class="history-step-chip history-step-chip-button clickable" data-step-key="${escapeHtml(stepKey)}" data-action-id="${escapeHtml(step.actionId)}">${escapeHtml(step.actionLabel)}</button>${expandedActions.has(stepKey) ? renderActionDetail(step.actionId, actionDefs) : ""}`;
                          })
                          .join("")}</div>`
                      : ""
                  }
                </div>
              </div>
            `;
            })
            .join("")}
        </div>
      </div>
    `;
  }

  let headerChips = "";
  if (isDead) {
    headerChips += '<span class="chip dead">Dead</span>';
  } else if (npcState.currentPlan) {
    headerChips += `<span class="chip ${npcState.currentPlan.source === "llm" ? "llm" : ""}">${escapeHtml(npcState.currentPlan.source)} plan</span>`;
  } else {
    headerChips += '<span class="chip ended">idle</span>';
  }
  if (stalled) {
    headerChips += '<span class="chip danger">Stalled</span>';
  }
  if (npcState.goalSelectionInFlight) {
    headerChips += '<span class="chip warning">Goal selection</span>';
  }

  return `
    <div class="detail-header">
      <div>
        <div class="detail-title">${escapeHtml(title)}</div>
        <div class="detail-subtitle">${escapeHtml(npcState.npcId)}</div>
      </div>
      <div class="detail-chips">
        ${headerChips}
        ${expandedActions.size > 0 ? '<button class="collapse-all-btn" id="collapse-all-actions">Collapse all</button>' : ""}
      </div>
    </div>
    ${deathHtml}
    ${stalledHtml}
    <div class="metrics">
      ${metrics
        .map(
          (metric) => `
        <div class="metric">
          <div class="metric-label">${escapeHtml(metric.label)}</div>
          <div class="metric-value">${escapeHtml(metric.value)}</div>
        </div>
      `,
        )
        .join("")}
    </div>
    <div class="needs-section">
      <div class="section-label">Needs</div>
      ${needsHtml}
    </div>
    ${npcState.currentPlan?.reasoning ? `<div class="inventory-text">${escapeHtml(npcState.currentPlan.reasoning)}</div>` : ""}
    ${stepsHtml}
    ${inventoryHtml}
    ${historyHtml}
  `;
}

function alertMatchesSeverity(
  alert: DashboardAlert,
  filter: ActivitySeverityFilter,
): boolean {
  if (filter === "all") return true;
  if (filter === "danger") return alert.severity === "danger";
  if (filter === "warning") return alert.severity === "warning";
  return false;
}

function eventMatchesSeverity(
  event: DebugFeedEvent,
  filter: ActivitySeverityFilter,
): boolean {
  if (filter === "all") return true;
  return event.severity === filter;
}

function getActivitySearchBlob(item: DashboardAlert | DebugFeedEvent): string {
  if ("ageTicks" in item) {
    return `${item.title} ${item.message} ${item.targetNpcId ?? ""} ${item.targetConversationId ?? ""}`.toLowerCase();
  }
  return `${item.title} ${item.message} ${item.subjectType} ${item.subjectId}`.toLowerCase();
}

function renderPinButton(
  itemKey: string,
  label: string,
  active: boolean,
): string {
  return `
    <button
      class="pin-btn${active ? " active" : ""}"
      type="button"
      data-pin-key="${escapeHtml(itemKey)}"
      aria-label="${escapeHtml(active ? `Unpin ${label}` : `Pin ${label}`)}"
      title="${escapeHtml(active ? `Unpin ${label}` : `Pin ${label}`)}"
    >Pin</button>
  `;
}

export function buildActivityHtml(options: {
  snapshot: FrozenActivityState;
  activityPaused: boolean;
  activitySeverityFilter: ActivitySeverityFilter;
  activitySearch: string;
  pinnedItems: ReadonlySet<string>;
  getPlayerLabel: (playerId: string) => string;
}): string {
  const {
    snapshot,
    activityPaused,
    activitySeverityFilter,
    activitySearch,
    pinnedItems,
    getPlayerLabel,
  } = options;
  const search = activitySearch.trim().toLowerCase();
  const filteredAlerts = snapshot.alerts.filter(
    (alert) =>
      alertMatchesSeverity(alert, activitySeverityFilter) &&
      (!search || getActivitySearchBlob(alert).includes(search)),
  );
  const filteredEvents = snapshot.events.filter(
    (event) =>
      eventMatchesSeverity(event, activitySeverityFilter) &&
      (!search || getActivitySearchBlob(event).includes(search)),
  );
  const pinnedAlerts = filteredAlerts.filter((alert) =>
    pinnedItems.has(`alert:${alert.id}`),
  );
  const pinnedEvents = filteredEvents.filter((event) =>
    pinnedItems.has(`event:${event.id}`),
  );
  const unpinnedAlerts = filteredAlerts.filter(
    (alert) => !pinnedItems.has(`alert:${alert.id}`),
  );
  const unpinnedEvents = filteredEvents.filter(
    (event) => !pinnedItems.has(`event:${event.id}`),
  );

  let html = "";

  if (activityPaused) {
    html += `<div class="freeze-banner">Feed paused ${formatRelativeTime(snapshot.capturedAt)}. Live events are still buffering in the background.</div>`;
  }

  if (pinnedAlerts.length > 0 || pinnedEvents.length > 0) {
    html += '<div class="section-divider">Pinned</div>';
    html += pinnedAlerts
      .map(
        (alert) => `
      <div class="alert-card ${alert.severity}" data-alert-id="${escapeHtml(alert.id)}">
        <div class="card-row">
          <div class="alert-title">${escapeHtml(alert.title)}</div>
          ${renderPinButton(`alert:${alert.id}`, alert.title, true)}
        </div>
        <div class="alert-body">${escapeHtml(alert.message)}</div>
        <div class="alert-meta">${escapeHtml(formatAge(alert.ageTicks))} \u2022 ${alert.targetNpcId ? escapeHtml(getPlayerLabel(alert.targetNpcId)) : `Conversation #${alert.targetConversationId}`}</div>
      </div>
    `,
      )
      .join("");
    html += pinnedEvents
      .map((event) => {
        const borderClass =
          event.severity === "error"
            ? "error-border"
            : event.severity === "warning"
              ? "warning-border"
              : "";
        return `
        <div class="event-card ${borderClass}" data-event-id="${event.id}">
          <div class="card-row">
            <div class="event-title">${escapeHtml(event.title)}</div>
            ${renderPinButton(`event:${event.id}`, event.title, true)}
          </div>
          <div class="event-body">${escapeHtml(event.message)}</div>
          <div class="event-meta">${escapeHtml(formatTick(event.tick))} \u2022 ${escapeHtml(event.subjectType)} ${escapeHtml(event.subjectId)}</div>
        </div>
      `;
      })
      .join("");
  }

  html += '<div class="section-divider">Alerts</div>';
  if (unpinnedAlerts.length === 0) {
    html +=
      '<div class="empty-state">No stuck-state alerts. Everything looks healthy.</div>';
  } else {
    html += unpinnedAlerts
      .map(
        (alert) => `
      <div class="alert-card ${alert.severity}" data-alert-id="${escapeHtml(alert.id)}">
        <div class="card-row">
          <div class="alert-title">${escapeHtml(alert.title)}</div>
          ${renderPinButton(`alert:${alert.id}`, alert.title, false)}
        </div>
        <div class="alert-body">${escapeHtml(alert.message)}</div>
        <div class="alert-meta">${escapeHtml(formatAge(alert.ageTicks))} \u2022 ${alert.targetNpcId ? escapeHtml(getPlayerLabel(alert.targetNpcId)) : `Conversation #${alert.targetConversationId}`}</div>
      </div>
    `,
      )
      .join("");
  }

  html += '<div class="section-divider">Event Feed</div>';
  if (unpinnedEvents.length === 0) {
    html += '<div class="empty-state">Waiting for events.</div>';
  } else {
    html += unpinnedEvents
      .map((event) => {
        const borderClass =
          event.severity === "error"
            ? "error-border"
            : event.severity === "warning"
              ? "warning-border"
              : "";
        return `
        <div class="event-card ${borderClass}" data-event-id="${event.id}">
          <div class="card-row">
            <div class="event-title">${escapeHtml(event.title)}</div>
            ${renderPinButton(`event:${event.id}`, event.title, false)}
          </div>
          <div class="event-body">${escapeHtml(event.message)}</div>
          <div class="event-meta">${escapeHtml(formatTick(event.tick))} \u2022 ${escapeHtml(event.subjectType)} ${escapeHtml(event.subjectId)}</div>
        </div>
      `;
      })
      .join("");
  }

  return html;
}

export function buildSystemBadgeCount(options: {
  connected: boolean;
  system: DebugSystemSnapshot | null;
  alerts: readonly DashboardAlert[];
}): number {
  const disconnected = options.connected ? 0 : 1;
  const providerIssue =
    options.system?.providerDiagnostics?.primaryAvailable === false ? 1 : 0;
  const screenshotStale = options.system?.lastScreenshot ? 0 : 1;
  return disconnected + providerIssue + screenshotStale + options.alerts.length;
}

export function buildSystemHtml(options: {
  system: DebugSystemSnapshot | null;
  connected: boolean;
  lastMessageAt: number | null;
  reconnectCount: number;
  alerts: readonly DashboardAlert[];
  selectedNpcId: string | null;
  selectedConversationPlayerIds: readonly string[];
  players: readonly PublicPlayer[];
  screenshotUrl: string | null;
  scenarios: readonly string[];
  commandStatus: CommandStatus;
  tick: number;
  debugToken: string | null;
}): string {
  const {
    system,
    connected,
    lastMessageAt,
    reconnectCount,
    alerts,
    selectedNpcId,
    selectedConversationPlayerIds,
    players,
    screenshotUrl,
    scenarios,
    commandStatus,
    tick,
    debugToken,
  } = options;
  const world = system?.world ?? { width: 1, height: 1 };
  const clients = system?.connectedClients ?? [];
  const provider = system?.providerDiagnostics;
  const highlightedPlayerIds = new Set<string>(selectedConversationPlayerIds);
  if (selectedNpcId) {
    highlightedPlayerIds.add(selectedNpcId);
  }

  const playerDots = players
    .map((player) => {
      const left = (player.x / Math.max(1, world.width)) * 100;
      const top = (player.y / Math.max(1, world.height)) * 100;
      const classes = [
        "map-dot",
        player.isNpc ? "npc" : "human",
        highlightedPlayerIds.has(player.id) ? "highlight" : "",
      ]
        .filter(Boolean)
        .join(" ");
      return `<button class="${classes}" type="button" data-map-player="${escapeHtml(player.id)}" style="left:${left}%;top:${top}%"><span>${escapeHtml(player.name)}</span></button>`;
    })
    .join("");
  const entityDots = (system?.entities ?? [])
    .map((entity) => {
      const left = (entity.position.x / Math.max(1, world.width)) * 100;
      const top = (entity.position.y / Math.max(1, world.height)) * 100;
      return `<div class="map-entity" style="left:${left}%;top:${top}%">${escapeHtml(entity.type.slice(0, 1).toUpperCase())}</div>`;
    })
    .join("");

  const scenarioOptions = scenarios
    .map(
      (scenario) =>
        `<option value="${escapeHtml(scenario)}">${escapeHtml(scenario)}</option>`,
    )
    .join("");

  const screenshotHtml = screenshotUrl
    ? `
      <div class="system-shot-meta">
        ${
          system?.lastScreenshot
            ? `Latest capture from ${escapeHtml(system.lastScreenshot.clientId)} at ${escapeHtml(formatIsoTimestamp(system.lastScreenshot.capturedAt))}`
            : "Latest capture"
        }
      </div>
      <img class="system-shot" src="${escapeHtml(screenshotUrl)}" alt="Latest gameplay capture" />
    `
    : '<div class="empty-state compact">No screenshot captured yet.</div>';

  const commandStatusClass =
    commandStatus.kind !== "idle"
      ? `command-status ${commandStatus.kind}`
      : "command-status";

  return `
    <div class="system-grid">
      <section class="system-card">
        <div class="system-card-title">Transport</div>
        <div class="metrics compact">
          <div class="metric"><div class="metric-label">Connection</div><div class="metric-value">${escapeHtml(connected ? "Connected" : "Disconnected")}</div></div>
          <div class="metric"><div class="metric-label">Mode</div><div class="metric-value">${escapeHtml(system?.mode ?? "\u2014")}</div></div>
          <div class="metric"><div class="metric-label">Tick Rate</div><div class="metric-value">${escapeHtml(system ? String(system.tickRate) : "\u2014")}</div></div>
          <div class="metric"><div class="metric-label">Last Event</div><div class="metric-value">${escapeHtml(formatRelativeTime(lastMessageAt))}</div></div>
          <div class="metric"><div class="metric-label">Reconnects</div><div class="metric-value">${reconnectCount}</div></div>
          <div class="metric"><div class="metric-label">Alerts</div><div class="metric-value">${alerts.length}</div></div>
        </div>
      </section>
      <section class="system-card">
        <div class="system-card-title">Commands</div>
        <div class="command-row">
          <button class="command-btn" type="button" data-command="tick" data-count="1">Tick 1</button>
          <button class="command-btn" type="button" data-command="tick" data-count="10">Tick 10</button>
          <button class="command-btn" type="button" data-command="reset">Reset</button>
          <button class="command-btn" type="button" data-command="mode" data-mode="stepped">Stepped</button>
          <button class="command-btn" type="button" data-command="mode" data-mode="realtime">Realtime</button>
        </div>
        <form id="tick-form" class="system-form">
          <label>Advance ticks <input name="count" type="number" min="1" value="25" /></label>
          <button class="command-btn" type="submit">Run</button>
        </form>
        <form id="scenario-form" class="system-form">
          <label>Scenario <select name="scenario">${scenarioOptions}</select></label>
          <button class="command-btn" type="submit" ${scenarios.length === 0 ? "disabled" : ""}>Load</button>
        </form>
        <form id="spawn-form" class="system-form multi">
          <label>ID <input name="id" value="debug_npc_${tick}" /></label>
          <label>Name <input name="name" value="Debug NPC" /></label>
          <label>X <input name="x" type="number" value="1" /></label>
          <label>Y <input name="y" type="number" value="1" /></label>
          <label class="checkbox"><input name="isNpc" type="checkbox" checked /> NPC</label>
          <button class="command-btn" type="submit">Spawn</button>
        </form>
        <form id="start-convo-form" class="system-form multi">
          <label>Player 1 <input name="player1Id" placeholder="alice" /></label>
          <label>Player 2 <input name="player2Id" placeholder="bob" /></label>
          <button class="command-btn" type="submit">Start Convo</button>
        </form>
        <form id="token-form" class="system-form">
          <label>Debug token <input name="token" value="${escapeHtml(debugToken ?? "")}" placeholder="optional" /></label>
          <button class="command-btn" type="submit">Save token</button>
        </form>
        <div class="${commandStatusClass}">${escapeHtml(commandStatus.message || "Idle")}</div>
      </section>
      <section class="system-card system-map-card">
        <div class="system-card-title">Town Minimap</div>
        <div class="map-surface">
          ${entityDots}
          ${playerDots}
        </div>
      </section>
      <section class="system-card">
        <div class="system-card-title">Clients</div>
        <div class="client-list">
          ${
            clients.length === 0
              ? '<div class="empty-state compact">No clients connected.</div>'
              : clients
                  .map(
                    (clientSummary) => `
            <div class="client-row">
              <div>
                <div class="client-label">${escapeHtml(clientSummary.label)}</div>
                <div class="client-meta">${escapeHtml(clientSummary.clientId)} \u2022 ${escapeHtml(formatClientRole(clientSummary.role))} \u2022 ${escapeHtml(formatIsoTimestamp(clientSummary.connectedAt))}</div>
              </div>
              <div class="detail-chips">
                ${clientSummary.debugSubscribed ? '<span class="chip accent">debug</span>' : ""}
                ${clientSummary.canCaptureScreenshot ? `<button class="command-btn compact" type="button" data-command="capture" data-client-id="${escapeHtml(clientSummary.clientId)}">Capture</button>` : '<span class="chip ended">no capture</span>'}
              </div>
            </div>
          `,
                  )
                  .join("")
          }
        </div>
      </section>
      <section class="system-card">
        <div class="system-card-title">Provider Health</div>
        ${
          provider
            ? `
            <div class="metrics compact">
              <div class="metric"><div class="metric-label">Provider</div><div class="metric-value">${escapeHtml(provider.provider)}</div></div>
              <div class="metric"><div class="metric-label">Primary</div><div class="metric-value">${escapeHtml(provider.primaryProvider)}</div></div>
              <div class="metric"><div class="metric-label">Fallback</div><div class="metric-value">${escapeHtml(provider.fallbackProvider)}</div></div>
              <div class="metric"><div class="metric-label">Primary Available</div><div class="metric-value">${escapeHtml(provider.primaryAvailable ? "yes" : "no")}</div></div>
            </div>
            ${provider.lastError ? `<div class="inventory-text">Last error: ${escapeHtml(provider.lastError.message)}</div>` : ""}
            <div class="provider-events">
              ${provider.events
                .slice(-6)
                .reverse()
                .map(
                  (event) => `
                <div class="provider-event">
                  <div class="event-title">${escapeHtml(event.message)}</div>
                  <div class="event-meta">${escapeHtml(formatIsoTimestamp(event.timestamp))} \u2022 ${escapeHtml(event.phase)} \u2022 ${escapeHtml(event.outcome)}</div>
                </div>
              `,
                )
                .join("")}
            </div>
          `
            : '<div class="empty-state compact">Provider diagnostics unavailable.</div>'
        }
      </section>
      <section class="system-card">
        <div class="card-row">
          <div class="system-card-title">Screenshots</div>
          <button class="command-btn compact" type="button" data-command="capture">Capture any client</button>
        </div>
        ${screenshotHtml}
      </section>
    </div>
  `;
}
