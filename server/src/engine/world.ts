import type { Activity, MapData, Position, Tile, TileType } from './types.js';

export class World {
  readonly width: number;
  readonly height: number;
  private tiles: Tile[][];
  private activities: Activity[];
  private spawns: Position[];

  constructor(mapData: MapData) {
    this.width = mapData.width;
    this.height = mapData.height;
    this.activities = mapData.activities;
    this.spawns = mapData.spawnPoints;

    // Build tile grid
    this.tiles = [];
    for (let y = 0; y < this.height; y++) {
      const row: Tile[] = [];
      for (let x = 0; x < this.width; x++) {
        const tileType: TileType = mapData.tiles[y]?.[x] ?? 'wall';
        const activity = this.activities.find(a => a.x === x && a.y === y);
        row.push({ type: tileType, activityId: activity?.id });
      }
      this.tiles.push(row);
    }
  }

  getTile(x: number, y: number): Tile | null {
    if (x < 0 || x >= this.width || y < 0 || y >= this.height) return null;
    return this.tiles[y][x];
  }

  isWalkable(x: number, y: number): boolean {
    const tile = this.getTile(x, y);
    return tile !== null && tile.type === 'floor';
  }

  /** Returns 4-directional walkable neighbors */
  getNeighbors(pos: Position): Position[] {
    const dirs: Position[] = [
      { x: 0, y: -1 }, // up
      { x: 0, y: 1 },  // down
      { x: -1, y: 0 }, // left
      { x: 1, y: 0 },  // right
    ];
    const result: Position[] = [];
    for (const d of dirs) {
      const nx = pos.x + d.x;
      const ny = pos.y + d.y;
      if (this.isWalkable(nx, ny)) {
        result.push({ x: nx, y: ny });
      }
    }
    return result;
  }

  getActivity(x: number, y: number): Activity | undefined {
    const tile = this.getTile(x, y);
    if (!tile?.activityId) return undefined;
    return this.activities.find(a => a.id === tile.activityId);
  }

  getActivities(): Activity[] {
    return this.activities;
  }

  getSpawnPoints(): Position[] {
    return this.spawns;
  }
}
