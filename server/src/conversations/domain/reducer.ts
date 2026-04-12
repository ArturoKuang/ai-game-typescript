import type { ConversationEndReason } from "../../engine/conversation.js";
import type { Position } from "../../engine/types.js";
import {
  getEligibleSpeakerIds,
  getRoomParticipant,
  isRoomReadyToActivate,
} from "./selectors.js";
import {
  type ConversationRoom,
  DEFAULT_ROOM_MAX_PARTICIPANTS,
  DEFAULT_ROOM_MIN_ACTIVE_PARTICIPANTS,
  DEFAULT_ROOM_RADIUS,
  type RoomInviteStatus,
  type RoomMessage,
  type RoomParticipant,
  type RoomPresenceStatus,
  type RoomTurnMode,
} from "./types.js";

export class ConversationRoomDomainError extends Error {}

interface CreateConversationRoomParams {
  id: number;
  createdBy: string;
  createdTick: number;
  anchor?: Position;
  radius?: number;
  maxParticipants?: number;
  minActiveParticipants?: number;
  invitedParticipantIds?: string[];
}

interface InviteParticipantParams {
  playerId: string;
  invitedBy: string;
  invitedTick: number;
}

interface AppendRoomMessageParams {
  id: number;
  playerId: string;
  content: string;
  tick: number;
}

interface UpdateTurnStateParams {
  mode: RoomTurnMode;
  expectedSpeakerIds?: string[];
  activeSpeakerIds?: string[];
  cooldownUntilTick?: number;
}

export function createConversationRoom(
  params: CreateConversationRoomParams,
): ConversationRoom {
  const invitedParticipantIds = Array.from(
    new Set(
      (params.invitedParticipantIds ?? []).filter(
        (playerId) => playerId !== params.createdBy,
      ),
    ),
  );

  const participants: RoomParticipant[] = [
    createParticipant({
      playerId: params.createdBy,
      role: "host",
      inviteStatus: "accepted",
      presenceStatus: "present",
      invitedBy: params.createdBy,
      invitedTick: params.createdTick,
      joinedTick: params.createdTick,
    }),
    ...invitedParticipantIds.map((playerId) =>
      createParticipant({
        playerId,
        role: "member",
        inviteStatus: "pending",
        presenceStatus: "away",
        invitedBy: params.createdBy,
        invitedTick: params.createdTick,
      }),
    ),
  ];

  return {
    id: params.id,
    createdBy: params.createdBy,
    state: "forming",
    maxParticipants: params.maxParticipants ?? DEFAULT_ROOM_MAX_PARTICIPANTS,
    minActiveParticipants:
      params.minActiveParticipants ?? DEFAULT_ROOM_MIN_ACTIVE_PARTICIPANTS,
    anchor: params.anchor ? { ...params.anchor } : undefined,
    radius: params.radius ?? DEFAULT_ROOM_RADIUS,
    version: 1,
    participants,
    transcript: {
      nextSequence: 1,
      messages: [],
    },
    turn: {
      mode: "open",
      expectedSpeakerIds: [],
      activeSpeakerIds: [],
    },
    createdTick: params.createdTick,
  };
}

export function inviteParticipant(
  room: ConversationRoom,
  params: InviteParticipantParams,
): ConversationRoom {
  assertRoomNotEnded(room, "Cannot invite participants to an ended room");
  if (getRoomParticipant(room, params.playerId)) {
    throw new ConversationRoomDomainError(
      `Player ${params.playerId} is already part of room ${room.id}`,
    );
  }
  if (room.participants.length >= room.maxParticipants) {
    throw new ConversationRoomDomainError(
      `Room ${room.id} is already at max capacity`,
    );
  }

  const next = cloneRoom(room);
  next.participants.push(
    createParticipant({
      playerId: params.playerId,
      role: "member",
      inviteStatus: "pending",
      presenceStatus: "away",
      invitedBy: params.invitedBy,
      invitedTick: params.invitedTick,
    }),
  );
  next.version += 1;
  return next;
}

export function acceptParticipantInvite(
  room: ConversationRoom,
  playerId: string,
  tick: number,
): ConversationRoom {
  const next = cloneRoom(room);
  const participant = requireRoomParticipant(next, playerId);
  if (participant.inviteStatus !== "pending") {
    throw new ConversationRoomDomainError(
      `Player ${playerId} does not have a pending invite in room ${room.id}`,
    );
  }

  participant.inviteStatus = "accepted";
  participant.presenceStatus = "approaching";
  participant.joinedTick = tick;
  next.version += 1;
  return next;
}

