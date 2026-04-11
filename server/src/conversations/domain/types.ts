import type { ConversationEndReason } from "../../engine/conversation.js";
import type { Position } from "../../engine/types.js";

export const DEFAULT_ROOM_RADIUS = 3;
export const DEFAULT_ROOM_MAX_PARTICIPANTS = 20;
export const DEFAULT_ROOM_MIN_ACTIVE_PARTICIPANTS = 2;

export type ConversationRoomState = "forming" | "active" | "ended";
export type RoomParticipantRole = "host" | "member";
export type RoomInviteStatus = "pending" | "accepted" | "declined" | "left";
export type RoomPresenceStatus = "approaching" | "present" | "away";
export type RoomTurnMode = "open" | "nominated" | "cooldown";

export interface RoomParticipant {
  playerId: string;
  role: RoomParticipantRole;
  inviteStatus: RoomInviteStatus;
  presenceStatus: RoomPresenceStatus;
  invitedBy?: string;
  invitedTick: number;
  joinedTick?: number;
  declinedTick?: number;
  leftTick?: number;
  lastReadSequence: number;
  lastSpokeTick?: number;
}

export interface RoomMessage {
  id: number;
  roomId: number;
  playerId: string;
  content: string;
  tick: number;
  sequence: number;
}

export interface RoomTranscriptState {
  nextSequence: number;
  messages: RoomMessage[];
  lastMessageTick?: number;
}

export interface RoomTurnState {
  mode: RoomTurnMode;
  expectedSpeakerIds: string[];
  activeSpeakerIds: string[];
  lastSpeakerId?: string;
  cooldownUntilTick?: number;
}

export interface ConversationRoom {
  id: number;
  createdBy: string;
  state: ConversationRoomState;
  maxParticipants: number;
  minActiveParticipants: number;
  anchor?: Position;
  radius: number;
  version: number;
  participants: RoomParticipant[];
  transcript: RoomTranscriptState;
  turn: RoomTurnState;
  createdTick: number;
  activatedTick?: number;
  endedTick?: number;
  endedReason?: ConversationEndReason;
  summary?: string;
}
