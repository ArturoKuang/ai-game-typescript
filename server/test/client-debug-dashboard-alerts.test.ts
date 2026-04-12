import { describe, expect, it } from "vitest";
import { deriveDashboardAlerts } from "../../client/src/debugDashboardAlerts.js";
import type {
  Conversation,
  NpcAutonomyDebugState,
  PublicPlayer,
} from "../../client/src/types.js";

function makePlayer(overrides: Partial<PublicPlayer> = {}): PublicPlayer {
  return {
    id: "npc_alice",
    name: "Alice",
    description: "",
    isNpc: true,
    x: 2,
    y: 3,
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

function makeConversation(overrides: Partial<Conversation> = {}): Conversation {
  return {
    id: 7,
    player1Id: "npc_alice",
    player2Id: "human_bob",
    state: "active",
    messages: [],
    startedTick: 100,
    ...overrides,
  };
}

function makeNpcState(
  overrides: Partial<NpcAutonomyDebugState> = {},
): NpcAutonomyDebugState {
  return {
    npcId: "npc_alice",
    name: "Alice",
    isDead: false,
    needs: {
      health: 100,
      food: 90,
      water: 80,
      social: 70,
    },
    inventory: {},
    currentPlan: null,
    currentStepIndex: 0,
    currentExecution: null,
    consecutivePlanFailures: 0,
    goalSelectionInFlight: false,
    goalSelectionStartedAtTick: null,
    planHistory: [],
    ...overrides,
  };
}

describe("debug dashboard alerts", () => {
  it("derives and sorts conversation and NPC danger alerts from live dashboard state", () => {
    const alerts = deriveDashboardAlerts({
      tick: 500,
      conversations: [
        makeConversation({
          id: 11,
          messages: [
            {
              id: 1,
              convoId: 11,
              playerId: "npc_alice",
              content: "Hello",
              tick: 100,
            },
          ],
        }),
      ],
      autonomy: [
        makeNpcState({
          npcId: "npc_goal",
          name: "Goal NPC",
          goalSelectionInFlight: true,
          goalSelectionStartedAtTick: 250,
        }),
        makeNpcState({
          npcId: "npc_need",
          name: "Need NPC",
          needs: {
            health: 100,
            food: 7,
            water: 90,
            social: 80,
          },
        }),
      ],
      players: new Map<string, PublicPlayer>([
        ["npc_alice", makePlayer({ id: "npc_alice", name: "Alice" })],
        [
          "human_bob",
          makePlayer({ id: "human_bob", name: "Bob", isNpc: false }),
        ],
        ["npc_goal", makePlayer({ id: "npc_goal", name: "Goal NPC" })],
        ["npc_need", makePlayer({ id: "npc_need", name: "Need NPC" })],
      ]),
      deadNpcIds: new Set(),
      getConversationParticipantLabel: (conversation) =>
        `${conversation.player1Id} ↔ ${conversation.player2Id}`,
      getPlayerLabel: (playerId) =>
        ({
          npc_alice: "Alice",
          human_bob: "Bob",
          npc_goal: "Goal NPC",
          npc_need: "Need NPC",
        })[playerId] ?? playerId,
    });

    expect(alerts.map((alert) => alert.id)).toEqual([
      "conversation-quiet-11",
      "npc-critical-need-npc_need",
      "npc-goal-selection-npc_goal",
    ]);
    expect(alerts.map((alert) => alert.severity)).toEqual([
      "danger",
      "danger",
      "warning",
    ]);
    expect(alerts[0]?.message).toContain(
      "active without a new message for 400 ticks",
    );
    expect(alerts[1]?.message).toContain("food is at 7");
    expect(alerts[2]?.message).toContain(
      "Goal NPC has been waiting on goal selection",
    );
  });

  it("ignores ended conversations, dead NPCs, and removed non-dead NPCs", () => {
    const alerts = deriveDashboardAlerts({
      tick: 500,
      conversations: [
        makeConversation({
          id: 21,
          state: "ended",
          endedTick: 350,
        }),
      ],
      autonomy: [
        makeNpcState({
          npcId: "npc_dead",
          name: "Dead NPC",
          isDead: true,
          currentExecution: {
            actionId: "stuck_action",
            actionLabel: "Stuck action",
            startedAtTick: 100,
            status: "running",
            stepIndex: 0,
          },
        }),
        makeNpcState({
          npcId: "npc_removed",
          name: "Removed NPC",
          consecutivePlanFailures: 4,
        }),
        makeNpcState({
          npcId: "npc_live",
          name: "Live NPC",
          consecutivePlanFailures: 2,
        }),
      ],
      players: new Map<string, PublicPlayer>([
        ["npc_live", makePlayer({ id: "npc_live", name: "Live NPC" })],
      ]),
      deadNpcIds: new Set(["npc_dead"]),
      getConversationParticipantLabel: () => "ignored",
      getPlayerLabel: (playerId) => playerId,
    });

    expect(alerts).toHaveLength(1);
    expect(alerts[0]).toMatchObject({
      id: "npc-failures-npc_live",
      severity: "warning",
      targetNpcId: "npc_live",
    });
  });
});
