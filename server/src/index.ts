import express from 'express';
import { createServer } from 'node:http';
import { checkConnection } from './db/client.js';
import { runMigrations } from './db/migrate.js';

const app = express();
const server = createServer(app);
const PORT = parseInt(process.env.PORT || '3001', 10);

app.use(express.json());

app.get('/health', async (_req, res) => {
  const dbConnected = await checkConnection();
  res.json({
    status: dbConnected ? 'ok' : 'degraded',
    tick: 0,
    dbConnected,
  });
});

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
