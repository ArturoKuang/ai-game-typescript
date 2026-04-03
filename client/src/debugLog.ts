/**
 * Client-side debug event ring buffer.
 *
 * Records reconciliation corrections and other debug events in a fixed-size
 * circular buffer. Exposed on `window.__AI_TOWN_CLIENT_DEBUG__` so developers
 * can inspect events from the browser console:
 *
 *   window.__AI_TOWN_CLIENT_DEBUG__?.getEvents()
 */

export interface ClientDebugEvent {
  time: number;
  type: string;
  data?: Record<string, unknown>;
}

const MAX_CLIENT_DEBUG_EVENTS = 200;
const clientDebugEvents: ClientDebugEvent[] = [];

declare global {
  interface Window {
    __AI_TOWN_CLIENT_DEBUG__?: {
      clear(): void;
      getEvents(): ClientDebugEvent[];
    };
  }
}

export function logClientDebugEvent(
  type: string,
  data?: Record<string, unknown>,
): void {
  clientDebugEvents.push({
    time: Date.now(),
    type,
    data,
  });
  if (clientDebugEvents.length > MAX_CLIENT_DEBUG_EVENTS) {
    clientDebugEvents.shift();
  }
  installWindowDebugHandle();
}

export function getClientDebugEvents(): ClientDebugEvent[] {
  return [...clientDebugEvents];
}

export function clearClientDebugEvents(): void {
  clientDebugEvents.length = 0;
}

function installWindowDebugHandle(): void {
  if (typeof window === "undefined") return;
  if (window.__AI_TOWN_CLIENT_DEBUG__) return;
  window.__AI_TOWN_CLIENT_DEBUG__ = {
    clear: clearClientDebugEvents,
    getEvents: getClientDebugEvents,
  };
}
