import { afterEach, describe, expect, it } from "vitest";
import { GameLogger } from "../src/engine/logger.js";
import type { GameEvent } from "../src/engine/types.js";
import { TestGame } from "./helpers/testGame.js";

describe("Performance regression gates", () => {
  let tg: TestGame;

  afterEach(() => {
    tg?.destroy();
  });

  it("1000 ticks with 20 active conversations under 500ms", () => {
    tg = new TestGame({ map: "default" });

    // Spawn 40 NPCs in pairs, start conversations
    for (let i = 0; i < 40; i++) {
      const x = 1 + (i % 16);
      const y = 6 + Math.floor(i / 16);
      tg.spawn(`c${i}`, x, y, true);
    }
    for (let i = 0; i < 20; i++) {
      tg.game.conversations.startConversation(
        `c${i * 2}`,
        `c${i * 2 + 1}`,
        0,
      );
    }

    const start = performance.now();
    tg.tick(1000);
    const elapsed = performance.now() - start;

    expect(elapsed).toBeLessThan(500);
  });

  it("10000 event logs + filtered query under 50ms", () => {
    const logger = new GameLogger(10000);

    for (let i = 0; i < 10000; i++) {
      logger.log({
        tick: i,
        type: i % 3 === 0 ? "spawn" : "player_update",
        playerId: `p${i % 10}`,
      });
    }

    const start = performance.now();
    const results = logger.getEvents({
      playerId: "p5",
      types: ["spawn"],
      since: 5000,
      limit: 50,
    });
    const elapsed = performance.now() - start;

    expect(elapsed).toBeLessThan(50);
    expect(results.length).toBeLessThanOrEqual(50);
    expect(results.every((e) => e.playerId === "p5")).toBe(true);
  });

  it("spawn and remove 100 players in 100 ticks under 200ms", () => {
    tg = new TestGame({ map: "default" });

    const start = performance.now();
    for (let i = 0; i < 100; i++) {
      const x = 1 + (i % 16);
      const y = 2 + Math.floor(i / 16);
      tg.spawn(`rapid${i}`, x, y);
    }
    tg.tick(50);
    for (let i = 0; i < 100; i++) {
      tg.game.removePlayer(`rapid${i}`);
    }
    tg.tick(50);
    const elapsed = performance.now() - start;

    expect(elapsed).toBeLessThan(200);
    expect(tg.game.playerCount).toBe(0);
  });

  it("50 concurrent path calculations on 20x20 under 500ms", () => {
    tg = new TestGame({ map: "default" });

    for (let i = 0; i < 50; i++) {
      const x = 2 + (i % 16);
      const y = 2 + Math.floor(i / 16);
      tg.spawn(`pf${i}`, x, y);
    }

    const start = performance.now();
    for (let i = 0; i < 50; i++) {
      tg.move(`pf${i}`, 17, 17);
    }
    const elapsed = performance.now() - start;

    expect(elapsed).toBeLessThan(500);
  });
});
