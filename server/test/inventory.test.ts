import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { TestGame } from "./helpers/testGame.js";
import { EntityManager } from "../src/autonomy/entityManager.js";
import { BearManager } from "../src/bears/bearManager.js";
import { PLAYER_INVENTORY_CAPACITY } from "../src/bears/bearConfig.js";
import type { MapData } from "../src/engine/types.js";

const TEST_MAP: MapData = {
  width: 10,
  height: 10,
  tiles: [
    ["wall", "wall", "wall", "wall", "wall", "wall", "wall", "wall", "wall", "wall"],
    ["wall", "floor", "floor", "floor", "floor", "floor", "floor", "floor", "floor", "wall"],
    ["wall", "floor", "floor", "floor", "floor", "floor", "floor", "floor", "floor", "wall"],
    ["wall", "floor", "floor", "floor", "floor", "floor", "floor", "floor", "floor", "wall"],
    ["wall", "floor", "floor", "floor", "floor", "floor", "floor", "floor", "floor", "wall"],
    ["wall", "floor", "floor", "floor", "floor", "floor", "floor", "floor", "floor", "wall"],
    ["wall", "floor", "floor", "floor", "floor", "floor", "floor", "floor", "floor", "wall"],
    ["wall", "floor", "floor", "floor", "floor", "floor", "floor", "floor", "floor", "wall"],
    ["wall", "floor", "floor", "floor", "floor", "floor", "floor", "floor", "floor", "wall"],
    ["wall", "wall", "wall", "wall", "wall", "wall", "wall", "wall", "wall", "wall"],
  ],
  activities: [
    { id: 1, name: "cafe", description: "A cafe", x: 1, y: 1, capacity: 2, emoji: "C" },
  ],
  spawnPoints: [{ x: 1, y: 1 }],
};

let tg: TestGame;
let em: EntityManager;
let bm: BearManager;

beforeEach(() => {
  tg = new TestGame({ seed: 42, map: TEST_MAP });
  em = new EntityManager();
  bm = new BearManager(tg.game, em);
});

afterEach(() => {
  tg.destroy();
});

