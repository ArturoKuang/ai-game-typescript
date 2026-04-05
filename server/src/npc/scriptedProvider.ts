/**
 * Scripted (no-LLM) NPC provider used as a fallback when the primary
 * provider is unavailable and in tests.
 *
 * Generates deterministic replies based on personality keywords
 * (warm, history, art, technology) and simple greeting templates.
 */
import type { Message } from "../engine/conversation.js";
import type {
  NpcGoalRequest,
  NpcGoalResponse,
  NpcModelProvider,
  NpcModelResponse,
  NpcReflectionRequest,
  NpcReplyRequest,
} from "./provider.js";
import { buildGoalSelectionPrompt, buildReflectionPrompt, buildReplyPrompt } from "./provider.js";

const TOPIC_STOP_WORDS = new Set([
  "a",
  "an",
  "and",
  "are",
  "but",
  "for",
  "from",
  "have",
  "just",
  "that",
  "the",
  "them",
  "they",
  "this",
  "what",
  "with",
  "your",
]);

export class ScriptedNpcProvider implements NpcModelProvider {
  readonly name = "scripted";

  async generateReply(request: NpcReplyRequest): Promise<NpcModelResponse> {
    const lastPartnerMessage = this.findLastPartnerMessage(request.messages, request.partner.id);
    const content = lastPartnerMessage
      ? this.buildContextualReply(request, lastPartnerMessage)
      : this.greetingSeed(request);

    return {
      content,
      prompt: buildReplyPrompt(request),
      latencyMs: 0,
    };
  }

  async generateReflection(
    request: NpcReflectionRequest,
  ): Promise<NpcModelResponse> {
    const mostRecent =
      request.memories[0]?.content ?? "I need more experiences.";
    return {
      content: `I'm noticing a pattern in town life: ${mostRecent}`,
      prompt: buildReflectionPrompt(request),
      latencyMs: 0,
    };
  }

  async generateGoalSelection(
    request: NpcGoalRequest,
  ): Promise<NpcGoalResponse> {
    // Deterministic: pick the first available goal (most urgent need)
    const goalId = request.availableGoals[0]?.id ?? "satisfy_curiosity";
    return {
      goalId,
      reasoning: `Choosing ${goalId} as most urgent need`,
      prompt: buildGoalSelectionPrompt(request),
      latencyMs: 0,
    };
  }

  private greetingSeed(request: NpcReplyRequest): string {
    if ((request.npc.personality ?? "").toLowerCase().includes("warm")) {
      return `Hi ${request.partner.name}, it's good to see you.`;
    }
    return `Hello ${request.partner.name}. What's on your mind?`;
  }

  private buildContextualReply(
    request: NpcReplyRequest,
    lastPartnerMessage: Message,
  ): string {
    const personality = (request.npc.personality ?? "").toLowerCase();
    const previousPartnerMessage = this.findPreviousPartnerMessage(
      request.messages,
      request.partner.id,
    );
    const repeatedTopic =
      previousPartnerMessage !== undefined &&
      this.normalizeMessage(previousPartnerMessage.content) ===
        this.normalizeMessage(lastPartnerMessage.content);
    const topic = this.describeTopic(lastPartnerMessage.content);
    const previousNpcReply = this.findLastPartnerMessage(
      request.messages,
      request.npc.id,
    )?.content;
    const partnerTurnCount = request.messages.filter(
      (message) => message.playerId === request.partner.id,
    ).length;

    const candidates = repeatedTopic
      ? this.repeatedReplyOptions(personality, topic)
      : this.replyOptions(personality, topic);
    const index = this.pickReplyIndex(
      `${this.normalizeMessage(lastPartnerMessage.content)}:${partnerTurnCount}`,
      candidates.length,
      previousNpcReply,
      candidates,
    );

    return candidates[index];
  }

