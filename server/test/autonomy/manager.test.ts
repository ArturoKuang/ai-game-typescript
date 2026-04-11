import { afterEach, describe, expect, it, vi } from "vitest";
import { GOTO_ACTION_ID } from "../../src/autonomy/actions/goto.js";
import { EntityManager } from "../../src/autonomy/entityManager.js";
import { NpcAutonomyManager } from "../../src/autonomy/manager.js";
import { BearManager } from "../../src/bears/bearManager.js";
import { InMemoryNpcStore } from "../../src/db/npcStore.js";
import { InMemoryRepository } from "../../src/db/repository.js";
import type { DebugFeedEventPayload } from "../../src/debug/streamTypes.js";
import type { MapData } from "../../src/engine/types.js";
import { PlaceholderEmbedder } from "../../src/npc/embedding.js";
import { MemoryManager } from "../../src/npc/memory.js";
import type {
  NpcGoalRequest,
  NpcGoalResponse,
  NpcModelProvider,
  NpcModelResponse,
  NpcReflectionRequest,
  NpcReplyRequest,
} from "../../src/npc/provider.js";
import { TestGame } from "../helpers/testGame.js";

const HUNT_MAP: MapData = {
  width: 12,
  height: 12,
  tiles: [
    [
      "wall",
      "wall",
      "wall",
      "wall",
      "wall",
      "wall",
      "wall",
      "wall",
      "wall",
      "wall",
      "wall",
      "wall",
    ],
    [
      "wall",
      "floor",
      "floor",
      "floor",
      "floor",
      "floor",
      "floor",
      "floor",
      "floor",
      "floor",
      "floor",
      "wall",
    ],
    [
      "wall",
      "floor",
      "floor",
      "floor",
      "floor",
      "floor",
      "floor",
      "floor",
      "floor",
      "floor",
      "floor",
      "wall",
    ],
    [
      "wall",
      "floor",
      "floor",
      "floor",
      "floor",
      "floor",
      "floor",
      "floor",
      "floor",
      "floor",
      "floor",
      "wall",
    ],
    [
      "wall",
      "floor",
      "floor",
      "floor",
      "floor",
      "floor",
      "floor",
      "floor",
      "floor",
      "floor",
      "floor",
      "wall",
    ],
    [
      "wall",
      "floor",
      "floor",
      "floor",
      "floor",
      "floor",
      "floor",
      "floor",
      "floor",
      "floor",
      "floor",
      "wall",
    ],
    [
      "wall",
      "floor",
      "floor",
      "floor",
      "floor",
      "floor",
      "floor",
      "floor",
      "floor",
      "floor",
      "floor",
      "wall",
    ],
    [
      "wall",
      "floor",
      "floor",
      "floor",
      "floor",
      "floor",
      "floor",
      "floor",
      "floor",
      "floor",
      "floor",
      "wall",
    ],
    [
      "wall",
      "floor",
      "floor",
      "floor",
      "floor",
      "floor",
      "floor",
      "floor",
      "floor",
      "floor",
      "floor",
      "wall",
    ],
    [
      "wall",
      "floor",
      "floor",
      "floor",
      "floor",
      "floor",
      "floor",
      "floor",
      "floor",
      "floor",
      "floor",
      "wall",
    ],
    [
      "wall",
      "floor",
      "floor",
      "floor",
      "floor",
      "floor",
      "floor",
      "floor",
      "floor",
      "floor",
      "floor",
      "wall",
    ],
    [
      "wall",
      "wall",
      "wall",
      "wall",
      "wall",
      "wall",
      "wall",
      "wall",
      "wall",
      "wall",
      "wall",
      "wall",
    ],
  ],
  activities: [],
  spawnPoints: [{ x: 6, y: 7 }],
};

class RecordingGoalProvider implements NpcModelProvider {
  readonly name = "recording-goal-provider";
  lastGoalRequest: NpcGoalRequest | null = null;
  constructor(
    private readonly selectedGoalId?: string,
    private readonly selectedReasoning = "testing memory-aware goal selection",
  ) {}

  async generateReply(_request: NpcReplyRequest): Promise<NpcModelResponse> {
    return { content: "hello", prompt: "", latencyMs: 0 };
  }

  async generateReflection(
    _request: NpcReflectionRequest,
  ): Promise<NpcModelResponse> {
    return { content: "thinking", prompt: "", latencyMs: 0 };
  }

