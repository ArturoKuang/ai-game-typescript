import type { MapData, TileType } from "../../src/engine/types.js";

/**
 * Generates an NxN open map (floor with wall border) for stress testing.
 * Optionally places spawn points at corners and center.
 */
export function generateOpenMap(
  width: number,
  height: number,
  spawnCount = 5,
): MapData {
  const tiles: TileType[][] = [];
  for (let y = 0; y < height; y++) {
    const row: TileType[] = [];
    for (let x = 0; x < width; x++) {
      row.push(
        x === 0 || x === width - 1 || y === 0 || y === height - 1
          ? "wall"
          : "floor",
      );
    }
    tiles.push(row);
  }

  const defaultSpawns = [
    { x: 1, y: 1 },
    { x: width - 2, y: 1 },
    { x: 1, y: height - 2 },
    { x: width - 2, y: height - 2 },
    { x: Math.floor(width / 2), y: Math.floor(height / 2) },
  ];

  return {
    width,
    height,
    tiles,
    activities: [],
    spawnPoints: defaultSpawns.slice(0, spawnCount),
  };
}
