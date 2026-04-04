/**
 * Builds goal options from NPC needs and delegates selection to the
 * model provider (LLM or scripted fallback).
 */
import type { NeedType, NpcNeeds, GoalOption, NpcInventory, WorldState } from "./types.js";
import { getUrgentNeeds, getMostUrgentNeed } from "./needs.js";
import { DEFAULT_NEED_CONFIGS } from "./types.js";

/** Maps need types to GOAP goal predicates. */
const NEED_TO_GOAL: Record<NeedType, { goalId: string; description: string; predicate: [string, boolean] }> = {
  hunger: {
    goalId: "satisfy_hunger",
    description: "Find food to eat (hunger is urgent)",
    predicate: ["need_hunger_satisfied", true],
  },
  energy: {
    goalId: "satisfy_energy",
    description: "Find a place to rest (energy is low)",
    predicate: ["need_energy_satisfied", true],
  },
  social: {
    goalId: "satisfy_social",
    description: "Talk to someone nearby (feeling lonely)",
    predicate: ["need_social_satisfied", true],
  },
  safety: {
    goalId: "satisfy_safety",
    description: "Find safety (feeling threatened)",
    predicate: ["need_safety_satisfied", true],
  },
  curiosity: {
    goalId: "satisfy_curiosity",
    description: "Explore the area (feeling bored)",
    predicate: ["need_curiosity_satisfied", true],
  },
};

export interface GoalSelectionResult {
  goalId: string;
  goalState: WorldState;
  reasoning?: string;
}

/** Build the list of available goal options based on current needs. */
export function buildGoalOptions(needs: NpcNeeds): GoalOption[] {
  const toOption = (entry: typeof NEED_TO_GOAL[NeedType]): GoalOption => ({
    id: entry.goalId,
    description: entry.description,
  });

  const urgent = getUrgentNeeds(needs);
  if (urgent.length === 0) {
    // Nothing urgent — offer curiosity as a default
    return [toOption(NEED_TO_GOAL.curiosity)];
  }
  return urgent.map((need) => toOption(NEED_TO_GOAL[need]));
}

/**
 * Scripted (deterministic) goal selection — picks the most urgent need.
 * Used as fallback when LLM provider is unavailable or in tests.
 */
export function selectGoalScripted(needs: NpcNeeds): GoalSelectionResult | null {
  const mostUrgent = getMostUrgentNeed(needs);
  if (!mostUrgent) {
    // Nothing urgent — explore
    const goal = NEED_TO_GOAL.curiosity;
    return {
      goalId: goal.goalId,
      goalState: new Map([goal.predicate]),
    };
  }

  const goal = NEED_TO_GOAL[mostUrgent];
  return {
    goalId: goal.goalId,
    goalState: new Map([goal.predicate]),
    reasoning: `${mostUrgent} is critically low at ${DEFAULT_NEED_CONFIGS[mostUrgent].urgencyThreshold} threshold`,
  };
}

/** Convert a goalId back to its goal WorldState for the planner. */
export function goalIdToState(goalId: string): WorldState | null {
  for (const entry of Object.values(NEED_TO_GOAL)) {
    if (entry.goalId === goalId) {
      return new Map([entry.predicate]);
    }
  }
  return null;
}
