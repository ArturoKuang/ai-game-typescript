import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { TestGame } from "./helpers/testGame.js";
import { EntityManager } from "../src/autonomy/entityManager.js";
import { BearManager } from "../src/bears/bearManager.js";
import type { MapData } from "../src/engine/types.js";

/** 10x10 map with open floor and activities for wilderness zone testing. */
const BEAR_MAP: MapData = {
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
  tg = new TestGame({ seed: 123, map: BEAR_MAP });
  em = new EntityManager();
  bm = new BearManager(tg.game, em);
});

afterEach(() => {
  tg.destroy();
});

describe("BearManager", () => {
  describe("spawning", () => {
    it("seeds initial bears", () => {
      bm.seedInitialBears();
      const bears = bm.getBears();
      expect(bears.length).toBe(2);
      for (const bear of bears) {
        expect(bear.properties.hp).toBe(30);
        expect(bear.properties.state).toBe("idle");
      }
    });

    it("debugSpawnBear places a bear at exact coordinates", () => {
      const id = bm.debugSpawnBear(5, 5);
      const bear = em.get(id);
      expect(bear).toBeDefined();
      expect(bear!.position).toEqual({ x: 5, y: 5 });
      expect(bear!.type).toBe("bear");
    });

    it("debugKillBear removes a bear and drops meat", () => {
      const id = bm.debugSpawnBear(5, 5);
      const killed = bm.debugKillBear(id);
      expect(killed).toBe(true);
      expect(em.get(id)).toBeUndefined();
      // Bear meat should have been dropped
      const loot = bm.getLoot();
      expect(loot.length).toBe(1);
      expect(loot[0].position).toEqual({ x: 5, y: 5 });
    });
  });

  describe("bear AI", () => {
    it("bear wanders randomly when idle", () => {
      const id = bm.debugSpawnBear(5, 5);
      // Run enough ticks for the bear to move
      tg.tick(25);
      const bear = em.get(id)!;
      // Bear should have moved from its original position
      const moved = bear.position.x !== 5 || bear.position.y !== 5;
      expect(moved).toBe(true);
    });

    it("bear aggros on nearby player", () => {
      const id = bm.debugSpawnBear(5, 5);
      tg.spawn("player1", 5, 7); // within aggro radius (4)
      tg.tick(1);
      const bear = em.get(id)!;
      expect(bear.properties.state).toBe("aggro");
      expect(bear.properties.targetPlayerId).toBe("player1");
    });

    it("bear does not aggro on distant player", () => {
      const id = bm.debugSpawnBear(2, 2);
      tg.spawn("player1", 8, 8); // way outside aggro radius
      tg.tick(1);
      const bear = em.get(id)!;
      expect(bear.properties.state).toBe("idle");
    });

    it("bear chases player when aggro", () => {
      const id = bm.debugSpawnBear(5, 5);
      tg.spawn("player1", 5, 8); // 3 tiles away
      tg.tick(1); // detect player
      const bear = em.get(id)!;
      expect(bear.properties.state).toBe("aggro");
      // Advance enough for bear to move toward player
      tg.tick(25);
      // Bear should be closer to (5,8)
      expect(bear.position.y).toBeGreaterThan(5);
    });
  });

  describe("combat", () => {
    it("player can attack and kill a bear", () => {
      const bearId = bm.debugSpawnBear(2, 3);
      tg.spawn("attacker", 2, 2); // adjacent

      // Attack: 15 damage per hit, bear has 30 HP → 2 hits to kill
      bm.enqueue({ type: "attack", playerId: "attacker", data: { targetBearId: bearId } });
      tg.tick(1);

      const bear = em.get(bearId)!;
      expect(bear.properties.hp).toBe(15);

      // Wait for cooldown (10 ticks) then attack again
      tg.tick(10);
      bm.enqueue({ type: "attack", playerId: "attacker", data: { targetBearId: bearId } });
      tg.tick(1);

      // Bear should be dead
      expect(em.get(bearId)).toBeUndefined();

      // Loot should have dropped
      const loot = bm.getLoot();
      expect(loot.length).toBe(1);
      expect(loot[0].type).toBe("bear_meat");
    });

    it("bear attacks player when in range", () => {
      bm.debugSpawnBear(3, 3);
      tg.spawn("victim", 3, 4); // adjacent
      const player = tg.getPlayer("victim");
      expect(player.hp).toBe(100);

      // Bear needs to aggro first, then transition to attacking
      tg.tick(1); // aggro
      // Bear should now be in aggro or attacking state. Advance to attack.
      tg.tick(BEAR_ATTACK_COOLDOWN);

      // Player should have taken damage at some point
      expect(player.hp!).toBeLessThan(100);
    });

    it("attack respects cooldown", () => {
      const bearId = bm.debugSpawnBear(2, 3);
      tg.spawn("attacker", 2, 2);

      bm.enqueue({ type: "attack", playerId: "attacker", data: { targetBearId: bearId } });
      tg.tick(1);
      expect((em.get(bearId)!.properties.hp as number)).toBe(15);

      // Attack again immediately (should be on cooldown)
      bm.enqueue({ type: "attack", playerId: "attacker", data: { targetBearId: bearId } });
      tg.tick(1);
      expect((em.get(bearId)!.properties.hp as number)).toBe(15); // unchanged
    });

    it("attack fails when out of range", () => {
      const bearId = bm.debugSpawnBear(5, 5);
      tg.spawn("attacker", 1, 1); // far away

      bm.enqueue({ type: "attack", playerId: "attacker", data: { targetBearId: bearId } });
      tg.tick(1);
      expect((em.get(bearId)!.properties.hp as number)).toBe(30); // unchanged
    });
  });

  describe("loot and food", () => {
    it("player can pick up bear meat", () => {
      bm.debugSpawnBear(3, 3);
      bm.debugKillBear(bm.getBears()[0].id);
      const loot = bm.getLoot();
      expect(loot.length).toBe(1);

      tg.spawn("looter", 3, 3);
      bm.enqueue({ type: "pickup", playerId: "looter", data: { entityId: loot[0].id } });
      tg.tick(1);

      // Loot gone from ground, item in inventory
      expect(bm.getLoot().length).toBe(0);
      const items = bm.getInventoryItems("looter");
      expect(items["bear_meat"]).toBe(1);
    });

    it("eating bear meat restores HP", () => {
      tg.spawn("eater", 2, 2);
      const player = tg.getPlayer("eater");
      player.hp = 50; // damage the player

      // Give them bear meat
      const inv = bm.getInventory("eater");
      inv.set("bear_meat", 1);

      bm.enqueue({ type: "eat", playerId: "eater", data: { item: "bear_meat" } });
      tg.tick(1);

      expect(player.hp).toBe(75); // 50 + 25 heal
      expect(bm.getInventoryItems("eater")["bear_meat"]).toBeUndefined();
    });

    it("eating does not exceed max HP", () => {
      tg.spawn("eater", 2, 2);
      const player = tg.getPlayer("eater");
      player.hp = 95;

      const inv = bm.getInventory("eater");
      inv.set("bear_meat", 1);

      bm.enqueue({ type: "eat", playerId: "eater", data: { item: "bear_meat" } });
      tg.tick(1);

      expect(player.hp).toBe(100); // capped at maxHp
    });

    it("pickup fails when out of range", () => {
      bm.debugSpawnBear(5, 5);
      bm.debugKillBear(bm.getBears()[0].id);
      const loot = bm.getLoot();

      tg.spawn("looter", 1, 1); // far away
      bm.enqueue({ type: "pickup", playerId: "looter", data: { entityId: loot[0].id } });
      tg.tick(1);

      // Loot still on ground
      expect(bm.getLoot().length).toBe(1);
    });
  });

  describe("Game of Life automaton", () => {
    it("births new bears when 2-3 neighbors exist", () => {
      // Place 2 bears close together — within Chebyshev distance 3
      bm.debugSpawnBear(4, 4);
      bm.debugSpawnBear(6, 4);
      expect(bm.getBears().length).toBe(2);

      // Run GoL evaluation
      bm.evaluateGameOfLife(300);

      // Should have spawned at least one new bear near them
      expect(bm.getBears().length).toBeGreaterThan(2);
    });

    it("overcrowding kills bears with too many neighbors", () => {
      // Place 5 bears in a tight cluster
      bm.debugSpawnBear(4, 4);
      bm.debugSpawnBear(5, 4);
      bm.debugSpawnBear(6, 4);
      bm.debugSpawnBear(4, 5);
      bm.debugSpawnBear(5, 5);
      const initial = bm.getBears().length;
      expect(initial).toBe(5);

      bm.evaluateGameOfLife(300);

      // Some bears should have been killed by overcrowding
      expect(bm.getBears().length).toBeLessThan(initial);
    });

    it("lonely bears despawn after loneliness timeout", () => {
      const bearId = bm.debugSpawnBear(8, 8); // isolated bear

      // GOL_EVAL_INTERVAL (300) > GOL_LONELINESS_TICKS (200)
      // So on the first eval, the loneliness timer hits 300 which exceeds
      // the threshold of 200 — the bear dies immediately.
      bm.evaluateGameOfLife(300);
      expect(em.get(bearId)).toBeUndefined();
    });

    it("population cap prevents over-spawning", () => {
      // Spawn 6 bears (the cap)
      for (let i = 0; i < 6; i++) {
        bm.debugSpawnBear(2 + i, 4);
      }

      bm.evaluateGameOfLife(300);

      // Even after GoL, should not exceed cap
      expect(bm.getBears().length).toBeLessThanOrEqual(6);
    });

    it("minimum population is maintained", () => {
      // No bears initially
      expect(bm.getBears().length).toBe(0);

      // Tick should seed a bear since we're below minimum
      tg.tick(1);
      expect(bm.getBears().length).toBeGreaterThanOrEqual(1);
    });
  });

  describe("player HP", () => {
    it("players spawn with 100 HP", () => {
      tg.spawn("test_player", 2, 2);
      const p = tg.getPlayer("test_player");
      expect(p.hp).toBe(100);
      expect(p.maxHp).toBe(100);
    });
  });
});

// Import the constant used in the test
import { BEAR_ATTACK_COOLDOWN } from "../src/bears/bearConfig.js";
