/**
 * NPC needs decay, urgency detection, and boost logic.
 *
 * Every tick each need decays by its configured rate. When a need
 * crosses below the urgency threshold it flags the NPC for goal
 * selection; crossing the critical threshold interrupts the current plan.
 */
import type { NeedConfig, NeedType, NpcNeeds } from "./types.js";
import { DEFAULT_NEED_CONFIGS } from "./types.js";

const NEED_KEYS: NeedType[] = [
  "hunger",
  "energy",
  "social",
  "safety",
  "curiosity",
];

export function createDefaultNeeds(
  configs: Record<NeedType, NeedConfig> = DEFAULT_NEED_CONFIGS,
): NpcNeeds {
  return {
    hunger: configs.hunger.initialValue,
    energy: configs.energy.initialValue,
    social: configs.social.initialValue,
    safety: configs.safety.initialValue,
    curiosity: configs.curiosity.initialValue,
  };
}

export interface NeedsTickResult {
  newUrgent: NeedType[];
  newCritical: NeedType[];
}

/**
 * Decay all needs by one tick and report threshold crossings.
 * Mutates `needs` in place.
 */
export function tickNeeds(
  needs: NpcNeeds,
  configs: Record<NeedType, NeedConfig> = DEFAULT_NEED_CONFIGS,
): NeedsTickResult {
  const newUrgent: NeedType[] = [];
  const newCritical: NeedType[] = [];

  for (const key of NEED_KEYS) {
    const config = configs[key];
    const before = needs[key];
    needs[key] = Math.max(0, before - config.decayPerTick);
    const after = needs[key];

    // Crossed urgency threshold this tick
    if (before >= config.urgencyThreshold && after < config.urgencyThreshold) {
      newUrgent.push(key);
    }
    // Crossed critical threshold this tick
    if (
      before >= config.criticalThreshold &&
      after < config.criticalThreshold
    ) {
      newCritical.push(key);
    }
  }

  return { newUrgent, newCritical };
}

/** Boost a need (e.g., eating restores hunger). Clamps to 100. */
export function boostNeed(needs: NpcNeeds, need: NeedType, amount: number): void {
  needs[need] = Math.min(100, needs[need] + amount);
}

/** Returns all needs currently below their urgency threshold. */
export function getUrgentNeeds(
  needs: NpcNeeds,
  configs: Record<NeedType, NeedConfig> = DEFAULT_NEED_CONFIGS,
): NeedType[] {
  return NEED_KEYS.filter((key) => needs[key] < configs[key].urgencyThreshold);
}

/** Returns the most urgent need (lowest ratio of value / urgencyThreshold). */
export function getMostUrgentNeed(
  needs: NpcNeeds,
  configs: Record<NeedType, NeedConfig> = DEFAULT_NEED_CONFIGS,
): NeedType | null {
  let worst: NeedType | null = null;
  let worstRatio = Infinity;

  for (const key of NEED_KEYS) {
    const config = configs[key];
    if (needs[key] >= config.urgencyThreshold) continue;
    const ratio = needs[key] / config.urgencyThreshold;
    if (ratio < worstRatio) {
      worstRatio = ratio;
      worst = key;
    }
  }

  return worst;
}

/** Check if any need is below its critical threshold. */
export function hasCriticalNeed(
  needs: NpcNeeds,
  configs: Record<NeedType, NeedConfig> = DEFAULT_NEED_CONFIGS,
): boolean {
  return NEED_KEYS.some((key) => needs[key] < configs[key].criticalThreshold);
}
