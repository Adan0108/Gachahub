import "@testing-library/jest-dom/vitest";
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { NoChatSelected } from "../components/chat/NoChatSelected";

describe("NoChatSelected", () => {
  it("says no chat is selected, with a decorative icon", () => {
    const { container } = render(<NoChatSelected />);

    expect(screen.getByText("No chats selected")).toBeInTheDocument();
    expect(container.querySelector("svg")).toHaveAttribute("aria-hidden", "true");
  });
});
