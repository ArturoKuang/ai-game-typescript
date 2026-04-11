import { describe, expect, it } from "vitest";
import { registerBuiltinActions } from "../../src/autonomy/actions/index.js";
import { EntityManager } from "../../src/autonomy/entityManager.js";
import { plan } from "../../src/autonomy/planner.js";
import { ActionRegistry } from "../../src/autonomy/registry.js";
import type { PlanningContext, WorldState } from "../../src/autonomy/types.js";

function makeRegistry(): ActionRegistry {
  const reg = new ActionRegistry();
  registerBuiltinActions(reg);
  return reg;
}

function makeCtx(overrides?: Partial<PlanningContext>): PlanningContext {
  const em = new EntityManager();
  return {
    npcId: "npc_1",
    currentTick: 1000,
    currentState: new Map(),
    world: { isWalkable: () => true },
    entityManager: em,
    npcPosition: { x: 5, y: 5 },
    otherPlayers: [],
    recentActionHistory: [],
    rememberedTargets: [],
    ...overrides,
  };
}

function requirePlan<T>(value: T | null): T {
  if (value === null) {
    throw new Error("expected plan");
  }
  return value;
}

describe("GOAP Planner", () => {
  it("returns null when goal is already satisfied", () => {
    const registry = makeRegistry();
    const current: WorldState = new Map([["need_food_satisfied", true]]);
    const goal: WorldState = new Map([["need_food_satisfied", true]]);
    const ctx = makeCtx({ currentState: current });

    const result = plan(current, goal, registry, ctx);
    expect(result).toBeNull();
  });

  it("plans eat when NPC has food and food is unsatisfied", () => {
    const registry = makeRegistry();
    const current: WorldState = new Map([
      ["has_raw_food", true],
      ["need_food_satisfied", false],
    ]);
    const goal: WorldState = new Map([["need_food_satisfied", true]]);
    const ctx = makeCtx({ currentState: current });

    const result = requirePlan(plan(current, goal, registry, ctx));
    expect(result.steps.some((s) => s.actionId === "eat")).toBe(true);
  });

  it("plans harvest -> eat when NPC has no food but is near a bush", () => {
    const em = new EntityManager();
    em.spawn("berry_bush", { x: 5, y: 5 }, { berries: 5 });

    const current: WorldState = new Map([
      ["near_berry_bush", true],
      ["need_food_satisfied", false],
    ]);
    const goal: WorldState = new Map([["need_food_satisfied", true]]);
    const registry = makeRegistry();
    const ctx = makeCtx({ currentState: current, entityManager: em });

    const result = requirePlan(plan(current, goal, registry, ctx));
    const actionIds = result.steps.map((s) => s.actionId);
    expect(actionIds).toContain("harvest");
    expect(actionIds).toContain("eat");
    // harvest should come before eat
    expect(actionIds.indexOf("harvest")).toBeLessThan(actionIds.indexOf("eat"));
  });

  it("plans attack_bear -> pickup_bear_meat -> eat_bear_meat when hunting is the food path", () => {
    const em = new EntityManager();
    em.spawn("bear", { x: 6, y: 5 }, { state: "idle", hp: 20, maxHp: 20 });

    const current: WorldState = new Map([
      ["near_bear", true],
      ["need_food_satisfied", false],
    ]);
    const goal: WorldState = new Map([["need_food_satisfied", true]]);
    const registry = makeRegistry();
    const ctx = makeCtx({ currentState: current, entityManager: em });

    const result = requirePlan(plan(current, goal, registry, ctx));
    expect(result.steps.map((step) => step.actionId)).toEqual([
      "attack_bear",
      "pickup_bear_meat",
      "eat_bear_meat",
    ]);
  });

  it("plans goto -> harvest -> eat when NPC is far from bush", () => {
    const em = new EntityManager();
    const bush = em.spawn("berry_bush", { x: 10, y: 10 }, { berries: 5 });

    const current: WorldState = new Map([["need_food_satisfied", false]]);
    const goal: WorldState = new Map([["need_food_satisfied", true]]);
    const registry = makeRegistry();
    const ctx = makeCtx({
      currentState: current,
      entityManager: em,
      npcPosition: { x: 1, y: 1 },
      rememberedTargets: [
        {
          targetType: "berry_bush",
          targetId: bush.id,
          position: bush.position,
          lastSeenTick: 999,
          source: "observation",
          availability: "available",
        },
      ],
    });

    const result = requirePlan(plan(current, goal, registry, ctx));
    const actionIds = result.steps.map((s) => s.actionId);
    expect(actionIds).toContain("__goto");
    expect(actionIds).toContain("harvest");
    expect(actionIds).toContain("eat");
  });

  it("plans goto -> attack_bear -> pickup_bear_meat -> eat_bear_meat when the bear is distant", () => {
    const em = new EntityManager();
    const bear = em.spawn(
      "bear",
      { x: 10, y: 10 },
      {
        state: "idle",
        hp: 20,
        maxHp: 20,
      },
    );

    const current: WorldState = new Map([["need_food_satisfied", false]]);
    const goal: WorldState = new Map([["need_food_satisfied", true]]);
    const registry = makeRegistry();
    const ctx = makeCtx({
      currentState: current,
      entityManager: em,
      npcPosition: { x: 1, y: 1 },
      rememberedTargets: [
        {
          targetType: "bear",
          targetId: bear.id,
          position: bear.position,
          lastSeenTick: 999,
          source: "observation",
          availability: "danger",
        },
      ],
    });

    const result = requirePlan(plan(current, goal, registry, ctx));
    expect(result.steps.map((step) => step.actionId)).toEqual([
      "__goto",
      "attack_bear",
      "pickup_bear_meat",
      "eat_bear_meat",
    ]);
  });

  it("plans goto -> drink when water is low and the pond is distant", () => {
    const em = new EntityManager();
    const water = em.spawn("water_source", { x: 9, y: 8 });
    const registry = makeRegistry();
    const current: WorldState = new Map([["need_water_satisfied", false]]);
    const goal: WorldState = new Map([["need_water_satisfied", true]]);
    const ctx = makeCtx({
      currentState: current,
      entityManager: em,
      npcPosition: { x: 1, y: 1 },
      rememberedTargets: [
        {
          targetType: "water_source",
          targetId: water.id,
          position: water.position,
          lastSeenTick: 999,
          source: "observation",
          availability: "available",
        },
      ],
      world: {
        isWalkable: (x, y) => !(x === 9 && y === 9) && !(x === 10 && y === 9),
      },
    });

    const result = requirePlan(plan(current, goal, registry, ctx));
    expect(result.steps.map((step) => step.actionId)).toEqual([
      "__goto",
      "drink",
    ]);
  });

  it("plans drink when already near the pond", () => {
    const em = new EntityManager();
    em.spawn("water_source", { x: 5, y: 6 });

    const current: WorldState = new Map([
      ["near_water_source", true],
      ["need_water_satisfied", false],
    ]);
    const goal: WorldState = new Map([["need_water_satisfied", true]]);
    const registry = makeRegistry();
    const ctx = makeCtx({ currentState: current, entityManager: em });

    const result = requirePlan(plan(current, goal, registry, ctx));
    expect(result.steps.some((s) => s.actionId === "drink")).toBe(true);
  });

  it("plans goto -> socialize when a player is available but far away", () => {
    const registry = makeRegistry();
    const current: WorldState = new Map([["need_social_satisfied", false]]);
    const goal: WorldState = new Map([["need_social_satisfied", true]]);
    const ctx = makeCtx({
      currentState: current,
      rememberedTargets: [
        {
          targetType: "player",
          targetId: "human_1",
          position: { x: 10, y: 5 },
          lastSeenTick: 999,
          source: "observation",
          availability: "available",
        },
      ],
    });

    const result = requirePlan(plan(current, goal, registry, ctx));
    expect(result.steps.map((step) => step.actionId)).toEqual([
      "__goto",
      "socialize",
    ]);
  });

  it("plans goto -> pickup for distant ground items", () => {
    const em = new EntityManager();
    const item = em.spawn(
      "ground_item",
      { x: 9, y: 5 },
      { itemId: "raw_food", quantity: 1 },
    );

    const registry = makeRegistry();
    const current: WorldState = new Map();
    const goal: WorldState = new Map([["has_raw_food", true]]);
    const ctx = makeCtx({
      currentState: current,
      entityManager: em,
      npcPosition: { x: 5, y: 5 },
      rememberedTargets: [
        {
          targetType: "ground_item",
          targetId: item.id,
          position: item.position,
          lastSeenTick: 999,
          source: "observation",
          availability: "available",
        },
      ],
    });

    const result = requirePlan(plan(current, goal, registry, ctx));
    expect(result.steps.map((step) => step.actionId)).toEqual([
      "__goto",
      "pickup",
    ]);
  });

  it("picks lower-cost plan between alternatives", () => {
    const registry = makeRegistry();
    // NPC has food — eat is cheaper (cost 1) than harvest+eat
    const current: WorldState = new Map([
      ["has_raw_food", true],
      ["near_berry_bush", true],
      ["need_food_satisfied", false],
    ]);
    const goal: WorldState = new Map([["need_food_satisfied", true]]);
    const ctx = makeCtx({ currentState: current });

    const result = requirePlan(plan(current, goal, registry, ctx));
    // Should pick just eat (cost 1) rather than harvest+eat (cost 3)
    expect(result.steps.length).toBe(1);
    expect(result.steps[0].actionId).toBe("eat");
  });

  it("does not plan toward a distant target that has not been observed", () => {
    const em = new EntityManager();
    em.spawn("berry_bush", { x: 10, y: 10 }, { berries: 5 });

    const registry = makeRegistry();
    const current: WorldState = new Map([["need_food_satisfied", false]]);
    const goal: WorldState = new Map([["need_food_satisfied", true]]);
    const ctx = makeCtx({
      currentState: current,
      entityManager: em,
      npcPosition: { x: 1, y: 1 },
      rememberedTargets: [],
    });

    expect(plan(current, goal, registry, ctx)).toBeNull();
  });

  it("avoids a recently failed berry bush when picking a goto target", () => {
    const em = new EntityManager();
    const bushA = em.spawn("berry_bush", { x: 6, y: 5 }, { berries: 0 });
    const bushB = em.spawn("berry_bush", { x: 9, y: 5 }, { berries: 5 });

    const current: WorldState = new Map([["need_food_satisfied", false]]);
    const goal: WorldState = new Map([["need_food_satisfied", true]]);
    const registry = makeRegistry();
    const ctx = makeCtx({
      currentState: current,
      entityManager: em,
      npcPosition: { x: 5, y: 5 },
      rememberedTargets: [
        {
          targetType: "berry_bush",
          targetId: bushA.id,
          position: bushA.position,
          lastSeenTick: 999,
          source: "observation",
          availability: "depleted",
        },
        {
          targetType: "berry_bush",
          targetId: bushB.id,
          position: bushB.position,
          lastSeenTick: 999,
          source: "observation",
          availability: "available",
        },
      ],
      recentActionHistory: [
        {
          actionId: "harvest",
          outcome: "failed",
          tick: 995,
          outcomeTag: "resource_depleted",
          targetType: "berry_bush",
          targetId: bushA.id,
          targetPosition: bushA.position,
        },
      ],
    });

    const result = requirePlan(plan(current, goal, registry, ctx));
    expect(result.steps[0]).toEqual({
      actionId: "__goto",
      targetPosition: bushB.position,
    });
  });

  it("uses recent failure memory to pick a different food plan", () => {
    const em = new EntityManager();
    const bush = em.spawn("berry_bush", { x: 5, y: 6 }, { berries: 0 });
    em.spawn("bear", { x: 6, y: 5 }, { state: "idle", hp: 20, maxHp: 20 });

    const current: WorldState = new Map([
      ["near_berry_bush", true],
      ["near_bear", true],
      ["need_food_satisfied", false],
    ]);
    const goal: WorldState = new Map([["need_food_satisfied", true]]);
    const registry = makeRegistry();
    const ctx = makeCtx({
      currentState: current,
      entityManager: em,
      recentActionHistory: [
        {
          actionId: "harvest",
          outcome: "failed",
          tick: 998,
          outcomeTag: "resource_depleted",
          targetType: "berry_bush",
          targetId: bush.id,
          targetPosition: bush.position,
        },
      ],
    });

    const result = requirePlan(plan(current, goal, registry, ctx));
    expect(result.steps.map((step) => step.actionId)).toEqual([
      "attack_bear",
      "pickup_bear_meat",
      "eat_bear_meat",
    ]);
  });

  it("prefers a remembered available target over a remembered unavailable one", () => {
    const em = new EntityManager();
    const bushA = em.spawn("berry_bush", { x: 6, y: 5 }, { berries: 5 });
    const bushB = em.spawn("berry_bush", { x: 7, y: 5 }, { berries: 5 });

    const current: WorldState = new Map([["need_food_satisfied", false]]);
    const goal: WorldState = new Map([["need_food_satisfied", true]]);
    const registry = makeRegistry();
    const ctx = makeCtx({
      currentState: current,
      entityManager: em,
      rememberedTargets: [
        {
          targetType: "berry_bush",
          targetId: bushA.id,
          position: bushA.position,
          lastSeenTick: 999,
          source: "observation",
          availability: "unavailable",
        },
        {
          targetType: "berry_bush",
          targetId: bushB.id,
          position: bushB.position,
          lastSeenTick: 999,
          source: "observation",
          availability: "available",
        },
      ],
    });

    const result = requirePlan(plan(current, goal, registry, ctx));
    expect(result.steps[0]).toEqual({
      actionId: "__goto",
      targetPosition: bushB.position,
    });
  });
});
