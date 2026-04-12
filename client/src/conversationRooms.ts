import { mergeConversationSnapshots } from "./conversationDebugState.js";
import type {
  Conversation,
  ConversationRoom,
  ConvoState,
  RoomInviteStatus,
  RoomMessage,
  RoomParticipant,
} from "./types.js";

function cloneConversation(conversation: Conversation): Conversation {
  return {
    ...conversation,
    messages: conversation.messages.map((message) => ({ ...message })),
  };
}

function cloneRoom(room: ConversationRoom): ConversationRoom {
  return {
    ...room,
    anchor: room.anchor ? { ...room.anchor } : undefined,
    participants: room.participants.map((participant) => ({ ...participant })),
    transcript: {
      ...room.transcript,
      messages: room.transcript.messages.map((message) => ({ ...message })),
    },
    turn: {
      ...room.turn,
      expectedSpeakerIds: [...room.turn.expectedSpeakerIds],
      activeSpeakerIds: [...room.turn.activeSpeakerIds],
    },
  };
}

function mergeRoomMessages(
  currentMessages: readonly RoomMessage[],
  incomingMessages: readonly RoomMessage[],
): RoomMessage[] {
  const merged = new Map<number, RoomMessage>();

  for (const message of currentMessages) {
    merged.set(message.id, { ...message });
  }

  for (const message of incomingMessages) {
    merged.set(message.id, { ...message });
  }

  return Array.from(merged.values()).sort((left, right) => {
    if (left.sequence !== right.sequence) {
      return left.sequence - right.sequence;
    }
    if (left.tick !== right.tick) {
      return left.tick - right.tick;
    }
    return left.id - right.id;
  });
}

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

function isVisibleInviteStatus(inviteStatus: RoomInviteStatus): boolean {
  return inviteStatus !== "declined" && inviteStatus !== "left";
}

function isActiveInviteStatus(inviteStatus: RoomInviteStatus): boolean {
  return inviteStatus === "accepted" || inviteStatus === "pending";
}

function upsertConversation(
  conversationsById: Map<number, Conversation>,
  incoming: Conversation,
): void {
  const existing = conversationsById.get(incoming.id);
  conversationsById.set(
    incoming.id,
    existing
      ? mergeConversationSnapshots(existing, incoming)
      : cloneConversation(incoming),
  );
}

function getLegacyRoomState(
  room: ConversationRoom,
  playerId?: string,
): ConvoState {
  if (room.state === "ended") {
    return "ended";
  }
  if (room.state === "active") {
    return "active";
  }

  const participant = playerId ? getRoomParticipant(room, playerId) : undefined;
  if (participant?.inviteStatus === "pending") {
    return "invited";
  }
  if (room.participants.some((current) => current.inviteStatus === "pending")) {
    return "invited";
  }
  return "walking";
}

function roomMessageToConversationMessage(
  message: RoomMessage,
): Conversation["messages"][number] {
  return {
    id: message.id,
    convoId: message.roomId,
    playerId: message.playerId,
    content: message.content,
    tick: message.tick,
  };
}

function conversationMessageToRoomMessage(
  conversationId: number,
  message: Conversation["messages"][number],
  sequence: number,
): RoomMessage {
  return {
    id: message.id,
    roomId: conversationId,
    playerId: message.playerId,
    content: message.content,
    tick: message.tick,
    sequence,
  };
}

