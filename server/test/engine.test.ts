import { afterEach, describe, expect, it } from "vitest";
import { SeededRNG } from "../src/engine/rng.js";
import { TestGame } from "./helpers/testGame.js";

describe("GameLoop", () => {
  let tg: TestGame;

  afterEach(() => {
    tg?.destroy();
  });

  it("initializes with tick 0", () => {
    tg = new TestGame();
    expect(tg.game.currentTick).toBe(0);
  });

  it("advances tick on tick()", () => {
    tg = new TestGame();
    tg.tick();
    expect(tg.game.currentTick).toBe(1);
    tg.tick(5);
    expect(tg.game.currentTick).toBe(6);
  });

  it("spawns player at correct position", () => {
    tg = new TestGame();
    const p = tg.spawn("alice", 2, 2);
    expect(p.x).toBe(2);
    expect(p.y).toBe(2);
    expect(p.state).toBe("idle");
    expect(p.orientation).toBe("down");
  });

  it("rejects duplicate player ids", () => {
    tg = new TestGame();
    tg.spawn("alice", 1, 1);
    expect(() => tg.spawn("alice", 2, 2)).toThrow("already exists");
  });

  it("removes players", () => {
    tg = new TestGame();
    tg.spawn("alice", 1, 1);
    tg.game.removePlayer("alice");
    expect(tg.game.getPlayer("alice")).toBeUndefined();
    expect(tg.game.getPlayers()).toHaveLength(0);
  });

  it("moves player one step per tick along path", () => {
    tg = new TestGame();
    tg.spawn("alice", 1, 1);
    const path = tg.move("alice", 3, 1);
    expect(path).not.toBeNull();
    expect(path?.length).toBe(3); // (1,1) -> (2,1) -> (3,1)

    const p = tg.getPlayer("alice");
    expect(p.state).toBe("walking");

    tg.tick();
    expect(tg.getPlayer("alice").x).toBe(2);
    expect(tg.getPlayer("alice").y).toBe(1);

    tg.tick();
    expect(tg.getPlayer("alice").x).toBe(3);
    expect(tg.getPlayer("alice").y).toBe(1);
    expect(tg.getPlayer("alice").state).toBe("idle");
  });

  it("blocks path movement when another player occupies the next waypoint", () => {
    tg = new TestGame();
    tg.spawn("alice", 1, 1);
    tg.spawn("bob", 2, 1);

    tg.move("alice", 3, 1);
    tg.tick();

    expect(tg.getPlayer("alice").x).toBe(1);
    expect(tg.getPlayer("alice").y).toBe(1);
    expect(tg.getPlayer("alice").state).toBe("walking");

    const collisionEvent = tg
      .game
      .logger
      .getEvents({ playerId: "alice" })
      .find((event) => event.type === "player_collision");
    expect(collisionEvent?.data?.mode).toBe("path");
    expect(collisionEvent?.data?.blockerId).toBe("bob");
  });

  it("player reaches destination and becomes idle", () => {
    tg = new TestGame();
    tg.spawn("alice", 1, 1);
    tg.move("alice", 2, 1);
    tg.tick();
    const p = tg.getPlayer("alice");
    expect(p.x).toBe(2);
    expect(p.y).toBe(1);
    expect(p.state).toBe("idle");
    expect(p.path).toBeUndefined();
    expect(p.targetX).toBeUndefined();
  });

  it("updates orientation based on movement direction", () => {
    tg = new TestGame();
    tg.spawn("alice", 1, 1);

    tg.move("alice", 3, 1); // moving right
    tg.tick();
    expect(tg.getPlayer("alice").orientation).toBe("right");

    tg.game.reset();
    tg.game.loadWorld({
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
    });
    tg.spawn("bob", 2, 1);
    tg.move("bob", 2, 3); // moving down
    tg.tick();
    expect(tg.getPlayer("bob").orientation).toBe("down");
  });

  it("returns null for invalid move target", () => {
    tg = new TestGame();
    tg.spawn("alice", 1, 1);
    const path = tg.move("alice", 0, 0); // wall
    expect(path).toBeNull();
  });

  it("discrete movement uses the current rounded tile for fractional positions", () => {
    tg = new TestGame();
    tg.game.spawnPlayer({ id: "alice", name: "alice", x: 2.25, y: 2 });

    expect(tg.game.movePlayerDirection("alice", "left")).toBe(true);
    expect(tg.getPlayer("alice").x).toBe(1);
    expect(tg.getPlayer("alice").y).toBe(2);
  });

  it("stepped mode does not auto-advance", () => {
    tg = new TestGame();
    expect(tg.game.mode).toBe("stepped");
    expect(tg.game.currentTick).toBe(0);
    // Without calling tick(), tick stays at 0
  });

  it("emits events on spawn and move", () => {
    tg = new TestGame();
    const events: string[] = [];
    tg.game.on("*", (e) => events.push(e.type));

    tg.spawn("alice", 1, 1);
    expect(events).toContain("spawn");

    tg.move("alice", 3, 1);
    expect(events).toContain("move_start");

    tg.tick(2);
    expect(events).toContain("move_end");
  });

  it("loads default map", () => {
    tg = new TestGame({ map: "default" });
    expect(tg.game.world.width).toBe(20);
    expect(tg.game.world.height).toBe(20);
  });

  it("reports player count", () => {
    tg = new TestGame();
    expect(tg.game.playerCount).toBe(0);
    tg.spawn("a", 1, 1);
    tg.spawn("b", 2, 2);
    expect(tg.game.playerCount).toBe(2);
  });
});

describe("SeededRNG", () => {
  it("produces deterministic results", () => {
    const rng1 = new SeededRNG(12345);
    const rng2 = new SeededRNG(12345);
    for (let i = 0; i < 100; i++) {
      expect(rng1.next()).toBe(rng2.next());
    }
  });

  it("different seeds produce different sequences", () => {
    const rng1 = new SeededRNG(111);
    const rng2 = new SeededRNG(222);
    const same = Array.from({ length: 10 }, () => rng1.next() === rng2.next());
    expect(same.every(Boolean)).toBe(false);
  });

  it("next() returns values in [0, 1)", () => {
    const rng = new SeededRNG(42);
    for (let i = 0; i < 1000; i++) {
      const v = rng.next();
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThan(1);
    }
  });

  it("nextInt() returns values in [0, max)", () => {
    const rng = new SeededRNG(42);
    for (let i = 0; i < 1000; i++) {
      const v = rng.nextInt(10);
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThan(10);
      expect(Number.isInteger(v)).toBe(true);
    }
  });

  it("shuffle() returns same elements", () => {
    const rng = new SeededRNG(42);
    const arr = [1, 2, 3, 4, 5];
    const shuffled = rng.shuffle([...arr]);
    expect(shuffled.sort()).toEqual(arr);
  });

  it("pick() returns element from array", () => {
    const rng = new SeededRNG(42);
    const arr = ["a", "b", "c"];
    for (let i = 0; i < 100; i++) {
      expect(arr).toContain(rng.pick(arr));
    }
  });
});
