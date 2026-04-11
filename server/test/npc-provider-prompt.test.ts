import { afterEach, describe, expect, it } from "vitest";
import {
  buildGoalSelectionPrompt,
  buildReflectionPrompt,
  buildReplyPrompt,
} from "../src/npc/provider.js";
import { TestGame } from "./helpers/testGame.js";

const SURVIVAL_DEATH_RULE =
  "If your health, food, water, or social value reaches 0, you die and your body is lost to the land.";

describe("NPC prompt builders", () => {
  let tg: TestGame;

  afterEach(() => {
    tg?.destroy();
  });

  it("includes the survival death rule in reply, reflection, and goal prompts", () => {
    tg = new TestGame();
    const npc = tg.spawn("npc_1", 1, 1, true);
    const human = tg.spawn("human_1", 2, 1, false);

    expect(
      buildReplyPrompt({
        conversationId: 1,
        npc,
        partner: human,
        messages: [],
        memories: [],
        currentTick: tg.game.currentTick,
      }),
    ).toContain(SURVIVAL_DEATH_RULE);

    expect(
      buildReflectionPrompt({
        npc,
        memories: [],
        currentTick: tg.game.currentTick,
      }),
    ).toContain(SURVIVAL_DEATH_RULE);

    expect(
      buildGoalSelectionPrompt({
        npc,
        needs: {
          health: 100,
          food: 50,
          water: 50,
          social: 50,
        },
        inventory: {},
        nearbyEntities: [],
        rememberedTargets: [],
        recentMemories: [],
        availableGoals: [
          { id: "satisfy_food", description: "Find something to eat" },
        ],
        currentTick: tg.game.currentTick,
      }),
    ).toContain(SURVIVAL_DEATH_RULE);
  });

  it("includes remembered targets in goal prompts", () => {
    tg = new TestGame();
    const npc = tg.spawn("npc_1", 1, 1, true);

    const prompt = buildGoalSelectionPrompt({
      npc,
      needs: {
        health: 100,
        food: 25,
        water: 50,
        social: 50,
      },
      inventory: {},
      nearbyEntities: [],
      rememberedTargets: [
        {
          type: "water_source",
          distance: 6,
          ageTicks: 40,
          source: "observation",
          availability: "available",
        },
      ],
      recentMemories: [],
      availableGoals: [
        { id: "satisfy_water", description: "Find something to drink" },
      ],
      currentTick: tg.game.currentTick,
    });

    expect(prompt).toContain("Remembered targets:");
    expect(prompt).toContain("water_source");
    expect(prompt).toContain("seen 40 ticks ago");
  });
});
