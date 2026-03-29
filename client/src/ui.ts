import type { Player } from "./types.js";

export interface ConversationPanelView {
  title: string;
  status: string;
  chatEnabled: boolean;
  chatPlaceholder: string;
  showInviteActions: boolean;
  showEndAction: boolean;
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
  private selfId: string | null = null;
  private talkHandler: ((playerId: string) => void) | null = null;
  private acceptHandler: (() => void) | null = null;
  private declineHandler: (() => void) | null = null;
  private endHandler: (() => void) | null = null;

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
    this.chatHelperEl = document.getElementById("chat-helper") as HTMLDivElement;
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

    this.acceptConvoBtnEl.addEventListener("click", () => this.acceptHandler?.());
    this.declineConvoBtnEl.addEventListener("click", () => this.declineHandler?.());
    this.endConvoBtnEl.addEventListener("click", () => this.endHandler?.());
  }

  setSelfId(id: string): void {
    this.selfId = id;
  }

  setStatus(text: string): void {
    this.statusEl.textContent = text;
  }

  updatePlayerList(players: Player[], talkablePlayerIds: ReadonlySet<string>): void {
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

  private stateIcon(player: Player): string {
    if (player.isWaitingForResponse) return " ...";
    if (player.state === "conversing") return " 💬";
    if (player.state === "walking") return " 🚶";
    if (player.state === "doing_activity") return " 📖";
    return "";
  }

  private escapeHtml(text: string): string {
    const div = document.createElement("div");
    div.textContent = text;
    return div.innerHTML;
  }
}
