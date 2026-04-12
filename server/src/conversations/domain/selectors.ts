import type {
  ConversationRoom,
  RoomInviteStatus,
  RoomParticipant,
} from "./types.js";

export function getRoomParticipant(
  room: ConversationRoom,
  playerId: string,
): RoomParticipant | undefined {
  return room.participants.find(
    (participant) => participant.playerId === playerId,
  );
}

export function isRoomParticipant(
  room: ConversationRoom,
  playerId: string,
): boolean {
  return getRoomParticipant(room, playerId) !== undefined;
}

export function getRoomParticipantIds(room: ConversationRoom): string[] {
  return room.participants.map((participant) => participant.playerId);
}

export function getRoomParticipantsByInviteStatus(
  room: ConversationRoom,
  inviteStatus: RoomInviteStatus,
): RoomParticipant[] {
  return room.participants.filter(
    (participant) => participant.inviteStatus === inviteStatus,
  );
}

export function getAcceptedRoomParticipants(
  room: ConversationRoom,
): RoomParticipant[] {
  return getRoomParticipantsByInviteStatus(room, "accepted");
}

export function getPendingRoomParticipants(
  room: ConversationRoom,
): RoomParticipant[] {
  return getRoomParticipantsByInviteStatus(room, "pending");
}

export function countAcceptedParticipants(room: ConversationRoom): number {
  return getAcceptedRoomParticipants(room).length;
}

export function countPresentParticipants(room: ConversationRoom): number {
  return room.participants.filter(
    (participant) =>
      participant.inviteStatus === "accepted" &&
      participant.presenceStatus === "present",
  ).length;
}

export function getEligibleSpeakerIds(room: ConversationRoom): string[] {
  return room.participants
    .filter((participant) => participant.inviteStatus === "accepted")
    .map((participant) => participant.playerId);
}

export function isRoomReadyToActivate(room: ConversationRoom): boolean {
  return (
    room.state === "forming" &&
    countAcceptedParticipants(room) >= room.minActiveParticipants &&
    countPresentParticipants(room) >= room.minActiveParticipants
  );
}
