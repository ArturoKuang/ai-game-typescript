import { formatRelativeTime, pluralize } from "./debugDashboardFormatting.js";

export interface DashboardTopBarState {
  statusText: string;
  statusClassName: string;
  metaText: string;
  stale: boolean;
  staleText: string;
}

export interface DashboardTopBarStateOptions {
  connected: boolean;
  lastMessageAt: number | null;
  disconnectedAt: number | null;
  reconnectCount: number;
  formatRelativeTimeFn?: (timestamp: number | null) => string;
  pluralizeFn?: (count: number, singular: string, plural?: string) => string;
}

export function buildDashboardTopBarState(
  options: DashboardTopBarStateOptions,
): DashboardTopBarState {
  const formatRelativeTimeFn =
    options.formatRelativeTimeFn ?? formatRelativeTime;
  const pluralizeFn = options.pluralizeFn ?? pluralize;
  const lastMessage = options.lastMessageAt
    ? `Last event ${formatRelativeTimeFn(options.lastMessageAt)}`
    : "Waiting for stream";
  const reconnects =
    options.reconnectCount > 0
      ? ` • ${pluralizeFn(options.reconnectCount, "reconnect")}`
      : "";
  const stale = !options.connected;

  return {
    statusText: options.connected ? "Connected" : "Disconnected",
    statusClassName: `status-pill ${options.connected ? "connected" : "disconnected"}`,
    metaText: options.connected
      ? `${lastMessage}${reconnects}`
      : `Disconnected ${formatRelativeTimeFn(options.disconnectedAt)} • ${lastMessage}${reconnects}`,
    stale,
    staleText: stale
      ? `Debug stream disconnected. The dashboard is showing stale state from ${formatRelativeTimeFn(options.lastMessageAt)}.`
      : "",
  };
}
