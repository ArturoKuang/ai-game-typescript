/**
 * Tunable constants for the bear monster system.
 */

// --- Bear stats ---
export const BEAR_HP = 30;
export const BEAR_DAMAGE = 10;
/** Ticks between bear attacks (2s at 20 tps). */
export const BEAR_ATTACK_COOLDOWN = 40;
/** Manhattan distance at which a bear notices a player. */
export const BEAR_AGGRO_RADIUS = 4;
/** Manhattan distance required to land an attack. */
export const BEAR_ATTACK_RANGE = 1;
/** Ticks between random wander moves (1s at 20 tps). */
export const BEAR_WANDER_INTERVAL = 20;

// --- Player combat ---
export const PLAYER_DEFAULT_HP = 100;
export const PLAYER_ATTACK_DAMAGE = 15;
export const PLAYER_ATTACK_RANGE = 1;
/** Ticks between player attacks (0.5s at 20 tps). */
export const PLAYER_ATTACK_COOLDOWN = 10;

// --- Bear meat ---
/** HP restored by eating one bear meat. */
export const BEAR_MEAT_HEAL = 25;

// --- Inventory ---
/** Maximum inventory slots per player. */
export const PLAYER_INVENTORY_CAPACITY = 10;

// --- Game of Life spawning ---
/** Ticks between GoL evaluations (15s at 20 tps). */
export const GOL_EVAL_INTERVAL = 300;
/** Chebyshev (Moore) neighborhood radius for GoL neighbor counting. */
export const GOL_NEIGHBORHOOD_RADIUS = 3;
/** Min neighbors for an empty tile to birth a bear. */
export const GOL_BIRTH_MIN = 2;
/** Max neighbors for an empty tile to birth a bear. */
export const GOL_BIRTH_MAX = 3;
/** Min neighbors for a bear to survive. */
export const GOL_SURVIVAL_MIN = 1;
/** Max neighbors for a bear to survive (above this = overcrowding). */
export const GOL_SURVIVAL_MAX = 3;
/** Ticks of isolation (0 neighbors) before a bear despawns. */
export const GOL_LONELINESS_TICKS = 200;
/** Hard cap on total live bears. */
export const BEAR_POPULATION_CAP = 6;
/** Minimum bears; auto-seed if below. */
export const BEAR_POPULATION_MIN = 1;
/** Initial bears spawned at boot. */
export const BEAR_INITIAL_COUNT = 2;
/** Min Manhattan distance from players when spawning. */
export const BEAR_SPAWN_PLAYER_BUFFER = 2;
/** Min Manhattan distance from activities for wilderness zones. */
export const WILDERNESS_ACTIVITY_BUFFER = 2;
