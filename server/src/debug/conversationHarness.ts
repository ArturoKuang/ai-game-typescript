/**
 * Live conversation harness for end-to-end protocol verification.
 *
 * Unlike `movementHarness.ts`, this module exercises the real server surface
 * area: it can boot `server/src/index.ts`, connect real WebSocket clients,
 * drive client messages, and inspect the resulting state through `/api/debug`.
 * That makes it the main verification tool for conversation state changes,
 * NPC orchestration, and message visibility rules.
 */
import { type ChildProcessWithoutNullStreams, spawn } from "node:child_process";
import { createServer } from "node:net";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { WebSocket } from "ws";
import type { GameEvent } from "../engine/types.js";
import type { ClientMessage, ServerMessage } from "../network/protocol.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const SERVER_ROOT = resolve(__dirname, "..", "..");
const TSX_BIN = resolve(
  SERVER_ROOT,
  "node_modules",
  ".bin",
  process.platform === "win32" ? "tsx.cmd" : "tsx",
);
const SERVER_ENTRY = resolve(SERVER_ROOT, "src", "index.ts");
const DEFAULT_TIMEOUT_MS = 10_000;
const CONVERSATION_LOG_TYPES =
  "convo_started,convo_accepted,convo_active,convo_ended,convo_message";

interface DebugState {
  tick: number;
  mode: string;
  tickRate: number;
  playerCount: number;
  world: { width: number; height: number } | null;
}

interface DebugPlayer {
  id: string;
  name: string;
  x: number;
  y: number;
  state: string;
  isNpc: boolean;
}

/** One connected harness-controlled WebSocket client plus its observed traffic. */
interface HarnessClient {
  label: string;
  ws: WebSocket;
  messages: ServerMessage[];
  playerId: string;
}

/** Handle for a server process launched by the harness when no external URL is provided. */
interface ManagedServerHandle {
  process: ChildProcessWithoutNullStreams;
  baseUrl: string;
  wsUrl: string;
  port: number;
  stdout: string[];
  stderr: string[];
}

/** Transcript rows are derived from WebSocket `message` events after a scenario finishes. */
export interface ConversationHarnessTranscriptEntry {
  messageId: number;
  convoId: number;
  senderId: string;
  recipientLabel: string;
  content: string;
  tick: number;
}

/** Full bundle emitted by the harness for CLI output, saved artifacts, and tests. */
export interface ConversationHarnessResult {
  scenario: ConversationHarnessScenarioName;
  description: string;
  baseUrl: string;
  wsUrl: string;
  startTick: number;
  endTick: number;
  summary: Record<string, string | number | boolean | null>;
  transcript: ConversationHarnessTranscriptEntry[];
  debugLog: GameEvent[];
  asciiMap: string;
}

/** Scenario contract: drive the runtime and return a compact summary plus optional transcript. */
export interface ConversationHarnessScenario {
  description: string;
  run: (runtime: ConversationHarnessRuntime) => Promise<{
    summary: Record<string, string | number | boolean | null>;
    transcript?: ConversationHarnessTranscriptEntry[];
  }>;
}

/** Optional external endpoints; if omitted the harness boots and manages its own server. */
export interface ConversationHarnessRunOptions {
  baseUrl?: string;
  wsUrl?: string;
}

/**
 * Scenario runtime wrapper around the real HTTP + WebSocket surfaces.
 *
 * The harness keeps the control flow intentionally small: scenarios send the
 * same messages as the browser client, then wait on either socket traffic or
 * `/api/debug` state until the expected transition happens.
 */
export class ConversationHarnessRuntime {
  private readonly managedServer?: ManagedServerHandle;
  private readonly clients: HarnessClient[] = [];

  private constructor(
    readonly baseUrl: string,
    readonly wsUrl: string,
    managedServer?: ManagedServerHandle,
  ) {
    this.managedServer = managedServer;
  }

