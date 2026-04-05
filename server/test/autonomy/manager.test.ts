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
    state.needs.water = 5;
    state.currentPlan = {
      goalId: "satisfy_water",
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
    expect(state.currentPlan?.goalId).toBe("satisfy_water");
  });

  it("accepts a player invite when social pressure outweighs the current goal", () => {
    const tg = new TestGame({ map: "default" });
    tg.spawn("human_1", 5, 8, false);
    tg.spawn("npc_1", 6, 8, true);

    const manager = new NpcAutonomyManager(tg.game, new EntityManager());
    const state = manager.getState("npc_1");
    state.needs.social = 10;
    state.needs.water = 44;
    state.currentPlan = {
      goalId: "satisfy_water",
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

  it("tracks and decays survival for human players", () => {
    const tg = new TestGame();
    tg.spawn("human_1", 2, 2, false);

    const manager = new NpcAutonomyManager(tg.game, new EntityManager());
    const before = { ...manager.getPlayerSurvival("human_1")! };

    tg.tick();

    const after = manager.getPlayerSurvival("human_1")!;
    expect(after.food).toBeLessThan(before.food);
    expect(after.water).toBeLessThan(before.water);
    expect(after.social).toBeLessThan(before.social);
    expect(after.health).toBe(before.health);
  });

  it("boosts human survival from conversation and food events", () => {
    const tg = new TestGame();
    tg.spawn("human_1", 2, 2, false);

    const manager = new NpcAutonomyManager(tg.game, new EntityManager());
    const needs = manager.getPlayerSurvival("human_1")!;
    needs.social = 5;
    needs.food = 10;

    tg.game.emitEvent({
      tick: tg.game.currentTick,
      type: "convo_ended",
      data: {
        conversation: {
          player1Id: "human_1",
          player2Id: "npc_1",
        },
      },
    });

    expect(manager.getPlayerSurvival("human_1")!.social).toBe(45);

    tg.game.emitEvent({
      tick: tg.game.currentTick,
      type: "item_consumed",
      playerId: "human_1",
      data: { item: "cooked_food" },
    });

    expect(manager.getPlayerSurvival("human_1")!.food).toBe(80);
  });

  it("starts a conversation when an NPC has urgent social need", () => {
    const tg = new TestGame();
    tg.spawn("npc_1", 1, 1, true);
    tg.spawn("npc_2", 2, 1, true);

    const manager = new NpcAutonomyManager(tg.game, new EntityManager());
    const state = manager.getState("npc_1");
    state.needs.social = 10;
    state.lastGoalSelectionTick = -1000;

    tg.tick();
    tg.tick();

    const conversation = tg.game.conversations.getPlayerConversation("npc_1");
    expect(conversation?.state).toBe("active");
    expect(conversation?.player2Id).toBe("npc_2");
    expect(manager.getState("npc_1").currentPlan).toBeNull();
    expect(manager.getState("npc_1").currentExecution).toBeNull();
  });

  it("serializes autonomy debug state with plan provenance and readable actions", () => {
    const tg = new TestGame({ map: "default" });
    tg.spawn("npc_1", 6, 8, true);

    const manager = new NpcAutonomyManager(tg.game, new EntityManager());
    const state = manager.getState("npc_1");
    state.currentPlan = {
      goalId: "satisfy_water",
      steps: [{ actionId: "drink" }],
      totalCost: 1,
      createdAtTick: tg.game.currentTick,
    };
    state.currentPlanSource = "llm";
    state.currentPlanReasoning = "I want to see something new.";
    state.currentExecution = {
      actionId: "drink",
      startedAtTick: tg.game.currentTick,
      actionState: new Map(),
      status: "running",
    };

    const debugState = manager.getDebugState("npc_1");
    expect(debugState).toBeDefined();
    expect(debugState?.currentPlan?.source).toBe("llm");
    expect(debugState?.currentPlan?.llmGenerated).toBe(true);
    expect(debugState?.currentPlan?.reasoning).toBe(
      "I want to see something new.",
    );
    expect(debugState?.currentPlan?.steps[0].actionLabel).toBeTruthy();
    expect(debugState?.currentExecution?.actionLabel).toBeTruthy();
  });
});
