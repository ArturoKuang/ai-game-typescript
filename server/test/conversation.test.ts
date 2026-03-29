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
    cm.acceptInvite(convo.id, "bob");
    expect(convo.state).toBe("walking");
  });

  it("rejects invite acceptance from anyone except the invitee", () => {
    cm = new ConversationManager();
    const convo = cm.startConversation("alice", "bob", 0);
    expect(() => cm.acceptInvite(convo.id, "alice")).toThrow("Only the invitee");
  });

  it("declines invite and ends the conversation cleanly", () => {
    cm = new ConversationManager();
    const convo = cm.startConversation("alice", "bob", 0);
    cm.declineInvite(convo.id, "bob", 4);
    expect(convo.state).toBe("ended");
    expect(convo.endedTick).toBe(4);
    expect(convo.endedReason).toBe("declined");
    expect(cm.getPlayerConversation("alice")).toBeUndefined();
    expect(cm.getPlayerConversation("bob")).toBeUndefined();
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

  it("same pair can re-converse after a decline", () => {
    cm = new ConversationManager();
    const first = cm.startConversation("alice", "bob", 0);
    cm.declineInvite(first.id, "bob", 1);

    const second = cm.startConversation("alice", "bob", 2);
    expect(second.id).not.toBe(first.id);
    expect(second.state).toBe("invited");
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

  it("human-human invite can be accepted and becomes active", () => {
    tg = new TestGame({ map: "default" });
    tg.spawn("alice", 5, 8, false);
    tg.spawn("bob", 6, 8, false);

    tg.game.enqueue({
      type: "start_convo",
      playerId: "alice",
      data: { targetId: "bob" },
    });
    tg.tick();

    let convo = tg.game.conversations.getPlayerConversation("alice");
    expect(convo?.state).toBe("invited");

    tg.game.enqueue({
      type: "accept_convo",
      playerId: "bob",
      data: { convoId: convo!.id },
    });
    tg.tick();

    convo = tg.game.conversations.getPlayerConversation("alice");
    expect(convo?.state).toBe("active");
    expect(tg.getPlayer("alice").state).toBe("conversing");
    expect(tg.getPlayer("bob").state).toBe("conversing");
  });

  it("human-human invite can be declined and the pair can re-converse", () => {
    tg = new TestGame({ map: "default" });
    tg.spawn("alice", 5, 8, false);
    tg.spawn("bob", 6, 8, false);

    tg.game.enqueue({
      type: "start_convo",
      playerId: "alice",
      data: { targetId: "bob" },
    });
    tg.tick();

    const first = tg.game.conversations.getPlayerConversation("alice");
    expect(first?.state).toBe("invited");

    tg.game.enqueue({
      type: "decline_convo",
      playerId: "bob",
      data: { convoId: first!.id },
    });
    tg.tick();

    expect(tg.game.conversations.getPlayerConversation("alice")).toBeUndefined();

    tg.game.enqueue({
      type: "start_convo",
      playerId: "alice",
      data: { targetId: "bob" },
    });
    tg.tick();

    const second = tg.game.conversations.getPlayerConversation("alice");
    expect(second).toBeDefined();
    expect(second?.id).not.toBe(first?.id);
    expect(second?.state).toBe("invited");
  });

  it("inviter cannot say before activation", () => {
    tg = new TestGame({ map: "default" });
    tg.spawn("alice", 5, 8, false);
    tg.spawn("bob", 8, 8, false);

    tg.game.enqueue({
      type: "start_convo",
      playerId: "alice",
      data: { targetId: "bob" },
    });
    tg.tick();

    const convo = tg.game.conversations.getPlayerConversation("alice");
    expect(convo?.state).toBe("invited");

    tg.game.enqueue({
      type: "say",
      playerId: "alice",
      data: { convoId: convo!.id, content: "Too early" },
    });
    tg.tick();

    expect(convo?.messages).toHaveLength(0);
  });

  it("invite target cannot start a second conversation while one is pending", () => {
    tg = new TestGame({ map: "default" });
    tg.spawn("alice", 5, 8, false);
    tg.spawn("bob", 6, 8, false);
    tg.spawn("carol", 7, 8, false);

    tg.game.enqueue({
      type: "start_convo",
      playerId: "alice",
      data: { targetId: "bob" },
    });
    tg.tick();

    tg.game.enqueue({
      type: "start_convo",
      playerId: "bob",
      data: { targetId: "carol" },
    });
    tg.tick();

    expect(tg.game.conversations.getPlayerConversation("carol")).toBeUndefined();
  });
});