  static async create(
    options: ConversationHarnessRunOptions = {},
  ): Promise<ConversationHarnessRuntime> {
    if (options.baseUrl && options.wsUrl) {
      return new ConversationHarnessRuntime(options.baseUrl, options.wsUrl);
    }

    const managedServer = await startManagedServer();
    return new ConversationHarnessRuntime(
      managedServer.baseUrl,
      managedServer.wsUrl,
      managedServer,
    );
  }

  async dispose(): Promise<void> {
    for (const client of this.clients) {
      if (client.ws.readyState === WebSocket.OPEN) {
        client.ws.close();
      }
    }

    if (!this.managedServer) {
      return;
    }

    await new Promise<void>((resolve) => {
      this.managedServer!.process.once("exit", () => resolve());
      this.managedServer!.process.kill("SIGTERM");
      setTimeout(() => {
        if (!this.managedServer!.process.killed) {
          this.managedServer!.process.kill("SIGKILL");
        }
      }, 2_000);
    });
  }

  async currentTick(): Promise<number> {
    const state = await this.getState();
    return state.tick;
  }

  async connectHuman(label: string): Promise<HarnessClient> {
    const ws = new WebSocket(this.wsUrl);
    const messages: ServerMessage[] = [];
    const pendingClient = { label, messages };
    ws.on("message", (raw) => {
      messages.push(JSON.parse(raw.toString()) as ServerMessage);
    });
    await waitForWebSocketOpen(ws);

    const clientState = await waitForServerMessage(
      pendingClient,
      (message) => message.type === "state",
    );
    void clientState;

    ws.send(JSON.stringify({ type: "join", data: { name: label } }));
    const joinMessage = await waitForServerMessage(
      pendingClient,
      (message): message is Extract<ServerMessage, { type: "player_joined" }> =>
        message.type === "player_joined" && message.data.name === label,
    );

    const client: HarnessClient = {
      label,
      ws,
      messages,
      playerId: joinMessage.data.id,
    };
    await this.waitForPlayer(client.playerId, () => true);
    this.clients.push(client);
    return client;
  }

  send(client: HarnessClient, message: ClientMessage): void {
    client.ws.send(JSON.stringify(message));
  }

  async moveTo(
    client: HarnessClient,
    x: number,
    y: number,
    timeoutMs = DEFAULT_TIMEOUT_MS,
  ): Promise<DebugPlayer> {
    this.send(client, { type: "move", data: { x, y } });
    return this.waitForPlayer(
      client.playerId,
      (player) =>
        Math.round(player.x) === x &&
        Math.round(player.y) === y &&
        player.state === "idle",
      timeoutMs,
    );
  }

  async waitForPlayer(
    playerId: string,
    predicate: (player: DebugPlayer) => boolean,
    timeoutMs = DEFAULT_TIMEOUT_MS,
  ): Promise<DebugPlayer> {
    const startedAt = Date.now();
    while (Date.now() - startedAt < timeoutMs) {
      const player = await this.getPlayer(playerId);
      if (player && predicate(player)) {
        return player;
      }
      await wait(100);
    }
    throw new Error(`Timed out waiting for player ${playerId}`);
  }

  async waitForConversationState(
    client: HarnessClient,
    state: "invited" | "walking" | "active" | "ended",
    predicate: (
      message: Extract<ServerMessage, { type: "convo_update" }>,
    ) => boolean,
    timeoutMs = DEFAULT_TIMEOUT_MS,
  ): Promise<Extract<ServerMessage, { type: "convo_update" }>> {
    return waitForServerMessage(
      client,
      (message): message is Extract<ServerMessage, { type: "convo_update" }> =>
        message.type === "convo_update" &&
        message.data.state === state &&
        predicate(message),
      timeoutMs,
    );
  }

  async waitForChatMessage(
    client: HarnessClient,
    predicate: (
      message: Extract<ServerMessage, { type: "message" }>,
    ) => boolean,
    timeoutMs = DEFAULT_TIMEOUT_MS,
  ): Promise<Extract<ServerMessage, { type: "message" }>> {
    return waitForServerMessage(
      client,
      (message): message is Extract<ServerMessage, { type: "message" }> =>
        message.type === "message" && predicate(message),
      timeoutMs,
    );
  }

