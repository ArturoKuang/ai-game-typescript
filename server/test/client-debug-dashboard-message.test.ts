import { describe, expect, it, vi } from "vitest";
import { applyDashboardMessage } from "../../client/src/debugDashboardMessages.js";
import type { DashboardState } from "../../client/src/debugDashboardTypes.js";
import type {
  Conversation,
  ConversationRoom,
  DebugActionDefinition,
  DebugSystemSnapshot,
  NpcAutonomyDebugState,
  PublicPlayer,
  RoomMessage,
  ServerMessage,
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
    startedTick: 10,
    ...overrides,
  };
}

function makeRoomMessage(overrides: Partial<RoomMessage> = {}): RoomMessage {
  return {
    id: 1,
    roomId: 7,
    playerId: "npc_alice",
    content: "Hello",
    tick: 12,
    sequence: 1,
    ...overrides,
  };
}

function makeRoom(overrides: Partial<ConversationRoom> = {}): ConversationRoom {
  return {
    id: 7,
    createdBy: "npc_alice",
    state: "active",
    maxParticipants: 20,
    minActiveParticipants: 2,
    radius: 3,
    version: 1,
    participants: [
      {
        playerId: "npc_alice",
        role: "host",
        inviteStatus: "accepted",
        presenceStatus: "present",
        invitedTick: 10,
        lastReadSequence: 1,
      },
      {
        playerId: "human_bob",
        role: "member",
        inviteStatus: "accepted",
        presenceStatus: "present",
        invitedTick: 10,
        lastReadSequence: 1,
      },
    ],
    transcript: {
      nextSequence: 2,
      messages: [makeRoomMessage()],
    },
    turn: {
      mode: "open",
      expectedSpeakerIds: ["human_bob"],
      activeSpeakerIds: [],
      lastSpeakerId: "npc_alice",
    },
    createdTick: 10,
    ...overrides,
  };
}

function makeAutonomyState(
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
    currentPlan: {
      goalId: "eat_food",
      totalCost: 1,
      createdAtTick: 40,
      source: "llm",
      llmGenerated: true,
      steps: [
        {
          index: 0,
          actionId: "pickup_food",
          actionLabel: "Pick up food",
          isCurrent: true,
        },
      ],
    },
    currentStepIndex: 0,
    currentExecution: null,
    consecutivePlanFailures: 0,
    goalSelectionInFlight: false,
    goalSelectionStartedAtTick: null,
    planHistory: [],
    ...overrides,
  };
}

function makeSystemSnapshot(
  overrides: Partial<DebugSystemSnapshot> = {},
): DebugSystemSnapshot {
  return {
    mode: "realtime",
    tickRate: 20,
    world: { width: 20, height: 20 },
    entities: [],
    connectedClients: [],
    ...overrides,
  };
}

function makeDashboardState(
  overrides: Partial<DashboardState> = {},
): DashboardState {
  return {
    connected: true,
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
    debugToken: null,
    commandStatus: { kind: "idle", message: "", at: null },
    screenshotUrl: null,
    scenarios: [],
    ...overrides,
  };
}

function makeActionDefinition(
  overrides: Partial<DebugActionDefinition> = {},
): DebugActionDefinition {
  return {
    id: "pickup_food",
    displayName: "Pick up food",
    preconditions: {},
    effects: {},
    cost: 1,
    estimatedDurationTicks: 20,
    ...overrides,
  };
}

describe("debug dashboard message reducer", () => {
  it("hydrates dashboard state and caches from debug bootstrap", () => {
    const state = makeDashboardState();
    const refreshScreenshotUrl = vi.fn();
    const context = {
      state,
      deadNpcIds: new Set<string>(["old_dead"]),
      npcNameCache: new Map<string, string>(),
      lastKnownPlans: new Map(),
      expandedActions: new Set<string>(["expanded-step"]),
      actionDefs: {},
      nextSyntheticEventId: -1,
      syncPlayers(players: readonly PublicPlayer[]) {
        state.players = new Map(
          players.map((player) => [player.id, { ...player }]),
        );
      },
      pushEvent() {
        throw new Error("bootstrap should not push synthetic events");
      },
      refreshScreenshotUrl,
    };

    const message: ServerMessage = {
      type: "debug_bootstrap",
      data: {
        tick: 42,
        players: [makePlayer()],
        conversations: [makeConversation()],
        conversationRooms: [makeRoom()],
        autonomyStates: {
          npc_alice: makeAutonomyState({ isDead: true }),
        },
        recentEvents: [],
        actionDefinitions: {
          pickup_food: makeActionDefinition(),
        },
        system: makeSystemSnapshot({
          lastScreenshot: {
            clientId: "client-1",
            capturedAt: "2026-04-11T07:00:00.000Z",
          },
        }),
      },
    };

    const result = applyDashboardMessage(context, message, 1234);

    expect(state.lastMessageAt).toBe(1234);
    expect(state.tick).toBe(42);
    expect(state.players.get("npc_alice")?.name).toBe("Alice");
    expect(state.conversationRooms).toHaveLength(1);
    expect(state.autonomy.get("npc_alice")?.isDead).toBe(true);
    expect(context.deadNpcIds.has("npc_alice")).toBe(true);
    expect(context.lastKnownPlans.has("npc_alice")).toBe(true);
    expect(context.expandedActions.size).toBe(0);
    expect(result.actionDefs.pickup_food?.displayName).toBe("Pick up food");
    expect(result.isImmediate).toBe(true);
    expect(refreshScreenshotUrl).toHaveBeenCalledWith("client-1");
  });

  it("updates room transcript and marks selected room messages as immediate", () => {
    const room = makeRoom({
      transcript: {
        nextSequence: 1,
        messages: [],
      },
    });
    const state = makeDashboardState({
      selectedConversationId: 7,
      conversationRooms: [room],
    });
    const context = {
      state,
      deadNpcIds: new Set<string>(),
      npcNameCache: new Map<string, string>(),
      lastKnownPlans: new Map(),
      expandedActions: new Set<string>(),
      actionDefs: {},
      nextSyntheticEventId: -1,
      syncPlayers() {
        throw new Error("room message should not sync players");
      },
      pushEvent(event: { id: number }) {
        state.events.push(event as never);
      },
      refreshScreenshotUrl: vi.fn(),
    };

    const result = applyDashboardMessage(
      context,
      {
        type: "debug_conversation_room_message",
        data: makeRoomMessage({
          id: 9,
          content: "Room update",
          sequence: 9,
        }),
      },
      2000,
    );

    expect(state.lastMessageAt).toBe(2000);
    expect(state.conversationRooms[0]?.transcript.messages).toHaveLength(1);
    expect(state.conversationRooms[0]?.transcript.messages[0]?.content).toBe(
      "Room update",
    );
    expect(result.isImmediate).toBe(true);
  });
});
