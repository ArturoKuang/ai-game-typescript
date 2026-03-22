import type { Message, Player } from "./types.js";

export class UI {
  private playerListEl: HTMLUListElement;
  private chatMessagesEl: HTMLDivElement;
  private chatInputEl: HTMLInputElement;
  private chatBtnEl: HTMLButtonElement;
  private statusEl: HTMLDivElement;
  private selfId: string | null = null;

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
    this.statusEl = document.getElementById("status-bar") as HTMLDivElement;
  }

  setSelfId(id: string): void {
    this.selfId = id;
  }

  setStatus(text: string): void {
    this.statusEl.textContent = text;
  }

  enableChat(): void {
    this.chatInputEl.disabled = false;
    this.chatBtnEl.disabled = false;
  }

  disableChat(): void {
    this.chatInputEl.disabled = true;
    this.chatBtnEl.disabled = true;
  }

  updatePlayerList(players: Player[]): void {
    this.playerListEl.innerHTML = "";
    for (const p of players) {
      const li = document.createElement("li");
      const isSelf = p.id === this.selfId;
      li.className = isSelf
        ? "player-self"
        : p.isNpc
          ? "player-npc"
          : "player-human";
      const stateIcon =
        p.state === "conversing"
          ? " 💬"
          : p.state === "walking"
            ? " 🚶"
            : p.state === "doing_activity"
              ? " 📖"
              : "";
      li.textContent = `${p.name}${isSelf ? " (you)" : ""}${stateIcon}`;
      this.playerListEl.appendChild(li);
    }
  }

  addChatMessage(senderName: string, content: string, isSystem = false): void {
    const div = document.createElement("div");
    div.className = "chat-msg";
    if (isSystem) {
      div.innerHTML = `<span class="system">${content}</span>`;
    } else {
      div.innerHTML = `<span class="sender">${senderName}:</span> ${this.escapeHtml(content)}`;
    }
    this.chatMessagesEl.appendChild(div);
    this.chatMessagesEl.scrollTop = this.chatMessagesEl.scrollHeight;
  }

  onChatSubmit(callback: (text: string) => void): void {
    const submit = () => {
      const text = this.chatInputEl.value.trim();
      if (!text) return;
      callback(text);
      this.chatInputEl.value = "";
    };

    this.chatBtnEl.addEventListener("click", submit);
    this.chatInputEl.addEventListener("keydown", (e) => {
      if (e.key === "Enter") submit();
    });
  }

  private escapeHtml(text: string): string {
    const div = document.createElement("div");
    div.textContent = text;
    return div.innerHTML;
  }
}
