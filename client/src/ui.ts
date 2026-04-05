/**
 * DOM-based UI manager for the game sidebar.
 *
 * Manages the player list, chat log, conversation panel (invite/active/end
 * actions), and status bar. All DOM elements are looked up by ID in the
 * constructor — see `client/index.html` for the expected markup.
 *
 * Expected DOM element IDs:
 * - player-list, chat-messages, chat-input, chat-btn, chat-helper
 * - status-bar, conversation-title, conversation-status
 * - invite-actions, active-actions
 * - accept-convo-btn, decline-convo-btn, end-convo-btn
 */
import type {
  Conversation,
  PlanSource,
  Player,
  PlayerSurvivalData,
} from "./types.js";

/** Describes what the conversation panel should display. */
export interface ConversationPanelView {
  title: string;
  status: string;
  chatEnabled: boolean;
  chatPlaceholder: string;
  showInviteActions: boolean;
  showEndAction: boolean;
}

export interface ConversationDebugCardView {
  id: number;
  state: Conversation["state"];
  title: string;
  meta: string;
  participants: ConversationDebugParticipantView[];
  lines: ConversationDebugLineView[];
}

export interface ConversationDebugParticipantView {
  label: string;
  role: "npc" | "human" | "unknown";
}

export interface ConversationDebugLineView {
  speaker?: string;
  content: string;
  kind: "message" | "system";
}

export interface ConversationDebugSectionView {
  key: Conversation["state"];
  title: string;
  summary: string;
  cards: ConversationDebugCardView[];
}

export interface ConversationDebugView {
  enabled: boolean;
  summary: string;
  sections: ConversationDebugSectionView[];
  menuStatus: string;
  menuDetail: string;
  menuTone: "off" | "live" | "error";
}

export interface AutonomyDebugStepView {
  label: string;
  detail?: string;
  isCurrent: boolean;
}

export interface AutonomyDebugCardView {
  npcId: string;
  title: string;
  sourceLabel: string;
  sourceTone: PlanSource | "idle";
  goalLabel: string;
  executionLabel: string;
  meta: string;
  steps: AutonomyDebugStepView[];
}

export interface AutonomyDebugView {
  enabled: boolean;
  summary: string;
  cards: AutonomyDebugCardView[];
  menuStatus: string;
  menuDetail: string;
  menuTone: "off" | "live" | "error";
}

/** Item display metadata keyed by item ID. */
const ITEM_DISPLAY: Record<string, { name: string; emoji: string }> = {
  raw_food: { name: "Berries", emoji: "\uD83E\uDED0" },
  cooked_food: { name: "Cooked Food", emoji: "\uD83C\uDF72" },
  bear_meat: { name: "Bear Meat", emoji: "\uD83E\uDD69" },
};

const SURVIVAL_NEED_META: Array<{
  key: keyof Omit<PlayerSurvivalData, "playerId">;
  label: string;
  color: string;
}> = [
  { key: "health", label: "Health", color: "#e63946" },
  { key: "food", label: "Food", color: "#f4a261" },
  { key: "water", label: "Water", color: "#4dabf7" },
  { key: "social", label: "Social", color: "#4ecdc4" },
];

