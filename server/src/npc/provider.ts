import type { Message } from "../engine/conversation.js";
import type { Player } from "../engine/types.js";
import type { Memory } from "../db/repository.js";

export interface NpcReplyRequest {
  conversationId: number;
  npc: Player;
  partner: Player;
  messages: Message[];
  memories: Memory[];
  currentTick: number;
  sessionId?: string;
}

export interface NpcReflectionRequest {
  npc: Player;
  memories: Memory[];
  currentTick: number;
  sessionId?: string;
}

export interface NpcModelResponse {
  content: string;
  prompt: string;
  sessionId?: string;
  rawOutput?: string;
  latencyMs: number;
}

export interface NpcModelProvider {
  readonly name: string;
  generateReply(request: NpcReplyRequest): Promise<NpcModelResponse>;
  generateReflection(request: NpcReflectionRequest): Promise<NpcModelResponse>;
}

export function buildReplyPrompt(request: NpcReplyRequest): string {
  const transcript = request.messages
    .slice(-8)
    .map((message) => {
      const speaker = message.playerId === request.npc.id
        ? request.npc.name
        : request.partner.name;
      return `${speaker}: ${message.content}`;
    })
    .join("\n");

  const memories = request.memories.length > 0
    ? request.memories
        .slice(0, 5)
        .map((memory, index) => `${index + 1}. ${memory.content}`)
        .join("\n")
    : "None.";

  return [
    "You are roleplaying as an NPC in a tile-based town simulation.",
    `Stay in character as ${request.npc.name}.`,
    `Description: ${request.npc.description}`,
    `Personality: ${request.npc.personality ?? "Unknown"}`,
    `Conversation partner: ${request.partner.name}.`,
    "Respond with exactly one natural in-character chat message.",
    "Do not narrate actions, do not mention prompts, tools, policies, or being an AI.",
    "Keep the reply under 45 words unless the conversation clearly requires more detail.",
    "",
    "Relevant memories:",
    memories,
    "",
    "Recent transcript:",
    transcript || `${request.partner.name} has just approached you.`,
  ].join("\n");
}

export function buildReflectionPrompt(request: NpcReflectionRequest): string {
  const memories = request.memories
    .slice(0, 8)
    .map((memory, index) => `${index + 1}. [${memory.type}] ${memory.content}`)
    .join("\n");

  return [
    "You are generating an internal reflection for an NPC in a town simulation.",
    `NPC: ${request.npc.name}`,
    `Description: ${request.npc.description}`,
    `Personality: ${request.npc.personality ?? "Unknown"}`,
    "Write one short first-person reflection about what the NPC has learned or inferred.",
    "Keep it under 80 words. This is private memory, not spoken dialogue.",
    "",
    "Recent memories:",
    memories || "None.",
  ].join("\n");
}
