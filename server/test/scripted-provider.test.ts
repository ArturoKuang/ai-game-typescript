import { describe, expect, it } from "vitest";
import type { Message } from "../src/engine/conversation.js";
import type { Player } from "../src/engine/types.js";
import type { NpcReplyRequest } from "../src/npc/provider.js";
import { ScriptedNpcProvider } from "../src/npc/scriptedProvider.js";

function makePlayer(overrides: Partial<Player>): Player {
  return {
    id: overrides.id ?? "player",
    name: overrides.name ?? "Player",
    description: overrides.description ?? "",
    personality: overrides.personality,
    isNpc: overrides.isNpc ?? false,
    isWaitingForResponse: false,
    x: overrides.x ?? 0,
    y: overrides.y ?? 0,
    orientation: overrides.orientation ?? "down",
    pathSpeed: overrides.pathSpeed ?? 1,
    state: overrides.state ?? "idle",
    vx: overrides.vx ?? 0,
    vy: overrides.vy ?? 0,
    inputX: overrides.inputX ?? 0,
    inputY: overrides.inputY ?? 0,
    radius: overrides.radius ?? 0.4,
    inputSpeed: overrides.inputSpeed ?? 5,
    hp: overrides.hp ?? 100,
    maxHp: overrides.maxHp ?? 100,
  };
}

function makeMessage(
  id: number,
  playerId: string,
  content: string,
): Message {
  return {
    id,
    convoId: 1,
    playerId,
    content,
    tick: id,
  };
}

function makeReplyRequest(messages: Message[]): NpcReplyRequest {
  return {
    conversationId: 1,
    npc: makePlayer({
      id: "npc_eve",
      name: "Eve Okafor",
      isNpc: true,
      personality: "Sociable, nurturing, gossipy, wise.",
    }),
    partner: makePlayer({
      id: "human_1",
      name: "dsadsa",
      isNpc: false,
    }),
    messages,
    memories: [],
    currentTick: 10,
  };
}

describe("ScriptedNpcProvider", () => {
  it("uses the partner message content instead of repeating one canned line", async () => {
    const provider = new ScriptedNpcProvider();

    const first = await provider.generateReply(
      makeReplyRequest([makeMessage(1, "human_1", "The bakery is crowded today")]),
    );
    const second = await provider.generateReply(
      makeReplyRequest([makeMessage(1, "human_1", "The library feels quiet tonight")]),
    );

    expect(first.content).not.toBe(second.content);
    expect(first.content.toLowerCase()).not.toContain("worth thinking about for a minute");
    expect(second.content.toLowerCase()).not.toContain("worth thinking about for a minute");
  });

  it("varies its fallback reply when the partner repeats the same message", async () => {
    const provider = new ScriptedNpcProvider();

    const firstReply = await provider.generateReply(
      makeReplyRequest([makeMessage(1, "human_1", "dsa")]),
    );
    const secondReply = await provider.generateReply(
      makeReplyRequest([
        makeMessage(1, "human_1", "dsa"),
        makeMessage(2, "npc_eve", firstReply.content),
        makeMessage(3, "human_1", "dsa"),
      ]),
    );

    expect(secondReply.content).not.toBe(firstReply.content);
  });
});
