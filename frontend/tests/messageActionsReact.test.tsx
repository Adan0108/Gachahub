import "@testing-library/jest-dom/vitest";
import { act, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MessageActions } from "../components/chat/MessageActions";

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
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("lists the quick emojis and a plus button", () => {
    setup();

    const picker = screen.getByRole("menu");
    expect(picker.querySelectorAll("button")).toHaveLength(7);
    expect(screen.getByRole("menuitem", { name: "More reactions" })).toBeInTheDocument();
  });

  it("reacts with the chosen emoji and closes", () => {
    const { onReact } = setup();

    fireEvent.click(screen.getByRole("menuitem", { name: "❤️" }));

    expect(onReact).toHaveBeenCalledWith("❤️");
    expect(screen.queryByRole("menu")).not.toBeInTheDocument();
  });

  it("says more reactions are coming soon when plus is clicked, and keeps the picker open", () => {
    const { onReact } = setup();

    fireEvent.click(screen.getByRole("menuitem", { name: "More reactions" }));

    expect(screen.getByRole("status")).toHaveTextContent("More reactions are coming soon.");
    expect(screen.getByRole("menu")).toBeInTheDocument();
    expect(onReact).not.toHaveBeenCalled();
  });

  it("takes the note away again after a moment", () => {
    setup();
    fireEvent.click(screen.getByRole("menuitem", { name: "More reactions" }));

    act(() => vi.advanceTimersByTime(2000));

    expect(screen.queryByRole("status")).not.toBeInTheDocument();
  });

  it("restarts the note's timer on a second click", () => {
    setup();
    const plus = screen.getByRole("menuitem", { name: "More reactions" });
    fireEvent.click(plus);
    act(() => vi.advanceTimersByTime(1500));

    fireEvent.click(plus);
    act(() => vi.advanceTimersByTime(1500));

    expect(screen.getByRole("status")).toBeInTheDocument();
  });
});
