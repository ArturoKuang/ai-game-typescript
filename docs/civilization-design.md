# Dawn of Civilization — NPC Redesign Notes

A design discussion for transforming AI Town from a modern social simulation into a primordial civilization-building simulation. NPCs start from nothing and build up culture, kinship, conflict, and society over generations.

---

## Vision

Imagine the very start of humans — before language had words for "future," before anyone had built a wall or tamed a fire they didn't stumble across. A small band. No tools beyond what they can pick up. Hunger and thirst and cold and each other.

From that starting point, the NPCs should be able to:
- Build up a civilization from scratch
- Reproduce and pass traits to children
- Age and die
- Form bonds, rivalries, alliances
- Fight wars, suffer losses, experience triumphs
- Create culture — stories, rituals, laws

The drama should emerge from personality interacting with scarcity and time.

---

## Current State of the Codebase

The existing foundation is stronger than expected. Most of the survival plumbing is already in place — it just needs to be pointed at a different world.

### What already exists

- **GOAP planner** (`server/src/autonomy/planner.ts`) — NPCs already plan multi-step action sequences (harvest → cook → eat) using backward A* over predicate-based world state.
- **Needs system** (`server/src/autonomy/needs.ts`) — food, water, social needs with decay, urgency thresholds (40/45/35), and critical thresholds (15/20/15) that interrupt current plans.
- **Memory system** (`server/src/npc/memory.ts`) — pgvector embeddings, composite scoring of `recency * 0.99^ticksAgo + importance/10 + cosineSimilarity`. Reflections trigger when cumulative importance exceeds 50.
- **Conversation system** — state machine (`invited → walking → active → ended`) with LLM-generated dialogue. Conversations end with a +40 social boost.
- **Entity system** (`server/src/autonomy/entityManager.ts`) — dynamic world objects like berry bushes, campfires, water sources, all with O(1) spatial lookup.
- **Combat** — bears, HP, flee behavior, aggressive-bear proximity detection (4-tile radius).
- **Tick pipeline** — `gameLoop.ts` runs commands → movement → conversations → afterTick callbacks. Autonomy manager hooks into `onAfterTick`.

### Key constants already in the system

- `GOAL_SELECTION_COOLDOWN = 200` ticks between re-planning
- `PLAN_EXPIRY_TICKS = 2000`
- `CONVERSATION_TIMEOUT = 600`
- `NEEDS_BROADCAST_INTERVAL = 40`

### What's missing

The NPCs are modern characters (software engineer, retired teacher, artist) dropped into a survival sandbox. The **soul** of the simulation — identity, kinship, legacy, civilization-building — doesn't exist yet.

---

## The Anthropology Research

Before designing personalities, I researched actual anthropology and evolutionary psychology. Two findings dramatically shaped the design.

### Finding 1: The Big Two (Tsimane Study)

**The study:** In 2013, Gurven, von Rueden, and colleagues administered the standard Big Five personality inventory to the Tsimane — an indigenous forager-farmer group of ~16,000 people in the Bolivian Amazon who live close to how our ancestors lived.

**The shocking result:** The Big Five didn't replicate. When researchers ran factor analysis, they didn't get five clean dimensions. They got **two**:

1. **Prosociality** — warmth, generosity, sociability, curiosity about others (merged Extraversion, Agreeableness, and parts of Openness)
2. **Industriousness** — work ethic, reliability, effort in subsistence labor

**Why this matters:** The Big Five was developed by studying WEIRD populations (Western, Educated, Industrialized, Rich, Democratic). In a small-scale society where survival depends on getting along with ~30 people and reliably producing food, personality organizes around those two axes — not the five we assume are universal.

**Implication for the game:** Using the modern Big Five for primordial humans would be historically wrong. Prosociality + Industriousness should be the *core* trait axes, with other dimensions layered on top for gameplay drama.

