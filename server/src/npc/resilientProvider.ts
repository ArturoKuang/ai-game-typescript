/**
 * Resilient wrapper around a primary + fallback NPC model provider.
 *
 * On primary failure, marks it as unavailable and uses the fallback.
 * The primary is re-tried after `recoveryMs` (default 30 s). A single
 * successful primary call clears the failure state.
 */
import type {
  NpcGoalRequest,
  NpcGoalResponse,
  NpcModelProvider,
  NpcModelResponse,
  NpcReflectionRequest,
  NpcReplyRequest,
} from "./provider.js";

/** How long to wait before retrying the primary provider after a failure. */
const DEFAULT_RECOVERY_MS = 30_000;

export class ResilientNpcProvider implements NpcModelProvider {
  readonly name: string;
  private primaryFailedAt: number | null = null;
  private recoveryMs: number;

  constructor(
    private primary: NpcModelProvider,
    private fallback: NpcModelProvider,
    options?: { recoveryMs?: number },
  ) {
    this.name = `${primary.name}|${fallback.name}`;
    this.recoveryMs = options?.recoveryMs ?? DEFAULT_RECOVERY_MS;
  }

  async generateReply(request: NpcReplyRequest): Promise<NpcModelResponse> {
    if (this.isPrimaryReady()) {
      try {
        const result = await this.primary.generateReply(request);
        this.primaryFailedAt = null;
        return result;
      } catch (error) {
        this.primaryFailedAt = Date.now();
        console.warn("Primary NPC provider failed; falling back:", error);
        return this.fallback.generateReply(request);
      }
    }
    return this.fallback.generateReply(request);
  }

  async generateReflection(
    request: NpcReflectionRequest,
  ): Promise<NpcModelResponse> {
    if (this.isPrimaryReady()) {
      try {
        const result = await this.primary.generateReflection(request);
        this.primaryFailedAt = null;
        return result;
      } catch (error) {
        this.primaryFailedAt = Date.now();
        console.warn("Primary NPC provider failed; falling back:", error);
        return this.fallback.generateReflection(request);
      }
    }
    return this.fallback.generateReflection(request);
  }

  async generateGoalSelection(
    request: NpcGoalRequest,
  ): Promise<NpcGoalResponse> {
    if (this.isPrimaryReady() && this.primary.generateGoalSelection) {
      try {
        const result = await this.primary.generateGoalSelection(request);
        this.primaryFailedAt = null;
        return result;
      } catch (error) {
        this.primaryFailedAt = Date.now();
        console.warn("Primary NPC provider failed goal selection; falling back:", error);
      }
    }
    if (this.fallback.generateGoalSelection) {
      return this.fallback.generateGoalSelection(request);
    }
    // Absolute fallback: pick first goal
    return {
      goalId: request.availableGoals[0]?.id ?? "satisfy_curiosity",
      prompt: "",
      latencyMs: 0,
    };
  }

  private isPrimaryReady(): boolean {
    if (this.primaryFailedAt === null) return true;
    return Date.now() - this.primaryFailedAt > this.recoveryMs;
  }
}
