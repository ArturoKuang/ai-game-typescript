import { describe, expect, it } from "vitest";
import {
  boostNeed,
  createDefaultNeeds,
  getMostUrgentNeed,
  getUrgentNeeds,
  hasCriticalNeed,
  tickNeeds,
} from "../../src/autonomy/needs.js";
import { DEFAULT_NEED_CONFIGS } from "../../src/autonomy/types.js";

describe("NPC Needs System", () => {
  it("creates default needs with initial values", () => {
    const needs = createDefaultNeeds();
    expect(needs.food).toBe(80);
    expect(needs.water).toBe(85);
    expect(needs.social).toBe(70);
  });

  it("decays needs each tick", () => {
    const needs = createDefaultNeeds();
    const initialFood = needs.food;
    const initialWater = needs.water;
    tickNeeds(needs);
    expect(needs.food).toBe(initialFood - DEFAULT_NEED_CONFIGS.food.decayPerTick);
    expect(needs.water).toBe(initialWater - DEFAULT_NEED_CONFIGS.water.decayPerTick);
  });

  it("clamps needs at zero", () => {
    const needs = createDefaultNeeds();
    needs.food = 0.001;
    tickNeeds(needs);
    expect(needs.food).toBe(0);
  });

  it("detects urgency threshold crossing", () => {
    const needs = createDefaultNeeds();
    needs.food = 40; // exactly at threshold
    const result = tickNeeds(needs);
    expect(result.newUrgent).toContain("food");
  });

  it("does not flag urgency if already below threshold", () => {
    const needs = createDefaultNeeds();
    needs.food = 30; // already below
    const result = tickNeeds(needs);
    expect(result.newUrgent).not.toContain("food");
  });

  it("detects critical threshold crossing", () => {
    const needs = createDefaultNeeds();
    needs.food = 15; // exactly at critical
    const result = tickNeeds(needs);
    expect(result.newCritical).toContain("food");
  });

  it("boosts a need and clamps at 100", () => {
    const needs = createDefaultNeeds();
    needs.food = 30;
    boostNeed(needs, "food", 50);
    expect(needs.food).toBe(80);

    boostNeed(needs, "food", 50);
    expect(needs.food).toBe(100);
  });

  it("returns urgent needs below threshold", () => {
    const needs = createDefaultNeeds();
    needs.food = 20;
    needs.water = 10;
    const urgent = getUrgentNeeds(needs);
    expect(urgent).toContain("food");
    expect(urgent).toContain("water");
    expect(urgent).not.toContain("social");
  });

  it("finds the most urgent need", () => {
    const needs = createDefaultNeeds();
    needs.food = 10;
    needs.water = 20;
    const most = getMostUrgentNeed(needs);
    expect(most).toBe("food"); // 10/40 < 20/45
  });

  it("returns null when no need is urgent", () => {
    const needs = createDefaultNeeds();
    expect(getMostUrgentNeed(needs)).toBeNull();
  });

  it("detects critical needs", () => {
    const needs = createDefaultNeeds();
    expect(hasCriticalNeed(needs)).toBe(false);
    needs.food = 5;
    expect(hasCriticalNeed(needs)).toBe(true);
  });
});