export function declineParticipantInvite(
  room: ConversationRoom,
  playerId: string,
  tick: number,
): ConversationRoom {
  const next = cloneRoom(room);
  const participant = requireRoomParticipant(next, playerId);
  if (participant.inviteStatus !== "pending") {
    throw new ConversationRoomDomainError(
      `Player ${playerId} does not have a pending invite in room ${room.id}`,
    );
  }

  participant.inviteStatus = "declined";
  participant.presenceStatus = "away";
  participant.declinedTick = tick;
  next.version += 1;
  return next;
}

export function updateParticipantPresence(
  room: ConversationRoom,
  playerId: string,
  presenceStatus: RoomPresenceStatus,
): ConversationRoom {
  const next = cloneRoom(room);
  const participant = requireRoomParticipant(next, playerId);
  if (participant.inviteStatus !== "accepted" && presenceStatus !== "away") {
    throw new ConversationRoomDomainError(
      `Player ${playerId} must accept before becoming ${presenceStatus}`,
    );
  }

  participant.presenceStatus = presenceStatus;
  next.version += 1;
  return next;
}

export function activateRoom(
  room: ConversationRoom,
  tick: number,
): ConversationRoom {
  if (!isRoomReadyToActivate(room)) {
    throw new ConversationRoomDomainError(
      `Room ${room.id} is not ready to activate`,
    );
  }

  const next = cloneRoom(room);
  next.state = "active";
  next.activatedTick = tick;
  next.version += 1;
  return next;
}

export function appendRoomMessage(
  room: ConversationRoom,
  params: AppendRoomMessageParams,
): ConversationRoom {
  if (room.state !== "active") {
    throw new ConversationRoomDomainError(
      `Room ${room.id} is not active; cannot append messages`,
    );
  }

  const next = cloneRoom(room);
  const participant = requireRoomParticipant(next, params.playerId);
  if (participant.inviteStatus !== "accepted") {
    throw new ConversationRoomDomainError(
      `Player ${params.playerId} is not an active participant in room ${room.id}`,
    );
  }

  const message: RoomMessage = {
    id: params.id,
    roomId: next.id,
    playerId: params.playerId,
    content: params.content,
    tick: params.tick,
    sequence: next.transcript.nextSequence,
  };

  next.transcript.messages.push(message);
  next.transcript.lastMessageTick = params.tick;
  next.transcript.nextSequence += 1;
  participant.lastSpokeTick = params.tick;
  next.turn.lastSpeakerId = params.playerId;
  next.turn.activeSpeakerIds = [];
  next.turn.expectedSpeakerIds = getEligibleSpeakerIds(next).filter(
    (speakerId) => speakerId !== params.playerId,
  );
  next.version += 1;
  return next;
}

export function updateTurnState(
  room: ConversationRoom,
  params: UpdateTurnStateParams,
): ConversationRoom {
  const next = cloneRoom(room);
  next.turn.mode = params.mode;
  next.turn.expectedSpeakerIds = [...(params.expectedSpeakerIds ?? [])];
  next.turn.activeSpeakerIds = [...(params.activeSpeakerIds ?? [])];
  next.turn.cooldownUntilTick = params.cooldownUntilTick;
  next.version += 1;
  return next;
}

export function leaveRoom(
  room: ConversationRoom,
  playerId: string,
  tick: number,
): ConversationRoom {
  const next = cloneRoom(room);
  const participant = requireRoomParticipant(next, playerId);
  participant.inviteStatus = "left";
  participant.presenceStatus = "away";
  participant.leftTick = tick;
  next.version += 1;
  return next;
}

export function endRoom(
  room: ConversationRoom,
  tick: number,
  reason: ConversationEndReason,
): ConversationRoom {
  const next = cloneRoom(room);
  next.state = "ended";
  next.endedTick = tick;
  next.endedReason = reason;
  next.version += 1;
  return next;
}

function createParticipant(params: {
  playerId: string;
  role: RoomParticipant["role"];
  inviteStatus: RoomInviteStatus;
  presenceStatus: RoomPresenceStatus;
  invitedBy?: string;
  invitedTick: number;
  joinedTick?: number;
}): RoomParticipant {
  return {
    playerId: params.playerId,
    role: params.role,
    inviteStatus: params.inviteStatus,
    presenceStatus: params.presenceStatus,
    invitedBy: params.invitedBy,
    invitedTick: params.invitedTick,
    joinedTick: params.joinedTick,
    lastReadSequence: 0,
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

function assertRoomNotEnded(room: ConversationRoom, message: string): void {
  if (room.state === "ended") {
    throw new ConversationRoomDomainError(message);
  }
}

function requireRoomParticipant(
  room: ConversationRoom,
  playerId: string,
): RoomParticipant {
  const participant = getRoomParticipant(room, playerId);
  if (!participant) {
    throw new ConversationRoomDomainError(
      `Player ${playerId} is not part of room ${room.id}`,
    );
  }
  return participant;
}
