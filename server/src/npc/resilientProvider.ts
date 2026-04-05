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
const DEFAULT_MAX_EVENTS = 25;

export interface ProviderErrorDetails {
  name: string;
  message: string;
  stack?: string;
  failureCode?: string;
  exitCode?: number | null;
  signal?: string | null;
  command?: string;
  args?: string[];
  cwd?: string;
  stdout?: string;
  stderr?: string;
}

export interface ProviderDiagnosticEvent {
  timestamp: string;
  phase: "reply" | "reflection" | "goal";
  outcome:
    | "primary_failure"
    | "fallback_used"
    | "primary_skipped"
    | "primary_recovered";
  message: string;
  primaryProvider: string;
  fallbackProvider: string;
  npcId?: string;
  partnerId?: string;
  conversationId?: number;
  cooldownRemainingMs?: number;
  error?: ProviderErrorDetails;
}

export interface ProviderDiagnosticsSnapshot {
  provider: string;
  primaryProvider: string;
  fallbackProvider: string;
  primaryAvailable: boolean;
  recoveryMs: number;
  primaryFailedAt?: string;
  nextRetryAt?: string;
  nextRetryInMs?: number;
  lastError?: ProviderErrorDetails;
  events: ProviderDiagnosticEvent[];
}

export interface NpcProviderDiagnosticsSource {
  getDiagnostics(): ProviderDiagnosticsSnapshot;
}

