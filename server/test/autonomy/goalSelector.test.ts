import { describe, expect, it } from "vitest";
import {
  buildGoalOptions,
  goalIdToState,
  selectGoalScripted,
} from "../../src/autonomy/goalSelector.js";
import { createDefaultNeeds } from "../../src/autonomy/needs.js";

describe("Goal Selector", () => {
  it("builds goal options from urgent needs", () => {
    const needs = createDefaultNeeds();
    needs.hunger = 20;
    needs.energy = 10;
    const options = buildGoalOptions(needs);
    expect(options.length).toBeGreaterThanOrEqual(2);
    expect(options.some((o) => o.id === "satisfy_hunger")).toBe(true);
    expect(options.some((o) => o.id === "satisfy_energy")).toBe(true);
  });

  it("offers curiosity when nothing is urgent", () => {
    const needs = createDefaultNeeds();
    const options = buildGoalOptions(needs);
    expect(options).toHaveLength(1);
    expect(options[0].id).toBe("satisfy_curiosity");
  });

  it("scripted selection picks most urgent need", () => {
    const needs = createDefaultNeeds();
    needs.hunger = 10;
    needs.energy = 25;
    const result = selectGoalScripted(needs);
    expect(result).not.toBeNull();
    expect(result!.goalId).toBe("satisfy_hunger");
  });

  it("scripted selection returns curiosity when nothing urgent", () => {
    const needs = createDefaultNeeds();
    const result = selectGoalScripted(needs);
    expect(result).not.toBeNull();
    expect(result!.goalId).toBe("satisfy_curiosity");
  });

  it("converts goalId back to WorldState", () => {
    const state = goalIdToState("satisfy_hunger");
    expect(state).not.toBeNull();
    expect(state!.get("need_hunger_satisfied")).toBe(true);
  });

  it("returns null for unknown goalId", () => {
    expect(goalIdToState("unknown_goal")).toBeNull();
  });
});
