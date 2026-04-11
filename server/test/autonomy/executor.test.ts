import { describe, expect, it, vi } from "vitest";
import { registerBuiltinActions } from "../../src/autonomy/actions/index.js";
import { EntityManager } from "../../src/autonomy/entityManager.js";
import { executeAutonomyTick } from "../../src/autonomy/executor.js";
import { createInventory } from "../../src/autonomy/inventory.js";
import { createDefaultNeeds } from "../../src/autonomy/needs.js";
import { ActionRegistry } from "../../src/autonomy/registry.js";
import type {
  GameLoopInterface,
  NpcAutonomyState,
  Plan,
} from "../../src/autonomy/types.js";

function makeRegistry(): ActionRegistry {
  const reg = new ActionRegistry();
  registerBuiltinActions(reg);
  return reg;
}

function makeState(overrides?: Partial<NpcAutonomyState>): NpcAutonomyState {
  return {
    needs: createDefaultNeeds(),
    inventory: createInventory(),
    recentActionHistory: [],
    rememberedTargets: [],
    lastObservationTickByKey: new Map(),
    currentPlan: null,
    currentPlanSource: null,
    currentPlanReasoning: null,
    currentStepIndex: 0,
    currentExecution: null,
    lastPlanTick: 0,
    lastGoalSelectionTick: 0,
    consecutivePlanFailures: 0,
    goalSelectionStartedAtTick: null,
    ...overrides,
  };
}

function makeMockGame(
  players: Array<{
    id: string;
    x: number;
    y: number;
    state: string;
    isNpc: boolean;
  }>,
  tick = 100,
): GameLoopInterface {
  return {
    currentTick: tick,
    world: { isWalkable: () => true },
    rng: { nextInt: () => 0 },
    enqueue: () => {},
    getPlayer: (id: string) => players.find((p) => p.id === id),
    getPlayers: () => players,
    setPlayerTarget: () => [{ x: 5, y: 5 }],
  };
}