export class UI {
  private playerListEl: HTMLUListElement;
  private chatMessagesEl: HTMLDivElement;
  private chatInputEl: HTMLInputElement;
  private chatBtnEl: HTMLButtonElement;
  private chatHelperEl: HTMLDivElement;
  private statusEl: HTMLDivElement;
  private conversationTitleEl: HTMLDivElement;
  private conversationStatusEl: HTMLDivElement;
  private inviteActionsEl: HTMLDivElement;
  private activeActionsEl: HTMLDivElement;
  private acceptConvoBtnEl: HTMLButtonElement;
  private declineConvoBtnEl: HTMLButtonElement;
  private endConvoBtnEl: HTMLButtonElement;
  private survivalPanelEl: HTMLDivElement;
  private inventoryHeaderEl: HTMLHeadingElement;
  private inventoryPanelEl: HTMLDivElement;
  private inventoryListEl: HTMLUListElement;
  private debugMenuEl: HTMLDetailsElement;
  private debugMenuVisibilityBtnEl: HTMLButtonElement;
  private conversationDebugToggleEl: HTMLInputElement;
  private conversationDebugToggleCardEl: HTMLLabelElement;
  private conversationDebugMenuStatusEl: HTMLSpanElement;
  private conversationDebugMenuDetailEl: HTMLSpanElement;
  private debugOverlayEl: HTMLDivElement;
  private debugOverlaySummaryEl: HTMLDivElement;
  private debugMenuBadgeEl: HTMLSpanElement;
  private conversationDebugSectionEl: HTMLElement;
  private conversationDebugSummaryEl: HTMLDivElement;
  private conversationDebugListEl: HTMLDivElement;
  private conversationDebugTranscriptScrollPositions = new Map<number, number>();
  private autonomyDebugToggleEl: HTMLInputElement;
  private autonomyDebugToggleCardEl: HTMLLabelElement;
  private autonomyDebugMenuStatusEl: HTMLSpanElement;
  private autonomyDebugMenuDetailEl: HTMLSpanElement;
  private autonomyDebugSectionEl: HTMLElement;
  private autonomyDebugSummaryEl: HTMLDivElement;
  private autonomyDebugListEl: HTMLDivElement;
  private conversationDebugEnabled = false;
  private autonomyDebugEnabled = false;
  private conversationDebugMenuTone: "off" | "live" | "error" = "off";
  private autonomyDebugMenuTone: "off" | "live" | "error" = "off";
  private debugMenuVisible = true;
  private inventoryVisible = true;
  private selfId: string | null = null;
  private talkHandler: ((playerId: string) => void) | null = null;
  private acceptHandler: (() => void) | null = null;
  private declineHandler: (() => void) | null = null;
  private endHandler: (() => void) | null = null;
  private conversationDebugModeHandler: ((enabled: boolean) => void) | null = null;
  private autonomyDebugModeHandler: ((enabled: boolean) => void) | null = null;
  private useItemHandler: ((itemId: string) => void) | null = null;

