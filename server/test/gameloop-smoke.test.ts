import { afterEach, describe, expect, it } from "vitest";
import { TestGame } from "./helpers/testGame.js";

describe("GameLoop smoke tests", () => {
  let tg: TestGame;

  afterEach(() => {
    tg?.destroy();
  });

  it("full lifecycle: spawn, path, converse, end, move again", () => {
    tg = new TestGame({ map: "default" });
    const human = tg.spawn("human_1", 5, 8, false);
    const npc = tg.spawn("npc_1", 6, 8, true);

    // Path human toward NPC (already adjacent)
    tg.game.enqueue({
      type: "start_convo",
      playerId: "human_1",
      data: { targetId: "npc_1" },
    });
    tg.tick(); // process start_convo, NPC auto-accepts, walking state

    // Tick until conversation activates (they're 1 tile apart, within CONVERSATION_DISTANCE=2)
    tg.tick();
    const convo = tg.game.conversations.getPlayerConversation("human_1");
    expect(convo).toBeDefined();
    expect(convo!.state).toBe("active");

    // Add a message
    tg.game.conversations.addMessage(
      convo!.id,
      "human_1",
      "Hello there!",
      tg.game.currentTick,
    );
    expect(convo!.messages).toHaveLength(1);

    // Player state should be conversing
    expect(tg.getPlayer("human_1").state).toBe("conversing");

    // End conversation
    tg.game.enqueue({
      type: "end_convo",
      playerId: "human_1",
      data: { convoId: convo!.id },
    });
    tg.tick();

    // Both players should return to idle
    expect(tg.getPlayer("human_1").state).toBe("idle");
    expect(tg.getPlayer("npc_1").state).toBe("idle");

    // Human should be able to move again after conversation
    // Move away from NPC (who is at 6,8 and would block the path)
    const path = tg.move("human_1", 5, 14);
    expect(path).not.toBeNull();
    tg.tick(20);
    // Player should have moved toward target
    expect(tg.getPlayer("human_1").y).toBeGreaterThan(8);
  });

  it("20 ticks with mixed input and path movement", () => {
    tg = new TestGame({ map: "default" });
    tg.spawn("pathA", 2, 8);
    tg.spawn("inputB", 5, 8);
    tg.spawn("idleC", 10, 8);

    // A: path to (5, 8) -- but inputB is there, pick different target
    tg.move("pathA", 4, 8);

    // B: held input right for 5 ticks, then up for 5 ticks
    tg.game.setPlayerInput("inputB", "right", true);
    tg.tick(5);
    tg.game.setPlayerInput("inputB", "right", false);
    tg.game.setPlayerInput("inputB", "up", true);
    tg.tick(5);
    tg.game.setPlayerInput("inputB", "up", false);
    tg.tick(10);

    // A should have moved toward target
    const playerA = tg.getPlayer("pathA");
    expect(playerA.x).toBeGreaterThan(2);

    // B should have moved right then up
    const playerB = tg.getPlayer("inputB");
    expect(playerB.x).toBeGreaterThan(5);
    expect(playerB.y).toBeLessThan(8);

    // C should be unmoved
    const playerC = tg.getPlayer("idleC");
    expect(playerC.x).toBe(10);
    expect(playerC.y).toBe(8);
  });

  it("player removal during active path does not error", () => {
    tg = new TestGame({ map: "default" });
    tg.spawn("walker", 2, 8);
    tg.move("walker", 17, 8);
    tg.tick(2);

    // Player should be partially along path
    expect(tg.getPlayer("walker").x).toBeGreaterThan(2);

    // Remove mid-path
    tg.game.removePlayer("walker");
    expect(tg.game.getPlayer("walker")).toBeUndefined();

    // Ticking should not throw
    expect(() => tg.tick(5)).not.toThrow();
  });

  it("player removal during active conversation ends conversation", () => {
    tg = new TestGame({ map: "default" });
    tg.spawn("p1", 5, 8, true);
    tg.spawn("p2", 6, 8, true);

    tg.game.enqueue({
      type: "start_convo",
      playerId: "p1",
      data: { targetId: "p2" },
    });
    tg.tick(); // start + auto-accept
    tg.tick(); // activate (adjacent)

    const convo = tg.game.conversations.getPlayerConversation("p1");
    expect(convo?.state).toBe("active");

    tg.game.removePlayer("p1");
    expect(tg.game.conversations.getConversation(convo!.id)?.state).toBe("ended");
    expect(tg.game.conversations.getConversation(convo!.id)?.endedReason).toBe(
      "missing_player",
    );
    tg.tick();

    // p2 should go back to idle
    const p2 = tg.getPlayer("p2");
    expect(p2.state).toBe("idle");
    expect(p2.currentConvoId).toBeUndefined();
  });
});
