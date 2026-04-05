import { describe, expect, it } from "vitest";
import { registerBuiltinActions } from "../../src/autonomy/actions/index.js";
import { EntityManager } from "../../src/autonomy/entityManager.js";
import { createInventory } from "../../src/autonomy/inventory.js";
import { createDefaultNeeds } from "../../src/autonomy/needs.js";
import { plan } from "../../src/autonomy/planner.js";
import { ActionRegistry } from "../../src/autonomy/registry.js";
import type { GameLoopInterface, PlanningContext, WorldState } from "../../src/autonomy/types.js";
import { snapshotWorldState } from "../../src/autonomy/worldState.js";

function makeRegistry(): ActionRegistry {
  const reg = new ActionRegistry();
  registerBuiltinActions(reg);
  return reg;
}

function makeCtx(overrides?: Partial<PlanningContext>): PlanningContext {
  return {
    npcId: "npc_1",
    currentState: new Map(),
    entityManager: new EntityManager(),
    npcPosition: { x: 5, y: 5 },
    otherPlayers: [],
    ...overrides,
  };
}

function makeMockGame(
  players: Array<{ id: string; x: number; y: number; state: string; isNpc: boolean }>,
): GameLoopInterface {
  return {
    currentTick: 100,
    enqueue: () => {},
    getPlayer: (id: string) => players.find((p) => p.id === id),
    getPlayers: () => players,
    setPlayerTarget: () => [{ x: 5, y: 5 }],
  };
}

describe("Phase 3: Safety & Flee", () => {
  it("plans flee when near hostile", () => {
    const registry = makeRegistry();
    const current: WorldState = new Map([
      ["near_hostile", true],
      ["need_safety_satisfied", false],
    ]);
    const goal: WorldState = new Map([["need_safety_satisfied", true]]);
    const ctx = makeCtx({ currentState: current });

    const result = plan(current, goal, registry, ctx);
    expect(result).not.toBeNull();
    expect(result!.steps.some((s) => s.actionId === "flee")).toBe(true);
  });

  it("world state detects nearby bears as hostile", () => {
    const em = new EntityManager();
    em.spawn("bear", { x: 7, y: 5 }, { state: "idle", hp: 30 });

    const game = makeMockGame([
      { id: "npc_1", x: 5, y: 5, state: "idle", isNpc: true },
    ]);
    const needs = createDefaultNeeds();
    const inv = createInventory();

    const state = snapshotWorldState("npc_1", game, needs, inv, em);
    expect(state.get("near_hostile")).toBe(true);
  });

  it("world state does not flag dead bears as hostile", () => {
    const em = new EntityManager();
    em.spawn("bear", { x: 7, y: 5 }, { state: "dead", hp: 0 });

    const game = makeMockGame([
      { id: "npc_1", x: 5, y: 5, state: "idle", isNpc: true },
    ]);
    const needs = createDefaultNeeds();
    const inv = createInventory();

    const state = snapshotWorldState("npc_1", game, needs, inv, em);
    expect(state.has("near_hostile")).toBe(false);
  });

  it("world state does not flag distant bears as hostile", () => {
    const em = new EntityManager();
    em.spawn("bear", { x: 15, y: 15 }, { state: "idle", hp: 30 });

    const game = makeMockGame([
      { id: "npc_1", x: 5, y: 5, state: "idle", isNpc: true },
    ]);
    const needs = createDefaultNeeds();
    const inv = createInventory();

    const state = snapshotWorldState("npc_1", game, needs, inv, em);
    expect(state.has("near_hostile")).toBe(false);
  });
});

describe("Phase 3: Pickup", () => {
  it("world state detects nearby pickupable items", () => {
    const em = new EntityManager();
    em.spawn("bear_meat", { x: 5, y: 6 }, { quantity: 1 });

    const game = makeMockGame([
      { id: "npc_1", x: 5, y: 5, state: "idle", isNpc: true },
    ]);
    const needs = createDefaultNeeds();
    const inv = createInventory();

    const state = snapshotWorldState("npc_1", game, needs, inv, em);
    expect(state.get("near_pickupable")).toBe(true);
  });

  it("plans pickup when near pickupable item", () => {
    const em = new EntityManager();
    em.spawn("bear_meat", { x: 5, y: 6 }, { quantity: 1 });

    const registry = makeRegistry();
    const current: WorldState = new Map([
      ["near_pickupable", true],
      ["need_hunger_satisfied", false],
    ]);
    const goal: WorldState = new Map([["has_raw_food", true]]);
    const ctx = makeCtx({ currentState: current, entityManager: em });

    const result = plan(current, goal, registry, ctx);
    expect(result).not.toBeNull();
    expect(result!.steps.some((s) => s.actionId === "pickup")).toBe(true);
  });

  it("registry has flee and pickup actions", () => {
    const registry = makeRegistry();
    expect(registry.get("flee")).toBeDefined();
    expect(registry.get("pickup")).toBeDefined();
    expect(registry.getAll().length).toBe(10); // goto, harvest, cook, eat, eat_cooked, rest, socialize, explore, flee, pickup
  });
});