  async waitForNoConversationUpdates(
    client: HarnessClient,
    durationMs: number,
    predicate: (
      message: Extract<ServerMessage, { type: "convo_update" }>,
    ) => boolean,
  ): Promise<number> {
    const before = client.messages.filter(
      (message) => message.type === "convo_update" && predicate(message),
    ).length;
    await wait(durationMs);
    const after = client.messages.filter(
      (message) => message.type === "convo_update" && predicate(message),
    ).length;
    return after - before;
  }

  async getState(): Promise<DebugState> {
    return fetchJson<DebugState>(`${this.baseUrl}/api/debug/state`);
  }

  async getPlayer(playerId: string): Promise<DebugPlayer | undefined> {
    const response = await fetch(
      `${this.baseUrl}/api/debug/players/${playerId}`,
    );
    if (response.status === 404) {
      return undefined;
    }
    if (!response.ok) {
      throw new Error(`Failed to fetch player ${playerId}: ${response.status}`);
    }
    return (await response.json()) as DebugPlayer;
  }

  async getDebugLog(sinceTick: number): Promise<GameEvent[]> {
    return fetchJson<GameEvent[]>(
      `${this.baseUrl}/api/debug/log?type=${CONVERSATION_LOG_TYPES}&since=${sinceTick}&limit=200`,
    );
  }

  async getAsciiMap(): Promise<string> {
    const response = await fetch(`${this.baseUrl}/api/debug/map?format=ascii`);
    if (!response.ok) {
      throw new Error(`Failed to fetch ASCII map: ${response.status}`);
    }
    return response.text();
  }
}

const CONVERSATION_HARNESS_SCENARIOS: Record<
  string,
  ConversationHarnessScenario
