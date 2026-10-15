import "@testing-library/jest-dom/vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { MessageActions } from "../components/chat/MessageActions";

const CAT = { id: "e1", shortcode: "cat", imageUrl: "https://res.cloudinary.com/x/cat.png", animationUrl: null };

// The real picker is a web component fetched on demand; here it just offers one emoji and one emote.
vi.mock("../components/chat/EmojiPicker", () => ({
  EmojiPicker: ({ onPick }) => (
    <div data-testid="full-picker">
      <button onClick={() => onPick({ emoji: "🫛" })} type="button">
        pick emoji
      </button>
      <button onClick={() => onPick({ emoteId: "e1", emote: CAT })} type="button">
        pick emote
      </button>
    </div>
  ),
}));

function setup() {
  const handlers = {
    onReact: vi.fn(),
    onReply: vi.fn(),
    onCopy: vi.fn(),
    onEdit: vi.fn(),
    onRemove: vi.fn(),
  };
  render(<MessageActions canCopy {...handlers} />);
  fireEvent.click(screen.getByRole("button", { name: "React" }));
  return handlers;
}

describe("MessageActions reaction picker", () => {
  it("lists the quick emojis and a plus button", () => {
    setup();

    const picker = screen.getByRole("menu");
    expect(picker.querySelectorAll("button")).toHaveLength(7);
    expect(screen.getByRole("menuitem", { name: "More reactions" })).toBeInTheDocument();
  });

  it("reacts with the chosen quick emoji and closes", () => {
    const { onReact } = setup();

    fireEvent.click(screen.getByRole("menuitem", { name: "❤️" }));

    expect(onReact).toHaveBeenCalledWith({ emoji: "❤️" });
    expect(screen.queryByRole("menu")).not.toBeInTheDocument();
  });

  it("opens the full picker in place of the quick row when plus is clicked", () => {
    const { onReact } = setup();

    fireEvent.click(screen.getByRole("menuitem", { name: "More reactions" }));

    expect(screen.getByTestId("full-picker")).toBeInTheDocument();
    expect(screen.queryByRole("menuitem", { name: "❤️" })).not.toBeInTheDocument();
    expect(onReact).not.toHaveBeenCalled();
  });

  it("reacts with an emoji picked from the full picker and closes", () => {
    const { onReact } = setup();
    fireEvent.click(screen.getByRole("menuitem", { name: "More reactions" }));

    fireEvent.click(screen.getByRole("button", { name: "pick emoji" }));

    expect(onReact).toHaveBeenCalledWith({ emoji: "🫛" });
    expect(screen.queryByTestId("full-picker")).not.toBeInTheDocument();
  });

  it("reacts with a custom emote picked from the full picker", () => {
    const { onReact } = setup();
    fireEvent.click(screen.getByRole("menuitem", { name: "More reactions" }));

    fireEvent.click(screen.getByRole("button", { name: "pick emote" }));

    expect(onReact).toHaveBeenCalledWith({ emoteId: "e1", emote: CAT });
  });

  it("starts from the quick row again the next time it opens", () => {
    setup();
    fireEvent.click(screen.getByRole("menuitem", { name: "More reactions" }));
    fireEvent.click(screen.getByRole("button", { name: "React" }));

    fireEvent.click(screen.getByRole("button", { name: "React" }));

    expect(screen.getByRole("menuitem", { name: "❤️" })).toBeInTheDocument();
    expect(screen.queryByTestId("full-picker")).not.toBeInTheDocument();
  });
});
