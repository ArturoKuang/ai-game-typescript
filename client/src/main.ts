import { GameClient } from "./network.js";
import { GameRenderer } from "./renderer.js";
import type { FullGameState, MoveDirection, TileType } from "./types.js";
import { UI } from "./ui.js";

// State
let gameState: FullGameState | null = null;
let selfId: string | null = null;
let mapLoaded = false;

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
        if (idx >= 0) gameState.players[idx] = msg.data;
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

  // --- WASD / Arrow key movement with client-side prediction ---
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

  const heldKeys = new Set<string>();
  const MOVE_INTERVAL_MS = 120; // ms between moves while key held
  let moveIntervalId: ReturnType<typeof setInterval> | null = null;

  function isInputFocused(): boolean {
    const tag = document.activeElement?.tagName;
    return tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT";
  }

  function tryMove(direction: MoveDirection): void {
    if (!selfId || !gameState) return;
    const self = gameState.players.find((p) => p.id === selfId);
    if (!self || self.state === "conversing") return;

    // Client-side prediction: move local position immediately
    const dx = direction === "left" ? -1 : direction === "right" ? 1 : 0;
    const dy = direction === "up" ? -1 : direction === "down" ? 1 : 0;
    self.x = Math.round(self.x) + dx;
    self.y = Math.round(self.y) + dy;
    self.orientation = direction;
    self.state = "idle";

    // Tell the server
    client.send({ type: "move_direction", data: { direction } });
  }

  function getActiveDirection(): MoveDirection | null {
    // Priority: last pressed key wins, but we check in a fixed order
    for (const key of heldKeys) {
      const dir = KEY_TO_DIR[key];
      if (dir) return dir;
    }
    return null;
  }

  function startMoveLoop(): void {
    if (moveIntervalId) return;
    // Fire first move immediately
    const dir = getActiveDirection();
    if (dir) tryMove(dir);

    moveIntervalId = setInterval(() => {
      const d = getActiveDirection();
      if (d) tryMove(d);
    }, MOVE_INTERVAL_MS);
  }

  function stopMoveLoop(): void {
    if (moveIntervalId) {
      clearInterval(moveIntervalId);
      moveIntervalId = null;
    }
  }

  window.addEventListener("keydown", (e) => {
    if (isInputFocused()) return;
    const dir = KEY_TO_DIR[e.key];
    if (!dir) return;

    e.preventDefault();
    if (!heldKeys.has(e.key)) {
      heldKeys.add(e.key);
      // Fresh key press — move immediately and start repeat
      stopMoveLoop();
      startMoveLoop();
    }
  });

  window.addEventListener("keyup", (e) => {
    heldKeys.delete(e.key);
    if (heldKeys.size === 0) {
      stopMoveLoop();
    }
  });

  // Stop movement if window loses focus
  window.addEventListener("blur", () => {
    heldKeys.clear();
    stopMoveLoop();
  });

  // Render loop
  function renderLoop() {
    if (gameState) {
      renderer.updatePlayers(gameState.players);
    }
    requestAnimationFrame(renderLoop);
  }
  renderLoop();
}

start().catch(console.error);
