import "@testing-library/jest-dom/vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { UserPicker } from "../components/chat/UserPicker";

const mocks = vi.hoisted(() => ({ items: [] }));

vi.mock("../hooks/chat/useUserSearch", () => ({
  USER_SEARCH_MIN_CHARS: 2,
  useUserSearch: () => ({
    items: mocks.items,
    isActive: true,
    isLoading: false,
    error: undefined,
    retry: () => {},
  }),
}));

describe("UserPicker", () => {
  it("keeps the picked user's image so the chip can show their avatar", () => {
    mocks.items = [{ id: "u1", name: "Rover", image: "https://cdn/rover.png", username: "rover" }];
    const onChange = vi.fn();
    render(<UserPicker onChange={onChange} value={[]} />);

    fireEvent.change(screen.getByRole("combobox"), { target: { value: "ro" } });
    fireEvent.click(screen.getByRole("option", { name: /Rover/ }));

    expect(onChange).toHaveBeenCalledWith([
      { id: "u1", name: "Rover", image: "https://cdn/rover.png" },
    ]);
  });
});
