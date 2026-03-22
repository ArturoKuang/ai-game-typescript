# Chemistry System Design Discussion

Brainstorming notes for a BotW-inspired chemistry/physics system powered by LLMs + deterministic simulation.

---

## Core Concept

A system where players combine materials and the interactions are resolved by **deterministic physics rules** for known interactions + **LLM as a fallback** for novel combinations. Results are cached permanently so the LLM acts as a one-time procedural content generator.

---

## The Property-Process-Threshold Model

Instead of recipe-based crafting (fire + wood = burning wood), model materials with **continuous physical properties** and **thresholds** that trigger transformations.

### Material Properties (continuous floats)
- `temperature` — current temp in degrees C, ambient ~20
- `ignitionPoint` — temp threshold for combustion
- `meltingPoint` / `freezingPoint` — state change thresholds
- `thermalConductivity` — how fast heat propagates through/between materials
- `electricalConductivity` — 0-1
- `density` — affects gravity, buoyancy, wind resistance
- `fuelEnergy` — chemical energy available to burn
- `moisture` — 0-1, raises effective ignition threshold
- `hardness` — resistance to breaking/deformation
- `friction` — 0-1, affects movement speed on surface

### Threshold-Driven Transformations
When a continuous property crosses a threshold, a **transformation event** fires:
- Wood temp > ignitionPoint → combustion begins, wood becomes heat source
- Ice temp > 0 → melts to water
- Sand temp > meltingPoint → becomes glass
- Fuel depleted → burning material becomes ash/burnProduct

### Why This Is Better Than Recipes
- Small fire warms wood but doesn't ignite — falls out of the math
- Wet wood is harder to burn — moisture raises effective ignition threshold
- Wind fans flames hotter — increases oxygen/heat output, pushing temp past thresholds
- Players learn **physics**, not a wiki of recipes

---

## The Five Verbs of Material Interaction

1. **Propagation** — energy/substance moves through space (heat through metal, electricity through water, fire across flammable surfaces)
2. **Transformation** — material changes form when threshold crossed (wood→ash, ice→water→steam, sand→glass)
3. **Force Transfer** — kinetic energy moves/deforms objects based on mass and elasticity (explosions push light objects, hammers shatter brittle glass)
4. **Accumulation** — substances layer onto surfaces and modify properties (oil lowers ignition threshold, water raises it, ice adds slipperiness)
5. **Obstruction** — materials block processes (stone blocks wind, rubber insulates electricity, water blocks fire)

---

## Where the LLM Fits

### Deterministic layer handles:
- All five verbs above (propagation, transformation, force, accumulation, obstruction)
- Known material definitions and their property values
- Threshold checks and state transitions

### LLM handles:
1. **Novel transformation resolution** — when a transformation fires but the result isn't in the deterministic table, the LLM generates the new MaterialDef (with properties constrained to the game's schema and power-capped)
2. **Novel combination resolution** — player combines honey + sword, no rule matches, LLM generates "sticky_sword" with defined properties. Cached permanently.
3. **Flavor/narration** — describing emergent situations to players and NPCs
4. **Puzzle hints** — NPC dialogue that hints at solutions based on available materials and obstacle vulnerabilities

### LLM Output Schema (constrained)
```
Input: two material definitions + context (location, weather, etc.)
Output:
  - result_name: string
  - result_properties: must use game's property schema
  - power_level: 1-10, cannot exceed max(inputs) + 1
  - duration: temporary | permanent
  - description: one sentence
```

### Caching Strategy
- First novel combination = LLM call (~1-2s, acceptable at crafting station)
- Result cached permanently (Map in memory + optionally Postgres)
- Every subsequent identical combination = instant lookup

---

## Architecture: How It Fits the Codebase

### Current State
- 20x20 tile grid, tiles are `floor | wall | water`
- Tick-based game loop (2-20 ticks/sec)
- Engine is I/O-free, fully testable
- Event system broadcasts GameEvents
- Players have float x,y positions
- No inventory, no materials, no per-tile mutable state

### New: Tile State Layer
Each tile gets mutable state alongside the static tile grid:

```typescript
interface TileState {
  temperature: number;     // degrees C, ambient ~20
  moisture: number;        // 0-1
  fuel: number;            // chemical energy available
  conductivity: number;    // electrical, 0-1
  friction: number;        // 0-1
  overlay: MaterialId | null;  // what material is ON this tile
  burning: boolean;
  electrified: number;     // charge level
}
```

### New: Material Definitions
```typescript
interface MaterialDef {
  id: string;
  properties: {
    ignitionPoint: number;
    meltingPoint: number;
    freezingPoint: number;
    thermalConductivity: number;
    electricalConductivity: number;
    density: number;
    fuelEnergy: number;
    burnProduct: string | null;
    meltProduct: string | null;
  };
  state: "solid" | "liquid" | "gas";
  placeable: boolean;
}
```

