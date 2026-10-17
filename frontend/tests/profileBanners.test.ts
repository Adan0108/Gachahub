import { describe, expect, it } from "vitest";
import { bannerColor } from "../lib/profileBanners";

describe("bannerColor", () => {
  it.each([
    ["violet", "#6a5eb0"],
    ["blue", "#4a74b4"],
    ["amber", "#b58452"],
    ["rose", "#b5586f"],
    ["teal", "#44908b"],
    ["slate", "#566077"],
  ])("resolves the %s preset", (id, color) => {
    expect(bannerColor(id)).toBe(color);
  });

  it.each([undefined, null, "", "retired-preset"])("uses the default for %s", (id) => {
    expect(bannerColor(id)).toBeNull();
  });
});
