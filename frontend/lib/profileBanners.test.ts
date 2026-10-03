import { describe, expect, it } from "vitest";
import { bannerTone } from "./profileBanners";

describe("bannerTone", () => {
  it("maps a catalog id to its art tone", () => {
    expect(bannerTone("azure-tide")).toBe("blue");
  });

  it.each([[null], [undefined], ["retired-design"]])("falls back to the default for %s", (id) => {
    expect(bannerTone(id)).toBe("indigo");
  });
});
