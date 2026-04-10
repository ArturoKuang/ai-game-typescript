/**
 * Named debug setups for `/api/debug/scenario`.
 *
 * Scenarios are lightweight fixtures layered on top of the currently loaded
 * {@link GameLoop}. They are meant for reproducible manual inspection through
 * the debug API, not for replacing the more exact harnesses in `server/src/debug/`.
 */
import { CHARACTERS } from "../data/characters.js";
import type { GameLoop } from "../engine/gameLoop.js";

/** Debug-router scenario definition. */
export interface ScenarioDef {
  description: string;
  setup: (game: GameLoop) => void;
}

/** Rehydrate one of the canonical NPC definitions into the current world. */
function spawnCharacter(
  game: GameLoop,
  charId: string,
  x?: number,
  y?: number,
): void {
  const char = CHARACTERS.find((c) => c.id === charId);
  if (!char) throw new Error(`Unknown character: ${charId}`);
  game.spawnPlayer({
    id: char.id,
    name: char.name,
    x: x ?? char.spawnPoint.x,
    y: y ?? char.spawnPoint.y,
    isNpc: true,
    description: char.description,
    personality: char.personality,
    traits: char.traits,
  });
}

export const SCENARIOS: Record<string, ScenarioDef> = {
  empty: {
    description: "Empty land, no one here",
    setup: () => {
      // Nothing to do
    },
  },

  two_founders_meet: {
    description:
      "Kael the tracker and Oren the elder spawn near each other in the north",
    setup: (game) => {
      spawnCharacter(game, "npc_kael", 2, 2);
      spawnCharacter(game, "npc_oren", 4, 2);
    },
  },

  founding_band: {
    description:
      "All 8 founding humans spawned at their starting positions across the land",
    setup: (game) => {
      for (const char of CHARACTERS) {
        spawnCharacter(game, char.id);
      }
    },
  },
};

export function listScenarios(): { name: string; description: string }[] {
  return Object.entries(SCENARIOS).map(([name, s]) => ({
    name,
    description: s.description,
  }));
}
