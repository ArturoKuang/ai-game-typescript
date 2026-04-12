import { formatAge, pluralize } from "./debugDashboardFormatting.js";
import { getVisibleNpcStates } from "./debugDashboardModel.js";
import type { DashboardAlert } from "./debugDashboardTypes.js";
import type {
  Conversation,
  NpcAutonomyDebugState,
  PublicPlayer,
} from "./types.js";

const EXECUTION_STUCK_TICKS = 180;
const CONVERSATION_QUIET_TICKS = 180;
const INVITE_STUCK_TICKS = 120;
const GOAL_SELECTION_STUCK_TICKS = 160;
const PLAN_FAILURE_ALERT_THRESHOLD = 2;
const CRITICAL_NEED_THRESHOLD = 15;
const DANGER_NEED_THRESHOLD = 8;

type NeedLabel = "health" | "food" | "water" | "social";

export interface DashboardAlertDerivationOptions {
  tick: number;
  conversations: readonly Conversation[];
  autonomy: Iterable<NpcAutonomyDebugState>;
  players: ReadonlyMap<string, PublicPlayer>;
  deadNpcIds: ReadonlySet<string>;
  getConversationParticipantLabel: (conversation: Conversation) => string;
  getPlayerLabel: (playerId: string) => string;
}

export function deriveDashboardAlerts(
  options: DashboardAlertDerivationOptions,
): DashboardAlert[] {
  const alerts: DashboardAlert[] = [];

  for (const conversation of options.conversations) {
    if (conversation.state === "ended") continue;
    const lastMessageTick =
      conversation.messages[conversation.messages.length - 1]?.tick ??
      conversation.startedTick;
    const quietAge = options.tick - lastMessageTick;
    const inviteAge = options.tick - conversation.startedTick;

    if (
      conversation.state === "active" &&
      quietAge >= CONVERSATION_QUIET_TICKS
    ) {
      alerts.push({
        id: `conversation-quiet-${conversation.id}`,
        severity:
          quietAge >= CONVERSATION_QUIET_TICKS * 2 ? "danger" : "warning",
        title: "Conversation quiet",
        message: `${options.getConversationParticipantLabel(conversation)} has been active without a new message for ${formatAge(quietAge)}.`,
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
        title:
          conversation.state === "invited"
            ? "Invite pending too long"
            : "Rendezvous stalled",
        message: `${options.getConversationParticipantLabel(conversation)} has been ${conversation.state} for ${formatAge(inviteAge)}.`,
        ageTicks: inviteAge,
        targetConversationId: conversation.id,
      });
    }
  }

  for (const npcState of getVisibleNpcStates({
    autonomy: options.autonomy,
    players: options.players,
    deadNpcIds: options.deadNpcIds,
  })) {
    if (npcState.isDead) {
      continue;
    }
    const label = options.getPlayerLabel(npcState.npcId);

    if (npcState.currentExecution) {
      const age = options.tick - npcState.currentExecution.startedAtTick;
      if (age >= EXECUTION_STUCK_TICKS) {
        alerts.push({
          id: `npc-execution-${npcState.npcId}`,
          severity: age >= EXECUTION_STUCK_TICKS * 2 ? "danger" : "warning",
          title: "Action taking too long",
          message: `${label} has been executing ${npcState.currentExecution.actionLabel} for ${formatAge(age)}.`,
          ageTicks: age,
          targetNpcId: npcState.npcId,
        });
      }
    }

    if (npcState.consecutivePlanFailures >= PLAN_FAILURE_ALERT_THRESHOLD) {
      alerts.push({
        id: `npc-failures-${npcState.npcId}`,
        severity: npcState.consecutivePlanFailures >= 3 ? "danger" : "warning",
        title: "Repeated plan failures",
        message: `${label} has failed ${pluralize(npcState.consecutivePlanFailures, "plan")} in a row.`,
        ageTicks: npcState.consecutivePlanFailures,
        targetNpcId: npcState.npcId,
      });
    }

    if (!npcState.currentPlan && !npcState.goalSelectionInFlight) {
      const [lowestNeedLabel, lowestNeedValue] = getLowestNeed(npcState);
      if (lowestNeedValue <= CRITICAL_NEED_THRESHOLD) {
        alerts.push({
          id: `npc-critical-need-${npcState.npcId}`,
          severity:
            lowestNeedValue <= DANGER_NEED_THRESHOLD ? "danger" : "warning",
          title: "Critical need without plan",
          message: `${label} has no active plan while ${lowestNeedLabel} is at ${Math.round(lowestNeedValue)}.`,
          ageTicks: Math.round(100 - lowestNeedValue),
          targetNpcId: npcState.npcId,
        });
      }
    }

    if (
      npcState.goalSelectionInFlight &&
      typeof npcState.goalSelectionStartedAtTick === "number"
    ) {
      const age = options.tick - npcState.goalSelectionStartedAtTick;
      if (age >= GOAL_SELECTION_STUCK_TICKS) {
        alerts.push({
          id: `npc-goal-selection-${npcState.npcId}`,
          severity:
            age >= GOAL_SELECTION_STUCK_TICKS * 2 ? "danger" : "warning",
          title: "Goal selection stuck",
          message: `${label} has been waiting on goal selection for ${formatAge(age)}.`,
          ageTicks: age,
          targetNpcId: npcState.npcId,
        });
      }
    }
  }

  return alerts.sort((left, right) => {
    const severityDelta =
      (left.severity === "danger" ? 0 : 1) -
      (right.severity === "danger" ? 0 : 1);
    return severityDelta || right.ageTicks - left.ageTicks;
  });
}

function getLowestNeed(
  npcState: Pick<NpcAutonomyDebugState, "needs">,
): [NeedLabel, number] {
  const needs: [NeedLabel, number][] = [
    ["health", npcState.needs.health],
    ["food", npcState.needs.food],
    ["water", npcState.needs.water],
    ["social", npcState.needs.social],
  ];
  needs.sort((left, right) => left[1] - right[1]);
  return needs[0];
}
