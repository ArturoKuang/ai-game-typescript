import { describe, expect, test } from "vitest";
import { GameLoop } from "../src/engine/gameLoop.js";
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

function createGame(): GameLoop {
  const game = new GameLoop({ seed: 42, mode: "stepped", tickRate: 20 });
  game.loadWorld(MINI_MAP);
  return game;
}

describe("input-driven movement", () => {
  test("input sets velocity and moves player", () => {
    const game = createGame();
    game.spawnPlayer({ id: "p1", name: "p1", x: 2, y: 2 });
    game.setPlayerInput("p1", "right", true);
    game.tick(); // dt = 1/20 = 0.05, moveSpeed=5, dx=5*0.05=0.25

    const p = game.getPlayer("p1")!;
    expect(p.vx).toBeCloseTo(5.0);
    expect(p.vy).toBe(0);
    expect(p.x).toBeCloseTo(2.25);
    expect(p.y).toBeCloseTo(2);
  });

  test("orientation updates based on input direction", () => {
    const game = createGame();
    game.spawnPlayer({ id: "p1", name: "p1", x: 2, y: 2 });

    game.setPlayerInput("p1", "left", true);
    game.tick();
    expect(game.getPlayer("p1")!.orientation).toBe("left");

    game.setPlayerInput("p1", "left", false);
    game.setPlayerInput("p1", "up", true);
    game.tick();
    expect(game.getPlayer("p1")!.orientation).toBe("up");
  });

  test("stopping input zeroes velocity", () => {
    const game = createGame();
    game.spawnPlayer({ id: "p1", name: "p1", x: 2, y: 2 });
    game.setPlayerInput("p1", "right", true);
    game.tick();
    expect(game.getPlayer("p1")!.vx).toBeCloseTo(5.0);

    game.setPlayerInput("p1", "right", false);
    game.tick();
    const p = game.getPlayer("p1")!;
    expect(p.vx).toBe(0);
    expect(p.vy).toBe(0);
    expect(p.state).toBe("idle");
  });

  test("input cancels pathfinding", () => {
    const game = createGame();
    game.spawnPlayer({ id: "p1", name: "p1", x: 1, y: 1, speed: 0.5 });
    game.setPlayerTarget("p1", 3, 3);
    const p = game.getPlayer("p1")!;
    expect(p.path).toBeDefined();

    game.setPlayerInput("p1", "right", true);
    expect(p.path).toBeUndefined();
    expect(p.targetX).toBeUndefined();
  });

  test("path target continues smoothly from a fractional player position", () => {
    const game = createGame();
    game.spawnPlayer({ id: "p1", name: "p1", x: 2, y: 2 });

    game.setPlayerInput("p1", "right", true);
    game.tick();
    game.setPlayerInput("p1", "right", false);

    const path = game.setPlayerTarget("p1", 3, 1);
    expect(path).toEqual([
      { x: 2, y: 2 },
      { x: 2, y: 1 },
      { x: 3, y: 1 },
    ]);

    const p = game.getPlayer("p1")!;
    expect(p.x).toBe(2.25);
    expect(p.y).toBe(2);
    expect(p.inputX).toBe(0);
    expect(p.inputY).toBe(0);
    expect(p.vx).toBe(0);
    expect(p.vy).toBe(0);

    game.tick();
    expect(game.getPlayer("p1")!.x).toBeCloseTo(2.05);
    expect(game.getPlayer("p1")!.y).toBeCloseTo(1.2);

    game.tick();
    expect(game.getPlayer("p1")!.x).toBeCloseTo(2.75);
    expect(game.getPlayer("p1")!.y).toBeCloseTo(1);

    game.tick();
    expect(game.getPlayer("p1")!.x).toBe(3);
    expect(game.getPlayer("p1")!.y).toBe(1);
  });

  test("collision prevents wall entry", () => {
    const game = createGame();
    // Start near left wall
    game.spawnPlayer({ id: "p1", name: "p1", x: 1, y: 2 });
    game.setPlayerInput("p1", "left", true);

    // Tick many times to push into wall
    for (let i = 0; i < 20; i++) {
      game.tick();
    }
    const p = game.getPlayer("p1")!;
    // Should not penetrate the wall (wall at x=0, walkable starts at x=1)
    expect(p.x).toBeGreaterThanOrEqual(1 - 0.5 + p.radius - 0.01);
    expect(p.y).toBeCloseTo(2);
  });

  test("integer-centered runtime movement does not drift off axis near a wall", () => {
    const game = createGame();
    game.spawnPlayer({ id: "p1", name: "p1", x: 1, y: 2 });
    game.setPlayerInput("p1", "right", true);
    game.tick();

    const p = game.getPlayer("p1")!;
    expect(p.x).toBeCloseTo(1.25);
    expect(p.y).toBeCloseTo(2);
  });

  test("collision prevents overlapping another player and records the blocker", () => {
    const game = createGame();
    game.spawnPlayer({ id: "p1", name: "p1", x: 2, y: 2 });
    game.spawnPlayer({ id: "p2", name: "p2", x: 2, y: 1 });

    game.setPlayerInput("p1", "up", true);
    game.tick();

    const p1 = game.getPlayer("p1")!;
    const p2 = game.getPlayer("p2")!;
    const distance = Math.hypot(p1.x - p2.x, p1.y - p2.y);
    expect(distance).toBeGreaterThanOrEqual(p1.radius + p2.radius - 0.001);

    const collisionEvent = game
      .logger
      .getEvents({ playerId: "p1" })
      .find((event) => event.type === "player_collision");
    expect(collisionEvent?.data?.mode).toBe("input");
    expect(collisionEvent?.data?.blockerId).toBe("p2");
  });

  test("diagonal speed equals cardinal speed", () => {
    const game = createGame();
    game.spawnPlayer({ id: "p1", name: "p1", x: 2, y: 2 });

    // Move diagonally (right + down)
    game.setPlayerInput("p1", "right", true);
    game.setPlayerInput("p1", "down", true);
    game.tick();
    const p = game.getPlayer("p1")!;

    const speed = Math.sqrt(p.vx * p.vx + p.vy * p.vy);
    expect(speed).toBeCloseTo(5.0); // Same as moveSpeed
    expect(p.vx).toBeCloseTo(5 / Math.sqrt(2));
    expect(p.vy).toBeCloseTo(5 / Math.sqrt(2));
    expect(p.x).toBeCloseTo(2 + 0.25 / Math.sqrt(2));
    expect(p.y).toBeCloseTo(2 + 0.25 / Math.sqrt(2));
  });

  test("releasing one held key preserves the other held direction", () => {
    const game = createGame();
    game.spawnPlayer({ id: "p1", name: "p1", x: 2, y: 2 });

    game.setPlayerInput("p1", "up", true);
    game.setPlayerInput("p1", "left", true);
    game.tick();

    const afterDiagonal = game.getPlayer("p1")!;
    expect(afterDiagonal.inputX).toBe(-1);
    expect(afterDiagonal.inputY).toBe(-1);
    expect(afterDiagonal.x).toBeCloseTo(2 - 0.25 / Math.sqrt(2));
    expect(afterDiagonal.y).toBeCloseTo(2 - 0.25 / Math.sqrt(2));

    game.setPlayerInput("p1", "left", false);
    game.tick();

    const afterRelease = game.getPlayer("p1")!;
    expect(afterRelease.inputX).toBe(0);
    expect(afterRelease.inputY).toBe(-1);
    expect(afterRelease.x).toBeCloseTo(2 - 0.25 / Math.sqrt(2));
    expect(afterRelease.y).toBeCloseTo(
      2 - 0.25 / Math.sqrt(2) - 0.25,
    );
  });

  test("opposite held directions cancel on the same axis", () => {
    const game = createGame();
    game.spawnPlayer({ id: "p1", name: "p1", x: 2, y: 2 });

    game.setPlayerInput("p1", "up", true);
    game.setPlayerInput("p1", "down", true);
    game.setPlayerInput("p1", "right", true);
    game.tick();

    const p = game.getPlayer("p1")!;
    expect(p.inputX).toBe(1);
    expect(p.inputY).toBe(0);
    expect(p.vx).toBeCloseTo(5.0);
    expect(p.vy).toBeCloseTo(0);
    expect(p.x).toBeCloseTo(2.25);
    expect(p.y).toBeCloseTo(2);
  });

  test("conversing players ignore input", () => {
    const game = createGame();
    game.spawnPlayer({ id: "p1", name: "p1", x: 2, y: 2 });
    const p = game.getPlayer("p1")!;
    p.state = "conversing";

    game.setPlayerInput("p1", "right", true);
    expect(p.inputX).toBe(0); // setPlayerInput is a no-op for conversing
    game.tick();
    expect(p.x).toBe(2); // No movement
  });

  test("player state is walking during input movement", () => {
    const game = createGame();
    game.spawnPlayer({ id: "p1", name: "p1", x: 2, y: 2 });
    game.setPlayerInput("p1", "down", true);
    game.tick();
    expect(game.getPlayer("p1")!.state).toBe("walking");
  });

  test("multiple ticks accumulate movement", () => {
    const game = createGame();
    game.spawnPlayer({ id: "p1", name: "p1", x: 2, y: 2 });
    game.setPlayerInput("p1", "right", true);

    // 4 ticks at dt=0.05, speed=5 => 4 * 0.25 = 1.0 tile
    for (let i = 0; i < 4; i++) {
      game.tick();
    }
    expect(game.getPlayer("p1")!.x).toBeCloseTo(3);
  });
});
