import { buildDashboardTopBarState } from "./debugDashboardStatus.js";
import type {
  CommandStatus,
  DashboardAlert,
  FrozenActivityState,
} from "./debugDashboardTypes.js";
import {
  buildActivityHtml,
  buildSystemBadgeCount,
  buildSystemHtml,
} from "./debugDashboardViews.js";
import type {
  DebugFeedEvent,
  DebugSystemSnapshot,
  PublicPlayer,
} from "./types.js";

export interface DashboardChromeDomRefs {
  connStatus: HTMLSpanElement;
  connMeta: HTMLSpanElement;
  staleBanner: HTMLDivElement;
  tickDisplay: HTMLSpanElement;
  badgeConvos: HTMLSpanElement;
  badgeNpcs: HTMLSpanElement;
  badgeActivity: HTMLSpanElement;
  badgeSystem: HTMLSpanElement;
}

export interface DashboardActivityDomRefs {
  activityPause: HTMLButtonElement;
  activityClearPins: HTMLButtonElement;
  activityContent: HTMLDivElement;
}

export interface DashboardSystemDomRefs {
  systemContent: HTMLDivElement;
}

export interface DashboardActivityRenderOptions {
  dom: DashboardActivityDomRefs;
  snapshot: FrozenActivityState;
  activityPaused: boolean;
  activitySeverityFilter: "all" | "danger" | "warning" | "info";
  activitySearch: string;
  pinnedItems: Set<string>;
  getPlayerLabel: (playerId: string) => string;
  focusConversation: (convoId: number) => void;
  focusNpc: (npcId: string) => void;
  scheduleRender: (immediate?: boolean) => void;
  setHtml: (element: HTMLElement, key: string, html: string) => boolean;
}

export interface DashboardSystemRenderOptions {
  dom: DashboardSystemDomRefs;
  system: DebugSystemSnapshot | null;
  connected: boolean;
  lastMessageAt: number | null;
  reconnectCount: number;
  alerts: readonly DashboardAlert[];
  selectedNpcId: string | null;
  selectedConversationPlayerIds: string[];
  players: PublicPlayer[];
  screenshotUrl: string | null;
  scenarios: string[];
  commandStatus: CommandStatus;
  tick: number;
  debugToken: string | null;
  autonomyNpcIds: ReadonlySet<string>;
  focusNpc: (npcId: string) => void;
  handleSystemCommand: (
    command: string,
    dataset: DOMStringMap,
  ) => Promise<void>;
  handleSystemFormSubmit: (form: HTMLFormElement) => Promise<void>;
  setHtml: (element: HTMLElement, key: string, html: string) => boolean;
}

export interface DashboardChromeRenderOptions {
  dom: DashboardChromeDomRefs;
  connected: boolean;
  tick: number;
  lastMessageAt: number | null;
  disconnectedAt: number | null;
  reconnectCount: number;
  activeConversationCount: number;
  visibleNpcCount: number;
  alerts: readonly DashboardAlert[];
  system: DebugSystemSnapshot | null;
}

export function renderDashboardChrome(
  options: DashboardChromeRenderOptions,
): void {
  const topBar = buildDashboardTopBarState({
    connected: options.connected,
    lastMessageAt: options.lastMessageAt,
    disconnectedAt: options.disconnectedAt,
    reconnectCount: options.reconnectCount,
  });
  options.dom.connStatus.textContent = topBar.statusText;
  options.dom.connStatus.className = topBar.statusClassName;
  options.dom.tickDisplay.textContent = `Tick ${options.tick}`;
  options.dom.connMeta.textContent = topBar.metaText;
  options.dom.staleBanner.classList.toggle("visible", topBar.stale);
  options.dom.staleBanner.textContent = topBar.staleText;

  options.dom.badgeConvos.textContent = String(options.activeConversationCount);
  options.dom.badgeNpcs.textContent = String(options.visibleNpcCount);
  options.dom.badgeActivity.textContent =
    options.alerts.length > 0 ? String(options.alerts.length) : "0";
  options.dom.badgeSystem.textContent = String(
    buildSystemBadgeCount({
      connected: options.connected,
      system: options.system,
      alerts: options.alerts,
    }),
  );
}

