import type { CharacterDef } from '../server/src/engine/types.js';

export const CHARACTERS: CharacterDef[] = [
  {
    id: 'npc_alice',
    name: 'Alice Chen',
    description:
      'A 28-year-old software engineer who recently moved to town. She loves coffee, reading sci-fi novels, and discussing technology. She is curious and outgoing but sometimes overthinks social situations.',
    personality:
      'Curious, outgoing, analytical, slightly anxious. Loves technology and sci-fi. Tends to bring up interesting facts in conversation.',
    spawnPoint: { x: 3, y: 3 },
    emoji: 'A',
  },
  {
    id: 'npc_bob',
    name: 'Bob Martinez',
    description:
      'A 45-year-old retired teacher who spends most days at the library or park. He is warm, patient, and loves sharing stories about history. He misses his teaching days.',
    personality:
      'Warm, patient, nostalgic, storyteller. Loves history and education. Often gives advice, sometimes unsolicited.',
    spawnPoint: { x: 16, y: 3 },
    emoji: 'B',
  },
  {
    id: 'npc_carol',
    name: 'Carol Washington',
    description:
      'A 35-year-old artist who runs a small gallery from her home. She is creative, spontaneous, and deeply emotional. She draws inspiration from nature and people-watching.',
    personality:
      'Creative, spontaneous, emotional, observant. Loves art and nature. Speaks in metaphors and sees beauty everywhere.',
    spawnPoint: { x: 10, y: 10 },
    emoji: 'C',
  },
  {
    id: 'npc_dave',
    name: 'Dave Kim',
    description:
      'A 22-year-old college student studying environmental science. He is passionate about sustainability and often organizes community events. He can be intense but means well.',
    personality:
      'Passionate, idealistic, energetic, sometimes preachy. Cares about the environment. Always planning the next community project.',
    spawnPoint: { x: 5, y: 15 },
    emoji: 'D',
  },
  {
    id: 'npc_eve',
    name: 'Eve Okafor',
    description:
      'A 55-year-old bakery owner who has lived in town her whole life. She knows everyone and everything. She is the unofficial town gossip but genuinely cares about people.',
    personality:
      'Sociable, nurturing, gossipy, wise. Knows everyone in town. Loves baking and sharing food. The social hub of the community.',
    spawnPoint: { x: 14, y: 15 },
    emoji: 'E',
  },
];