  constructor() {
    this.playerListEl = document.getElementById(
      "player-list",
    ) as HTMLUListElement;
    this.chatMessagesEl = document.getElementById(
      "chat-messages",
    ) as HTMLDivElement;
    this.chatInputEl = document.getElementById(
      "chat-input",
    ) as HTMLInputElement;
    this.chatBtnEl = document.getElementById("chat-btn") as HTMLButtonElement;
    this.chatHelperEl = document.getElementById(
      "chat-helper",
    ) as HTMLDivElement;
    this.statusEl = document.getElementById("status-bar") as HTMLDivElement;
    this.conversationTitleEl = document.getElementById(
      "conversation-title",
    ) as HTMLDivElement;
    this.conversationStatusEl = document.getElementById(
      "conversation-status",
    ) as HTMLDivElement;
    this.inviteActionsEl = document.getElementById(
      "invite-actions",
    ) as HTMLDivElement;
    this.activeActionsEl = document.getElementById(
      "active-actions",
    ) as HTMLDivElement;
    this.acceptConvoBtnEl = document.getElementById(
      "accept-convo-btn",
    ) as HTMLButtonElement;
    this.declineConvoBtnEl = document.getElementById(
      "decline-convo-btn",
    ) as HTMLButtonElement;
    this.endConvoBtnEl = document.getElementById(
      "end-convo-btn",
    ) as HTMLButtonElement;
    this.survivalPanelEl = document.getElementById(
      "survival-panel",
    ) as HTMLDivElement;
    this.inventoryHeaderEl = document.getElementById(
      "inventory-header",
    ) as HTMLHeadingElement;
    this.inventoryPanelEl = document.getElementById(
      "inventory-panel",
    ) as HTMLDivElement;
    this.inventoryListEl = document.getElementById(
      "inventory-list",
    ) as HTMLUListElement;
    this.debugMenuEl = document.getElementById(
      "debug-menu",
    ) as HTMLDetailsElement;
    this.debugMenuVisibilityBtnEl = document.getElementById(
      "debug-menu-visibility-btn",
    ) as HTMLButtonElement;
    this.conversationDebugToggleEl = document.getElementById(
      "conversation-debug-checkbox",
    ) as HTMLInputElement;
    this.conversationDebugToggleCardEl = document.getElementById(
      "conversation-debug-toggle-card",
    ) as HTMLLabelElement;
    this.conversationDebugMenuStatusEl = document.getElementById(
      "conversation-debug-menu-status",
    ) as HTMLSpanElement;
    this.conversationDebugMenuDetailEl = document.getElementById(
      "conversation-debug-menu-detail",
    ) as HTMLSpanElement;
    this.debugOverlayEl = document.getElementById(
      "debug-overlay",
    ) as HTMLDivElement;
    this.debugOverlaySummaryEl = document.getElementById(
      "debug-overlay-summary",
    ) as HTMLDivElement;
    this.debugMenuBadgeEl = document.getElementById(
      "debug-menu-badge",
    ) as HTMLSpanElement;
    this.conversationDebugSectionEl = document.getElementById(
      "conversation-debug-section",
    ) as HTMLElement;
    this.conversationDebugSummaryEl = document.getElementById(
      "conversation-debug-summary",
    ) as HTMLDivElement;
    this.conversationDebugListEl = document.getElementById(
      "conversation-debug-list",
    ) as HTMLDivElement;
    this.autonomyDebugToggleEl = document.getElementById(
      "autonomy-debug-checkbox",
    ) as HTMLInputElement;
    this.autonomyDebugToggleCardEl = document.getElementById(
      "autonomy-debug-toggle-card",
    ) as HTMLLabelElement;
    this.autonomyDebugMenuStatusEl = document.getElementById(
      "autonomy-debug-menu-status",
    ) as HTMLSpanElement;
    this.autonomyDebugMenuDetailEl = document.getElementById(
      "autonomy-debug-menu-detail",
    ) as HTMLSpanElement;
    this.autonomyDebugSectionEl = document.getElementById(
      "autonomy-debug-section",
    ) as HTMLElement;
    this.autonomyDebugSummaryEl = document.getElementById(
      "autonomy-debug-summary",
    ) as HTMLDivElement;
    this.autonomyDebugListEl = document.getElementById(
      "autonomy-debug-list",
    ) as HTMLDivElement;

    this.acceptConvoBtnEl.addEventListener("click", () =>
      this.acceptHandler?.(),
    );
    this.declineConvoBtnEl.addEventListener("click", () =>
      this.declineHandler?.(),
    );
    this.endConvoBtnEl.addEventListener("click", () => this.endHandler?.());
    this.inventoryHeaderEl.addEventListener("click", () =>
      this.toggleInventory(),
    );
    this.debugMenuVisibilityBtnEl.addEventListener("click", () =>
      this.toggleDebugMenuVisibility(),
    );
    this.conversationDebugToggleEl.addEventListener("change", () =>
      this.conversationDebugModeHandler?.(this.conversationDebugToggleEl.checked),
    );
    this.autonomyDebugToggleEl.addEventListener("change", () =>
      this.autonomyDebugModeHandler?.(this.autonomyDebugToggleEl.checked),
    );

    this.syncDebugMenuVisibility();
  }

  setSelfId(id: string): void {
    this.selfId = id;
  }

  setStatus(text: string): void {
    this.statusEl.textContent = text;
  }

  updatePlayerList(
    players: Player[],
    talkablePlayerIds: ReadonlySet<string>,
  ): void {
    this.playerListEl.innerHTML = "";
    for (const player of players) {
      const li = document.createElement("li");
      const row = document.createElement("div");
      const label = document.createElement("span");
      const isSelf = player.id === this.selfId;

      li.className = isSelf
        ? "player-self"
        : player.isNpc
          ? "player-npc"
          : "player-human";
      row.className = "player-row";
      label.className = "player-label";
      label.textContent = `${player.name}${isSelf ? " (you)" : ""}${this.stateIcon(player)}`;
      row.appendChild(label);

      if (!isSelf) {
        const button = document.createElement("button");
        button.className = "player-talk-btn";
        button.textContent = "Talk";
        button.disabled = !talkablePlayerIds.has(player.id);
        button.addEventListener("click", () => this.talkHandler?.(player.id));
        row.appendChild(button);
      }

      li.appendChild(row);
      this.playerListEl.appendChild(li);
    }
  }

