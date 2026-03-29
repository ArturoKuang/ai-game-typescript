# Shared Data

This document covers the shared static content in `data/` and the NPC definition copies used across the repo.

## Map Data

`data/map.json` is the canonical shipped map.

Current shape:

- width: `20`
- height: `20`
- tile counts:
  - `304` floor
  - `96` wall
  - `0` water in the current file
- activities: `5`
- spawn points: `5`

The map file provides:

- tile layout
- activity definitions
- spawn points

The server serves this file at `/data/map.json`, and the browser uses it for:

- tile rendering
- activity rendering
- collision prediction

## Activities

Current activities from `data/map.json`:

| Id | Name | Position | Capacity | Emoji |
| --- | --- | --- | --- | --- |
| 1 | cafe counter | `(3, 3)` | 2 | `☕` |
| 2 | reading nook | `(16, 3)` | 2 | `📚` |
| 3 | park bench west | `(5, 15)` | 2 | `🪑` |
| 4 | park bench east | `(14, 15)` | 2 | `🪑` |
| 5 | town fountain | `(10, 10)` | 4 | `⛲` |

These are currently decorative/debug-visible markers. The engine has `currentActivityId` on players, but no active activity behavior subsystem yet.

## Spawn Points

Current spawn points:

- `(2, 8)`
- `(17, 8)`
- `(10, 2)`
- `(10, 17)`
- `(10, 10)`

The WebSocket join flow cycles through these points using a process-local human counter.

## NPC Definitions

There are two copies of the NPC definition list:

- `data/characters.ts`
- `server/src/data/characters.ts`

Current server behavior:

- `server/src/index.ts` imports `server/src/data/characters.ts`

Current cast:

- `npc_alice`
- `npc_bob`
- `npc_carol`
- `npc_dave`
- `npc_eve`

Each entry includes:

- id
- name
- description
- personality
- spawn point
- emoji

## Data Flow

### Server

- loads `data/map.json` at boot
- spawns NPCs from `server/src/data/characters.ts`
- does not currently load world or activities from PostgreSQL

### Client

- fetches `/data/map.json`
- fetches `/api/debug/activities`
- does not consume either `characters.ts` file directly

## Maintenance Notes

- The duplicated character files can drift because they are not generated from a single source.
- The map is a checked-in artifact and is currently the only world source used at runtime.
- The schema includes `world` and `activities` tables, but the current world boot path is still file-based.
