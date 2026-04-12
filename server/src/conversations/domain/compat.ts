import type {
  Conversation,
  ConvoState,
  Message,
} from "../../engine/conversation.js";
import type { Position } from "../../engine/types.js";
import type {
  ConversationRoom,
  RoomInviteStatus,
  RoomMessage,
  RoomParticipant,
  RoomPresenceStatus,
} from "./types.js";

function sortParticipants(
  participants: readonly RoomParticipant[],
): RoomParticipant[] {
  return [...participants].sort((left, right) => {
    if (left.role !== right.role) {
      return left.role === "host" ? -1 : 1;
    }
    if (left.invitedTick !== right.invitedTick) {
      return left.invitedTick - right.invitedTick;
    }
    return left.playerId.localeCompare(right.playerId);
  });
}

function getLegacyRoomState(room: ConversationRoom): ConvoState {
  if (room.state === "ended") {
    return "ended";
  }
  if (room.state === "active") {
    return "active";
  }
  if (
    room.participants.some(
      (participant) => participant.inviteStatus === "pending",
    )
  ) {
    return "invited";
  }
  return "walking";
}

function buildParticipant(params: {
  playerId: string;
  role: RoomParticipant["role"];
  inviteStatus: RoomInviteStatus;
  presenceStatus: RoomPresenceStatus;
  invitedTick: number;
  invitedBy?: string;
  joinedTick?: number;
  declinedTick?: number;
  leftTick?: number;
}): RoomParticipant {
  return {
    playerId: params.playerId,
    role: params.role,
    inviteStatus: params.inviteStatus,
    presenceStatus: params.presenceStatus,
    invitedTick: params.invitedTick,
    invitedBy: params.invitedBy,
    joinedTick: params.joinedTick,
    declinedTick: params.declinedTick,
    leftTick: params.leftTick,
    lastReadSequence: 0,
  };
}

function messageToRoomMessage(message: Message, sequence: number): RoomMessage {
  return {
    id: message.id,
    roomId: message.convoId,
    playerId: message.playerId,
    content: message.content,
    tick: message.tick,
    sequence,
  };
}

function roomMessageToMessage(message: RoomMessage): Message {
  return {
    id: message.id,
    convoId: message.roomId,
    playerId: message.playerId,
    content: message.content,
    tick: message.tick,
  };
}

export function roomFromLegacyConversation(
  conversation: Conversation,
  options?: {
    anchor?: Position;
    radius?: number;
    maxParticipants?: number;
    minActiveParticipants?: number;
  },
): ConversationRoom {
  const inviteStatus: RoomInviteStatus =
    conversation.state === "invited"
      ? "pending"
      : conversation.state === "ended" &&
          conversation.endedReason === "declined"
        ? "declined"
        : "accepted";
  const presenceStatus: RoomPresenceStatus =
    conversation.state === "active"
      ? "present"
      : conversation.state === "walking"
        ? "approaching"
        : "away";
  const lastMessage = conversation.messages[conversation.messages.length - 1];

  return {
    id: conversation.id,
    createdBy: conversation.player1Id,
    state:
      conversation.state === "active"
        ? "active"
        : conversation.state === "ended"
          ? "ended"
          : "forming",
    maxParticipants: options?.maxParticipants ?? 2,
    minActiveParticipants: options?.minActiveParticipants ?? 2,
    anchor: options?.anchor ? { ...options.anchor } : undefined,
    radius: options?.radius ?? 3,
    version: 1,
    participants: sortParticipants([
      buildParticipant({
        playerId: conversation.player1Id,
        role: "host",
        inviteStatus: "accepted",
        presenceStatus:
          conversation.state === "active"
            ? "present"
            : conversation.state === "walking"
              ? "approaching"
              : "away",
        invitedTick: conversation.startedTick,
        invitedBy: conversation.player1Id,
        joinedTick:
          conversation.state === "invited"
            ? undefined
            : conversation.startedTick,
      }),
      buildParticipant({
        playerId: conversation.player2Id,
        role: "member",
        inviteStatus,
        presenceStatus,
        invitedTick: conversation.startedTick,
        invitedBy: conversation.player1Id,
        joinedTick:
          inviteStatus === "accepted" ? conversation.startedTick : undefined,
        declinedTick:
          inviteStatus === "declined" ? conversation.endedTick : undefined,
      }),
    ]),
    transcript: {
      nextSequence: conversation.messages.length + 1,
      messages: conversation.messages.map((message, index) =>
        messageToRoomMessage(message, index + 1),
      ),
      lastMessageTick: lastMessage?.tick,
    },
    turn: {
      mode: "open",
      expectedSpeakerIds:
        conversation.state === "active" && lastMessage
          ? [conversation.player1Id, conversation.player2Id].filter(
              (playerId) => playerId !== lastMessage.playerId,
            )
          : [],
      activeSpeakerIds: [],
      lastSpeakerId: lastMessage?.playerId,
    },
    createdTick: conversation.startedTick,
    activatedTick:
      conversation.state === "walking" || conversation.state === "active"
        ? conversation.startedTick
        : undefined,
    endedTick: conversation.endedTick,
    endedReason: conversation.endedReason,
    summary: conversation.summary,
  };
}

export function legacyConversationFromRoom(
  room: ConversationRoom,
): Conversation {
  const participants = sortParticipants(
    room.participants.filter(
      (participant) =>
        participant.inviteStatus !== "declined" &&
        participant.inviteStatus !== "left",
    ),
  );
  if (participants.length < 2) {
    throw new Error(
      `Room ${room.id} cannot be projected to a legacy conversation without two visible participants`,
    );
  }

  const [player1, player2] = participants;

  return {
    id: room.id,
    player1Id: player1.playerId,
    player2Id: player2.playerId,
    state: getLegacyRoomState(room),
    messages: [...room.transcript.messages]
      .sort(
        (left, right) => left.sequence - right.sequence || left.id - right.id,
      )
      .map(roomMessageToMessage),
    startedTick: room.createdTick,
    endedTick: room.endedTick,
    endedReason: room.endedReason,
    summary: room.summary,
  };
}
