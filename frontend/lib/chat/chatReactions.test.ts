import { describe, expect, it } from "vitest";
import {
  choiceKey,
  groupReactions,
  withOptimisticReaction,
  type ChatEmote,
  type RawReaction,
} from "./chatReactions";

const emote = (id: string, shortcode = id, extra: Partial<ChatEmote> = {}): ChatEmote => ({
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
const emoteReaction = (userId: string, e: ChatEmote): RawReaction => ({
  userId,
  emoji: null,
  emoteId: e.id,
  emote: e,
});

describe("groupReactions", () => {
  it("counts each emoji once per reactor", () => {
    const groups = groupReactions(
      [
        { userId: "a", emoji: "👍" },
        { userId: "b", emoji: "👍" },
        { userId: "c", emoji: "❤️" },
      ],
      "z",
    );

    expect(groups.map(({ choice, count, mine }) => ({ choice, count, mine }))).toEqual([
      { choice: { kind: "emoji", emoji: "👍" }, count: 2, mine: false },
      { choice: { kind: "emoji", emoji: "❤️" }, count: 1, mine: false },
    ]);
  });

  it("flags the current user's own reaction and sorts it first", () => {
    const groups = groupReactions(
      [
        { userId: "a", emoji: "👍" },
        { userId: "me", emoji: "❤️" },
      ],
      "me",
    );

    expect(groups.map(({ key, mine }) => ({ key, mine }))).toEqual([
      { key: "emoji:❤️", mine: true },
      { key: "emoji:👍", mine: false },
    ]);
  });

  it("shows custom emote reactions instead of dropping them", () => {
    const cat = emote("e1", "catcooking");

    const groups = groupReactions([emoteReaction("a", cat)], "me");

    expect(groups).toEqual([
      { key: "emote:e1", choice: { kind: "emote", emote: cat }, count: 1, mine: false },
    ]);
  });

  it("counts the same emote from several people as one chip", () => {
    const cat = emote("e1");

    const groups = groupReactions([emoteReaction("a", cat), emoteReaction("b", cat)], "me");

    expect(groups).toHaveLength(1);
    expect(groups[0]).toMatchObject({ count: 2, mine: false });
  });

  it("keeps an emoji and an emote apart, even with the same name", () => {
    const groups = groupReactions(
      [{ userId: "a", emoji: "😀" }, emoteReaction("b", emote("e1", "grinning"))],
      "me",
    );

    expect(groups.map((group) => group.key)).toEqual(["emoji:😀", "emote:e1"]);
  });

  it("flags an emote reaction as mine and sorts it first", () => {
    const groups = groupReactions(
      [{ userId: "a", emoji: "👍" }, emoteReaction("me", emote("e1"))],
      "me",
    );

    expect(groups.map((group) => group.key)).toEqual(["emote:e1", "emoji:👍"]);
    expect(groups[0]!.mine).toBe(true);
  });

  it("shows a reaction to an emote that has since been removed, so its chip does not vanish", () => {
    const gone = emote("e1", "oldcat", { deletedAt: "2026-10-10T00:00:00.000Z" });

    const [group] = groupReactions([emoteReaction("a", gone)], "me");

    expect(group!.choice).toEqual({ kind: "emote", emote: gone });
  });

  it.each([
    ["nothing at all", [{ userId: "a", emoji: null }]],
    ["an empty emoji", [{ userId: "a", emoji: "" }]],
    ["an emote id with no details to draw", [{ userId: "a", emoji: null, emoteId: "e1" }]],
  ])("ignores a reaction with %s", (_name, reactions) => {
    expect(groupReactions(reactions as RawReaction[], "me")).toEqual([]);
  });

  it("copes with no reactions", () => {
    expect(groupReactions(undefined, "me")).toEqual([]);
    expect(groupReactions([], "me")).toEqual([]);
  });
});

describe("choiceKey", () => {
  it("tells an emoji from an emote and one emote from another", () => {
    expect(choiceKey({ kind: "emoji", emoji: "👍" })).toBe("emoji:👍");
    expect(choiceKey({ kind: "emote", emote: emote("e1") })).toBe("emote:e1");
    expect(choiceKey({ kind: "emote", emote: emote("e2") })).not.toBe(
      choiceKey({ kind: "emote", emote: emote("e1") }),
    );
  });
});

describe("withOptimisticReaction", () => {
  const messages = [
    { id: "m1", reactions: [{ userId: "bob", emoji: "👍" }] as RawReaction[] },
    { id: "m2", reactions: [] as RawReaction[] },
  ];
  const thumbs = { kind: "emoji", emoji: "👍" } as const;
  const heart = { kind: "emoji", emoji: "❤️" } as const;
  const wow = { kind: "emoji", emoji: "😮" } as const;

  it("adds the reaction to the right message, leaving others untouched", () => {
    const result = withOptimisticReaction(messages, "m1", "me", heart);

    expect(result[0]!.reactions).toEqual([
      { userId: "bob", emoji: "👍" },
      { userId: "me", emoji: "❤️" },
    ]);
    expect(result[1]).toBe(messages[1]);
  });

  it("replaces an existing reaction from the same user instead of adding a second one", () => {
    const withMine = withOptimisticReaction(messages, "m1", "me", thumbs);

    const result = withOptimisticReaction(withMine, "m1", "me", wow);

    expect(result[0]!.reactions).toEqual([
      { userId: "bob", emoji: "👍" },
      { userId: "me", emoji: "😮" },
    ]);
  });

  it("adds a custom emote carrying its details, so it can be drawn before the server answers", () => {
    const cat = emote("e1", "catcooking");

    const result = withOptimisticReaction(messages, "m2", "me", { kind: "emote", emote: cat });

    expect(result[1]!.reactions).toEqual([
      { userId: "me", emoji: null, emoteId: "e1", emote: cat },
    ]);
  });

  it("swaps an emoji for an emote and back", () => {
    const cat = emote("e1");
    const asEmote = withOptimisticReaction(
      withOptimisticReaction(messages, "m2", "me", thumbs),
      "m2",
      "me",
      { kind: "emote", emote: cat },
    );
    const backToEmoji = withOptimisticReaction(asEmote, "m2", "me", wow);

    expect(asEmote[1]!.reactions).toEqual([
      { userId: "me", emoji: null, emoteId: "e1", emote: cat },
    ]);
    expect(backToEmoji[1]!.reactions).toEqual([{ userId: "me", emoji: "😮" }]);
  });

  it("removes the reaction when the choice is null", () => {
    const withMine = withOptimisticReaction(messages, "m1", "me", heart);

    const result = withOptimisticReaction(withMine, "m1", "me", null);

    expect(result[0]!.reactions).toEqual([{ userId: "bob", emoji: "👍" }]);
  });

  it("leaves a message with no matching id untouched", () => {
    expect(withOptimisticReaction(messages, "missing", "me", thumbs)).toEqual(messages);
  });

  it("does not change the list it was given", () => {
    const before = JSON.stringify(messages);

    withOptimisticReaction(messages, "m1", "me", heart);

    expect(JSON.stringify(messages)).toBe(before);
  });
});
