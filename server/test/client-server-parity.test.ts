import { describe, expect, it } from "vitest";
import {
  PLAYER_RADIUS,
  predictLocalPlayerStep,
} from "../../client/src/prediction.js";
import type { MoveDirection } from "../../client/src/types.js";
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

interface InputEdge {
  tick: number;
  direction: MoveDirection;
  active: boolean;
}

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

function expectPlayerClose(
  game: GameLoop,
  playerId: string,
  clientPlayer: { x: number; y: number; orientation: string },
): void {
  const serverPlayer = game.getPlayer(playerId)!;
  expect(serverPlayer.x).toBeCloseTo(clientPlayer.x, 6);
  expect(serverPlayer.y).toBeCloseTo(clientPlayer.y, 6);
  expect(serverPlayer.orientation).toBe(clientPlayer.orientation);
}

function applyInputEdge(
  game: GameLoop,
  heldDirections: Set<MoveDirection>,
  playerId: string,
  edge: InputEdge,
): void {
  game.setPlayerInput(playerId, edge.direction, edge.active);
  if (edge.active) {
    heldDirections.add(edge.direction);
  } else {
    heldDirections.delete(edge.direction);
  }
}

describe("client/server movement parity", () => {
  it("matches simultaneous held-key transitions across ticks", () => {
    const game = createRuntimeGame();
    game.spawnPlayer({ id: "p1", name: "p1", x: 2, y: 2 });

    const heldDirections = new Set<MoveDirection>();
    const clientPlayer = {
      id: "p1",
      x: 2,
      y: 2,
      orientation: "down" as const,
      radius: PLAYER_RADIUS,
      inputSpeed: 5,
    };
    const timeline: InputEdge[] = [
      { tick: 0, direction: "up", active: true },
      { tick: 0, direction: "left", active: true },
      { tick: 1, direction: "left", active: false },
      { tick: 2, direction: "right", active: true },
      { tick: 3, direction: "up", active: false },
      { tick: 3, direction: "right", active: false },
    ];

    for (let tick = 0; tick < 4; tick++) {
      for (const edge of timeline.filter((entry) => entry.tick === tick)) {
        applyInputEdge(game, heldDirections, "p1", edge);
      }

      const predicted = predictLocalPlayerStep({
        player: clientPlayer,
        otherPlayers: [],
        heldDirections,
        mapTiles: MINI_MAP.tiles,
        dt: 1 / 20,
      });
      clientPlayer.x = predicted.x;
      clientPlayer.y = predicted.y;
      clientPlayer.orientation = predicted.orientation;

      game.tick();
      expectPlayerClose(game, "p1", clientPlayer);
    }
  });

  it("matches player-collision resolution between client prediction and server", () => {
    const game = createRuntimeGame();
    game.spawnPlayer({ id: "p1", name: "p1", x: 2, y: 2 });
    game.spawnPlayer({ id: "p2", name: "p2", x: 2, y: 1 });

    const heldDirections = new Set<MoveDirection>(["up"]);
    game.setPlayerInput("p1", "up", true);

    const clientPlayer = {
      id: "p1",
      x: 2,
      y: 2,
      orientation: "down" as const,
      radius: PLAYER_RADIUS,
      inputSpeed: 5,
    };

    const predicted = predictLocalPlayerStep({
      player: clientPlayer,
      otherPlayers: [
        { id: "p2", x: 2, y: 1, radius: PLAYER_RADIUS },
      ],
      heldDirections,
      mapTiles: MINI_MAP.tiles,
      dt: 1 / 20,
    });
    clientPlayer.x = predicted.x;
    clientPlayer.y = predicted.y;
    clientPlayer.orientation = predicted.orientation;

    game.tick();
    expectPlayerClose(game, "p1", clientPlayer);
  });
});
