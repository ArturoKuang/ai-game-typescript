import { accessSync, constants } from "node:fs";
import { delimiter, isAbsolute, join } from "node:path";

export function getConfiguredClaudeCommand(
  env: NodeJS.ProcessEnv = process.env,
): string {
  const configured = env.CLAUDE_COMMAND?.trim();
  return configured && configured.length > 0 ? configured : "claude";
}

export function resolveCommandPath(
  command: string,
  pathEnv: string | undefined = process.env.PATH,
): string | null {
  if (!command) {
    return null;
  }

  if (isAbsolute(command)) {
    return isExecutable(command) ? command : null;
  }

  const searchPaths = (pathEnv ?? "")
    .split(delimiter)
    .map((entry) => entry.trim())
    .filter(Boolean);
  for (const dir of searchPaths) {
    const candidate = join(dir, command);
    if (isExecutable(candidate)) {
      return candidate;
    }
  }
  return null;
}

function isExecutable(candidate: string): boolean {
  try {
    accessSync(candidate, constants.X_OK);
    return true;
  } catch {
    return false;
  }
}
