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
    needs.food = 20;
    needs.water = 10;
    const options = buildGoalOptions(needs);
    expect(options.length).toBeGreaterThanOrEqual(2);
    expect(options.some((o) => o.id === "satisfy_food")).toBe(true);
    expect(options.some((o) => o.id === "satisfy_water")).toBe(true);
  });

  it("offers no goal options when nothing is urgent", () => {
    const needs = createDefaultNeeds();
    const options = buildGoalOptions(needs);
    expect(options).toHaveLength(0);
  });

  it("scripted selection picks most urgent need", () => {
    const needs = createDefaultNeeds();
    needs.food = 10;
    needs.water = 25;
    const result = selectGoalScripted(needs);
    expect(result).not.toBeNull();
    expect(result!.goalId).toBe("satisfy_food");
  });

  it("scripted selection returns null when nothing urgent", () => {
    const needs = createDefaultNeeds();
    const result = selectGoalScripted(needs);
    expect(result).toBeNull();
  });

  it("converts goalId back to WorldState", () => {
    const state = goalIdToState("satisfy_food");
    expect(state).not.toBeNull();
    expect(state!.get("need_food_satisfied")).toBe(true);
  });

  it("returns null for unknown goalId", () => {
    expect(goalIdToState("unknown_goal")).toBeNull();
  });
});
