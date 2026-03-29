import { afterEach, describe, expect, it } from "vitest";
import { TestGame } from "./helpers/testGame.js";
import { ConversationManager } from "../src/engine/conversation.js";

describe("Conversation index correctness", () => {
  it("getPlayerConversation returns undefined after conversation ends", () => {
    const cm = new ConversationManager();
    cm.startConversation("p1", "p2", 0);
    const convo = cm.getPlayerConversation("p1");
    expect(convo).toBeDefined();

    cm.endConversation(convo!.id, 1);
    expect(cm.getPlayerConversation("p1")).toBeUndefined();
    expect(cm.getPlayerConversation("p2")).toBeUndefined();
  });

  it("player can start new conversation after previous one ends", () => {
    const cm = new ConversationManager();
    const c1 = cm.startConversation("p1", "p2", 0);
    cm.endConversation(c1.id, 1);

    // Should not throw -- p1 is free now
    const c2 = cm.startConversation("p1", "p3", 2);
    expect(c2.id).not.toBe(c1.id);
    expect(cm.getPlayerConversation("p1")?.id).toBe(c2.id);
  });

  it("10 sequential conversations don't leak state", () => {
    const cm = new ConversationManager();

    for (let i = 0; i < 10; i++) {
      const c = cm.startConversation("p1", `other_${i}`, i * 2);
      cm.acceptInvite(c.id);
      cm.endConversation(c.id, i * 2 + 1);
    }

    expect(cm.getActiveConversations()).toHaveLength(0);
    expect(cm.getPlayerConversation("p1")).toBeUndefined();
  });

  it("same pair can re-converse after ending previous conversation", () => {
    const cm = new ConversationManager();
    const c1 = cm.startConversation("p1", "p2", 0);
    cm.endConversation(c1.id, 1);

    // Same pair again -- should succeed
    const c2 = cm.startConversation("p1", "p2", 2);
    expect(c2).toBeDefined();
    expect(c2.id).not.toBe(c1.id);
  });
});
