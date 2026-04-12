import type {
  CommandStatusKind,
  DashboardState,
} from "./debugDashboardTypes.js";
import type { GameClient } from "./network.js";

type LocationLike = Pick<Location, "protocol" | "hostname">;
type StorageLike = Pick<Storage, "removeItem" | "setItem">;

function resolveLocation(locationLike?: LocationLike): LocationLike {
  return locationLike ?? window.location;
}

export function getHttpServerBaseUrl(locationLike?: LocationLike): string {
  const location = resolveLocation(locationLike);
  const protocol = location.protocol === "https:" ? "https:" : "http:";
  return `${protocol}//${location.hostname}:3001`;
}

export function buildDebugUrl(params: {
  path: string;
  debugToken: string | null;
  query?: Record<string, string | number | undefined>;
  locationLike?: LocationLike;
}): string {
  const url = new URL(
    `/api/debug${params.path}`,
    getHttpServerBaseUrl(params.locationLike),
  );
  for (const [key, value] of Object.entries(params.query ?? {})) {
    if (value === undefined || value === "") continue;
    url.searchParams.set(key, String(value));
  }
  if (params.debugToken) {
    url.searchParams.set("debugToken", params.debugToken);
  }
  return url.toString();
}

export function buildDebugHeaders(params: {
  debugToken: string | null;
  json?: boolean;
}): HeadersInit {
  const headers: HeadersInit = {};
  if (params.json !== false) {
    headers["Content-Type"] = "application/json";
  }
  if (params.debugToken) {
    headers["x-debug-token"] = params.debugToken;
  }
  return headers;
}

export async function debugFetch<T>(params: {
  path: string;
  debugToken: string | null;
  init?: RequestInit;
  fetchImpl?: typeof fetch;
  locationLike?: LocationLike;
}): Promise<T> {
  const fetchImpl = params.fetchImpl ?? fetch;
  const response = await fetchImpl(
    buildDebugUrl({
      path: params.path,
      debugToken: params.debugToken,
      locationLike: params.locationLike,
    }),
    {
      ...params.init,
      headers: {
        ...buildDebugHeaders({
          debugToken: params.debugToken,
          json:
            params.init?.body !== undefined || params.init?.method === "POST",
        }),
        ...(params.init?.headers ?? {}),
      },
    },
  );
  if (!response.ok) {
    const payload = (await response.json().catch(() => null)) as {
      error?: string;
    } | null;
    throw new Error(payload?.error ?? `Request failed (${response.status})`);
  }
  return (await response.json()) as T;
}

export function buildScreenshotUrl(params: {
  clientId?: string;
  debugToken: string | null;
  locationLike?: LocationLike;
  timestamp?: number;
}): string | null {
  if (!params.clientId) {
    return null;
  }
  return buildDebugUrl({
    path: "/screenshot",
    debugToken: params.debugToken,
    locationLike: params.locationLike,
    query: {
      clientId: params.clientId,
      ts: params.timestamp ?? Date.now(),
    },
  });
}

export async function refreshScenarioList(params: {
  state: DashboardState;
  scheduleRender: (immediate?: boolean) => void;
  fetchImpl?: typeof fetch;
  locationLike?: LocationLike;
}): Promise<void> {
  try {
    const scenarios = await debugFetch<Array<{ name: string }>>({
      path: "/scenarios",
      debugToken: params.state.debugToken,
      init: { method: "GET" },
      fetchImpl: params.fetchImpl,
      locationLike: params.locationLike,
    });
    params.state.scenarios = scenarios.map((scenario) => scenario.name);
    params.scheduleRender(true);
  } catch {
    params.state.scenarios = [];
  }
}

interface SystemCommandContext {
  state: DashboardState;
  client: Pick<GameClient, "send">;
  setCommandStatus: (kind: CommandStatusKind, message: string) => void;
  setScreenshotUrl: (url: string | null) => void;
  refreshScenarioList: () => Promise<void>;
  fetchImpl?: typeof fetch;
  locationLike?: LocationLike;
  storage?: StorageLike;
}

function getStorage(storage?: StorageLike): StorageLike {
  return storage ?? window.localStorage;
}

