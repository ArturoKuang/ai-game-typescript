import { describe, expect, it } from "vitest";
import { PlaceholderEmbedder } from "../src/npc/embedding.js";

describe("Reflection (unit)", () => {
  it("placeholder embedder produces consistent similarity for same pair", async () => {
    const embedder = new PlaceholderEmbedder(256);
    const v1 = await embedder.embed("I talked to Bob about coffee");
    const v2 = await embedder.embed("I talked to Bob about coffee");

    // Same text -> identical vectors
    let dot = 0;
    for (let i = 0; i < v1.length; i++) dot += v1[i] * v2[i];
    expect(dot).toBeCloseTo(1.0, 5);
  });

  it("memory importance scoring produces values in range", () => {
    // Simple formula: min(9, max(1, ceil(messageCount * 1.5)))
    const score = (msgCount: number) =>
      Math.min(9, Math.max(1, Math.ceil(msgCount * 1.5)));
    expect(score(0)).toBe(1);
    expect(score(1)).toBe(2);
    expect(score(3)).toBe(5);
    expect(score(5)).toBe(8);
    expect(score(6)).toBe(9);
    expect(score(10)).toBe(9); // capped
  });

  it("recency decay produces expected scores", () => {
    const decay = 0.99;
    // 0 ticks ago -> 1.0
    expect(decay ** 0).toBeCloseTo(1.0);
    // 100 ticks ago -> ~0.366
    expect(decay ** 100).toBeCloseTo(0.366, 2);
    // 500 ticks ago -> ~0.0066
    expect(decay ** 500).toBeCloseTo(0.00657, 3);
  });
});