Source: [Tsimane Big Five Study (PMC)](https://pmc.ncbi.nlm.nih.gov/articles/PMC4104167/)

### Finding 2: Dunbar-Scaled Social Structure

**The core idea:** Robin Dunbar noticed that primate neocortex size correlates with social group size. Extrapolating to humans gives ~150 — the famous "Dunbar's number." But the important part is that human social networks are **nested in layers**, each ~3x bigger than the last:

| Layer | Size | What it is |
|-------|------|-----------|
| Support clique | ~5 | Closest family, people you'd call in a crisis |
| Sympathy group | ~15 | People whose death would deeply affect you |
| Band | ~50 | Extended community, people you'd invite to a big event |
| Community | ~150 | People you know by name and history |
| Acquaintances | ~500 | Faces you recognize |
| Tribe | ~1,500 | Faces you can place |

These numbers match actual hunter-gatherer census data. Real band societies cluster at 30-50. Related bands form communities at ~150. Loose tribes hit ~500-1500. The sizes aren't coincidence — they're hardcoded by how much social information a human brain can track.

**Implication for the game:** These layers create natural civilizational phase transitions:

- **Below 15:** Everyone knows everyone intimately. No factions yet. All conflicts are personal.
- **~30-50:** The band feels too big. Cliques form. Trust fragments. Historically, bands **split in two** here — a real phenomenon called *fission*.
- **~150:** Multiple bands must cooperate. Kinship alone can't bind strangers. You need rituals, shared stories, symbols — this is where **chiefs, shamans, and religion** become necessary.
- **~500+:** Pure kinship collapses. You need laws, institutions, hierarchies — the birth of the **state**.

So instead of just "population grows," phase transitions could trigger at Dunbar thresholds. A band of 50 naturally splits, maybe driven by rivalry between two high-dominance NPCs. At 150, a shaman gains outsized influence because ritual is the only glue strong enough.

Source: [Dunbar's Number (Wikipedia)](https://en.wikipedia.org/wiki/Dunbar's_number)

### Other Key Findings

- **Prestige vs Dominance leadership** — Two distinct paths to status in ancestral groups. [Dominance](https://en.wikipedia.org/wiki/Dual_strategies_theory) uses coercion (fear-based, unstable). Prestige uses earned respect through skill and generosity (stable). Both existed side by side.
- **Storytellers matter** — Among the Agta, [skilled storytellers are preferred social partners even over skilled foragers](https://www.nature.com/articles/s41467-017-02036-8). Camps with better storytellers had higher cooperation rates. Stories encode norms about cooperation and egalitarianism.
- **Shamanism is ancient** — The oldest documented religious specialization, ~40,000 years old. Shamans [increased social cohesion through shared ritual](https://pmc.ncbi.nlm.nih.gov/articles/PMC10401513/) and reduced anxiety around illness, hunting, and enemies.
- **Egalitarian leadership** — In real band societies, "[the best hunters would have their abilities recognized, but such recognition did not lead to the assumption of authority](https://en.wikipedia.org/wiki/Band_society)." Skill ≠ rulership.
- **Food production as status** — In forager societies, food production ability is the primary marker of status and reproductive success. Generosity and trustworthiness are essential for standing.

---

## Proposed Trait System

Based on the research, a 6-dimension trait model:

| Trait | Range | Evolutionary Function | Source |
|-------|-------|----------------------|--------|
| **Prosociality** | 0–100 | Cooperation, sharing, trust-building | Tsimane study — dominant axis in forager personality |
| **Industriousness** | 0–100 | Work ethic, persistence, reliability | Tsimane study — second dominant axis |
| **Boldness** | 0–100 | Exploration, risk-taking, threat approach | Evolutionary extraversion — "sensitivity to reward" |
| **Vigilance** | 0–100 | Threat detection, caution, anxiety | Evolutionary neuroticism — "sensitivity to punishment" |
| **Dominance** | 0–100 | Coercion, territorial control, aggression | Dual strategies theory — coercive path to status |
| **Prestige** | 0–100 | Teaching, skill-sharing, earned respect | Dual strategies theory — collaborative path to status |

**How traits drive behavior** — they plug into the existing GOAP planner by weighting goal priorities:

```typescript
// High-boldness NPCs weight exploration goals higher
const explorationWeight = baseWeight * (npc.traits.boldness / 50);

// High-dominance NPCs are more likely to claim territory or start conflicts
const conflictWeight = baseWeight * (npc.traits.dominance / 50);

// High-prosociality NPCs prioritize sharing and socializing
const shareWeight = baseWeight * (npc.traits.prosociality / 50);

// High-vigilance NPCs flee earlier and avoid risks
const fleeThreshold = BASE_FLEE_DISTANCE + (npc.traits.vigilance / 25);
```

---

## The Founding Generation — 8 Archetypes

Each archetype is grounded in documented ethnographic roles from real band societies (!Kung, Hadza, San, Mbuti, Tsimane, Agta).

### 1. Kael — The Tracker (skilled hunter, quiet authority)

- **Traits:** Prosociality 40, Industriousness 75, Boldness 80, Vigilance 60, Dominance 30, Prestige 70
- **Basis:** The best hunters earn recognition but "such recognition did not lead to the assumption of authority." Competent and respected, but no desire to rule. Leads through skill, not orders.
- **Personality:** Patient, observant, laconic. Reads animal tracks the way others read faces. Shares meat freely — food production is the primary marker of status in forager societies.

### 2. Senna — The Gatherer-Healer (plant knowledge, caretaker)

- **Traits:** Prosociality 85, Industriousness 80, Boldness 30, Vigilance 70, Dominance 10, Prestige 65
- **Basis:** Women in forager societies contribute the majority of gathered foods and hold deep botanical knowledge. Healers occupied explicit specialist niches in hunter-gatherer bands.
- **Personality:** Nurturing but sharp-eyed. Knows which roots cure and which kill. Cautious about new things — risk aversion is adaptive when one bad decision can end you.

### 3. Thane — The Maker (toolsmith, builder)

- **Traits:** Prosociality 50, Industriousness 95, Boldness 35, Vigilance 45, Dominance 15, Prestige 55
- **Basis:** Even in pre-agricultural bands, specific crafts were a recognized specialization. The Neolithic revolution was enabled by specialized craftspeople.
- **Personality:** Methodical, solitary, focused. Finds more meaning in shaping stone than in conversation. Not antisocial — just deeply absorbed. His tools make everyone's life better, which earns quiet respect.

### 4. Lyra — The Storyteller (oral tradition, cultural glue)

- **Traits:** Prosociality 75, Industriousness 40, Boldness 65, Vigilance 50, Dominance 20, Prestige 80
- **Basis:** Among the Agta, skilled storytellers are preferred social partners *even over skilled foragers*. Camps with better storytellers showed higher cooperation rates. Stories encode norms about cooperation and egalitarianism.
- **Personality:** Imaginative, dramatic, persuasive. Speaks in images. Remembers everything — every slight, every triumph. Her stories aren't entertainment; they're how the group remembers who it is.

### 5. Oren — The Elder-Mediator (consensus builder, tradition keeper)

- **Traits:** Prosociality 70, Industriousness 45, Boldness 25, Vigilance 80, Dominance 20, Prestige 75
- **Basis:** Band societies rely on consensus-building with extended discussions. Mediators are a documented cross-cultural role — "one man may be a good mediator, another an exemplary warrior."
- **Personality:** Slow to speak, hard to ignore. Remembers old disputes and their resolutions. Fears change because he's seen what recklessness costs. Authority comes from memory and fairness, not strength.

### 6. Mira — The Firebrand (dominant leader, ambitious)

- **Traits:** Prosociality 45, Industriousness 60, Boldness 90, Vigilance 55, Dominance 85, Prestige 40
- **Basis:** Dominance-based leadership uses coercion and intimidation. Unstable — followers can resist — but powerful in crisis. Associated with hubristic pride and reduced prosocial behavior.
- **Personality:** Charismatic, forceful, impatient. Sees the group as something to be shaped. Generous when it serves her, ruthless when challenged. She'll push the group toward something bigger — or tear it apart trying.

### 7. Dax — The Wanderer-Scout (explorer, inter-band connector)

- **Traits:** Prosociality 55, Industriousness 35, Boldness 95, Vigilance 65, Dominance 30, Prestige 45
- **Basis:** Hunter-gatherer multilevel sociality shows that inter-band interaction drives cumulative culture. Someone had to bridge groups. Dunbar's nested layers require connectors.
- **Personality:** Restless, curious, unreliable in routine tasks. Terrible at staying put, invaluable for knowing what's over the next hill. Brings back knowledge, stories, warnings — and sometimes trouble.

### 8. Vara — The Shaman (ritual specialist, spirit-world intermediary)

- **Traits:** Prosociality 60, Industriousness 50, Boldness 70, Vigilance 85, Dominance 35, Prestige 75
- **Basis:** Shamanism is the oldest documented religious specialization, emerging ~40,000 years ago. Shamans increased social cohesion through shared ritual and were prestigious members of their communities who reduced group anxiety.
- **Personality:** Intense, cryptic, perceptive. Sees patterns others miss — or claims to. Occupies a space between respected and feared. Rituals bind the group together, but pronouncements can also divide.

---

## Life Cycle System

New properties to add to Player/NPC state:

```typescript
interface LifeCycle {
  age: number;              // increments every N ticks (1 "year")
  maxAge: number;           // genetic variation (60-90 "years")
  generation: number;       // 0 = founding, 1 = their children, etc.
  parentIds?: [string, string];
  childIds: string[];
  partnerId?: string;       // bonded partner
  fertilityWindow: [number, number]; // age range for reproduction
}
```

- **Aging:** Every X ticks = 1 year. NPCs visibly age (emoji/sprite changes).
- **Death:** When `age >= maxAge`, the NPC dies. Their memories persist in the database as "ancestral knowledge" that descendants can recall.
- **Reproduction:** Two bonded NPCs with high enough relationship + both in fertility window → new NPC spawns. Child inherits blended traits from parents + random mutation.

---

## Relationship Graph

Extend the memory system into a relationship graph:

```typescript
interface Relationship {
  targetId: string;
  trust: number;       // -100 to 100
  affection: number;   // -100 to 100
  respect: number;     // -100 to 100
  history: string[];   // key memory references
  role: 'stranger' | 'ally' | 'rival' | 'partner' | 'kin' | 'enemy';
}
```

Conversations modify these scores. Trust builds slowly through cooperative actions (sharing food, building together). It breaks fast through betrayal (stealing, violence). The GOAP planner factors relationships into goal selection — an NPC won't cooperate with someone they distrust.

---

## Civilization Mechanics (Phased)

New GOAP actions and world entities added in waves as the population grows and Dunbar thresholds are crossed.

### Early Era (Generation 0-1, population <15)

- `build_shelter` → creates a hut entity (protection from elements)
- `craft_tool` → stone tools that boost harvest/build efficiency
- `claim_territory` → NPCs mark zones as "theirs"
- `share_food` → give food to another NPC (builds trust/affection)
- `teach` → pass knowledge (memories) to younger NPCs

### Middle Era (Generation 2-4, population ~15-50)

- `farm` → plant crops (renewable food source)
- `build_wall` → defensive structures
- `trade` → exchange resources between groups
- `form_alliance` / `declare_rivalry`
- `hold_council` → group conversation for decisions

### Late Era (Generation 5+, population ~50+)

- `build_monument` → cultural landmark
- `wage_war` → group combat between factions
- `establish_law` → behavioral rules that NPCs in a faction follow
- `tell_story` → pass ancestral memories to the next generation

---

## Factions & Conflict

As population grows, NPCs naturally cluster into factions based on kinship and trust:

```typescript
interface Faction {
  id: string;
  name: string;                          // NPC-generated (e.g., "People of the River")
  leaderId: string;
  memberIds: string[];
  territory: Position[];                 // claimed tiles
  relations: Map<string, number>;        // faction-to-faction trust
  laws: string[];                        // behavioral rules
}
```

War triggers when faction trust drops below a threshold and resources are scarce. The drama writes itself — siblings on opposite sides, leaders betrayed, alliances forged in desperation.

---

## Dunbar Thresholds as Phase Transitions

Tie civilization mechanics to Dunbar layers so the game naturally evolves:

| Pop | Dunbar Layer | What Unlocks | What Happens |
|-----|--------------|--------------|--------------|
| <15 | Support/sympathy | Shelter, tools, sharing | Everyone knows everyone. Personal conflicts. |
| 15-50 | Band | Farming, walls, alliances | Cliques form. Fission pressure. First band split. |
| 50-150 | Community | Rituals, monuments, shaman influence | Strangers bound only by story. Religion emerges. |
| 150-500 | Tribe | Laws, institutions, war | Kinship fails. States form. |

---

## Implementation Order

Each phase builds on the last and is independently playable.

1. **Rewrite `data/characters.ts`** with the founding generation — new names, primordial personalities, trait scores
2. **Add trait type + GOAP weighting** — traits influence goal selection weights
3. **Add the relationship graph** — conversations modify trust/affection
4. **Add life cycle** (age, death, generation, ancestral memory inheritance)
5. **Add reproduction** — trait blending + mutation for offspring
6. **Civilization actions** — shelters, tools, territory, teaching
7. **Factions + Dunbar phase transitions** — band splits, ritual emergence, war

---

## Sources

- [Tsimane Big Five Study (PMC)](https://pmc.ncbi.nlm.nih.gov/articles/PMC4104167/)
- [Evolutionary Analysis of Big Five (Psychology Today)](https://www.psychologytoday.com/us/blog/theory-knowledge/202204/evolutionary-functional-analysis-the-big-five-traits)
- [Dual Strategies Theory — Prestige vs Dominance (Wikipedia)](https://en.wikipedia.org/wiki/Dual_strategies_theory)
- [Hunter-Gatherer Social Roles (National Geographic)](https://education.nationalgeographic.org/resource/hunter-gatherer-culture/)
- [Evolution of Specialized Minds (Cambridge)](https://www.cambridge.org/core/blog/2022/08/02/the-evolution-of-specialised-minds/)
- [Storytelling and Cooperation in Hunter-Gatherers (Nature)](https://www.nature.com/articles/s41467-017-02036-8)
- [Shamanism Social Functions (PMC)](https://pmc.ncbi.nlm.nih.gov/articles/PMC10401513/)
- [Origins of Religion in Hunter-Gatherers (Springer)](https://link.springer.com/article/10.1007/s12110-016-9260-0)
- [Dunbar's Number (Wikipedia)](https://en.wikipedia.org/wiki/Dunbar's_number)
- [Band Society (Wikipedia)](https://en.wikipedia.org/wiki/Band_society)
- [Hunter-Gatherer Multilevel Sociality (Science Advances)](https://www.science.org/doi/10.1126/sciadv.aax5913)
- [Neolithic Revolution (Wikipedia)](https://en.wikipedia.org/wiki/Neolithic_Revolution)
- [Consensus Decision-Making in Band Societies](https://banotes.org/social-cultural-anthropology/consensus-collective-decision-making-band-societies/)
- [Levels of Socio-Cultural Integration](https://rotel.pressbooks.pub/culturalanthropology/chapter/7-2-levels-of-socio-cultural-integration/)
