import type { Conversation, Message } from "./types.js";

const CONVERSATION_STATE_PRIORITY: Record<Conversation["state"], number> = {
  invited: 0,
  walking: 1,
  active: 2,
  ended: 3,
};

function cloneMessage(message: Message): Message {
  return { ...message };
}

export function cloneConversation(conversation: Conversation): Conversation {
  return {
    ...conversation,
    messages: conversation.messages.map(cloneMessage),
  };
}

function mergeMessages(
  currentMessages: readonly Message[],
  incomingMessages: readonly Message[],
): Message[] {
  const merged = new Map<number, Message>();

  for (const message of currentMessages) {
    merged.set(message.id, cloneMessage(message));
  }

  for (const message of incomingMessages) {
    merged.set(message.id, cloneMessage(message));
  }

  return Array.from(merged.values()).sort((left, right) => {
    if (left.tick !== right.tick) {
      return left.tick - right.tick;
    }
    return left.id - right.id;
  });
}

function getLastMessageTick(conversation: Conversation): number {
  const lastMessage = conversation.messages[conversation.messages.length - 1];
  return lastMessage?.tick ?? -1;
}

function shouldPreferIncomingConversation(
  current: Conversation,
  incoming: Conversation,
): boolean {
  const currentStatePriority = CONVERSATION_STATE_PRIORITY[current.state];
  const incomingStatePriority = CONVERSATION_STATE_PRIORITY[incoming.state];

  if (incomingStatePriority !== currentStatePriority) {
    return incomingStatePriority > currentStatePriority;
  }

  const currentEndedTick = current.endedTick ?? -1;
  const incomingEndedTick = incoming.endedTick ?? -1;
  if (incomingEndedTick !== currentEndedTick) {
    return incomingEndedTick > currentEndedTick;
  }

  if (incoming.messages.length !== current.messages.length) {
    return incoming.messages.length > current.messages.length;
  }

  const currentLastMessageTick = getLastMessageTick(current);
  const incomingLastMessageTick = getLastMessageTick(incoming);
  if (incomingLastMessageTick !== currentLastMessageTick) {
    return incomingLastMessageTick > currentLastMessageTick;
  }

  return incoming.startedTick > current.startedTick;
}

export function mergeConversationSnapshots(
  current: Conversation,
  incoming: Conversation,
): Conversation {
  const preferred = shouldPreferIncomingConversation(current, incoming)
    ? incoming
    : current;
  const mergedMessages = mergeMessages(current.messages, incoming.messages);
  const endedTick = Math.max(current.endedTick ?? -1, incoming.endedTick ?? -1);
  const prefersIncomingEndReason =
    (incoming.endedTick ?? -1) >= (current.endedTick ?? -1);

  return {
    ...cloneConversation(preferred),
    startedTick: Math.min(current.startedTick, incoming.startedTick),
    endedTick: endedTick >= 0 ? endedTick : undefined,
    endedReason: prefersIncomingEndReason
      ? incoming.endedReason ?? current.endedReason
      : current.endedReason ?? incoming.endedReason,
    summary: incoming.summary ?? current.summary,
    messages: mergedMessages,
  };
}

export function upsertConversationSnapshot(
  conversations: readonly Conversation[],
  incoming: Conversation,
): {
  conversations: Conversation[];
  previous?: Conversation;
} {
  const existingIndex = conversations.findIndex(
    (conversation) => conversation.id === incoming.id,
  );

  if (existingIndex < 0) {
    return {
      conversations: [...conversations, cloneConversation(incoming)],
    };
  }

  const previous = cloneConversation(conversations[existingIndex]);
  const merged = mergeConversationSnapshots(
    conversations[existingIndex],
    incoming,
  );

  return {
    conversations: conversations.map((conversation, index) =>
      index === existingIndex ? merged : conversation,
    ),
    previous,
  };
}

export function appendConversationMessage(
  conversations: readonly Conversation[],
  message: Message,
): Conversation[] {
  return conversations.map((conversation) => {
    if (conversation.id !== message.convoId) {
      return conversation;
    }

    return {
      ...conversation,
      messages: mergeMessages(conversation.messages, [message]),
    };
  });
}

function upsertIntoConversationMap(
  conversations: Map<number, Conversation>,
  incoming: Conversation,
): void {
  const existing = conversations.get(incoming.id);
  conversations.set(
    incoming.id,
    existing
      ? mergeConversationSnapshots(existing, incoming)
      : cloneConversation(incoming),
  );
}

export function reconcileDebugConversationSnapshots(params: {
  current: readonly Conversation[];
  fetched: readonly Conversation[];
  localConversations: readonly Conversation[];
}): Conversation[] {
  const conversationsById = new Map<number, Conversation>();
  const localConversationIds = new Set(
    params.localConversations.map((conversation) => conversation.id),
  );

  for (const conversation of params.current) {
    if (localConversationIds.has(conversation.id)) {
      conversationsById.set(conversation.id, cloneConversation(conversation));
    }
  }

  for (const conversation of params.fetched) {
    upsertIntoConversationMap(conversationsById, conversation);
  }

  for (const conversation of params.localConversations) {
    upsertIntoConversationMap(conversationsById, conversation);
  }

  return Array.from(conversationsById.values());
}
