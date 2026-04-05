import { describe, expect, it } from "vitest";
import { CHARACTERS as ROOT_CHARACTERS } from "../../data/characters.js";
import { CHARACTERS as SERVER_CHARACTERS } from "../src/data/characters.js";

describe("character data exports", () => {
  it("re-exports the canonical server character list at the repo root", () => {
    expect(ROOT_CHARACTERS).toBe(SERVER_CHARACTERS);
    expect(ROOT_CHARACTERS).toEqual(SERVER_CHARACTERS);
  });
});
