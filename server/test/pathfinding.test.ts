import { describe, expect, it, afterEach } from 'vitest';
import { TestGame } from './helpers/testGame.js';
import { findPath } from '../src/engine/pathfinding.js';
import { World } from '../src/engine/world.js';
import type { MapData } from '../src/engine/types.js';

describe('A* Pathfinding', () => {
  let tg: TestGame;

  afterEach(() => {
    tg?.destroy();
  });

  it('finds straight-line path', () => {
    tg = new TestGame();
    const path = findPath(tg.game.world, { x: 1, y: 1 }, { x: 3, y: 1 });
    expect(path).not.toBeNull();
    expect(path).toEqual([
      { x: 1, y: 1 },
      { x: 2, y: 1 },
      { x: 3, y: 1 },
    ]);
  });

  it('finds L-shaped path', () => {
    tg = new TestGame();
    const path = findPath(tg.game.world, { x: 1, y: 1 }, { x: 3, y: 3 });
    expect(path).not.toBeNull();
    expect(path!.length).toBe(5); // Manhattan distance is 4, plus start = 5
    expect(path![0]).toEqual({ x: 1, y: 1 });
    expect(path![path!.length - 1]).toEqual({ x: 3, y: 3 });
  });

  it('returns null for unreachable destination', () => {
    tg = new TestGame();
    const path = findPath(tg.game.world, { x: 1, y: 1 }, { x: 0, y: 0 }); // wall
    expect(path).toBeNull();
  });

  it('returns single-element path for same start and goal', () => {
    tg = new TestGame();
    const path = findPath(tg.game.world, { x: 1, y: 1 }, { x: 1, y: 1 });
    expect(path).toEqual([{ x: 1, y: 1 }]);
  });

  it('routes around walls', () => {
    // Map with a wall in the middle:
    // #####
    // #.#.#
    // #...#
    // #.#.#
    // #####
    const mapData: MapData = {
      width: 5,
      height: 5,
      tiles: [
        ['wall', 'wall', 'wall', 'wall', 'wall'],
        ['wall', 'floor', 'wall', 'floor', 'wall'],
        ['wall', 'floor', 'floor', 'floor', 'wall'],
        ['wall', 'floor', 'wall', 'floor', 'wall'],
        ['wall', 'wall', 'wall', 'wall', 'wall'],
      ],
      activities: [],
      spawnPoints: [],
    };

    tg = new TestGame({ map: mapData });
    const path = findPath(tg.game.world, { x: 1, y: 1 }, { x: 3, y: 1 });
    expect(path).not.toBeNull();
    // Must go around: (1,1) -> (1,2) -> (2,2) -> (3,2) -> (3,1)
    expect(path!.length).toBe(5);
    expect(path![0]).toEqual({ x: 1, y: 1 });
    expect(path![path!.length - 1]).toEqual({ x: 3, y: 1 });
    // Path should not go through (2,1) which is a wall
    expect(path!.some(p => p.x === 2 && p.y === 1)).toBe(false);
  });

  it('finds path on default map', () => {
    tg = new TestGame({ map: 'default' });
    // From top-left area to bottom-right area
    const path = findPath(tg.game.world, { x: 2, y: 8 }, { x: 17, y: 8 });
    expect(path).not.toBeNull();
    expect(path![0]).toEqual({ x: 2, y: 8 });
    expect(path![path!.length - 1]).toEqual({ x: 17, y: 8 });
  });

  it('returns null for out-of-bounds goal', () => {
    tg = new TestGame();
    const path = findPath(tg.game.world, { x: 1, y: 1 }, { x: 99, y: 99 });
    expect(path).toBeNull();
  });

  it('finds shortest path (optimal)', () => {
    tg = new TestGame();
    const path = findPath(tg.game.world, { x: 1, y: 1 }, { x: 3, y: 3 });
    expect(path).not.toBeNull();
    // Manhattan distance = 4, path length = 5 (including start)
    expect(path!.length).toBe(5);
  });

  it('handles fully blocked destination', () => {
    // Island surrounded by walls
    const mapData: MapData = {
      width: 5,
      height: 5,
      tiles: [
        ['wall', 'wall', 'wall', 'wall', 'wall'],
        ['wall', 'floor', 'floor', 'floor', 'wall'],
        ['wall', 'floor', 'wall', 'wall', 'wall'],
        ['wall', 'floor', 'wall', 'floor', 'wall'],
        ['wall', 'wall', 'wall', 'wall', 'wall'],
      ],
      activities: [],
      spawnPoints: [],
    };

    tg = new TestGame({ map: mapData });
    // (3,3) is floor but isolated from (1,1)
    const path = findPath(tg.game.world, { x: 1, y: 1 }, { x: 3, y: 3 });
    expect(path).toBeNull();
  });
});
