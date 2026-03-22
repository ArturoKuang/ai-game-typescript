import type { GameEvent } from './types.js';

const DEFAULT_MAX_SIZE = 1000;

/**
 * In-memory ring buffer for game events.
 * Keeps the last N events for debug API queries.
 */
export class GameLogger {
  private buffer: GameEvent[] = [];
  private maxSize: number;

  constructor(maxSize: number = DEFAULT_MAX_SIZE) {
    this.maxSize = maxSize;
  }

  log(event: GameEvent): void {
    this.buffer.push(event);
    if (this.buffer.length > this.maxSize) {
      this.buffer.shift();
    }
  }

  /** Get events since a given tick, with optional limit */
  getEvents(options?: { since?: number; limit?: number; playerId?: string }): GameEvent[] {
    let events = this.buffer;

    if (options?.since !== undefined) {
      events = events.filter(e => e.tick >= options.since!);
    }

    if (options?.playerId) {
      events = events.filter(e => e.playerId === options.playerId);
    }

    if (options?.limit) {
      events = events.slice(-options.limit);
    }

    return events;
  }

  clear(): void {
    this.buffer = [];
  }

  get size(): number {
    return this.buffer.length;
  }
}
