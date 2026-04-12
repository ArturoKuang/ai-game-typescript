import { describe, expect, it } from "vitest";
import {
  buildHistoryStepKey,
  buildParticipantDebugData,
  buildPlanStepKey,
  getVisibleNpcStates,
} from "../../client/src/debugDashboardModel.js";
import type {
  NpcAutonomyDebugState,
  PublicPlayer,
} from "../../client/src/types.js";

function makeNpcState(
  overrides: Partial<NpcAutonomyDebugState> = {},
): NpcAutonomyDebugState {
  return {
    npcId: "npc_alice",
    name: "Alice",
    isDead: false,
    needs: {
      health: 100,
      food: 100,
      water: 100,
      social: 100,
    },
    inventory: {},
    currentPlan: null,
    currentStepIndex: 0,
    currentExecution: null,
    consecutivePlanFailures: 0,
    goalSelectionInFlight: false,
    goalSelectionStartedAtTick: null,
    ...overrides,
  };
}

function makePlayer(overrides: Partial<PublicPlayer> = {}): PublicPlayer {
  return {
    id: "npc_alice",
    name: "Alice",
    description: "",
    isNpc: true,
    x: 1,
    y: 1,
    orientation: "down",
    pathSpeed: 1,
    state: "idle",
    vx: 0,
    vy: 0,
    inputSpeed: 5,
    radius: 0.35,
    ...overrides,
  };
}

describe("debug dashboard model helpers", () => {
  it("keeps dead NPCs visible while hiding removed non-dead NPCs", () => {
    const liveNpc = makeNpcState({ npcId: "npc_live", name: "Live NPC" });
    const deadNpc = makeNpcState({
      npcId: "npc_dead",
      name: "Dead NPC",
      isDead: true,
    });
    const removedNpc = makeNpcState({
      npcId: "npc_removed",
      name: "Removed NPC",
    });

    const visible = getVisibleNpcStates({
      autonomy: [liveNpc, deadNpc, removedNpc],
      players: new Map<string, PublicPlayer>([
        ["npc_live", makePlayer({ id: "npc_live", name: "Live NPC" })],
      ]),
      deadNpcIds: new Set(["npc_dead"]),
    });

    expect(visible.map((state) => state.npcId)).toEqual([
      "npc_live",
      "npc_dead",
    ]);
  });

  it("falls back to autonomy state and cached names for despawned conversation participants", () => {
    const fromAutonomy = buildParticipantDebugData({
      playerId: "npc_alice",
      players: new Map(),
      autonomy: new Map([
        ["npc_alice", makeNpcState({ npcId: "npc_alice", name: "Alice NPC" })],
      ]),
      npcNameCache: new Map(),
    });
    expect(fromAutonomy).toEqual({
      id: "npc_alice",
      name: "Alice NPC",
      isNpc: true,
    });

    const fromCache = buildParticipantDebugData({
      playerId: "npc_bob",
      players: new Map(),
      autonomy: new Map(),
      npcNameCache: new Map([["npc_bob", "Bob NPC"]]),
    });
    expect(fromCache).toEqual({
      id: "npc_bob",
      name: "Bob NPC",
      isNpc: true,
    });
  });

  it("builds stable plan and history step keys from semantic plan data instead of array position", () => {
    const plan = {
      goalId: "eat_food",
      createdAtTick: 42,
      source: "llm" as const,
    };
    const step = {
      index: 0,
      actionId: "pickup_food",
      targetPosition: { x: 2, y: 3 },
    };

    expect(buildPlanStepKey("npc_alice", plan, step)).toBe(
      buildPlanStepKey("npc_alice", { ...plan }, { ...step }),
    );
    expect(
      buildPlanStepKey("npc_alice", { ...plan, createdAtTick: 43 }, step),
    ).not.toBe(buildPlanStepKey("npc_alice", plan, step));

    const historyEntry = {
      goalId: "eat_food",
      source: "llm",
      startedTick: 42,
      endedTick: 55,
      outcome: "completed" as const,
      message: "completed eat food",
    };

    expect(buildHistoryStepKey("npc_alice", historyEntry, step)).toBe(
      buildHistoryStepKey("npc_alice", { ...historyEntry }, { ...step }),
    );
    expect(
      buildHistoryStepKey(
        "npc_alice",
        { ...historyEntry, startedTick: 99 },
        step,
      ),
    ).not.toBe(buildHistoryStepKey("npc_alice", historyEntry, step));
  });
});
