# Shared Data

This document covers the checked-in runtime data in `data/`.

## `data/map.json`

`data/map.json` is the authoritative checked-in world file used at runtime.

It contains:

- tile layout
- activities
- spawn points
- initial world entities

The current map includes:

- floor, wall, and water tiles
- a central pond represented both as water tiles and nearby `water_source`
  entities for autonomy
- berry bushes, ground food pickups, and campfires

The server serves this file at `/data/map.json`. The browser uses it for tile
rendering and collision prediction.

## Activities

Activities are still static markers embedded in the map file. The server
returns them through `/api/debug/activities`, and the client renders them on
top of the map.

They are visible and useful for orientation, but there is no separate activity
gameplay subsystem yet.

## Spawn Points

Spawn points also come from `data/map.json`.

The human join flow cycles through them using a process-local counter in the
WebSocket server.

## World Entities

The map can seed runtime entities through its `entities` array.

Those entities are loaded into `EntityManager` on boot and then become mutable
runtime state. This is how the shipped map introduces:

- harvestable berry bushes
- edible ground pickups
- pond water-source anchors for `drink`
- campfires for `cook`

## Character Definitions

`server/src/data/characters.ts` is the canonical character list used by the
runtime and debug scenarios.

The repo-root `data/characters.ts` file is now a thin re-export of that list so
tools can import from a stable top-level path without maintaining a second copy.

## Operational Notes

- The runtime still boots world data from checked-in files, not from the
  database.
- Character drift risk is lower now that the repo-root module re-exports the
  server source of truth instead of duplicating it.
