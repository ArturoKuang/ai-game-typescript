/**
 * Re-export the shared architecture graph schema for visualizer imports.
 *
 * Audit note: keep schema edits centralized in `tools/graph-schema/src/index.ts`
 * so the extractor and visualizer cannot drift again.
 */
export type * from "../../graph-schema/src/index.js";
