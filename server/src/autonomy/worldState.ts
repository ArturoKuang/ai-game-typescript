/**
 * Snapshot the live game state into a GOAP WorldState predicate map.
 *
 * Called once per planning cycle, not per tick.
 */
import type {
  EntityManagerInterface,
  GameLoopInterface,
  NpcInventory,
  NpcNeeds,
  NeedType,
  WorldState,
} from "./types.js";
import { DEFAULT_NEED_CONFIGS } from "./types.js";

const PROXIMITY_RADIUS = 2;

const NEED_KEYS: NeedType[] = [
  "hunger",
  "energy",
  "social",
  "safety",
  "curiosity",
];

export function snapshotWorldState(
  npcId: string,
  game: GameLoopInterface,
  needs: NpcNeeds,
  inventory: NpcInventory,
  entityManager: EntityManagerInterface,
): WorldState {
  const state: WorldState = new Map();
  const npc = game.getPlayer(npcId);
  if (!npc) return state;

  const pos = { x: Math.round(npc.x), y: Math.round(npc.y) };

  // Need satisfaction predicates
  for (const key of NEED_KEYS) {
    const config = DEFAULT_NEED_CONFIGS[key];
    state.set(
      `need_${key}_satisfied`,
      needs[key] >= config.urgencyThreshold,
    );
  }

  // Inventory predicates
  for (const [item, count] of inventory) {
    if (count > 0) {
      state.set(`has_${item}`, true);
    }
  }

  // Proximity predicates — check nearby entities
  const nearbyEntities = entityManager.getNearby(pos, PROXIMITY_RADIUS);
  const nearbyTypes = new Set<string>();
  for (const entity of nearbyEntities) {
    nearbyTypes.add(entity.type);
  }
  for (const type of nearbyTypes) {
    state.set(`near_${type}`, true);
  }

  // Check nearby players for social proximity
  const players = game.getPlayers();
  for (const player of players) {
    if (player.id === npcId) continue;
    const dist =
      Math.abs(player.x - pos.x) + Math.abs(player.y - pos.y);
    if (dist <= PROXIMITY_RADIUS) {
      state.set("near_player", true);
      break;
    }
  }

  // NPC state
  state.set("npc_state", npc.state);

  return state;
}