> = {
  human_to_npc_conversation: {
    description:
      "Connect one human, start a conversation with npc_kael, and wait for the NPC reply.",
    run: async (runtime) => {
      const human = await runtime.connectHuman("Harness Alice");
      await runtime.moveTo(human, 4, 3);

      runtime.send(human, {
        type: "start_convo",
        data: { targetId: "npc_kael" },
      });
      const active = await runtime.waitForConversationState(
        human,
        "active",
        (message) =>
          message.data.player1Id === human.playerId ||
          message.data.player2Id === human.playerId,
      );

      runtime.send(human, { type: "say", data: { content: "Hello there." } });
      const npcReply = await runtime.waitForChatMessage(
        human,
        (message) =>
          message.data.convoId === active.data.id &&
          message.data.playerId === "npc_kael",
      );

      return {
        summary: {
          convoId: active.data.id,
          activeState: active.data.state,
          npcReplyObserved: true,
          npcReplyTick: npcReply.data.tick,
        },
        transcript: collectTranscript(active.data.id, [human]),
      };
    },
  },
  npc_to_human_conversation: {
    description:
      "Connect one human near npc_kael and wait for NPC initiation after the join grace window.",
    run: async (runtime) => {
      const human = await runtime.connectHuman("Harness Human");
      await runtime.moveTo(human, 4, 3);

      const active = await runtime.waitForConversationState(
        human,
        "active",
        (message) =>
          message.data.player1Id === "npc_kael" ||
          message.data.player2Id === "npc_kael",
        12_000,
      );
      const firstNpcMessage = await runtime.waitForChatMessage(
        human,
        (message) =>
          message.data.convoId === active.data.id &&
          message.data.playerId === "npc_kael",
        12_000,
      );

      return {
        summary: {
          convoId: active.data.id,
          initiator: "npc_kael",
          activeState: active.data.state,
          npcReplyObserved: true,
          firstNpcMessageTick: firstNpcMessage.data.tick,
        },
        transcript: collectTranscript(active.data.id, [human]),
      };
    },
  },
  human_to_human_accept: {
    description:
      "Connect two humans, accept an invite over the live socket protocol, exchange messages, and end cleanly.",
    run: async (runtime) => {
      const alice = await runtime.connectHuman("Harness Alice");
      const bob = await runtime.connectHuman("Harness Bob");

      runtime.send(alice, {
        type: "start_convo",
        data: { targetId: bob.playerId },
      });
      const invite = await runtime.waitForConversationState(
        bob,
        "invited",
        (message) => message.data.player1Id === alice.playerId,
      );

      runtime.send(bob, {
        type: "accept_convo",
        data: { convoId: invite.data.id },
      });
      const active = await runtime.waitForConversationState(
        alice,
        "active",
        (message) => message.data.id === invite.data.id,
      );

      runtime.send(alice, { type: "say", data: { content: "hello bob" } });
      await runtime.waitForChatMessage(
        bob,
        (message) =>
          message.data.convoId === active.data.id &&
          message.data.playerId === alice.playerId &&
          message.data.content === "hello bob",
      );
      runtime.send(bob, { type: "say", data: { content: "hello alice" } });
      await runtime.waitForChatMessage(
        alice,
        (message) =>
          message.data.convoId === active.data.id &&
          message.data.playerId === bob.playerId &&
          message.data.content === "hello alice",
      );

      runtime.send(alice, { type: "end_convo" });
      const ended = await runtime.waitForConversationState(
        alice,
        "ended",
        (message) => message.data.id === active.data.id,
      );

      return {
        summary: {
          convoId: active.data.id,
          accepted: true,
          endedReason: ended.data.endedReason ?? null,
          transcriptMessages: collectTranscript(active.data.id, [alice, bob])
            .length,
        },
        transcript: collectTranscript(active.data.id, [alice, bob]),
      };
    },
  },
  human_to_human_decline: {
    description:
      "Connect two humans, decline an invite over the live socket protocol, and confirm the ended reason.",
    run: async (runtime) => {
      const alice = await runtime.connectHuman("Harness Alice");
      const bob = await runtime.connectHuman("Harness Bob");

      runtime.send(alice, {
        type: "start_convo",
        data: { targetId: bob.playerId },
      });
      const invite = await runtime.waitForConversationState(
        bob,
        "invited",
        (message) => message.data.player1Id === alice.playerId,
      );

      runtime.send(bob, {
        type: "decline_convo",
        data: { convoId: invite.data.id },
      });
      const ended = await runtime.waitForConversationState(
        alice,
        "ended",
        (message) =>
          message.data.id === invite.data.id &&
          message.data.endedReason === "declined",
      );

      return {
        summary: {
          convoId: invite.data.id,
          declined: true,
          endedReason: ended.data.endedReason ?? null,
        },
      };
    },
  },
  private_message_broadcast_isolation: {
    description:
      "Connect Alice, Bob, and an observer; verify the observer receives no private conversation updates or transcript messages.",
    run: async (runtime) => {
      const alice = await runtime.connectHuman("Harness Alice");
      const bob = await runtime.connectHuman("Harness Bob");
      const observer = await runtime.connectHuman("Harness Observer");

      runtime.send(alice, {
        type: "start_convo",
        data: { targetId: bob.playerId },
      });
      const invite = await runtime.waitForConversationState(
        bob,
        "invited",
        (message) => message.data.player1Id === alice.playerId,
      );
      await wait(150);
      const inviteLeaks = observer.messages.filter(
        (message) => message.type === "convo_update",
      ).length;

      runtime.send(bob, {
        type: "accept_convo",
        data: { convoId: invite.data.id },
      });
      const active = await runtime.waitForConversationState(
        alice,
        "active",
        (message) => message.data.id === invite.data.id,
      );
      await wait(150);
      const activeLeaks = observer.messages.filter(
        (message) => message.type === "convo_update",
      ).length;

      const transcriptBefore = observer.messages.filter(
        (message) => message.type === "message",
      ).length;
      runtime.send(alice, { type: "say", data: { content: "secret" } });
      await runtime.waitForChatMessage(
        bob,
        (message) =>
          message.data.convoId === active.data.id &&
          message.data.content === "secret",
      );
      await wait(200);
      const transcriptAfter = observer.messages.filter(
        (message) => message.type === "message",
      ).length;

      return {
        summary: {
          convoId: active.data.id,
          observerInviteLeaks: inviteLeaks,
          observerActiveLeaks: activeLeaks,
          observerTranscriptLeaks: transcriptAfter - transcriptBefore,
        },
        transcript: collectTranscript(active.data.id, [alice, bob]),
      };
    },
  },
  join_grace_period: {
    description:
      "Connect one human near npc_kael and verify no conversation updates arrive during the grace period.",
    run: async (runtime) => {
      const human = await runtime.connectHuman("Harness Grace");
      await runtime.moveTo(human, 4, 3);

      const graceUpdates = await runtime.waitForNoConversationUpdates(
        human,
        4_000,
        (message) =>
          message.data.player1Id === human.playerId ||
          message.data.player2Id === human.playerId,
      );

      return {
        summary: {
          playerId: human.playerId,
          graceUpdates,
          graceRespected: graceUpdates === 0,
        },
      };
    },
  },
};

