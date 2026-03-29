import { describe, expect, it } from "vitest";
import { GameLoop } from "../src/engine/gameLoop.js";
import type { MapData } from "../src/engine/types.js";

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

function createRuntimeGame(): GameLoop {
  const game = new GameLoop({
    seed: 42,
    mode: "stepped",
    tickRate: 20,
    validateInvariants: true,
  });
  game.loadWorld(MINI_MAP);
  return game;
}

describe("runtime contracts", () => {
  it("treats spawn coordinates as integer-centered runtime positions", () => {
    const game = createRuntimeGame();
    game.spawnPlayer({ id: "p1", name: "p1", x: 2, y: 2 });

    const player = game.getPlayer("p1")!;
    expect(player.x).toBe(2);
    expect(player.y).toBe(2);
  });

  it("treats simultaneous key holds as state, not as the last input edge", () => {
    const game = createRuntimeGame();
    game.spawnPlayer({ id: "p1", name: "p1", x: 2, y: 2 });

    game.setPlayerInput("p1", "up", true);
    game.setPlayerInput("p1", "left", true);
    game.tick();
    game.setPlayerInput("p1", "left", false);
    game.tick();

    const player = game.getPlayer("p1")!;
    expect(player.inputX).toBe(0);
    expect(player.inputY).toBe(-1);
    expect(player.x).toBeCloseTo(2 - 0.25 / Math.sqrt(2));
    expect(player.y).toBeCloseTo(2 - 0.25 / Math.sqrt(2) - 0.25);
  });

  it("emits move_cancelled when manual input interrupts pathfinding", () => {
    const game = createRuntimeGame();
    game.spawnPlayer({ id: "p1", name: "p1", x: 1, y: 1, speed: 0.5 });

    game.setPlayerTarget("p1", 3, 3);
    game.setPlayerInput("p1", "right", true);

    const cancelledEvent = game
      .logger
      .getEvents({ playerId: "p1", types: ["move_cancelled"] })
      .at(-1);

    expect(cancelledEvent?.data).toMatchObject({
      reason: "input",
      targetX: 3,
      targetY: 3,
      pathIndex: 0,
    });
  });
});
