import { describe, expect, it } from "vitest";
import { buildDashboardTopBarState } from "../../client/src/debugDashboardStatus.js";

describe("debug dashboard top bar state", () => {
  it("builds connected status text with reconnect metadata", () => {
    const topBar = buildDashboardTopBarState({
      connected: true,
      lastMessageAt: 1000,
      disconnectedAt: null,
      reconnectCount: 2,
      formatRelativeTimeFn: () => "5s ago",
      pluralizeFn: (count, singular) => `${count} ${singular}s`,
    });

    expect(topBar).toMatchObject({
      statusText: "Connected",
      statusClassName: "status-pill connected",
      metaText: "Last event 5s ago • 2 reconnects",
      stale: false,
      staleText: "",
    });
  });

  it("builds disconnected stale-banner text from the last event timestamp", () => {
    const topBar = buildDashboardTopBarState({
      connected: false,
      lastMessageAt: 1000,
      disconnectedAt: 1500,
      reconnectCount: 1,
      formatRelativeTimeFn: (value) => (value === 1500 ? "1s ago" : "6s ago"),
      pluralizeFn: (count, singular) => `${count} ${singular}`,
    });

    expect(topBar).toMatchObject({
      statusText: "Disconnected",
      statusClassName: "status-pill disconnected",
      metaText: "Disconnected 1s ago • Last event 6s ago • 1 reconnect",
      stale: true,
      staleText:
        "Debug stream disconnected. The dashboard is showing stale state from 6s ago.",
    });
  });
});