export async function handleSystemCommand(
  context: SystemCommandContext,
  command: string,
  dataset: DOMStringMap,
): Promise<void> {
  try {
    context.setCommandStatus("running", "Running command...");
    switch (command) {
      case "tick":
        await debugFetch({
          path: "/tick",
          debugToken: context.state.debugToken,
          fetchImpl: context.fetchImpl,
          locationLike: context.locationLike,
          init: {
            method: "POST",
            body: JSON.stringify({
              count: Number.parseInt(dataset.count ?? "1", 10) || 1,
            }),
          },
        });
        context.setCommandStatus(
          "success",
          `Advanced ${dataset.count ?? "1"} tick(s).`,
        );
        return;
      case "reset":
        await debugFetch({
          path: "/reset",
          debugToken: context.state.debugToken,
          fetchImpl: context.fetchImpl,
          locationLike: context.locationLike,
          init: { method: "POST" },
        });
        context.setCommandStatus("success", "Simulation reset.");
        return;
      case "mode":
        await debugFetch({
          path: "/mode",
          debugToken: context.state.debugToken,
          fetchImpl: context.fetchImpl,
          locationLike: context.locationLike,
          init: {
            method: "POST",
            body: JSON.stringify({ mode: dataset.mode }),
          },
        });
        if (
          context.state.system &&
          (dataset.mode === "stepped" || dataset.mode === "realtime")
        ) {
          context.state.system = {
            ...context.state.system,
            mode: dataset.mode,
          };
        }
        context.setCommandStatus(
          "success",
          `Simulation mode set to ${dataset.mode}.`,
        );
        return;
      case "capture": {
        const result = await debugFetch<{
          clientId: string;
          capturedAt: string;
        }>({
          path: "/capture-screenshot",
          debugToken: context.state.debugToken,
          fetchImpl: context.fetchImpl,
          locationLike: context.locationLike,
          init: {
            method: "POST",
            body: JSON.stringify({ clientId: dataset.clientId }),
          },
        });
        if (context.state.system) {
          context.state.system = {
            ...context.state.system,
            lastScreenshot: {
              clientId: result.clientId,
              capturedAt: result.capturedAt,
            },
          };
        }
        context.setScreenshotUrl(
          buildScreenshotUrl({
            clientId: result.clientId,
            debugToken: context.state.debugToken,
            locationLike: context.locationLike,
          }),
        );
        context.setCommandStatus(
          "success",
          `Captured screenshot from ${result.clientId}.`,
        );
        return;
      }
      default:
        context.setCommandStatus("error", `Unknown command: ${command}`);
    }
  } catch (error) {
    context.setCommandStatus(
      "error",
      error instanceof Error ? error.message : "Command failed",
    );
  }
}

export async function handleSystemFormSubmit(
  context: SystemCommandContext,
  formId: string,
  data: FormData,
): Promise<void> {
  try {
    context.setCommandStatus("running", "Running command...");
    switch (formId) {
      case "tick-form":
        await debugFetch({
          path: "/tick",
          debugToken: context.state.debugToken,
          fetchImpl: context.fetchImpl,
          locationLike: context.locationLike,
          init: {
            method: "POST",
            body: JSON.stringify({
              count: Number.parseInt(String(data.get("count") ?? "1"), 10) || 1,
            }),
          },
        });
        context.setCommandStatus("success", "Advanced simulation.");
        return;
      case "scenario-form":
        await debugFetch({
          path: "/scenario",
          debugToken: context.state.debugToken,
          fetchImpl: context.fetchImpl,
          locationLike: context.locationLike,
          init: {
            method: "POST",
            body: JSON.stringify({ name: String(data.get("scenario") ?? "") }),
          },
        });
        context.setCommandStatus(
          "success",
          `Loaded scenario ${String(data.get("scenario") ?? "")}.`,
        );
        return;
      case "spawn-form":
        await debugFetch({
          path: "/spawn",
          debugToken: context.state.debugToken,
          fetchImpl: context.fetchImpl,
          locationLike: context.locationLike,
          init: {
            method: "POST",
            body: JSON.stringify({
              id: String(data.get("id") ?? "").trim(),
              name: String(data.get("name") ?? "").trim(),
              x: Number.parseFloat(String(data.get("x") ?? "0")),
              y: Number.parseFloat(String(data.get("y") ?? "0")),
              isNpc: data.get("isNpc") === "on",
            }),
          },
        });
        context.setCommandStatus(
          "success",
          `Spawned ${String(data.get("name") ?? "player")}.`,
        );
        return;
      case "start-convo-form":
        await debugFetch({
          path: "/start-convo",
          debugToken: context.state.debugToken,
          fetchImpl: context.fetchImpl,
          locationLike: context.locationLike,
          init: {
            method: "POST",
            body: JSON.stringify({
              player1Id: String(data.get("player1Id") ?? "").trim(),
              player2Id: String(data.get("player2Id") ?? "").trim(),
            }),
          },
        });
        context.setCommandStatus("success", "Conversation started.");
        return;
      case "token-form": {
        const token = String(data.get("token") ?? "").trim();
        context.state.debugToken = token || null;
        const storage = getStorage(context.storage);
        if (context.state.debugToken) {
          storage.setItem("ai-town-debug-token", context.state.debugToken);
        } else {
          storage.removeItem("ai-town-debug-token");
        }
        if (context.state.connected) {
          context.client.send({
            type: "subscribe_debug",
            data: context.state.debugToken
              ? { token: context.state.debugToken }
              : undefined,
          });
        }
        context.setScreenshotUrl(
          buildScreenshotUrl({
            clientId: context.state.system?.lastScreenshot?.clientId,
            debugToken: context.state.debugToken,
            locationLike: context.locationLike,
          }),
        );
        void context.refreshScenarioList();
        context.setCommandStatus(
          "success",
          context.state.debugToken
            ? "Debug token saved."
            : "Debug token cleared.",
        );
        return;
      }
      default:
        context.setCommandStatus("error", `Unhandled form ${formId}`);
    }
  } catch (error) {
    context.setCommandStatus(
      "error",
      error instanceof Error ? error.message : "Command failed",
    );
  }
}