export function renderActivityPanel(
  options: DashboardActivityRenderOptions,
): void {
  options.dom.activityPause.textContent = options.activityPaused
    ? "Resume"
    : "Pause";
  options.dom.activityClearPins.disabled = options.pinnedItems.size === 0;
  const html = buildActivityHtml({
    snapshot: options.snapshot,
    activityPaused: options.activityPaused,
    activitySeverityFilter: options.activitySeverityFilter,
    activitySearch: options.activitySearch,
    pinnedItems: options.pinnedItems,
    getPlayerLabel: options.getPlayerLabel,
  });

  const changed = options.setHtml(
    options.dom.activityContent,
    "activity",
    html,
  );
  if (!changed) {
    return;
  }

  const alertsById = new Map(
    options.snapshot.alerts.map((alert) => [alert.id, alert]),
  );
  for (const card of options.dom.activityContent.querySelectorAll<HTMLElement>(
    "[data-alert-id]",
  )) {
    card.addEventListener("click", (clickEvent) => {
      if (
        (clickEvent.target as HTMLElement | undefined)?.closest?.(
          "[data-pin-key]",
        )
      ) {
        return;
      }
      const alert = alertsById.get(card.dataset.alertId ?? "");
      if (!alert) return;
      if (alert.targetConversationId)
        options.focusConversation(alert.targetConversationId);
      else if (alert.targetNpcId) options.focusNpc(alert.targetNpcId);
    });
  }

  const eventsById = new Map(
    options.snapshot.events.map((event) => [String(event.id), event]),
  );
  for (const card of options.dom.activityContent.querySelectorAll<HTMLElement>(
    "[data-event-id]",
  )) {
    card.addEventListener("click", (clickEvent) => {
      if (
        (clickEvent.target as HTMLElement | undefined)?.closest?.(
          "[data-pin-key]",
        )
      ) {
        return;
      }
      const event = eventsById.get(card.dataset.eventId ?? "");
      if (!event) return;
      if (typeof event.relatedConversationId === "number") {
        options.focusConversation(event.relatedConversationId);
      } else if (event.relatedNpcId) {
        options.focusNpc(event.relatedNpcId);
      } else if (event.subjectType === "npc") {
        options.focusNpc(event.subjectId);
      }
    });
  }

  for (const button of options.dom.activityContent.querySelectorAll<HTMLElement>(
    "[data-pin-key]",
  )) {
    button.addEventListener("click", (clickEvent) => {
      clickEvent.stopPropagation();
      const pinKey = button.dataset.pinKey;
      if (!pinKey) return;
      if (options.pinnedItems.has(pinKey)) {
        options.pinnedItems.delete(pinKey);
      } else {
        options.pinnedItems.add(pinKey);
      }
      options.scheduleRender(true);
    });
  }
}

export function renderSystemPanel(options: DashboardSystemRenderOptions): void {
  const html = buildSystemHtml({
    system: options.system,
    connected: options.connected,
    lastMessageAt: options.lastMessageAt,
    reconnectCount: options.reconnectCount,
    alerts: options.alerts,
    selectedNpcId: options.selectedNpcId,
    selectedConversationPlayerIds: options.selectedConversationPlayerIds,
    players: options.players,
    screenshotUrl: options.screenshotUrl,
    scenarios: options.scenarios,
    commandStatus: options.commandStatus,
    tick: options.tick,
    debugToken: options.debugToken,
  });

  const changed = options.setHtml(options.dom.systemContent, "system", html);
  if (!changed) {
    return;
  }

  for (const button of options.dom.systemContent.querySelectorAll<HTMLElement>(
    "[data-map-player]",
  )) {
    button.addEventListener("click", () => {
      const npcId = button.dataset.mapPlayer;
      if (!npcId) return;
      if (options.autonomyNpcIds.has(npcId)) {
        options.focusNpc(npcId);
      }
    });
  }

  for (const button of options.dom.systemContent.querySelectorAll<HTMLElement>(
    "[data-command]",
  )) {
    button.addEventListener("click", () => {
      void options.handleSystemCommand(
        button.dataset.command ?? "",
        button.dataset,
      );
    });
  }

  for (const form of options.dom.systemContent.querySelectorAll<HTMLFormElement>(
    "form",
  )) {
    form.addEventListener("submit", (event) => {
      event.preventDefault();
      void options.handleSystemFormSubmit(form);
    });
  }
}
