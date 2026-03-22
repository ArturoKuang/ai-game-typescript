import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { GameLoop } from '../../src/engine/gameLoop.js';
import type { MapData, Player, Position, TickResult } from '../../src/engine/types.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
// In Docker: /app/test/helpers -> /app/data/map.json
// On host: server/test/helpers -> data/map.json (via ../../..)
const DEFAULT_MAP_PATH = join(__dirname, '..', '..', 'data', 'map.json');

/** Minimal 5x5 test map with open floor and walls on edges */
const MINI_MAP: MapData = {
  width: 5,
  height: 5,
  tiles: [
    ['wall', 'wall', 'wall', 'wall', 'wall'],
    ['wall', 'floor', 'floor', 'floor', 'wall'],
    ['wall', 'floor', 'floor', 'floor', 'wall'],
    ['wall', 'floor', 'floor', 'floor', 'wall'],
    ['wall', 'wall', 'wall', 'wall', 'wall'],
  ],
  activities: [],
  spawnPoints: [
    { x: 1, y: 1 },
    { x: 3, y: 3 },
  ],
};

export class TestGame {
  game: GameLoop;

  constructor(options?: { seed?: number; map?: MapData | 'default' }) {
    const seed = options?.seed ?? 42;
    this.game = new GameLoop({ seed, mode: 'stepped' });

    if (options?.map === 'default') {
      const mapData: MapData = JSON.parse(readFileSync(DEFAULT_MAP_PATH, 'utf-8'));
      this.game.loadWorld(mapData);
    } else {
      this.game.loadWorld(options?.map ?? MINI_MAP);
    }
  }

  spawn(id: string, x: number, y: number, isNpc: boolean = false): Player {
    return this.game.spawnPlayer({ id, name: id, x, y, isNpc });
  }

  tick(count: number = 1): TickResult[] {
    const results: TickResult[] = [];
    for (let i = 0; i < count; i++) {
      results.push(this.game.tick());
    }
    return results;
  }

  move(playerId: string, x: number, y: number): Position[] | null {
    return this.game.setPlayerTarget(playerId, x, y);
  }

  getPlayer(id: string): Player {
    const p = this.game.getPlayer(id);
    if (!p) throw new Error(`Player ${id} not found`);
    return p;
  }

  /** Spawn two players near each other */
  spawnNearby(id1: string, id2: string, distance: number = 1): [Player, Player] {
    const p1 = this.spawn(id1, 1, 1);
    const p2 = this.spawn(id2, 1 + distance, 1);
    return [p1, p2];
  }

  destroy(): void {
    this.game.reset();
  }
}
