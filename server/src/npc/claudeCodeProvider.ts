/**
 * NPC model provider that spawns the `claude` CLI as a subprocess.
 *
 * Each call runs `claude -p --output-format json` with the constructed
 * prompt. Multi-turn context is maintained via `--resume <sessionId>`.
 * The CLI is invoked with `--tools ""` and `--permission-mode dontAsk`
 * so it generates pure text without tool use or permission prompts.
 */
import { spawn } from "node:child_process";
import type {
  NpcGoalRequest,
  NpcGoalResponse,
  NpcModelProvider,
  NpcModelResponse,
  NpcReflectionRequest,
  NpcReplyRequest,
} from "./provider.js";
import { buildGoalSelectionPrompt, buildReflectionPrompt, buildReplyPrompt } from "./provider.js";

export interface ClaudeCodeProviderOptions {
  command?: string;
  model?: string;
  cwd?: string;
  maxTurns?: number;
}

export interface ClaudeCodeProcessErrorDetails {
  command: string;
  args: string[];
  cwd?: string;
  exitCode?: number | null;
  signal?: NodeJS.Signals | null;
  failureCode?: string;
  stdout?: string;
  stderr?: string;
}

interface ClaudeJsonResult {
  result?: string;
  session_id?: string;
  duration_ms?: number;
}

export class ClaudeCodeProcessError extends Error {
  readonly command: string;
  readonly args: string[];
  readonly cwd?: string;
  readonly exitCode?: number | null;
  readonly signal?: NodeJS.Signals | null;
  readonly failureCode?: string;
  readonly stdout?: string;
  readonly stderr?: string;

  constructor(message: string, details: ClaudeCodeProcessErrorDetails) {
    super(message);
    this.name = "ClaudeCodeProcessError";
    this.command = details.command;
    this.args = [...details.args];
    this.cwd = details.cwd;
    this.exitCode = details.exitCode;
    this.signal = details.signal;
    this.failureCode = details.failureCode;
    this.stdout = details.stdout;
    this.stderr = details.stderr;
  }
}

export class ClaudeCodeProvider implements NpcModelProvider {
  readonly name = "claude-code";
  private readonly command: string;
  private readonly model?: string;
  private readonly cwd?: string;
  private readonly maxTurns: number;

  constructor(options: ClaudeCodeProviderOptions = {}) {
    this.command = options.command ?? "claude";
    this.model = options.model;
    this.cwd = options.cwd;
    this.maxTurns = options.maxTurns ?? 1;
  }

  async generateReply(request: NpcReplyRequest): Promise<NpcModelResponse> {
    const prompt = buildReplyPrompt(request);
    return this.runPrompt(prompt, request.sessionId);
  }

  async generateReflection(
    request: NpcReflectionRequest,
  ): Promise<NpcModelResponse> {
    const prompt = buildReflectionPrompt(request);
    return this.runPrompt(prompt, request.sessionId);
  }

  async generateGoalSelection(
    request: NpcGoalRequest,
  ): Promise<NpcGoalResponse> {
    const prompt = buildGoalSelectionPrompt(request);
    const response = await this.runPrompt(prompt, request.sessionId);

    // Parse the JSON response
    let goalId = request.availableGoals[0]?.id ?? "satisfy_curiosity";
    let reasoning: string | undefined;
    try {
      const parsed = JSON.parse(response.content);
      if (parsed.goalId) goalId = parsed.goalId;
      if (parsed.reasoning) reasoning = parsed.reasoning;
    } catch {
      // If JSON parsing fails, try to extract goalId from text
      for (const goal of request.availableGoals) {
        if (response.content.includes(goal.id)) {
          goalId = goal.id;
          break;
        }
      }
    }

    return {
      goalId,
      reasoning,
      prompt,
      sessionId: response.sessionId,
      latencyMs: response.latencyMs,
    };
  }

  private async runPrompt(
    prompt: string,
    sessionId?: string,
  ): Promise<NpcModelResponse> {
    const args = [
      "-p",
      "--tools",
      "",
      "--permission-mode",
      "dontAsk",
      "--output-format",
      "json",
      "--max-turns",
      String(this.maxTurns),
    ];

    if (this.model) {
      args.push("--model", this.model);
    }
    if (sessionId) {
      args.push("--resume", sessionId);
    }
    args.push(prompt);

    const startedAt = Date.now();
    const rawOutput = await runProcess(this.command, args, this.cwd);
    const parsed = safeParseClaudeJson(rawOutput);

    return {
      content: normalizeModelText(parsed.result ?? rawOutput),
      prompt,
      sessionId: parsed.session_id ?? sessionId,
      rawOutput,
      latencyMs: parsed.duration_ms ?? Date.now() - startedAt,
    };
  }
}

async function runProcess(
  command: string,
  args: string[],
  cwd?: string,
): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd,
      env: process.env,
      stdio: ["ignore", "pipe", "pipe"],
    });

    let stdout = "";
    let stderr = "";

    child.stdout.on("data", (chunk) => {
      stdout += chunk.toString();
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk.toString();
    });
    child.on("error", (error) => {
      reject(
        new ClaudeCodeProcessError(
          `Failed to spawn Claude Code command "${command}": ${error.message}`,
          {
            command,
            args,
            cwd,
            failureCode: "code" in error ? String(error.code) : undefined,
            stdout: stdout.trim() || undefined,
            stderr: stderr.trim() || undefined,
          },
        ),
      );
    });
    child.on("close", (code, signal) => {
      if (code === 0) {
        resolve(stdout.trim());
        return;
      }
      const trimmedStdout = stdout.trim();
      const trimmedStderr = stderr.trim();
      const failureSummary =
        trimmedStderr || trimmedStdout || "process exited without output";
      reject(
        new ClaudeCodeProcessError(
          `Claude Code exited with code ${code}${signal ? ` (signal ${signal})` : ""}: ${failureSummary}`,
          {
            command,
            args,
            cwd,
            exitCode: code,
            signal,
            stdout: trimmedStdout || undefined,
            stderr: trimmedStderr || undefined,
          },
        ),
      );
    });
  });
}

function safeParseClaudeJson(rawOutput: string): ClaudeJsonResult {
  try {
    return JSON.parse(rawOutput) as ClaudeJsonResult;
  } catch {
    return {};
  }
}

function normalizeModelText(text: string): string {
  return text.replace(/\s+/g, " ").trim();
}
