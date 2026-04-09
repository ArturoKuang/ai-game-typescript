import { once } from "node:events";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { afterEach, describe, expect, it } from "vitest";
import { WebSocket } from "ws";
import { EntityManager } from "../src/autonomy/entityManager.js";
import { NpcAutonomyManager } from "../src/autonomy/manager.js";
import { InMemoryNpcStore } from "../src/db/npcStore.js";
import { GameLoop } from "../src/engine/gameLoop.js";
import type {
  ClientMessage,
  FullGameState,
  ServerMessage,
} from "../src/network/protocol.js";
import { GameWebSocketServer } from "../src/network/websocket.js";

interface SocketHarness {
  ws: WebSocket;
  messages: ServerMessage[];
}

async function createHarnesses(count: number, url: string): Promise<SocketHarness[]> {
  const harnesses = await Promise.all(
    Array.from({ length: count }, async () => {
      const ws = new WebSocket(url);
      const messages: ServerMessage[] = [];
      ws.on("message", (raw) => {
        messages.push(JSON.parse(raw.toString()) as ServerMessage);
      });
      await once(ws, "open");
      await waitForMessage(messages, (message) => message.type === "state");
      return { ws, messages };
    }),
  );

  return harnesses;
}

function sendMessage(ws: WebSocket, message: ClientMessage): void {
  ws.send(JSON.stringify(message));
}

async function waitForMessage(
  messages: ServerMessage[],
  predicate: (message: ServerMessage) => boolean,
): Promise<ServerMessage> {
  const existing = messages.find(predicate);
  if (existing) return existing;

  return new Promise((resolve, reject) => {
    const startedAt = Date.now();
    const interval = setInterval(() => {
      const found = messages.find(predicate);
      if (found) {
        clearInterval(interval);
        resolve(found);
        return;
      }
      if (Date.now() - startedAt > 1000) {
        clearInterval(interval);
        reject(new Error("Timed out waiting for WebSocket message"));
      }
    }, 5);
  });
}

async function waitForSilence(): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, 25));
}

async function waitForDispatch(): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, 10));
}

function assertNoInternalPlayerFields(player: Record<string, unknown>): void {
  expect(player).not.toHaveProperty("currentActivityId");
  expect(player).not.toHaveProperty("inputX");
  expect(player).not.toHaveProperty("inputY");
  expect(player).not.toHaveProperty("path");
  expect(player).not.toHaveProperty("pathIndex");
  expect(player).not.toHaveProperty("personality");
}