export type ConversationHarnessScenarioName =
  keyof typeof CONVERSATION_HARNESS_SCENARIOS;

export function listConversationHarnessScenarios(): {
  name: ConversationHarnessScenarioName;
  description: string;
}[] {
  return Object.entries(CONVERSATION_HARNESS_SCENARIOS).map(
    ([name, scenario]) => ({
      name: name as ConversationHarnessScenarioName,
      description: scenario.description,
    }),
  );
}

export async function runConversationHarnessScenario(
  scenarioName: ConversationHarnessScenarioName,
  options: ConversationHarnessRunOptions = {},
): Promise<ConversationHarnessResult> {
  const scenario = CONVERSATION_HARNESS_SCENARIOS[scenarioName];
  if (!scenario) {
    throw new Error(`Unknown scenario: ${scenarioName}`);
  }

  const runtime = await ConversationHarnessRuntime.create(options);
  const startTick = await runtime.currentTick();
  try {
    const { summary, transcript = [] } = await scenario.run(runtime);
    const endTick = await runtime.currentTick();
    const debugLog = await runtime.getDebugLog(startTick);
    const asciiMap = await runtime.getAsciiMap();

    return {
      scenario: scenarioName,
      description: scenario.description,
      baseUrl: runtime.baseUrl,
      wsUrl: runtime.wsUrl,
      startTick,
      endTick,
      summary,
      transcript,
      debugLog,
      asciiMap,
    };
  } finally {
    await runtime.dispose();
  }
}

export function formatConversationHarnessResult(
  result: ConversationHarnessResult,
): string {
  const lines = [
    `Scenario: ${result.scenario}`,
    result.description,
    `Base URL: ${result.baseUrl}`,
    `WebSocket URL: ${result.wsUrl}`,
    `Ticks: ${result.startTick} -> ${result.endTick}`,
    "Summary:",
  ];

  for (const [key, value] of Object.entries(result.summary)) {
    lines.push(`  ${key}: ${String(value)}`);
  }

  if (result.transcript.length > 0) {
    lines.push("Transcript:");
    for (const entry of result.transcript) {
      lines.push(
        `  [${entry.tick}] ${entry.recipientLabel} <= ${entry.senderId}: ${entry.content}`,
      );
    }
  }

  if (result.debugLog.length > 0) {
    lines.push("Debug log:");
    for (const event of result.debugLog) {
      lines.push(`  [${event.tick}] ${event.type}`);
    }
  }

  lines.push("ASCII map:");
  lines.push(result.asciiMap);
  return lines.join("\n");
}

