import { describe, expect, it } from "vitest";
import { PlaceholderEmbedder, cosineSimilarity } from "../src/npc/embedding.js";

describe("PlaceholderEmbedder", () => {
  const embedder = new PlaceholderEmbedder(128); // smaller for tests

  it("returns vector of correct dimension", async () => {
    const vec = await embedder.embed("hello world");
    expect(vec).toHaveLength(128);
  });

  it("produces deterministic embeddings", async () => {
    const v1 = await embedder.embed("test input");
    const v2 = await embedder.embed("test input");
    expect(v1).toEqual(v2);
  });

  it("produces different vectors for different texts", async () => {
    const v1 = await embedder.embed("hello");
    const v2 = await embedder.embed("goodbye");
    const sim = cosineSimilarity(v1, v2);
    expect(sim).not.toBe(1);
  });

  it("produces unit-length vectors", async () => {
    const vec = await embedder.embed("normalize me");
    const norm = Math.sqrt(vec.reduce((sum, v) => sum + v * v, 0));
    expect(norm).toBeCloseTo(1.0, 5);
  });
});

describe("cosineSimilarity", () => {
  it("returns 1 for identical vectors", () => {
    const v = [1, 0, 0];
    expect(cosineSimilarity(v, v)).toBeCloseTo(1.0);
  });

  it("returns 0 for orthogonal vectors", () => {
    expect(cosineSimilarity([1, 0, 0], [0, 1, 0])).toBeCloseTo(0.0);
  });

  it("returns -1 for opposite vectors", () => {
    expect(cosineSimilarity([1, 0], [-1, 0])).toBeCloseTo(-1.0);
  });
});
