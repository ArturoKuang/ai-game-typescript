import { afterEach, describe, expect, it } from "vitest";
import { ConversationManager } from "../src/engine/conversation.js";
import { TestGame } from "./helpers/testGame.js";

describe("ConversationManager", () => {
  let cm: ConversationManager;

  afterEach(() => {
    cm?.clear();
  });

  it("starts a conversation between two players", () => {
    cm = new ConversationManager();
    const convo = cm.startConversation("alice", "bob", 0);
    expect(convo.id).toBe(1);
    expect(convo.state).toBe("invited");
    expect(convo.player1Id).toBe("alice");
    expect(convo.player2Id).toBe("bob");
    expect(convo.messages).toHaveLength(0);
  });

  it("rejects conversation if player is already in one", () => {
    cm = new ConversationManager();
    cm.startConversation("alice", "bob", 0);
    expect(() => cm.startConversation("alice", "carol", 0)).toThrow(
      "already in a conversation",
    );
    expect(() => cm.startConversation("carol", "bob", 0)).toThrow(
      "already in a conversation",
    );
  });

  it("accepts invite transitions to walking", () => {
    cm = new ConversationManager();
    const convo = cm.startConversation("alice", "bob", 0);
    cm.acceptInvite(convo.id);
    expect(convo.state).toBe("walking");
  });

  it("adds messages to active conversation", () => {
    cm = new ConversationManager();
    const convo = cm.startConversation("alice", "bob", 0);
    convo.state = "active"; // force active for test
    const msg = cm.addMessage(convo.id, "alice", "Hello!", 1);
    expect(msg.content).toBe("Hello!");
    expect(msg.playerId).toBe("alice");
    expect(convo.messages).toHaveLength(1);
  });

  it("rejects messages from non-participants", () => {
    cm = new ConversationManager();
    const convo = cm.startConversation("alice", "bob", 0);
    convo.state = "active";
    expect(() => cm.addMessage(convo.id, "carol", "Hey!", 1)).toThrow(
      "not part of",
    );
  });

  it("rejects messages in non-active conversations", () => {
    cm = new ConversationManager();
    const convo = cm.startConversation("alice", "bob", 0);
    expect(() => cm.addMessage(convo.id, "alice", "Hello", 1)).toThrow(
      "not active",
    );
  });

  it("ends a conversation", () => {
    cm = new ConversationManager();
    const convo = cm.startConversation("alice", "bob", 0);
    convo.state = "active";
    cm.endConversation(convo.id, 10);
    expect(convo.state).toBe("ended");
    expect(convo.endedTick).toBe(10);
  });

  it("gets active conversations", () => {
    cm = new ConversationManager();
    cm.startConversation("alice", "bob", 0);
    cm.startConversation("carol", "dave", 0);
    const c3 = cm.startConversation("eve", "frank", 0);
    cm.endConversation(c3.id, 5);

    expect(cm.getActiveConversations()).toHaveLength(2);
    expect(cm.getAllConversations()).toHaveLength(3);
  });

  it("gets player conversation", () => {
    cm = new ConversationManager();
    cm.startConversation("alice", "bob", 0);
    expect(cm.getPlayerConversation("alice")).toBeDefined();
    expect(cm.getPlayerConversation("bob")).toBeDefined();
    expect(cm.getPlayerConversation("carol")).toBeUndefined();
  });
});

describe("Conversation Integration with GameLoop", () => {
  let tg: TestGame;

  afterEach(() => {
    tg?.destroy();
  });

  it("NPC auto-accepts conversation invite on tick", () => {
    tg = new TestGame({ map: "default" });
    tg.spawn("alice", 5, 8, true);
    tg.spawn("bob", 6, 8, true);

    const convo = tg.game.conversations.startConversation("alice", "bob", 0);
    expect(convo.state).toBe("invited");

    tg.tick(); // NPC should auto-accept (and activate if close enough)
    // Players are adjacent, so it goes invited -> walking -> active in one tick
    expect(["walking", "active"]).toContain(convo.state);
  });

  it("NPC-initiated human conversation auto-accepts on tick", () => {
    tg = new TestGame({ map: "default" });
    tg.spawn("npc_alice", 5, 8, true);
    tg.spawn("human_1", 6, 8, false);

    const convo = tg.game.conversations.startConversation("npc_alice", "human_1", 0);
    expect(convo.state).toBe("invited");

    tg.tick();
    expect(["walking", "active"]).toContain(convo.state);
  });

  it("conversation activates when players are close", () => {
    tg = new TestGame({ map: "default" });
    tg.spawn("alice", 5, 8, true);
    tg.spawn("bob", 6, 8, true); // distance = 1, within CONVERSATION_DISTANCE

    const convo = tg.game.conversations.startConversation("alice", "bob", 0);
    tg.tick(); // auto-accept -> walking
    tg.tick(); // proximity check -> active

    expect(convo.state).toBe("active");
    expect(tg.getPlayer("alice").state).toBe("conversing");
    expect(tg.getPlayer("bob").state).toBe("conversing");
  });

  it("player state returns to idle after conversation ends", () => {
    tg = new TestGame({ map: "default" });
    tg.spawn("alice", 5, 8, true);
    tg.spawn("bob", 6, 8, true);

    const convo = tg.game.conversations.startConversation("alice", "bob", 0);
    tg.tick(2); // accept + activate

    tg.game.conversations.endConversation(convo.id, tg.game.currentTick);
    tg.tick(); // sync state

    expect(tg.getPlayer("alice").state).toBe("idle");
    expect(tg.getPlayer("bob").state).toBe("idle");
  });

  it("players walk toward each other when far apart", () => {
    tg = new TestGame({ map: "default" });
    tg.spawn("alice", 2, 8, true);
    tg.spawn("bob", 10, 8, true);

    tg.game.conversations.startConversation("alice", "bob", 0);
    tg.tick(3); // accept + start walking

    const alice = tg.getPlayer("alice");
    const bob = tg.getPlayer("bob");
    // At least one should be walking
    expect(alice.state === "walking" || bob.state === "walking").toBe(true);
  });

  it("conversation blocks player movement", () => {
    tg = new TestGame({ map: "default" });
    tg.spawn("alice", 5, 8, true);
    tg.spawn("bob", 6, 8, true);

    tg.game.conversations.startConversation("alice", "bob", 0);
    tg.tick(2); // activate

    // Try to move Alice while conversing
    const path = tg.move("alice", 15, 8);
    expect(path).toBeNull();
  });

  it("messages can be exchanged in active conversation", () => {
    tg = new TestGame({ map: "default" });
    tg.spawn("alice", 5, 8, true);
    tg.spawn("bob", 6, 8, true);

    const convo = tg.game.conversations.startConversation("alice", "bob", 0);
    tg.tick(2);

    const msg = tg.game.conversations.addMessage(
      convo.id,
      "alice",
      "Hello Bob!",
      tg.game.currentTick,
    );
    expect(msg.content).toBe("Hello Bob!");
    expect(convo.messages).toHaveLength(1);
  });
});
