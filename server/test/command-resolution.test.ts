import { chmodSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { afterEach, describe, expect, it } from "vitest";
import {
  getConfiguredClaudeCommand,
  resolveCommandPath,
} from "../src/npc/commandResolution.js";

describe("commandResolution", () => {
  const tempDirs: string[] = [];

  afterEach(() => {
    while (tempDirs.length > 0) {
      const dir = tempDirs.pop();
      if (dir) {
        rmSync(dir, { recursive: true, force: true });
      }
    }
  });

  it("defaults to the bare claude command", () => {
    expect(getConfiguredClaudeCommand({})).toBe("claude");
  });

  it("uses the configured CLAUDE_COMMAND when provided", () => {
    expect(
      getConfiguredClaudeCommand({
        CLAUDE_COMMAND: "  /custom/bin/claude  ",
      }),
    ).toBe("/custom/bin/claude");
  });

  it("finds an executable on PATH", () => {
    const binDir = mkdtempSync(join(tmpdir(), "claude-bin-"));
    tempDirs.push(binDir);
    const executable = join(binDir, "claude");
    writeFileSync(executable, "#!/bin/sh\nexit 0\n");
    chmodSync(executable, 0o755);

    expect(resolveCommandPath("claude", binDir)).toBe(executable);
  });

  it("supports an absolute executable path", () => {
    const binDir = mkdtempSync(join(tmpdir(), "claude-abs-"));
    tempDirs.push(binDir);
    const executable = join(binDir, "claude");
    writeFileSync(executable, "#!/bin/sh\nexit 0\n");
    chmodSync(executable, 0o755);

    expect(resolveCommandPath(executable, "")).toBe(executable);
  });

  it("returns null when the command is missing", () => {
    expect(resolveCommandPath("claude", "/tmp/does-not-exist")).toBeNull();
  });
});
