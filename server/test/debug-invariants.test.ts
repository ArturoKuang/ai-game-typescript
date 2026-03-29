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

function createInvariantGame(): GameLoop {
  const game = new GameLoop({
    seed: 42,
    mode: "stepped",
    tickRate: 20,
    validateInvariants: true,
  });
  game.loadWorld(MINI_MAP);
  return game;
}

describe("debug invariants", () => {
  it("throws when a player overlaps a blocked tile", () => {
    const game = createInvariantGame();
    game.spawnPlayer({ id: "p1", name: "p1", x: 0, y: 0 });

    expect(() => game.tick()).toThrow(/overlaps blocked tile/);
  });

  it("throws when players overlap each other", () => {
    const game = createInvariantGame();
    game.spawnPlayer({ id: "p1", name: "p1", x: 2, y: 2 });
    game.spawnPlayer({ id: "p2", name: "p2", x: 2, y: 2 });

    expect(() => game.tick()).toThrow(/overlap/);
  });

  it("throws when velocity remains without active input", () => {
    const game = createInvariantGame();
    game.spawnPlayer({ id: "p1", name: "p1", x: 2, y: 2 });

    const player = game.getPlayer("p1")!;
    player.vx = 1;

    expect(() => game.tick()).toThrow(/velocity without active input/);
  });

  it("throws when a path contains a diagonal step", () => {
    const game = createInvariantGame();
    game.spawnPlayer({ id: "p1", name: "p1", x: 2, y: 2 });

    const player = game.getPlayer("p1")!;
    player.path = [
      { x: 2, y: 2 },
      { x: 3, y: 3 },
    ];
    player.pathIndex = 0;
    player.targetX = 3;
    player.targetY = 3;
    player.state = "walking";

    expect(() => game.tick()).toThrow(/non-cardinal path step/);
  });
});
