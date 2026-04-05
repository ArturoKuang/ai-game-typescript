/**
 * Minimal WebSocket client for the game server.
 *
 * Auto-reconnects on disconnect (2 s delay). Messages sent while
 * disconnected are silently dropped—no offline queue.
 * Defaults to `ws(s)://<current hostname>:3001` (the game server port).
 */
import type { ClientMessage, ServerMessage } from "./types.js";

export type MessageHandler = (msg: ServerMessage) => void;

export class GameClient {
  private ws: WebSocket | null = null;
  private handlers: MessageHandler[] = [];
  private openHandlers: Array<() => void> = [];
  private closeHandlers: Array<() => void> = [];
  private url: string;

  constructor(url?: string) {
    const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
    // Connect directly to the game server, bypassing Vite proxy
    this.url = url ?? `${protocol}//${window.location.hostname}:3001`;
  }

  connect(): void {
    this.ws = new WebSocket(this.url);

    this.ws.onopen = () => {
      console.log("WebSocket connected");
      for (const handler of this.openHandlers) {
        handler();
      }
    };

    this.ws.onmessage = (event) => {
      try {
        const msg = JSON.parse(event.data) as ServerMessage;
        for (const h of this.handlers) h(msg);
      } catch (err) {
        console.error("Failed to parse message:", err);
      }
    };

    this.ws.onclose = () => {
      console.log("WebSocket disconnected, reconnecting in 2s...");
      for (const handler of this.closeHandlers) {
        handler();
      }
      setTimeout(() => this.connect(), 2000);
    };

    this.ws.onerror = (err) => {
      console.error("WebSocket error:", err);
    };
  }

  send(msg: ClientMessage): void {
    if (this.ws?.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(msg));
    }
  }

  onMessage(handler: MessageHandler): void {
    this.handlers.push(handler);
  }

  onOpen(handler: () => void): void {
    this.openHandlers.push(handler);
  }

  onClose(handler: () => void): void {
    this.closeHandlers.push(handler);
  }

  get connected(): boolean {
    return this.ws?.readyState === WebSocket.OPEN;
  }
}
