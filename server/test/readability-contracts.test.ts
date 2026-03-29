/**
 * Pre-refactor readability contract tests.
 *
 * These lock down behaviors that will be touched by the readability
 * refactors (broadcast mapping, scenarios, naming, dedup) so we can
 * verify nothing breaks.
 */
import { afterEach, describe, expect, it } from "vitest";
import { TestGame } from "./helpers/testGame.js";
import { SCENARIOS, listScenarios } from "../src/debug/scenarios.js";
import { CHARACTERS } from "../src/data/characters.js";
import { cosineSimilarity, PlaceholderEmbedder } from "../src/npc/embedding.js";
import type { GameEvent } from "../src/engine/types.js";

// ---------- Scenario contracts ----------

describe("Scenario contracts", () => {
  let tg: TestGame;

  afterEach(() => tg?.destroy());

  it("crowded_town spawns 5 NPCs with correct IDs", () => {
    tg = new TestGame({ map: "default" });
    SCENARIOS.crowded_town.setup(tg.game);

    const players = tg.game.getPlayers();
    const npcIds = players.filter((p) => p.isNpc).map((p) => p.id).sort();
    expect(npcIds).toEqual([
      "npc_alice",
      "npc_bob",
      "npc_carol",
      "npc_dave",
      "npc_eve",
    ]);
  });

  it("scenario NPCs match character definitions", () => {
    tg = new TestGame({ map: "default" });
    SCENARIOS.crowded_town.setup(tg.game);

    for (const char of CHARACTERS) {
      const player = tg.game.getPlayer(char.id);
      expect(player).toBeDefined();
      expect(player!.name).toBe(char.name);
      expect(player!.isNpc).toBe(true);
    }
  });

  it("listScenarios returns all scenario names", () => {
    const list = listScenarios();
    const names = list.map((s) => s.name).sort();
    expect(names).toContain("empty");
    expect(names).toContain("two_npcs_near_cafe");
    expect(names).toContain("crowded_town");
  });
});

// ---------- Cosine similarity contract ----------

describe("Cosine similarity single source", () => {
  it("identical vectors return 1", () => {
    const v = [1, 0, 0, 0];
    expect(cosineSimilarity(v, v)).toBeCloseTo(1.0);
  });

  it("orthogonal vectors return 0", () => {
    expect(cosineSimilarity([1, 0], [0, 1])).toBeCloseTo(0);
  });

  it("embedding.cosineSimilarity matches manual dot product", () => {
    const a = [0.6, 0.8];
    const b = [1, 0];
    // cos(a,b) = 0.6 / (1 * 1) = 0.6
    expect(cosineSimilarity(a, b)).toBeCloseTo(0.6);
  });
});

// ---------- Player field contracts (pre-rename) ----------

describe("Player field contracts", () => {
  let tg: TestGame;

  afterEach(() => tg?.destroy());

  it("spawned player has pathSpeed and inputSpeed fields", () => {
    tg = new TestGame();
    const p = tg.spawn("alice", 1, 1);
    // These fields are used for path vs input movement
    expect(p.pathSpeed).toBe(1.0);
    expect(p.inputSpeed).toBe(5.0);
  });

  it("input movement uses inputSpeed for velocity", () => {
    tg = new TestGame();
    tg.spawn("alice", 2, 2);
    tg.game.setPlayerInput("alice", "right", true);
    tg.tick();

    const p = tg.getPlayer("alice");
    // vx should be based on inputSpeed (5.0), not pathSpeed (1.0)
    expect(Math.abs(p.vx)).toBeCloseTo(p.inputSpeed);
  });

  it("path movement uses pathSpeed for tiles per tick", () => {
    tg = new TestGame();
    tg.spawn("alice", 1, 1);
    tg.move("alice", 3, 1);
    tg.tick();

    const p = tg.getPlayer("alice");
    // After 1 tick with speed=1.0, should have moved ~1 tile
    expect(p.x).toBeCloseTo(2, 0);
  });
});

// ---------- Broadcast event mapping contracts ----------

describe("Broadcast event mapping", () => {
  let tg: TestGame;

  afterEach(() => tg?.destroy());

  it("movement events include player_update type", () => {
    tg = new TestGame();
    const events: GameEvent[] = [];
    tg.game.on("*", (e) => events.push(e));

    tg.spawn("alice", 1, 1);
    tg.game.setPlayerInput("alice", "right", true);
    tg.tick();

    // Should have input_move and player_update events
    expect(events.some((e) => e.type === "input_move")).toBe(true);
    expect(events.some((e) => e.type === "player_update")).toBe(true);
  });

  it("conversation events carry conversation data", () => {
    tg = new TestGame({ map: "default" });
    const events: GameEvent[] = [];
    tg.game.on("*", (e) => events.push(e));

    tg.spawn("h1", 5, 8, false);
    tg.spawn("n1", 6, 8, true);
    tg.game.enqueue({
      type: "start_convo",
      playerId: "h1",
      data: { targetId: "n1" },
    });
    tg.tick();

    const startedEvt = events.find((e) => e.type === "convo_started");
    expect(startedEvt).toBeDefined();
    expect(startedEvt!.data?.conversation).toBeDefined();
    expect((startedEvt!.data!.conversation as any).player1Id).toBe("h1");
  });

  it("tick_complete event carries tick number", () => {
    tg = new TestGame();
    const events: GameEvent[] = [];
    tg.game.on("*", (e) => events.push(e));
    tg.tick();

    const tickEvt = events.find((e) => e.type === "tick_complete");
    expect(tickEvt).toBeDefined();
    expect(tickEvt!.data?.tick).toBe(1);
  });
});
