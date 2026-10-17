import "@testing-library/jest-dom/vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { JumpToBottomButton } from "../components/chat/JumpToBottomButton";

describe("JumpToBottomButton", () => {
  it("is shown and usable while visible", () => {
    const onClick = vi.fn();
    render(<JumpToBottomButton onClick={onClick} visible />);

    const button = screen.getByRole("button", { name: "Jump to latest messages" });
    expect(button).toHaveClass("visible");
    fireEvent.click(button);

    expect(onClick).toHaveBeenCalledTimes(1);
  });

  it("stays out of the accessibility tree and tab order while hidden", () => {
    render(<JumpToBottomButton onClick={() => {}} visible={false} />);

    const button = screen.getByRole("button", { hidden: true });
    expect(button).not.toHaveClass("visible");
    expect(button).toHaveAttribute("aria-hidden", "true");
    expect(button).toHaveAttribute("tabindex", "-1");
  });
});
