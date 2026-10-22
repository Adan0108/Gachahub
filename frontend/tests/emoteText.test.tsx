import "@testing-library/jest-dom/vitest";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ComposerEmojiButton } from "../components/chat/ComposerEmojiButton";
import { LinkifiedText } from "../components/chat/LinkifiedText";
import { emotesAsText, encodeEmotes, emoteToken, hasEmotes, splitEmotes } from "../lib/emoji/emoteText";
import { previewLine } from "../lib/chat/conversationPreview";

const mocks = vi.hoisted(() => ({ library: undefined as any }));
vi.mock("../hooks/chat/useEmotes", () => ({
  useEmotes: () => ({ library: mocks.library, isLoading: false }),
}));
vi.mock("../components/chat/EmojiPicker", () => ({
  EmojiPicker: ({ onPick }: any) => (
    <button onClick={() => onPick({ kind: "emoji", emoji: "😀" })} type="button">
      pick
    </button>
  ),
}));

const cat = {
  id: "emote12345",
  shortcode: "cat",
  imageUrl: "https://res.cloudinary.com/x/cat.png",
  animationUrl: null,
  unicode: null,
  deletedAt: null,
};

describe("emote text", () => {
  it("writes and finds the token a picked emote leaves in a message", () => {
    expect(emoteToken(cat)).toBe("<:cat:emote12345>");
    expect(encodeEmotes("hi :cat: and :dog:", new Map([["cat", cat]]))).toBe(
      "hi <:cat:emote12345> and :dog:",
    );
    expect(encodeEmotes("hi :cat:", new Map())).toBe("hi :cat:");
  });

  it("cuts a message into text and emotes in order", () => {
    expect(splitEmotes("a <:cat:emote12345> b")).toEqual([
      { text: "a " },
      { emote: { shortcode: "cat", id: "emote12345" } },
      { text: " b" },
    ]);
    expect(hasEmotes("a <:cat:emote12345>")).toBe(true);
    expect(hasEmotes("plain <b>html</b> text")).toBe(false);
  });

  it("shows a token as :name: where only text fits, such as the chat list", () => {
    expect(emotesAsText("hi <:cat:emote12345>")).toBe("hi :cat:");
    expect(previewLine({ v: 1, type: "text", body: "hi <:cat:emote12345>" }, { mine: false })).toBe("hi :cat:");
  });
});

describe("a message with an emote", () => {
  beforeEach(() => {
    window.matchMedia = vi.fn(() => ({
      matches: false,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    })) as any;
  });

  const renderText = (text: any) =>
    render(
      <QueryClientProvider client={new QueryClient()}>
        <p>
          <LinkifiedText text={text} />
        </p>
      </QueryClientProvider>,
    );

  it("draws the emote as a picture", () => {
    mocks.library = { global: [cat], games: [] };

    renderText("look <:cat:emote12345>!");

    expect(screen.getByRole("img", { name: ":cat:" })).toHaveAttribute("src", cat.imageUrl);
  });

  it("finds an emote from a game community too", () => {
    mocks.library = { global: [], games: [{ game: { id: "g", name: "G" }, emotes: [cat] }] };

    renderText("<:cat:emote12345>");

    expect(screen.getByRole("img", { name: ":cat:" })).toBeInTheDocument();
  });

  it("falls back to :name: for an emote this viewer cannot use", () => {
    mocks.library = { global: [], games: [] };

    renderText("<:cat:emote12345>");

    expect(screen.getByText(":cat:")).toBeInTheDocument();
  });
});

describe("ComposerEmojiButton", () => {
  it("opens the picker, hands back the pick and closes", () => {
    const onPick = vi.fn();
    render(<ComposerEmojiButton onPick={onPick} />);

    fireEvent.click(screen.getByRole("button", { name: "Add an emoji or emote" }));
    fireEvent.click(screen.getByRole("button", { name: "pick" }));

    expect(onPick).toHaveBeenCalledWith({ kind: "emoji", emoji: "😀" });
    expect(screen.queryByRole("button", { name: "pick" })).toBeNull();
  });

  it("cannot be opened while disabled", () => {
    render(<ComposerEmojiButton disabled onPick={vi.fn()} />);

    expect(screen.getByRole("button", { name: "Add an emoji or emote" })).toBeDisabled();
  });
});
