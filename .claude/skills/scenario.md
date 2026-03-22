# Load and Inspect Scenario

Load a preset scenario, tick the simulation, and display the game state.

## Arguments

- `{{name}}` — scenario name: `empty`, `two_npcs_near_cafe`, or `crowded_town` (default: `two_npcs_near_cafe`)
- `{{ticks}}` — number of ticks to advance (default: 0)

## Instructions

### Step 1: Load Scenario

```bash
# Reset and load the scenario
curl -s -X POST localhost:3001/api/debug/reset | jq .
curl -s -X POST localhost:3001/api/debug/scenario -H 'Content-Type: application/json' -d '{"name": "{{name}}"}' | jq .
```

If the server is not running, report the error and suggest starting it with `cd server && npm run dev`.

### Step 2: Advance Ticks (if requested)

If `{{ticks}}` > 0:

```bash
curl -s -X POST localhost:3001/api/debug/tick -H 'Content-Type: application/json' -d '{"count": {{ticks}}}' | jq .
```

### Step 3: Display State

```bash
# Show the map
curl -s localhost:3001/api/debug/map

# Show game state
curl -s localhost:3001/api/debug/state | jq .

# Show all players
curl -s localhost:3001/api/debug/players | jq .

# Show any active conversations
curl -s localhost:3001/api/debug/conversations | jq .

# Show recent events
curl -s 'localhost:3001/api/debug/log?limit=10' | jq .
```

### Available Scenarios

- **empty** — No players. Clean slate for manual setup.
- **two_npcs_near_cafe** — Alice Chen (2,2) and Bob Martinez (4,2) near the cafe. Good for testing conversations and movement.
- **crowded_town** — All 5 NPCs at various locations: Alice (3,3), Bob (16,3), Carol (10,10), Dave (5,15), Eve (14,15). Good for stress testing.
