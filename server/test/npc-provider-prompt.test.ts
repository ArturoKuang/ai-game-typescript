import { afterEach, describe, expect, it } from "vitest";
import {
  buildGoalSelectionPrompt,
  buildReflectionPrompt,
  buildReplyPrompt,
} from "../src/npc/provider.js";
import { TestGame } from "./helpers/testGame.js";

const SURVIVAL_DEATH_RULE =
  "If your health, food, water, or social value reaches 0, you die and disappear from town.";

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
        recentMemories: [],
        availableGoals: [
          { id: "satisfy_food", description: "Find something to eat" },
        ],
        currentTick: tg.game.currentTick,
      }),
    ).toContain(SURVIVAL_DEATH_RULE);
  });
});
