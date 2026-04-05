import { spawn } from "node:child_process";

const DEFAULT_URLS = [
  "http://127.0.0.1:5173/debug.html",
  "http://localhost:5173/debug.html",
];
const DEFAULT_TIMEOUT_MS = 30_000;
const DEFAULT_INTERVAL_MS = 1_000;

function readNumberEnv(name, fallback) {
  const raw = process.env[name];
  if (!raw) return fallback;
  const parsed = Number.parseInt(raw, 10);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function getCandidateUrls() {
  if (process.env.DASHBOARD_URL) {
    return [process.env.DASHBOARD_URL];
  }
  return DEFAULT_URLS;
}

async function waitForAnyUrl(urls, timeoutMs, intervalMs) {
  const deadline = Date.now() + timeoutMs;

  while (Date.now() < deadline) {
    for (const url of urls) {
      try {
        const response = await fetch(url, { method: "GET" });
        if (response.ok) {
          return url;
        }
      } catch {
        // Dev server is not ready on this candidate yet.
      }
    }

    await sleep(intervalMs);
  }

  return null;
}

function getOpenCommand(url) {
  if (process.platform === "darwin") {
    return { command: "open", args: [url] };
  }

  if (process.platform === "win32") {
    return { command: "cmd", args: ["/c", "start", "", url] };
  }

  return { command: "xdg-open", args: [url] };
}

function launchBrowser(url) {
  const { command, args } = getOpenCommand(url);
  const child = spawn(command, args, {
    detached: true,
    stdio: "ignore",
  });
  child.unref();
}

async function main() {
  const urls = getCandidateUrls();
  const timeoutMs = readNumberEnv(
    "DASHBOARD_OPEN_TIMEOUT_MS",
    DEFAULT_TIMEOUT_MS,
  );
  const intervalMs = readNumberEnv(
    "DASHBOARD_OPEN_INTERVAL_MS",
    DEFAULT_INTERVAL_MS,
  );
  const dryRun = process.argv.includes("--dry-run");

  const readyUrl = await waitForAnyUrl(urls, timeoutMs, intervalMs);
  if (!readyUrl) {
    console.warn(
      `[open:dashboard] Timed out waiting for ${urls.join(" or ")}. Start it manually if needed.`,
    );
    return;
  }

  if (dryRun) {
    console.log(`[open:dashboard] Would open ${readyUrl}`);
    return;
  }

  try {
    launchBrowser(readyUrl);
    console.log(`[open:dashboard] Opened ${readyUrl}`);
  } catch (error) {
    console.warn(
      `[open:dashboard] Failed to launch browser for ${readyUrl}: ${
        error instanceof Error ? error.message : String(error)
      }`,
    );
  }
}

await main();
