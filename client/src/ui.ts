/**
 * HUD manager — writes to the floating DOM zones over the game canvas.
 *
 * Phase 3 relocated the sidebar into four HUD zones + two modals:
 *   - needs ring (top-left, canvas-drawn radial arcs)
 *   - event log (top-right, fading system messages)
 *   - actor badge (bottom-left, self status)
 *   - chat bar (bottom-center, expands on focus)
 *   - Tab modal (centered player list)
 *   - I drawer (bottom inventory grid)
 *
 * Debug controls intentionally live in the separate dashboard.
 */
import type { Player, PlayerSurvivalData } from "./types.js";

/** Describes what the chat bar should display for the current conversation. */
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
  cooked_food: { name: "Cooked", emoji: "\uD83C\uDF72" },
  bear_meat: { name: "Meat", emoji: "\uD83E\uDD69" },
};

const NEED_RING_COLORS = {
  ok: "#d9b779",
  warn: "#e07a2c",
  crit: "#7a2a2a",
} as const;

const NEED_RING_RADII = [82, 64, 46, 28];
const NEED_KEYS: Array<keyof Omit<PlayerSurvivalData, "playerId">> = [
  "health",
  "food",
  "water",
  "social",
];

function requireElement<T extends HTMLElement>(id: string): T {
  const element = document.getElementById(id);
  if (!element) {
    throw new Error(`Missing required UI element: #${id}`);
  }
  return element as T;
}

function optionalElement<T extends HTMLElement>(id: string): T | null {
  const element = document.getElementById(id);
  return (element as T | null) ?? null;
}

function severityColor(value: number): string {
  if (value < 25) return NEED_RING_COLORS.crit;
  if (value < 55) return NEED_RING_COLORS.warn;
  return NEED_RING_COLORS.ok;
}

export class UI {
  private playerListEl: HTMLUListElement;
  private chatHistoryEl: HTMLDivElement;
  private chatInputEl: HTMLInputElement;
  private chatBtnEl: HTMLButtonElement;
  private statusEl: HTMLDivElement;
  private inviteActionsEl: HTMLDivElement;
  private activeActionsEl: HTMLDivElement;
  private acceptConvoBtnEl: HTMLButtonElement;
  private declineConvoBtnEl: HTMLButtonElement;
  private endConvoBtnEl: HTMLButtonElement;
  private inventoryHeaderEl: HTMLHeadingElement;
  private inventoryDrawerEl: HTMLDivElement;
  private inventoryListEl: HTMLUListElement;
  private needsCanvas: HTMLCanvasElement;
  private needsCtx: CanvasRenderingContext2D | null;
  private eventLogEl: HTMLDivElement;
  private actorBadgeNameEl: HTMLDivElement;
  private actorBadgeActivityEl: HTMLDivElement;
  private chatBarEl: HTMLDivElement;
  private chatBarPartnerEl: HTMLDivElement;
  private tabModalEl: HTMLDivElement;
  private joinOverlayEl: HTMLElement | null;
  private inventoryVisible = false;
  private tabModalVisible = false;
  private selfId: string | null = null;
  private talkHandler: ((playerId: string) => void) | null = null;
  private attackHandler: ((playerId: string) => void) | null = null;
  private acceptHandler: (() => void) | null = null;
  private declineHandler: (() => void) | null = null;
  private endHandler: (() => void) | null = null;
  private useItemHandler: ((itemId: string) => void) | null = null;

  constructor() {
    this.playerListEl = requireElement<HTMLUListElement>("player-list");
    this.chatHistoryEl = requireElement<HTMLDivElement>("chat-history");
    this.chatInputEl = requireElement<HTMLInputElement>("chat-input");
    this.chatBtnEl = requireElement<HTMLButtonElement>("chat-btn");
    this.statusEl = requireElement<HTMLDivElement>("status-bar");
    this.inviteActionsEl = requireElement<HTMLDivElement>("invite-actions");
    this.activeActionsEl = requireElement<HTMLDivElement>("active-actions");
    this.acceptConvoBtnEl =
      requireElement<HTMLButtonElement>("accept-convo-btn");
    this.declineConvoBtnEl =
      requireElement<HTMLButtonElement>("decline-convo-btn");
    this.endConvoBtnEl = requireElement<HTMLButtonElement>("end-convo-btn");
    this.inventoryHeaderEl =
      requireElement<HTMLHeadingElement>("inventory-header");
    this.inventoryDrawerEl = requireElement<HTMLDivElement>("inventory-drawer");
    this.inventoryListEl = requireElement<HTMLUListElement>("inventory-list");
    this.needsCanvas = requireElement<HTMLCanvasElement>("needs-ring-canvas");
    this.needsCtx = this.needsCanvas.getContext("2d");
    this.eventLogEl = requireElement<HTMLDivElement>("event-log");
    this.actorBadgeNameEl = requireElement<HTMLDivElement>("actor-badge-name");
    this.actorBadgeActivityEl = requireElement<HTMLDivElement>(
      "actor-badge-activity",
    );
    this.chatBarEl = requireElement<HTMLDivElement>("chat-bar");
    this.chatBarPartnerEl = requireElement<HTMLDivElement>("chat-bar-partner");
    this.tabModalEl = requireElement<HTMLDivElement>("tab-modal");
    this.joinOverlayEl = optionalElement<HTMLDivElement>("join-overlay");

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
    this.chatInputEl.addEventListener("focus", () => {
      this.chatBarEl.classList.add("focus-expanded");
    });
    this.chatInputEl.addEventListener("blur", () => {
      this.chatBarEl.classList.remove("focus-expanded");
    });
    this.drawNeedsRing(null);
  }

