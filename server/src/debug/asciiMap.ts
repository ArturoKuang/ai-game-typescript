/**
 * ASCII map renderer shared by the debug API and both harnesses.
 *
 * This module translates authoritative runtime state from {@link GameLoop}
 * into a terminal-friendly snapshot. It does not own state; it is a read-only
 * projection layer used for inspection, bundles, and human-readable test
 * output.
 */
import type { GameLoop } from "../engine/gameLoop.js";

/** Renders the current world snapshot plus a legend for players and activities. */
export function renderAsciiMap(game: GameLoop): {
  ascii: string;
  legend: Record<string, string>;
} {
  const world = game.world;
  const players = game.getPlayers();
  // Legend keys match the glyphs rendered into the grid below so harness
  // bundles can be read without separately inspecting player state JSON.
  const legend: Record<string, string> = {};

  // Build grid from tiles
  const grid: string[][] = [];
  for (let y = 0; y < world.height; y++) {
    const row: string[] = [];
    for (let x = 0; x < world.width; x++) {
      const tile = world.getTile(x, y);
      if (!tile) {
        row.push(" ");
      } else if (tile.type === "wall") {
        row.push("#");
      } else if (tile.type === "water") {
        row.push("~");
      } else {
        row.push(".");
      }
    }
    grid.push(row);
  }

  // Place activities
  for (const activity of world.getActivities()) {
    if (
      activity.y >= 0 &&
      activity.y < world.height &&
      activity.x >= 0 &&
      activity.x < world.width
    ) {
      const symbol = activity.emoji.charAt(0);
      grid[activity.y][activity.x] = symbol;
      legend[symbol] = activity.name;
    }
  }

  // Place players last so dynamic entities override static tiles/activities.
  for (const p of players) {
    const px = Math.round(p.x);
    const py = Math.round(p.y);
    const initial = p.name.charAt(0).toUpperCase();
    if (py >= 0 && py < world.height && px >= 0 && px < world.width) {
      grid[py][px] = initial;
    }
    let stateStr: string;
    if (p.state === "idle") {
      stateStr = "idle";
    } else if (p.state === "walking" && (p.vx !== 0 || p.vy !== 0)) {
      stateStr = `moving v=(${p.vx.toFixed(1)},${p.vy.toFixed(1)})`;
    } else if (p.state === "walking" && p.targetX !== undefined) {
      stateStr = `walking→(${p.targetX},${p.targetY})`;
    } else {
      stateStr = p.state;
    }
    legend[initial] = `${p.name}(${px},${py}) ${stateStr}`;
  }

  // Draw conversation links between conversing players
  const linked = new Set<string>();
  for (const p of players) {
    if (p.currentConvoId && !linked.has(p.id)) {
      const partner = players.find(
        (other) =>
          other.id !== p.id && other.currentConvoId === p.currentConvoId,
      );
      if (partner) {
        linked.add(p.id);
        linked.add(partner.id);
        const p1 = p.name.charAt(0).toUpperCase();
        const p2 = partner.name.charAt(0).toUpperCase();
        legend[`${p1}↔${p2}`] = "in conversation";
      }
    }
  }

  // Build border and output
  const borderTop = `┌${"─".repeat(world.width)}┐`;
  const borderBot = `└${"─".repeat(world.width)}┘`;
  const lines: string[] = [borderTop];
  for (const row of grid) {
    lines.push(`│${row.join("")}│`);
  }
  lines.push(borderBot);

  // Add legend
  lines.push("");
  lines.push("Legend:");
  for (const [sym, desc] of Object.entries(legend)) {
    lines.push(`  ${sym} = ${desc}`);
  }

  return { ascii: lines.join("\n"), legend };
}
