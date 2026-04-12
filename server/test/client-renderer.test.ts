import { describe, expect, it, vi } from "vitest";
import { loadOptionalAsset } from "../../client/src/optionalAsset.js";

describe("client optional asset loading", () => {
  it("returns the asset when the loader succeeds", async () => {
    const asset = { ok: true };

    const loaded = await loadOptionalAsset(
      async () => asset,
      { src: "/assets/test.png" },
      "asset missing",
      { warn: vi.fn() },
    );

    expect(loaded).toBe(asset);
  });

  it("falls back to null when the asset is missing", async () => {
    const warn = vi.fn();

    const loaded = await loadOptionalAsset(
      async () => {
        throw new Error("decode failed");
      },
      { src: "/assets/missing.png" },
      "asset missing",
      { warn },
    );

    expect(loaded).toBeNull();
    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn.mock.calls[0]?.[0]).toContain("asset missing");
  });
});
