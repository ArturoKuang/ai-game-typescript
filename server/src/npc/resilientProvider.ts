import type {
  NpcModelProvider,
  NpcModelResponse,
  NpcReflectionRequest,
  NpcReplyRequest,
} from "./provider.js";

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

  private isPrimaryReady(): boolean {
    if (this.primaryFailedAt === null) return true;
    return Date.now() - this.primaryFailedAt > this.recoveryMs;
  }
}
