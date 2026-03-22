import { afterEach, describe, expect, it } from "vitest";
import type { GameEvent } from "../src/engine/types.js";
import { TestGame } from "./helpers/testGame.js";

describe("Command Queue", () => {
  let tg: TestGame;

  afterEach(() => {
    tg?.destroy();
  });

  it("does not process commands until tick", () => {
    tg = new TestGame();
    tg.game.enqueue({
      type: "spawn",
      playerId: "alice",
      data: { name: "Alice", x: 1, y: 1 },
    });
    expect(tg.game.getPlayer("alice")).toBeUndefined();
    tg.tick();
    expect(tg.game.getPlayer("alice")).toBeDefined();
    expect(tg.game.getPlayer("alice")!.x).toBe(1);
    expect(tg.game.getPlayer("alice")!.y).toBe(1);
  });

  it("processes move_direction commands during tick", () => {
    tg = new TestGame();
    tg.spawn("alice", 2, 2);
    tg.game.enqueue({
      type: "move_direction",
      playerId: "alice",
      data: { direction: "right" },
    });
    expect(tg.getPlayer("alice").x).toBe(2);
    tg.tick();
    expect(tg.getPlayer("alice").x).toBe(3);
  });

  it("processes move_to commands during tick", () => {
    tg = new TestGame();
    tg.spawn("alice", 1, 1);
    tg.game.enqueue({
      type: "move_to",
      playerId: "alice",
      data: { x: 3, y: 1 },
    });
    expect(tg.getPlayer("alice").state).toBe("idle");
    tg.tick();
    expect(tg.getPlayer("alice").state).toBe("walking");
  });

  it("processes multiple commands in order within a single tick", () => {
    tg = new TestGame();
    tg.game.enqueue({
      type: "spawn",
      playerId: "alice",
      data: { name: "Alice", x: 1, y: 1 },
    });
    tg.game.enqueue({
      type: "move_direction",
      playerId: "alice",
      data: { direction: "right" },
    });
    tg.tick();
    const alice = tg.getPlayer("alice");
    expect(alice.x).toBe(2);
  });

  it("emits events for queued commands", () => {
    tg = new TestGame();
    const events: string[] = [];
    tg.game.on("*", (e: GameEvent) => events.push(e.type));

    tg.game.enqueue({
      type: "spawn",
      playerId: "alice",
      data: { name: "Alice", x: 1, y: 1 },
    });
    tg.tick();
    expect(events).toContain("spawn");
    expect(events).toContain("tick_complete");
  });

  it("emits move_direction event for WASD commands via queue", () => {
    tg = new TestGame();
    tg.spawn("alice", 2, 2);
    const events: GameEvent[] = [];
    tg.game.on("*", (e: GameEvent) => events.push(e));

    tg.game.enqueue({
      type: "move_direction",
      playerId: "alice",
      data: { direction: "down" },
    });
    tg.tick();

    const moveEvt = events.find((e) => e.type === "move_direction");
    expect(moveEvt).toBeDefined();
    expect(moveEvt!.playerId).toBe("alice");
    expect(moveEvt!.data?.x).toBe(2);
    expect(moveEvt!.data?.y).toBe(3);
  });

  it("clears queue after tick", () => {
    tg = new TestGame();
    tg.game.enqueue({
      type: "spawn",
      playerId: "alice",
      data: { name: "Alice", x: 1, y: 1 },
    });
    tg.tick();

    // Second tick should not re-process the spawn
    const events: string[] = [];
    tg.game.on("*", (e: GameEvent) => events.push(e.type));
    tg.tick();
    expect(events).not.toContain("spawn");
  });

  it("clears queue on reset", () => {
    tg = new TestGame();
    tg.game.enqueue({
      type: "spawn",
      playerId: "alice",
      data: { name: "Alice", x: 1, y: 1 },
    });
    tg.destroy();

    // Re-create and tick — alice should not exist
    tg = new TestGame();
    tg.tick();
    expect(tg.game.getPlayer("alice")).toBeUndefined();
  });

  it("silently skips duplicate spawn commands", () => {
    tg = new TestGame();
    tg.spawn("alice", 1, 1);
    tg.game.enqueue({
      type: "spawn",
      playerId: "alice",
      data: { name: "Alice", x: 2, y: 2 },
    });
    // Should not throw
    tg.tick();
    // Alice should remain at original position
    expect(tg.getPlayer("alice").x).toBe(1);
  });

  it("processes start_convo command via queue", () => {
    tg = new TestGame();
    tg.spawn("alice", 1, 1, true);
    tg.spawn("bob", 2, 1, true);

    const events: GameEvent[] = [];
    tg.game.on("*", (e: GameEvent) => events.push(e));

    tg.game.enqueue({
      type: "start_convo",
      playerId: "alice",
      data: { targetId: "bob" },
    });
    tg.tick();

    const convoEvt = events.find((e) => e.type === "convo_started");
    expect(convoEvt).toBeDefined();
    expect(convoEvt!.data?.targetId).toBe("bob");
  });

  it("processes remove command via queue", () => {
    tg = new TestGame();
    tg.spawn("alice", 1, 1);
    tg.game.enqueue({ type: "remove", playerId: "alice" });
    // Alice still exists before tick
    expect(tg.game.getPlayer("alice")).toBeDefined();
    tg.tick();
    expect(tg.game.getPlayer("alice")).toBeUndefined();
  });
});
