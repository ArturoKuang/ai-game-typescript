import { afterEach, describe, expect, it } from "vitest";
import { findPath } from "../src/engine/pathfinding.js";
import { World } from "../src/engine/world.js";
import { generateOpenMap } from "./helpers/mapGenerator.js";
import { TestGame } from "./helpers/testGame.js";

const map100 = generateOpenMap(100, 100);

describe("Performance: Pathfinding", () => {
  let tg: TestGame;

  afterEach(() => {
    tg?.destroy();
  });

  it("1000 short paths on 20x20 map under 500ms", () => {
    tg = new TestGame({ map: "default" });

    const start = performance.now();
    for (let i = 0; i < 1000; i++) {
      findPath(tg.game.world, { x: 2, y: 8 }, { x: 6, y: 8 });
    }
    const elapsed = performance.now() - start;

    expect(elapsed).toBeLessThan(500);
  });

  it("1000 cross-map paths on 20x20 map under 1000ms", () => {
    tg = new TestGame({ map: "default" });

    const start = performance.now();
    for (let i = 0; i < 1000; i++) {
      findPath(tg.game.world, { x: 2, y: 8 }, { x: 17, y: 8 });
    }
    const elapsed = performance.now() - start;

    expect(elapsed).toBeLessThan(1000);
  });

  it("100 cross-map paths on 100x100 map under 2000ms", () => {
    tg = new TestGame({ map: map100 });

    const start = performance.now();
    for (let i = 0; i < 100; i++) {
      findPath(tg.game.world, { x: 1, y: 1 }, { x: 98, y: 98 });
    }
    const elapsed = performance.now() - start;

    expect(elapsed).toBeLessThan(2000);
  });

  it("100 unreachable paths on 100x100 map under 3000ms", () => {
    tg = new TestGame({ map: map100 });

    const start = performance.now();
    for (let i = 0; i < 100; i++) {
      // (0,0) is a wall — unreachable target forces full search
      findPath(tg.game.world, { x: 1, y: 1 }, { x: 0, y: 0 });
    }
    const elapsed = performance.now() - start;

    expect(elapsed).toBeLessThan(3000);
  });
});

describe("Performance: Tick throughput", () => {
  let tg: TestGame;

  afterEach(() => {
    tg?.destroy();
  });

  it("1000 ticks with 10 idle players under 100ms", () => {
    tg = new TestGame({ map: "default" });
    for (let i = 0; i < 10; i++) {
      tg.spawn(`idle${i}`, 2 + (i % 16), 6 + Math.floor(i / 16));
    }

    const start = performance.now();
    tg.tick(1000);
    const elapsed = performance.now() - start;

    expect(elapsed).toBeLessThan(100);
  });

  it("1000 ticks with 50 walking players on 20x20 map under 500ms", () => {
    tg = new TestGame({ map: "default" });
    for (let i = 0; i < 50; i++) {
      const x = 2 + (i % 16);
      const y = 6 + Math.floor(i / 16);
      tg.spawn(`walk${i}`, x, y);
    }
    // Set all players walking to far corner — they'll path and move
    for (let i = 0; i < 50; i++) {
      tg.move(`walk${i}`, 17, 17);
    }

    const start = performance.now();
    tg.tick(1000);
    const elapsed = performance.now() - start;

    expect(elapsed).toBeLessThan(500);
  });

  it("1000 ticks with 50 walking players on 100x100 map under 500ms", () => {
    tg = new TestGame({ map: map100 });
    for (let i = 0; i < 50; i++) {
      const x = 2 + (i % 20);
      const y = 2 + Math.floor(i / 20);
      tg.spawn(`walk${i}`, x, y);
    }
    for (let i = 0; i < 50; i++) {
      tg.move(`walk${i}`, 90, 90);
    }

    const start = performance.now();
    tg.tick(1000);
    const elapsed = performance.now() - start;

    expect(elapsed).toBeLessThan(500);
  });

  it("100 ticks with 200 walking players on 100x100 map under 2000ms", () => {
    tg = new TestGame({ map: map100 });
    for (let i = 0; i < 200; i++) {
      const x = 1 + (i % 50);
      const y = 1 + Math.floor(i / 50);
      tg.spawn(`stress${i}`, x, y);
    }
    for (let i = 0; i < 200; i++) {
      tg.move(`stress${i}`, 98, 98);
    }

    const start = performance.now();
    tg.tick(100);
    const elapsed = performance.now() - start;

    expect(elapsed).toBeLessThan(2000);
  });
});

describe("Performance: Conversation processing", () => {
  let tg: TestGame;

  afterEach(() => {
    tg?.destroy();
  });

  it("1000 ticks with 20 conversations under 1000ms", () => {
    tg = new TestGame({ map: "default" });

    // Spawn 40 players in pairs, start conversations
    for (let i = 0; i < 40; i++) {
      const x = 1 + (i % 16);
      const y = 6 + Math.floor(i / 16);
      tg.spawn(`conv${i}`, x, y, true); // NPCs auto-accept
    }
    for (let i = 0; i < 20; i++) {
      tg.game.conversations.startConversation(
        `conv${i * 2}`,
        `conv${i * 2 + 1}`,
        0,
      );
    }

    const start = performance.now();
    tg.tick(1000);
    const elapsed = performance.now() - start;

    expect(elapsed).toBeLessThan(1000);
  });
});

describe("Performance: World operations", () => {
  it("100k isWalkable lookups on 100x100 map under 200ms", () => {
    const world = new World(map100);

    const start = performance.now();
    for (let i = 0; i < 100_000; i++) {
      world.isWalkable(1 + (i % 98), 1 + ((i >> 7) % 98));
    }
    const elapsed = performance.now() - start;

    expect(elapsed).toBeLessThan(200);
  });

  it("100k getNeighbors calls on 100x100 map under 500ms", () => {
    const world = new World(map100);

    const start = performance.now();
    for (let i = 0; i < 100_000; i++) {
      world.getNeighbors({ x: 1 + (i % 98), y: 1 + ((i >> 7) % 98) });
    }
    const elapsed = performance.now() - start;

    expect(elapsed).toBeLessThan(500);
  });
});
