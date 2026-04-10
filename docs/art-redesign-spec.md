# AI Town — Art & UI Redesign Spec

> Senior art direction pass. Target: a cohesive, readable, emotionally legible
> "Dawn of Civilization" game that replaces the current cluttered / theme-mismatched
> look with a focused primordial aesthetic.

## 1. Problem Statement

The current build has three compounding issues:

1. **Theme mismatch.** The fiction (pre-linguistic band of eight founders in an
   untamed land, `docs/civilization-design.md`) is primordial, earthy, pre-architecture.
   The visuals pull from Kenney's *Roguelike RPG Pack* — a medieval tavern/dungeon
   tileset with cobble, wood benches, farmhouses — which tells a completely different
   story.
2. **Procedural characters lack identity.** Eight founders with deep trait vectors
   (Kael the hunter, Senna the healer, Thane the warrior…) all render from the same
   16-px palette-swap generator (`client/src/pixelSprites.ts:99-150`). A human
   player cannot tell Kael from Dax at a glance.
3. **UI is a color riot.** The 320-px sidebar mixes dark navy `#1a1a2e`, magenta
   `#e94560`, teal `#48c9b0`, blue `#5dade2`, gold `#f7dc6f`, cream chat bubbles
   `#f7ebc6`, and red HP bars `#e63946`, all in Courier New, all at once
   (`client/index.html`). Six panels stacked with no hierarchy. Debug HUD lives
   in a separate overlay.

This spec defines a single coherent visual language and the work needed to
adopt it.

---

## 2. Design Pillars

| Pillar | What it means in practice |
|---|---|
| **Primal, not medieval** | Earth, clay, bone, fire, moss. No cobblestone, no farmhouses, no wooden signage. |
| **Readable at a glance** | A player should identify whose turn, who is hungry, and who is fighting in < 1 second. |
| **Distinct silhouettes** | Each of the 8 founders has a unique shape before color — spear, shawl, staff, antlers, child-on-hip, etc. |
| **Quiet UI, loud world** | The world is where drama happens. UI is parchment-and-ink chrome that never fights the game canvas. |
| **One font, one palette** | Not six. |

---

## 3. Art Direction

### 3.1 Color palette (locked)

A 16-color palette inspired by cave pigment and firelight. All art (tiles, props,
characters, UI) pulls from this list — no off-palette colors.

```
#1b1410  bone-black   (outlines, deep shadow)
#2c2118  soot         (night sky, UI background)
#4a3424  umber        (dirt, hide, UI border)
#6b4a2b  clay          (path, leather)
#8a6a3d  ochre         (sunlit earth, HUD accent)
#b58c4a  straw         (dry grass, torchlight)
#d9b779  bone          (name plates, UI text)
#f0dcae  parchment     (chat panel, highlights)
#3b5a2a  moss-dark     (forest canopy)
#6a8f3a  moss          (grass blades)
#9cbf5a  sage          (fresh growth)
#2f4a5c  deep-water    (river)
#4a7ea0  river         (water surface)
#a63a1e  ember         (fire core, danger)
#e07a2c  flame         (fire glow, warnings)
#7a2a2a  blood         (HP critical, wounds)
```

The current palette (`#1a1a2e` navy, `#e94560` magenta, `#48c9b0` teal) is
retired entirely.

### 3.2 Typography

- **World / name plates / UI body**: *m5x7* or *m6x11* by Daniel Linssen
  (CC0 pixel fonts). Fallback: `"IBM Plex Mono", monospace`.
- **Headlines**: *Alagard* (CC-BY) for panel titles. Used sparingly.
- **Retire Courier New everywhere.**
- All text renders in `#f0dcae` parchment on `#2c2118` soot, or inverted for
  highlight states. No red/teal/gold label colors.

### 3.3 Lighting

- World has a warm global tint (`#ffe9b8 @ 18% multiply`) to unify the Kenney
  atlas and custom props under one temperature.
