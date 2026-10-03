import { describe, expect, it } from "vitest";
import { bannerColor } from "./profileBanners";

describe("bannerColor", () => {
  it("maps a catalog id to its solid colour", () => {
    expect(bannerColor("blue")).toBe("#4a74b4");
  });

  it.each([[null], [undefined], ["retired-design"]])("is null (default banner) for %s", (id) => {
    expect(bannerColor(id)).toBeNull();
  });
});
