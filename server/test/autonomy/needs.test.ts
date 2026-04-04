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
    expect(needs.hunger).toBe(80);
    expect(needs.energy).toBe(90);
    expect(needs.social).toBe(70);
    expect(needs.safety).toBe(100);
    expect(needs.curiosity).toBe(60);
  });

  it("decays needs each tick", () => {
    const needs = createDefaultNeeds();
    const initialHunger = needs.hunger;
    tickNeeds(needs);
    expect(needs.hunger).toBe(initialHunger - DEFAULT_NEED_CONFIGS.hunger.decayPerTick);
    expect(needs.safety).toBe(100); // zero decay
  });

  it("clamps needs at zero", () => {
    const needs = createDefaultNeeds();
    needs.hunger = 0.001;
    tickNeeds(needs);
    expect(needs.hunger).toBe(0);
  });

  it("detects urgency threshold crossing", () => {
    const needs = createDefaultNeeds();
    needs.hunger = 40; // exactly at threshold
    const result = tickNeeds(needs);
    expect(result.newUrgent).toContain("hunger");
  });

  it("does not flag urgency if already below threshold", () => {
    const needs = createDefaultNeeds();
    needs.hunger = 30; // already below
    const result = tickNeeds(needs);
    expect(result.newUrgent).not.toContain("hunger");
  });

  it("detects critical threshold crossing", () => {
    const needs = createDefaultNeeds();
    needs.hunger = 15; // exactly at critical
    const result = tickNeeds(needs);
    expect(result.newCritical).toContain("hunger");
  });

  it("boosts a need and clamps at 100", () => {
    const needs = createDefaultNeeds();
    needs.hunger = 30;
    boostNeed(needs, "hunger", 50);
    expect(needs.hunger).toBe(80);

    boostNeed(needs, "hunger", 50);
    expect(needs.hunger).toBe(100);
  });

  it("returns urgent needs below threshold", () => {
    const needs = createDefaultNeeds();
    needs.hunger = 20;
    needs.energy = 10;
    const urgent = getUrgentNeeds(needs);
    expect(urgent).toContain("hunger");
    expect(urgent).toContain("energy");
    expect(urgent).not.toContain("safety");
  });

  it("finds the most urgent need", () => {
    const needs = createDefaultNeeds();
    needs.hunger = 10;
    needs.energy = 20;
    const most = getMostUrgentNeed(needs);
    expect(most).toBe("hunger"); // 10/40 < 20/30
  });

  it("returns null when no need is urgent", () => {
    const needs = createDefaultNeeds();
    expect(getMostUrgentNeed(needs)).toBeNull();
  });

  it("detects critical needs", () => {
    const needs = createDefaultNeeds();
    expect(hasCriticalNeed(needs)).toBe(false);
    needs.hunger = 5;
    expect(hasCriticalNeed(needs)).toBe(true);
  });
});
