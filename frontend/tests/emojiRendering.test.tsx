import "@testing-library/jest-dom/vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Emoji, Emote, ReactionFace } from "../components/chat/Emoji";
import { emojiImageUrl } from "../lib/emoji/emojiImage";

const supported = vi.hoisted(() => ({ check: vi.fn() }));
vi.mock("../lib/emoji/emojiSupport", () => ({ isEmojiSupported: supported.check }));

const BEAN = "\u{1FADB}";
const emote = (extra: any = {}): any => ({
  id: "e1",
  shortcode: "cat",
  imageUrl: "https://res.cloudinary.com/x/cat.png",
  animationUrl: "https://res.cloudinary.com/x/cat.gif",
  ...extra,
});

function stubMotionPreference(reduce: any) {
  window.matchMedia = vi.fn(() => ({
    matches: reduce,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
  })) as any;
}

describe("Emoji", () => {
  beforeEach(() => supported.check.mockReturnValue(true));

  it("draws the device's own glyph when it has one", () => {
    render(<Emoji emoji="😀" />);

    expect(screen.getByText("😀")).toBeInTheDocument();
    expect(screen.queryByRole("img")).not.toBeInTheDocument();
  });

  it("draws a picture when the device cannot", () => {
    supported.check.mockReturnValue(false);

    render(<Emoji emoji={BEAN} />);

    expect(screen.getByRole("img", { name: BEAN })).toHaveAttribute("src", emojiImageUrl(BEAN));
  });

  it("falls back to the text when the picture does not load", () => {
    supported.check.mockReturnValue(false);
    render(<Emoji emoji={BEAN} />);

    fireEvent.error(screen.getByRole("img"));

    expect(screen.getByText(BEAN)).toBeInTheDocument();
    expect(screen.queryByRole("img")).not.toBeInTheDocument();
  });
});

describe("Emote", () => {
  beforeEach(() => {
    supported.check.mockReturnValue(true);
    stubMotionPreference(false);
  });
  afterEach(() => vi.restoreAllMocks());

  it("shows the animation", () => {
    render(<Emote emote={emote()} />);

    expect(screen.getByRole("img", { name: ":cat:" })).toHaveAttribute(
      "src",
      "https://res.cloudinary.com/x/cat.gif",
    );
  });

  it("shows the still picture to someone who asked for less motion", () => {
    stubMotionPreference(true);

    render(<Emote emote={emote()} />);

    expect(screen.getByRole("img", { name: ":cat:" })).toHaveAttribute(
      "src",
      "https://res.cloudinary.com/x/cat.png",
    );
  });

  it("shows the still picture when there is no animation", () => {
    render(<Emote emote={emote({ animationUrl: null })} />);

    expect(screen.getByRole("img", { name: ":cat:" })).toHaveAttribute(
      "src",
      "https://res.cloudinary.com/x/cat.png",
    );
  });

  it("shows the :shortcode: for an emote that has been removed", () => {
    render(<Emote emote={emote({ deletedAt: "2026-10-10T00:00:00.000Z" })} />);

    expect(screen.getByText(":cat:")).toBeInTheDocument();
    expect(screen.queryByRole("img")).not.toBeInTheDocument();
  });

  it("shows the :shortcode: for a removed emote even when it has a unicode form", () => {
    render(
      <Emote
        emote={emote({
          imageUrl: null,
          animationUrl: null,
          unicode: "😀",
          deletedAt: "2026-10-10T00:00:00.000Z",
        })}
      />,
    );

    expect(screen.getByText(":cat:")).toBeInTheDocument();
    expect(screen.queryByText("😀")).not.toBeInTheDocument();
  });

  it("shows the emoji for a live emote that is only a unicode form", () => {
    render(<Emote emote={emote({ imageUrl: null, animationUrl: null, unicode: "😀" })} />);

    expect(screen.getByText("😀")).toBeInTheDocument();
  });

  it("shows the :shortcode: when the picture does not load", () => {
    render(<Emote emote={emote()} />);

    fireEvent.error(screen.getByRole("img"));

    expect(screen.getByText(":cat:")).toBeInTheDocument();
  });
});

describe("ReactionFace", () => {
  beforeEach(() => {
    supported.check.mockReturnValue(true);
    stubMotionPreference(false);
  });

  it("draws an emote when there is one, an emoji otherwise", () => {
    const { rerender } = render(<ReactionFace choice={{ kind: "emote", emote: emote() }} />);
    expect(screen.getByRole("img", { name: ":cat:" })).toBeInTheDocument();

    rerender(<ReactionFace choice={{ kind: "emoji", emoji: "👍" }} />);
    expect(screen.getByText("👍")).toBeInTheDocument();
  });
});
