import { afterEach, describe, expect, it, vi } from "vitest";
import { GOTO_ACTION_ID } from "../../src/autonomy/actions/goto.js";
import { EntityManager } from "../../src/autonomy/entityManager.js";
import { NpcAutonomyManager } from "../../src/autonomy/manager.js";
import { InMemoryNpcStore } from "../../src/db/npcStore.js";
import type { DebugFeedEventPayload } from "../../src/debug/streamTypes.js";
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

    tg.tick(2);

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

  it("removes a human player when a survival value reaches zero", () => {
    const tg = new TestGame();
    tg.spawn("human_1", 2, 2, false);

    const manager = new NpcAutonomyManager(tg.game, new EntityManager());
    const deathSpy = vi.fn();
    const despawnSpy = vi.fn();
    tg.game.on("player_death", deathSpy);
    tg.game.on("despawn", despawnSpy);

    manager.getPlayerSurvival("human_1")!.food = 0.001;

    tg.tick();

    expect(tg.game.getPlayer("human_1")).toBeUndefined();
    expect(manager.getPlayerSurvival("human_1")).toBeUndefined();
    expect(deathSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        playerId: "human_1",
        data: expect.objectContaining({
          cause: "survival",
          depletedNeed: "food",
        }),
      }),
    );
    expect(despawnSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        playerId: "human_1",
        data: expect.objectContaining({
          reason: "death",
          cause: "survival",
          depletedNeed: "food",
        }),
      }),
    );
  });

  it("removes an NPC when a survival value reaches zero and keeps a dead debug snapshot", async () => {
    const tg = new TestGame();
    tg.spawn("npc_1", 2, 2, true);

    const store = new InMemoryNpcStore();
    const debugEvents: DebugFeedEventPayload[] = [];
    const manager = new NpcAutonomyManager(tg.game, new EntityManager(), {
      npcStore: store,
    });
    manager.onDebugEvent((event) => debugEvents.push(event));
    manager.getState("npc_1").needs.water = 0.001;

    tg.tick();

    expect(tg.game.getPlayer("npc_1")).toBeUndefined();
    expect(manager.getAllStates().has("npc_1")).toBe(false);
    const deadState = manager.getDebugState("npc_1");
    expect(deadState?.isDead).toBe(true);
    expect(deadState?.name).toBe("npc_1");
    expect(deadState?.death?.cause).toBe("survival");
    expect(deadState?.death?.depletedNeed).toBe("water");
    expect(deadState?.death?.message).toContain("water reached 0");
    expect(deadState?.lastPosition).toEqual({ x: 2, y: 2 });
    expect(store.deadNpcs.get("npc_1")?.death?.depletedNeed).toBe("water");
    expect(debugEvents).toContainEqual(
      expect.objectContaining({
        type: "error",
        severity: "error",
        title: "NPC died",
        subjectId: "npc_1",
      }),
    );
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

  it("includes plan metadata on emitted plan_started debug events", () => {
    const tg = new TestGame();
    tg.spawn("npc_1", 2, 2, true);

    const manager = new NpcAutonomyManager(tg.game, new EntityManager());
    const events: DebugFeedEventPayload[] = [];
    manager.onDebugEvent((event) => events.push(event));

    const state = manager.getState("npc_1");
    state.currentPlan = {
      goalId: "satisfy_water",
      steps: [{ actionId: "drink" }],
      totalCost: 1,
      createdAtTick: tg.game.currentTick,
    };
    state.currentPlanSource = "scripted";

    const managerInternals = manager as unknown as {
      buildCurrentDebugPlan: (currentState: typeof state) => DebugFeedEventPayload["plan"] | null;
      createNpcDebugEvent: (
        npcId: string,
        params: Omit<
          DebugFeedEventPayload,
          "tick" | "subjectType" | "subjectId" | "relatedNpcId"
        >,
      ) => DebugFeedEventPayload;
      emitDebugEvent: (event: DebugFeedEventPayload) => void;
    };

    const eventPlan = managerInternals.buildCurrentDebugPlan(state);
    expect(eventPlan).toBeTruthy();
    managerInternals.emitDebugEvent(managerInternals.createNpcDebugEvent("npc_1", {
      type: "plan_started",
      severity: "info",
      title: "Plan started",
      message: "npc_1 started satisfy water via scripted.",
      plan: eventPlan ?? undefined,
    }));

    const started = events.find((event) => event.type === "plan_started");
    expect(started).toBeDefined();
    expect(started?.plan?.goalId).toBe("satisfy_water");
    expect(started?.plan?.source).toBe("scripted");
    expect(started?.plan?.steps.length).toBeGreaterThan(0);
  });

  it("keeps plan metadata on failure events after the live plan is cleared", () => {
    const tg = new TestGame();
    tg.spawn("npc_1", 2, 2, true);

    const manager = new NpcAutonomyManager(tg.game, new EntityManager());
    const events: DebugFeedEventPayload[] = [];
    manager.onDebugEvent((event) => events.push(event));

    const state = manager.getState("npc_1");
    state.currentPlan = {
      goalId: "satisfy_water",
      steps: [{ actionId: "missing_action" }],
      totalCost: 1,
      createdAtTick: tg.game.currentTick,
    };
    state.currentPlanSource = "llm";
    state.currentPlanReasoning = "Try a nonexistent step.";

    tg.tick();

    expect(manager.getState("npc_1").currentPlan).toBeNull();
    const failed = events.find((event) => event.type === "plan_failed");
    expect(failed).toBeDefined();
    expect(failed?.plan?.goalId).toBe("satisfy_water");
    expect(failed?.plan?.source).toBe("llm");
    expect(failed?.plan?.reasoning).toBe("Try a nonexistent step.");
    expect(failed?.plan?.steps[0]?.actionId).toBe("missing_action");
  });
});
