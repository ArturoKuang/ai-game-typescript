/**
 * NPC model provider interface and prompt builders.
 *
 * Defines the contract ({@link NpcModelProvider}) that all LLM backends
 * must implement, plus helper functions that format game state into
 * prompts suitable for chat-style language models. `NpcOrchestrator` is the
 * main caller: it assembles the request objects in this file, calls a provider,
 * then records the returned prompt/response metadata through `NpcPersistenceStore`.
 */
import type { Memory } from "../db/repository.js";
import type { Message } from "../engine/conversation.js";
import type { Player } from "../engine/types.js";

const SURVIVAL_DEATH_RULE =
  "If your health, food, water, or social value reaches 0, you die and your body is lost to the land.";

const WORLD_FRAMING =
  "You have no name for this place. You know only what you have seen with your own eyes or heard from those around you. Do not speak of towns, villages, cities, houses, jobs, or anything your eyes have not shown you.";

/** Input context assembled by the orchestrator for one NPC conversation turn. */
export interface NpcReplyRequest {
  conversationId: number;
  npc: Player;
  partner: Player;
  messages: Message[];
  memories: Memory[];
  currentTick: number;
  sessionId?: string;
}

/** Input context for generating an NPC's private reflection memory. */
export interface NpcReflectionRequest {
  npc: Player;
  memories: Memory[];
  currentTick: number;
  sessionId?: string;
}

/** Provider output plus audit metadata persisted for debugging and replay. */
export interface NpcModelResponse {
  content: string;
  prompt: string;
  sessionId?: string;
  rawOutput?: string;
  latencyMs: number;
}

/**
 * Minimal NPC identity payload needed for goal selection.
 *
 * Audit note: goal selection does not need transient movement/path fields, so
 * this stays narrower than the full engine `Player` type on purpose.
 */
export type NpcGoalActor = Pick<
  Player,
  "id" | "name" | "description" | "personality"
>;

export interface NpcGoalRememberedTarget {
  type: string;
  distance: number;
  ageTicks: number;
  source: "observation" | "action";
  availability?: "available" | "depleted" | "danger" | "unavailable";
  name?: string;
}

/** Input context for NPC goal selection in the autonomy system. */
export interface NpcGoalRequest {
  npc: NpcGoalActor;
  needs: { health: number; food: number; water: number; social: number };
  inventory: Record<string, number>;
  nearbyEntities: { type: string; distance: number; name?: string }[];
  rememberedTargets: NpcGoalRememberedTarget[];
  recentMemories: Memory[];
  availableGoals: { id: string; description: string }[];
  currentTick: number;
  sessionId?: string;
}

/** Provider output for goal selection. */
export interface NpcGoalResponse {
  goalId: string;
  reasoning?: string;
  prompt: string;
  sessionId?: string;
  latencyMs: number;
}

/** Contract for LLM backends that generate NPC dialogue and reflections. */
export interface NpcModelProvider {
  readonly name: string;
  generateReply(request: NpcReplyRequest): Promise<NpcModelResponse>;
  generateReflection(request: NpcReflectionRequest): Promise<NpcModelResponse>;
  generateGoalSelection?(request: NpcGoalRequest): Promise<NpcGoalResponse>;
}

/**
 * Build a reply prompt from conversation context and memories.
 *
 * Includes: NPC identity, partner name, last 8 transcript lines,
 * top 5 memories, and constraints (stay in character, under 45 words).
 */
