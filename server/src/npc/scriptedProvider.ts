import type {
  NpcModelProvider,
  NpcModelResponse,
  NpcReflectionRequest,
  NpcReplyRequest,
} from "./provider.js";
import { buildReflectionPrompt, buildReplyPrompt } from "./provider.js";

export class ScriptedNpcProvider implements NpcModelProvider {
  readonly name = "scripted";

  async generateReply(request: NpcReplyRequest): Promise<NpcModelResponse> {
    const lastMessage = request.messages[request.messages.length - 1];
    const content = lastMessage
      ? `${request.partner.name}, ${this.replySeed(request)}`
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
    const mostRecent = request.memories[0]?.content ?? "I need more experiences.";
    return {
      content: `I'm noticing a pattern in town life: ${mostRecent}`,
      prompt: buildReflectionPrompt(request),
      latencyMs: 0,
    };
  }

  private greetingSeed(request: NpcReplyRequest): string {
    if ((request.npc.personality ?? "").toLowerCase().includes("warm")) {
      return `Hi ${request.partner.name}, it's good to see you.`;
    }
    return `Hello ${request.partner.name}. What's on your mind?`;
  }

  private replySeed(request: NpcReplyRequest): string {
    const personality = (request.npc.personality ?? "").toLowerCase();
    if (personality.includes("history")) {
      return "that reminds me of a story I used to tell my students.";
    }
    if (personality.includes("art")) {
      return "there's something vivid about the way you put that.";
    }
    if (personality.includes("technology")) {
      return "I've been turning that idea over in my head too.";
    }
    return "that's worth thinking about for a minute.";
  }
}