  renderConversationPanel(view: ConversationPanelView): void {
    this.conversationTitleEl.textContent = view.title;
    this.conversationStatusEl.textContent = view.status;
    this.chatHelperEl.textContent = view.status;
    this.chatInputEl.disabled = !view.chatEnabled;
    this.chatBtnEl.disabled = !view.chatEnabled;
    this.chatInputEl.placeholder = view.chatPlaceholder;
    this.inviteActionsEl.classList.toggle("hidden", !view.showInviteActions);
    this.activeActionsEl.classList.toggle("hidden", !view.showEndAction);
  }

  updatePlayerSurvival(survival: PlayerSurvivalData | null): void {
    this.survivalPanelEl.innerHTML = "";

    if (!survival) {
      const empty = document.createElement("div");
      empty.className = "survival-empty";
      empty.textContent = this.selfId
        ? "Waiting for survival data..."
        : "Join to see your survival values.";
      this.survivalPanelEl.appendChild(empty);
      return;
    }

    for (const need of SURVIVAL_NEED_META) {
      const row = document.createElement("div");
      row.className = "survival-row";

      const header = document.createElement("div");
      header.className = "survival-row-header";

      const label = document.createElement("span");
      label.className = "survival-label";
      label.textContent = need.label;

      const value = document.createElement("span");
      value.className = "survival-value";
      value.textContent = survival[need.key].toFixed(0);

      header.appendChild(label);
      header.appendChild(value);

      const bar = document.createElement("div");
      bar.className = "survival-bar";

      const fill = document.createElement("div");
      fill.className = "survival-fill";
      fill.style.background = need.color;
      fill.style.width = `${Math.max(0, Math.min(100, survival[need.key]))}%`;

      bar.appendChild(fill);
      row.appendChild(header);
      row.appendChild(bar);
      this.survivalPanelEl.appendChild(row);
    }
  }

  addChatMessage(senderName: string, content: string, isSystem = false): void {
    const div = document.createElement("div");
    div.className = "chat-msg";
    if (isSystem) {
      div.innerHTML = `<span class="system">${this.escapeHtml(content)}</span>`;
    } else {
      div.innerHTML = `<span class="sender">${this.escapeHtml(senderName)}:</span> ${this.escapeHtml(content)}`;
    }
    this.chatMessagesEl.appendChild(div);
    this.chatMessagesEl.scrollTop = this.chatMessagesEl.scrollHeight;
  }

  onChatSubmit(callback: (text: string) => void): void {
    const submit = () => {
      const text = this.chatInputEl.value.trim();
      if (!text || this.chatInputEl.disabled) return;
      callback(text);
      this.chatInputEl.value = "";
    };

    this.chatBtnEl.addEventListener("click", submit);
    this.chatInputEl.addEventListener("keydown", (event) => {
      if (event.key === "Enter") submit();
    });
  }

  onTalk(callback: (playerId: string) => void): void {
    this.talkHandler = callback;
  }

  onAcceptConversation(callback: () => void): void {
    this.acceptHandler = callback;
  }

  onDeclineConversation(callback: () => void): void {
    this.declineHandler = callback;
  }

  onEndConversation(callback: () => void): void {
    this.endHandler = callback;
  }

  onConversationDebugModeChange(callback: (enabled: boolean) => void): void {
    this.conversationDebugModeHandler = callback;
  }

  onAutonomyDebugModeChange(callback: (enabled: boolean) => void): void {
    this.autonomyDebugModeHandler = callback;
  }

  onUseInventoryItem(callback: (itemId: string) => void): void {
    this.useItemHandler = callback;
  }