### New: Player Inventory
```typescript
interface Player {
  // ...existing fields...
  inventory?: MaterialInstance[];
}
```

### Game Loop Integration
```
tick():
  1. Player input (movement, use item, throw)
  2. Physics step (advance projectiles, apply explosions, spread fluids)
  3. Chemistry step (propagate heat, check thresholds, transform materials)
  4. Conversation step (existing)
  5. Emit events
```

Physics runs before chemistry because projectiles need to land before they can ignite things.

### File Structure
```
server/src/engine/chemistry/
  properties.ts      # TileState, MaterialDef, MaterialInstance types
  materials.ts       # Material registry, loads from data/materials.json
  simulation.ts      # Per-tick heat/moisture/electricity propagation
  thresholds.ts      # Threshold checks -> transformation events
  combinations.ts    # Deterministic combo rules + LLM fallback cache
  physics.ts         # Projectiles, explosions, fluid spread
  index.ts           # ChemistryEngine orchestrates all of the above

data/
  materials.json     # Base material definitions
  combinations.json  # Known deterministic combinations
```

---

## Physics: Tile-Native, No External Engine

A full physics engine (Matter.js, Rapier, Box2D) creates an impedance mismatch with the tile grid. Instead, implement tile-native physics:

### Projectiles — Raycasting on Grid
- Float positions, velocity vectors, optional gravity for arcs
- Advance per tick, check tile collision via Bresenham's line
- On impact: deposit material on tile, trigger chemistry interaction

### Explosions — Radial Blast
- For each tile within radius: force falloff = force / (distance+1)^2
- Add heat proportional to distance
- Push movable objects outward based on force vs density
- Destroy overlays where force > hardness

### Fluid Spread — Cellular Automaton
- Each tick, liquid overlay flows to neighbors with lower fluid level
- Flow rate = (level difference) * 0.25
- Add height field to tiles for downhill flow
- Oil trail + ignition at one end = fire propagation along trail

### When to Reconsider
Switch to a real physics engine (Rapier recommended) if the game needs:
- Continuous non-tile movement with complex constraints
- 100+ dynamic bodies simultaneously
- Ropes, hinges, pulleys, vehicles
- 3D or isometric with true depth

---

## Continuous Movement: The Hybrid Approach

### The Spectrum
1. **Pure tile** — everything snaps to grid (current WASD)
2. **Continuous entities, tile world** — players/objects move smoothly, world stays grid (recommended)
3. **Fully continuous** — no grid at all (overkill)

### What Changes
- **Movement**: WASD sets velocity instead of teleporting. `player.vx = 4.0` on keydown, `0` on keyup. Position advances per tick.
- **Collision**: Circle-vs-AABB against tile boundaries. Wall sliding (try X, then Y separately) for smooth feel.
- **Pathfinding**: A* still works on grid. NPCs pathfind on tiles, then follow path with continuous interpolation.
- **Tick rate**: Bump to 20/sec server-side. Client interpolates at 60fps between server states.

### What Stays the Same
- World grid (walls, terrain, activities)
- Chemistry simulation (heat propagation cell-to-cell)
- Pathfinding algorithm (A* on tiles)

### Bridge Between Continuous and Grid
```
Continuous entity (fire at 3.7, 4.2)
    -> deposits heat weighted by distance to nearby tiles
Grid simulation (propagation, threshold checks)
    -> triggers transformation
Grid spawns continuous entity (new fire at 4.3, 4.6)
```

The grid does the physics math. Continuous entities are the visual/interactive layer. Player never sees the grid.

---

## Combat Puzzle Examples

> Enemy camp: guards in metal armor on a wooden platform over a stream. It's raining.

Emergent solutions from the property system (none scripted):
- Lightning spell -> metal armor conducts -> electrocution
- Fire arrow -> wooden platform ignites -> collapses -> guards fall in stream -> heavy armor = drowning
- Freeze stream -> ice propagates -> guards slip
- Oil pot on platform -> guard's torch passes near -> massive fire
- Rain = everything wet -> electricity more effective than fire right now

---

## Open Questions / Next Steps

1. **Build order**: Chemistry on tile grid first (v1), then retrofit continuous movement? Or continuous movement first?
2. **LLM prompt engineering**: Exact schema and constraints for novel combination generation
3. **Material catalog**: What's the starter set of materials? (wood, stone, iron, oil, water, ice, cloth, rope, gunpowder, glass, sand, etc.)
4. **Player interaction verbs**: throw, pour, place, combine, light, extinguish — how do these map to the system?
5. **Visual representation**: How does PixiJS render tile state (temperature as color overlay? particle effects for fire?)
6. **Balance**: How to prevent LLM-generated materials from being overpowered across combination chains
7. **Persistence**: Do tile states reset per session or persist? Does the combination cache live in Postgres?
