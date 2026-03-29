import { describe, expect, it } from "vitest";
import {
  formatConversationHarnessResult,
  listConversationHarnessScenarios,
  runConversationHarnessScenario,
} from "../src/debug/conversationHarness.js";

describe("conversation harness", () => {
  it("lists the built-in scenarios", () => {
    const scenarios = listConversationHarnessScenarios();
    expect(scenarios.map((scenario) => scenario.name)).toEqual([
      "human_to_npc_conversation",
      "npc_to_human_conversation",
      "human_to_human_accept",
      "human_to_human_decline",
      "private_message_broadcast_isolation",
      "join_grace_period",
    ]);
  });

  it("formats transcript, summary, debug log, and ascii map output", () => {
    const formatted = formatConversationHarnessResult({
      scenario: "human_to_human_decline",
      description: "Synthetic harness result",
      baseUrl: "http://127.0.0.1:3001",
      wsUrl: "ws://127.0.0.1:3001",
      startTick: 10,
      endTick: 15,
      summary: {
        declined: true,
        endedReason: "declined",
      },
      transcript: [
        {
          messageId: 1,
          convoId: 2,
          senderId: "human_1",
          recipientLabel: "Harness Bob",
          content: "hello",
          tick: 12,
        },
      ],
      debugLog: [
        { tick: 10, type: "convo_started" },
        { tick: 11, type: "convo_ended" },
      ],
      asciiMap: "###\n#A#\n###",
    });

    expect(formatted).toContain("Scenario: human_to_human_decline");
    expect(formatted).toContain("declined: true");
    expect(formatted).toContain("[12] Harness Bob <= human_1: hello");
    expect(formatted).toContain("[10] convo_started");
    expect(formatted).toContain("ASCII map:\n###\n#A#\n###");
  });

  it("runs the decline scenario against a managed live server", async () => {
    const result = await runConversationHarnessScenario("human_to_human_decline");

    expect(result.summary.declined).toBe(true);
    expect(result.summary.endedReason).toBe("declined");
    expect(result.debugLog).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ type: "convo_started" }),
        expect.objectContaining({ type: "convo_ended" }),
      ]),
    );
    expect(result.asciiMap).toContain("┌");
  });
});