export class ResilientNpcProvider
  implements NpcModelProvider, NpcProviderDiagnosticsSource
{
  readonly name: string;
  private primaryFailedAt: number | null = null;
  private readonly recoveryMs: number;
  private readonly maxEvents: number;
  private readonly events: ProviderDiagnosticEvent[] = [];
  private lastError?: ProviderErrorDetails;

  constructor(
    private primary: NpcModelProvider,
    private fallback: NpcModelProvider,
    options?: { recoveryMs?: number; maxEvents?: number },
  ) {
    this.name = `${primary.name}|${fallback.name}`;
    this.recoveryMs = options?.recoveryMs ?? DEFAULT_RECOVERY_MS;
    this.maxEvents = options?.maxEvents ?? DEFAULT_MAX_EVENTS;
  }

  async generateReply(request: NpcReplyRequest): Promise<NpcModelResponse> {
    if (this.isPrimaryReady()) {
      const hadRecentFailure = this.primaryFailedAt !== null;
      try {
        const result = await this.primary.generateReply(request);
        if (hadRecentFailure) {
          const event = this.buildEvent(
            "reply",
            request,
            "primary_recovered",
            `Primary provider ${this.primary.name} recovered and handled a reply request.`,
          );
          this.recordEvent(event);
          console.info("NPC provider recovered:", event);
        }
        this.primaryFailedAt = null;
        return result;
      } catch (error) {
        this.primaryFailedAt = Date.now();
        this.lastError = toProviderErrorDetails(error);
        const failureEvent = this.buildEvent(
          "reply",
          request,
          "primary_failure",
          `Primary provider ${this.primary.name} failed during reply generation.`,
          { error: this.lastError },
        );
        this.recordEvent(failureEvent);
        console.warn("Primary NPC provider failed; falling back:", failureEvent);
        const fallbackResult = await this.fallback.generateReply(request);
        this.recordEvent(
          this.buildEvent(
            "reply",
            request,
            "fallback_used",
            `Fallback provider ${this.fallback.name} handled the reply request after primary failure.`,
          ),
        );
        return fallbackResult;
      }
    }
    const fallbackEvent = this.buildEvent(
      "reply",
      request,
      "primary_skipped",
      `Primary provider ${this.primary.name} is cooling down; using fallback ${this.fallback.name}.`,
      { cooldownRemainingMs: this.cooldownRemainingMs() },
    );
    this.recordEvent(fallbackEvent);
    return this.fallback.generateReply(request);
  }

  async generateReflection(
    request: NpcReflectionRequest,
  ): Promise<NpcModelResponse> {
    if (this.isPrimaryReady()) {
      const hadRecentFailure = this.primaryFailedAt !== null;
      try {
        const result = await this.primary.generateReflection(request);
        if (hadRecentFailure) {
          const event = this.buildEvent(
            "reflection",
            request,
            "primary_recovered",
            `Primary provider ${this.primary.name} recovered and handled a reflection request.`,
          );
          this.recordEvent(event);
          console.info("NPC provider recovered:", event);
        }
        this.primaryFailedAt = null;
        return result;
      } catch (error) {
        this.primaryFailedAt = Date.now();
        this.lastError = toProviderErrorDetails(error);
        const failureEvent = this.buildEvent(
          "reflection",
          request,
          "primary_failure",
          `Primary provider ${this.primary.name} failed during reflection generation.`,
          { error: this.lastError },
        );
        this.recordEvent(failureEvent);
        console.warn("Primary NPC provider failed; falling back:", failureEvent);
        const fallbackResult = await this.fallback.generateReflection(request);
        this.recordEvent(
          this.buildEvent(
            "reflection",
            request,
            "fallback_used",
            `Fallback provider ${this.fallback.name} handled the reflection request after primary failure.`,
          ),
        );
        return fallbackResult;
      }
    }
    this.recordEvent(
      this.buildEvent(
        "reflection",
        request,
        "primary_skipped",
        `Primary provider ${this.primary.name} is cooling down; using fallback ${this.fallback.name}.`,
        { cooldownRemainingMs: this.cooldownRemainingMs() },
      ),
    );
    return this.fallback.generateReflection(request);
  }

  async generateGoalSelection(
    request: NpcGoalRequest,
  ): Promise<NpcGoalResponse> {
    if (this.isPrimaryReady() && this.primary.generateGoalSelection) {
      const hadRecentFailure = this.primaryFailedAt !== null;
      try {
        const result = await this.primary.generateGoalSelection(request);
        if (hadRecentFailure) {
          const event = this.buildEvent(
            "goal",
            request,
            "primary_recovered",
            `Primary provider ${this.primary.name} recovered and handled a goal selection request.`,
          );
          this.recordEvent(event);
          console.info("NPC provider recovered:", event);
        }
        this.primaryFailedAt = null;
        return result;
      } catch (error) {
        this.primaryFailedAt = Date.now();
        this.lastError = toProviderErrorDetails(error);
        const failureEvent = this.buildEvent(
          "goal",
          request,
          "primary_failure",
          `Primary provider ${this.primary.name} failed during goal selection.`,
          { error: this.lastError },
        );
        this.recordEvent(failureEvent);
        console.warn(
          "Primary NPC provider failed goal selection; falling back:",
          failureEvent,
        );
      }
    }
    this.recordEvent(
      this.buildEvent(
        "goal",
        request,
        "fallback_used",
        `Fallback provider ${this.fallback.name} handled the goal selection request.`,
        { cooldownRemainingMs: this.cooldownRemainingMs() },
      ),
    );
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

  getDiagnostics(): ProviderDiagnosticsSnapshot {
    const nextRetryInMs = this.cooldownRemainingMs();
    return {
      provider: this.name,
      primaryProvider: this.primary.name,
      fallbackProvider: this.fallback.name,
      primaryAvailable: this.isPrimaryReady(),
      recoveryMs: this.recoveryMs,
      primaryFailedAt:
        this.primaryFailedAt !== null
          ? new Date(this.primaryFailedAt).toISOString()
          : undefined,
      nextRetryAt:
        this.primaryFailedAt !== null
          ? new Date(this.primaryFailedAt + this.recoveryMs).toISOString()
          : undefined,
      nextRetryInMs: nextRetryInMs !== undefined ? nextRetryInMs : undefined,
      lastError: this.lastError,
      events: [...this.events],
    };
  }

  private cooldownRemainingMs(): number | undefined {
    if (this.primaryFailedAt === null) {
      return undefined;
    }
    return Math.max(this.recoveryMs - (Date.now() - this.primaryFailedAt), 0);
  }

  private buildEvent(
    phase: ProviderDiagnosticEvent["phase"],
    request: NpcReplyRequest | NpcReflectionRequest | NpcGoalRequest,
    outcome: ProviderDiagnosticEvent["outcome"],
    message: string,
    extras: Pick<
      ProviderDiagnosticEvent,
      "cooldownRemainingMs" | "error"
    > = {},
  ): ProviderDiagnosticEvent {
    const context = getRequestContext(request);
    return {
      timestamp: new Date().toISOString(),
      phase,
      outcome,
      message,
      primaryProvider: this.primary.name,
      fallbackProvider: this.fallback.name,
      npcId: context.npcId,
      partnerId: context.partnerId,
      conversationId: context.conversationId,
      cooldownRemainingMs: extras.cooldownRemainingMs,
      error: extras.error,
    };
  }

  private recordEvent(event: ProviderDiagnosticEvent): void {
    this.events.push(event);
    if (this.events.length > this.maxEvents) {
      this.events.shift();
    }
  }
}

function getRequestContext(
  request: NpcReplyRequest | NpcReflectionRequest | NpcGoalRequest,
): {
  npcId?: string;
  partnerId?: string;
  conversationId?: number;
} {
  if ("conversationId" in request) {
    return {
      npcId: request.npc.id,
      partnerId: request.partner.id,
      conversationId: request.conversationId,
    };
  }
  return {
    npcId: request.npc.id,
  };
}

function toProviderErrorDetails(error: unknown): ProviderErrorDetails {
  if (error instanceof Error) {
    const details = error as Error & {
      failureCode?: string;
      exitCode?: number | null;
      signal?: string | null;
      command?: string;
      args?: string[];
      cwd?: string;
      stdout?: string;
      stderr?: string;
    };
    return {
      name: error.name,
      message: error.message,
      stack: error.stack,
      failureCode: details.failureCode,
      exitCode: details.exitCode,
      signal: details.signal,
      command: details.command,
      args: details.args ? [...details.args] : undefined,
      cwd: details.cwd,
      stdout: details.stdout,
      stderr: details.stderr,
    };
  }
  return {
    name: "NonError",
    message: String(error),
  };
}