describe("Inventory & Pickup", () => {
  describe("ground_item pickup", () => {
    it("picks up a ground_item when within range", () => {
      const player = tg.spawn("hero", 3, 3);
      em.spawn("ground_item", { x: 3, y: 3 }, { itemId: "raw_food", quantity: 2 });

      // Find the entity ID
      const items = em.getByType("ground_item");
      expect(items).toHaveLength(1);

      bm.enqueue({ type: "pickup", playerId: "hero", data: { entityId: items[0].id } });
      tg.tick(1); // triggers afterTick -> BearManager.update

      const inv = bm.getInventoryItems("hero");
      expect(inv.raw_food).toBe(2);

      // Entity should be destroyed
      expect(em.getByType("ground_item")).toHaveLength(0);
    });

    it("does not pick up items out of range", () => {
      tg.spawn("hero", 1, 1);
      em.spawn("ground_item", { x: 5, y: 5 }, { itemId: "raw_food", quantity: 1 });

      const items = em.getByType("ground_item");
      bm.enqueue({ type: "pickup", playerId: "hero", data: { entityId: items[0].id } });
      tg.tick(1);

      const inv = bm.getInventoryItems("hero");
      expect(inv.raw_food).toBeUndefined();
      expect(em.getByType("ground_item")).toHaveLength(1);
    });

    it("stacks items of the same type", () => {
      tg.spawn("hero", 3, 3);

      // Spawn two ground items at the same position
      em.spawn("ground_item", { x: 3, y: 3 }, { itemId: "raw_food", quantity: 1 });
      em.spawn("ground_item", { x: 3, y: 3 }, { itemId: "raw_food", quantity: 3 });
      const items = em.getByType("ground_item");

      bm.enqueue({ type: "pickup", playerId: "hero", data: { entityId: items[0].id } });
      tg.tick(1);
      bm.enqueue({ type: "pickup", playerId: "hero", data: { entityId: items[1].id } });
      tg.tick(1);

      const inv = bm.getInventoryItems("hero");
      expect(inv.raw_food).toBe(4);
    });
  });

  describe("inventory capacity", () => {
    it("rejects pickup when inventory is full with different item types", () => {
      tg.spawn("hero", 3, 3);

      // Fill inventory with distinct item types up to capacity
      const inv = bm.getInventory("hero");
      for (let i = 0; i < PLAYER_INVENTORY_CAPACITY; i++) {
        inv.set(`item_type_${i}`, 1);
      }

      // Try to pick up a new item type
      em.spawn("ground_item", { x: 3, y: 3 }, { itemId: "raw_food", quantity: 1 });
      const items = em.getByType("ground_item");
      bm.enqueue({ type: "pickup", playerId: "hero", data: { entityId: items[0].id } });
      tg.tick(1);

      // raw_food should NOT be in inventory (capacity full)
      const invItems = bm.getInventoryItems("hero");
      expect(invItems.raw_food).toBeUndefined();
      // Ground item should still exist
      expect(em.getByType("ground_item")).toHaveLength(1);
    });

    it("allows stacking even when at capacity", () => {
      tg.spawn("hero", 3, 3);

      // Fill inventory to capacity, including raw_food
      const inv = bm.getInventory("hero");
      inv.set("raw_food", 5);
      for (let i = 1; i < PLAYER_INVENTORY_CAPACITY; i++) {
        inv.set(`item_type_${i}`, 1);
      }

      // Pick up more raw_food — should work since it stacks
      em.spawn("ground_item", { x: 3, y: 3 }, { itemId: "raw_food", quantity: 2 });
      const items = em.getByType("ground_item");
      bm.enqueue({ type: "pickup", playerId: "hero", data: { entityId: items[0].id } });
      tg.tick(1);

      const invItems = bm.getInventoryItems("hero");
      expect(invItems.raw_food).toBe(7);
      expect(em.getByType("ground_item")).toHaveLength(0);
    });
  });

  describe("findNearestPickupable", () => {
    it("finds the nearest ground_item", () => {
      tg.spawn("hero", 3, 3);
      em.spawn("ground_item", { x: 3, y: 3 }, { itemId: "raw_food", quantity: 1 });
      em.spawn("ground_item", { x: 5, y: 5 }, { itemId: "raw_food", quantity: 1 });

      const nearest = bm.findNearestPickupable("hero");
      expect(nearest).toBeDefined();

      const entity = em.get(nearest!);
      expect(entity?.position).toEqual({ x: 3, y: 3 });
    });

    it("finds bear_meat as pickupable", () => {
      tg.spawn("hero", 3, 3);
      em.spawn("bear_meat", { x: 3, y: 3 }, { droppedAtTick: 0 });

      const nearest = bm.findNearestPickupable("hero");
      expect(nearest).toBeDefined();
      expect(em.get(nearest!)?.type).toBe("bear_meat");
    });

    it("returns undefined when nothing is nearby", () => {
      tg.spawn("hero", 1, 1);
      em.spawn("ground_item", { x: 8, y: 8 }, { itemId: "raw_food", quantity: 1 });

      const nearest = bm.findNearestPickupable("hero");
      expect(nearest).toBeUndefined();
    });
  });

  describe("bear_meat pickup", () => {
    it("picks up bear_meat just like ground_item", () => {
      tg.spawn("hero", 3, 3);
      const meat = em.spawn("bear_meat", { x: 3, y: 3 }, { droppedAtTick: 0 });

      bm.enqueue({ type: "pickup", playerId: "hero", data: { entityId: meat.id } });
      tg.tick(1);

      const inv = bm.getInventoryItems("hero");
      expect(inv.bear_meat).toBe(1);
    });
  });

  describe("getInventoryItems / getInventoryCapacity", () => {
    it("returns empty object for new player", () => {
      tg.spawn("hero", 1, 1);
      expect(bm.getInventoryItems("hero")).toEqual({});
    });

    it("returns capacity constant", () => {
      expect(bm.getInventoryCapacity()).toBe(PLAYER_INVENTORY_CAPACITY);
    });
  });
});
