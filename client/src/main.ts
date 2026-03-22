import { GameClient } from "./network.js";
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
            if (dist > 2) {
              // Snap if too far off
              local.x = msg.data.x;
              local.y = msg.data.y;
            } else if (dist > 0.01) {
              // Gentle lerp toward server position
              local.x += dx * 0.15;
              local.y += dy * 0.15;
            }
            // Update non-position fields from server
            local.state = msg.data.state;
            local.orientation = msg.data.orientation;
            local.vx = msg.data.vx;
            local.vy = msg.data.vy;
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

  // --- WASD / Arrow key continuous movement with input_start/input_stop ---
  const MOVE_SPEED = 5.0;
  const PLAYER_RADIUS = 0.4;

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

  function isInputFocused(): boolean {
    const tag = document.activeElement?.tagName;
    return tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT";
  }

  /** Compute input vector from held directions */
  function getInputVector(): { ix: number; iy: number } {
    let ix = 0;
    let iy = 0;
    if (heldDirections.has("left")) ix -= 1;
    if (heldDirections.has("right")) ix += 1;
    if (heldDirections.has("up")) iy -= 1;
    if (heldDirections.has("down")) iy += 1;
    return { ix, iy };
  }

  /** Client-side collision matching server logic */
  function clientMoveWithCollision(
    x: number,
    y: number,
    dx: number,
    dy: number,
    radius: number,
  ): { x: number; y: number } {
    // Resolve X then Y
    let nx = x + dx;
    let ny = y;
    nx = clientResolveAxis(nx, ny, radius, true);
    ny = y + dy;
    ny = clientResolveAxis(nx, ny, radius, false);
    return { x: nx, y: ny };
  }

  function clientResolveAxis(
    cx: number,
    cy: number,
    radius: number,
    isXAxis: boolean,
  ): number {
    if (!mapTiles) return isXAxis ? cx : cy;
    const minTX = Math.floor((isXAxis ? cx : cx) - radius) - 1;
    const maxTX = Math.floor((isXAxis ? cx : cx) + radius) + 1;
    const minTY = Math.floor((isXAxis ? cy : cy) - radius) - 1;
    const maxTY = Math.floor((isXAxis ? cy : cy) + radius) + 1;

    let val = isXAxis ? cx : cy;
    for (let ty = minTY; ty <= maxTY; ty++) {
      for (let tx = minTX; tx <= maxTX; tx++) {
        if (ty < 0 || ty >= mapTiles.length || tx < 0 || tx >= (mapTiles[0]?.length ?? 0)) continue;
        if (mapTiles[ty][tx] === "floor") continue;
        // Non-walkable tile
        const closestX = Math.max(tx, Math.min(cx, tx + 1));
        const closestY = Math.max(ty, Math.min(cy, ty + 1));
        const distX = cx - closestX;
        const distY = cy - closestY;
        const distSq = distX * distX + distY * distY;

        if (distSq < radius * radius && distSq > 0) {
          const dist = Math.sqrt(distSq);
          const overlap = radius - dist;
          if (isXAxis) {
            val += (distX / dist) * overlap;
            cx = val;
          } else {
            val += (distY / dist) * overlap;
            cy = val;
          }
        } else if (distSq === 0) {
          if (isXAxis) {
            const toLeft = cx - tx;
            const toRight = tx + 1 - cx;
            val = toLeft < toRight ? tx - radius : tx + 1 + radius;
            cx = val;
          } else {
            const toTop = cy - ty;
            const toBottom = ty + 1 - cy;
            val = toTop < toBottom ? ty - radius : ty + 1 + radius;
            cy = val;
          }
        }
      }
    }
    return val;
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
        const { ix, iy } = getInputVector();
        if (ix !== 0 || iy !== 0) {
          const mag = Math.sqrt(ix * ix + iy * iy);
          const nix = ix / mag;
          const niy = iy / mag;
          const ddx = nix * MOVE_SPEED * dt;
          const ddy = niy * MOVE_SPEED * dt;
          const result = clientMoveWithCollision(
            self.x,
            self.y,
            ddx,
            ddy,
            PLAYER_RADIUS,
          );
          self.x = result.x;
          self.y = result.y;

          // Update orientation
          if (Math.abs(ix) > Math.abs(iy)) {
            self.orientation = ix > 0 ? "right" : "left";
          } else {
            self.orientation = iy > 0 ? "down" : "up";
          }
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
