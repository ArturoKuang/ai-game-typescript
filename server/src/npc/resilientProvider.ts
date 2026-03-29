import type {
  NpcModelProvider,
  NpcModelResponse,
  NpcReflectionRequest,
  NpcReplyRequest,
} from "./provider.js";

export class ResilientNpcProvider implements NpcModelProvider {
  readonly name: string;
  private primaryAvailable = true;

  constructor(
    private primary: NpcModelProvider,
    private fallback: NpcModelProvider,
  ) {
    this.name = `${primary.name}|${fallback.name}`;
  }

  async generateReply(request: NpcReplyRequest): Promise<NpcModelResponse> {
    if (!this.primaryAvailable) {
      return this.fallback.generateReply(request);
    }
    try {
      return await this.primary.generateReply(request);
    } catch (error) {
      this.primaryAvailable = false;
      console.warn("Primary NPC provider failed; falling back:", error);
      return this.fallback.generateReply(request);
    }
  }

  async generateReflection(
    request: NpcReflectionRequest,
  ): Promise<NpcModelResponse> {
    if (!this.primaryAvailable) {
      return this.fallback.generateReflection(request);
    }
    try {
      return await this.primary.generateReflection(request);
    } catch (error) {
      this.primaryAvailable = false;
      console.warn("Primary NPC provider failed; falling back:", error);
      return this.fallback.generateReflection(request);
    }
  }
}
