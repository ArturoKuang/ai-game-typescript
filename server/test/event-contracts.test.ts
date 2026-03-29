import { afterEach, describe, expect, it } from "vitest";
import type { GameEvent } from "../src/engine/types.js";
import { TestGame } from "./helpers/testGame.js";

function collectEvents(tg: TestGame): GameEvent[] {
  const events: GameEvent[] = [];
  tg.game.on("*", (e) => events.push(e));
  return events;
}

describe("Event contracts", () => {
  let tg: TestGame;

  afterEach(() => {
    tg?.destroy();
  });

  it("spawn emits event with player position", () => {
    tg = new TestGame();
    const events = collectEvents(tg);

    tg.spawn("alice", 2, 2);

    const spawnEvt = events.find(
      (e) => e.type === "spawn" && e.playerId === "alice",
    );
    expect(spawnEvt).toBeDefined();
    expect(spawnEvt!.data).toMatchObject({ x: 2, y: 2 });
  });

  it("path arrival emits move_end with final position", () => {
    tg = new TestGame();
    const events = collectEvents(tg);

    tg.spawn("alice", 1, 1);
    tg.move("alice", 3, 1);
    tg.tick(30); // enough ticks to arrive

    const moveEnd = events.find(
      (e) => e.type === "move_end" && e.playerId === "alice",
    );
    expect(moveEnd).toBeDefined();
    expect(moveEnd!.data).toMatchObject({ x: 3, y: 1 });
  });

  it("conversation lifecycle emits correct event sequence", () => {
    tg = new TestGame({ map: "default" });
    const events = collectEvents(tg);

    tg.spawn("h1", 5, 8, false);
    tg.spawn("n1", 6, 8, true);

    tg.game.enqueue({
      type: "start_convo",
      playerId: "h1",
      data: { targetId: "n1" },
    });
    tg.tick(); // start_convo processed, NPC auto-accepts
    tg.tick(); // activate (adjacent)

    const convo = tg.game.conversations.getPlayerConversation("h1");
    expect(convo).toBeDefined();

    // Say something
    tg.game.enqueue({
      type: "say",
      playerId: "h1",
      data: { convoId: convo!.id, content: "Hi" },
    });
    tg.tick();

    // End
    tg.game.enqueue({
      type: "end_convo",
      playerId: "h1",
      data: { convoId: convo!.id },
    });
    tg.tick();

    const convoEvents = events
      .filter((e) => e.type.startsWith("convo_"))
      .map((e) => e.type);

    expect(convoEvents).toContain("convo_started");
    expect(convoEvents).toContain("convo_accepted");
    expect(convoEvents).toContain("convo_active");
    expect(convoEvents).toContain("convo_message");
    expect(convoEvents).toContain("convo_ended");

    // Verify ordering: started before accepted before active
    const startIdx = convoEvents.indexOf("convo_started");
    const acceptIdx = convoEvents.indexOf("convo_accepted");
    const activeIdx = convoEvents.indexOf("convo_active");
    expect(startIdx).toBeLessThan(acceptIdx);
    expect(acceptIdx).toBeLessThan(activeIdx);
  });

  it("human-human invite acceptance emits participant-aware events", () => {
    tg = new TestGame({ map: "default" });
    const events = collectEvents(tg);

    tg.spawn("alice", 5, 8, false);
    tg.spawn("bob", 6, 8, false);

    tg.game.enqueue({
      type: "start_convo",
      playerId: "alice",
      data: { targetId: "bob" },
    });
    tg.tick();

    const convo = tg.game.conversations.getPlayerConversation("alice");
    expect(convo).toBeDefined();

    tg.game.enqueue({
      type: "accept_convo",
      playerId: "bob",
      data: { convoId: convo!.id },
    });
    tg.tick();

    const startedEvt = events.find((event) => event.type === "convo_started");
    const acceptedEvt = events.find((event) => event.type === "convo_accepted");
    const activeEvt = events.find((event) => event.type === "convo_active");

    expect(startedEvt?.data?.conversation).toBeDefined();
    expect(startedEvt?.data?.participantIds).toEqual(["alice", "bob"]);
    expect(acceptedEvt?.data?.participantIds).toEqual(["alice", "bob"]);
    expect(activeEvt?.data?.participantIds).toEqual(["alice", "bob"]);
  });

  it("human-human invite decline emits decline and ended events", () => {
    tg = new TestGame({ map: "default" });
    const events = collectEvents(tg);

    tg.spawn("alice", 5, 8, false);
    tg.spawn("bob", 6, 8, false);

    tg.game.enqueue({
      type: "start_convo",
      playerId: "alice",
      data: { targetId: "bob" },
    });
    tg.tick();

    const convo = tg.game.conversations.getPlayerConversation("alice");
    expect(convo).toBeDefined();

    tg.game.enqueue({
      type: "decline_convo",
      playerId: "bob",
      data: { convoId: convo!.id },
    });
    tg.tick();

    const declinedEvt = events.find((event) => event.type === "convo_declined");
    const endedEvt = events.find((event) => event.type === "convo_ended");

    expect(declinedEvt?.data?.participantIds).toEqual(["alice", "bob"]);
    expect((declinedEvt?.data?.conversation as { endedReason?: string }).endedReason).toBe(
      "declined",
    );
    expect((endedEvt?.data?.conversation as { endedReason?: string }).endedReason).toBe(
      "declined",
    );
  });

  it("conversation event snapshots do not inherit later messages", () => {
    tg = new TestGame({ map: "default" });
    const events = collectEvents(tg);

    tg.spawn("alice", 5, 8, false);
    tg.spawn("bob", 6, 8, false);

    tg.game.enqueue({
      type: "start_convo",
      playerId: "alice",
      data: { targetId: "bob" },
    });
    tg.tick();

    const convo = tg.game.conversations.getPlayerConversation("alice");
    expect(convo).toBeDefined();

    tg.game.enqueue({
      type: "accept_convo",
      playerId: "bob",
      data: { convoId: convo!.id },
    });
    tg.tick();

    tg.game.enqueue({
      type: "say",
      playerId: "alice",
      data: { convoId: convo!.id, content: "snapshot check" },
    });
    tg.tick();

    const startedConversation = events.find(
      (event) => event.type === "convo_started",
    )?.data?.conversation as { messages?: unknown[] } | undefined;
    const acceptedConversation = events.find(
      (event) => event.type === "convo_accepted",
    )?.data?.conversation as { messages?: unknown[] } | undefined;
    const messageEvent = events.find((event) => event.type === "convo_message");

    expect(startedConversation?.messages ?? []).toHaveLength(0);
    expect(acceptedConversation?.messages ?? []).toHaveLength(0);
    expect(messageEvent?.data).toMatchObject({
      message: { content: "snapshot check" },
    });
  });

  it("player_update contains position and orientation", () => {
    tg = new TestGame();
    const events = collectEvents(tg);

    tg.spawn("alice", 1, 1);
    tg.game.setPlayerInput("alice", "right", true);
    tg.tick();

    const updates = events.filter(
      (e) => e.type === "player_update" && e.playerId === "alice",
    );
    expect(updates.length).toBeGreaterThan(0);

    const data = updates[0].data as Record<string, unknown>;
    const player = data.player as Record<string, unknown>;
    expect(player.x).toBeDefined();
    expect(player.y).toBeDefined();
    expect(player.orientation).toBe("right");
  });

  it("input_start and input_stop emit with direction info", () => {
    tg = new TestGame();
    const events = collectEvents(tg);

    tg.spawn("alice", 1, 1);
    tg.game.setPlayerInput("alice", "right", true);
    tg.tick();
    tg.game.setPlayerInput("alice", "right", false);
    tg.tick();

    const inputEvents = events.filter(
      (e) => e.type === "input_state" && e.playerId === "alice",
    );
    expect(inputEvents.length).toBe(2);
    expect((inputEvents[0].data as Record<string, unknown>).active).toBe(true);
    expect((inputEvents[0].data as Record<string, unknown>).direction).toBe(
      "right",
    );
    expect((inputEvents[1].data as Record<string, unknown>).active).toBe(false);
  });
});
