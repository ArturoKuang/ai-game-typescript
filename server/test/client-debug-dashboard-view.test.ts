import { describe, expect, it } from "vitest";
import type { FrozenActivityState } from "../../client/src/debugDashboardTypes.js";
import {
  buildActivityHtml,
  buildConversationDetailHtml,
} from "../../client/src/debugDashboardViews.js";
import type { Conversation, ConversationRoom } from "../../client/src/types.js";

function makeConversation(overrides: Partial<Conversation> = {}): Conversation {
  return {
    id: 7,
    player1Id: "alice",
    player2Id: "bob",
    state: "active",
    messages: [
      {
        id: 1,
        convoId: 7,
        playerId: "alice",
        content: "Hello there",
        tick: 120,
      },
    ],
    startedTick: 100,
    summary: "Testing room-backed conversation detail",
    ...overrides,
  };
}

function makeRoom(overrides: Partial<ConversationRoom> = {}): ConversationRoom {
  return {
    id: 7,
    createdBy: "alice",
    state: "active",
    maxParticipants: 20,
    minActiveParticipants: 2,
    radius: 3,
    version: 1,
    participants: [
      {
        playerId: "alice",
        role: "host",
        inviteStatus: "accepted",
        presenceStatus: "present",
        invitedTick: 100,
        lastReadSequence: 1,
      },
      {
        playerId: "bob",
        role: "member",
        inviteStatus: "accepted",
        presenceStatus: "present",
        invitedTick: 101,
        lastReadSequence: 1,
      },
    ],
    transcript: {
      nextSequence: 2,
      messages: [
        {
          id: 1,
          roomId: 7,
          playerId: "alice",
          content: "Hello there",
          tick: 120,
          sequence: 1,
        },
      ],
    },
    turn: {
      mode: "round_robin",
      expectedSpeakerIds: ["bob"],
      activeSpeakerIds: [],
      lastSpeakerId: "alice",
    },
    createdTick: 100,
    anchor: { x: 4, y: 5 },
    ...overrides,
  };
}

describe("debug dashboard views", () => {
  it("renders full alert and event bodies in the activity feed", () => {
    const snapshot: FrozenActivityState = {
      alerts: [
        {
          id: "alert-1",
          severity: "warning",
          title: "Conversation quiet",
          message: "Conversation stalled because nobody replied.",
          ageTicks: 240,
          targetConversationId: 7,
        },
      ],
      events: [
        {
          id: 101,
          tick: 900,
          type: "error",
          severity: "error",
          subjectType: "npc",
          subjectId: "npc_alice",
          title: "Planner failure",
          message: "Planner returned no valid actions.",
        },
      ],
      capturedAt: Date.now(),
    };

    const html = buildActivityHtml({
      snapshot,
      activityPaused: false,
      activitySeverityFilter: "all",
      activitySearch: "",
      pinnedItems: new Set(),
      getPlayerLabel: () => "Alice",
    });

    expect(html).toContain("Conversation stalled because nobody replied.");
    expect(html).toContain("Planner returned no valid actions.");
    expect(html).toContain("Event Feed");
  });

  it("renders room roster, turn summary, and transcript in conversation detail", () => {
    const html = buildConversationDetailHtml({
      conversation: makeConversation(),
      room: makeRoom(),
      participantLabel: "Alice ↔ Bob",
      participants: [
        { id: "alice", name: "Alice", isNpc: false },
        { id: "bob", name: "Bob", isNpc: true },
      ],
      tone: "active",
      waitingLabel: "Bob thinking",
      metrics: [
        { label: "State", value: "active" },
        { label: "Messages", value: "1" },
      ],
      summary: "Testing room-backed conversation detail",
      getPlayerLabel: (playerId) => (playerId === "alice" ? "Alice" : "Bob"),
    });

    expect(html).toContain("Conversation #7");
    expect(html).toContain("Room Roster");
    expect(html).toContain("Last speaker");
    expect(html).toContain("Expected: Bob");
    expect(html).toContain("Anchor 4, 5");
    expect(html).toContain("Alice</strong>: Hello there");
    expect(html).toContain("NPC: Bob");
  });
});
