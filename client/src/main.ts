import { logClientDebugEvent } from "./debugLog.js";
import { GameClient } from "./network.js";
import {
  MOVE_SPEED,
  PLAYER_RADIUS,
  getHeldDirectionVector,
  predictLocalPlayerStep,
} from "./prediction.js";
import { GameRenderer } from "./renderer.js";
import type { FullGameState, MoveDirection, TileType } from "./types.js";
import { UI } from "./ui.js";

// State
let gameState: FullGameState | null = null;
let selfId: string | null = null;
let mapLoaded = false;
let mapTiles: TileType[][] | null = null;

// Init
const canvas = document.getElementById("game-canvas") as HTMLCanvasElement;
const renderer = new GameRenderer(canvas);
const client = new GameClient();
const ui = new UI();

async function start() {
  await renderer.init();

  // Load map tiles eagerly
  try {
    const mapRes = await fetch("/data/map.json");
    if (mapRes.ok) {
      const mapData = await mapRes.json();
      const actRes = await fetch("/api/debug/activities");
      const activities = actRes.ok ? await actRes.json() : [];
      renderer.renderMap(mapData.tiles, activities);
      mapTiles = mapData.tiles;
      mapLoaded = true;
    }
  } catch (err) {
    console.error("Failed to load map:", err);
  }

  // Fallback: render blank map from state dimensions
  if (!mapLoaded) {
    const stateRes = await fetch("/api/debug/state");
    if (stateRes.ok) {
      const state = await stateRes.json();
      const w = state.world?.width ?? 20;
      const h = state.world?.height ?? 20;
      const tiles: TileType[][] = [];
      for (let y = 0; y < h; y++) {
        const row: TileType[] = [];
        for (let x = 0; x < w; x++) {
          row.push(
            x === 0 || x === w - 1 || y === 0 || y === h - 1 ? "wall" : "floor",
          );
        }
        tiles.push(row);
      }
      renderer.renderMap(tiles, []);
      mapLoaded = true;
    }
  }

  // Connect WebSocket
  client.connect();

  // --- WASD / Arrow key continuous movement with input_start/input_stop ---
  const KEY_TO_DIR: Record<string, MoveDirection> = {
    w: "up",
    a: "left",
    s: "down",
    d: "right",
    ArrowUp: "up",
    ArrowLeft: "left",
    ArrowDown: "down",
    ArrowRight: "right",
  };

  const heldDirections = new Set<MoveDirection>();

  client.onMessage((msg) => {
    switch (msg.type) {
      case "state": {
        gameState = msg.data;
        ui.updatePlayerList(gameState.players);
        ui.setStatus(
          `Connected | Tick: ${gameState.tick} | Players: ${gameState.players.length}`,
        );
        break;
      }

      case "tick": {
        if (gameState) {
          gameState.tick = msg.data.tick;
        }
        break;
      }

      case "player_joined": {
        if (!gameState) break;
        const existing = gameState.players.findIndex(
          (p) => p.id === msg.data.id,
        );
        if (existing >= 0) {
          gameState.players[existing] = msg.data;
        } else {
          gameState.players.push(msg.data);
        }
        ui.updatePlayerList(gameState.players);

        // If this is our join confirmation (first non-NPC join we see)
        if (!selfId && !msg.data.isNpc) {
          selfId = msg.data.id;
          renderer.setSelfId(selfId);
          ui.setSelfId(selfId);
          ui.enableChat();
          ui.addChatMessage("", `You joined as ${msg.data.name}`, true);
        }
        break;
      }

      case "player_left": {
        if (!gameState) break;
        const name = gameState.players.find((p) => p.id === msg.data.id)?.name;
        gameState.players = gameState.players.filter(
          (p) => p.id !== msg.data.id,
        );
        ui.updatePlayerList(gameState.players);
        if (name) ui.addChatMessage("", `${name} left`, true);
        break;
      }

      case "player_update": {
        if (!gameState) break;
        const idx = gameState.players.findIndex((p) => p.id === msg.data.id);
        if (idx >= 0) {
          if (msg.data.id === selfId) {
            // Server reconciliation for self
            const local = gameState.players[idx];
            const dx = msg.data.x - local.x;
            const dy = msg.data.y - local.y;
            const dist = Math.sqrt(dx * dx + dy * dy);

            if (dist > 4) {
              // Teleport/spawn — snap immediately
              logClientDebugEvent("reconciliation_correction", {
                mode: "snap",
                playerId: msg.data.id,
                dist,
                serverX: msg.data.x,
                serverY: msg.data.y,
                localX: local.x,
                localY: local.y,
              });
              local.x = msg.data.x;
              local.y = msg.data.y;
            } else if (heldDirections.size > 0) {
              // Actively moving: tolerate tiny drift but correct collision-sized divergence.
              if (dist > 1.0) {
                logClientDebugEvent("reconciliation_correction", {
                  mode: "snap",
                  playerId: msg.data.id,
                  dist,
                  serverX: msg.data.x,
                  serverY: msg.data.y,
                  localX: local.x,
                  localY: local.y,
                });
                local.x = msg.data.x;
                local.y = msg.data.y;
              } else if (dist > 0.35) {
                logClientDebugEvent("reconciliation_correction", {
                  mode: "lerp",
                  playerId: msg.data.id,
                  dist,
                  serverX: msg.data.x,
                  serverY: msg.data.y,
                  localX: local.x,
                  localY: local.y,
                });
                local.x += dx * 0.5;
                local.y += dy * 0.5;
              }
            } else if (dist > 0.3) {
              // Stopped: correct toward server position
              logClientDebugEvent("reconciliation_correction", {
                mode: "settle",
                playerId: msg.data.id,
                dist,
                serverX: msg.data.x,
                serverY: msg.data.y,
                localX: local.x,
                localY: local.y,
              });
              local.x += dx * 0.3;
              local.y += dy * 0.3;
            }

            // Update non-position fields from server
            const { x: _serverX, y: _serverY, ...rest } = msg.data;
            Object.assign(local, rest);
          } else {
            gameState.players[idx] = msg.data;
          }
        }
        ui.updatePlayerList(gameState.players);
        break;
      }

      case "convo_update": {
        if (!gameState) break;
        const ci = gameState.conversations.findIndex(
          (c) => c.id === msg.data.id,
        );
        if (ci >= 0) gameState.conversations[ci] = msg.data;
        else gameState.conversations.push(msg.data);
        break;
      }

      case "message": {
        const sender = gameState?.players.find(
          (p) => p.id === msg.data.playerId,
        );
        const senderName = sender?.name ?? msg.data.playerId;
        ui.addChatMessage(senderName, msg.data.content);
        renderer.showChatBubble(msg.data.playerId, msg.data.content);
        break;
      }

      case "error": {
        ui.addChatMessage("", `Error: ${msg.data.message}`, true);
        break;
      }
    }
  });

  // Join button
  const joinBtn = document.getElementById("join-btn")!;
  const nameInput = document.getElementById("name-input") as HTMLInputElement;
  joinBtn.addEventListener("click", () => {
    const name = nameInput.value.trim();
    if (!name) return;
    client.send({ type: "join", data: { name } });
    joinBtn.setAttribute("disabled", "true");
    nameInput.setAttribute("disabled", "true");
  });
  nameInput.addEventListener("keydown", (e) => {
    if (e.key === "Enter") joinBtn.click();
  });

  // Chat
  ui.onChatSubmit((text) => {
    client.send({ type: "say", data: { content: text } });
  });

  // Click to move (pathfinding)
  canvas.addEventListener("click", (e) => {
    if (!selfId) return;
    const tile = renderer.screenToTile(e.clientX, e.clientY);
    if (tile) {
      client.send({ type: "move", data: { x: tile.x, y: tile.y } });
    }
  });

  function isInputFocused(): boolean {
    const tag = document.activeElement?.tagName;
    return tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT";
  }

  window.addEventListener("keydown", (e) => {
    if (isInputFocused()) return;
    const dir = KEY_TO_DIR[e.key];
    if (!dir) return;

    e.preventDefault();
    if (!heldDirections.has(dir)) {
      heldDirections.add(dir);
      client.send({ type: "input_start", data: { direction: dir } });
    }
  });

  window.addEventListener("keyup", (e) => {
    const dir = KEY_TO_DIR[e.key];
    if (!dir) return;
    if (heldDirections.has(dir)) {
      heldDirections.delete(dir);
      client.send({ type: "input_stop", data: { direction: dir } });
    }
  });

  // Stop all movement on blur
  window.addEventListener("blur", () => {
    for (const dir of heldDirections) {
      client.send({ type: "input_stop", data: { direction: dir } });
    }
    heldDirections.clear();
  });

  // --- Render loop with client-side prediction ---
  let lastFrameTime = performance.now();

  function renderLoop(now: number) {
    const dt = (now - lastFrameTime) / 1000;
    lastFrameTime = now;

    if (gameState && selfId) {
      const self = gameState.players.find((p) => p.id === selfId);
      if (self && self.state !== "conversing") {
        // Client-side prediction: apply same physics as server
        const { ix, iy } = getHeldDirectionVector(heldDirections);
        if (ix !== 0 || iy !== 0) {
          const predicted = predictLocalPlayerStep({
            player: {
              id: self.id,
              x: self.x,
              y: self.y,
              orientation: self.orientation,
              radius: self.radius ?? PLAYER_RADIUS,
              inputSpeed: self.inputSpeed ?? MOVE_SPEED,
            },
            otherPlayers: gameState.players
              .filter((player) => player.id !== self.id)
              .map((player) => ({
                id: player.id,
                x: player.x,
                y: player.y,
                radius: player.radius ?? PLAYER_RADIUS,
              })),
            heldDirections,
            mapTiles,
            dt,
          });
          self.x = predicted.x;
          self.y = predicted.y;
          self.orientation = predicted.orientation;
        }
      }
    }

    if (gameState) {
      renderer.updatePlayers(gameState.players);
    }
    requestAnimationFrame(renderLoop);
  }
  requestAnimationFrame(renderLoop);
}

start().catch(console.error);
