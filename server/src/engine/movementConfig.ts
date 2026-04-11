/**
 * Tunable constants controlling how entities translate across tiles.
 *
 * NPCs used to inherit the default path speed of 1.0 tiles/tick, which at
 * 20 tps is 20 tiles/sec — far faster than a walking pace and visually
 * presents as a frictionless slide because the client keeps lerping toward
 * a target that always jumps a full tile ahead. These constants let NPCs
 * move at a believable walking pace (≈1.6 tiles/sec) while leaving humans
 * on the old fast click-to-move behavior.
 */

/** Human players retain the original path speed (tiles per tick). */
export const HUMAN_DEFAULT_PATH_SPEED = 1.0;

/**
 * Baseline NPC walking speed in tiles per tick.
 *
 * At 20 tps, 0.08 tiles/tick ≈ 1.6 tiles/sec, i.e. a human walking pace
 * if one tile represents one meter. This produces sub-tile position
 * updates on every tick which the client can render as a smooth stride
 * instead of the old teleport-then-lerp glide.
 */
export const NPC_DEFAULT_PATH_SPEED = 0.08;

/**
 * Fractional stride variance applied around the baseline per NPC.
 *
 * Each NPC's speed is computed deterministically from its id so that two
 * NPCs rarely move in perfect lockstep (which also reads as artificial).
 * A value of 0.15 means speeds land in roughly ±15% of the baseline.
 */
export const NPC_SPEED_VARIANCE = 0.15;

/**
 * Derive a stable per-NPC walking speed from its id.
 *
 * Uses a small FNV-style hash so the output is fully deterministic and
 * independent of the engine RNG (which means save/load, reconnects, and
 * persistence round-trips all keep an NPC's stride consistent).
 */
export function computeNpcPathSpeed(npcId: string): number {
  let hash = 2166136261;
  for (let i = 0; i < npcId.length; i++) {
    hash ^= npcId.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  // Map hash to a float in [-1, 1] in a way that's stable across runs.
  const unit = ((hash >>> 0) / 0xffffffff) * 2 - 1;
  const factor = 1 + unit * NPC_SPEED_VARIANCE;
  return NPC_DEFAULT_PATH_SPEED * factor;
}