  renderConversationDebug(view: ConversationDebugView): void {
    this.conversationDebugToggleEl.checked = view.enabled;
    this.conversationDebugEnabled = view.enabled;
    this.conversationDebugMenuTone = view.menuTone;
    this.conversationDebugSectionEl.classList.toggle("hidden", !view.enabled);
    this.conversationDebugSummaryEl.textContent = view.summary;
    this.syncDebugFeatureCard(
      this.conversationDebugToggleCardEl,
      this.conversationDebugMenuStatusEl,
      this.conversationDebugMenuDetailEl,
      view.enabled,
      view.menuTone,
      view.menuStatus,
      view.menuDetail,
    );
    const listScrollTop = this.conversationDebugListEl.scrollTop;
    this.captureConversationDebugTranscriptScrollPositions();
    this.conversationDebugListEl.innerHTML = "";

    if (!view.enabled) {
      this.syncDebugOverlayVisibility();
      return;
    }

    const sections = view.sections.filter((section) => section.cards.length > 0);

    if (sections.length === 0) {
      const empty = document.createElement("div");
      empty.className = "conversation-debug-empty";
      empty.textContent = "No conversations to display.";
      this.conversationDebugListEl.appendChild(empty);
      this.syncDebugOverlayVisibility();
      return;
    }

    for (const section of sections) {
      const sectionEl = document.createElement("section");
      sectionEl.className = `conversation-debug-section state-${section.key}`;

      const sectionHeader = document.createElement("div");
      sectionHeader.className = "conversation-debug-section-header";

      const sectionTitle = document.createElement("div");
      sectionTitle.className = "conversation-debug-section-title";
      sectionTitle.textContent = section.title;

      const sectionSummary = document.createElement("div");
      sectionSummary.className = "conversation-debug-section-summary";
      sectionSummary.textContent = section.summary;

      sectionHeader.appendChild(sectionTitle);
      sectionHeader.appendChild(sectionSummary);
      sectionEl.appendChild(sectionHeader);

      const sectionCards = document.createElement("div");
      sectionCards.className = "conversation-debug-section-cards";

      for (const card of section.cards) {
        const article = document.createElement("article");
        article.className = `conversation-debug-card state-${card.state}`;
        article.style.setProperty(
          "--conversation-accent",
          this.getConversationAccent(card.id),
        );

        const header = document.createElement("div");
        header.className = "conversation-debug-card-header";

        const title = document.createElement("div");
        title.className = "conversation-debug-card-title";
        title.textContent = card.title;

        const idLabel = document.createElement("span");
        idLabel.className = "conversation-debug-id";
        idLabel.textContent = `#${card.id}`;

        header.appendChild(title);
        header.appendChild(idLabel);

        const participants = document.createElement("div");
        participants.className = "conversation-debug-participants";

        for (const participant of card.participants) {
          const chip = document.createElement("span");
          chip.className = `conversation-debug-participant role-${participant.role}`;
          chip.textContent = participant.label;
          participants.appendChild(chip);
        }

        const meta = document.createElement("div");
        meta.className = "conversation-debug-card-meta";

        const badge = document.createElement("span");
        badge.className = `conversation-debug-badge state-${card.state}`;
        badge.textContent = card.state;

        const detail = document.createElement("span");
        detail.textContent = card.meta;

        meta.appendChild(badge);
        meta.appendChild(detail);

        const transcript = document.createElement("div");
        transcript.className = "conversation-debug-transcript";
        transcript.dataset.conversationId = String(card.id);
        transcript.addEventListener("scroll", () => {
          this.conversationDebugTranscriptScrollPositions.set(
            card.id,
            transcript.scrollTop,
          );
        });

        for (const line of card.lines) {
          const row = document.createElement("div");
          row.className = `conversation-debug-line kind-${line.kind}`;

          if (line.speaker) {
            const speaker = document.createElement("span");
            speaker.className = "conversation-debug-line-speaker";
            speaker.textContent = `${line.speaker}:`;
            row.appendChild(speaker);
          }

          const content = document.createElement("span");
          content.className = "conversation-debug-line-content";
          content.textContent = line.content;
          row.appendChild(content);
          transcript.appendChild(row);
        }

        const previousTranscriptScrollTop =
          this.conversationDebugTranscriptScrollPositions.get(card.id);
        if (previousTranscriptScrollTop !== undefined) {
          transcript.scrollTop = previousTranscriptScrollTop;
        }

        article.appendChild(header);
        article.appendChild(participants);
        article.appendChild(meta);
        article.appendChild(transcript);
        sectionCards.appendChild(article);
      }

      sectionEl.appendChild(sectionCards);
      this.conversationDebugListEl.appendChild(sectionEl);
    }

    this.conversationDebugListEl.scrollTop = listScrollTop;
    this.syncDebugOverlayVisibility();
  }

