#!/usr/bin/env node
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

function parseArgs(argv) {
  const args = {
    clientUrl: "http://127.0.0.1:5173/",
    serverOrigin: "http://127.0.0.1:3002",
    joinName: "QA Browser",
    artifactsDir: path.resolve("artifacts", "qa", "autonomy-browser"),
    waitMs: 6000,
    scenario: "forced-needs",
  };

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    const next = argv[i + 1];
    if (arg === "--client-url" && next) {
      args.clientUrl = next;
      i++;
    } else if (arg === "--server-origin" && next) {
      args.serverOrigin = next.replace(/\/$/, "");
      i++;
    } else if (arg === "--join-name" && next) {
      args.joinName = next;
      i++;
    } else if (arg === "--artifacts-dir" && next) {
      args.artifactsDir = path.resolve(next);
      i++;
    } else if (arg === "--wait-ms" && next) {
      args.waitMs = Number.parseInt(next, 10);
      i++;
    } else if (arg === "--scenario" && next) {
      args.scenario = next;
      i++;
    }
  }

  return args;
}

async function importPlaywright() {
  const candidates = [
    process.env.PLAYWRIGHT_MODULE_PATH,
    "playwright",
    "/tmp/codex-visual-qa/node_modules/playwright/index.js",
    "/tmp/aitown-playwright/node_modules/playwright/index.js",
  ].filter(Boolean);

  for (const candidate of candidates) {
    try {
      return await import(candidate);
    } catch {
      // Try the next candidate.
    }
  }

  throw new Error(
    [
      "Unable to import Playwright.",
      "Set PLAYWRIGHT_MODULE_PATH or run the visualization QA bootstrap:",
      "PLAYWRIGHT_WORKDIR=/tmp/aitown-playwright ~/.codex/skills/visualization-qa/scripts/ensure_playwright.sh",
    ].join("\n"),
  );
}

function getChromium(playwrightModule) {
  return playwrightModule.chromium ?? playwrightModule.default?.chromium;
}

async function requestJson(url, init) {
  const response = await fetch(url, init);
  if (!response.ok) {
    throw new Error(`${response.status} ${response.statusText} for ${url}`);
  }
  return response.json();
}

async function forceScenario(serverOrigin, scenario) {
  if (scenario !== "forced-needs") return;

  const requests = [
    ["npc_alice", { hunger: 0, energy: 90, social: 90, safety: 100, curiosity: 90 }],
    ["npc_bob", { hunger: 90, energy: 0, social: 90, safety: 100, curiosity: 90 }],
    ["npc_carol", { hunger: 90, energy: 90, social: 0, safety: 100, curiosity: 90 }],
    ["npc_dave", { hunger: 90, energy: 90, social: 90, safety: 100, curiosity: 0 }],
  ];

  await Promise.all(
    requests.map(([npcId, body]) =>
      requestJson(`${serverOrigin}/api/debug/autonomy/${npcId}/needs`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      }),
    ),
  );
}

async function killBears(serverOrigin) {
  const bears = await requestJson(`${serverOrigin}/api/debug/bears`);
  await Promise.all(
    bears.map((bear) =>
      requestJson(`${serverOrigin}/api/debug/kill-bear`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ bearId: bear.id }),
      }).catch(() => undefined),
    ),
  );
}

async function collectReport(serverOrigin) {
  const [state, players, autonomy, entities, conversations] = await Promise.all([
    requestJson(`${serverOrigin}/api/debug/state`),
    requestJson(`${serverOrigin}/api/debug/players`),
    requestJson(`${serverOrigin}/api/debug/autonomy/state`),
    requestJson(`${serverOrigin}/api/debug/entities`),
    requestJson(`${serverOrigin}/api/debug/conversations`),
  ]);

  return { state, players, autonomy, entities, conversations };
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  await mkdir(args.artifactsDir, { recursive: true });

  await killBears(args.serverOrigin);
  await forceScenario(args.serverOrigin, args.scenario);

  const playwrightModule = await importPlaywright();
  const chromium = getChromium(playwrightModule);
  if (!chromium) {
    throw new Error("Playwright import succeeded, but chromium was unavailable.");
  }

  const browser = await chromium.launch({
    headless: true,
    args: [
      "--disable-web-security",
      "--disable-features=IsolateOrigins,site-per-process",
    ],
  });

  const page = await browser.newPage({ viewport: { width: 1440, height: 980 } });
  await page.addInitScript(({ serverOrigin }) => {
    const originalFetch = window.fetch.bind(window);
    window.fetch = (input, init) => {
      const url = typeof input === "string" ? input : input.url;
      if (url.startsWith("/api/") || url.startsWith("/data/")) {
        return originalFetch(serverOrigin + url, init);
      }
      return originalFetch(input, init);
    };

    const NativeWebSocket = window.WebSocket;
    class PatchedWebSocket extends NativeWebSocket {
      constructor(url, protocols) {
        const rewritten =
          typeof url === "string"
            ? url.replace(/:\d+$/, `:${new URL(serverOrigin).port}`)
            : url;
        super(rewritten, protocols);
      }
    }
    Object.defineProperty(window, "WebSocket", { value: PatchedWebSocket });
  }, { serverOrigin: args.serverOrigin });

  await page.goto(args.clientUrl, { waitUntil: "networkidle" });
  await page.fill("#name-input", args.joinName);
  await page.click("#join-btn");
  await page.waitForTimeout(args.waitMs);

  const screenshotPath = path.join(args.artifactsDir, "game.png");
  await page.screenshot({ path: screenshotPath, fullPage: true });

  const ui = {
    statusBar: await page.locator("#status-bar").textContent(),
    playerList: await page.locator("#player-list").innerText(),
    conversationPanel: await page.locator("#conversation-panel").innerText(),
    transcript: await page.locator("#chat-messages").innerText(),
  };

  await browser.close();

  const report = {
    config: args,
    ui,
    debug: await collectReport(args.serverOrigin),
    screenshotPath,
    createdAt: new Date().toISOString(),
  };

  const reportPath = path.join(args.artifactsDir, "report.json");
  await writeFile(reportPath, JSON.stringify(report, null, 2));

  console.log(JSON.stringify({ screenshotPath, reportPath }, null, 2));
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
