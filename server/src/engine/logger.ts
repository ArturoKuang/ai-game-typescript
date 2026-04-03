/**
 * Fixed-size event log owned by {@link GameLoop}.
 *
 * The logger is an in-memory inspection surface, not durable storage. The
 * debug API reads from it directly, the harnesses use it to build traces, and
 * the engine writes into it as part of normal event emission.
 */
import type { GameEvent } from "./types.js";

const DEFAULT_MAX_SIZE = 1000;

/** Ring buffer for recent events. O(1) writes, O(n) filtered reads. */
export class GameLogger {
  /** Backing storage for the ring buffer; indices wrap via modulo arithmetic. */
  private buffer: (GameEvent | undefined)[];
  /** Oldest event index currently retained in the ring. */
  private head = 0;
  /** Number of occupied slots in `buffer`. */
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