  renderAutonomyDebug(view: AutonomyDebugView): void {
    this.autonomyDebugToggleEl.checked = view.enabled;
    this.autonomyDebugEnabled = view.enabled;
    this.autonomyDebugMenuTone = view.menuTone;
    this.autonomyDebugSectionEl.classList.toggle("hidden", !view.enabled);
    this.autonomyDebugSummaryEl.textContent = view.summary;
    this.syncDebugFeatureCard(
      this.autonomyDebugToggleCardEl,
      this.autonomyDebugMenuStatusEl,
      this.autonomyDebugMenuDetailEl,
      view.enabled,
      view.menuTone,
      view.menuStatus,
      view.menuDetail,
    );
    const listScrollTop = this.autonomyDebugListEl.scrollTop;
    this.autonomyDebugListEl.innerHTML = "";

    if (!view.enabled) {
      this.syncDebugOverlayVisibility();
      return;
    }

    if (view.cards.length === 0) {
      const empty = document.createElement("div");
      empty.className = "autonomy-debug-empty";
      empty.textContent = "No NPC autonomy state to display.";
      this.autonomyDebugListEl.appendChild(empty);
      this.syncDebugOverlayVisibility();
      return;
    }

    for (const card of view.cards) {
      const article = document.createElement("article");
      article.className = "autonomy-debug-card";

      const header = document.createElement("div");
      header.className = "autonomy-debug-card-header";

      const title = document.createElement("div");
      title.className = "autonomy-debug-card-title";
      title.textContent = card.title;

      const source = document.createElement("span");
      source.className = `autonomy-debug-source source-${card.sourceTone}`;
      source.textContent = card.sourceLabel;

      header.appendChild(title);
      header.appendChild(source);

      const goal = document.createElement("div");
      goal.className = "autonomy-debug-goal";
      goal.textContent = card.goalLabel;

      const execution = document.createElement("div");
      execution.className = "autonomy-debug-execution";
      execution.textContent = card.executionLabel;

      const meta = document.createElement("div");
      meta.className = "autonomy-debug-meta";
      meta.textContent = card.meta;

      article.appendChild(header);
      article.appendChild(goal);
      article.appendChild(execution);
      article.appendChild(meta);

      if (card.steps.length > 0) {
        const steps = document.createElement("ol");
        steps.className = "autonomy-debug-steps";

        for (const step of card.steps) {
          const item = document.createElement("li");
          item.className = `autonomy-debug-step${step.isCurrent ? " is-current" : ""}`;

          const label = document.createElement("div");
          label.className = "autonomy-debug-step-label";
          label.textContent = step.label;
          item.appendChild(label);

          if (step.detail) {
            const detail = document.createElement("div");
            detail.className = "autonomy-debug-step-detail";
            detail.textContent = step.detail;
            item.appendChild(detail);
          }

          steps.appendChild(item);
        }

        article.appendChild(steps);
      }

      this.autonomyDebugListEl.appendChild(article);
    }

    this.autonomyDebugListEl.scrollTop = listScrollTop;
    this.syncDebugOverlayVisibility();
  }

  /** Toggle the inventory panel visibility. */
  toggleInventory(): void {
    this.inventoryVisible = !this.inventoryVisible;
    this.inventoryPanelEl.classList.toggle("hidden", !this.inventoryVisible);
  }

  toggleDebugMenuVisibility(): void {
    this.debugMenuVisible = !this.debugMenuVisible;
    this.syncDebugMenuVisibility();
  }

