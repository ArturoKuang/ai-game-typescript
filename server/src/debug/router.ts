import { Router } from 'express';
import type { GameLoop } from '../engine/gameLoop.js';
import { renderAsciiMap } from './asciiMap.js';
import { SCENARIOS, listScenarios } from './scenarios.js';

export function createDebugRouter(game: GameLoop): Router {
  const router = Router();

  // --- Read endpoints ---

  router.get('/state', (_req, res) => {
    res.json({
      tick: game.currentTick,
      mode: game.mode,
      tickRate: game.tickRate,
      playerCount: game.playerCount,
      world: game.world
        ? { width: game.world.width, height: game.world.height }
        : null,
    });
  });

  router.get('/map', (req, res) => {
    const { ascii, legend } = renderAsciiMap(game);
    if (req.query.format === 'json') {
      res.json({ ascii, legend });
    } else {
      res.type('text/plain').send(ascii);
    }
  });

  router.get('/players', (_req, res) => {
    res.json(game.getPlayers());
  });

  router.get('/players/:id', (req, res) => {
    const player = game.getPlayer(req.params.id);
    if (!player) {
      res.status(404).json({ error: 'Player not found' });
      return;
    }
    res.json(player);
  });

  router.get('/activities', (_req, res) => {
    res.json(game.world.getActivities());
  });

  router.get('/log', (req, res) => {
    const since = req.query.since ? parseInt(req.query.since as string, 10) : undefined;
    const limit = req.query.limit ? parseInt(req.query.limit as string, 10) : 50;
    const playerId = req.query.playerId as string | undefined;
    res.json(game.logger.getEvents({ since, limit, playerId }));
  });

  router.get('/scenarios', (_req, res) => {
    res.json(listScenarios());
  });

  // --- Command endpoints ---

  router.post('/tick', (req, res) => {
    const count = req.body?.count ?? 1;
    const allEvents = [];
    for (let i = 0; i < count; i++) {
      const result = game.tick();
      allEvents.push(...result.events);
    }
    res.json({ tick: game.currentTick, events: allEvents });
  });

  router.post('/spawn', (req, res) => {
    const { id, name, x, y, isNpc, description, personality, speed } = req.body;
    if (!id || !name || x === undefined || y === undefined) {
      res.status(400).json({ error: 'Missing required fields: id, name, x, y' });
      return;
    }
    try {
      const player = game.spawnPlayer({ id, name, x, y, isNpc, description, personality, speed });
      res.json(player);
    } catch (err: any) {
      res.status(400).json({ error: err.message });
    }
  });

  router.post('/move', (req, res) => {
    const { playerId, x, y } = req.body;
    if (!playerId || x === undefined || y === undefined) {
      res.status(400).json({ error: 'Missing required fields: playerId, x, y' });
      return;
    }
    const path = game.setPlayerTarget(playerId, x, y);
    if (!path) {
      res.status(400).json({ error: 'Cannot move to target (unreachable or player in conversation)' });
      return;
    }
    res.json({ path });
  });

  router.post('/reset', (_req, res) => {
    game.reset();
    res.json({ ok: true });
  });

  router.post('/scenario', (req, res) => {
    const { name } = req.body;
    if (!name || !SCENARIOS[name]) {
      res.status(400).json({ error: `Unknown scenario. Available: ${Object.keys(SCENARIOS).join(', ')}` });
      return;
    }
    // Reset existing players but keep world
    for (const p of game.getPlayers()) {
      game.removePlayer(p.id);
    }
    SCENARIOS[name].setup(game);
    res.json({
      ok: true,
      scenario: name,
      playerCount: game.playerCount,
      tick: game.currentTick,
    });
  });

  router.post('/mode', (req, res) => {
    const { mode, tickRate } = req.body;
    if (mode && (mode === 'stepped' || mode === 'realtime')) {
      game.mode = mode;
    }
    res.json({ mode: game.mode, tickRate: game.tickRate });
  });

  return router;
}
