import type { GameLoop } from "../engine/gameLoop.js";

interface Scenario {
  description: string;
  setup: (game: GameLoop) => void;
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
      game.spawnPlayer({
        id: "npc_alice",
        name: "Alice Chen",
        x: 2,
        y: 2,
        isNpc: true,
        description: "A curious software engineer who loves coffee and sci-fi.",
        personality: "Curious, outgoing, analytical.",
      });
      game.spawnPlayer({
        id: "npc_bob",
        name: "Bob Martinez",
        x: 4,
        y: 2,
        isNpc: true,
        description: "A retired teacher who loves history and sharing stories.",
        personality: "Warm, patient, nostalgic.",
      });
    },
  },

  crowded_town: {
    description: "All 5 NPCs spawned at various locations",
    setup: (game) => {
      game.spawnPlayer({
        id: "npc_alice",
        name: "Alice Chen",
        x: 3,
        y: 3,
        isNpc: true,
        description: "A curious software engineer who loves coffee and sci-fi.",
        personality: "Curious, outgoing, analytical.",
      });
      game.spawnPlayer({
        id: "npc_bob",
        name: "Bob Martinez",
        x: 16,
        y: 3,
        isNpc: true,
        description: "A retired teacher who loves history and sharing stories.",
        personality: "Warm, patient, nostalgic.",
      });
      game.spawnPlayer({
        id: "npc_carol",
        name: "Carol Washington",
        x: 10,
        y: 10,
        isNpc: true,
        description: "An artist who draws inspiration from nature and people.",
        personality: "Creative, spontaneous, emotional.",
      });
      game.spawnPlayer({
        id: "npc_dave",
        name: "Dave Kim",
        x: 5,
        y: 15,
        isNpc: true,
        description: "A college student passionate about sustainability.",
        personality: "Passionate, idealistic, energetic.",
      });
      game.spawnPlayer({
        id: "npc_eve",
        name: "Eve Okafor",
        x: 14,
        y: 15,
        isNpc: true,
        description: "A bakery owner who knows everyone in town.",
        personality: "Sociable, nurturing, gossipy, wise.",
      });
    },
  },
};

export function listScenarios(): { name: string; description: string }[] {
  return Object.entries(SCENARIOS).map(([name, s]) => ({
    name,
    description: s.description,
  }));
}
