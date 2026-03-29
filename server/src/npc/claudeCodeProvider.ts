import { spawn } from "node:child_process";
import type {
  NpcModelProvider,
  NpcModelResponse,
  NpcReflectionRequest,
  NpcReplyRequest,
} from "./provider.js";
import { buildReflectionPrompt, buildReplyPrompt } from "./provider.js";

export interface ClaudeCodeProviderOptions {
  command?: string;
  model?: string;
  cwd?: string;
  maxTurns?: number;
}

interface ClaudeJsonResult {
  result?: string;
  session_id?: string;
  duration_ms?: number;
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
      reject(error);
    });
    child.on("close", (code) => {
      if (code === 0) {
        resolve(stdout.trim());
        return;
      }
      reject(
        new Error(
          `Claude Code exited with code ${code}: ${stderr.trim() || stdout.trim()}`,
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
