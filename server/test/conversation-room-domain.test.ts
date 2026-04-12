import { describe, expect, it } from "vitest";
import {
  legacyConversationFromRoom,
  roomFromLegacyConversation,
} from "../src/conversations/domain/compat.js";
import {
  acceptParticipantInvite,
  activateRoom,
  appendRoomMessage,
  createConversationRoom,
  updateParticipantPresence,
} from "../src/conversations/domain/reducer.js";
import {
  countAcceptedParticipants,
  countPresentParticipants,
  getEligibleSpeakerIds,
  getPendingRoomParticipants,
  isRoomReadyToActivate,
} from "../src/conversations/domain/selectors.js";
import type { Conversation } from "../src/engine/conversation.js";

describe("conversation room domain", () => {
  it("creates a forming room with a host and pending invitees", () => {
    const room = createConversationRoom({
      id: 1,
      createdBy: "alice",
      createdTick: 12,
      invitedParticipantIds: ["bob", "carol"],
      minActiveParticipants: 2,
    });

    expect(room.state).toBe("forming");
    expect(room.participants).toHaveLength(3);
    expect(room.participants[0].playerId).toBe("alice");
    expect(countAcceptedParticipants(room)).toBe(1);
    expect(
      getPendingRoomParticipants(room).map(
        (participant) => participant.playerId,
      ),
    ).toEqual(["bob", "carol"]);
  });

  it("activates once quorum is present and sequences transcript messages", () => {
    let room = createConversationRoom({
      id: 2,
      createdBy: "alice",
      createdTick: 20,
      invitedParticipantIds: ["bob"],
      minActiveParticipants: 2,
    });

    room = acceptParticipantInvite(room, "bob", 21);
    room = updateParticipantPresence(room, "alice", "present");
    room = updateParticipantPresence(room, "bob", "present");

    expect(countPresentParticipants(room)).toBe(2);
    expect(isRoomReadyToActivate(room)).toBe(true);

    room = activateRoom(room, 22);
    room = appendRoomMessage(room, {
      id: 1,
      playerId: "alice",
      content: "Hello Bob",
      tick: 23,
    });
    room = appendRoomMessage(room, {
      id: 2,
      playerId: "bob",
      content: "Hello Alice",
      tick: 24,
    });

    expect(room.transcript.messages.map((message) => message.sequence)).toEqual(
      [1, 2],
    );
    expect(room.turn.lastSpeakerId).toBe("bob");
    expect(room.turn.expectedSpeakerIds).toEqual(["alice"]);
    expect(getEligibleSpeakerIds(room)).toEqual(["alice", "bob"]);
  });

  it("round-trips a legacy pair conversation through the room adapter", () => {
    const conversation: Conversation = {
      id: 8,
      player1Id: "alice",
      player2Id: "bob",
      state: "active",
      messages: [
        {
          id: 11,
          convoId: 8,
          playerId: "alice",
          content: "Need anything from the market?",
          tick: 40,
        },
        {
          id: 12,
          convoId: 8,
          playerId: "bob",
          content: "Just bread.",
          tick: 42,
        },
      ],
      startedTick: 30,
    };

    const room = roomFromLegacyConversation(conversation);
    const roundTripped = legacyConversationFromRoom(room);

    expect(room.state).toBe("active");
    expect(room.transcript.nextSequence).toBe(3);
    expect(roundTripped).toEqual(conversation);
  });
});
