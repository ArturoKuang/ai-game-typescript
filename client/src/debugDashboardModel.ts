import type {
  NpcAutonomyDebugPlan,
  NpcAutonomyDebugPlanStep,
  NpcAutonomyDebugState,
  PublicPlayer,
} from "./types.js";

export interface ParticipantDebugData {
  id: string;
  name: string;
  isNpc: boolean;
}

export interface HistoryStepKeySource {
  goalId: string;
  source: string;
  startedTick: number;
  endedTick: number | null;
  outcome: "running" | "completed" | "failed" | "interrupted";
  message: string;
}

export function buildParticipantDebugData(params: {
  playerId: string;
  players: ReadonlyMap<string, PublicPlayer>;
  autonomy: ReadonlyMap<string, NpcAutonomyDebugState>;
  npcNameCache: ReadonlyMap<string, string>;
}): ParticipantDebugData {
  const player = params.players.get(params.playerId);
  const autonomyState = params.autonomy.get(params.playerId);
  return {
    id: params.playerId,
    name:
      player?.name ??
      autonomyState?.name ??
      params.npcNameCache.get(params.playerId) ??
      params.playerId,
    isNpc:
      player?.isNpc ??
      Boolean(autonomyState || params.npcNameCache.has(params.playerId)),
  };
}

export function getVisibleNpcStates(params: {
  autonomy: Iterable<NpcAutonomyDebugState>;
  players: ReadonlyMap<string, PublicPlayer>;
  deadNpcIds: ReadonlySet<string>;
}): NpcAutonomyDebugState[] {
  return Array.from(params.autonomy).filter((state) => {
    const player = params.players.get(state.npcId);
    return (
      Boolean(player?.isNpc) ||
      state.isDead ||
      params.deadNpcIds.has(state.npcId)
    );
  });
}

export function buildPlanStepKey(
  npcId: string,
  plan: Pick<NpcAutonomyDebugPlan, "goalId" | "createdAtTick" | "source">,
  step: Pick<NpcAutonomyDebugPlanStep, "index" | "actionId" | "targetPosition">,
): string {
  return [
    "plan",
    npcId,
    plan.goalId,
    plan.source,
    String(plan.createdAtTick),
    String(step.index),
    step.actionId,
    formatTarget(step.targetPosition),
  ].join(":");
}

export function buildHistoryStepKey(
  npcId: string,
  entry: HistoryStepKeySource,
  step: Pick<NpcAutonomyDebugPlanStep, "index" | "actionId" | "targetPosition">,
): string {
  return [
    "history",
    npcId,
    entry.goalId,
    entry.source,
    String(entry.startedTick),
    String(entry.endedTick ?? "running"),
    entry.outcome,
    entry.message,
    String(step.index),
    step.actionId,
    formatTarget(step.targetPosition),
  ].join(":");
}

function formatTarget(
  target: Pick<NpcAutonomyDebugPlanStep, "targetPosition">["targetPosition"],
): string {
  if (!target) {
    return "none";
  }
  return `${target.x},${target.y}`;
}
