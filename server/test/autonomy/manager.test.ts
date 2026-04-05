import { afterEach, describe, expect, it, vi } from "vitest";
import { GOTO_ACTION_ID } from "../../src/autonomy/actions/goto.js";
import { EntityManager } from "../../src/autonomy/entityManager.js";
import { NpcAutonomyManager } from "../../src/autonomy/manager.js";
import { TestGame } from "../helpers/testGame.js";

describe("NpcAutonomyManager", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("idle wander uses the game RNG and queues movement", () => {
    const tg = new TestGame({ seed: 123 });
    tg.spawn("npc_1", 2, 2, true);

    const manager = new NpcAutonomyManager(tg.game, new EntityManager());
    const state = manager.getState("npc_1");
    const enqueueSpy = vi.spyOn(tg.game, "enqueue");

    vi.spyOn(Math, "random").mockImplementation(() => {
      throw new Error("idle wander should use the seeded game RNG");
    });

    expect(() => (manager as any).idleWander("npc_1", state)).not.toThrow();
    expect(enqueueSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        type: "move_to",
        playerId: "npc_1",
      }),
    );
  });

  it("keeps a player invite pending while a higher-priority NPC plan continues", () => {
    const tg = new TestGame({ map: "default" });
    tg.spawn("human_1", 2, 8, false);
    tg.spawn("npc_1", 6, 8, true);

    const manager = new NpcAutonomyManager(tg.game, new EntityManager());
    const state = manager.getState("npc_1");
    state.needs.social = 70;
    state.needs.curiosity = 5;
    state.currentPlan = {
      goalId: "satisfy_curiosity",
      steps: [
        {
          actionId: GOTO_ACTION_ID,
          targetPosition: { x: 17, y: 17 },
        },
      ],
      totalCost: 1,
      createdAtTick: tg.game.currentTick,
    };
    state.currentStepIndex = 0;
    state.currentExecution = null;

    tg.game.enqueue({
      type: "start_convo",
      playerId: "human_1",
      data: { targetId: "npc_1" },
    });

    tg.tick();

    const conversation = tg.game.conversations.getPlayerConversation("npc_1");
    expect(conversation?.state).toBe("invited");
    expect(state.currentPlan?.goalId).toBe("satisfy_curiosity");
  });

  it("accepts a player invite when social pressure outweighs the current goal", () => {
    const tg = new TestGame({ map: "default" });
    tg.spawn("human_1", 5, 8, false);
    tg.spawn("npc_1", 6, 8, true);

    const manager = new NpcAutonomyManager(tg.game, new EntityManager());
    const state = manager.getState("npc_1");
    state.needs.social = 10;
    state.needs.curiosity = 24;
    state.currentPlan = {
      goalId: "satisfy_curiosity",
      steps: [
        {
          actionId: GOTO_ACTION_ID,
          targetPosition: { x: 17, y: 17 },
        },
      ],
      totalCost: 1,
      createdAtTick: tg.game.currentTick,
    };

    tg.game.enqueue({
      type: "start_convo",
      playerId: "human_1",
      data: { targetId: "npc_1" },
    });

    tg.tick();

    const conversation = tg.game.conversations.getPlayerConversation("npc_1");
    expect(["walking", "active"]).toContain(conversation?.state);
  });
});
