import { describe, expect, it } from "vitest";
import {
  canPlayerAcceptRoomInvite,
  canPlayerDeclineRoomInvite,
  canPlayerEndRoom,
  getOccupiedConversationPlayerIds,
  getPlayerConversationRoom,
  getRenderableConversations,
  getRoomCounterpartyIds,
  getRoomDisplayState,
  isIncomingRoomInvite,
  legacyConversationFromRoomSnapshot,
  roomFromLegacyConversationSnapshot,
  upsertRoomFromConversationSnapshot,
} from "../../client/src/conversationRooms.js";
import type {
  Conversation,
  ConversationRoom,
  RoomMessage,
  RoomParticipant,
} from "../../client/src/types.js";

function makeParticipant(
  overrides: Partial<RoomParticipant> & Pick<RoomParticipant, "playerId">,
): RoomParticipant {
  return {
    playerId: overrides.playerId,
    role: "member",
    inviteStatus: "accepted",
    presenceStatus: "present",
    invitedTick: 10,
    lastReadSequence: 0,
    ...overrides,
  };
}

function makeRoomMessage(overrides: Partial<RoomMessage> = {}): RoomMessage {
  return {
    id: 1,
    roomId: 1,
    playerId: "alice",
    content: "Hello",
    tick: 12,
    sequence: 1,
    ...overrides,
  };
}

function makeRoom(overrides: Partial<ConversationRoom> = {}): ConversationRoom {
  return {
    id: 1,
    createdBy: "alice",
    state: "active",
    maxParticipants: 20,
    minActiveParticipants: 2,
    radius: 3,
    version: 1,
    participants: [
      makeParticipant({ playerId: "alice", role: "host" }),
      makeParticipant({ playerId: "bob" }),
    ],
    transcript: {
      nextSequence: 2,
      messages: [makeRoomMessage()],
    },
    turn: {
      mode: "open",
      expectedSpeakerIds: ["bob"],
      activeSpeakerIds: [],
      lastSpeakerId: "alice",
    },
    createdTick: 10,
    ...overrides,
  };
}

function makeConversation(overrides: Partial<Conversation> = {}): Conversation {
  return {
    id: 1,
    player1Id: "alice",
    player2Id: "bob",
    state: "active",
    messages: [],
    startedTick: 10,
    ...overrides,
  };
}

describe("client conversation room helpers", () => {
  it("derives invite, walking, and active room lifecycle permissions", () => {
    const incomingInvite = makeRoom({
      state: "forming",
      participants: [
        makeParticipant({ playerId: "alice", role: "host" }),
        makeParticipant({
          playerId: "bob",
          inviteStatus: "pending",
          presenceStatus: "away",
        }),
      ],
    });
    const assemblingRoom = makeRoom({
      state: "forming",
      participants: [
        makeParticipant({ playerId: "alice", role: "host" }),
        makeParticipant({
          playerId: "bob",
          inviteStatus: "accepted",
          presenceStatus: "approaching",
        }),
      ],
    });
    const activeRoom = makeRoom();

    expect(getRoomDisplayState(incomingInvite, "bob")).toBe("invited");
    expect(isIncomingRoomInvite(incomingInvite, "bob")).toBe(true);
    expect(canPlayerAcceptRoomInvite(incomingInvite, "bob")).toBe(true);
    expect(canPlayerDeclineRoomInvite(incomingInvite, "bob")).toBe(true);

    expect(getRoomDisplayState(assemblingRoom, "alice")).toBe("walking");
    expect(canPlayerEndRoom(assemblingRoom, "alice")).toBe(false);

    expect(getRoomDisplayState(activeRoom, "alice")).toBe("active");
    expect(canPlayerEndRoom(activeRoom, "alice")).toBe(true);
  });

  it("tracks occupancy and counterparty ids from room rosters", () => {
    const room = makeRoom({
      participants: [
        makeParticipant({ playerId: "alice", role: "host" }),
        makeParticipant({ playerId: "bob" }),
        makeParticipant({
          playerId: "carol",
          inviteStatus: "pending",
          presenceStatus: "away",
          invitedTick: 11,
        }),
      ],
    });

    const occupied = getOccupiedConversationPlayerIds({
      rooms: [room],
      conversations: [
        makeConversation({ id: 7, player1Id: "dave", player2Id: "erin" }),
      ],
    });

    expect(getRoomCounterpartyIds(room, "bob")).toEqual(["alice", "carol"]);
    expect(Array.from(occupied).sort()).toEqual([
      "alice",
      "bob",
      "carol",
      "dave",
      "erin",
    ]);
  });

  it("projects rooms into legacy conversations and merges them with existing snapshots", () => {
    const legacyConversation = makeConversation({
      messages: [
        {
          id: 1,
          convoId: 1,
          playerId: "alice",
          content: "Hello",
          tick: 12,
        },
      ],
    });
    const room = makeRoom({
      transcript: {
        nextSequence: 3,
        messages: [
          makeRoomMessage(),
          makeRoomMessage({
            id: 2,
            playerId: "bob",
            content: "Hi",
            tick: 13,
            sequence: 2,
          }),
        ],
      },
      turn: {
        mode: "open",
        expectedSpeakerIds: ["alice"],
        activeSpeakerIds: [],
        lastSpeakerId: "bob",
      },
    });

    const projected = legacyConversationFromRoomSnapshot(room);
    const renderable = getRenderableConversations({
      rooms: [room],
      conversations: [legacyConversation],
    });
    const syntheticRoom = getPlayerConversationRoom({
      rooms: [],
      conversations: [legacyConversation],
      playerId: "alice",
    });

    expect(projected?.messages).toHaveLength(2);
    expect(renderable).toHaveLength(1);
    expect(renderable[0].messages.map((message) => message.content)).toEqual([
      "Hello",
      "Hi",
    ]);
    expect(syntheticRoom?.state).toBe("active");
    expect(
      syntheticRoom?.participants.map((participant) => participant.playerId),
    ).toEqual(["alice", "bob"]);
  });

  it("reconciles stale room snapshots from newer legacy conversation updates", () => {
    const staleInviteRoom = makeRoom({
      state: "forming",
      participants: [
        makeParticipant({ playerId: "alice", role: "host" }),
        makeParticipant({
          playerId: "bob",
          inviteStatus: "pending",
          presenceStatus: "away",
        }),
      ],
      transcript: {
        nextSequence: 1,
        messages: [],
      },
      turn: {
        mode: "open",
        expectedSpeakerIds: [],
        activeSpeakerIds: [],
      },
    });
    const updatedConversation = makeConversation({
      state: "active",
      messages: [
        {
          id: 1,
          convoId: 1,
          playerId: "alice",
          content: "Fresh update",
          tick: 20,
        },
      ],
    });

    const updatedRooms = upsertRoomFromConversationSnapshot(
      [staleInviteRoom],
      updatedConversation,
    );
    const updatedRoom = getPlayerConversationRoom({
      rooms: updatedRooms,
      conversations: [],
      playerId: "alice",
    });
    const projectedRoom =
      roomFromLegacyConversationSnapshot(updatedConversation);

    expect(updatedRooms).toHaveLength(1);
    expect(updatedRoom?.state).toBe("active");
    expect(updatedRoom?.participants[1].inviteStatus).toBe("accepted");
    expect(
      updatedRoom?.transcript.messages.map((message) => message.content),
    ).toEqual(["Fresh update"]);
    expect(updatedRoom).toEqual(projectedRoom);
  });
});
