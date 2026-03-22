import { GameClient } from './network.js';
import { GameRenderer } from './renderer.js';
import { UI } from './ui.js';
import type { Player, FullGameState, TileType } from './types.js';

// State
let gameState: FullGameState | null = null;
let selfId: string | null = null;
let mapTiles: TileType[][] | null = null;
let mapLoaded = false;

// Init
const canvas = document.getElementById('game-canvas') as HTMLCanvasElement;
const renderer = new GameRenderer(canvas);
const client = new GameClient();
const ui = new UI();

async function start() {
  await renderer.init();

  // Fetch map data for tile rendering
  const mapRes = await fetch('/api/debug/state');
  const stateData = await mapRes.json();

  // Fetch actual tile data from debug map endpoint
  const mapJsonRes = await fetch('/api/debug/map?format=json');
  const mapJson = await mapJsonRes.json();

  client.connect();

  client.onMessage((msg) => {
    switch (msg.type) {
      case 'state': {
        gameState = msg.data;
        if (!mapLoaded) {
          loadMapFromServer();
        }
        ui.updatePlayerList(gameState!.players);
        ui.setStatus(`Connected | Tick: ${gameState!.tick} | Players: ${gameState!.players.length}`);
        break;
      }

      case 'tick': {
        // Re-fetch state on each tick for simplicity
        // In production, apply deltas instead
        if (gameState) {
          gameState.tick = msg.data.tick;
          ui.setStatus(`Connected | Tick: ${gameState.tick} | Players: ${gameState.players.length}`);
        }
        break;
      }

      case 'player_joined': {
        if (!gameState) break;
        const existing = gameState.players.findIndex(p => p.id === msg.data.id);
        if (existing >= 0) {
          gameState.players[existing] = msg.data;
        } else {
          gameState.players.push(msg.data);
        }
        ui.updatePlayerList(gameState.players);

        // If this is our join confirmation
        if (!selfId && !msg.data.isNpc) {
          selfId = msg.data.id;
          renderer.setSelfId(selfId);
          ui.setSelfId(selfId);
          ui.enableChat();
          ui.addChatMessage('', `You joined as ${msg.data.name}`, true);
        }
        break;
      }

      case 'player_left': {
        if (!gameState) break;
        const name = gameState.players.find(p => p.id === msg.data.id)?.name;
        gameState.players = gameState.players.filter(p => p.id !== msg.data.id);
        ui.updatePlayerList(gameState.players);
        if (name) ui.addChatMessage('', `${name} left`, true);
        break;
      }

      case 'player_update': {
        if (!gameState) break;
        const idx = gameState.players.findIndex(p => p.id === msg.data.id);
        if (idx >= 0) gameState.players[idx] = msg.data;
        ui.updatePlayerList(gameState.players);
        break;
      }

      case 'convo_update': {
        if (!gameState) break;
        const ci = gameState.conversations.findIndex(c => c.id === msg.data.id);
        if (ci >= 0) gameState.conversations[ci] = msg.data;
        else gameState.conversations.push(msg.data);
        break;
      }

      case 'message': {
        const sender = gameState?.players.find(p => p.id === msg.data.playerId);
        const senderName = sender?.name ?? msg.data.playerId;
        ui.addChatMessage(senderName, msg.data.content);
        renderer.showChatBubble(msg.data.playerId, msg.data.content);
        break;
      }

      case 'error': {
        ui.addChatMessage('', `Error: ${msg.data.message}`, true);
        break;
      }
    }
  });

  // Join button
  const joinBtn = document.getElementById('join-btn')!;
  const nameInput = document.getElementById('name-input') as HTMLInputElement;
  joinBtn.addEventListener('click', () => {
    const name = nameInput.value.trim();
    if (!name) return;
    client.send({ type: 'join', data: { name } });
    joinBtn.setAttribute('disabled', 'true');
    nameInput.setAttribute('disabled', 'true');
  });

  // Chat
  ui.onChatSubmit((text) => {
    client.send({ type: 'say', data: { content: text } });
  });

  // Click to move
  canvas.addEventListener('click', (e) => {
    if (!selfId) return;
    const tile = renderer.screenToTile(e.clientX, e.clientY);
    if (tile) {
      client.send({ type: 'move', data: { x: tile.x, y: tile.y } });
    }
  });

  // Render loop
  function renderLoop() {
    if (gameState) {
      renderer.updatePlayers(gameState.players);
    }
    requestAnimationFrame(renderLoop);
  }
  renderLoop();

  // Periodic state refresh (since we don't get full delta updates yet)
  setInterval(async () => {
    if (!gameState) return;
    try {
      const res = await fetch('/api/debug/players');
      const players = await res.json();
      gameState.players = players;
      ui.updatePlayerList(players);
    } catch {
      // ignore
    }
  }, 1000);
}

async function loadMapFromServer() {
  try {
    // Fetch map.json directly
    const res = await fetch('/api/debug/activities');
    const activities = await res.json();

    if (gameState) {
      // We need the tile data. Fetch it via a custom endpoint or use the state info
      const mapRes = await fetch('/data/map.json');
      if (mapRes.ok) {
        const mapData = await mapRes.json();
        renderer.renderMap(mapData.tiles, activities);
        mapLoaded = true;
        return;
      }
    }
  } catch {
    // Fallback: generate a basic map from world dimensions
  }

  // Fallback: render blank map from state dimensions
  if (gameState) {
    const tiles: TileType[][] = [];
    for (let y = 0; y < gameState.world.height; y++) {
      const row: TileType[] = [];
      for (let x = 0; x < gameState.world.width; x++) {
        row.push(x === 0 || x === gameState.world.width - 1 || y === 0 || y === gameState.world.height - 1 ? 'wall' : 'floor');
      }
      tiles.push(row);
    }
    renderer.renderMap(tiles, []);
    mapLoaded = true;
  }
}

start().catch(console.error);