export function buildReplyPrompt(request: NpcReplyRequest): string {
  const transcript = request.messages
    .slice(-8)
    .map((message) => {
      const speaker =
        message.playerId === request.npc.id
          ? request.npc.name
          : request.partner.name;
      return `${speaker}: ${message.content}`;
    })
    .join("\n");

  const memories =
    request.memories.length > 0
      ? request.memories
          .slice(0, 5)
          .map((memory, index) => `${index + 1}. ${memory.content}`)
          .join("\n")
      : "None.";

  return [
    "You are roleplaying as an early human awake in an unfamiliar land.",
    WORLD_FRAMING,
    `Stay in character as ${request.npc.name}.`,
    `Description: ${request.npc.description}`,
    `Personality: ${request.npc.personality ?? "Unknown"}`,
    `The one before you: ${request.partner.name}.`,
    SURVIVAL_DEATH_RULE,
    "Respond with exactly one natural in-character line of speech.",
    "Do not narrate actions, do not mention prompts, tools, policies, or being an AI.",
    "Keep the reply under 45 words unless the moment clearly calls for more.",
    "",
    "Relevant memories:",
    memories,
    "",
    "Recent words between you:",
    transcript || `${request.partner.name} has just come near you.`,
  ].join("\n");
}

/**
 * Build a reflection prompt for an NPC's internal monologue.
 *
 * Includes: NPC identity, last 8 memories, and instructions to write
 * a short first-person reflection (under 80 words).
 */
export function buildReflectionPrompt(request: NpcReflectionRequest): string {
  const memories = request.memories
    .slice(0, 8)
    .map((memory, index) => `${index + 1}. [${memory.type}] ${memory.content}`)
    .join("\n");

  return [
    "You are generating an inner thought for an early human in an unfamiliar land.",
    WORLD_FRAMING,
    `You are ${request.npc.name}.`,
    `Description: ${request.npc.description}`,
    `Personality: ${request.npc.personality ?? "Unknown"}`,
    SURVIVAL_DEATH_RULE,
    "Write one short first-person thought about what you have learned or sensed.",
    "Keep it under 80 words. This is private, not spoken aloud.",
    "",
    "Recent memories:",
    memories || "None.",
  ].join("\n");
}

/**
 * Build a goal selection prompt for NPC autonomy.
 *
 * ~200-300 input tokens. Expected ~20-40 output tokens.
 */
export function buildGoalSelectionPrompt(request: NpcGoalRequest): string {
  const needLines = Object.entries(request.needs)
    .map(([key, value]) => {
      const urgent = value < 40 ? " (URGENT)" : "";
      return `- ${key[0].toUpperCase() + key.slice(1)}: ${Math.round(value)}/100${urgent}`;
    })
    .join("\n");

  const invItems = Object.entries(request.inventory);
  const invLine =
    invItems.length > 0
      ? invItems.map(([item, count]) => `${item} x${count}`).join(", ")
      : "empty";

  const nearbyLines = request.nearbyEntities
    .slice(0, 5)
    .map((e) => `- ${e.type} (${Math.round(e.distance)} tiles away)`)
    .join("\n");

  const rememberedLines = request.rememberedTargets
    .slice(0, 5)
    .map((target) => {
      const availability =
        target.availability !== undefined ? `, ${target.availability}` : "";
      const source = target.source === "action" ? "from action" : "observed";
      return `- ${target.type} (${Math.round(target.distance)} tiles away, seen ${Math.round(target.ageTicks)} ticks ago, ${source}${availability})`;
    })
    .join("\n");

  const memoryLines = request.recentMemories
    .slice(0, 3)
    .map((m, i) => `${i + 1}. ${m.content}`)
    .join("\n");

  const goalLines = request.availableGoals
    .map((g, i) => `${i + 1}. ${g.id}: ${g.description}`)
    .join("\n");

  return [
    `You are ${request.npc.name}, an early human in an unfamiliar land. ${request.npc.description}`,
    `Personality: ${request.npc.personality ?? "Unknown"}`,
    WORLD_FRAMING,
    SURVIVAL_DEATH_RULE,
    "",
    "Current state:",
    needLines,
    "",
    `Inventory: ${invLine}`,
    "",
    "Nearby:",
    nearbyLines || "Nothing notable nearby.",
    "",
    "Remembered targets:",
    rememberedLines || "No useful remembered targets.",
    "",
    "Recent memories:",
    memoryLines || "None.",
    "",
    "Choose your next goal:",
    goalLines,
    "",
    'Reply as JSON: { "goalId": "...", "reasoning": "..." }',
  ].join("\n");
}