- Night cycle (future): tint shifts to `#2c4a6b @ 35% multiply`, campfires
  become the only warm light source via additive sprites.
- Every actor gets a soft drop shadow (already implemented, keep it; thin it to
  `rgba(0,0,0,0.35)` ellipse).

---

## 4. World & Tiles

### 4.1 Terrain tile types (new canonical set)

Replace the current grab-bag (`grass / dirt / water / cobble / track / tilled
/ wall / floor`) with a smaller primal set. Autotiled.

| Tile | Purpose | Source |
|---|---|---|
| `grass_short` | Default ground cover | Kenney roguelike (recolored) |
| `grass_tall` | Forage-heavy zones | Kenney + custom tufts |
| `dirt_packed` | Well-trodden paths (emerge from player movement) | Custom |
| `stone_outcrop` | Impassable rock (replaces `wall`) | Kenney recolored |
| `river_shallow` | Drinkable water | Kenney (recolored `#4a7ea0`) |
| `river_deep` | Impassable | Kenney recolored |
| `sand_bank` | River edge transition | Custom |
| `moss_rock` | Resting spots | Custom |

**Retire**: `cobble`, `floor`, `tilled`, `wall` (the medieval tileset remnants).
The map has no buildings in Act 1 — the fiction is pre-architecture. Interior
walls in `data/map.json` should be deleted.

### 4.2 Props / entities

| Entity | Visual | Interaction |
|---|---|---|
| `berry_bush` | 24-px bush, 5 red berries visible, shrinks as depleted | Forage |
| `water_source` | Animated river tile with ripple foam | Drink |
| `campfire` | 2-frame animated fire + 8-px flickering light sprite | Warm, cook |
| `ground_item` | Small pile silhouette sized to item type (meat = red, root = brown) | Pickup |
| `bear` *(new)* | 32-px brown silhouette, distinct heavy gait | Combat threat |
| `stone_cairn` *(new)* | Player-built marker, 3 stacked stones | Territory claim |
| `hide_shelter` *(new)* | Pelt tent, Act 2 building | Rest, sleep |

All props get a 1-px `#1b1410` outline for pop against grass.

### 4.3 Map composition

Hand-author a single **Act 1 map** that tells a story spatially:

```
        ┌────── dense forest (berries, bear hazard) ──────┐
        │                                                  │
  river bend ──── meadow (spawn ring) ──── bare rock ridge
        │             │                                    │
        │         central clearing                         │
        │         (campfire, cairn)                        │
        └──── reed bank ────────── grass open ─────────────┘
```

Replaces the current symmetric 20×20 box with a perimeter of walls and a water
puddle in the middle. Still 20×20 for engine compatibility; redistributed.

---

## 5. Character Design

### 5.1 Silhouette-first founders

Each of the 8 founders gets a hand-drawn 24×32 px sprite sheet (up from the
current 16×16). Orientations: down, up, left, right. States: idle (2f), walk (4f),
talk (2f), act (2f), hurt (1f). Total 44 frames per character.

Silhouettes are designed to be distinguishable as black-only shapes:

| ID | Name | Silhouette cue | Palette anchor |
|---|---|---|---|
| `npc_kael` | Kael the hunter | Tall, spear over shoulder, hood up | ochre + moss |
| `npc_senna` | Senna the healer | Shawl, satchel at hip, hair loose | sage + bone |
| `npc_thane` | Thane the warder | Broad, club, scarred pauldron | clay + blood |
| `npc_lyra` | Lyra the forager | Short, wide basket, bare feet | straw + sage |
| `npc_oren` | Oren the elder | Stooped, walking stick, long beard | umber + parchment |
| `npc_mira` | Mira the firekeeper | Ember pouch, soot-smudged, braid | ember + soot |
| `npc_dax` | Dax the wanderer | Lean, pack on back, no hood | clay + river |
| `npc_vara` | Vara the bold | Antlered headband, twin blades | moss-dark + ember |

Human players get 4 generic "newcomer" sprites, palette-swappable, clearly
distinct in silhouette from all 8 founders (simpler outline, no distinguishing
gear).

