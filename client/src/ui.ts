/**
 * DOM-based UI manager for the game sidebar.
 *
 * Manages the player list, chat log, conversation panel, survival panel,
 * and inventory. Debug controls intentionally live in the separate dashboard.
 */
import type { Player, PlayerSurvivalData } from "./types.js";

/** Describes what the conversation panel should display. */
export interface ConversationPanelView {
  title: string;
  status: string;
  chatEnabled: boolean;
  chatPlaceholder: string;
  showInviteActions: boolean;
  showEndAction: boolean;
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

function requireElement<T extends HTMLElement>(id: string): T {
  const element = document.getElementById(id);
  if (!element) {
    throw new Error(`Missing required UI element: #${id}`);
  }
  return element as T;
}

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
  private inventoryVisible = true;
  private selfId: string | null = null;
  private talkHandler: ((playerId: string) => void) | null = null;
  private acceptHandler: (() => void) | null = null;
  private declineHandler: (() => void) | null = null;
  private endHandler: (() => void) | null = null;
  private useItemHandler: ((itemId: string) => void) | null = null;

  constructor() {
    this.playerListEl = requireElement<HTMLUListElement>("player-list");
    this.chatMessagesEl = requireElement<HTMLDivElement>("chat-messages");
    this.chatInputEl = requireElement<HTMLInputElement>("chat-input");
    this.chatBtnEl = requireElement<HTMLButtonElement>("chat-btn");
    this.chatHelperEl = requireElement<HTMLDivElement>("chat-helper");
    this.statusEl = requireElement<HTMLDivElement>("status-bar");
    this.conversationTitleEl = requireElement<HTMLDivElement>("conversation-title");
    this.conversationStatusEl = requireElement<HTMLDivElement>("conversation-status");
    this.inviteActionsEl = requireElement<HTMLDivElement>("invite-actions");
    this.activeActionsEl = requireElement<HTMLDivElement>("active-actions");
    this.acceptConvoBtnEl = requireElement<HTMLButtonElement>("accept-convo-btn");
    this.declineConvoBtnEl = requireElement<HTMLButtonElement>("decline-convo-btn");
    this.endConvoBtnEl = requireElement<HTMLButtonElement>("end-convo-btn");
    this.survivalPanelEl = requireElement<HTMLDivElement>("survival-panel");
    this.inventoryHeaderEl = requireElement<HTMLHeadingElement>("inventory-header");
    this.inventoryPanelEl = requireElement<HTMLDivElement>("inventory-panel");
    this.inventoryListEl = requireElement<HTMLUListElement>("inventory-list");

    this.acceptConvoBtnEl.addEventListener("click", () => this.acceptHandler?.());
    this.declineConvoBtnEl.addEventListener("click", () =>
      this.declineHandler?.(),
    );
    this.endConvoBtnEl.addEventListener("click", () => this.endHandler?.());
    this.inventoryHeaderEl.addEventListener("click", () => this.toggleInventory());
  }

  setSelfId(id: string | null): void {
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

  onUseInventoryItem(callback: (itemId: string) => void): void {
    this.useItemHandler = callback;
  }

  toggleInventory(): void {
    this.inventoryVisible = !this.inventoryVisible;
    this.inventoryPanelEl.classList.toggle("hidden", !this.inventoryVisible);
  }

  updateInventory(items: Record<string, number>, capacity: number): void {
    const entries = Object.entries(items).filter(([, count]) => count > 0);
    const slotCount = entries.length;

    this.inventoryHeaderEl.textContent = `Inventory (${slotCount}/${capacity}) [I]`;
    this.inventoryListEl.innerHTML = "";

    if (entries.length === 0) {
      const empty = document.createElement("li");
      empty.className = "inv-empty";
      empty.textContent = "Empty — press E near items to pick up";
      this.inventoryListEl.appendChild(empty);
      return;
    }

    for (const [itemId, count] of entries) {
      const display = ITEM_DISPLAY[itemId] ?? {
        name: itemId,
        emoji: "\uD83D\uDCE6",
      };
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
}