  async generateGoalSelection(
    request: NpcGoalRequest,
  ): Promise<NpcGoalResponse> {
    this.lastGoalRequest = request;
    return {
      goalId:
        this.selectedGoalId ??
        request.availableGoals[0]?.id ??
        "satisfy_social",
      reasoning: this.selectedReasoning,
      prompt: "",
      latencyMs: 0,
    };
  }
}

async function flushAsyncWork(): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, 0));
  await new Promise((resolve) => setTimeout(resolve, 0));
}

describe("NpcAutonomyManager", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("routes idle roaming through a GOAP wander plan", () => {
    const tg = new TestGame({ seed: 123, map: "default" });
    tg.spawn("npc_1", 5, 8, true);

    const manager = new NpcAutonomyManager(tg.game, new EntityManager());
    const state = manager.getState("npc_1");
    state.lastGoalSelectionTick = tg.game.currentTick;
    const enqueueSpy = vi.spyOn(tg.game, "enqueue");
    let rngCalls = 0;
    vi.spyOn(tg.game.rng, "nextInt").mockImplementation((max: number) => {
      rngCalls++;
      if (rngCalls === 1) return 0; // idle cooldown wait
      if (rngCalls === 2) return Math.min(max - 1, 7); // dx = +2
      if (rngCalls === 3) return Math.min(max - 1, 5); // dy = 0
      return 0;
    });

    vi.spyOn(Math, "random").mockImplementation(() => {
      throw new Error("wander GOAP action should use the seeded game RNG");
    });

    expect(() => tg.tick()).not.toThrow();
    expect(state.currentPlan?.goalId).toBe("idle_wander");
    expect(state.currentPlan?.steps.map((step) => step.actionId)).toEqual([
      "wander",
    ]);
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
          targetPosition: { x: 15, y: 12 },
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
          targetPosition: { x: 15, y: 12 },
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
    const beforeSurvival = manager.getPlayerSurvival("human_1");
    expect(beforeSurvival).toBeDefined();
    if (!beforeSurvival) {
      throw new Error("missing survival snapshot");
    }
    const before = { ...beforeSurvival };

    tg.tick();

    const after = manager.getPlayerSurvival("human_1");
    expect(after).toBeDefined();
    if (!after) {
      throw new Error("missing survival snapshot after tick");
    }
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

    const survival = manager.getPlayerSurvival("human_1");
    expect(survival).toBeDefined();
    if (survival) {
      survival.food = 0.001;
    }

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
    const needs = manager.getPlayerSurvival("human_1");
    expect(needs).toBeDefined();
    if (needs) {
      needs.social = 5;
      needs.food = 10;
    }

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

    expect(manager.getPlayerSurvival("human_1")?.social).toBe(45);

    tg.game.emitEvent({
      tick: tg.game.currentTick,
      type: "item_consumed",
      playerId: "human_1",
      data: { item: "cooked_food" },
    });

    expect(manager.getPlayerSurvival("human_1")?.food).toBe(80);
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

  it("stores completed autonomy actions in NPC memory", async () => {
    const tg = new TestGame();
    tg.spawn("npc_1", 1, 1, true);

    const entityManager = new EntityManager();
    entityManager.spawn("berry_bush", { x: 1, y: 2 }, { berries: 3 });
    const repo = new InMemoryRepository();
    const memoryManager = new MemoryManager(repo, new PlaceholderEmbedder(64));
    const manager = new NpcAutonomyManager(tg.game, entityManager, {
      memoryManager,
    });
    const state = manager.getState("npc_1");
    state.currentPlan = {
      goalId: "gather_food",
      steps: [{ actionId: "harvest" }],
      totalCost: 1,
      createdAtTick: tg.game.currentTick,
    };

    tg.tick(40);
    await flushAsyncWork();

    const memories = await memoryManager.getMemories("npc_1", { limit: 10 });
    expect(
      memories.some(
        (memory) =>
          memory.type === "observation" &&
          memory.content.includes("harvested berries"),
      ),
    ).toBe(true);
  });

  it("uses retrieved memories when asking the provider to select a goal", async () => {
    const tg = new TestGame();
    tg.spawn("npc_1", 1, 1, true);

    const entityManager = new EntityManager();
    entityManager.spawn("berry_bush", { x: 1, y: 2 }, { berries: 3 });
    const repo = new InMemoryRepository();
    const memoryManager = new MemoryManager(repo, new PlaceholderEmbedder(64));
    await memoryManager.addMemory({
      playerId: "npc_1",
      type: "observation",
      content: "I harvested berries from a bush and gathered raw food.",
      importance: 5,
      tick: 1,
    });

    const provider = new RecordingGoalProvider();
    const manager = new NpcAutonomyManager(tg.game, entityManager, {
      provider,
      memoryManager,
    });
    const state = manager.getState("npc_1");
    state.needs.food = 10;
    state.lastGoalSelectionTick = tg.game.currentTick;
    state.rememberedTargets = [
      {
        targetType: "berry_bush",
        targetId: "entity_berry",
        position: { x: 4, y: 1 },
        lastSeenTick: tg.game.currentTick - 25,
        source: "observation",
        availability: "available",
      },
    ];

    await (
      manager as unknown as {
        tryLlmGoalSelection: (
          npcId: string,
          currentState: typeof state,
          requestTick: number,
        ) => Promise<void>;
      }
    ).tryLlmGoalSelection("npc_1", state, tg.game.currentTick);

    expect(provider.lastGoalRequest).toBeTruthy();
    expect(provider.lastGoalRequest?.recentMemories).toHaveLength(1);
    expect(provider.lastGoalRequest?.rememberedTargets).toEqual([
      expect.objectContaining({
        type: "berry_bush",
        distance: 3,
        ageTicks: 25,
        source: "observation",
        availability: "available",
      }),
    ]);
    expect(provider.lastGoalRequest?.recentMemories[0]?.content).toContain(
      "harvested berries",
    );
  });

  it("prioritizes goal-relevant remembered targets for provider goal selection", async () => {
    const tg = new TestGame();
    tg.spawn("npc_1", 1, 1, true);

    const provider = new RecordingGoalProvider();
    const manager = new NpcAutonomyManager(tg.game, new EntityManager(), {
      provider,
    });
    const state = manager.getState("npc_1");
    state.needs.food = 10;
    state.needs.water = 20;
    state.lastGoalSelectionTick = tg.game.currentTick;
    state.rememberedTargets = [
      {
        targetType: "water_source",
        targetId: "entity_water",
        position: { x: 2, y: 1 },
        lastSeenTick: tg.game.currentTick - 1,
        source: "observation",
        availability: "available",
      },
      {
        targetType: "berry_bush",
        targetId: "entity_berry",
        position: { x: 5, y: 1 },
        lastSeenTick: tg.game.currentTick - 20,
        source: "observation",
        availability: "available",
      },
      {
        targetType: "berry_bush",
        targetId: "entity_old_berry",
        position: { x: 3, y: 1 },
        lastSeenTick: tg.game.currentTick - 5,
        source: "observation",
        availability: "depleted",
      },
    ];

    await (
      manager as unknown as {
        tryLlmGoalSelection: (
          npcId: string,
          currentState: typeof state,
          requestTick: number,
        ) => Promise<void>;
      }
    ).tryLlmGoalSelection("npc_1", state, tg.game.currentTick);

    expect(
      provider.lastGoalRequest?.availableGoals.map((goal) => goal.id),
    ).toEqual(["satisfy_food", "satisfy_water"]);
    expect(provider.lastGoalRequest?.rememberedTargets[0]).toEqual(
      expect.objectContaining({
        type: "berry_bush",
        name: "entity_berry",
        availability: "available",
      }),
    );
  });

  it("reorders urgent goals toward viable remembered targets", async () => {
    const tg = new TestGame();
    tg.spawn("npc_1", 1, 1, true);

    const provider = new RecordingGoalProvider();
    const manager = new NpcAutonomyManager(tg.game, new EntityManager(), {
      provider,
    });
    const state = manager.getState("npc_1");
    state.needs.food = 10;
    state.needs.water = 20;
    state.lastGoalSelectionTick = tg.game.currentTick;
    state.rememberedTargets = [
      {
        targetType: "water_source",
        targetId: "entity_water",
        position: { x: 2, y: 1 },
        lastSeenTick: tg.game.currentTick - 1,
        source: "observation",
        availability: "available",
      },
    ];

    await (
      manager as unknown as {
        tryLlmGoalSelection: (
          npcId: string,
          currentState: typeof state,
          requestTick: number,
        ) => Promise<void>;
      }
    ).tryLlmGoalSelection("npc_1", state, tg.game.currentTick);

    expect(provider.lastGoalRequest?.availableGoals[0]).toEqual(
      expect.objectContaining({
        id: "satisfy_water",
      }),
    );
    expect(provider.lastGoalRequest?.availableGoals[0]?.description).toContain(
      "You remember water_source",
    );
  });

  it("includes nearby players in goal-selection observations", async () => {
    const tg = new TestGame();
    tg.spawn("npc_1", 1, 1, true);
    tg.spawn("human_1", 2, 1, false);

    const provider = new RecordingGoalProvider();
    const manager = new NpcAutonomyManager(tg.game, new EntityManager(), {
      provider,
    });
    const state = manager.getState("npc_1");
    state.needs.social = 10;
    state.lastGoalSelectionTick = tg.game.currentTick;

    await (
      manager as unknown as {
        tryLlmGoalSelection: (
          npcId: string,
          currentState: typeof state,
          requestTick: number,
        ) => Promise<void>;
      }
    ).tryLlmGoalSelection("npc_1", state, tg.game.currentTick);

    expect(provider.lastGoalRequest?.nearbyEntities).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: "player",
          name: "human_1",
          distance: 1,
        }),
      ]),
    );
  });

  it("falls back to the next ranked goal when the provider picks an unplannable goal", async () => {
    const tg = new TestGame({ seed: 123, map: HUNT_MAP });
    tg.spawn("npc_1", 6, 7, true);

    const entityManager = new EntityManager();
    const bush = entityManager.spawn(
      "berry_bush",
      { x: 10, y: 7 },
      {
        berries: 3,
      },
    );
    const provider = new RecordingGoalProvider(
      "satisfy_social",
      "I want to talk first",
    );
    const manager = new NpcAutonomyManager(tg.game, entityManager, {
      provider,
    });
    const state = manager.getState("npc_1");
    state.needs.food = 10;
    state.needs.social = 20;
    state.lastGoalSelectionTick = tg.game.currentTick;
    state.rememberedTargets = [
      {
        targetType: "berry_bush",
        targetId: bush.id,
        position: bush.position,
        lastSeenTick: tg.game.currentTick - 5,
        source: "observation",
        availability: "available",
      },
    ];

    await (
      manager as unknown as {
        tryLlmGoalSelection: (
          npcId: string,
          currentState: typeof state,
          requestTick: number,
        ) => Promise<void>;
      }
    ).tryLlmGoalSelection("npc_1", state, tg.game.currentTick);

    expect(
      provider.lastGoalRequest?.availableGoals.map((goal) => goal.id),
    ).toEqual(["satisfy_food", "satisfy_social"]);
    expect(state.currentPlan?.goalId).toBe("satisfy_food");
    expect(state.currentPlan?.steps.map((step) => step.actionId)).toEqual([
      "__goto",
      "harvest",
      "eat",
    ]);
    expect(state.currentPlanSource).toBe("llm");
    expect(state.currentPlanReasoning).toContain(
      "Fallback from satisfy_social",
    );
  });

  it("records nearby observations into remembered targets", () => {
    const tg = new TestGame();
    tg.spawn("npc_1", 1, 1, true);
    tg.spawn("human_1", 2, 1, false);

    const entityManager = new EntityManager();
    const bush = entityManager.spawn(
      "berry_bush",
      { x: 1, y: 2 },
      {
        berries: 3,
      },
    );
    entityManager.spawn("water_source", { x: 2, y: 2 });

    const manager = new NpcAutonomyManager(tg.game, entityManager);

    tg.tick();

    const state = manager.getState("npc_1");
    expect(state.rememberedTargets).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          targetType: "berry_bush",
          targetId: bush.id,
          position: bush.position,
          source: "observation",
          availability: "available",
        }),
        expect.objectContaining({
          targetType: "player",
          targetId: "human_1",
          position: { x: 2, y: 1 },
          source: "observation",
          availability: "available",
        }),
      ]),
    );
  });

  it("stores notable observations once per cooldown window", async () => {
    const tg = new TestGame();
    tg.spawn("npc_1", 1, 1, true);

    const entityManager = new EntityManager();
    const bush = entityManager.spawn(
      "berry_bush",
      { x: 1, y: 2 },
      {
        berries: 3,
      },
    );
    const repo = new InMemoryRepository();
    const memoryManager = new MemoryManager(repo, new PlaceholderEmbedder(64));
    const manager = new NpcAutonomyManager(tg.game, entityManager, {
      memoryManager,
    });

    tg.tick();
    tg.tick();
    await flushAsyncWork();

    const observationMemories = (
      await memoryManager.getMemories("npc_1", {
        limit: 20,
      })
    ).filter(
      (memory) =>
        memory.type === "observation" &&
        memory.content.includes("berry bush with fruit"),
    );

    expect(observationMemories).toHaveLength(1);
    expect(
      manager
        .getState("npc_1")
        .lastObservationTickByKey.get(`observed:${bush.id}:berries`),
    ).toBe(1);
  });

  it("plans toward an observed distant resource", () => {
    const tg = new TestGame({ seed: 123, map: HUNT_MAP });
    tg.spawn("npc_1", 6, 7, true);

    const entityManager = new EntityManager();
    entityManager.spawn("berry_bush", { x: 10, y: 7 }, { berries: 3 });
    const manager = new NpcAutonomyManager(tg.game, entityManager);
    const state = manager.getState("npc_1");
    state.needs.food = 5;
    state.needs.water = 90;
    state.needs.social = 90;
    state.lastGoalSelectionTick = -1000;

    tg.tick();

    expect(state.currentPlan?.goalId).toBe("satisfy_food");
    expect(state.currentPlan?.steps.map((step) => step.actionId)).toEqual([
      "__goto",
      "harvest",
      "eat",
    ]);
  });

  it("falls back to wandering when a distant resource has not been observed", () => {
    const tg = new TestGame({ seed: 123, map: HUNT_MAP });
    tg.spawn("npc_1", 6, 7, true);

    const entityManager = new EntityManager();
    entityManager.spawn("berry_bush", { x: 1, y: 1 }, { berries: 3 });
    const manager = new NpcAutonomyManager(tg.game, entityManager);
    const state = manager.getState("npc_1");
    state.needs.food = 5;
    state.needs.water = 90;
    state.needs.social = 90;
    state.lastGoalSelectionTick = -1000;

    tg.tick();

    expect(state.currentPlan?.goalId).toBe("idle_wander");
    expect(state.currentPlan?.steps.map((step) => step.actionId)).toEqual([
      "wander",
    ]);
  });

  it("uses a GOAP bear-hunt plan to satisfy food when a bear is nearby", () => {
    const tg = new TestGame({ seed: 123, map: HUNT_MAP });
    const entityManager = new EntityManager();
    const manager = new NpcAutonomyManager(tg.game, entityManager);
    const bearManager = new BearManager(tg.game, entityManager);
    bearManager.debugSpawnBear(1, 1);
    const bearId = bearManager.debugSpawnBear(6, 6);
    tg.spawn("npc_hunter", 6, 7, true);
    const state = manager.getState("npc_hunter");
    state.needs.food = 5;
    state.needs.water = 90;
    state.needs.social = 90;
    state.lastGoalSelectionTick = -1000;

    tg.tick();

    expect(state.currentPlan?.steps.map((step) => step.actionId)).toEqual([
      "attack_bear",
      "pickup_bear_meat",
      "eat_bear_meat",
    ]);

    for (let i = 0; i < 30 && state.currentPlan; i++) {
      tg.tick();
    }

    expect(entityManager.get(bearId)).toBeUndefined();
    expect(state.needs.food).toBeGreaterThan(5);
    expect(state.currentPlan).toBeNull();
    expect(state.currentExecution).toBeNull();
    expect(state.inventory.has("bear_meat")).toBe(false);
    expect(
      tg.game.logger
        .getEvents({ types: ["player_attack"] })
        .some(
          (event) =>
            event.playerId === "npc_hunter" && event.data?.targetId === bearId,
        ),
    ).toBe(true);
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
      buildCurrentDebugPlan: (
        currentState: typeof state,
      ) => DebugFeedEventPayload["plan"] | null;
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
    managerInternals.emitDebugEvent(
      managerInternals.createNpcDebugEvent("npc_1", {
        type: "plan_started",
        severity: "info",
        title: "Plan started",
        message: "npc_1 started satisfy water via scripted.",
        plan: eventPlan ?? undefined,
      }),
    );

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
