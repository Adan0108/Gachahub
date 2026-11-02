import { describe, expect, it } from "vitest";
import { bannerSurface, cosmeticSurface } from "../lib/cosmetics";

const item = (overrides: Record<string, unknown>) =>
  ({
    id: "i",
    slug: "s",
    name: "n",
    slot: "BANNER",
    rarity: "GLIMMER",
    animated: false,
    assetUrl: null,
    presetId: null,
    ...overrides,
  }) as Parameters<typeof cosmeticSurface>[0];

describe("cosmetic surfaces", () => {
  it("prefers the CSS preset over the image", () => {
    expect(cosmeticSurface(item({ presetId: "aurora", assetUrl: "https://cdn/x.png" }))).toEqual({
      className: "cosmetic-preset-aurora",
    });
  });

  it("quotes image URLs so brackets or quotes cannot break the style", () => {
    const style = cosmeticSurface(item({ assetUrl: 'https://cdn/a (1)".png' })).style;
    expect(style?.backgroundImage).toBe('url("https://cdn/a (1)\\".png")');
  });

  it("draws each kind of resolved banner", () => {
    expect(bannerSurface({ kind: "preset", presetId: "rose", color: "#f0a" })).toEqual({
      className: "",
      style: { backgroundColor: "#f0a" },
    });
    expect(bannerSurface({ kind: "default" })).toEqual({ className: "" });
  });
});