describe("Action Executor", () => {
  it("returns no-op when there is no plan", () => {
    const state = makeState();
    const registry = makeRegistry();
    const game = makeMockGame([
      { id: "npc_1", x: 5, y: 5, state: "idle", isNpc: true },
    ]);
    const em = new EntityManager();

    const result = executeAutonomyTick("npc_1", state, registry, game, em);
    expect(result.planCompleted).toBe(false);
    expect(result.planFailed).toBe(false);
  });

  it("fails plan with unknown action", () => {
    const plan: Plan = {
      goalId: "test",
      steps: [{ actionId: "nonexistent_action" }],
      totalCost: 1,
      createdAtTick: 50,
    };
    const state = makeState({ currentPlan: plan });
    const registry = makeRegistry();
    const game = makeMockGame([
      { id: "npc_1", x: 5, y: 5, state: "idle", isNpc: true },
    ]);
    const em = new EntityManager();

    const result = executeAutonomyTick("npc_1", state, registry, game, em);
    expect(result.planFailed).toBe(true);
    expect(state.currentPlan).toBeNull();
  });

  it("expires stale plans", () => {
    const plan: Plan = {
      goalId: "test",
      steps: [{ actionId: "explore" }],
      totalCost: 1,
      createdAtTick: 0, // very old
    };
    const state = makeState({ currentPlan: plan });
    const registry = makeRegistry();
    const game = makeMockGame(
      [{ id: "npc_1", x: 5, y: 5, state: "idle", isNpc: true }],
      3000, // well past expiry
    );
    const em = new EntityManager();

    const result = executeAutonomyTick("npc_1", state, registry, game, em);
    expect(result.planFailed).toBe(true);
    expect(result.failReason).toContain("expired");
  });

  it("executes eat action with food in inventory", () => {
    const inv = createInventory();
    inv.set("raw_food", 1);

    const needs = createDefaultNeeds();
    needs.food = 20; // low food

    const plan: Plan = {
      goalId: "satisfy_food",
      steps: [{ actionId: "eat" }],
      totalCost: 1,
      createdAtTick: 90,
    };

    const state = makeState({
      currentPlan: plan,
      inventory: inv,
      needs,
    });

    const registry = makeRegistry();
    const game = makeMockGame(
      [{ id: "npc_1", x: 5, y: 5, state: "idle", isNpc: true }],
      100,
    );
    const em = new EntityManager();
    const mutableGame = game as GameLoopInterface & { currentTick: number };

    // Tick through the eat duration (20 ticks)
    let result: ReturnType<typeof executeAutonomyTick> | undefined;
    for (let i = 0; i < 25; i++) {
      mutableGame.currentTick = 100 + i;
      result = executeAutonomyTick("npc_1", state, registry, game, em);
      if (result.planCompleted || result.planFailed) break;
    }

    expect(result?.planCompleted).toBe(true);
    expect(needs.food).toBeGreaterThan(20); // food was boosted
    expect(inv.has("raw_food")).toBe(false); // food consumed
  });

  it("completes plan when all steps are done", () => {
    const inv = createInventory();
    inv.set("cooked_food", 1);
    const plan: Plan = {
      goalId: "satisfy_food",
      steps: [{ actionId: "eat_cooked" }],
      totalCost: 1,
      createdAtTick: 90,
    };
    const state = makeState({ currentPlan: plan, inventory: inv });
    const registry = makeRegistry();
    const game = makeMockGame(
      [{ id: "npc_1", x: 5, y: 5, state: "idle", isNpc: true }],
      100,
    );
    const em = new EntityManager();
    const mutableGame = game as GameLoopInterface & { currentTick: number };

    // Tick through eat duration (20 ticks)
    let result: ReturnType<typeof executeAutonomyTick> | undefined;
    for (let i = 0; i < 25; i++) {
      mutableGame.currentTick = 100 + i;
      result = executeAutonomyTick("npc_1", state, registry, game, em);
      if (result.planCompleted) break;
    }

    expect(result?.planCompleted).toBe(true);
    expect(state.currentPlan).toBeNull();
  });

  it("queues move_to when starting a goto step", () => {
    const plan: Plan = {
      goalId: "test",
      steps: [{ actionId: "__goto", targetPosition: { x: 7, y: 5 } }],
      totalCost: 1,
      createdAtTick: 90,
    };
    const state = makeState({ currentPlan: plan });
    const registry = makeRegistry();
    const enqueue = vi.fn();
    const game: GameLoopInterface = {
      currentTick: 100,
      world: { isWalkable: () => true },
      rng: { nextInt: () => 0 },
      enqueue,
      getPlayer: () => ({
        id: "npc_1",
        x: 5,
        y: 5,
        state: "idle",
        isNpc: true,
      }),
      getPlayers: () => [
        { id: "npc_1", x: 5, y: 5, state: "idle", isNpc: true },
      ],
      setPlayerTarget: () => {
        throw new Error("goto should not call setPlayerTarget directly");
      },
    };
    const em = new EntityManager();

    const result = executeAutonomyTick("npc_1", state, registry, game, em);
    expect(result.planFailed).toBe(false);
    expect(enqueue).toHaveBeenCalledWith({
      type: "move_to",
      playerId: "npc_1",
      data: { x: 7, y: 5 },
    });
  });

  it("preserves validate action state when starting socialize", () => {
    const plan: Plan = {
      goalId: "satisfy_social",
      steps: [{ actionId: "socialize" }],
      totalCost: 1,
      createdAtTick: 90,
    };
    const state = makeState({ currentPlan: plan });
    const registry = makeRegistry();
    const enqueue = vi.fn();
    const game: GameLoopInterface = {
      currentTick: 100,
      world: { isWalkable: () => true },
      rng: { nextInt: () => 0 },
      enqueue,
      getPlayer: (id: string) =>
        [
          { id: "npc_1", x: 5, y: 5, state: "idle", isNpc: true },
          { id: "human_1", x: 6, y: 5, state: "idle", isNpc: false },
        ].find((player) => player.id === id),
      getPlayers: () => [
        { id: "npc_1", x: 5, y: 5, state: "idle", isNpc: true },
        { id: "human_1", x: 6, y: 5, state: "idle", isNpc: false },
      ],
      setPlayerTarget: () => [{ x: 6, y: 5 }],
    };
    const em = new EntityManager();

    const result = executeAutonomyTick("npc_1", state, registry, game, em);
    expect(result.planFailed).toBe(false);
    expect(enqueue).toHaveBeenCalledWith({
      type: "start_convo",
      playerId: "npc_1",
      data: { targetId: "human_1" },
    });
  });

  it("queues move_to when starting a wander step", () => {
    const plan: Plan = {
      goalId: "idle_wander",
      steps: [{ actionId: "wander" }],
      totalCost: 1,
      createdAtTick: 90,
    };
    const state = makeState({ currentPlan: plan });
    const registry = makeRegistry();
    const enqueue = vi.fn();
    const game: GameLoopInterface = {
      currentTick: 100,
      world: { isWalkable: (x: number, y: number) => x === 6 && y === 5 },
      rng: {
        nextInt: vi.fn().mockReturnValueOnce(6).mockReturnValueOnce(5),
      },
      enqueue,
      getPlayer: () => ({
        id: "npc_1",
        x: 5,
        y: 5,
        state: "idle",
        isNpc: true,
      }),
      getPlayers: () => [
        { id: "npc_1", x: 5, y: 5, state: "idle", isNpc: true },
      ],
      setPlayerTarget: () => {
        throw new Error("wander should not call setPlayerTarget directly");
      },
    };
    const em = new EntityManager();

    const result = executeAutonomyTick("npc_1", state, registry, game, em);
    expect(result.planFailed).toBe(false);
    expect(enqueue).toHaveBeenCalledWith({
      type: "move_to",
      playerId: "npc_1",
      data: { x: 6, y: 5 },
    });
  });
});