### 5.2 Animation budget

- 12 fps for walk cycles (was continuous; quantize to match pixel aesthetic).
- Talk: gentle 2-frame mouth/head bob when speaking, synced to chat bubble
  lifetime.
- Hurt: 1-frame flash to `#e07a2c` flame on damage, 120ms duration.
- Emote system (new): single 16×16 sprite above head (`!`, `?`, `♥`, `💀`-style
  skull, `…`) driven by autonomy state. Replaces current "no visual feedback"
  complaint.

### 5.3 Nameplate

- Render only for hovered / talking / self characters. Not all 8 + players all
  the time — the current constant name soup is half the clutter.
- Style: `m5x7` 8-px bone text, soot outline, no background box.

---

## 6. UI Redesign

### 6.1 Layout change

Current: 320-px right sidebar stuffed with Join, Status, Player list,
Conversation, Survival bars, Inventory.

New: **HUD-over-canvas** with three persistent zones and one drawer.

```
┌─────────────────────────────────────────────────────────┐
│ [top-left needs ring]                    [top-right log]│
│                                                          │
│                                                          │
│                    GAME CANVAS                           │
│                    (full width)                          │
│                                                          │
│                                                          │
│                                                          │
│ [bottom-left actor badge]         [bottom chat bar]      │
└─────────────────────────────────────────────────────────┘
```

- **Needs ring** (top-left, 96×96): radial health / food / water / social as
  four arcs on one disc. Color by severity only (bone → flame → blood). No
  percentages.
- **Actor badge** (bottom-left, 180×64): portrait of your character + current
  activity ("foraging", "walking", "talking to Senna"). Replaces the status bar.
- **Chat bar** (bottom, centered, 560×48): single-line input that expands
  upward into a 4-message history when focused. Conversation partner shown as
  a sprite-sized portrait at left. No separate conversation panel.
- **Event log** (top-right, 260×120, fades in/out): last 3 world events
  ("Kael speared a hare", "Vara challenged Thane"). Replaces the debug HUD for
  casual players.
- **Inventory drawer**: press `I`. Slides up from bottom over the canvas, 6×4
  grid, parchment background. Same keybind as today, completely restyled.
- **Player list**: removed from persistent UI. Accessible via `Tab` as a modal
  overlay with portraits.

### 6.2 Panel chrome

- All panels use a `#2c2118` soot fill, `#4a3424` umber 2-px border, `#f0dcae`
  parchment text, and a subtle 4-px parchment texture PNG at 12% opacity.
- One accent color for interactivity: `#e07a2c` flame on hover, `#8a6a3d` ochre
  when disabled. No magenta, no teal, no cyan, no navy.
- Buttons: 2-px outset border, 1-px highlight on top, 1-px shadow on bottom —
  classic pixel button, never a CSS gradient.

### 6.3 Debug vs. play separation

- `debug.html` stays as-is for developers (unchanged scope).
- In-game `?debug=1` URL param shows a translucent parchment sidebar on the
  right with tick, mode, scenario — but off by default, not always-on.

---

## 7. Asset Sourcing Plan

**Kept from current Kenney pack** (`client/public/assets/kenney/roguelike-rpg-pack/`):
- Base grass, dirt, water, rock, tree tiles — recolored to the 16-color palette
  via a Pixi color-matrix filter at load time (no editing source atlas).

**Retired from Kenney**:
- All buildings, fences, furniture, weapons, torches, signs — none of it fits
  a pre-architecture setting.

