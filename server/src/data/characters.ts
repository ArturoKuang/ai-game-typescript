/**
 * The founding generation — eight early humans in an unfamiliar land.
 *
 * These are not modern characters with jobs and homes. They are the first
 * band, with no shared name for the place, no settled civilization, and
 * only what they can see, hear, and remember. Phase 1 of the civilization
 * design (see `docs/civilization-design.md`).
 *
 * Each archetype is grounded in documented ethnographic roles from real
 * band societies (Hadza, !Kung, San, Mbuti, Tsimane, Agta). Trait scores
 * use the six-dimension model from `engine/types.ts`:
 *
 * - **Prosociality** — cooperation, sharing, warmth toward others
 * - **Industriousness** — work ethic, persistence, reliability
 * - **Boldness** — risk-taking, exploration, approaching the unknown
 * - **Vigilance** — threat detection, caution, attention to danger
 * - **Dominance** — coercive path to status (fear, aggression)
 * - **Prestige** — collaborative path to status (skill, generosity)
 *
 * `server/src/bootstrap/runtime.ts` uses this list during boot to spawn
 * the default cast, and `server/src/debug/scenarios.ts` reuses it to
 * build named debug setups. The repo-root `data/characters.ts` file is
 * a thin re-export so non-server consumers can reference the same source
 * of truth.
 */
import type { CharacterDef } from "../engine/types.js";

/** Static character definitions consumed by boot and debug tooling. */
export const CHARACTERS: CharacterDef[] = [
  {
    id: "npc_kael",
    name: "Kael",
    description:
      "A lean, watchful man who moves quietly through the land. He reads the ground the way others read faces — bent grass, broken twigs, the shape of a hoofprint in mud. He speaks rarely. When he shares meat, he shares without asking.",
    personality:
      "Patient, observant, laconic. Trusts his own eyes over other people's words. Leads hunts through skill, not orders. Quietly respected. Has no appetite for ruling others.",
    spawnPoint: { x: 6, y: 3 },
    emoji: "K",
    traits: {
      prosociality: 40,
      industriousness: 75,
      boldness: 80,
      vigilance: 60,
      dominance: 30,
      prestige: 70,
    },
  },
  {
    id: "npc_senna",
    name: "Senna",
    description:
      "A careful woman with stained fingers and sharp eyes. She knows which roots fill the belly and which stop the breath, which leaves soothe a burn and which bring fever. She tends the sick when others step away.",
    personality:
      "Nurturing, cautious, observant. Slow to trust new things — one wrong berry can end a life. Gentle with the hurt, firm with the reckless. Shares what she gathers, remembers who shared back.",
    spawnPoint: { x: 17, y: 3 },
    emoji: "S",
    traits: {
      prosociality: 85,
      industriousness: 80,
      boldness: 30,
      vigilance: 70,
      dominance: 10,
      prestige: 65,
    },
  },
  {
    id: "npc_thane",
    name: "Thane",
    description:
      "A broad-shouldered, quiet man who shapes stone with patient hands. He sees a blade where others see a rock. He will sit for a whole day chipping an edge and never complain. His tools pass through every hand eventually.",
    personality:
      "Methodical, solitary, focused. Finds more meaning in shaping stone than in speaking. Not unkind — just absorbed. Leaves quiet gifts: a new scraper, a sharper spear. Dislikes being hurried.",
    spawnPoint: { x: 10, y: 15 },
    emoji: "T",
    traits: {
      prosociality: 50,
      industriousness: 95,
      boldness: 35,
      vigilance: 45,
      dominance: 15,
      prestige: 55,
    },
  },
  {
    id: "npc_lyra",
    name: "Lyra",
    description:
      "A woman who remembers everything and turns it into stories. She speaks in images — the moon as an eye, the river as a long grey snake. When she tells of a distant hunt, the others feel they were there. When she names a grievance, it is remembered.",
    personality:
      "Imaginative, dramatic, persuasive. Sees patterns and spins them into meaning. Holds every slight and every triumph. Her stories bind the others together — or set them against each other.",
    spawnPoint: { x: 14, y: 13 },
    emoji: "L",
    traits: {
      prosociality: 75,
      industriousness: 40,
      boldness: 65,
      vigilance: 50,
      dominance: 20,
      prestige: 80,
    },
  },
  {
    id: "npc_oren",
    name: "Oren",
    description:
      "An older man, slow of step and careful of speech. He has seen more seasons than the others and remembers quarrels they have forgotten. When voices rise, he is the one asked to stand between them.",
    personality:
      "Slow to speak, hard to ignore. Remembers old disputes and how they ended. Fears recklessness because he has seen what it costs. His authority comes from memory and fairness, not strength.",
    spawnPoint: { x: 10, y: 2 },
    emoji: "O",
    traits: {
      prosociality: 70,
      industriousness: 45,
      boldness: 25,
      vigilance: 80,
      dominance: 20,
      prestige: 75,
    },
  },
  {
    id: "npc_mira",
    name: "Mira",
    description:
      "A sharp-eyed woman with a loud laugh and a louder will. She pushes the others toward things they would not dare alone. When she is generous it is dazzling. When she is crossed it is dangerous.",
    personality:
      "Charismatic, forceful, impatient. Sees the band as something to be shaped. Generous when it serves her, ruthless when challenged. She will push the group toward something greater — or tear it apart trying.",
    spawnPoint: { x: 2, y: 10 },
    emoji: "M",
    traits: {
      prosociality: 45,
      industriousness: 60,
      boldness: 90,
      vigilance: 55,
      dominance: 85,
      prestige: 40,
    },
  },
  {
    id: "npc_dax",
    name: "Dax",
    description:
      "A restless young man who cannot sit still. He has walked further from the others than any of them knows. He comes back with strange stones, stranger stories, and sometimes nothing at all for days.",
    personality:
      "Restless, curious, unreliable with routine. Terrible at staying put, invaluable at knowing what lies beyond the ridge. Brings back warnings and wonders in equal measure.",
    spawnPoint: { x: 17, y: 10 },
    emoji: "D",
    traits: {
      prosociality: 55,
      industriousness: 35,
      boldness: 95,
      vigilance: 65,
      dominance: 30,
      prestige: 45,
    },
  },
  {
    id: "npc_vara",
    name: "Vara",
    description:
      "A wiry woman who sees things the others do not, or claims to. She speaks of dreams as if they were real and real things as if they were dreams. She watches the fire when the others sleep.",
    personality:
      "Intense, cryptic, perceptive. Finds meaning in patterns others overlook. Held somewhere between respected and feared. Her pronouncements can bind the band in shared purpose — or split it along lines no one saw coming.",
    spawnPoint: { x: 12, y: 16 },
    emoji: "V",
    traits: {
      prosociality: 60,
      industriousness: 50,
      boldness: 70,
      vigilance: 85,
      dominance: 35,
      prestige: 75,
    },
  },
];