  private replyOptions(personality: string, topic: string): string[] {
    if (personality.includes("history")) {
      return [
        `${topic} reminds me of an old lesson. What part sticks with you?`,
        `There is some history hiding in ${topic}. What detail matters most?`,
        `When you bring up ${topic}, I start wondering how it unfolded.`,
      ];
    }
    if (personality.includes("art")) {
      return [
        `There is something vivid about ${topic}. What feeling comes with it?`,
        `${topic} paints a clear picture already. What stands out most?`,
        `I can almost see ${topic}. What draws your eye there?`,
      ];
    }
    if (personality.includes("technology")) {
      return [
        `${topic} has my attention. What have you noticed so far?`,
        `I have been turning ${topic} over in my head too. What is your angle?`,
        `${topic} could go a few directions. Which part do you want to unpack?`,
      ];
    }
    if (personality.includes("warm") || personality.includes("nurturing")) {
      return [
        `You mentioned ${topic}. Tell me a little more so I can follow you.`,
        `${topic} sounds important to you. What happened next?`,
        `I am with you on ${topic}. What is the part you are focused on?`,
      ];
    }
    return [
      `You mentioned ${topic}. What do you mean by it?`,
      `Let's stay with ${topic} for a second. What feels important there?`,
      `${topic} could mean a few things. Give me one concrete detail.`,
    ];
  }

  private repeatedReplyOptions(personality: string, topic: string): string[] {
    if (personality.includes("history")) {
      return [
        `I think I am still missing the shape of ${topic}. Can you say it another way?`,
        `Give me one concrete detail about ${topic}; I want to place it properly.`,
        `Help me understand ${topic} better. What happened first?`,
      ];
    }
    if (personality.includes("art")) {
      return [
        `I am not quite catching ${topic} yet. What feeling should I sit with?`,
        `Try framing ${topic} a little differently for me.`,
        `Give me one sharper image for ${topic}; I think that will help.`,
      ];
    }
    if (personality.includes("technology")) {
      return [
        `I am still not clear on ${topic}. What is the key detail?`,
        `Let me take another pass at ${topic}. Which part matters most?`,
        `Break ${topic} down for me a little more.`,
      ];
    }
    if (personality.includes("warm") || personality.includes("nurturing")) {
      return [
        `I think I am still missing ${topic}. Say it another way for me.`,
        `Help me catch up on ${topic}. What is the clearest detail?`,
        `I am listening, but I need one more detail about ${topic}.`,
      ];
    }
    return [
      `I am still not sure what you mean by ${topic}. Give me one concrete detail.`,
      `Let me try again with ${topic}. What is the clearest part?`,
      `I think I need a more specific example for ${topic}.`,
    ];
  }

  private describeTopic(content: string): string {
    const normalized = content.replace(/\s+/g, " ").trim();
    const words =
      normalized.match(/[A-Za-z0-9']+/g)?.filter((word) => {
        const lower = word.toLowerCase();
        return word.length >= 3 && !TOPIC_STOP_WORDS.has(lower);
      }) ?? [];

    const topic = words[0] || normalized.slice(0, 24) || "that";
    return `"${topic}"`;
  }

  private normalizeMessage(content: string): string {
    return content
      .toLowerCase()
      .replace(/[^a-z0-9\s]/g, " ")
      .replace(/\s+/g, " ")
      .trim();
  }

  private pickReplyIndex(
    seed: string,
    candidateCount: number,
    previousNpcReply: string | undefined,
    candidates: string[],
  ): number {
    let hash = 0;
    for (const char of seed) {
      hash = (hash * 31 + char.charCodeAt(0)) >>> 0;
    }

    let index = candidateCount > 0 ? hash % candidateCount : 0;
    if (
      previousNpcReply &&
      candidateCount > 1 &&
      candidates[index] === previousNpcReply
    ) {
      index = (index + 1) % candidateCount;
    }

    return index;
  }

  private findLastPartnerMessage(
    messages: Message[],
    playerId: string,
  ): Message | undefined {
    for (let index = messages.length - 1; index >= 0; index--) {
      if (messages[index].playerId === playerId) {
        return messages[index];
      }
    }
    return undefined;
  }

  private findPreviousPartnerMessage(
    messages: Message[],
    playerId: string,
  ): Message | undefined {
    let foundLatest = false;
    for (let index = messages.length - 1; index >= 0; index--) {
      if (messages[index].playerId !== playerId) {
        continue;
      }
      if (!foundLatest) {
        foundLatest = true;
        continue;
      }
      return messages[index];
    }
    return undefined;
  }
}
