import { describe, expect, it } from "vitest";
import { EntityManager } from "../../src/autonomy/entityManager.js";

describe("EntityManager", () => {
  it("spawns and retrieves entities", () => {
    const em = new EntityManager();
    const entity = em.spawn("berry_bush", { x: 5, y: 5 }, { berries: 3 });
    expect(entity.type).toBe("berry_bush");
    expect(entity.position).toEqual({ x: 5, y: 5 });
    expect(entity.properties.berries).toBe(3);
    expect(em.get(entity.id)).toBe(entity);
  });

  it("gets entities by type", () => {
    const em = new EntityManager();
    em.spawn("berry_bush", { x: 5, y: 5 });
    em.spawn("berry_bush", { x: 10, y: 10 });
    em.spawn("bench", { x: 7, y: 7 });
    expect(em.getByType("berry_bush")).toHaveLength(2);
    expect(em.getByType("bench")).toHaveLength(1);
  });

  it("gets entities at position", () => {
    const em = new EntityManager();
    em.spawn("berry_bush", { x: 5, y: 5 });
    em.spawn("bench", { x: 5, y: 5 });
    expect(em.getAt({ x: 5, y: 5 })).toHaveLength(2);
    expect(em.getAt({ x: 1, y: 1 })).toHaveLength(0);
  });

  it("gets nearby entities sorted by distance", () => {
    const em = new EntityManager();
    em.spawn("berry_bush", { x: 10, y: 10 }); // dist 10
    em.spawn("berry_bush", { x: 5, y: 5 }); // dist 0
    em.spawn("berry_bush", { x: 7, y: 7 }); // dist 4

    const nearby = em.getNearby({ x: 5, y: 5 }, 5);
    expect(nearby).toHaveLength(2); // excludes 10,10 (dist 10)
    expect(nearby[0].position).toEqual({ x: 5, y: 5 }); // closest first
  });

  it("filters nearby by type", () => {
    const em = new EntityManager();
    em.spawn("berry_bush", { x: 5, y: 5 });
    em.spawn("bench", { x: 5, y: 6 });

    const bushes = em.getNearby({ x: 5, y: 5 }, 5, "berry_bush");
    expect(bushes).toHaveLength(1);
    expect(bushes[0].type).toBe("berry_bush");
  });

  it("destroys entities", () => {
    const em = new EntityManager();
    const entity = em.spawn("berry_bush", { x: 5, y: 5 });
    em.destroy(entity.id);
    expect(em.get(entity.id)).toBeUndefined();
    expect(em.getAll()).toHaveLength(0);
  });

  it("notifies listeners on spawn, update, and destroy", () => {
    const em = new EntityManager();
    const events: string[] = [];
    em.onChange((event, entity) => {
      events.push(`${event}:${entity.type}`);
    });

    const entity = em.spawn("berry_bush", { x: 5, y: 5 }, { berries: 5 });
    expect(events).toContain("update:berry_bush");

    em.updateProperty(entity.id, "berries", 4);
    expect(events.filter((e) => e === "update:berry_bush")).toHaveLength(2);

    em.destroy(entity.id);
    expect(events).toContain("removed:berry_bush");
  });

  it("loads from map data", () => {
    const em = new EntityManager();
    em.loadFromMapData([
      { type: "berry_bush", x: 7, y: 5, properties: { berries: 5 } },
      { type: "bench", x: 5, y: 15 },
    ]);
    expect(em.getAll()).toHaveLength(2);
    expect(em.getByType("berry_bush")).toHaveLength(1);
    expect(em.getByType("bench")).toHaveLength(1);
  });
});
