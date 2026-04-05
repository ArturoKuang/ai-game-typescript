import { describe, expect, it } from "vitest";
import { EntityManager } from "../../src/autonomy/entityManager.js";
import { createInventory } from "../../src/autonomy/inventory.js";
import { createDefaultNeeds } from "../../src/autonomy/needs.js";
import type { GameLoopInterface } from "../../src/autonomy/types.js";
import { snapshotWorldState } from "../../src/autonomy/worldState.js";

function makeMockGame(players: Array<{ id: string; x: number; y: number; state: string; isNpc: boolean }>): GameLoopInterface {
  return {
    currentTick: 100,
    enqueue: () => {},
    getPlayer: (id: string) => players.find((p) => p.id === id),
    getPlayers: () => players,
    setPlayerTarget: () => null,
  };
}

describe("snapshotWorldState", () => {
  it("includes need satisfaction predicates", () => {
    const game = makeMockGame([
      { id: "npc_1", x: 5, y: 5, state: "idle", isNpc: true },
    ]);
    const needs = createDefaultNeeds();
    const inv = createInventory();
    const em = new EntityManager();

    const state = snapshotWorldState("npc_1", game, needs, inv, em);
    // Default needs are all above urgency thresholds
    expect(state.get("need_food_satisfied")).toBe(true);
    expect(state.get("need_water_satisfied")).toBe(true);
  });

  it("marks need as unsatisfied when below threshold", () => {
    const game = makeMockGame([
      { id: "npc_1", x: 5, y: 5, state: "idle", isNpc: true },
    ]);
    const needs = createDefaultNeeds();
    needs.food = 10; // below urgency threshold (40)
    const inv = createInventory();
    const em = new EntityManager();

    const state = snapshotWorldState("npc_1", game, needs, inv, em);
    expect(state.get("need_food_satisfied")).toBe(false);
  });

  it("includes inventory predicates", () => {
    const game = makeMockGame([
      { id: "npc_1", x: 5, y: 5, state: "idle", isNpc: true },
    ]);
    const needs = createDefaultNeeds();
    const inv = createInventory();
    inv.set("raw_food", 2);
    const em = new EntityManager();

    const state = snapshotWorldState("npc_1", game, needs, inv, em);
    expect(state.get("has_raw_food")).toBe(true);
  });

  it("includes proximity predicates for nearby entities", () => {
    const game = makeMockGame([
      { id: "npc_1", x: 5, y: 5, state: "idle", isNpc: true },
    ]);
    const needs = createDefaultNeeds();
    const inv = createInventory();
    const em = new EntityManager();
    em.spawn("berry_bush", { x: 5, y: 6 }); // 1 tile away

    const state = snapshotWorldState("npc_1", game, needs, inv, em);
    expect(state.get("near_berry_bush")).toBe(true);
  });

  it("does not include proximity for distant entities", () => {
    const game = makeMockGame([
      { id: "npc_1", x: 5, y: 5, state: "idle", isNpc: true },
    ]);
    const needs = createDefaultNeeds();
    const inv = createInventory();
    const em = new EntityManager();
    em.spawn("berry_bush", { x: 15, y: 15 }); // 20 tiles away

    const state = snapshotWorldState("npc_1", game, needs, inv, em);
    expect(state.has("near_berry_bush")).toBe(false);
  });

  it("includes nearby player proximity", () => {
    const game = makeMockGame([
      { id: "npc_1", x: 5, y: 5, state: "idle", isNpc: true },
      { id: "human_1", x: 5, y: 6, state: "idle", isNpc: false },
    ]);
    const needs = createDefaultNeeds();
    const inv = createInventory();
    const em = new EntityManager();

    const state = snapshotWorldState("npc_1", game, needs, inv, em);
    expect(state.get("near_player")).toBe(true);
  });
});