describe("WebSocket protocol", () => {
  let server: Server | undefined;
  let wsServer: GameWebSocketServer | undefined;
  let game: GameLoop | undefined;
  let sockets: SocketHarness[] = [];

  afterEach(async () => {
    for (const socket of sockets) {
      if (socket.ws.readyState === WebSocket.OPEN) {
        socket.ws.close();
      }
    }
    sockets = [];

    game?.stop();
    if (server) {
      await new Promise<void>((resolve, reject) => {
        server!.close((error) => {
          if (error) reject(error);
          else resolve();
        });
      });
    }

    wsServer = undefined;
    game = undefined;
    server = undefined;
  });

  it("server messages have correct structure", () => {
    const stateMsg: ServerMessage = {
      type: "state",
      data: {
        tick: 0,
        world: { width: 20, height: 20 },
        players: [],
        conversations: [],
        activities: [],
      },
    };
    expect(stateMsg.type).toBe("state");
    expect((stateMsg.data as FullGameState).tick).toBe(0);
  });

  it("client messages have correct structure", () => {
    const joinMsg: ClientMessage = {
      type: "join",
      data: { name: "Test Player", description: "Debug human" },
    };
    expect(joinMsg.type).toBe("join");

    const startConvo: ClientMessage = {
      type: "start_convo",
      data: { targetId: "npc_alice" },
    };
    expect(startConvo.type).toBe("start_convo");

    const acceptConvo: ClientMessage = {
      type: "accept_convo",
      data: { convoId: 1 },
    };
    expect(acceptConvo.type).toBe("accept_convo");

    const declineConvo: ClientMessage = {
      type: "decline_convo",
      data: { convoId: 1 },
    };
    expect(declineConvo.type).toBe("decline_convo");

    const attackMsg: ClientMessage = {
      type: "attack",
      data: { targetBearId: "bear_1" },
    };
    expect(attackMsg.type).toBe("attack");
  });

  it("serializes only public player fields in state snapshots and join previews", async () => {
    try {
      const probe = createServer();
      await new Promise<void>((resolve, reject) => {
        probe.once("error", reject);
        probe.listen(0, "127.0.0.1", () => {
          probe.close();
          resolve();
        });
      });
    } catch {
      console.log("Skipping: socket binding not permitted in this environment");
      return;
    }

    game = new GameLoop({ mode: "stepped", tickRate: 20 });
    game.loadWorld({
      width: 5,
      height: 5,
      tiles: [
        ["wall", "wall", "wall", "wall", "wall"],
        ["wall", "floor", "floor", "floor", "wall"],
        ["wall", "floor", "floor", "floor", "wall"],
        ["wall", "floor", "floor", "floor", "wall"],
        ["wall", "wall", "wall", "wall", "wall"],
      ],
      activities: [],
      spawnPoints: [{ x: 1, y: 1 }],
    });
    game.spawnPlayer({
      id: "npc_alice",
      name: "Alice NPC",
      description: "Helpful NPC",
      personality: "friendly",
      x: 1,
      y: 1,
      isNpc: true,
    });

    server = createServer();
    wsServer = new GameWebSocketServer(server, game);
    game.on("*", (event) => wsServer!.broadcastGameEvent(event));

    await new Promise<void>((resolve) => server!.listen(0, "127.0.0.1", resolve));
    const port = (server.address() as AddressInfo).port;
    sockets = await createHarnesses(1, `ws://127.0.0.1:${port}`);

    const [{ ws, messages }] = sockets;
    const stateMessage = (await waitForMessage(
      messages,
      (message) => message.type === "state",
    )) as Extract<ServerMessage, { type: "state" }>;
    const snapshotPlayer = stateMessage.data.players[0] as Record<string, unknown>;
    assertNoInternalPlayerFields(snapshotPlayer);

    sendMessage(ws, {
      type: "join",
      data: { name: "Human", description: "Arrived from the browser" },
    });
    const joinedMessage = (await waitForMessage(
      messages,
      (message) =>
        message.type === "player_joined" && message.data.name === "Human",
    )) as Extract<ServerMessage, { type: "player_joined" }>;
    assertNoInternalPlayerFields(joinedMessage.data as Record<string, unknown>);
  });

  it("delivers conversation updates and messages only to participants", async () => {
    // Skip in environments where socket binding is blocked (e.g., sandbox)
    try {
      const probe = createServer();
      await new Promise<void>((resolve, reject) => {
        probe.once("error", reject);
        probe.listen(0, "127.0.0.1", () => { probe.close(); resolve(); });
      });
    } catch {
      console.log("Skipping: socket binding not permitted in this environment");
      return;
    }

    game = new GameLoop({ mode: "stepped", tickRate: 20 });
    game.loadWorld({
      width: 5,
      height: 5,
      tiles: [
        ["wall", "wall", "wall", "wall", "wall"],
        ["wall", "floor", "floor", "floor", "wall"],
        ["wall", "floor", "floor", "floor", "wall"],
        ["wall", "floor", "floor", "floor", "wall"],
        ["wall", "wall", "wall", "wall", "wall"],
      ],
      activities: [],
      spawnPoints: [
        { x: 1, y: 1 },
        { x: 2, y: 1 },
        { x: 3, y: 1 },
      ],
    });

    server = createServer();
    wsServer = new GameWebSocketServer(server, game);
    game.on("*", (event) => wsServer!.broadcastGameEvent(event));

    await new Promise<void>((resolve) => server!.listen(0, "127.0.0.1", resolve));
    const port = (server.address() as AddressInfo).port;
    sockets = await createHarnesses(3, `ws://127.0.0.1:${port}`);

    const [alice, bob, observer] = sockets;

    sendMessage(alice.ws, { type: "join", data: { name: "Alice" } });
    sendMessage(bob.ws, { type: "join", data: { name: "Bob" } });
    sendMessage(observer.ws, { type: "join", data: { name: "Observer" } });
    const aliceJoin = await waitForMessage(
      alice.messages,
      (message) => message.type === "player_joined" && message.data.name === "Alice",
    );
    const bobJoin = await waitForMessage(
      bob.messages,
      (message) => message.type === "player_joined" && message.data.name === "Bob",
    );
    await waitForDispatch();
    game.tick();

    const aliceId = aliceJoin.data.id;
    const bobId = bobJoin.data.id;

    const observerConvoUpdatesBefore = observer.messages.filter(
      (message) => message.type === "convo_update",
    ).length;

    sendMessage(alice.ws, { type: "start_convo", data: { targetId: bobId } });
    await waitForDispatch();
    game.tick();

    const inviteUpdate = (await waitForMessage(
      bob.messages,
      (message) => message.type === "convo_update" && message.data.state === "invited",
    )) as Extract<ServerMessage, { type: "convo_update" }>;

    expect(inviteUpdate.data.player1Id).toBe(aliceId);
    expect(inviteUpdate.data.player2Id).toBe(bobId);
    await waitForSilence();
    expect(
      observer.messages.filter((message) => message.type === "convo_update").length,
    ).toBe(observerConvoUpdatesBefore);

    sendMessage(bob.ws, {
      type: "accept_convo",
      data: { convoId: inviteUpdate.data.id },
    });
    await waitForDispatch();
    game.tick();

    await waitForMessage(
      alice.messages,
      (message) => message.type === "convo_update" && message.data.state === "active",
    );
    await waitForSilence();
    expect(
      observer.messages.filter((message) => message.type === "convo_update").length,
    ).toBe(observerConvoUpdatesBefore);

    const observerMessagesBefore = observer.messages.filter(
      (message) => message.type === "message",
    ).length;
    sendMessage(alice.ws, { type: "say", data: { content: "secret" } });
    await waitForDispatch();
    game.tick();

    const aliceTranscript = await waitForMessage(
      alice.messages,
      (message) => message.type === "message" && message.data.content === "secret",
    );
    const bobTranscript = await waitForMessage(
      bob.messages,
      (message) => message.type === "message" && message.data.content === "secret",
    );

    expect(aliceTranscript.type).toBe("message");
    expect(bobTranscript.type).toBe("message");
    await waitForSilence();
    expect(
      observer.messages.filter((message) => message.type === "message").length,
    ).toBe(observerMessagesBefore);
  });

  it("streams debug bootstrap and global conversation events to debug subscribers", async () => {
    try {
      const probe = createServer();
      await new Promise<void>((resolve, reject) => {
        probe.once("error", reject);
        probe.listen(0, "127.0.0.1", () => {
          probe.close();
          resolve();
        });
      });
    } catch {
      console.log("Skipping: socket binding not permitted in this environment");
      return;
    }

    game = new GameLoop({ mode: "stepped", tickRate: 20 });
    game.loadWorld({
      width: 5,
      height: 5,
      tiles: [
        ["wall", "wall", "wall", "wall", "wall"],
        ["wall", "floor", "floor", "floor", "wall"],
        ["wall", "floor", "floor", "floor", "wall"],
        ["wall", "floor", "floor", "floor", "wall"],
        ["wall", "wall", "wall", "wall", "wall"],
      ],
      activities: [],
      spawnPoints: [
        { x: 1, y: 1 },
        { x: 2, y: 1 },
        { x: 3, y: 1 },
      ],
    });

    server = createServer();
    wsServer = new GameWebSocketServer(server, game);
    game.on("*", (event) => wsServer!.broadcastGameEvent(event));

    await new Promise<void>((resolve) => server!.listen(0, "127.0.0.1", resolve));
    const port = (server.address() as AddressInfo).port;
    sockets = await createHarnesses(3, `ws://127.0.0.1:${port}`);

    const [alice, bob, dashboard] = sockets;

    sendMessage(alice.ws, { type: "join", data: { name: "Alice" } });
    sendMessage(bob.ws, { type: "join", data: { name: "Bob" } });

    const aliceJoin = await waitForMessage(
      alice.messages,
      (message) => message.type === "player_joined" && message.data.name === "Alice",
    );
    const bobJoin = await waitForMessage(
      bob.messages,
      (message) => message.type === "player_joined" && message.data.name === "Bob",
    );
    await waitForDispatch();
    game.tick();

    sendMessage(dashboard.ws, { type: "subscribe_debug" });
    const bootstrap = (await waitForMessage(
      dashboard.messages,
      (message) => message.type === "debug_bootstrap",
    )) as Extract<ServerMessage, { type: "debug_bootstrap" }>;

    expect(bootstrap.data.players.map((player) => player.name)).toEqual(
      expect.arrayContaining(["Alice", "Bob"]),
    );
    expect(bootstrap.data.conversations).toHaveLength(0);

    sendMessage(alice.ws, {
      type: "start_convo",
      data: { targetId: bobJoin.data.id },
    });
    await waitForDispatch();
    game.tick();

    const invited = (await waitForMessage(
      dashboard.messages,
      (message) =>
        message.type === "debug_conversation_upsert" &&
        message.data.state === "invited",
    )) as Extract<ServerMessage, { type: "debug_conversation_upsert" }>;

    expect(invited.data.player1Id).toBe(aliceJoin.data.id);
    expect(invited.data.player2Id).toBe(bobJoin.data.id);

    sendMessage(bob.ws, {
      type: "accept_convo",
      data: { convoId: invited.data.id },
    });
    await waitForDispatch();
    game.tick();

    await waitForMessage(
      dashboard.messages,
      (message) =>
        message.type === "debug_conversation_upsert" &&
        message.data.id === invited.data.id &&
        message.data.state === "active",
    );

    sendMessage(alice.ws, { type: "say", data: { content: "secret" } });
    await waitForDispatch();
    game.tick();

    const debugMessage = (await waitForMessage(
      dashboard.messages,
      (message) =>
        message.type === "debug_conversation_message" &&
        message.data.content === "secret",
    )) as Extract<ServerMessage, { type: "debug_conversation_message" }>;

    expect(debugMessage.data.convoId).toBe(invited.data.id);

    const debugEvent = (await waitForMessage(
      dashboard.messages,
      (message) =>
        message.type === "debug_event" &&
        message.data.type === "conversation_message" &&
        message.data.relatedConversationId === invited.data.id,
    )) as Extract<ServerMessage, { type: "debug_event" }>;

    expect(debugEvent.data.message).toContain("secret");
  });

  it("includes dead NPCs in debug bootstrap with their death reason", async () => {
    try {
      const probe = createServer();
      await new Promise<void>((resolve, reject) => {
        probe.once("error", reject);
        probe.listen(0, "127.0.0.1", () => {
          probe.close();
          resolve();
        });
      });
    } catch {
      console.log("Skipping: socket binding not permitted in this environment");
      return;
    }

    game = new GameLoop({ mode: "stepped", tickRate: 20 });
    game.loadWorld({
      width: 5,
      height: 5,
      tiles: [
        ["wall", "wall", "wall", "wall", "wall"],
        ["wall", "floor", "floor", "floor", "wall"],
        ["wall", "floor", "floor", "floor", "wall"],
        ["wall", "floor", "floor", "floor", "wall"],
        ["wall", "wall", "wall", "wall", "wall"],
      ],
      activities: [],
      spawnPoints: [{ x: 1, y: 1 }],
    });
    game.spawnPlayer({
      id: "npc_alice",
      name: "Alice NPC",
      description: "Helpful NPC",
      x: 2,
      y: 2,
      isNpc: true,
    });

    const autonomyManager = new NpcAutonomyManager(
      game,
      new EntityManager(),
      { npcStore: new InMemoryNpcStore() },
    );
    autonomyManager.getState("npc_alice").needs.water = 0.001;

    server = createServer();
    wsServer = new GameWebSocketServer(server, game, undefined, autonomyManager);
    game.on("*", (event) => wsServer!.broadcastGameEvent(event));

    game.tick();

    expect(game.getPlayer("npc_alice")).toBeUndefined();

    await new Promise<void>((resolve) => server!.listen(0, "127.0.0.1", resolve));
    const port = (server.address() as AddressInfo).port;
    sockets = await createHarnesses(1, `ws://127.0.0.1:${port}`);

    const [dashboard] = sockets;
    sendMessage(dashboard.ws, { type: "subscribe_debug" });
    const bootstrap = (await waitForMessage(
      dashboard.messages,
      (message) => message.type === "debug_bootstrap",
    )) as Extract<ServerMessage, { type: "debug_bootstrap" }>;

    expect(
      bootstrap.data.players.find((player) => player.id === "npc_alice"),
    ).toBeUndefined();
    expect(bootstrap.data.autonomyStates.npc_alice).toEqual(
      expect.objectContaining({
        npcId: "npc_alice",
        name: "Alice NPC",
        isDead: true,
        lastPosition: { x: 2, y: 2 },
        death: expect.objectContaining({
          cause: "survival",
          depletedNeed: "water",
        }),
      }),
    );
    expect(bootstrap.data.autonomyStates.npc_alice.death?.message).toContain(
      "water reached 0",
    );
  });
});