  /** Update the inventory display with new data from the server. */
  updateInventory(items: Record<string, number>, capacity: number): void {
    const entries = Object.entries(items).filter(([, count]) => count > 0);
    const slotCount = entries.length;

    this.inventoryHeaderEl.textContent = `Inventory (${slotCount}/${capacity}) [I]`;
    this.inventoryListEl.innerHTML = "";

    if (entries.length === 0) {
      const empty = document.createElement("li");
      empty.className = "inv-empty";
      empty.textContent = "Empty \u2014 press E near items to pick up";
      this.inventoryListEl.appendChild(empty);
      return;
    }

    for (const [itemId, count] of entries) {
      const display = ITEM_DISPLAY[itemId] ?? { name: itemId, emoji: "\uD83D\uDCE6" };
      const li = document.createElement("li");
      li.className = "inv-item-row";

      const label = document.createElement("span");
      label.className = "inv-item-label";
      label.textContent = `${display.emoji} ${display.name}`;

      const qty = document.createElement("span");
      qty.className = "inv-item-count";
      qty.textContent = `x${count}`;

      li.appendChild(label);
      li.appendChild(qty);

      if (["raw_food", "cooked_food", "bear_meat"].includes(itemId)) {
        const button = document.createElement("button");
        button.className = "player-talk-btn";
        button.textContent = "Eat";
        button.addEventListener("click", () => this.useItemHandler?.(itemId));
        li.appendChild(button);
      }

      this.inventoryListEl.appendChild(li);
    }
  }

  /** Map player state to a suffix icon for the player list. */
  private stateIcon(player: Player): string {
    if (player.isWaitingForResponse) return " ...";
    if (player.state === "conversing") return " 💬";
    if (player.state === "walking") return " 🚶";
    if (player.state === "doing_activity") return " 📖";
    return "";
  }

  /** Escape HTML to prevent XSS when inserting user-provided text into the DOM. */
  private escapeHtml(text: string): string {
    const div = document.createElement("div");
    div.textContent = text;
    return div.innerHTML;
  }

  private getConversationAccent(conversationId: number): string {
    const hue = (conversationId * 47) % 360;
    return `hsl(${hue}, 72%, 62%)`;
  }

  private captureConversationDebugTranscriptScrollPositions(): void {
    const transcripts = this.conversationDebugListEl.querySelectorAll<HTMLDivElement>(
      ".conversation-debug-transcript[data-conversation-id]",
    );

    for (const transcript of transcripts) {
      const conversationId = Number(transcript.dataset.conversationId);
      if (!Number.isFinite(conversationId)) {
        continue;
      }
      this.conversationDebugTranscriptScrollPositions.set(
        conversationId,
        transcript.scrollTop,
      );
    }
  }

  private syncDebugOverlayVisibility(): void {
    const activeSections: string[] = [];
    if (this.conversationDebugEnabled) {
      activeSections.push("Conversations");
    }
    if (this.autonomyDebugEnabled) {
      activeSections.push("NPC autonomy");
    }

    this.debugOverlayEl.classList.toggle("hidden", activeSections.length === 0);
    this.debugOverlaySummaryEl.textContent =
      activeSections.length === 0
        ? "Debug mode off"
        : activeSections.join(" + ");

    const enabledCount = activeSections.length;
    const badgeTone =
      this.conversationDebugMenuTone === "error" ||
      this.autonomyDebugMenuTone === "error"
        ? "error"
        : enabledCount > 0
          ? "live"
          : "off";
    this.debugMenuBadgeEl.className = `debug-menu-badge tone-${badgeTone}`;
    this.debugMenuBadgeEl.textContent =
      enabledCount === 0
        ? "Overlay off"
        : `${enabledCount} live feature${enabledCount === 1 ? "" : "s"}`;
  }

  private syncDebugMenuVisibility(): void {
    this.debugMenuEl.classList.toggle("hidden", !this.debugMenuVisible);
    this.debugMenuVisibilityBtnEl.classList.toggle(
      "is-active",
      this.debugMenuVisible,
    );
    this.debugMenuVisibilityBtnEl.textContent = this.debugMenuVisible
      ? "Hide Debug"
      : "Show Debug";
    this.debugMenuVisibilityBtnEl.setAttribute(
      "aria-expanded",
      String(this.debugMenuVisible),
    );
  }

  private syncDebugFeatureCard(
    cardEl: HTMLLabelElement,
    statusEl: HTMLSpanElement,
    detailEl: HTMLSpanElement,
    enabled: boolean,
    tone: "off" | "live" | "error",
    status: string,
    detail: string,
  ): void {
    cardEl.classList.toggle("is-enabled", enabled);
    statusEl.className = `debug-feature-status tone-${tone}`;
    statusEl.textContent = status;
    detailEl.textContent = detail;
  }
}
