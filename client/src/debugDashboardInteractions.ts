import type { DashboardAlert, DashboardState } from "./debugDashboardTypes.js";
import type { DebugFeedEvent } from "./types.js";

type TabId = DashboardState["activeTab"];
type ConversationFilter = DashboardState["conversationFilter"];

export interface DebugDashboardDomRefs {
  convoSearch: HTMLInputElement;
  convoFilters: HTMLDivElement;
  convoList: HTMLDivElement;
  npcSearch: HTMLInputElement;
  npcList: HTMLDivElement;
  npcDetail: HTMLDivElement;
  activitySearch: HTMLInputElement;
  activityFilters: HTMLDivElement;
  activityPause: HTMLButtonElement;
  activityClearPins: HTMLButtonElement;
}

export interface DashboardInteractionBindings {
  switchTab: (tabId: TabId) => void;
  focusConversation: (convoId: number) => void;
  focusNpc: (npcId: string) => void;
  scrollSelectedCard: (container: HTMLElement, selector: string) => void;
  shouldDeferNpcDetailRender: (npcId: string) => boolean;
  markNpcDetailRefreshPending: () => void;
  markNpcDetailRendered: (npcId: string) => void;
  resetNpcDetailRenderState: () => void;
}

export interface BindDashboardInteractionsOptions {
  document: Document;
  dom: DebugDashboardDomRefs;
  state: DashboardState;
  expandedActions: Set<string>;
  htmlCache: Map<string, string>;
  scheduleRender: (immediate?: boolean) => void;
  refreshScenarioList: () => Promise<void>;
  getDerivedAlerts: () => DashboardAlert[];
  getSortedEvents: () => DebugFeedEvent[];
}

