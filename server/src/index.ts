import express from 'express';
import { readFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { checkConnection } from './db/client.js';
import { runMigrations } from './db/migrate.js';
import { createDebugRouter } from './debug/router.js';
import { GameLoop } from './engine/gameLoop.js';
import type { MapData } from './engine/types.js';

const __dirname = dirname(fileURLToPath(import.meta.url));

const app = express();
const server = createServer(app);
const PORT = parseInt(process.env.PORT || '3001', 10);

app.use(express.json());

// --- Game setup ---
const game = new GameLoop({ mode: 'stepped' });

// Load default map
const mapPath = join(__dirname, '..', 'data', 'map.json');
try {
  const mapData: MapData = JSON.parse(readFileSync(mapPath, 'utf-8'));
  game.loadWorld(mapData);
  console.log(`Loaded map: ${mapData.width}x${mapData.height}`);
} catch (err) {
  console.error('Failed to load map:', err);
}

// --- Routes ---
app.get('/health', async (_req, res) => {
  const dbConnected = await checkConnection();
  res.json({
    status: dbConnected ? 'ok' : 'degraded',
    tick: game.currentTick,
    dbConnected,
  });
});

app.use('/api/debug', createDebugRouter(game));

async function start() {
  try {
    await runMigrations();
    server.listen(PORT, '0.0.0.0', () => {
      console.log(`Game server listening on port ${PORT}`);
    });
  } catch (error) {
    console.error('Failed to start server:', error);
    process.exit(1);
  }
}

start();
