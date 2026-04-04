import { describe, expect, it } from "vitest";
import {
  addItem,
  createInventory,
  getItemCount,
  hasItem,
  removeItem,
} from "../../src/autonomy/inventory.js";

describe("NPC Inventory", () => {
  it("starts empty", () => {
    const inv = createInventory();
    expect(inv.size).toBe(0);
    expect(hasItem(inv, "raw_food")).toBe(false);
  });

  it("adds items", () => {
    const inv = createInventory();
    addItem(inv, "raw_food");
    expect(hasItem(inv, "raw_food")).toBe(true);
    expect(getItemCount(inv, "raw_food")).toBe(1);
  });

  it("adds multiple of same item", () => {
    const inv = createInventory();
    addItem(inv, "raw_food", 3);
    expect(getItemCount(inv, "raw_food")).toBe(3);
    expect(hasItem(inv, "raw_food", 3)).toBe(true);
    expect(hasItem(inv, "raw_food", 4)).toBe(false);
  });

  it("removes items", () => {
    const inv = createInventory();
    addItem(inv, "raw_food", 3);
    expect(removeItem(inv, "raw_food")).toBe(true);
    expect(getItemCount(inv, "raw_food")).toBe(2);
  });

  it("fails to remove items not in inventory", () => {
    const inv = createInventory();
    expect(removeItem(inv, "raw_food")).toBe(false);
  });

  it("fails to remove more than available", () => {
    const inv = createInventory();
    addItem(inv, "raw_food", 1);
    expect(removeItem(inv, "raw_food", 2)).toBe(false);
    expect(getItemCount(inv, "raw_food")).toBe(1); // unchanged
  });

  it("deletes entry when count reaches zero", () => {
    const inv = createInventory();
    addItem(inv, "raw_food", 1);
    removeItem(inv, "raw_food");
    expect(inv.has("raw_food")).toBe(false);
  });
});