export function roomFromLegacyConversationSnapshot(
  conversation: Conversation,
): ConversationRoom {
  const inviteStatus: RoomParticipant["inviteStatus"] =
    conversation.state === "invited"
      ? "pending"
      : conversation.state === "ended" &&
          conversation.endedReason === "declined"
        ? "declined"
        : "accepted";
  const presenceStatus: RoomParticipant["presenceStatus"] =
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
    maxParticipants: 2,
    minActiveParticipants: 2,
    radius: 3,
    version: 1,
    participants: sortParticipants([
      {
        playerId: conversation.player1Id,
        role: "host",
        inviteStatus: "accepted",
        presenceStatus:
          conversation.state === "active"
            ? "present"
            : conversation.state === "walking"
              ? "approaching"
              : "away",
        invitedBy: conversation.player1Id,
        invitedTick: conversation.startedTick,
        joinedTick:
          conversation.state === "invited"
            ? undefined
            : conversation.startedTick,
        lastReadSequence: 0,
      },
      {
        playerId: conversation.player2Id,
        role: "member",
        inviteStatus,
        presenceStatus,
        invitedBy: conversation.player1Id,
        invitedTick: conversation.startedTick,
        joinedTick:
          inviteStatus === "accepted" ? conversation.startedTick : undefined,
        declinedTick:
          inviteStatus === "declined" ? conversation.endedTick : undefined,
        lastReadSequence: 0,
      },
    ]),
    transcript: {
      nextSequence: conversation.messages.length + 1,
      messages: conversation.messages.map((message, index) =>
        conversationMessageToRoomMessage(conversation.id, message, index + 1),
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

export function upsertRoomFromConversationSnapshot(
  rooms: readonly ConversationRoom[] | undefined,
  conversation: Conversation,
): ConversationRoom[] {
  const incomingRoom = roomFromLegacyConversationSnapshot(conversation);
  const nextRooms = (rooms ?? []).map((room) =>
    room.id === incomingRoom.id ? cloneRoom(incomingRoom) : cloneRoom(room),
  );

  if (nextRooms.some((room) => room.id === incomingRoom.id)) {
    return nextRooms;
  }

  return [...nextRooms, cloneRoom(incomingRoom)];
}

export function upsertRoomSnapshot(
  rooms: readonly ConversationRoom[] | undefined,
  incoming: ConversationRoom,
): ConversationRoom[] {
  const existingIndex = (rooms ?? []).findIndex(
    (room) => room.id === incoming.id,
  );
  if (existingIndex < 0) {
    return [...(rooms ?? []).map(cloneRoom), cloneRoom(incoming)];
  }

  return (rooms ?? []).map((room, index) =>
    index === existingIndex ? cloneRoom(incoming) : cloneRoom(room),
  );
}

export function appendRoomMessageSnapshot(
  rooms: readonly ConversationRoom[] | undefined,
  message: RoomMessage,
): ConversationRoom[] {
  return (rooms ?? []).map((room) => {
    if (room.id !== message.roomId) {
      return cloneRoom(room);
    }

    const mergedMessages = mergeRoomMessages(room.transcript.messages, [
      message,
    ]);
    return {
      ...cloneRoom(room),
      transcript: {
        ...room.transcript,
        messages: mergedMessages,
        nextSequence: Math.max(
          room.transcript.nextSequence,
          message.sequence + 1,
        ),
        lastMessageTick: Math.max(
          room.transcript.lastMessageTick ?? -1,
          message.tick,
        ),
      },
      turn: {
        ...room.turn,
        lastSpeakerId: message.playerId,
      },
    };
  });
}

export function getVisibleRoomParticipants(
  room: ConversationRoom,
): RoomParticipant[] {
  return sortParticipants(
    room.participants.filter((participant) =>
      isVisibleInviteStatus(participant.inviteStatus),
    ),
  );
}

export function getRoomParticipant(
  room: ConversationRoom,
  playerId: string,
): RoomParticipant | undefined {
  return room.participants.find(
    (participant) => participant.playerId === playerId,
  );
}

export function roomIncludesPlayer(
  room: ConversationRoom,
  playerId: string,
): boolean {
  return getRoomParticipant(room, playerId) !== undefined;
}

export function getPlayerConversationRoom(params: {
  rooms?: readonly ConversationRoom[];
  conversations?: readonly Conversation[];
  playerId: string;
}): ConversationRoom | undefined {
  const room = (params.rooms ?? []).find((current) => {
    if (current.state === "ended") {
      return false;
    }
    const participant = getRoomParticipant(current, params.playerId);
    return participant ? isActiveInviteStatus(participant.inviteStatus) : false;
  });

  if (room) {
    return cloneRoom(room);
  }

  const legacyConversation = (params.conversations ?? []).find(
    (conversation) =>
      conversation.state !== "ended" &&
      (conversation.player1Id === params.playerId ||
        conversation.player2Id === params.playerId),
  );

  return legacyConversation
    ? roomFromLegacyConversationSnapshot(legacyConversation)
    : undefined;
}

export function legacyConversationFromRoomSnapshot(
  room: ConversationRoom,
): Conversation | null {
  const participants = getVisibleRoomParticipants(room);
  if (participants.length < 2) {
    return null;
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
      .map(roomMessageToConversationMessage),
    startedTick: room.createdTick,
    endedTick: room.endedTick,
    endedReason: room.endedReason,
    summary: room.summary,
  };
}

export function getRenderableConversations(params: {
  rooms?: readonly ConversationRoom[];
  conversations?: readonly Conversation[];
}): Conversation[] {
  const conversationsById = new Map<number, Conversation>();

  for (const conversation of params.conversations ?? []) {
    upsertConversation(conversationsById, conversation);
  }

  for (const room of params.rooms ?? []) {
    const projected = legacyConversationFromRoomSnapshot(room);
    if (!projected) {
      continue;
    }
    upsertConversation(conversationsById, projected);
  }

  return Array.from(conversationsById.values());
}

export function getOccupiedConversationPlayerIds(params: {
  rooms?: readonly ConversationRoom[];
  conversations?: readonly Conversation[];
}): Set<string> {
  const occupied = new Set<string>();

  for (const room of params.rooms ?? []) {
    if (room.state === "ended") {
      continue;
    }
    for (const participant of room.participants) {
      if (isActiveInviteStatus(participant.inviteStatus)) {
        occupied.add(participant.playerId);
      }
    }
  }

  for (const conversation of params.conversations ?? []) {
    if (conversation.state === "ended") {
      continue;
    }
    occupied.add(conversation.player1Id);
    occupied.add(conversation.player2Id);
  }

  return occupied;
}

export function getRoomCounterpartyIds(
  room: ConversationRoom,
  playerId: string,
): string[] {
  return getVisibleRoomParticipants(room)
    .filter((participant) => participant.playerId !== playerId)
    .map((participant) => participant.playerId);
}

export function getRoomDisplayState(
  room: ConversationRoom,
  playerId?: string,
): ConvoState {
  return getLegacyRoomState(room, playerId);
}

export function isIncomingRoomInvite(
  room: ConversationRoom,
  playerId: string,
): boolean {
  return getRoomParticipant(room, playerId)?.inviteStatus === "pending";
}

export function canPlayerAcceptRoomInvite(
  room: ConversationRoom,
  playerId: string,
): boolean {
  return room.state !== "ended" && isIncomingRoomInvite(room, playerId);
}

export function canPlayerDeclineRoomInvite(
  room: ConversationRoom,
  playerId: string,
): boolean {
  return room.state !== "ended" && isIncomingRoomInvite(room, playerId);
}

export function canPlayerEndRoom(
  room: ConversationRoom,
  playerId: string,
): boolean {
  return (
    room.state === "active" &&
    getRoomParticipant(room, playerId)?.inviteStatus === "accepted"
  );
}
