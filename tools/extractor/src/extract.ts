/**
 * CLI entrypoint for the architecture extractor.
 *
 * Audit note: the extraction logic lives in `runExtractionPipeline.ts`; this
 * file only resolves repo-local paths and invokes the pipeline.
 */
import { resolve } from "node:path";
import { runExtractionPipeline } from "./runExtractionPipeline.js";

const ROOT = resolve(import.meta.dirname, "..", "..", "..");
const OUTPUT = resolve(import.meta.dirname, "..", "graph.json");

await runExtractionPipeline(ROOT, OUTPUT);
