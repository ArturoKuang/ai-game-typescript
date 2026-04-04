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

function makeCtx(
  overrides?: Partial<PlanningContext>,
): PlanningContext {
  const em = new EntityManager();
  return {
    npcId: "npc_1",
    currentState: new Map(),
    entityManager: em,
    npcPosition: { x: 5, y: 5 },
    ...overrides,
  };
}

describe("GOAP Planner", () => {
  it("returns null when goal is already satisfied", () => {
    const registry = makeRegistry();
    const current: WorldState = new Map([["need_hunger_satisfied", true]]);
    const goal: WorldState = new Map([["need_hunger_satisfied", true]]);
    const ctx = makeCtx({ currentState: current });

    const result = plan(current, goal, registry, ctx);
    expect(result).toBeNull();
  });

  it("plans eat when NPC has food and hunger is unsatisfied", () => {
    const registry = makeRegistry();
    const current: WorldState = new Map([
      ["has_raw_food", true],
      ["need_hunger_satisfied", false],
    ]);
    const goal: WorldState = new Map([["need_hunger_satisfied", true]]);
    const ctx = makeCtx({ currentState: current });

    const result = plan(current, goal, registry, ctx);
    expect(result).not.toBeNull();
    expect(result!.steps.some((s) => s.actionId === "eat")).toBe(true);
  });

  it("plans harvest -> eat when NPC has no food but is near a bush", () => {
    const em = new EntityManager();
    em.spawn("berry_bush", { x: 5, y: 5 }, { berries: 5 });

    const current: WorldState = new Map([
      ["near_berry_bush", true],
      ["need_hunger_satisfied", false],
    ]);
    const goal: WorldState = new Map([["need_hunger_satisfied", true]]);
    const registry = makeRegistry();
    const ctx = makeCtx({ currentState: current, entityManager: em });

    const result = plan(current, goal, registry, ctx);
    expect(result).not.toBeNull();
    const actionIds = result!.steps.map((s) => s.actionId);
    expect(actionIds).toContain("harvest");
    expect(actionIds).toContain("eat");
    // harvest should come before eat
    expect(actionIds.indexOf("harvest")).toBeLessThan(actionIds.indexOf("eat"));
  });

  it("plans goto -> harvest -> eat when NPC is far from bush", () => {
    const em = new EntityManager();
    em.spawn("berry_bush", { x: 10, y: 10 }, { berries: 5 });

    const current: WorldState = new Map([
      ["need_hunger_satisfied", false],
    ]);
    const goal: WorldState = new Map([["need_hunger_satisfied", true]]);
    const registry = makeRegistry();
    const ctx = makeCtx({
      currentState: current,
      entityManager: em,
      npcPosition: { x: 1, y: 1 },
    });

    const result = plan(current, goal, registry, ctx);
    expect(result).not.toBeNull();
    const actionIds = result!.steps.map((s) => s.actionId);
    expect(actionIds).toContain("__goto");
    expect(actionIds).toContain("harvest");
    expect(actionIds).toContain("eat");
  });

  it("plans explore for curiosity", () => {
    const registry = makeRegistry();
    const current: WorldState = new Map([["need_curiosity_satisfied", false]]);
    const goal: WorldState = new Map([["need_curiosity_satisfied", true]]);
    const ctx = makeCtx({ currentState: current });

    const result = plan(current, goal, registry, ctx);
    expect(result).not.toBeNull();
    expect(result!.steps.some((s) => s.actionId === "explore")).toBe(true);
  });

  it("plans rest when near bench", () => {
    const em = new EntityManager();
    em.spawn("bench", { x: 5, y: 5 });

    const current: WorldState = new Map([
      ["near_bench", true],
      ["need_energy_satisfied", false],
    ]);
    const goal: WorldState = new Map([["need_energy_satisfied", true]]);
    const registry = makeRegistry();
    const ctx = makeCtx({ currentState: current, entityManager: em });

    const result = plan(current, goal, registry, ctx);
    expect(result).not.toBeNull();
    expect(result!.steps.some((s) => s.actionId === "rest")).toBe(true);
  });

  it("picks lower-cost plan between alternatives", () => {
    const registry = makeRegistry();
    // NPC has food — eat is cheaper (cost 1) than harvest+eat
    const current: WorldState = new Map([
      ["has_raw_food", true],
      ["near_berry_bush", true],
      ["need_hunger_satisfied", false],
    ]);
    const goal: WorldState = new Map([["need_hunger_satisfied", true]]);
    const ctx = makeCtx({ currentState: current });

    const result = plan(current, goal, registry, ctx);
    expect(result).not.toBeNull();
    // Should pick just eat (cost 1) rather than harvest+eat (cost 3)
    expect(result!.steps.length).toBe(1);
    expect(result!.steps[0].actionId).toBe("eat");
  });
});
