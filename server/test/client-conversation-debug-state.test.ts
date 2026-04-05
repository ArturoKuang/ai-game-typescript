import { describe, expect, it } from "vitest";
import {
  appendConversationMessage,
  reconcileDebugConversationSnapshots,
  upsertConversationSnapshot,
} from "../../client/src/conversationDebugState.js";
import type { Conversation, Message } from "../../client/src/types.js";

function makeConversation(
  overrides: Partial<Conversation> = {},
): Conversation {
  return {
    id: 1,
    player1Id: "human_1",
    player2Id: "npc_alice",
    state: "active",
    messages: [],
    startedTick: 10,
    ...overrides,
  };
}

function makeMessage(overrides: Partial<Message> = {}): Message {
  return {
    id: 1,
    convoId: 1,
    playerId: "human_1",
    content: "Hello there",
    tick: 12,
    ...overrides,
  };
}

describe("client conversation debug state", () => {
  it("keeps a locally tracked conversation visible when polling misses it", () => {
    const pendingReplyConversation = makeConversation({
      messages: [makeMessage()],
    });

    const result = reconcileDebugConversationSnapshots({
      current: [],
      fetched: [],
      localConversations: [pendingReplyConversation],
    });

    expect(result).toHaveLength(1);
    expect(result[0].id).toBe(pendingReplyConversation.id);
    expect(result[0].messages).toEqual(pendingReplyConversation.messages);
  });

  it("does not regress a newer transcript when the debug poll lags", () => {
    const currentConversation = makeConversation({
      messages: [
        makeMessage(),
        makeMessage({
          id: 2,
          playerId: "npc_alice",
          content: "Hi human",
          tick: 14,
        }),
      ],
    });
    const staleFetchedConversation = makeConversation({
      messages: [makeMessage()],
    });

    const result = reconcileDebugConversationSnapshots({
      current: [currentConversation],
      fetched: [staleFetchedConversation],
      localConversations: [currentConversation],
    });

    expect(result).toHaveLength(1);
    expect(result[0].messages).toHaveLength(2);
    expect(result[0].messages[1].content).toBe("Hi human");
  });

  it("preserves transcript history when a conversation ends", () => {
    const activeConversation = makeConversation({
      messages: [makeMessage()],
    });
    const endedConversation = makeConversation({
      state: "ended",
      endedTick: 20,
      endedReason: "manual",
      messages: [],
    });

    const { conversations } = upsertConversationSnapshot(
      [activeConversation],
      endedConversation,
    );

    expect(conversations).toHaveLength(1);
    expect(conversations[0].state).toBe("ended");
    expect(conversations[0].messages).toHaveLength(1);
    expect(conversations[0].endedTick).toBe(20);
  });

  it("appends message events without duplicating existing transcript entries", () => {
    const message = makeMessage();
    const conversation = makeConversation({
      messages: [message],
    });

    const updated = appendConversationMessage([conversation], message);

    expect(updated).toHaveLength(1);
    expect(updated[0].messages).toHaveLength(1);
    expect(updated[0].messages[0].content).toBe("Hello there");
  });
});
