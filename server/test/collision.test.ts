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
    const result = moveWithCollision(2.5, 2.5, 0, 0, PLAYER_RADIUS, w);
    expect(result.x).toBeCloseTo(2.5);
    expect(result.y).toBeCloseTo(2.5);
  });

  test("moving within open floor — no correction", () => {
    const w = world();
    const result = moveWithCollision(2.5, 2.5, 0.1, 0.1, PLAYER_RADIUS, w);
    expect(result.x).toBeCloseTo(2.6);
    expect(result.y).toBeCloseTo(2.6);
  });

  test("circle pushed out when overlapping wall on left", () => {
    const w = world();
    // Start near left wall (wall at x=0), move into it
    const result = moveWithCollision(1.3, 2.5, -0.5, 0, PLAYER_RADIUS, w);
    // Should be pushed out so circle edge doesn't penetrate wall
    expect(result.x).toBeGreaterThanOrEqual(1 + PLAYER_RADIUS);
    expect(result.y).toBeCloseTo(2.5);
  });

  test("circle pushed out when overlapping wall on right", () => {
    const w = world();
    // Start near right wall (wall at x=4), move into it
    const result = moveWithCollision(3.7, 2.5, 0.5, 0, PLAYER_RADIUS, w);
    // Should be pushed out so circle edge doesn't penetrate wall
    expect(result.x).toBeLessThanOrEqual(4 - PLAYER_RADIUS);
    expect(result.y).toBeCloseTo(2.5);
  });

  test("circle pushed out when overlapping wall on top", () => {
    const w = world();
    const result = moveWithCollision(2.5, 1.3, 0, -0.5, PLAYER_RADIUS, w);
    expect(result.y).toBeGreaterThanOrEqual(1 + PLAYER_RADIUS);
    expect(result.x).toBeCloseTo(2.5);
  });

  test("circle pushed out when overlapping wall on bottom", () => {
    const w = world();
    const result = moveWithCollision(2.5, 3.7, 0, 0.5, PLAYER_RADIUS, w);
    expect(result.y).toBeLessThanOrEqual(4 - PLAYER_RADIUS);
    expect(result.x).toBeCloseTo(2.5);
  });

  test("corner case — two walls meet, pushed out of both", () => {
    const w = world();
    // Move toward top-left corner (walls at x=0, y=0)
    const result = moveWithCollision(1.3, 1.3, -0.5, -0.5, PLAYER_RADIUS, w);
    expect(result.x).toBeGreaterThanOrEqual(1 + PLAYER_RADIUS - 0.01);
    expect(result.y).toBeGreaterThanOrEqual(1 + PLAYER_RADIUS - 0.01);
  });

  test("wall sliding — diagonal into wall slides on free axis", () => {
    const w = world();
    // Moving up-left, near top wall. Y should be clamped, X should still move.
    const result = moveWithCollision(2.5, 1.5, -0.3, -0.3, PLAYER_RADIUS, w);
    // X should move freely
    expect(result.x).toBeCloseTo(2.2);
    // Y should be clamped near the wall
    expect(result.y).toBeGreaterThanOrEqual(1 + PLAYER_RADIUS - 0.01);
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
    const result = moveWithCollision(2.5, 2.5, 0.5, 0, PLAYER_RADIUS, w);
    expect(result.x).toBeCloseTo(3.0);
    expect(result.y).toBeCloseTo(2.5);
  });

  test("no movement through walls", () => {
    const w = world();
    // Try to brute-force through right wall with large dx
    const result = moveWithCollision(3.5, 2.5, 2.0, 0, PLAYER_RADIUS, w);
    expect(result.x).toBeLessThanOrEqual(4 - PLAYER_RADIUS);
  });
});