  setSelfId(id: string | null): void {
    this.selfId = id;
    if (id && this.joinOverlayEl) {
      this.joinOverlayEl.classList.add("hidden");
    } else if (!id && this.joinOverlayEl) {
      this.joinOverlayEl.classList.remove("hidden");
    }
  }

  setStatus(text: string): void {
    this.statusEl.textContent = text;
  }

  updatePlayerList(
    players: Player[],
    talkablePlayerIds: ReadonlySet<string>,
    attackablePlayerIds: ReadonlySet<string>,
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
        const actions = document.createElement("div");
        actions.className = "player-actions";

        const talkButton = document.createElement("button");
        talkButton.className = "player-talk-btn";
        talkButton.textContent = "Talk";
        talkButton.disabled = !talkablePlayerIds.has(player.id);
        talkButton.addEventListener("click", () =>
          this.talkHandler?.(player.id),
        );
        actions.appendChild(talkButton);

        const attackButton = document.createElement("button");
        attackButton.className = "player-talk-btn";
        attackButton.textContent = "Attack";
        attackButton.disabled = !attackablePlayerIds.has(player.id);
        attackButton.addEventListener("click", () =>
          this.attackHandler?.(player.id),
        );
        actions.appendChild(attackButton);

        row.appendChild(actions);
      }

      li.appendChild(row);
      this.playerListEl.appendChild(li);
    }
  }

  renderConversationPanel(view: ConversationPanelView): void {
    this.chatBarPartnerEl.textContent =
      view.title === "No active conversation" ? "—" : view.title;
    this.chatInputEl.disabled = !view.chatEnabled;
    this.chatBtnEl.disabled = !view.chatEnabled;
    this.chatInputEl.placeholder = view.chatPlaceholder;
    this.inviteActionsEl.classList.toggle("hidden", !view.showInviteActions);
    this.activeActionsEl.classList.toggle("hidden", !view.showEndAction);
  }

  updatePlayerSurvival(survival: PlayerSurvivalData | null): void {
    this.drawNeedsRing(survival);
  }

  addChatMessage(senderName: string, content: string, isSystem = false): void {
    const div = document.createElement("div");
    div.className = "chat-msg";

    if (isSystem) {
      div.innerHTML = `<span class="system">${this.escapeHtml(content)}</span>`;
      this.appendEventLogEntry(content);
    } else {
      div.innerHTML = `<span class="sender">${this.escapeHtml(senderName)}:</span> ${this.escapeHtml(content)}`;
    }

    this.chatHistoryEl.appendChild(div);
    this.chatHistoryEl.scrollTop = this.chatHistoryEl.scrollHeight;
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

  onAttack(callback: (playerId: string) => void): void {
    this.attackHandler = callback;
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
    this.inventoryDrawerEl.classList.toggle("hidden", !this.inventoryVisible);
  }

  togglePlayerModal(): void {
    this.tabModalVisible = !this.tabModalVisible;
    this.tabModalEl.classList.toggle("hidden", !this.tabModalVisible);
  }

  updateActorBadge(name: string, activity: string): void {
    this.actorBadgeNameEl.textContent = name;
    this.actorBadgeActivityEl.textContent = activity;
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

  private appendEventLogEntry(text: string): void {
    const entry = document.createElement("div");
    entry.className = "event-log-entry";
    entry.textContent = text;
    this.eventLogEl.appendChild(entry);
    const maxEntries = 3;
    while (this.eventLogEl.children.length > maxEntries) {
      this.eventLogEl.removeChild(this.eventLogEl.firstChild!);
    }
    setTimeout(() => {
      if (entry.parentElement === this.eventLogEl) {
        entry.style.opacity = "0";
        entry.style.transition = "opacity 400ms ease-out";
        setTimeout(() => entry.remove(), 400);
      }
    }, 6000);
  }

  private drawNeedsRing(survival: PlayerSurvivalData | null): void {
    const ctx = this.needsCtx;
    if (!ctx) return;
    const size = this.needsCanvas.width;
    const cx = size / 2;
    const cy = size / 2;
    ctx.clearRect(0, 0, size, size);

    ctx.fillStyle = "rgba(27, 20, 16, 0.72)";
    ctx.beginPath();
    ctx.arc(cx, cy, size / 2 - 4, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = "#4a3424";
    ctx.lineWidth = 4;
    ctx.beginPath();
    ctx.arc(cx, cy, size / 2 - 4, 0, Math.PI * 2);
    ctx.stroke();

    for (let i = 0; i < NEED_KEYS.length; i++) {
      const key = NEED_KEYS[i];
      const radius = NEED_RING_RADII[i];
      const value = survival?.[key] ?? 0;
      const clamped = Math.max(0, Math.min(100, value));
      const startAngle = -Math.PI / 2;
      const endAngle = startAngle + (Math.PI * 2 * clamped) / 100;

      ctx.strokeStyle = "rgba(74, 52, 36, 0.6)";
      ctx.lineWidth = 12;
      ctx.beginPath();
      ctx.arc(cx, cy, radius, 0, Math.PI * 2);
      ctx.stroke();

      if (clamped > 0) {
        ctx.strokeStyle = severityColor(clamped);
        ctx.lineWidth = 12;
        ctx.lineCap = "round";
        ctx.beginPath();
        ctx.arc(cx, cy, radius, startAngle, endAngle);
        ctx.stroke();
      }
    }

    ctx.lineCap = "butt";
  }

  private stateIcon(player: Player): string {
    if (player.isWaitingForResponse) return " ...";
    if (player.state === "conversing") return " \uD83D\uDCAC";
    if (player.state === "walking") return " \uD83D\uDEB6";
    if (player.state === "doing_activity") return " \uD83D\uDCD6";
    return "";
  }

  private escapeHtml(text: string): string {
    const div = document.createElement("div");
    div.textContent = text;
    return div.innerHTML;
  }
}
