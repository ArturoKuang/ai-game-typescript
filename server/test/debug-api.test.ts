import { afterEach, describe, expect, it } from "vitest";
import { renderAsciiMap } from "../src/debug/asciiMap.js";
import { SCENARIOS } from "../src/debug/scenarios.js";
import { GameLogger } from "../src/engine/logger.js";
import { TestGame } from "./helpers/testGame.js";

describe("ASCII Map Renderer", () => {
  let tg: TestGame;

  afterEach(() => {
    tg?.destroy();
  });

  it("renders empty map with walls and floor", () => {
    tg = new TestGame();
    const { ascii } = renderAsciiMap(tg.game);
    expect(ascii).toContain("┌");
    expect(ascii).toContain("┘");
    expect(ascii).toContain("#"); // walls
    expect(ascii).toContain("."); // floor
  });

  it("renders players on the map", () => {
    tg = new TestGame();
    tg.spawn("alice", 2, 2);
    const { ascii, legend } = renderAsciiMap(tg.game);
    expect(ascii).toContain("A");
    expect(legend.A).toContain("alice");
  });

  it("renders the default map legend", () => {
    tg = new TestGame({ map: "default" });
    const { ascii } = renderAsciiMap(tg.game);
    expect(ascii).toContain("Legend:");
  });

  it("shows player state in legend", () => {
    tg = new TestGame();
    tg.spawn("alice", 1, 1);
    tg.move("alice", 3, 1);
    const { legend } = renderAsciiMap(tg.game);
    expect(legend.A).toContain("walking");
  });
});

describe("Scenarios", () => {
  let tg: TestGame;

  afterEach(() => {
    tg?.destroy();
  });

  it("empty scenario spawns no players", () => {
    tg = new TestGame({ map: "default" });
    SCENARIOS.empty.setup(tg.game);
    expect(tg.game.getPlayers()).toHaveLength(0);
  });

  it("two_founders_meet spawns 2 NPCs", () => {
    tg = new TestGame({ map: "default" });
    SCENARIOS.two_founders_meet.setup(tg.game);
    const players = tg.game.getPlayers();
    expect(players).toHaveLength(2);
    expect(players.every((p) => p.isNpc)).toBe(true);
  });

  it("founding_band spawns all 8 founding humans", () => {
    tg = new TestGame({ map: "default" });
    SCENARIOS.founding_band.setup(tg.game);
    expect(tg.game.getPlayers()).toHaveLength(8);
  });
});

describe("GameLogger", () => {
  it("logs and retrieves events", () => {
    const logger = new GameLogger();
    logger.log({ tick: 1, type: "spawn", playerId: "alice" });
    logger.log({ tick: 2, type: "move_start", playerId: "alice" });
    logger.log({ tick: 3, type: "spawn", playerId: "bob" });

    expect(logger.size).toBe(3);
    expect(logger.getEvents()).toHaveLength(3);
  });

  it("filters by since", () => {
    const logger = new GameLogger();
    logger.log({ tick: 1, type: "a" });
    logger.log({ tick: 5, type: "b" });
    logger.log({ tick: 10, type: "c" });

    const events = logger.getEvents({ since: 5 });
    expect(events).toHaveLength(2);
    expect(events[0].type).toBe("b");
  });

  it("filters by playerId", () => {
    const logger = new GameLogger();
    logger.log({ tick: 1, type: "a", playerId: "alice" });
    logger.log({ tick: 2, type: "b", playerId: "bob" });
    logger.log({ tick: 3, type: "c", playerId: "alice" });

    const events = logger.getEvents({ playerId: "alice" });
    expect(events).toHaveLength(2);
  });

  it("filters by event type", () => {
    const logger = new GameLogger();
    logger.log({ tick: 1, type: "input_state", playerId: "alice" });
    logger.log({ tick: 2, type: "input_move", playerId: "alice" });
    logger.log({ tick: 3, type: "player_collision", playerId: "alice" });

    const events = logger.getEvents({
      types: ["input_move", "player_collision"],
    });
    expect(events.map((event) => event.type)).toEqual([
      "input_move",
      "player_collision",
    ]);
  });

  it("limits results", () => {
    const logger = new GameLogger();
    for (let i = 0; i < 100; i++) {
      logger.log({ tick: i, type: "test" });
    }
    const events = logger.getEvents({ limit: 10 });
    expect(events).toHaveLength(10);
    expect(events[0].tick).toBe(90); // last 10
  });

  it("enforces max buffer size", () => {
    const logger = new GameLogger(5);
    for (let i = 0; i < 10; i++) {
      logger.log({ tick: i, type: "test" });
    }
    expect(logger.size).toBe(5);
    expect(logger.getEvents()[0].tick).toBe(5);
  });

  it("clears all events", () => {
    const logger = new GameLogger();
    logger.log({ tick: 1, type: "test" });
    logger.clear();
    expect(logger.size).toBe(0);
  });
});