export function bindDashboardInteractions(
  options: BindDashboardInteractionsOptions,
): DashboardInteractionBindings {
  const {
    document,
    dom,
    state,
    expandedActions,
    htmlCache,
    scheduleRender,
    refreshScenarioList,
    getDerivedAlerts,
    getSortedEvents,
  } = options;

  let npcDetailHoverLock = false;
  let pendingNpcDetailRefresh = false;
  let lastRenderedNpcDetailId: string | null = null;
  let forceNpcDetailRefresh = false;

  function switchTab(tabId: TabId): void {
    state.activeTab = tabId;
    if (tabId === "system" && state.scenarios.length === 0) {
      void refreshScenarioList();
    }
    for (const button of document.querySelectorAll<HTMLElement>(".tab-btn")) {
      button.classList.toggle("active", button.dataset.tab === tabId);
    }
    for (const panel of document.querySelectorAll<HTMLElement>(".tab-panel")) {
      panel.classList.toggle("active", panel.id === `tab-${tabId}`);
    }
    clearTabHtmlCache(htmlCache);
    scheduleRender(true);
  }

  function focusConversation(convoId: number): void {
    dom.convoSearch.value = "";
    state.conversationFilter = "all";
    setActiveFilterPill(dom.convoFilters, "all");
    state.selectedConversationId = convoId;
    switchTab("conversations");
  }

  function focusNpc(npcId: string): void {
    dom.npcSearch.value = "";
    state.selectedNpcId = npcId;
    expandedActions.clear();
    switchTab("npcs");
  }

  function scrollSelectedCard(container: HTMLElement, selector: string): void {
    const selected = container.querySelector<HTMLElement>(selector);
    selected?.scrollIntoView({ block: "nearest" });
  }

  function handleConversationSelection(target: EventTarget | null): void {
    const card = findClosestElement(target, "[data-convo-id]");
    if (!card) return;
    const convoId = Number(card.dataset.convoId);
    if (Number.isNaN(convoId) || state.selectedConversationId === convoId) {
      return;
    }
    state.selectedConversationId = convoId;
    scheduleRender(true);
  }

  function handleNpcSelection(target: EventTarget | null): void {
    const card = findClosestElement(target, "[data-npc-id]");
    if (!card) return;
    const npcId = card.dataset.npcId;
    if (!npcId || state.selectedNpcId === npcId) {
      return;
    }
    state.selectedNpcId = npcId;
    expandedActions.clear();
    scheduleRender(true);
  }

  function handleNpcDetailInteraction(target: HTMLElement): boolean {
    if (target.closest("#collapse-all-actions")) {
      expandedActions.clear();
      htmlCache.delete("npc-detail");
      forceNpcDetailRefresh = true;
      scheduleRender(true);
      return true;
    }

    const stepEl = target.closest<HTMLElement>("[data-step-key]");
    if (!stepEl) {
      return false;
    }

    const key = stepEl.dataset.stepKey;
    if (!key) {
      return false;
    }

    if (expandedActions.has(key)) {
      expandedActions.delete(key);
    } else {
      expandedActions.add(key);
    }
    htmlCache.delete("npc-detail");
    forceNpcDetailRefresh = true;
    scheduleRender(true);
    return true;
  }

  function isNpcDetailInteractiveTarget(
    target: EventTarget | null,
  ): target is HTMLElement {
    return (
      target instanceof HTMLElement &&
      Boolean(target.closest("[data-step-key], #collapse-all-actions"))
    );
  }

  function releaseNpcDetailHoverLock(): void {
    if (!npcDetailHoverLock) {
      return;
    }
    npcDetailHoverLock = false;
    if (pendingNpcDetailRefresh) {
      htmlCache.delete("npc-detail");
      scheduleRender(true);
    }
  }

  for (const button of document.querySelectorAll<HTMLElement>(".tab-btn")) {
    button.addEventListener("click", () => {
      switchTab(button.dataset.tab as TabId);
    });
  }

  dom.convoList.addEventListener("pointerdown", (event) => {
    if (event.button !== 0) return;
    handleConversationSelection(event.target);
  });

  dom.convoList.addEventListener("click", (event) => {
    handleConversationSelection(event.target);
  });

  dom.npcList.addEventListener("pointerdown", (event) => {
    if (event.button !== 0) return;
    handleNpcSelection(event.target);
  });

  dom.npcList.addEventListener("click", (event) => {
    handleNpcSelection(event.target);
  });

  dom.convoFilters.addEventListener("click", (event) => {
    const pill = findClosestElement(event.target, ".filter-pill");
    if (!pill) return;
    state.conversationFilter = (pill.dataset.filter ??
      "all") as ConversationFilter;
    setActiveFilterPill(dom.convoFilters, state.conversationFilter);
    scheduleRender(true);
  });

  dom.convoSearch.addEventListener("input", () => scheduleRender(true));
  dom.npcSearch.addEventListener("input", () => scheduleRender(true));
  dom.activitySearch.addEventListener("input", () => {
    state.activitySearch = dom.activitySearch.value;
    scheduleRender(true);
  });

  dom.activityFilters.addEventListener("click", (event) => {
    const pill = findClosestElement(event.target, ".filter-pill");
    if (!pill) return;
    state.activitySeverityFilter = (pill.dataset.filter ??
      "all") as DashboardState["activitySeverityFilter"];
    setActiveFilterPill(dom.activityFilters, state.activitySeverityFilter);
    scheduleRender(true);
  });

  dom.activityPause.addEventListener("click", () => {
    state.activityPaused = !state.activityPaused;
    state.frozenActivity = state.activityPaused
      ? {
          alerts: getDerivedAlerts(),
          events: getSortedEvents(),
          capturedAt: Date.now(),
        }
      : null;
    dom.activityPause.textContent = state.activityPaused ? "Resume" : "Pause";
    scheduleRender(true);
  });

  dom.activityClearPins.addEventListener("click", () => {
    state.pinnedItems.clear();
    scheduleRender(true);
  });

  dom.npcDetail.addEventListener("pointerover", (event) => {
    if (!isNpcDetailInteractiveTarget(event.target)) {
      return;
    }
    npcDetailHoverLock = true;
  });

  dom.npcDetail.addEventListener("pointerout", (event) => {
    if (!isNpcDetailInteractiveTarget(event.target)) {
      return;
    }
    if (isNpcDetailInteractiveTarget(event.relatedTarget)) {
      return;
    }
    releaseNpcDetailHoverLock();
  });

  dom.npcDetail.addEventListener("pointerleave", () => {
    releaseNpcDetailHoverLock();
  });

  dom.npcDetail.addEventListener("pointerdown", (event) => {
    if (event.button !== 0) return;
    pendingNpcDetailRefresh = false;
    handleNpcDetailInteraction(event.target as HTMLElement);
  });

  dom.npcDetail.addEventListener("click", (event) => {
    const mouseEvent = event as MouseEvent;
    if (mouseEvent.detail !== 0) {
      return;
    }
    handleNpcDetailInteraction(event.target as HTMLElement);
  });

  return {
    switchTab,
    focusConversation,
    focusNpc,
    scrollSelectedCard,
    shouldDeferNpcDetailRender(npcId: string): boolean {
      return (
        npcDetailHoverLock &&
        !forceNpcDetailRefresh &&
        lastRenderedNpcDetailId === npcId
      );
    },
    markNpcDetailRefreshPending(): void {
      pendingNpcDetailRefresh = true;
    },
    markNpcDetailRendered(npcId: string): void {
      lastRenderedNpcDetailId = npcId;
      pendingNpcDetailRefresh = false;
      forceNpcDetailRefresh = false;
    },
    resetNpcDetailRenderState(): void {
      lastRenderedNpcDetailId = null;
      pendingNpcDetailRefresh = false;
      forceNpcDetailRefresh = false;
    },
  };
}

function clearTabHtmlCache(htmlCache: Map<string, string>): void {
  htmlCache.delete("convo-list");
  htmlCache.delete("convo-detail");
  htmlCache.delete("npc-list");
  htmlCache.delete("npc-detail");
  htmlCache.delete("activity");
  htmlCache.delete("system");
}

function setActiveFilterPill(
  container: HTMLElement,
  filterValue: string,
): void {
  for (const pill of container.querySelectorAll<HTMLElement>(".filter-pill")) {
    pill.classList.toggle("active", pill.dataset.filter === filterValue);
  }
}

function findClosestElement(
  target: EventTarget | null,
  selector: string,
): HTMLElement | null {
  return target instanceof HTMLElement
    ? target.closest<HTMLElement>(selector)
    : null;
}
