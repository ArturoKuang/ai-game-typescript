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
import type { Conversation, Player } from "./types.js";

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
  preview: string;
}

export interface ConversationDebugView {
  enabled: boolean;
  summary: string;
  cards: ConversationDebugCardView[];
}

/** Item display metadata keyed by item ID. */
const ITEM_DISPLAY: Record<string, { name: string; emoji: string }> = {
  raw_food: { name: "Berries", emoji: "\uD83E\uDED0" },
  cooked_food: { name: "Cooked Food", emoji: "\uD83C\uDF72" },
  bear_meat: { name: "Bear Meat", emoji: "\uD83E\uDD69" },
};

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
  private inventoryHeaderEl: HTMLHeadingElement;
  private inventoryPanelEl: HTMLDivElement;
  private inventoryListEl: HTMLUListElement;
  private conversationDebugToggleEl: HTMLInputElement;
  private conversationDebugOverlayEl: HTMLDivElement;
  private conversationDebugSummaryEl: HTMLDivElement;
  private conversationDebugListEl: HTMLDivElement;
  private inventoryVisible = true;
  private selfId: string | null = null;
  private talkHandler: ((playerId: string) => void) | null = null;
  private acceptHandler: (() => void) | null = null;
  private declineHandler: (() => void) | null = null;
  private endHandler: (() => void) | null = null;
  private debugModeHandler: ((enabled: boolean) => void) | null = null;

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
    this.inventoryHeaderEl = document.getElementById(
      "inventory-header",
    ) as HTMLHeadingElement;
    this.inventoryPanelEl = document.getElementById(
      "inventory-panel",
    ) as HTMLDivElement;
    this.inventoryListEl = document.getElementById(
      "inventory-list",
    ) as HTMLUListElement;
    this.conversationDebugToggleEl = document.getElementById(
      "conversation-debug-checkbox",
    ) as HTMLInputElement;
    this.conversationDebugOverlayEl = document.getElementById(
      "conversation-debug-overlay",
    ) as HTMLDivElement;
    this.conversationDebugSummaryEl = document.getElementById(
      "conversation-debug-summary",
    ) as HTMLDivElement;
    this.conversationDebugListEl = document.getElementById(
      "conversation-debug-list",
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
    this.conversationDebugToggleEl.addEventListener("change", () =>
      this.debugModeHandler?.(this.conversationDebugToggleEl.checked),
    );
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
    this.debugModeHandler = callback;
  }

  renderConversationDebug(view: ConversationDebugView): void {
    this.conversationDebugToggleEl.checked = view.enabled;
    this.conversationDebugOverlayEl.classList.toggle("hidden", !view.enabled);
    this.conversationDebugSummaryEl.textContent = view.summary;
    this.conversationDebugListEl.innerHTML = "";

    if (!view.enabled) {
      return;
    }

    if (view.cards.length === 0) {
      const empty = document.createElement("div");
      empty.className = "conversation-debug-empty";
      empty.textContent = "No conversations to display.";
      this.conversationDebugListEl.appendChild(empty);
      return;
    }

    for (const card of view.cards) {
      const article = document.createElement("article");
      article.className = `conversation-debug-card state-${card.state}`;

      const title = document.createElement("div");
      title.className = "conversation-debug-card-title";
      title.textContent = card.title;

      const meta = document.createElement("div");
      meta.className = "conversation-debug-card-meta";

      const badge = document.createElement("span");
      badge.className = `conversation-debug-badge state-${card.state}`;
      badge.textContent = card.state;

      const idLabel = document.createElement("span");
      idLabel.textContent = `#${card.id}`;

      const detail = document.createElement("span");
      detail.textContent = card.meta;

      meta.appendChild(badge);
      meta.appendChild(idLabel);
      meta.appendChild(detail);

      const preview = document.createElement("div");
      preview.className = "conversation-debug-card-preview";
      preview.textContent = card.preview;

      article.appendChild(title);
      article.appendChild(meta);
      article.appendChild(preview);
      this.conversationDebugListEl.appendChild(article);
    }
  }

  /** Toggle the inventory panel visibility. */
  toggleInventory(): void {
    this.inventoryVisible = !this.inventoryVisible;
    this.inventoryPanelEl.classList.toggle("hidden", !this.inventoryVisible);
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

      const label = document.createElement("span");
      label.className = "inv-item-label";
      label.textContent = `${display.emoji} ${display.name}`;

      const qty = document.createElement("span");
      qty.className = "inv-item-count";
      qty.textContent = `x${count}`;

      li.appendChild(label);
      li.appendChild(qty);
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
}
