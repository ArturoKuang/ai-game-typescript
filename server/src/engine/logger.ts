import type { GameEvent } from "./types.js";

const DEFAULT_MAX_SIZE = 1000;

/**
 * In-memory circular buffer for game events.
 * Keeps the last N events for debug API queries.
 * All operations are O(1) for writes, O(n) for filtered reads.
 */
export class GameLogger {
  private buffer: (GameEvent | undefined)[];
  private head = 0;
  private count = 0;
  private capacity: number;

  constructor(maxSize: number = DEFAULT_MAX_SIZE) {
    this.capacity = maxSize;
    this.buffer = new Array(maxSize);
  }

  log(event: GameEvent): void {
    const idx = (this.head + this.count) % this.capacity;
    this.buffer[idx] = event;
    if (this.count < this.capacity) {
      this.count++;
    } else {
      this.head = (this.head + 1) % this.capacity;
    }
  }

  /** Get events with optional filters (single-pass). */
  getEvents(options?: {
    since?: number;
    limit?: number;
    playerId?: string;
    types?: string[];
  }): GameEvent[] {
    const since = options?.since;
    const playerId = options?.playerId;
    const wanted =
      options?.types && options.types.length > 0
        ? new Set(options.types)
        : undefined;
    const limit = options?.limit;

    const result: GameEvent[] = [];
    for (let i = 0; i < this.count; i++) {
      const event = this.buffer[(this.head + i) % this.capacity]!;
      if (since !== undefined && event.tick < since) continue;
      if (playerId && event.playerId !== playerId) continue;
      if (wanted && !wanted.has(event.type)) continue;
      result.push(event);
    }

    if (limit && result.length > limit) {
      return result.slice(-limit);
    }
    return result;
  }

  clear(): void {
    this.buffer = new Array(this.capacity);
    this.head = 0;
    this.count = 0;
  }

  get size(): number {
    return this.count;
  }
}
