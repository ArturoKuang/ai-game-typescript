import { describe, expect, it } from "vitest";
import { GameLogger } from "../src/engine/logger.js";
import type { GameEvent } from "../src/engine/types.js";

function makeEvent(
  tick: number,
  type: string,
  playerId?: string,
): GameEvent {
  return { tick, type: type as GameEvent["type"], playerId };
}

describe("Logger contracts", () => {
  it("combined filters: playerId AND type AND since", () => {
    const logger = new GameLogger(100);

    logger.log(makeEvent(1, "spawn", "p1"));
    logger.log(makeEvent(2, "move_end", "p1"));
    logger.log(makeEvent(3, "spawn", "p2"));
    logger.log(makeEvent(5, "spawn", "p1"));
    logger.log(makeEvent(6, "move_end", "p1"));
    logger.log(makeEvent(7, "spawn", "p1"));

    const result = logger.getEvents({
      playerId: "p1",
      types: ["spawn"],
      since: 5,
    });

    expect(result).toHaveLength(2);
    expect(result.every((e) => e.playerId === "p1")).toBe(true);
    expect(result.every((e) => e.type === "spawn")).toBe(true);
    expect(result.every((e) => e.tick >= 5)).toBe(true);
  });

  it("buffer at capacity evicts oldest first", () => {
    const logger = new GameLogger(5);

    for (let i = 1; i <= 7; i++) {
      logger.log(makeEvent(i, "spawn"));
    }

    const events = logger.getEvents();
    expect(events).toHaveLength(5);
    expect(events[0].tick).toBe(3); // oldest surviving
    expect(events[4].tick).toBe(7); // newest
  });

  it("limit returns most recent N events", () => {
    const logger = new GameLogger(100);

    for (let i = 1; i <= 10; i++) {
      logger.log(makeEvent(i, "spawn"));
    }

    const result = logger.getEvents({ limit: 3 });
    expect(result).toHaveLength(3);
    expect(result[0].tick).toBe(8);
    expect(result[2].tick).toBe(10);
  });

  it("empty buffer returns empty array for all filter combos", () => {
    const logger = new GameLogger(100);

    expect(logger.getEvents()).toHaveLength(0);
    expect(logger.getEvents({ since: 0, limit: 10 })).toHaveLength(0);
    expect(
      logger.getEvents({ playerId: "p1", types: ["spawn"], since: 0 }),
    ).toHaveLength(0);
  });
});
