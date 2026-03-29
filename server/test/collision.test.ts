import { describe, expect, test } from "vitest";
import {
  PLAYER_RADIUS,
  moveWithCollision,
} from "../src/engine/collision.js";
import { World } from "../src/engine/world.js";
import type { MapData } from "../src/engine/types.js";

/** 5x5 map: walls on edges, floor in center */
const MINI_MAP: MapData = {
  width: 5,
  height: 5,
  tiles: [
    ["wall", "wall", "wall", "wall", "wall"],
    ["wall", "floor", "floor", "floor", "wall"],
    ["wall", "floor", "floor", "floor", "wall"],
    ["wall", "floor", "floor", "floor", "wall"],
    ["wall", "wall", "wall", "wall", "wall"],
  ],
  activities: [],
  spawnPoints: [],
};

function world(): World {
  return new World(MINI_MAP);
}

describe("collision", () => {
  test("PLAYER_RADIUS is 0.4", () => {
    expect(PLAYER_RADIUS).toBe(0.4);
  });

  test("circle inside floor — no correction", () => {
    const w = world();
    const result = moveWithCollision(2, 2, 0, 0, PLAYER_RADIUS, w);
    expect(result.x).toBeCloseTo(2);
    expect(result.y).toBeCloseTo(2);
  });

  test("moving within open floor — no correction", () => {
    const w = world();
    const result = moveWithCollision(2, 2, 0.1, 0.1, PLAYER_RADIUS, w);
    expect(result.x).toBeCloseTo(2.1);
    expect(result.y).toBeCloseTo(2.1);
  });

  test("circle pushed out when overlapping wall on left", () => {
    const w = world();
    // Start near left wall (wall at x=0), move into it
    const result = moveWithCollision(0.8, 2, -0.5, 0, PLAYER_RADIUS, w);
    // Should be pushed out so circle edge doesn't penetrate wall
    expect(result.x).toBeGreaterThanOrEqual(1 - 0.5 + PLAYER_RADIUS - 0.01);
    expect(result.y).toBeCloseTo(2);
  });

  test("circle pushed out when overlapping wall on right", () => {
    const w = world();
    // Start near right wall (wall at x=4), move into it
    const result = moveWithCollision(3.2, 2, 0.5, 0, PLAYER_RADIUS, w);
    // Should be pushed out so circle edge doesn't penetrate wall
    expect(result.x).toBeLessThanOrEqual(4 - 0.5 - PLAYER_RADIUS);
    expect(result.y).toBeCloseTo(2);
  });

  test("circle pushed out when overlapping wall on top", () => {
    const w = world();
    const result = moveWithCollision(2, 0.8, 0, -0.5, PLAYER_RADIUS, w);
    expect(result.y).toBeGreaterThanOrEqual(1 - 0.5 + PLAYER_RADIUS - 0.01);
    expect(result.x).toBeCloseTo(2);
  });

  test("circle pushed out when overlapping wall on bottom", () => {
    const w = world();
    const result = moveWithCollision(2, 3.2, 0, 0.5, PLAYER_RADIUS, w);
    expect(result.y).toBeLessThanOrEqual(4 - 0.5 - PLAYER_RADIUS);
    expect(result.x).toBeCloseTo(2);
  });

  test("corner case — two walls meet, pushed out of both", () => {
    const w = world();
    // Move toward top-left corner (walls at x=0, y=0)
    const result = moveWithCollision(0.8, 0.8, -0.5, -0.5, PLAYER_RADIUS, w);
    expect(result.x).toBeGreaterThanOrEqual(1 - 0.5 + PLAYER_RADIUS - 0.01);
    expect(result.y).toBeGreaterThanOrEqual(1 - 0.5 + PLAYER_RADIUS - 0.01);
  });

  test("wall sliding — diagonal into wall slides on free axis", () => {
    const w = world();
    // Moving up-left, near top wall. Y should be clamped, X should still move.
    const result = moveWithCollision(2, 1, -0.3, -0.3, PLAYER_RADIUS, w);
    // X should move freely
    expect(result.x).toBeCloseTo(1.7);
    // Y should be clamped near the wall
    expect(result.y).toBeGreaterThanOrEqual(1 - 0.5 + PLAYER_RADIUS - 0.01);
  });

  test("narrow corridor traversal — moves along 1-tile-wide corridor", () => {
    // Custom map with a narrow horizontal corridor
    const narrowMap: MapData = {
      width: 7,
      height: 5,
      tiles: [
        ["wall", "wall", "wall", "wall", "wall", "wall", "wall"],
        ["wall", "wall", "wall", "wall", "wall", "wall", "wall"],
        ["wall", "floor", "floor", "floor", "floor", "floor", "wall"],
        ["wall", "wall", "wall", "wall", "wall", "wall", "wall"],
        ["wall", "wall", "wall", "wall", "wall", "wall", "wall"],
      ],
      activities: [],
      spawnPoints: [],
    };
    const w = new World(narrowMap);
    // Player in center of corridor, moving right
    const result = moveWithCollision(2, 2, 0.5, 0, PLAYER_RADIUS, w);
    expect(result.x).toBeCloseTo(2.5);
    expect(result.y).toBeCloseTo(2);
  });

  test("no movement through walls", () => {
    const w = world();
    // Try to brute-force through right wall with large dx
    const result = moveWithCollision(3, 2, 2.0, 0, PLAYER_RADIUS, w);
    expect(result.x).toBeLessThanOrEqual(4 - 0.5 - PLAYER_RADIUS);
  });

  test("no phantom collision with diagonal wall tiles", () => {
    const w = world();
    // Player moving right along wall at y=1 (wall at y=0).
    // Should not be pushed sideways by diagonal wall tiles.
    const start = { x: 2, y: 0.9 };
    const result = moveWithCollision(start.x, start.y, 0.2, 0, PLAYER_RADIUS, w);
    // X should move freely (no wall in movement path)
    expect(result.x).toBeCloseTo(2.2);
    // Y should not change (no Y movement)
    expect(result.y).toBeCloseTo(0.9);
  });

  test("stable position near wall — no drift", () => {
    const w = world();
    // Player at rest against wall — repeated zero-movement should not drift
    const x = 1 - 0.5 + PLAYER_RADIUS; // exactly at wall edge
    const y = 2;
    let pos = { x, y };
    for (let i = 0; i < 10; i++) {
      pos = moveWithCollision(pos.x, pos.y, 0, 0, PLAYER_RADIUS, w);
    }
    expect(pos.x).toBeCloseTo(x, 4);
    expect(pos.y).toBeCloseTo(y, 4);
  });

  test("repeated movement into wall converges — no jitter", () => {
    const w = world();
    // Simulate holding left key into wall for many ticks
    let x = 1;
    const y = 2;
    const positions: number[] = [];
    for (let i = 0; i < 20; i++) {
      const result = moveWithCollision(x, y, -0.25, 0, PLAYER_RADIUS, w);
      x = result.x;
      positions.push(x);
    }
    // Should converge to wall limit and stay there
    const lastFive = positions.slice(-5);
    const variance = Math.max(...lastFive) - Math.min(...lastFive);
    expect(variance).toBeLessThan(0.001);
    expect(x).toBeGreaterThanOrEqual(1 - 0.5 + PLAYER_RADIUS - 0.01);
  });

  test("diagonal movement near corner does not teleport", () => {
    const w = world();
    // Move diagonally toward top-left corner repeatedly
    let x = 1;
    let y = 1;
    for (let i = 0; i < 20; i++) {
      const result = moveWithCollision(x, y, -0.25, -0.25, PLAYER_RADIUS, w);
      // Position should never jump more than the movement amount
      const jumpX = Math.abs(result.x - x);
      const jumpY = Math.abs(result.y - y);
      expect(jumpX).toBeLessThanOrEqual(0.26);
      expect(jumpY).toBeLessThanOrEqual(0.26);
      x = result.x;
      y = result.y;
    }
    // Should be at the corner limit
    expect(x).toBeGreaterThanOrEqual(1 - 0.5 + PLAYER_RADIUS - 0.01);
    expect(y).toBeGreaterThanOrEqual(1 - 0.5 + PLAYER_RADIUS - 0.01);
  });
});