**Additional packs** (all CC0 / free, Kenney + others):
- [Kenney Tiny Town](https://kenney.nl/assets/tiny-town) — simpler silhouettes
  to blend with primal style (use only stones, grass tufts).
- [Kenney Pixel Platformer Characters](https://kenney.nl/assets/pixel-platformer-characters)
  — reference proportions only, not direct use.
- Custom-drawn founders (8 sheets × 44 frames) — **the only mandatory custom
  art**. ~350 frames total. Budget: 2–3 days for one artist, or one LLM-assisted
  pixel-art pass.

**UI assets**:
- 9-slice parchment panel PNG (64×64, one file).
- 16×16 emote sheet (8 emotes, one file).
- `m5x7.ttf` and `alagard.ttf` in `client/public/fonts/`.

Total new art files: **~12 PNGs + 2 fonts**. Everything else is recolor /
palette transform of existing assets.

---

## 8. Implementation Phases

Each phase is independently shippable and visibly better than the previous.

### Phase 1 — Palette & UI chrome (1 day)
- Add 16-color palette as CSS variables in `client/index.html`.
- Swap fonts; load `m5x7`.
- Restyle sidebar with new palette. Keep layout the same. Immediate win.
- **Deliverable**: no more navy + magenta + teal clash.

### Phase 2 — World recolor (1 day)
- Add a Pixi `ColorMatrixFilter` over `groundContainer` and `detailContainer`
  that maps the Kenney atlas into the 16-color palette.
- Delete `cobble`, `tilled`, `wall`, `floor` tile usages in `data/map.json`;
  rebuild the map layout described in §4.3.
- **Deliverable**: the world reads as primordial instead of medieval.

### Phase 3 — HUD relayout (2 days)
- Move from right sidebar to HUD-over-canvas (§6.1).
- Implement needs ring, actor badge, chat bar, event log.
- Player list → Tab modal.
- **Deliverable**: UI stops fighting the game.

### Phase 4 — Founder sprites (3 days)
- Draw or commission 8 founder sheets (24×32, 44 frames each).
- Replace `createActorFrame()` palette-swap path with texture lookup by
  character ID; fall back to generated sprites for human players.
- Add emote sprite above head driven by autonomy state.
- **Deliverable**: 8 founders look like 8 people.

### Phase 5 — Polish (1–2 days)
- Chat bubble restyle to match parchment panels.
- Lighting tint pass (§3.3).
- Day/night cycle scaffolding (optional, can defer).
- Screenshot pass for README / marketing.
- **Deliverable**: shippable new look.

**Total**: ~8–9 engineering-days + art time for founders.

---

## 9. Out of Scope

- 3D / isometric — stays top-down 2D.
- Particle systems beyond campfire.
- New gameplay mechanics. This is strictly a visual redesign.
- Replacing PixiJS.
- Localization of fonts (m5x7 covers Latin only; future concern).

---

## 10. Success Criteria

1. A new player, shown a screenshot with no UI, can guess the game's fiction
   ("early humans", "survival", "tribe") without being told.
2. You can tell all 8 founders apart from a single still frame at actor scale.
3. The UI uses ≤ 3 colors in any given frame (parchment text, soot chrome, one
   accent).
4. No frame of the game contains cobblestone, wooden fences, or farmhouses.
5. Courier New appears nowhere in the client.

---

## Implementation notes (2026-04-10)

**Phase 4 status — procedural MVP, not hand-drawn:** Phase 4 ships with per-
founder procedural silhouettes instead of the 24×32 × 44-frame hand-drawn
sheets described in §5.1 / §5.2. `client/src/pixelSprites.ts` now dispatches
on `characterId` to a `FOUNDER_PRESETS` table that sets palette anchors and a
distinguishing accessory overlay (`hood_spear`, `shawl`, `club`, `basket`,
`stick`, `ember`, `pack`, `antlers`) per the silhouette cues in §5.1. Frames
stay 16×16 in the existing 3-frame walk / 2-frame talk / 1-frame idle budget.
Emote sprites and the 12 fps quantization from §5.2 are not yet implemented —
the existing `waitingIndicator` continues to serve as the "thinking" affordance.

This satisfies Success Criterion #2 at reduced fidelity (distinguishable at
a glance via silhouette + palette anchor, but not at the hand-drawn quality
the spec describes). A follow-up phase is needed to replace the procedural
generators with 24×32 sheets and add the full emote sprite sheet.

