/**
 * Stable repo-root export for consumers that do not want a server-relative path.
 *
 * The canonical character list lives under `server/src/data/characters.ts` so
 * gameplay and debug tooling share one definition. This file intentionally
 * re-exports that data instead of keeping a parallel copy.
 */
export { CHARACTERS } from "../server/src/data/characters.js";
export type { CharacterDef } from "../server/src/engine/types.js";
