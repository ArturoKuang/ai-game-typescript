import type { GameLoop } from "../engine/gameLoop.js";
import { CHARACTERS } from "../data/characters.js";

interface Scenario {
  description: string;
  setup: (game: GameLoop) => void;
}

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
  });
}

export const SCENARIOS: Record<string, Scenario> = {
  empty: {
    description: "Empty world, no players",
    setup: () => {
      // Nothing to do
    },
  },

  two_npcs_near_cafe: {
    description: "Alice and Bob spawned near the cafe",
    setup: (game) => {
      spawnCharacter(game, "npc_alice", 2, 2);
      spawnCharacter(game, "npc_bob", 4, 2);
    },
  },

  crowded_town: {
    description: "All 5 NPCs spawned at various locations",
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
