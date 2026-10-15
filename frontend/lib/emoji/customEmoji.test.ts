import { describe, expect, it } from "vitest";
import type { ChatEmote } from "../chat/chatReactions";
import { buildCustomEmoji, choiceFromSelection, type EmoteLibrary } from "./customEmoji";

const emote = (id: string, shortcode: string, extra: Partial<ChatEmote> = {}): ChatEmote => ({
  id,
  shortcode,
  unicode: null,
  imageUrl: `https://res.cloudinary.com/x/${shortcode}.png`,
  animationUrl: null,
  width: null,
  height: null,
  mimeType: null,
  ...extra,
});

describe("buildCustomEmoji", () => {
  it("is empty before the emotes have loaded", () => {
    const set = buildCustomEmoji(undefined);

    expect(set.categories).toEqual([]);
    expect(set.byId.size).toBe(0);
  });

  it("puts app-wide emotes first, then one category per game", () => {
    const library: EmoteLibrary = {
      global: [emote("g1", "pity")],
      games: [
        { game: { id: "a", name: "Genshin" }, emotes: [emote("e1", "paimon")] },
        { game: { id: "b", name: "Honkai" }, emotes: [emote("e2", "kiana")] },
      ],
    };

    const { categories } = buildCustomEmoji(library);

    expect(categories.map((category) => category.name)).toEqual(["GachaHub", "Genshin", "Honkai"]);
    expect(categories[1]!.emojis[0]).toEqual({
      id: "e1",
      name: "paimon",
      keywords: ["paimon"],
      skins: [{ src: "https://res.cloudinary.com/x/paimon.png" }],
    });
  });

  it("skips a category with nothing to show", () => {
    const library: EmoteLibrary = {
      global: [],
      games: [{ game: { id: "a", name: "Genshin" }, emotes: [] }],
    };

    expect(buildCustomEmoji(library).categories).toEqual([]);
  });

  it("skips an emote that has no picture, such as a unicode-only one", () => {
    const library: EmoteLibrary = {
      global: [emote("g1", "plain", { imageUrl: null, unicode: "😀" })],
      games: [],
    };

    expect(buildCustomEmoji(library).categories).toEqual([]);
  });

  it("falls back to the animation when there is no still picture", () => {
    const animated = emote("g1", "dance", {
      imageUrl: null,
      animationUrl: "https://res.cloudinary.com/x/dance.gif",
    });

    const { categories } = buildCustomEmoji({ global: [animated], games: [] });

    expect(categories[0]!.emojis[0]!.skins).toEqual([
      { src: "https://res.cloudinary.com/x/dance.gif" },
    ]);
  });
});

describe("choiceFromSelection", () => {
  const cat = emote("e1", "cat");
  const { byId } = buildCustomEmoji({ global: [cat], games: [] });

  it("is the emoji for a unicode pick", () => {
    expect(choiceFromSelection({ id: "grinning", native: "😀" }, byId)).toEqual({
      kind: "emoji",
      emoji: "😀",
    });
  });

  it("is the emote, with its details, for a custom pick", () => {
    expect(choiceFromSelection({ id: "e1" }, byId)).toEqual({ kind: "emote", emote: cat });
  });

  it("is nothing for a custom pick that is not in the library", () => {
    expect(choiceFromSelection({ id: "unknown" }, byId)).toBeNull();
  });
});
