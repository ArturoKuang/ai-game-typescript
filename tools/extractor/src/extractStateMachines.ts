/**
 * Extracts state machine definitions from the codebase.
 *
 * Two state machines are extracted:
 * 1. Conversation lifecycle: invited → walking → active → ended
 * 2. Player state: idle → walking → conversing → doing_activity
 *
 * These are defined declaratively based on code analysis of the
 * ConversationManager and GameLoop classes.
 */

import type { StateMachine } from "./types.js";

export function extractStateMachines(): StateMachine[] {
  return [
    {
      id: "conversation",
      label: "Conversation Lifecycle",
      description:
        "Governs the lifecycle of a conversation between two players. " +
        "NPCs auto-accept invites (no client UI). Walking state navigates " +
        "both players toward a rendezvous point. Active state allows message " +
        "exchange until timeout, max messages, or manual end.",
      fileId: "server/src/engine/conversation.ts",
      classId: "ConversationManager",
      states: [
        {
          id: "invited",
          label: "Invited",
          isInitial: true,
          color: "#648FFF",
        },
        {
          id: "walking",
          label: "Walking",
          color: "#FFB000",
        },
        {
          id: "active",
          label: "Active",
          color: "#22D3EE",
        },
        {
          id: "ended",
          label: "Ended",
          isTerminal: true,
          color: "#888888",
        },
      ],
      transitions: [
        {
          from: "invited",
          to: "walking",
          trigger: "Accept invite",
          fileId: "server/src/engine/conversation.ts",
          line: 111,
          condition: "Player2 accepts or NPC auto-accepts",
          triggeringFlows: ["accept_convo", "start_convo"],
        },
        {
          from: "invited",
          to: "ended",
          trigger: "Decline invite",
          fileId: "server/src/engine/conversation.ts",
          line: 125,
          condition: "Player2 declines (reason: 'declined')",
          triggeringFlows: ["decline_convo"],
        },
        {
          from: "walking",
          to: "active",
          trigger: "Players within range",
          fileId: "server/src/engine/conversation.ts",
          line: 222,
          condition: "Manhattan distance <= 2 tiles",
        },
        {
          from: "walking",
          to: "ended",
          trigger: "Player missing",
          fileId: "server/src/engine/conversation.ts",
          line: 205,
          condition: "A participant disconnected (reason: 'missing_player')",
          triggeringFlows: ["disconnect"],
        },
        {
          from: "active",
          to: "ended",
          trigger: "Manual end",
          fileId: "server/src/engine/gameLoop.ts",
          line: 447,
          condition: "Either player sends end_convo command",
          triggeringFlows: ["end_convo"],
        },
        {
          from: "active",
          to: "ended",
          trigger: "Max duration",
          fileId: "server/src/engine/conversation.ts",
          line: 245,
          condition: "Exceeded 1200 ticks (60s at 20 ticks/sec)",
        },
        {
          from: "active",
          to: "ended",
          trigger: "Max messages",
          fileId: "server/src/engine/conversation.ts",
          line: 260,
          condition: "Reached 20 messages",
        },
        {
          from: "active",
          to: "ended",
          trigger: "Timeout",
          fileId: "server/src/engine/conversation.ts",
          line: 280,
          condition: "No messages for 600 ticks (30s)",
        },
      ],
    },
    {
      id: "player",
      label: "Player State",
      description:
        "Governs what a player is currently doing. Movement and conversations " +
        "are mutually exclusive: a conversing player cannot move, and starting " +
        "movement cancels any pending path. The 'doing_activity' state is for " +
        "future activity interactions.",
      fileId: "server/src/engine/types.ts",
      classId: "GameLoop",
      states: [
        {
          id: "idle",
          label: "Idle",
          isInitial: true,
          color: "#94a3b8",
        },
        {
          id: "walking",
          label: "Walking",
          color: "#FFB000",
        },
        {
          id: "conversing",
          label: "Conversing",
          color: "#22D3EE",
        },
        {
          id: "doing_activity",
          label: "Doing Activity",
          color: "#DC267F",
        },
      ],
      transitions: [
        {
          from: "idle",
          to: "walking",
          trigger: "WASD key pressed",
          fileId: "server/src/engine/gameLoop.ts",
          condition: "inputX/inputY != 0 on tick",
          triggeringFlows: ["input_start"],
        },
        {
          from: "idle",
          to: "walking",
          trigger: "Path set (click-to-move)",
          fileId: "server/src/engine/gameLoop.ts",
          line: 217,
          condition: "setPlayerTarget() finds A* path",
          triggeringFlows: ["move"],
        },
        {
          from: "walking",
          to: "idle",
          trigger: "Path complete",
          fileId: "server/src/engine/gameLoop.ts",
          condition: "Reached final waypoint",
        },
        {
          from: "walking",
          to: "idle",
          trigger: "All keys released",
          fileId: "server/src/engine/gameLoop.ts",
          line: 308,
          condition: "inputX == 0 && inputY == 0 && no path",
          triggeringFlows: ["input_stop"],
        },
        {
          from: "idle",
          to: "conversing",
          trigger: "Conversation activated",
          fileId: "server/src/engine/gameLoop.ts",
          condition: "syncPlayerConvoState(): convo state is 'active'",
          triggeringFlows: ["start_convo", "accept_convo"],
        },
        {
          from: "walking",
          to: "conversing",
          trigger: "Conversation activated",
          fileId: "server/src/engine/gameLoop.ts",
          condition: "syncPlayerConvoState(): convo state is 'active'",
          triggeringFlows: ["start_convo", "accept_convo"],
        },
        {
          from: "conversing",
          to: "idle",
          trigger: "Conversation ended",
          fileId: "server/src/engine/gameLoop.ts",
          condition: "syncPlayerConvoState(): no active convo",
          triggeringFlows: ["end_convo"],
        },
        {
          from: "idle",
          to: "doing_activity",
          trigger: "Start activity",
          condition: "Future: player interacts with map activity",
        },
        {
          from: "doing_activity",
          to: "idle",
          trigger: "End activity",
          condition: "Future: player finishes or leaves activity",
        },
      ],
    },
  ];
}
