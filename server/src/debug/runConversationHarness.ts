/**
 * CLI wrapper for the live conversation harness.
 *
 * Keeps bundle writing, scenario selection, and URL overrides outside the
 * harness runtime so `conversationHarness.ts` stays reusable from tests.
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { parseArgs } from "node:util";
import {
  type ConversationHarnessRunOptions,
  type ConversationHarnessScenarioName,
  formatConversationHarnessResult,
  listConversationHarnessScenarios,
  runConversationHarnessScenario,
} from "./conversationHarness.js";

const { values, positionals } = parseArgs({
  allowPositionals: true,
  options: {
    bundle: { type: "string" },
    scenario: { type: "string" },
    format: { type: "string" },
    list: { type: "boolean" },
    "base-url": { type: "string" },
    "ws-url": { type: "string" },
  },
});

if (values.list) {
  for (const scenario of listConversationHarnessScenarios()) {
    console.log(`${scenario.name}: ${scenario.description}`);
  }
  process.exit(0);
}

const requestedScenario = values.scenario ?? positionals[0];
if (!requestedScenario) {
  printUsage();
  process.exit(1);
}

const knownScenarios = new Set(
  listConversationHarnessScenarios().map((scenario) => scenario.name),
);

if (!knownScenarios.has(requestedScenario as ConversationHarnessScenarioName)) {
  console.error(`Unknown scenario: ${requestedScenario}`);
  console.error("");
  printUsage();
  process.exit(1);
}

const options = buildRunOptions(values["base-url"], values["ws-url"]);
const scenarioName = requestedScenario as ConversationHarnessScenarioName;
const result = await runConversationHarnessScenario(scenarioName, options);

if (values.bundle) {
  const bundlePath = resolve(values.bundle);
  mkdirSync(dirname(bundlePath), { recursive: true });
  writeFileSync(bundlePath, JSON.stringify(result, null, 2));
  console.error(`Saved harness bundle to ${bundlePath}`);
}

if (values.format === "json") {
  console.log(JSON.stringify(result, null, 2));
} else {
  console.log(formatConversationHarnessResult(result));
}

function buildRunOptions(
  baseUrl?: string,
  wsUrl?: string,
): ConversationHarnessRunOptions {
  if (!baseUrl && !wsUrl) {
    return {};
  }

  if (!baseUrl) {
    throw new Error("--ws-url requires --base-url");
  }

  return {
    baseUrl,
    wsUrl: wsUrl ?? deriveWsUrl(baseUrl),
  };
}

function deriveWsUrl(baseUrl: string): string {
  if (baseUrl.startsWith("https://")) {
    return `wss://${baseUrl.slice("https://".length)}`;
  }
  if (baseUrl.startsWith("http://")) {
    return `ws://${baseUrl.slice("http://".length)}`;
  }
  throw new Error(`Unsupported base URL: ${baseUrl}`);
}

function printUsage(): void {
  console.log(
    "Usage: npm run debug:conversation -- --scenario <name> [--format json] [--bundle path] [--base-url http://127.0.0.1:3001] [--ws-url ws://127.0.0.1:3001]",
  );
  console.log("       npm run debug:conversation -- --list");
}
