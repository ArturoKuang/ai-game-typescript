import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { parseArgs } from "node:util";
import {
  type MovementHarnessScenarioName,
  formatMovementHarnessResult,
  listMovementHarnessScenarios,
  runMovementHarnessScenario,
} from "./movementHarness.js";

const { values, positionals } = parseArgs({
  allowPositionals: true,
  options: {
    bundle: { type: "string" },
    scenario: { type: "string" },
    format: { type: "string" },
    list: { type: "boolean" },
  },
});

if (values.list) {
  for (const scenario of listMovementHarnessScenarios()) {
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
  listMovementHarnessScenarios().map((scenario) => scenario.name),
);

if (!knownScenarios.has(requestedScenario as MovementHarnessScenarioName)) {
  console.error(`Unknown scenario: ${requestedScenario}`);
  console.error("");
  printUsage();
  process.exit(1);
}

const scenarioName = requestedScenario as MovementHarnessScenarioName;
const result = runMovementHarnessScenario(scenarioName);
if (values.bundle) {
  const bundlePath = resolve(values.bundle);
  mkdirSync(dirname(bundlePath), { recursive: true });
  writeFileSync(bundlePath, JSON.stringify(result, null, 2));
  console.error(`Saved harness bundle to ${bundlePath}`);
}
if (values.format === "json") {
  console.log(JSON.stringify(result, null, 2));
} else {
  console.log(formatMovementHarnessResult(result));
}

function printUsage(): void {
  console.log(
    "Usage: npm run debug:movement -- --scenario <name> [--format json] [--bundle path]",
  );
  console.log("       npm run debug:movement -- --list");
}
