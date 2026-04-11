/**
 * Pure serialization helpers that snapshot live engine objects into
 * plain-data shapes safe to hand to network clients and debug consumers.
 *
 * These functions are the single boundary between mutable engine state
 * (`World`, `Player`, `WorldEntity`) and read-only wire formats. Anything
 * that copies gameplay state to leave the server should route through here
 * so we never accidentally leak mutable references.
 */
import type { NpcAutonomyDebugState } from "./autonomy/types.js";
import type { WorldEntity } from "./autonomy/types.js";
import type { ConversationRoom } from "./conversations/domain/types.js";
import type { MapData, Player, Position } from "./engine/types.js";
import type { World } from "./engine/world.js";
import type { WorldEntityData } from "./network/protocol.js";
import { type PublicPlayer, toPublicPlayer } from "./network/publicPlayer.js";

export interface DebugWorldEntityData {
  id: string;
  type: string;
  position: Position;
  properties: Record<string, boolean | number | string>;
  destroyed: boolean;
}

export function snapshotConversationRoom(
  room: ConversationRoom,
): ConversationRoom {
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

export function snapshotConversationRooms(
  rooms: Iterable<ConversationRoom>,
): ConversationRoom[] {
  return Array.from(rooms, (room) => snapshotConversationRoom(room));
}

export function serializeWorldEntity(entity: WorldEntity): WorldEntityData {
  return {
    id: entity.id,
    type: entity.type,
    x: entity.position.x,
    y: entity.position.y,
    properties: entity.properties,
    destroyed: entity.destroyed,
  };
}

export function serializeWorldEntities(
  entities: Iterable<WorldEntity>,
): WorldEntityData[] {
  return Array.from(entities, (entity) => serializeWorldEntity(entity));
}

export function serializeDebugWorldEntity(
  entity: WorldEntity,
): DebugWorldEntityData {
  return {
    id: entity.id,
    type: entity.type,
    position: { ...entity.position },
    properties: entity.properties,
    destroyed: entity.destroyed,
  };
}

export function serializeDebugWorldEntities(
  entities: Iterable<WorldEntity>,
): DebugWorldEntityData[] {
  return Array.from(entities, (entity) => serializeDebugWorldEntity(entity));
}

export function snapshotPublicPlayers(
  players: Iterable<Player>,
): PublicPlayer[] {
  return Array.from(players, (player) => toPublicPlayer(player));
}

export function snapshotWorldBounds(world: Pick<World, "width" | "height">): {
  width: number;
  height: number;
} {
  return { width: world.width, height: world.height };
}

export function snapshotAutonomyDebugStates(
  states: Iterable<[string, NpcAutonomyDebugState]>,
): Record<string, NpcAutonomyDebugState> {
  return Object.fromEntries(states) as Record<string, NpcAutonomyDebugState>;
}

export function snapshotMapData(world: World): MapData {
  const tiles: MapData["tiles"] = [];
  for (let y = 0; y < world.height; y++) {
    const row: MapData["tiles"][number] = [];
    for (let x = 0; x < world.width; x++) {
      row.push(world.getTile(x, y)?.type ?? "wall");
    }
    tiles.push(row);
  }

  return {
    width: world.width,
    height: world.height,
    tiles,
    activities: world.getActivities().map((activity) => ({ ...activity })),
    spawnPoints: world.getSpawnPoints().map((spawn) => ({ ...spawn })),
  };
}