async function startManagedServer(): Promise<ManagedServerHandle> {
  const port = await findFreePort();
  const stdout: string[] = [];
  const stderr: string[] = [];
  const child = spawn(TSX_BIN, [SERVER_ENTRY], {
    cwd: SERVER_ROOT,
    env: { ...process.env, PORT: String(port) },
    stdio: "pipe",
  });

  child.stdout.on("data", (chunk: Buffer) => {
    stdout.push(chunk.toString());
  });
  child.stderr.on("data", (chunk: Buffer) => {
    stderr.push(chunk.toString());
  });

  const baseUrl = `http://127.0.0.1:${port}`;
  const wsUrl = `ws://127.0.0.1:${port}`;
  await waitForHealthyServer(baseUrl, child, stdout, stderr);

  return { process: child, baseUrl, wsUrl, port, stdout, stderr };
}

function collectTranscript(
  convoId: number,
  clients: HarnessClient[],
): ConversationHarnessTranscriptEntry[] {
  const entries = new Map<number, ConversationHarnessTranscriptEntry>();
  for (const client of clients) {
    for (const message of client.messages) {
      if (message.type !== "message" || message.data.convoId !== convoId) {
        continue;
      }
      entries.set(message.data.id, {
        messageId: message.data.id,
        convoId: message.data.convoId,
        senderId: message.data.playerId,
        recipientLabel: client.label,
        content: message.data.content,
        tick: message.data.tick,
      });
    }
  }

  return Array.from(entries.values()).sort(
    (left, right) => left.tick - right.tick,
  );
}

async function findFreePort(): Promise<number> {
  return new Promise<number>((resolve, reject) => {
    const server = createServer();
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      if (!address || typeof address === "string") {
        reject(new Error("Failed to allocate a free port"));
        return;
      }
      const port = address.port;
      server.close((error) => {
        if (error) {
          reject(error);
        } else {
          resolve(port);
        }
      });
    });
  });
}

async function waitForHealthyServer(
  baseUrl: string,
  serverProcess: ChildProcessWithoutNullStreams,
  stdout: string[],
  stderr: string[],
): Promise<void> {
  const startedAt = Date.now();
  while (Date.now() - startedAt < DEFAULT_TIMEOUT_MS) {
    if (serverProcess.exitCode !== null) {
      throw new Error(
        `Managed server exited early.\nSTDOUT:\n${stdout.join("")}\nSTDERR:\n${stderr.join("")}`,
      );
    }

    try {
      const response = await fetch(`${baseUrl}/health`);
      if (response.ok) {
        return;
      }
    } catch {
      // Server is still booting.
    }
    await wait(100);
  }

  throw new Error(
    `Timed out waiting for managed server.\nSTDOUT:\n${stdout.join("")}\nSTDERR:\n${stderr.join("")}`,
  );
}

async function fetchJson<T>(url: string): Promise<T> {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Request failed for ${url}: ${response.status}`);
  }
  return (await response.json()) as T;
}

async function waitForWebSocketOpen(ws: WebSocket): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    ws.once("open", () => resolve());
    ws.once("error", reject);
  });
}

async function waitForServerMessage<T extends ServerMessage>(
  client: Pick<HarnessClient, "label" | "messages">,
  predicate: (message: ServerMessage) => message is T,
  timeoutMs?: number,
): Promise<T>;
async function waitForServerMessage(
  client: Pick<HarnessClient, "label" | "messages">,
  predicate: (message: ServerMessage) => boolean,
  timeoutMs?: number,
): Promise<ServerMessage>;
async function waitForServerMessage(
  client: Pick<HarnessClient, "label" | "messages">,
  predicate: (message: ServerMessage) => boolean,
  timeoutMs = DEFAULT_TIMEOUT_MS,
): Promise<ServerMessage> {
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    const found = client.messages.find(predicate);
    if (found) {
      return found;
    }
    await wait(20);
  }
  const recentMessages = client.messages
    .slice(-5)
    .map((message) => message.type)
    .join(", ");
  throw new Error(
    `Timed out waiting for server message for ${client.label}. Recent messages: ${recentMessages || "none"}`,
  );
}

function wait(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
